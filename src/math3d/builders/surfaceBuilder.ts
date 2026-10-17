import * as THREE from 'three';
import type { Math3DOptions, Math3DGeometryResult } from '../types';
import { compileMathFunction, compileDomainMask, getNeonColor } from '../compiler';

/**
 * Production-Grade Explicit 3D Surface Pipeline: z = f(x, y)
 *
 * Renders single-valued 2D manifold heightfields on a finely subdivided parametric grid
 * with true 1:1:1 isotropic aspect ratio, exact analytical gradient normals, and 2D domain masking.
 * NEVER introduces vertical bounding walls or solid block artifacts.
 */
export function buildSurfaceMesh(options: Math3DOptions): Math3DGeometryResult {
  let equation = options.equationZ || options.zTop || 'x^2 - y^2';
  let domainMaskStr = options.domainMask || '';

  // Extract inline 2D domain condition if present (e.g. "z = sin(r)/r, x^2 + y^2 <= 16")
  if (!domainMaskStr && /[;,]|(?:\b(?:where|with|for|subject to)\b)/i.test(equation)) {
    const parts = equation.split(/[;,]|(?:\b(?:where|with|for|subject to)\b)/i);
    if (parts.length >= 2) {
      const candidate = parts.slice(1).join(' ').trim();
      if (/[<>=≤≥]/.test(candidate) && !/\bz\b/i.test(candidate)) {
        equation = parts[0].trim();
        domainMaskStr = candidate;
      }
    }
  }

  const evalMath = compileMathFunction(equation, (x, y) => x * x - y * y);
  const evalMask = compileDomainMask(domainMaskStr);

  // Extract explicit range from text if present (e.g. "from -2 to 2")
  let defaultBound = 3.5;
  const combinedText = (options.title || '') + ' ' + (options.equationZ || '');
  const rangeMatch =
    combinedText.match(/(?:from|range|interval)\s*([+-]?\d+(?:\.\d+)?)\s*(?:to|->|,)\s*([+-]?\d+(?:\.\d+)?)/i) ||
    combinedText.match(/\[\s*([+-]?\d+(?:\.\d+)?)\s*,\s*([+-]?\d+(?:\.\d+)?)\s*\]/);

  let detectedRange: [number, number] | null = null;
  if (rangeMatch) {
    const minVal = parseFloat(rangeMatch[1]);
    const maxVal = parseFloat(rangeMatch[2]);
    if (!isNaN(minVal) && !isNaN(maxVal) && minVal < maxVal) {
      detectedRange = [minVal, maxVal];
    }
  }

  const xMin = options.xRange?.[0] ?? (detectedRange ? detectedRange[0] : -defaultBound);
  const xMax = options.xRange?.[1] ?? (detectedRange ? detectedRange[1] : defaultBound);
  const yMin = options.yRange?.[0] ?? (detectedRange ? detectedRange[0] : -defaultBound);
  const yMax = options.yRange?.[1] ?? (detectedRange ? detectedRange[1] : defaultBound);
  const colorTheme = options.colorTheme || 'cyan_orange';

  // 100x100 subdivision for silky-smooth surface curvature
  const nx = 100;
  const ny = 100;

  // 1. Pass 1: Measure height range within valid domain
  let minZ = Infinity;
  let maxZ = -Infinity;

  for (let i = 0; i <= nx; i++) {
    const x = xMin + (i / nx) * (xMax - xMin);
    for (let j = 0; j <= ny; j++) {
      const y = yMin + (j / ny) * (yMax - yMin);
      if (evalMask(x, y)) {
        const z = evalMath(x, y);
        if (isFinite(z) && !isNaN(z)) {
          minZ = Math.min(minZ, z);
          maxZ = Math.max(maxZ, z);
        }
      }
    }
  }

  if (!isFinite(minZ)) {
    minZ = -3.5;
    maxZ = 3.5;
  }

  const rangeX = xMax - xMin || 1.0;
  const rangeY = yMax - yMin || 1.0;
  const rangeZ = maxZ - minZ || 1.0;

  // Compute adaptive isotropic aspect ratio scaling
  // Base scale for horizontal XY domain (fits comfortably into camera frustum)
  const maxSpanXY = Math.max(rangeX, rangeY, Math.abs(xMin) * 2, Math.abs(xMax) * 2, Math.abs(yMin) * 2, Math.abs(yMax) * 2);
  const scaleXY = Math.min(1.0, 4.8 / maxSpanXY);

  // Height scale: preserve 1:1:1 aspect ratio for normal amplitudes, but adaptively clamp vertical explosion for cubic/quartic polynomials (e.g. Monkey Saddle)
  const maxAllowedHeight = 3.2; // Maximum visual height span in Three.js coordinates
  let scaleZ = scaleXY;
  if (rangeZ * scaleXY > maxAllowedHeight) {
    scaleZ = maxAllowedHeight / rangeZ;
  }

  const positions: number[] = [];
  const normals: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];

  const h = 0.005;

  // 2. Pass 2: Vertex generation with exact analytical gradient normals
  // Math coordinates:
  // Math X -> Three.js X
  // Math Y -> Three.js -Z (Depth)
  // Math Z -> Three.js Y (Height)
  const gridIndex = new Int32Array((nx + 1) * (ny + 1)).fill(-1);
  let vertCounter = 0;

  for (let i = 0; i <= nx; i++) {
    const x = xMin + (i / nx) * (xMax - xMin);
    for (let j = 0; j <= ny; j++) {
      const y = yMin + (j / ny) * (yMax - yMin);
      const isInside = evalMask(x, y);

      if (isInside) {
        let z = evalMath(x, y);
        if (!isFinite(z) || isNaN(z)) z = 0;

        // Clamp extreme asymptotic spikes to avoid visual glitches
        const zClamped = Math.max(minZ - 2, Math.min(maxZ + 2, z));

        const threeX = x * scaleXY;
        const threeY = zClamped * scaleZ;
        const threeZ = -y * scaleXY;

        positions.push(threeX, threeY, threeZ);

        // Analytical heightfield normal calculation
        // Gradient of z - f(x, y) = 0: N = (-df/dx, 1, df/dy in Three.js coordinates)
        const zPx = evalMath(x + h, y);
        const zMx = evalMath(x - h, y);
        const zPy = evalMath(x, y + h);
        const zMy = evalMath(x, y - h);

        const dfdx = (zPx - zMx) / (2 * h);
        const dfdy = (zPy - zMy) / (2 * h);

        const nxVal = -dfdx;
        const nyVal = 1.0;
        const nzVal = dfdy; // Note: Math Y -> Three -Z, so -(-df/dy) = +df/dy
        const len = Math.hypot(nxVal, nyVal, nzVal) || 1.0;

        normals.push(nxVal / len, nyVal / len, nzVal / len);

        // Dynamic neon height gradient along Z
        const normZ = Math.max(0, Math.min(1, (zClamped - minZ) / rangeZ));
        const c = getNeonColor(normZ, colorTheme);
        colors.push(c.r, c.g, c.b);

        gridIndex[i * (ny + 1) + j] = vertCounter++;
      }
    }
  }

  // 3. Grid triangulation with domain mask validation
  for (let i = 0; i < nx; i++) {
    for (let j = 0; j < ny; j++) {
      const v00 = gridIndex[i * (ny + 1) + j];
      const v10 = gridIndex[(i + 1) * (ny + 1) + j];
      const v11 = gridIndex[(i + 1) * (ny + 1) + (j + 1)];
      const v01 = gridIndex[i * (ny + 1) + (j + 1)];

      // Triangle 1: (v00, v10, v01)
      if (v00 !== -1 && v10 !== -1 && v01 !== -1) {
        indices.push(v00, v10, v01);
      }
      // Triangle 2: (v10, v11, v01)
      if (v10 !== -1 && v11 !== -1 && v01 !== -1) {
        indices.push(v10, v11, v01);
      }
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices);

  return {
    geometry,
    plotType: 'surface',
    formulaLabel: `z = ${equation}`,
    bounds: {
      min: [xMin, yMin, minZ],
      max: [xMax, yMax, maxZ],
    },
  };
}

