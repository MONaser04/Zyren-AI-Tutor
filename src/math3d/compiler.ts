import * as THREE from 'three';
import { cleanMathExpression, SAFE_DIV_CODE } from './astParser';

/**
 * Parses and compiles a user math expression string into a fast JS evaluator (x, y) => number
 */
export function compileMathFunction(expr?: string, defaultFn: (x: number, y: number) => number = (x, y) => x * x + y * y): (x: number, y: number) => number {
  if (!expr || typeof expr !== 'string' || !expr.trim()) {
    return defaultFn;
  }

  let clean = expr.trim();
  if (clean.includes('=')) {
    clean = clean.split('=').pop()!.trim();
  }

  const jsExpr = cleanMathExpression(clean);

  try {
    // eslint-disable-next-line no-new-func
    const fn = new Function('x', 'y', 'u', 'v', `
      ${SAFE_DIV_CODE}
      const _u = (typeof u !== 'undefined' && u !== undefined) ? u : x;
      const _v = (typeof v !== 'undefined' && v !== undefined) ? v : y;
      try {
        const val = ${jsExpr};
        return isNaN(val) || !isFinite(val) ? 0 : val;
      } catch (e) {
        return 0;
      }
    `);
    // Test evaluation
    fn(1, 1);
    return fn as (x: number, y: number) => number;
  } catch (err) {
    console.warn('[Math3DCompiler] Failed to parse math expression:', expr, jsExpr, err);
    return defaultFn;
  }
}

/**
 * Compiles a parametric coordinate function for (u, v) => number
 */
export function compileParametricFunction(expr?: string, defaultFn: (u: number, v: number) => number = (u, _v) => u): (u: number, v: number) => number {
  if (!expr || typeof expr !== 'string' || !expr.trim()) {
    return defaultFn;
  }

  let clean = expr.trim();
  if (clean.includes('=')) {
    clean = clean.split('=').pop()!.trim();
  }

  const jsExpr = cleanMathExpression(clean);

  try {
    // eslint-disable-next-line no-new-func
    const fn = new Function('u', 'v', 'x', 'y', `
      ${SAFE_DIV_CODE}
      try {
        const val = ${jsExpr};
        return isNaN(val) || !isFinite(val) ? 0 : val;
      } catch (e) {
        return 0;
      }
    `);
    // Test evaluation
    fn(1, 1);
    return fn as (u: number, v: number) => number;
  } catch (err) {
    console.warn('[Math3DCompiler] Failed to parse parametric expression:', expr, jsExpr, err);
    return defaultFn;
  }
}

/**
 * Neon gradient color generator based on normalized parameter t in [0, 1]
 */
export function getNeonColor(t: number, theme: string = 'cyan_orange'): THREE.Color {
  const clamped = Math.max(0, Math.min(1, t));
  const color = new THREE.Color();

  if (theme === 'plasma') {
    // Dark purple -> Magenta -> Orange -> Yellow
    if (clamped < 0.33) {
      color.setRGB(0.2 + clamped * 1.5, 0.05, 0.6);
    } else if (clamped < 0.66) {
      const u = (clamped - 0.33) / 0.33;
      color.setRGB(0.7 + u * 0.3, 0.1 + u * 0.4, 0.6 - u * 0.4);
    } else {
      const u = (clamped - 0.66) / 0.34;
      color.setRGB(1.0, 0.5 + u * 0.5, 0.2 + u * 0.8);
    }
  } else if (theme === 'emerald') {
    // Deep Teal -> Emerald Green -> Lime -> Gold
    color.setHSL(0.35 - clamped * 0.25, 0.9, 0.4 + clamped * 0.3);
  } else if (theme === 'electric_blue') {
    // Deep Indigo -> Cyan -> White Blue
    color.setRGB(0.1 + clamped * 0.3, 0.4 + clamped * 0.55, 0.9 + clamped * 0.1);
  } else {
    // Default: Cyberpunk Cyan (#00d2d3) -> Violet (#5f27cd) -> Electric Orange (#ff9f43)
    if (clamped < 0.5) {
      const u = clamped / 0.5;
      color.setRGB(0.0 + u * 0.5, 0.8 - u * 0.4, 0.85 + u * 0.1);
    } else {
      const u = (clamped - 0.5) / 0.5;
      color.setRGB(0.5 + u * 0.5, 0.4 + u * 0.3, 0.95 - u * 0.8);
    }
  }

  return color;
}

