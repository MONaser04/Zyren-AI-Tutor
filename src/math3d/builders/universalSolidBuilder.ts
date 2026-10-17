import * as THREE from 'three';
import type { Math3DOptions, Math3DGeometryResult } from '../types';
import { getNeonColor, extractGridResolution } from '../compiler';
import { compileUniversalSDF, isCubicCrossTerm } from '../astParser';
import { marchCubes } from '../marchingCubes/marchingCubes';

/**
 * Universal Volumetric 3D Solid Engine
 *
 * Employs AST Mathematical Parsing and the Marching Cubes Algorithm (Dynamic Grid Resolution [24..150])
 * to generate 100% shape-agnostic, watertight, manifold 3D meshes with exact analytical gradient normals
 * for any arbitrary 3D spatial inequalities F(x, y, z) <= 0 or bounded systems (Genus-0, Genus-1+, etc.).
 */
export function buildUniversalSolidMesh(options: Math3DOptions): Math3DGeometryResult {
  // 1. Compile arbitrary mathematical inputs into an implicit scalar field SDF F(x, y, z) <= 0
  const sdf = compileUniversalSDF(options);
  const colorTheme = options.colorTheme || 'cyan_orange';

  // 2. Dynamic Grid Resolution Extraction & Memory Safety Clamp
  // Priority: options.gridResolution -> options.resolution -> NLP extraction from text/title -> default (80)
  const combinedText = [
    options.title || '',
    options.equationZ || '',
    options.domainMask || '',
  ].join(' ');

  const isCubic = isCubicCrossTerm(combinedText);

  let rawRes: number = isCubic ? 90 : 80;
  if (typeof options.gridResolution === 'number' && !isNaN(options.gridResolution)) {
    rawRes = options.gridResolution;
  } else if (typeof options.resolution === 'number' && !isNaN(options.resolution)) {
    rawRes = options.resolution;
  } else {
    rawRes = extractGridResolution(combinedText, isCubic ? 90 : 80);
  }

  // Memory safety clamp strictly between 24 and 140 to prevent WebGL OOM crashes
  const gridResolution = Math.min(140, Math.max(24, Math.round(rawRes)));

  // 3. Adaptive 2-Pass Bounding Box Discovery with Tight Watertight Padding
  let xMin: number, xMax: number, yMin: number, yMax: number, zMin: number, zMax: number;

  // Initial scanning domain
  const boundHint = sdf.suggestedBounds;
  const coarseMin = boundHint ? boundHint.xRange[0] : (isCubic ? -1.4 : -8.0);
  const coarseMax = boundHint ? boundHint.xRange[1] : (isCubic ? 1.4 : 8.0);
  const coarseRes = 36;
  const coarseStep = (coarseMax - coarseMin) / coarseRes;

  let cFoundMinX = Infinity, cFoundMaxX = -Infinity;
  let cFoundMinY = Infinity, cFoundMaxY = -Infinity;
  let cFoundMinZ = Infinity, cFoundMaxZ = -Infinity;
  let coarseInsideCount = 0;

  for (let ix = 0; ix <= coarseRes; ix++) {
    const sx = coarseMin + ix * coarseStep;
    for (let iy = 0; iy <= coarseRes; iy++) {
      const sy = coarseMin + iy * coarseStep;
      for (let iz = 0; iz <= coarseRes; iz++) {
        const sz = coarseMin + iz * coarseStep;
        if (sdf.evaluate(sx, sy, sz) <= 0) {
          coarseInsideCount++;
          if (sx < cFoundMinX) cFoundMinX = sx;
          if (sx > cFoundMaxX) cFoundMaxX = sx;
          if (sy < cFoundMinY) cFoundMinY = sy;
          if (sy > cFoundMaxY) cFoundMaxY = sy;
          if (sz < cFoundMinZ) cFoundMinZ = sz;
          if (sz > cFoundMaxZ) cFoundMaxZ = sz;
        }
      }
    }
  }

  if (coarseInsideCount > 0 && isFinite(cFoundMinX)) {
    // --- Pass 2: Fine refinement scan ---
    // Expand the coarse bounds by one coarse step, then rescan at 2× resolution
    const fineMargin = coarseStep * 1.5;
    const fMin = [cFoundMinX - fineMargin, cFoundMinY - fineMargin, cFoundMinZ - fineMargin];
    const fMax = [cFoundMaxX + fineMargin, cFoundMaxY + fineMargin, cFoundMaxZ + fineMargin];
    const fineRes = 40;

    let rFoundMinX = Infinity, rFoundMaxX = -Infinity;
    let rFoundMinY = Infinity, rFoundMaxY = -Infinity;
    let rFoundMinZ = Infinity, rFoundMaxZ = -Infinity;

    const fStepX = (fMax[0] - fMin[0]) / fineRes;
    const fStepY = (fMax[1] - fMin[1]) / fineRes;
    const fStepZ = (fMax[2] - fMin[2]) / fineRes;

    for (let ix = 0; ix <= fineRes; ix++) {
      const sx = fMin[0] + ix * fStepX;
      for (let iy = 0; iy <= fineRes; iy++) {
        const sy = fMin[1] + iy * fStepY;
        for (let iz = 0; iz <= fineRes; iz++) {
          const sz = fMin[2] + iz * fStepZ;
          if (sdf.evaluate(sx, sy, sz) <= 0) {
            if (sx < rFoundMinX) rFoundMinX = sx;
            if (sx > rFoundMaxX) rFoundMaxX = sx;
            if (sy < rFoundMinY) rFoundMinY = sy;
            if (sy > rFoundMaxY) rFoundMaxY = sy;
            if (sz < rFoundMinZ) rFoundMinZ = sz;
            if (sz > rFoundMaxZ) rFoundMaxZ = sz;
          }
        }
      }
    }

    // Use refined bounds if available, otherwise fall back to coarse bounds
    const bMinX = isFinite(rFoundMinX) ? rFoundMinX : cFoundMinX;
    const bMaxX = isFinite(rFoundMaxX) ? rFoundMaxX : cFoundMaxX;
    const bMinY = isFinite(rFoundMinY) ? rFoundMinY : cFoundMinY;
    const bMaxY = isFinite(rFoundMaxY) ? rFoundMaxY : cFoundMaxY;
    const bMinZ = isFinite(rFoundMinZ) ? rFoundMinZ : cFoundMinZ;
    const bMaxZ = isFinite(rFoundMaxZ) ? rFoundMaxZ : cFoundMaxZ;

    // Tight padding: compute the expected voxel step size and pad by ~1.5 steps
    // This is the minimum needed for Marching Cubes to place the cutting plane
    // INSIDE the grid and generate watertight capped faces.
    const spanX = bMaxX - bMinX || 1;
    const spanY = bMaxY - bMinY || 1;
    const spanZ = bMaxZ - bMinZ || 1;
    const maxSpanForStep = Math.max(spanX, spanY, spanZ);
    const estimatedVoxelStep = maxSpanForStep / gridResolution;
    const minPad = estimatedVoxelStep * 2.0; // At least 2 voxel steps for watertight caps

    const padX = Math.max(minPad, estimatedVoxelStep * 2.5);
    const padY = Math.max(minPad, estimatedVoxelStep * 2.5);
    const padZ = Math.max(minPad, estimatedVoxelStep * 2.5);

    xMin = bMinX - padX;
    xMax = bMaxX + padX;
    yMin = bMinY - padY;
    yMax = bMaxY + padY;
    zMin = bMinZ - padZ;
    zMax = bMaxZ + padZ;
  } else {
    // Fallback: use provided ranges or defaults with small padding
    const def = isCubic ? 1.4 : 3.7;
    xMin = options.xRange?.[0] ?? -def;
    xMax = options.xRange?.[1] ?? def;
    yMin = options.yRange?.[0] ?? -def;
    yMax = options.yRange?.[1] ?? def;
    zMin = options.zRange?.[0] ?? -def;
    zMax = options.zRange?.[1] ?? def;
  }

  // 4. Automatic Smooth Domain Bounding for Non-Compact Implicit Solvers (e.g. Cayley Cubic)
  const maxBound = Math.max(
    Math.abs(xMin), Math.abs(xMax),
    Math.abs(yMin), Math.abs(yMax),
    Math.abs(zMin), Math.abs(zMax),
    isCubic ? 1.4 : 3.5
  );
  const maxR2 = isCubic ? 3.35 : (maxBound * 0.95) ** 2;
  const clampedEvalSDF = (x: number, y: number, z: number): number => {
    const rawF = sdf.evaluate(x, y, z);
    const r2 = x * x + y * y + z * z;
    return Math.max(rawF, (r2 - maxR2) * 0.5);
  };

  // 5. Marching Cubes Volumetric Meshing with Dynamic Grid Resolution & Watertight Boundary Guard
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

  // 4. Compute true isotropic scaling factor (1:1:1 aspect ratio across all axes)
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

  // Transform coordinates to Three.js Cartesian space:
  // Math X -> Three.js X
  // Math Y -> Three.js -Z
  // Math Z -> Three.js Y (Height)
  const scaledPositions = new Float32Array(rawPositions.length);
  const transformedNormals = new Float32Array(rawNormals.length);
  const colors = new Float32Array(rawPositions.length);

  const rangeZ = mcResult.maxZ - mcResult.minZ || 1.0;

  for (let v = 0; v < vertCount; v++) {
    const idx = v * 3;
    const mx = rawPositions[idx];
    const my = rawPositions[idx + 1];
    const mz = rawPositions[idx + 2];

    // Position mapping
    scaledPositions[idx] = mx * scale;
    scaledPositions[idx + 1] = mz * scale;     // Height in Three.js
    scaledPositions[idx + 2] = -my * scale;    // Depth in Three.js

    // Normal mapping
    const nx = rawNormals[idx];
    const ny = rawNormals[idx + 1];
    const nz = rawNormals[idx + 2];
    transformedNormals[idx] = nx;
    transformedNormals[idx + 1] = nz;
    transformedNormals[idx + 2] = -ny;

    // Neon height gradient color
    const normZ = Math.max(0, Math.min(1, (mz - mcResult.minZ) / rangeZ));
    const c = getNeonColor(normZ, colorTheme);
    colors[idx] = c.r;
    colors[idx + 1] = c.g;
    colors[idx + 2] = c.b;
  }

  // 5. Build Three.js BufferGeometry
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(scaledPositions, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(transformedNormals, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

  return {
    geometry,
    plotType: 'bounded_surfaces',
    formulaLabel: sdf.formulaLabel,
    bounds: {
      min: [xMin, yMin, mcResult.minZ],
      max: [xMax, yMax, mcResult.maxZ],
    },
  };
}
