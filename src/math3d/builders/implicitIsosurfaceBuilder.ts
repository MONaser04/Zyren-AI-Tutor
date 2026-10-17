import * as THREE from 'three';
import type { Math3DOptions, Math3DGeometryResult } from '../types';
import { getNeonColor, extractGridResolution } from '../compiler';
import { cleanMathExpression, SAFE_DIV_CODE, isCubicCrossTerm } from '../astParser';
import { marchCubes } from '../marchingCubes/marchingCubes';

/**
 * Parses an implicit equation string (e.g. "x^2 + y^2 + z^2 = 4" or "x*y + y*z + z*x + x*y*z = 0")
 * into a continuous scalar field function F(x, y, z) whose zero-crossing F(x, y, z) = 0 defines the surface.
 */
export function compileImplicitEquation(rawEquation: string): (x: number, y: number, z: number) => number {
  let clean = rawEquation.trim();
  clean = clean.replace(/≤/g, '<=').replace(/≥/g, '>=');

  let expr = clean;
  // Handle inequality if accidentally passed here
  const ineqMatch = clean.match(/^(.+?)\s*(<=|<|>=|>)\s*(.+)$/);
  if (ineqMatch) {
    const lhs = cleanMathExpression(ineqMatch[1]);
    const rhs = cleanMathExpression(ineqMatch[3]);
    const isLe = ineqMatch[2].startsWith('<');
    expr = isLe ? `(${lhs}) - (${rhs})` : `(${rhs}) - (${lhs})`;
  } else if (clean.includes('=')) {
    // Pure equality L = R
    const eqIdx = clean.indexOf('=');
    const lhs = cleanMathExpression(clean.substring(0, eqIdx));
    const rhs = cleanMathExpression(clean.substring(eqIdx + 1));
    expr = `(${lhs}) - (${rhs})`;
  } else {
    expr = cleanMathExpression(clean);
  }

  try {
    // eslint-disable-next-line no-new-func
    const fn = new Function('x', 'y', 'z', `
      ${SAFE_DIV_CODE}
      try {
        const val = ${expr};
        return isNaN(val) ? 1.0 : val;
      } catch(e) {
        return 1.0;
      }
    `);
    return fn as (x: number, y: number, z: number) => number;
  } catch (err) {
    console.warn('[ImplicitIsosurface] Failed to parse equation:', rawEquation, err);
    return (x, y, z) => x * x + y * y + z * z - 4;
  }
}

/**
 * Dedicated Implicit Isosurface Pipeline: F(x, y, z) = 0
 *
 * Meshes exact implicit isosurfaces (quadrics, tori, algebraic cubics/quartics)
 * via Marching Cubes with sub-voxel root refinement and isotropic scaling.
 */
export function buildImplicitIsosurfaceMesh(options: Math3DOptions): Math3DGeometryResult {
  const equation = options.equationZ || options.title || 'x^2 + y^2 + z^2 = 4';
  const evalSDF = compileImplicitEquation(equation);
  const colorTheme = options.colorTheme || 'cyan_orange';

  const isCubic = isCubicCrossTerm(equation + ' ' + (options.title || ''));

  // Grid Resolution
  const rawRes = options.gridResolution || options.resolution || extractGridResolution(equation, isCubic ? 90 : 80);
  const gridResolution = Math.min(140, Math.max(24, Math.round(rawRes)));

  // Bounding box: default [-1.4, 1.4]^3 for cubic cross-terms (Cayley cubic), [-3.5, 3.5]^3 for standard
  const defBound = isCubic ? 1.4 : 3.5;
  const xMin = options.xRange?.[0] ?? -defBound;
  const xMax = options.xRange?.[1] ?? defBound;
  const yMin = options.yRange?.[0] ?? -defBound;
  const yMax = options.yRange?.[1] ?? defBound;
  const zMin = options.zRange?.[0] ?? -defBound;
  const zMax = options.zRange?.[1] ?? defBound;

  // Automatic Smooth Domain Bounding for Non-Compact Implicit Solvers (e.g. Cayley Cubic)
  const maxBound = Math.max(
    Math.abs(xMin), Math.abs(xMax),
    Math.abs(yMin), Math.abs(yMax),
    Math.abs(zMin), Math.abs(zMax),
    isCubic ? 1.4 : 3.5
  );
  const maxR2 = isCubic ? 3.35 : (maxBound * 0.95) ** 2;
  const clampedEvalSDF = (x: number, y: number, z: number): number => {
    const rawF = evalSDF(x, y, z);
    const r2 = x * x + y * y + z * z;
    return Math.max(rawF, (r2 - maxR2) * 0.5);
  };

  const mcResult = marchCubes({
    evalSDF: clampedEvalSDF,
    xRange: [xMin, xMax],
    yRange: [yMin, yMax],
    zRange: [zMin, zMax],
    resolution: gridResolution,
    isovalue: 0.0,
    enforceSolidBoundary: true,
  });

  const rawPositions = mcResult.positions;
  const rawNormals = mcResult.normals;
  const vertCount = mcResult.vertexCount;

  // True Isotropic 1:1:1 Scaling
  const maxSpan = Math.max(
    xMax - xMin,
    yMax - yMin,
    zMax - zMin,
    Math.abs(xMin) * 2,
    Math.abs(xMax) * 2,
    Math.abs(yMin) * 2,
    Math.abs(yMax) * 2,
    Math.abs(zMin) * 2,
    Math.abs(zMax) * 2,
    1.0
  );
  const scale = Math.min(1.0, 3.4 / (maxSpan * 0.5));

  const scaledPositions = new Float32Array(rawPositions.length);
  const transformedNormals = new Float32Array(rawNormals.length);
  const colors = new Float32Array(rawPositions.length);

  const rangeZ = mcResult.maxZ - mcResult.minZ || 1.0;

  for (let v = 0; v < vertCount; v++) {
    const idx = v * 3;
    const mx = rawPositions[idx];
    const my = rawPositions[idx + 1];
    const mz = rawPositions[idx + 2];

    // Math X -> Three.js X
    // Math Y -> Three.js -Z
    // Math Z -> Three.js Y
    scaledPositions[idx] = mx * scale;
    scaledPositions[idx + 1] = mz * scale;
    scaledPositions[idx + 2] = -my * scale;

    const nx = rawNormals[idx];
    const ny = rawNormals[idx + 1];
    const nz = rawNormals[idx + 2];
    transformedNormals[idx] = nx;
    transformedNormals[idx + 1] = nz;
    transformedNormals[idx + 2] = -ny;

    const normZ = Math.max(0, Math.min(1, (mz - mcResult.minZ) / rangeZ));
    const c = getNeonColor(normZ, colorTheme);
    colors[idx] = c.r;
    colors[idx + 1] = c.g;
    colors[idx + 2] = c.b;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(scaledPositions, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(transformedNormals, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

  return {
    geometry,
    plotType: 'implicit_isosurface',
    formulaLabel: equation,
    bounds: {
      min: [xMin, yMin, mcResult.minZ],
      max: [xMax, yMax, mcResult.maxZ],
    },
  };
}
