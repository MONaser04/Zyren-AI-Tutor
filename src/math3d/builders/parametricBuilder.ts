import * as THREE from 'three';
import * as math from 'mathjs';
import type { Math3DOptions, Math3DGeometryResult } from '../types';
import { getNeonColor, extractGridResolution } from '../compiler';
import { sanitizeMathString } from '../astParser';

function compileParametricExpression(raw: string, fallback: (u: number, v: number) => number): (u: number, v: number) => number {
  const clean = sanitizeMathString(raw);
  try {
    const compiled = math.compile(clean);
    return (u: number, v: number) => {
      try {
        const val = compiled.evaluate({ u, v, x: u, y: v, z: 0, t: u });
        return typeof val === 'number' && !isNaN(val) && isFinite(val) ? val : fallback(u, v);
      } catch (e) {
        return fallback(u, v);
      }
    };
  } catch (e) {
    return fallback;
  }
}

/**
 * Dedicated Parametric 3D Surface Pipeline: r(u, v) = (x(u, v), y(u, v), z(u, v))
 * Powered by mathjs AST Traversal & Analytical Cross-Product Normals
 */
export function buildParametricSurfaceMesh(options: Math3DOptions): Math3DGeometryResult {
  const xFn = compileParametricExpression(options.xUV || 'u * cos(v)', (u, v) => u * Math.cos(v));
  const yFn = compileParametricExpression(options.yUV || 'u * sin(v)', (u, v) => u * Math.sin(v));
  const zFn = compileParametricExpression(options.zUV || 'v', (_u, v) => v);

  const uMin = options.uRange?.[0] ?? -Math.PI;
  const uMax = options.uRange?.[1] ?? Math.PI;
  const vMin = options.vRange?.[0] ?? -Math.PI;
  const vMax = options.vRange?.[1] ?? Math.PI;
  const colorTheme = options.colorTheme || 'cyan_orange';

  const res = options.gridResolution || options.resolution || extractGridResolution(options.title, 60);
  const nu = Math.min(120, Math.max(30, res));
  const nv = Math.min(120, Math.max(30, res));

  const positions: number[] = [];
  const normals: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];

  let minZ = Infinity;
  let maxZ = -Infinity;
  let maxExtent = 1.0;

  const grid: [number, number, number][][] = [];

  // 1. Pass 1: Compute coordinates and bounds
  for (let i = 0; i <= nu; i++) {
    const u = uMin + (i / nu) * (uMax - uMin);
    grid[i] = [];
    for (let j = 0; j <= nv; j++) {
      const v = vMin + (j / nv) * (vMax - vMin);
      const x = xFn(u, v);
      const y = yFn(u, v);
      const z = zFn(u, v);

      grid[i][j] = [x, y, z];

      if (isFinite(z)) {
        minZ = Math.min(minZ, z);
        maxZ = Math.max(maxZ, z);
      }
      maxExtent = Math.max(maxExtent, Math.abs(x), Math.abs(y), Math.abs(z));
    }
  }

  const rangeZ = maxZ - minZ || 1.0;
  const scale = Math.min(1.0, 3.4 / (maxExtent || 1.0));

  const du = (uMax - uMin) / nu;
  const dv = (vMax - vMin) / nv;

  // 2. Pass 2: Generate vertices & tangent cross-product normals
  for (let i = 0; i <= nu; i++) {
    const u = uMin + (i / nu) * (uMax - uMin);
    for (let j = 0; j <= nv; j++) {
      const v = vMin + (j / nv) * (vMax - vMin);
      const [x, y, z] = grid[i][j];

      // Math coordinates to Three.js coordinates:
      // Math X -> Three.js X
      // Math Y -> Three.js -Z
      // Math Z -> Three.js Y
      positions.push(x * scale, z * scale, -y * scale);

      // Tangent vectors: dr/du and dr/dv
      const x_u = (xFn(u + du * 0.1, v) - xFn(u - du * 0.1, v)) / (du * 0.2);
      const y_u = (yFn(u + du * 0.1, v) - yFn(u - du * 0.1, v)) / (du * 0.2);
      const z_u = (zFn(u + du * 0.1, v) - zFn(u - du * 0.1, v)) / (du * 0.2);

      const x_v = (xFn(u, v + dv * 0.1) - xFn(u, v - dv * 0.1)) / (dv * 0.2);
      const y_v = (yFn(u, v + dv * 0.1) - yFn(u, v - dv * 0.1)) / (dv * 0.2);
      const z_v = (zFn(u, v + dv * 0.1) - zFn(u, v - dv * 0.1)) / (dv * 0.2);

      // Cross product dr/du x dr/dv
      const nx = y_u * z_v - z_u * y_v;
      const ny = z_u * x_v - x_u * z_v;
      const nz = x_u * y_v - y_u * x_v;
      const len = Math.hypot(nx, ny, nz) || 1.0;

      // Transform normal to Three.js space
      normals.push(nx / len, nz / len, -ny / len);

      const normZ = Math.max(0, Math.min(1, (z - minZ) / rangeZ));
      const c = getNeonColor(normZ, colorTheme);
      colors.push(c.r, c.g, c.b);
    }
  }

  // 3. Grid triangulation
  for (let i = 0; i < nu; i++) {
    for (let j = 0; j < nv; j++) {
      const a = i * (nv + 1) + j;
      const b = (i + 1) * (nv + 1) + j;
      const c = (i + 1) * (nv + 1) + (j + 1);
      const d = i * (nv + 1) + (j + 1);

      indices.push(a, b, d);
      indices.push(b, c, d);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices);

  return {
    geometry,
    plotType: 'parametric',
    formulaLabel: options.title || `r(u, v) = (${options.xUV || 'x'}, ${options.yUV || 'y'}, ${options.zUV || 'z'})`,
    bounds: {
      min: [-maxExtent, -maxExtent, minZ],
      max: [maxExtent, maxExtent, maxZ],
    },
  };
}
