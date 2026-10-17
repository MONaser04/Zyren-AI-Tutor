import type { Math3DOptions, Math3DGeometryResult, Math3DPlotType } from './types';
import { buildSurfaceMesh } from './builders/surfaceBuilder';
import { buildParametricSurfaceMesh } from './builders/parametricBuilder';
import { buildImplicitIsosurfaceMesh } from './builders/implicitIsosurfaceBuilder';
import { buildTwoSurfacesSolidMesh } from './builders/boundedSurfacesBuilder';
import { buildLinearExtrusionMesh } from './builders/extrusionBuilder';
import { buildSolidOfRevolutionMesh } from './builders/revolutionBuilder';
import { guardMathField } from './expressionGuard';

/**
 * Checks if expression contains inequality relational operators (<=, >=, <, >, ≤, ≥)
 */
export function hasInequalityOperators(expr: string): boolean {
  if (!expr || typeof expr !== 'string') return false;
  return /[<≤>≥]/.test(expr) || /<=|>=/.test(expr);
}

/**
 * Checks if expression contains logical CSG operators (AND, OR, &&, ||, intersect, etc.)
 */
export function hasCSGLogicalOperators(expr: string): boolean {
  if (!expr || typeof expr !== 'string') return false;
  return /\b(?:and|&&|or|\|\||intersect|union|with|where|cut)\b/i.test(expr);
}

/**
 * Checks if expression contains variable 'z' (excluding math function names)
 */
export function containsVariableZ(expr: string): boolean {
  if (!expr || typeof expr !== 'string') return false;
  return /(?<![a-zA-Z_])z(?![a-zA-Z_])/i.test(expr);
}

/**
 * Deterministic check for single-valued explicit height functions: z = f(x, y)
 */
export function isExplicitZFunction(expr: string): boolean {
  if (!expr || typeof expr !== 'string') return false;
  let clean = expr.trim();

  // Split off inline 2D domain condition if present (e.g. "z = x^2 - y^2, x^2 + y^2 <= 16")
  if (/[;,]|(?:\b(?:where|with|for|subject to)\b)/i.test(clean)) {
    const parts = clean.split(/[;,]|(?:\b(?:where|with|for|subject to)\b)/i);
    if (parts.length >= 2) {
      clean = parts[0].trim();
    }
  }

  if (/^z\s*=\s*/i.test(clean)) {
    const rhs = clean.replace(/^z\s*=\s*/i, '');
    return !hasInequalityOperators(rhs) && !hasCSGLogicalOperators(rhs) && !containsVariableZ(rhs);
  }

  if (!clean.includes('=') && !hasInequalityOperators(clean) && !hasCSGLogicalOperators(clean) && !containsVariableZ(clean)) {
    // Must contain math variables x or y or digits/math operators
    return /[xy0-9+\-*/^]/.test(clean) && !/\b[a-zA-Z]{4,}\b/.test(clean.replace(/\b(?:sqrt|sin|cos|tan|asin|acos|atan|sinh|cosh|tanh|exp|log|abs|floor|ceil|round|min|max|pi|sinc)\b/g, ''));
  }

  return false;
}

/**
 * Deterministic AST-Based Semantic Equation Classifier (Decision Tree Steps 0 to 6)
 *
 * Classifies mathematical input into exactly one specialized rendering pipeline:
 * 1. 'solid_of_revolution' & 'linear_extrusion': Specialized calculus volume integrations.
 * 2. 'parametric': Parametric surfaces r(u, v) = (x(u,v), y(u,v), z(u,v)).
 * 3. 'surface': Single-valued explicit heightfields z = f(x, y) with optional 2D domain masks.
 * 4. 'bounded_surfaces': Volumetric CSG solids (3D spatial inequalities, compound CSG intervals, and clipping planes).
 * 5. 'implicit_isosurface': Algebraic implicit relations F(x, y, z) = C.
 */
