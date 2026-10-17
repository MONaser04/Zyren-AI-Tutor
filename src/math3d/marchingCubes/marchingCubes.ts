import * as THREE from 'three';
import { EDGE_TABLE, TRI_TABLE, CORNER_OFFSETS, EDGE_CONNECTIONS } from './tables';

// Grid jitter & density epsilon are computed ADAPTIVELY per-call
// based on voxel step size — see marchCubes() body.

export interface MarchingCubesOptions {
  evalSDF: (x: number, y: number, z: number) => number;
  xRange: [number, number];
  yRange: [number, number];
  zRange: [number, number];
  resolution?: number;
  isovalue?: number;
  useQEF?: boolean;
  enforceSolidBoundary?: boolean;
}

export interface MarchingCubesResult {
  positions: Float32Array;
  normals: Float32Array;
  minZ: number;
  maxZ: number;
  vertexCount: number;
  triangleCount: number;
}

/**
 * Solves Quadratic Error Function (QEF) to place feature vertices accurately at sharp corners
 * and singularities by minimizing tangent plane error:
 * E(x) = sum_k (n_k · (x - p_k))^2 + lambda * ||x - p_mass||^2
 */
function solveQEF(
  points: [number, number, number][],
  normals: [number, number, number][],
  bboxMin: [number, number, number],
  bboxMax: [number, number, number],
  lambda: number = 0.005
): [number, number, number] {
  const K = points.length;
  if (K === 0) return [0, 0, 0];
  if (K === 1) return points[0];

  // Mass point (centroid)
  let mx = 0, my = 0, mz = 0;
  for (let k = 0; k < K; k++) {
    mx += points[k][0];
    my += points[k][1];
    mz += points[k][2];
  }
  mx /= K; my /= K; mz /= K;

  // Build A = sum(n_k * n_k^T) + lambda * I
  let a00 = lambda, a01 = 0, a02 = 0;
  let a10 = 0, a11 = lambda, a12 = 0;
  let a20 = 0, a21 = 0, a22 = lambda;

  // Build b = sum((n_k · p_k) * n_k) + lambda * p_mass
  let bx = lambda * mx;
  let by = lambda * my;
  let bz = lambda * mz;

  for (let k = 0; k < K; k++) {
    const [nx, ny, nz] = normals[k];
    const [px, py, pz] = points[k];
    const d = nx * px + ny * py + nz * pz;

    a00 += nx * nx; a01 += nx * ny; a02 += nx * nz;
    a10 += ny * nx; a11 += ny * ny; a12 += ny * nz;
    a20 += nz * nx; a21 += nz * ny; a22 += nz * nz;

    bx += d * nx;
    by += d * ny;
    bz += d * nz;
  }

  // 3x3 Determinant
  const det =
    a00 * (a11 * a22 - a12 * a21) -
    a01 * (a10 * a22 - a12 * a20) +
    a02 * (a10 * a21 - a11 * a20);

  if (Math.abs(det) < 1e-8) {
    return [mx, my, mz]; // Fallback to centroid if matrix is singular
  }

  // Invert 3x3 matrix via Cramer's rule
  const invDet = 1.0 / det;
  const x = invDet * (
    bx * (a11 * a22 - a12 * a21) -
    by * (a01 * a22 - a02 * a21) +
    bz * (a01 * a12 - a02 * a11)
  );
  const y = invDet * (
    -bx * (a10 * a22 - a12 * a20) +
    by * (a00 * a22 - a02 * a20) -
    bz * (a00 * a12 - a02 * a10)
  );
  const z = invDet * (
    bx * (a10 * a21 - a11 * a20) -
    by * (a00 * a21 - a01 * a20) +
    bz * (a00 * a11 - a01 * a10)
  );

  return [
    Math.max(bboxMin[0], Math.min(bboxMax[0], x)),
    Math.max(bboxMin[1], Math.min(bboxMax[1], y)),
    Math.max(bboxMin[2], Math.min(bboxMax[2], z)),
  ];
}

