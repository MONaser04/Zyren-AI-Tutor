import * as THREE from 'three';
import * as math from 'mathjs';
import type { Math3DOptions, Math3DGeometryResult } from '../types';
import { getNeonColor } from '../compiler';
import { sanitizeMathString } from '../astParser';

function compileCurveFunction(rawExpr: string, fallback: (t: number) => number): (t: number) => number {
  const clean = sanitizeMathString(rawExpr);
  try {
    const compiled = math.compile(clean);
    return (t: number) => {
      try {
        const val = compiled.evaluate({ x: t, y: t, z: t, u: t, v: t, t: t });
        return typeof val === 'number' && !isNaN(val) && isFinite(val) ? val : fallback(t);
      } catch (e) {
        return fallback(t);
      }
    };
  } catch (e) {
    return fallback;
  }
}

/**
 * Builds a 3D Solid of Revolution around X, Y, or Z axis
 * (Supports single curve y = f(x) or x = g(y), and washer regions between top & bottom curves)
 * Powered by mathjs AST compilation for dynamic integration.
 */
export function buildSolidOfRevolutionMesh(options: Math3DOptions): Math3DGeometryResult {
  let topExpr = options.fTop || options.curve2D || options.equationZ;

  // Clean topExpr from range clauses (e.g. "ln(y) from y=1 to y=4" -> "ln(y)")
  if (topExpr) {
    topExpr = topExpr.split(/\b(?:from|to|for|where|with|,|;)\b/i)[0].trim();
    topExpr = topExpr.replace(/^[xy]\s*=\s*/i, '').trim();
  }

  // If topExpr is missing or is just a single number (e.g. "4" when LLM passed upper bound), extract curve from title
  const isPureNumber = !topExpr || /^[+-]?\d+(?:\.\d+)?$/.test(topExpr);
  if (isPureNumber && options.title) {
    const titleFuncMatch = options.title.match(/(?:[xy]\s*=\s*)([a-zA-Z][a-zA-Z0-9_.+*\-()^/\s]*)/i);
    if (titleFuncMatch) {
      topExpr = titleFuncMatch[1].trim();
    }
  }
  topExpr = topExpr || 'sqrt(x)';

  const botExpr = options.fBottom && options.fBottom !== '0' ? options.fBottom : null;

  const evalTop = compileCurveFunction(topExpr, (t) => Math.sqrt(Math.max(0, t)));
  const evalBot = botExpr ? compileCurveFunction(botExpr, () => 0) : null;

  const axis = (options.revolutionAxis || 'x').toLowerCase();

  // Extract explicit range from text if present (e.g. "from 1 to 4")
  const combinedText = (options.title || '') + ' ' + (options.equationZ || '') + ' ' + (options.curve2D || '');
  const rangeMatch =
    combinedText.match(/(?:from|range|interval)\s*(?:[xy]\s*=\s*)?([+-]?\d+(?:\.\d+)?)\s*(?:to|->|,)\s*(?:[xy]\s*=\s*)?([+-]?\d+(?:\.\d+)?)/i) ||
    combinedText.match(/\[\s*([+-]?\d+(?:\.\d+)?)\s*,\s*([+-]?\d+(?:\.\d+)?)\s*\]/);

  let nlpMin: number | null = null;
  let nlpMax: number | null = null;
  if (rangeMatch) {
    const minVal = parseFloat(rangeMatch[1]);
    const maxVal = parseFloat(rangeMatch[2]);
    if (!isNaN(minVal) && !isNaN(maxVal) && minVal < maxVal) {
      nlpMin = minVal;
      nlpMax = maxVal;
    }
  }

  const uMin = (axis === 'y' ? (options.yRange?.[0] ?? nlpMin ?? options.xRange?.[0] ?? 1) : (options.xRange?.[0] ?? nlpMin ?? 0));
  const uMax = (axis === 'y' ? (options.yRange?.[1] ?? nlpMax ?? options.xRange?.[1] ?? 4) : (options.xRange?.[1] ?? nlpMax ?? (uMin + 3)));

  let angleDeg = options.revolutionAngle ?? 360;
  // If caller passed angle in radians (e.g. 3.14159 or 6.28318), convert to degrees
  if (angleDeg > 0 && angleDeg <= 2 * Math.PI + 0.1) {
    angleDeg = (angleDeg / Math.PI) * 180;
  }
  if (angleDeg >= 350) angleDeg = 360;

  const totalAngle = (Math.min(360, Math.max(10, angleDeg)) * Math.PI) / 180;
  const isFull360 = Math.abs(totalAngle - 2 * Math.PI) < 1e-4;
  const colorTheme = options.colorTheme || 'cyan_orange';

  const uSegments = 60;
  const vSegments = 50;

  // 1. Compute radial profile bounds
  let maxR = 0;
  for (let i = 0; i <= uSegments; i++) {
    const u = uMin + (i / uSegments) * (uMax - uMin);
    const rTop = Math.max(0, evalTop(u));
    maxR = Math.max(maxR, rTop);
  }
  if (maxR === 0) maxR = 1;

  const lenU = Math.abs(uMax - uMin) || 1;
  const maxDim = Math.max(lenU, maxR * 2);
  const scale = Math.min(1.0, 3.4 / maxDim);

  const positions: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];

  let vertCount = 0;

  // 2. Build Outer Revolution Surface (u: along axis, v: rotational angle)
  const outerStartIdx = vertCount;
  for (let i = 0; i <= uSegments; i++) {
    const u = uMin + (i / uSegments) * (uMax - uMin);
    const r = Math.max(0, evalTop(u));
    const normR = r / maxR;
    const color = getNeonColor(normR, colorTheme);

    for (let j = 0; j <= vSegments; j++) {
      const theta = (j / vSegments) * totalAngle;

      let px = 0;
      let py = 0;
      let pz = 0;

      if (axis === 'y') {
        // Revolved around Y axis: radius in XZ plane, height along Y
        px = r * Math.sin(theta) * scale;
        py = u * scale;
        pz = -r * Math.cos(theta) * scale;
      } else if (axis === 'z') {
        // Revolved around Z axis
        px = r * Math.cos(theta) * scale;
        pz = -r * Math.sin(theta) * scale;
        py = u * scale;
      } else {
        // Default: Revolved around X axis (Math X -> Three.js X, Radius in YZ plane)
        px = u * scale;
        py = r * Math.sin(theta) * scale;
        pz = -r * Math.cos(theta) * scale;
      }

      positions.push(px, py, pz);
      colors.push(color.r, color.g, color.b);
      vertCount++;
    }
  }

  for (let i = 0; i < uSegments; i++) {
    for (let j = 0; j < vSegments; j++) {
      const a = outerStartIdx + i * (vSegments + 1) + j;
      const b = outerStartIdx + (i + 1) * (vSegments + 1) + j;
      const c = outerStartIdx + (i + 1) * (vSegments + 1) + (j + 1);
      const d = outerStartIdx + i * (vSegments + 1) + (j + 1);

      indices.push(a, b, d);
      indices.push(b, c, d);
    }
  }

  // 3. Optional: Inner Washer Surface if evalBot exists
  if (evalBot) {
    const innerStartIdx = vertCount;
    for (let i = 0; i <= uSegments; i++) {
      const u = uMin + (i / uSegments) * (uMax - uMin);
      const r = Math.max(0, evalBot(u));
      const normR = r / maxR;
      const color = getNeonColor(normR * 0.7, colorTheme);

      for (let j = 0; j <= vSegments; j++) {
        const theta = (j / vSegments) * totalAngle;
        let px = 0;
        let py = 0;
        let pz = 0;

        if (axis === 'y') {
          px = r * Math.sin(theta) * scale;
          py = u * scale;
          pz = -r * Math.cos(theta) * scale;
        } else {
          px = u * scale;
          py = r * Math.sin(theta) * scale;
          pz = -r * Math.cos(theta) * scale;
        }

        positions.push(px, py, pz);
        colors.push(color.r, color.g, color.b);
        vertCount++;
      }
    }

    for (let i = 0; i < uSegments; i++) {
      for (let j = 0; j < vSegments; j++) {
        const a = innerStartIdx + i * (vSegments + 1) + j;
        const b = innerStartIdx + (i + 1) * (vSegments + 1) + j;
        const c = innerStartIdx + (i + 1) * (vSegments + 1) + (j + 1);
        const d = innerStartIdx + i * (vSegments + 1) + (j + 1);

        indices.push(a, d, b);
        indices.push(b, d, c);
      }
    }
  }

  // 4. End Cap Disks for Solid Watertight Enclosure (at uMin and uMax when 360°)
  if (isFull360) {
    const addCapDisk = (uVal: number, isTop: boolean) => {
      const rOuter = Math.max(0, evalTop(uVal));
      if (rOuter <= 1e-4) return; // Point apex singularity, no cap needed

      const centerIdx = vertCount;
      let cx = 0, cy = 0, cz = 0;
      if (axis === 'y') cy = uVal * scale;
      else cx = uVal * scale;

      positions.push(cx, cy, cz);
      const capColor = getNeonColor(rOuter / maxR, colorTheme);
      colors.push(capColor.r, capColor.g, capColor.b);
      vertCount++;

      const ringStart = vertCount;
      for (let j = 0; j <= vSegments; j++) {
        const theta = (j / vSegments) * totalAngle;
        let px = 0, py = 0, pz = 0;
        if (axis === 'y') {
          px = rOuter * Math.sin(theta) * scale;
          py = uVal * scale;
          pz = -rOuter * Math.cos(theta) * scale;
        } else {
          px = uVal * scale;
          py = rOuter * Math.sin(theta) * scale;
          pz = -rOuter * Math.cos(theta) * scale;
        }
        positions.push(px, py, pz);
        colors.push(capColor.r, capColor.g, capColor.b);
        vertCount++;
      }

      for (let j = 0; j < vSegments; j++) {
        const p1 = ringStart + j;
        const p2 = ringStart + j + 1;
        if (isTop) {
          indices.push(centerIdx, p1, p2);
        } else {
          indices.push(centerIdx, p2, p1);
        }
      }
    };

    addCapDisk(uMin, false);
    addCapDisk(uMax, true);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();

  const labelCurve = (axis === 'y') ? `x = ${topExpr}` : `y = ${topExpr}`;
  return {
    geometry,
    plotType: 'solid_of_revolution',
    formulaLabel: `Revolved ${labelCurve} around ${axis.toUpperCase()}-axis (${angleDeg}°)`,
    bounds: {
      min: (axis === 'y') ? [-maxR, uMin, -maxR] : [uMin, -maxR, -maxR],
      max: (axis === 'y') ? [maxR, uMax, maxR] : [uMax, maxR, maxR],
    },
  };
}