export function classifyPlotType(options: Math3DOptions): Math3DPlotType {
  const p = (options.plotType || '').toLowerCase();
  const eqZ = (options.equationZ || '').trim();

  // ── STEP 1: Specialized Calculus Pipelines (Strict opt-in ONLY) ──
  if (p === 'solid_of_revolution' || p === 'revolution' || (options.curve2D && options.revolutionAxis)) {
    return 'solid_of_revolution';
  }
  if (p === 'linear_extrusion' || p === 'extrusion' || (options.fTop && options.fBottom && !options.equationZ && !options.zTop)) {
    return 'linear_extrusion';
  }

  // ── STEP 2: Parametric Surface Pipeline ──
  if (p === 'parametric' || (options.xUV && options.yUV)) {
    return 'parametric';
  }

  // ── STEP 3: Single-Valued Explicit Surface Pipeline (with optional 2D Domain Masking) ──
  const isExplicit = p === 'surface' || isExplicitZFunction(eqZ) || (options.zTop && !options.zBottom && isExplicitZFunction(options.zTop));
  const has3DInequalityInEq = containsVariableZ(eqZ) && hasInequalityOperators(eqZ);
  const has3DClipping = Boolean(
    (options.clippingPlane && containsVariableZ(options.clippingPlane)) ||
    (options.crossSection && containsVariableZ(options.crossSection))
  );
  const hasDualSurfaces = Boolean(options.zTop && options.zBottom);

  // If it is an explicit function z = f(x, y) with no 3D Z-inequalities and no dual z-surfaces,
  // route directly to the Explicit Surface Pipeline (domainMask will act as a 2D filter mask)
  if (isExplicit && !has3DInequalityInEq && !has3DClipping && !hasDualSurfaces) {
    return 'surface';
  }

  // ── STEP 4: Volumetric CSG Solid Pipeline (Highest Priority for 3D Inequalities & CSG) ──
  const has3DInequalities =
    (hasInequalityOperators(eqZ) && containsVariableZ(eqZ)) ||
    (hasInequalityOperators(options.zTop || '') && containsVariableZ(options.zTop || '')) ||
    (hasInequalityOperators(options.domainMask || '') && containsVariableZ(options.domainMask || ''));
  const hasCSGKeywords = hasCSGLogicalOperators(eqZ) || hasCSGLogicalOperators(options.domainMask || '');
  const hasClipping = Boolean(options.clippingPlane || options.crossSection);

  if (
    p === 'bounded_surfaces' ||
    p === 'two_surfaces' ||
    p === 'solid' ||
    p === 'solid_implicit' ||
    hasDualSurfaces ||
    hasClipping ||
    has3DInequalities ||
    hasCSGKeywords
  ) {
    return 'bounded_surfaces';
  }

  // ── STEP 5: Implicit Algebraic Isosurface Pipeline (Zero-Crossing Equality F(x,y,z) = 0) ──
  if (p === 'implicit' || p === 'implicit_isosurface' || containsVariableZ(eqZ)) {
    return 'implicit_isosurface';
  }

  // ── STEP 6: Safe Fallback ──
  return 'surface';
}

/**
 * Main Dispatcher: Routes mathematical input to its specialized production pipeline
 */
export function generate3DGeometry(options: Math3DOptions): Math3DGeometryResult {
  const sanitized = sanitizeMathOptions(options);
  const resolvedType = classifyPlotType(sanitized);

  switch (resolvedType) {
    case 'parametric':
      return buildParametricSurfaceMesh(sanitized);

    case 'implicit_isosurface':
      return buildImplicitIsosurfaceMesh(sanitized);

    case 'bounded_surfaces':
      return buildTwoSurfacesSolidMesh(sanitized);

    case 'solid_of_revolution':
      return buildSolidOfRevolutionMesh(sanitized);

    case 'linear_extrusion':
      return buildLinearExtrusionMesh(sanitized);

    case 'surface':
    default:
      return buildSurfaceMesh(sanitized);
  }
}

/**
 * Sanitizes every mathematical expression field in the options object through
 * the deterministic expression guard. Any field that contains descriptive prose
 * (e.g. "Parametric Surface", "Logical Solid", "Revolved x = 10") is nulled so
 * that the router does not misroute and the builder falls back to an explicit
 * default instead of silently rendering a wrong mesh.
 *
 * This is the single last line of defense before the mathjs AST compiler.
 */
export function sanitizeMathOptions(options: Math3DOptions): Math3DOptions {
  const out: Math3DOptions = { ...options };

  // Single-valued / implicit / inequality expressions (variables x, y, z).
  out.equationZ = guardMathField(options.equationZ, ['x', 'y', 'z']);
  out.zTop = guardMathField(options.zTop, ['x', 'y', 'z']);
  out.zBottom = guardMathField(options.zBottom, ['x', 'y', 'z']);
  out.domainMask = guardMathField(options.domainMask, ['x', 'y', 'z']);
  out.clippingPlane = guardMathField(options.clippingPlane, ['x', 'y', 'z']);
  out.crossSection = guardMathField(options.crossSection, ['x', 'y', 'z']);

  // 2D curve / extrusion / revolution expressions (variables x, y).
  out.curve2D = guardMathField(options.curve2D, ['x', 'y']);
  out.fTop = guardMathField(options.fTop, ['x', 'y']);
  out.fBottom = guardMathField(options.fBottom, ['x', 'y']);

  // Parametric surface expressions (variables u, v).
  out.xUV = guardMathField(options.xUV, ['u', 'v']);
  out.yUV = guardMathField(options.yUV, ['u', 'v']);
  out.zUV = guardMathField(options.zUV, ['u', 'v']);

  return out;
}