/**
 * Compiles a 2D domain mask expression string into a fast boolean evaluator (x, y) => boolean
 * Examples: 'x^2 + y^2 <= 1', 'abs(x) <= 1 && abs(y) <= 1', 'x^2 + y^2 - 1' (<= 0 assumed)
 */
export function compileDomainMask(expr?: string): (x: number, y: number) => boolean {
  if (!expr || typeof expr !== 'string' || !expr.trim()) {
    return () => true;
  }

  let clean = expr.trim();

  // If contains inequalities <=, <, >=, >, ==
  clean = clean.replace(/\^/g, '**');
  clean = clean.replace(/(\d+)\s*([a-zA-Z\(])/g, '$1 * $2');
  clean = clean.replace(/(\))\s*([a-zA-Z0-9\(])/g, '$1 * $2');
  clean = clean.replace(/(^|[+\-*/(])\s*-\s*([a-zA-Z0-9_.]+|\([^)()]+\))\s*\*\*\s*([a-zA-Z0-9_.]+|\([^)()]+\))/g, '$1(-1 * (($2) ** ($3)))');
  clean = clean.replace(/\babs\b/g, 'Math.abs');
  clean = clean.replace(/\bsqrt\b/g, 'Math.sqrt');
  clean = clean.replace(/\bpi\b/gi, 'Math.PI');
  clean = clean.replace(/≤/g, '<=');
  clean = clean.replace(/≥/g, '>=');

  // If no inequality operator was provided (e.g. '1 - x^2 - y^2'), assume expression >= 0
  if (!/[<>=]/.test(clean)) {
    clean = `(${clean}) >= 0`;
  }

  try {
    // eslint-disable-next-line no-new-func
    const fn = new Function('x', 'y', `
      try {
        return Boolean(${clean});
      } catch (e) {
        return true;
      }
    `);
    fn(0, 0);
    return fn as (x: number, y: number) => boolean;
  } catch (err) {
    console.warn('[Math3DCompiler] Failed to parse domain mask:', expr, clean, err);
    return () => true;
  }
}

/**
 * NLP / Voice Intent Parser helper for extracting dynamic grid resolution from user prompts and strings
 * Supports:
 * - "Low resolution" / "fast" / "low-res" -> 36
 * - "Medium resolution" / "medium" -> 64
 * - "High resolution" / "smooth finish" / "ultra" -> 100
 * - "Ultra resolution" / "maximum resolution" -> 128
 * - Explicit integers: "resolution 120", "res 80", "120 voxels", "grid 100", "res=128" -> parsed integer
 * - Safety clamped strictly between 24 and 150 to prevent WebGL OOM crashes.
 */
export function extractGridResolution(input?: string, defaultRes: number = 64): number {
  if (!input || typeof input !== 'string') {
    return Math.min(150, Math.max(24, Math.round(defaultRes)));
  }

  const text = input.toLowerCase();

  // 1. Explicit Number Matching: "resolution 120", "res 80", "120 voxels", "res=100", "grid 96"
  const numMatch =
    text.match(/(?:resolution|res|gridresolution|grid|voxel|voxels)\s*(?:=|:|\s)\s*(\d+)/i) ||
    text.match(/(\d+)\s*(?:voxels|grid\s*res|grid\s*resolution)/i);

  if (numMatch && numMatch[1]) {
    const parsed = parseInt(numMatch[1], 10);
    if (!isNaN(parsed) && parsed > 0) {
      return Math.min(150, Math.max(24, parsed));
    }
  }

  // 2. Descriptive Keyword Mapping
  // Ultra / Maximum
  if (
    text.includes('ultra resolution') ||
    text.includes('ultra-res') ||
    text.includes('ultra res') ||
    text.includes('maximum resolution')
  ) {
    return 128;
  }

  // High Resolution
  if (
    text.includes('high resolution') ||
    text.includes('high-res') ||
    text.includes('high res') ||
    text.includes('high quality') ||
    text.includes('smooth finish')
  ) {
    return 100;
  }

  // Low Resolution
  if (
    text.includes('low resolution') ||
    text.includes('low-res') ||
    text.includes('low res') ||
    text.includes('low quality') ||
    text.includes('fast rendering') ||
    text.includes('fast')
  ) {
    return 36;
  }

  // Medium Resolution
  if (
    text.includes('medium resolution') ||
    text.includes('medium quality') ||
    text.includes('medium')
  ) {
    return 64;
  }

  return Math.min(150, Math.max(24, Math.round(defaultRes)));
}