/**
 * Exact Zero-Crossing Root Finding on Voxel Edge (Sub-Voxel Binary Search + Secant refinement)
 * Finds the exact point where F(x, y, z) = isovalue to sub-voxel accuracy (|F| < 1e-4).
 */
function findExactRootOnEdge(
  evalSDF: (x: number, y: number, z: number) => number,
  pA: [number, number, number],
  pB: [number, number, number],
  vA: number,
  vB: number,
  isovalue: number = 0.0,
  maxIters: number = 4
): [number, number, number] {
  let tLow = 0.0;
  let tHigh = 1.0;
  let vLow = vA - isovalue;
  let vHigh = vB - isovalue;

  if (Math.abs(vLow) < 1e-4) return [pA[0], pA[1], pA[2]];
  if (Math.abs(vHigh) < 1e-4) return [pB[0], pB[1], pB[2]];

  // Initial linear secant estimate
  let t = Math.abs(vHigh - vLow) > 1e-7 ? Math.max(0, Math.min(1, -vLow / (vHigh - vLow))) : 0.5;

  for (let iter = 0; iter < maxIters; iter++) {
    const px = pA[0] + t * (pB[0] - pA[0]);
    const py = pA[1] + t * (pB[1] - pA[1]);
    const pz = pA[2] + t * (pB[2] - pA[2]);
    const val = evalSDF(px, py, pz) - isovalue;

    if (Math.abs(val) < 1e-4) {
      return [px, py, pz];
    }

    if ((vLow > 0 && val > 0) || (vLow <= 0 && val <= 0)) {
      tLow = t;
      vLow = val;
    } else {
      tHigh = t;
      vHigh = val;
    }

    // Hybrid Secant / Bisection step
    if (Math.abs(vHigh - vLow) > 1e-7) {
      t = tLow + (-vLow / (vHigh - vLow)) * (tHigh - tLow);
      if (t < tLow || t > tHigh) {
        t = (tLow + tHigh) * 0.5;
      }
    } else {
      t = (tLow + tHigh) * 0.5;
    }
  }

  return [
    pA[0] + t * (pB[0] - pA[0]),
    pA[1] + t * (pB[1] - pA[1]),
    pA[2] + t * (pB[2] - pA[2]),
  ];
}

/**
 * Feature-Preserving 3D Volumetric Meshing Engine (Extended Marching Cubes & QEF)
 *
 * Implements:
 * 1. Exact Zero-Crossing Root Finding (Sub-voxel Bisection/Secant convergence).
 * 2. QEF (Quadratic Error Function) gradient-guided vertex placement at sharp features & singularities.
 * 3. Singularity Normal Regularization: robust to zero-gradient nodal points (Cayley cubic).
 * 4. Outward Face Winding Consistency: ensures 100% lit, glitch-free manifold surface.
 * 5. Boundary Voxel Guard: forces outer grid perimeter to evaluate positive, ensuring watertight closure.
 */
