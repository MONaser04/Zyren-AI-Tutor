import * as THREE from 'three';
import * as math from 'mathjs';
import type { Math3DOptions, Math3DGeometryResult } from '../types';
import { getNeonColor } from '../compiler';
import { transformASTtoSDF, sanitizeMathString, estimateBoundsFromText } from '../astParser';

/**
 * Builds a 3D Linear Extruded Solid from any arbitrary 2D CSG Bounded Region along the Z-axis
 * Powered by mathjs AST Traversal & Constructive Solid Geometry (CSG) R-Functions.
 */
export function buildLinearExtrusionMesh(options: Math3DOptions): Math3DGeometryResult {
  // Construct raw base expression from options
  let rawBase = options.domainMask || options.equationZ;
  if (!rawBase && options.fTop && options.fBottom) {
    rawBase = `(y <= ${options.fTop}) and (y >= ${options.fBottom})`;
  } else if (!rawBase && options.fTop) {
    rawBase = `(y <= ${options.fTop}) and (y >= 0)`;
  }
  rawBase = rawBase || 'x^2 + y^2 <= 4';

  const cleanBase = sanitizeMathString(rawBase);
  const parsedAST = math.parse(cleanBase);
  const sdfAST = transformASTtoSDF(parsedAST);
  const compiled = sdfAST.compile();

  const evalBase = (x: number, y: number): number => {
    try {
      const val = compiled.evaluate({ x, y, z: 0, u: x, v: y, t: 0 });
      return typeof val === 'number' && !isNaN(val) && isFinite(val) ? val : 1.0;
    } catch (e) {
      return 1.0;
    }
  };

  // Determine dynamic bounding box
  const suggested = estimateBoundsFromText(cleanBase);
  const xMin = options.xRange?.[0] ?? suggested.xRange[0];
  const xMax = options.xRange?.[1] ?? suggested.xRange[1];
  const yMin = options.yRange?.[0] ?? suggested.yRange[0];
  const yMax = options.yRange?.[1] ?? suggested.yRange[1];
  const zMin = options.zRange?.[0] ?? 0;
  const zMax = options.zRange?.[1] ?? (zMin + 4);

  const depth = Math.abs(zMax - zMin) || 1.0;
  const colorTheme = options.colorTheme || 'cyan_orange';

  const Nx = 80;
  const Ny = 80;
  const dx = (xMax - xMin) / Nx;
  const dy = (yMax - yMin) / Ny;

  // Grid evaluation of scalar field
  const gridF: number[][] = [];
  for (let i = 0; i <= Nx; i++) {
    gridF[i] = [];
    const x = xMin + i * dx;
    for (let j = 0; j <= Ny; j++) {
      const y = yMin + j * dy;
      gridF[i][j] = evalBase(x, y);
    }
  }

  const isInside = (i: number, j: number): boolean => {
    if (i < 0 || i >= Nx || j < 0 || j >= Ny) return false;
    const xMid = xMin + (i + 0.5) * dx;
    const yMid = yMin + (j + 0.5) * dy;
    return evalBase(xMid, yMid) <= 0 || (gridF[i][j] <= 0 && gridF[i + 1][j + 1] <= 0);
  };

  const positions: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];
  let vertCount = 0;

  // Compute coordinate normalizers
  const maxDimXY = Math.max(Math.abs(xMin), Math.abs(xMax), Math.abs(yMin), Math.abs(yMax), 1.0);
  const xyScale = Math.min(1.0, 3.2 / maxDimXY);
  const zHeight = 3.6;
  const zScale = zHeight / depth;

  const addVertex = (xMath: number, yMath: number, zMath: number) => {
    // Math X -> Three.js X
    // Math Y -> Three.js -Z
    // Math Z -> Three.js Y (grounded at zMin)
    const threeX = xMath * xyScale;
    const threeZ = -yMath * xyScale;
    const threeY = (zMath - zMin) * zScale;

    positions.push(threeX, threeY, threeZ);

    const normH = Math.max(0, Math.min(1, (zMath - zMin) / depth));
    const c = getNeonColor(normH, colorTheme);
    colors.push(c.r, c.g, c.b);
  };

  const addQuad = (
    p1: [number, number, number],
    p2: [number, number, number],
    p3: [number, number, number],
    p4: [number, number, number]
  ) => {
    const idx = vertCount;
    addVertex(...p1);
    addVertex(...p2);
    addVertex(...p3);
    addVertex(...p4);

    indices.push(idx, idx + 1, idx + 2);
    indices.push(idx, idx + 2, idx + 3);
    vertCount += 4;
  };

  for (let i = 0; i < Nx; i++) {
    const x0 = xMin + i * dx;
    const x1 = x0 + dx;
    for (let j = 0; j < Ny; j++) {
      if (!isInside(i, j)) continue;

      const y0 = yMin + j * dy;
      const y1 = y0 + dy;

      // 1. Top Cap (z = zMax, normal +Z)
      addQuad(
        [x0, y0, zMax],
        [x1, y0, zMax],
        [x1, y1, zMax],
        [x0, y1, zMax]
      );

      // 2. Bottom Cap (z = zMin, normal -Z)
      addQuad(
        [x0, y1, zMin],
        [x1, y1, zMin],
        [x1, y0, zMin],
        [x0, y0, zMin]
      );

      // 3. Side Walls along boundary (outward-facing)
      // South edge (j-1 outside)
      if (!isInside(i, j - 1)) {
        addQuad(
          [x0, y0, zMin],
          [x1, y0, zMin],
          [x1, y0, zMax],
          [x0, y0, zMax]
        );
      }
      // North edge (j+1 outside)
      if (!isInside(i, j + 1)) {
        addQuad(
          [x1, y1, zMin],
          [x0, y1, zMin],
          [x0, y1, zMax],
          [x1, y1, zMax]
        );
      }
      // West edge (i-1 outside)
      if (!isInside(i - 1, j)) {
        addQuad(
          [x0, y1, zMin],
          [x0, y0, zMin],
          [x0, y0, zMax],
          [x0, y1, zMax]
        );
      }
      // East edge (i+1 outside)
      if (!isInside(i + 1, j)) {
        addQuad(
          [x1, y0, zMin],
          [x1, y1, zMin],
          [x1, y1, zMax],
          [x1, y0, zMax]
        );
      }
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();

  return {
    geometry,
    plotType: 'linear_extrusion',
    formulaLabel: options.title || `Extruded [${rawBase}] | z ∈ [${zMin}, ${zMax}]`,
    bounds: {
      min: [xMin, yMin, zMin],
      max: [xMax, yMax, zMax],
    },
  };
}