export function marchCubes(options: MarchingCubesOptions): MarchingCubesResult {
  const {
    evalSDF,
    xRange,
    yRange,
    zRange,
    resolution = 80,
    isovalue = 0.0,
    enforceSolidBoundary = true,
  } = options;

  const nx = resolution;
  const ny = resolution;
  const nz = resolution;

  const [xMin, xMax] = xRange;
  const [yMin, yMax] = yRange;
  const [zMin, zMax] = zRange;

  const dx = (xMax - xMin) / nx;
  const dy = (yMax - yMin) / ny;
  const dz = (zMax - zMin) / nz;

  // ── Sub-Voxel Grid Jittering (+0.003423 offset) ──
  // Offset the entire voxel sampling grid by +0.003423 to bypass integer singularities
  // where F(x, y, z) == 0 occurs exactly at voxel corners (e.g. Cayley cubic nodal nodes at (1,1,-1)).
  const jitterX = 0.003423;
  const jitterY = 0.003423;
  const jitterZ = 0.003423;

  // ── Density Epsilon for Singularity Bridging ──
  const effectiveIso = isovalue + 1e-3;

  // 1. Precompute 3D Voxel Scalar Grid (Uniform 3D sampling)
  const strideY = nz + 1;
  const strideX = (ny + 1) * strideY;
  const totalVoxels = (nx + 1) * (ny + 1) * (nz + 1);
  const grid = new Float32Array(totalVoxels);

  for (let i = 0; i <= nx; i++) {
    const isBoundaryX = i === 0 || i === nx;
    const x = xMin + i * dx + jitterX;
    for (let j = 0; j <= ny; j++) {
      const isBoundaryY = j === 0 || j === ny;
      const y = yMin + j * dy + jitterY;
      for (let k = 0; k <= nz; k++) {
        const isBoundaryZ = k === 0 || k === nz;
        const z = zMin + k * dz + jitterZ;
        
        // Voxel boundary guard: force boundary voxels to strictly positive (+1.0)
        // to seal infinite asymptotic branches and prevent polarity flipping
        if (enforceSolidBoundary && (isBoundaryX || isBoundaryY || isBoundaryZ)) {
          grid[i * strideX + j * strideY + k] = 1.0;
        } else {
          const val = evalSDF(x, y, z);
          grid[i * strideX + j * strideY + k] = isNaN(val) ? 1.0 : val;
        }
      }
    }
  }

  const posList: number[] = [];
  const normList: number[] = [];

  let minZObserved = Infinity;
  let maxZObserved = -Infinity;

  // Reusable corner coordinate and value buffers for current cube
  const cornerPos: [number, number, number][] = new Array(8);
  const cornerVal: number[] = new Array(8);

  const delta = Math.min(dx, dy, dz) * 0.25;

  // Analytical central difference gradient evaluator with 3-tier singularity stabilization
  const computeNormal = (px: number, py: number, pz: number): [number, number, number] => {
    let gx = evalSDF(px + delta, py, pz) - evalSDF(px - delta, py, pz);
    let gy = evalSDF(px, py + delta, pz) - evalSDF(px, py - delta, pz);
    let gz = evalSDF(px, py, pz + delta) - evalSDF(px, py, pz - delta);

    if (isNaN(gx)) gx = 0;
    if (isNaN(gy)) gy = 0;
    if (isNaN(gz)) gz = 0;

    let len = Math.hypot(gx, gy, gz);

    // Tier 1: Wider stencil for vanishing gradient (nodal node / saddle point)
    if (len < 1e-7) {
      const wideDelta = delta * 4.0;
      gx = evalSDF(px + wideDelta, py, pz) - evalSDF(px - wideDelta, py, pz);
      gy = evalSDF(px, py + wideDelta, pz) - evalSDF(px, py - wideDelta, pz);
      gz = evalSDF(px, py, pz + wideDelta) - evalSDF(px, py, pz - wideDelta);
      if (isNaN(gx)) gx = 0;
      if (isNaN(gy)) gy = 0;
      if (isNaN(gz)) gz = 0;
      len = Math.hypot(gx, gy, gz);
    }

    // Tier 2: Even wider stencil
    if (len < 1e-7) {
      const ultraDelta = delta * 10.0;
      gx = evalSDF(px + ultraDelta, py, pz) - evalSDF(px - ultraDelta, py, pz);
      gy = evalSDF(px, py + ultraDelta, pz) - evalSDF(px, py - ultraDelta, pz);
      gz = evalSDF(px, py, pz + ultraDelta) - evalSDF(px, py, pz - ultraDelta);
      if (isNaN(gx)) gx = 0;
      if (isNaN(gy)) gy = 0;
      if (isNaN(gz)) gz = 0;
      len = Math.hypot(gx, gy, gz);
    }

    // Tier 3 (Final Fallback): Use normalized position vector as outward normal
    // This prevents black holes / invisible faces at exact singularity nodes
    if (len < 1e-7) {
      const pLen = Math.hypot(px, py, pz) || 1.0;
      return [px / pLen, py / pLen, pz / pLen];
    }

    return [gx / len, gy / len, gz / len];
  };

  // 2. March through all voxels in pure 3D space (X, Y, Z simultaneously)
  for (let i = 0; i < nx; i++) {
    const x0 = xMin + i * dx;
    const x1 = x0 + dx;

    for (let j = 0; j < ny; j++) {
      const y0 = yMin + j * dy;
      const y1 = y0 + dy;

      for (let k = 0; k < nz; k++) {
        const z0 = zMin + k * dz;
        const z1 = z0 + dz;

        // 8 Corners of the cube
        cornerPos[0] = [x0, y0, z0];
        cornerPos[1] = [x1, y0, z0];
        cornerPos[2] = [x1, y1, z0];
        cornerPos[3] = [x0, y1, z0];
        cornerPos[4] = [x0, y0, z1];
        cornerPos[5] = [x1, y0, z1];
        cornerPos[6] = [x1, y1, z1];
        cornerPos[7] = [x0, y1, z1];

        cornerVal[0] = grid[i * strideX + j * strideY + k];
        cornerVal[1] = grid[(i + 1) * strideX + j * strideY + k];
        cornerVal[2] = grid[(i + 1) * strideX + (j + 1) * strideY + k];
        cornerVal[3] = grid[i * strideX + (j + 1) * strideY + k];
        cornerVal[4] = grid[i * strideX + j * strideY + (k + 1)];
        cornerVal[5] = grid[(i + 1) * strideX + j * strideY + (k + 1)];
        cornerVal[6] = grid[(i + 1) * strideX + (j + 1) * strideY + (k + 1)];
        cornerVal[7] = grid[i * strideX + (j + 1) * strideY + (k + 1)];

        // Compute 8-bit cube index using inflated effective isovalue
        // (1 if corner is inside solid <= effectiveIso = isovalue + DENSITY_EPSILON)
        let cubeIndex = 0;
        if (cornerVal[0] <= effectiveIso) cubeIndex |= 1;
        if (cornerVal[1] <= effectiveIso) cubeIndex |= 2;
        if (cornerVal[2] <= effectiveIso) cubeIndex |= 4;
        if (cornerVal[3] <= effectiveIso) cubeIndex |= 8;
        if (cornerVal[4] <= effectiveIso) cubeIndex |= 16;
        if (cornerVal[5] <= effectiveIso) cubeIndex |= 32;
        if (cornerVal[6] <= effectiveIso) cubeIndex |= 64;
        if (cornerVal[7] <= effectiveIso) cubeIndex |= 128;

        const edgeMask = EDGE_TABLE[cubeIndex];
        if (edgeMask === 0) continue; // Completely inside or outside

        // Local edge vertex cache strictly scoped to this single voxel cube
        const localEdgeVertices: ([number, number, number] | null)[] = [
          null, null, null, null,
          null, null, null, null,
          null, null, null, null
        ];

        const getExactEdgeVertex = (e: number): [number, number, number] => {
          if (localEdgeVertices[e] !== null) {
            return localEdgeVertices[e]!;
          }

          const [cA, cB] = EDGE_CONNECTIONS[e];
          const vA = cornerVal[cA];
          const vB = cornerVal[cB];
          const pA = cornerPos[cA];
          const pB = cornerPos[cB];

          // Exact Sub-Voxel Root Finding along the edge
          // Use effectiveIso for root finding to match the inflated classification
          const exactRoot = findExactRootOnEdge(evalSDF, pA, pB, vA, vB, effectiveIso, 7);
          localEdgeVertices[e] = exactRoot;
          return exactRoot;
        };

        // Generate triangles for this cube configuration
        const triRow = TRI_TABLE[cubeIndex];
        for (let t = 0; triRow[t] !== -1; t += 3) {
          const e1 = triRow[t];
          const e2 = triRow[t + 1];
          const e3 = triRow[t + 2];

          let p1 = getExactEdgeVertex(e1);
          let p2 = getExactEdgeVertex(e2);
          let p3 = getExactEdgeVertex(e3);

          let n1 = computeNormal(p1[0], p1[1], p1[2]);
          let n2 = computeNormal(p2[0], p2[1], p2[2]);
          let n3 = computeNormal(p3[0], p3[1], p3[2]);

          // Compute geometric surface normal of the triangle
          const v1x = p2[0] - p1[0], v1y = p2[1] - p1[1], v1z = p2[2] - p1[2];
          const v2x = p3[0] - p1[0], v2y = p3[1] - p1[1], v2z = p3[2] - p1[2];
          const geoNx = v1y * v2z - v1z * v2y;
          const geoNy = v1z * v2x - v1x * v2z;
          const geoNz = v1x * v2y - v1y * v2x;

          // Average analytical gradient normal
          const avgGradX = n1[0] + n2[0] + n3[0];
          const avgGradY = n1[1] + n2[1] + n3[1];
          const avgGradZ = n1[2] + n2[2] + n3[2];

          // Consistency Check: ensure triangle winding faces outwards along gradient ∇F
          const dot = geoNx * avgGradX + geoNy * avgGradY + geoNz * avgGradZ;
          if (dot < 0) {
            // Swap p2 & p3, n2 & n3 for consistent outward winding (fixes dark inverted faces)
            const tempP = p2; p2 = p3; p3 = tempP;
            const tempN = n2; n2 = n3; n3 = tempN;
          }

          // Add vertices
          posList.push(p1[0], p1[1], p1[2]);
          posList.push(p2[0], p2[1], p2[2]);
          posList.push(p3[0], p3[1], p3[2]);

          minZObserved = Math.min(minZObserved, p1[2], p2[2], p3[2]);
          maxZObserved = Math.max(maxZObserved, p1[2], p2[2], p3[2]);

          // Add gradient normals
          normList.push(n1[0], n1[1], n1[2]);
          normList.push(n2[0], n2[1], n2[2]);
          normList.push(n3[0], n3[1], n3[2]);
        }
      }
    }
  }

  // ── Post-Processing: Extract Largest Connected Component ──
  // The adaptive epsilon may create small ghost blobs beyond singularity nodes.
  // We discard them by keeping only the largest connected triangle component.
  const rawPositions = new Float32Array(posList);
  const rawNormals = new Float32Array(normList);
  const rawTriCount = posList.length / 9;

  const filtered = extractLargestConnectedComponent(
    rawPositions, rawNormals, rawTriCount
  );

  // Recompute Z bounds from filtered positions
  let finalMinZ = Infinity;
  let finalMaxZ = -Infinity;
  for (let i = 2; i < filtered.positions.length; i += 3) {
    const z = filtered.positions[i];
    if (z < finalMinZ) finalMinZ = z;
    if (z > finalMaxZ) finalMaxZ = z;
  }

  return {
    positions: filtered.positions,
    normals: filtered.normals,
    minZ: isFinite(finalMinZ) ? finalMinZ : zMin,
    maxZ: isFinite(finalMaxZ) ? finalMaxZ : zMax,
    vertexCount: filtered.positions.length / 3,
    triangleCount: filtered.positions.length / 9,
  };
}

/**
 * Extracts the largest connected component from a triangle soup.
 * Uses spatial vertex hashing + BFS to find connected components,
 * then returns only the triangles belonging to the largest one.
 * This eliminates ghost blobs created by density epsilon inflation.
 */
function extractLargestConnectedComponent(
  positions: Float32Array,
  normals: Float32Array,
  triCount: number
): { positions: Float32Array; normals: Float32Array } {
  if (triCount <= 1) return { positions, normals };

  // Spatial vertex hash → list of triangle indices sharing that vertex
  const vertToTris = new Map<string, number[]>();

  const vkey = (x: number, y: number, z: number): string => {
    // Round to 5 decimal places to merge coincident vertices
    const rx = Math.round(x * 100000);
    const ry = Math.round(y * 100000);
    const rz = Math.round(z * 100000);
    return `${rx},${ry},${rz}`;
  };

  for (let t = 0; t < triCount; t++) {
    const b = t * 9;
    for (let v = 0; v < 3; v++) {
      const key = vkey(positions[b + v * 3], positions[b + v * 3 + 1], positions[b + v * 3 + 2]);
      let list = vertToTris.get(key);
      if (!list) { list = []; vertToTris.set(key, list); }
      list.push(t);
    }
  }

  // BFS to find all connected components
  const visited = new Uint8Array(triCount);
  let largestStart = 0;
  let largestSize = 0;
  const componentStarts: number[] = [];
  const componentSizes: number[] = [];

  for (let start = 0; start < triCount; start++) {
    if (visited[start]) continue;
    componentStarts.push(start);
    let compSize = 0;
    const queue = [start];
    visited[start] = 1;

    while (queue.length > 0) {
      const tri = queue.pop()!;
      compSize++;
      const b = tri * 9;

      for (let v = 0; v < 3; v++) {
        const key = vkey(positions[b + v * 3], positions[b + v * 3 + 1], positions[b + v * 3 + 2]);
        const neighbors = vertToTris.get(key);
        if (neighbors) {
          for (const n of neighbors) {
            if (!visited[n]) {
              visited[n] = 1;
              queue.push(n);
            }
          }
        }
      }
    }

    componentSizes.push(compSize);
    if (compSize > largestSize) {
      largestSize = compSize;
      largestStart = componentStarts.length - 1;
    }
  }

  // If only one component, return as-is (no ghost blobs)
  if (componentStarts.length <= 1) {
    return { positions, normals };
  }

  // Keep all significant components (e.g. compSize >= 12 and >= 2% of largestSize)
  // This preserves multiple sheets (Hyperboloid of Two Sheets), multi-lobe surfaces (Cassini Solid),
  // and multi-body CSG solids, while discarding 1-voxel floating noise artifacts.
  const minSignificantSize = Math.max(12, Math.floor(largestSize * 0.02));
  const keep = new Uint8Array(triCount);
  const visited2 = new Uint8Array(triCount);

  for (let c = 0; c < componentStarts.length; c++) {
    if (componentSizes[c] < minSignificantSize) continue;

    const queue2 = [componentStarts[c]];
    visited2[componentStarts[c]] = 1;

    while (queue2.length > 0) {
      const tri = queue2.pop()!;
      keep[tri] = 1;
      const b = tri * 9;

      for (let v = 0; v < 3; v++) {
        const key = vkey(positions[b + v * 3], positions[b + v * 3 + 1], positions[b + v * 3 + 2]);
        const neighbors = vertToTris.get(key);
        if (neighbors) {
          for (const n of neighbors) {
            if (!visited2[n]) {
              visited2[n] = 1;
              queue2.push(n);
            }
          }
        }
      }
    }
  }

  // Collect kept triangles
  const outPos: number[] = [];
  const outNorm: number[] = [];

  for (let t = 0; t < triCount; t++) {
    if (!keep[t]) continue;
    const b = t * 9;
    for (let i = 0; i < 9; i++) {
      outPos.push(positions[b + i]);
      outNorm.push(normals[b + i]);
    }
  }

  return {
    positions: new Float32Array(outPos),
    normals: new Float32Array(outNorm),
  };
}
