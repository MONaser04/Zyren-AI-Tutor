/**
 * Deterministic Math Expression Guard
 *
 * The single choke-point that validates every mathematical expression string
 * before it reaches the mathjs AST compiler / builders. Its purpose is to
 * reject "descriptive text hallucination" — cases where an LLM (or any caller)
 * passes a human-readable title like "Parametric Surface", "Logical Solid", or
 * "Revolved x = 10" into a field that MUST contain a pure algebraic expression.
 *
 * Unlike the previous fragile regex heuristic (which only checked for the
 * presence of a few operators and variables), this guard actually parses the
 * string with mathjs and walks the resulting AST. Any identifier that is not a
 * known variable (x, y, z, u, v, t) or a known math function/constant is treated
 * as descriptive prose and rejected.
 *
 * This is deterministic, language-agnostic, and works regardless of what the
 * LLM or any future caller sends.
 */

import * as math from 'mathjs';

/** Variables that are legal inside a mathematical expression. */
const KNOWN_VARIABLES = new Set(['x', 'y', 'z', 'u', 'v', 't']);

/**
 * Known mathjs function names and constants. Anything not in this set (and not
 * a variable) is treated as an unknown symbol — i.e. descriptive prose.
 */
const KNOWN_FUNCTIONS = new Set([
  // Elementary
  'sin', 'cos', 'tan', 'asin', 'acos', 'atan', 'atan2',
  'sinh', 'cosh', 'tanh', 'asinh', 'acosh', 'atanh',
  'sec', 'csc', 'cot', 'asec', 'acsc', 'acot',
  'exp', 'log', 'log10', 'log2', 'ln',
  'sqrt', 'cbrt', 'abs', 'sign', 'floor', 'ceil', 'round', 'fix',
  'min', 'max', 'pow', 'mod', 'nthRoot', 'hypot',
  // Logical operators (mathjs functions)
  'and', 'or', 'not', 'xor',
  // Constants
  'pi', 'e', 'tau', 'phi', 'Infinity', 'NaN',
  // Trig aliases sometimes emitted by LLMs
  'sinc', 'arctan', 'arcsin', 'arccos',
]);

/** Descriptive English words that must never appear in a math field. */
const DESCRIPTIVE_WORDS = new Set([
  'surface', 'solid', 'parametric', 'logical', 'revolved', 'revolution',
  'extruded', 'extrusion', 'implicit', 'isosurface', 'bounded', 'graph',
  'plot', 'curve', 'function', 'equation', 'formula', 'shape', 'figure',
  'the', 'a', 'an', 'of', 'with', 'where', 'for', 'from', 'to',
  'around', 'about', 'axis', 'axes', 'region', 'area', 'volume', 'between',
  'above', 'below', 'upper', 'lower', 'top', 'bottom', 'left', 'right',
]);

/**
 * Walks a mathjs AST and collects every SymbolNode name that is NOT a known
 * variable. Returns the list of unknown identifiers (empty = valid math).
 */
function collectUnknownSymbols(node: math.MathNode, unknown: Set<string>): void {
  if (node.type === 'SymbolNode') {
    const name = (node as any).name as string;
    if (!KNOWN_VARIABLES.has(name)) {
      unknown.add(name);
    }
    return;
  }
  if (node.type === 'FunctionNode') {
    const fnNode = node as any;
    const fnName = (fnNode.name || fnNode.fn?.name || '') as string;
    // The function name itself is not a symbol; only its arguments are.
    // But if the "function" is actually an unknown identifier used as a call,
    // mathjs would have already failed to parse it. Still, guard defensively.
    if (fnName && !KNOWN_FUNCTIONS.has(fnName) && !KNOWN_VARIABLES.has(fnName)) {
      unknown.add(fnName);
    }
  }
  // Recurse into children
  const children = (node as any).args || (node as any).params || (node as any).content;
  if (Array.isArray(children)) {
    for (const child of children) {
      if (child && typeof child === 'object' && child.type) {
        collectUnknownSymbols(child, unknown);
      }
    }
  } else if (children && typeof children === 'object' && children.type) {
    collectUnknownSymbols(children, unknown);
  }
  // OperatorNode / ParenthesisNode / ConstantNode / RelationalNode have no
  // unknown symbols beyond their args (already handled above).
}

/**
 * Determines whether a string is a valid pure mathematical expression.
 *
 * @param expr   The raw expression string (may be undefined/null/empty).
 * @param allowedVars  Extra variable names to allow (e.g. 'u', 'v' for parametric).
 * @param allowEquation  If true, treat '=' as a valid equation operator (LHS = RHS)
 *                       and convert to LHS - RHS for parsing (used by implicit builder).
 * @returns true if the string is a valid pure math expression;
 *          false if it is empty, undefined, null, or contains descriptive prose / unknown identifiers.
 */
export function isValidMathExpression(
  expr: string | undefined | null,
  allowedVars: string[] = [],
  allowEquation: boolean = false
): boolean {
  if (expr === undefined || expr === null) return false;
  const text = String(expr).trim();
  if (text.length === 0) return false;

  // Fast pre-check: reject strings that are purely descriptive words with no
  // math operators or variables at all (e.g. "Parametric Surface").
  // Include = as a valid operator since the implicit builder handles LHS = RHS
  const hasMathOperator = /[+\-*/^<>=≤≥|]/.test(text);
  const hasKnownVar = /(?<![a-zA-Z_])[xyzuvt](?![a-zA-Z_])/i.test(text);
  const hasDigit = /\d/.test(text);
  const hasKnownFn = new RegExp(
    `\\b(?:${Array.from(KNOWN_FUNCTIONS).join('|')})\\b`,
    'i'
  ).test(text);

  if (!hasMathOperator && !hasKnownVar && !hasDigit && !hasKnownFn) {
    // No math content whatsoever — almost certainly descriptive prose.
    return false;
  }

  // If allowEquation is true and the expression contains '=', convert LHS = RHS to LHS - RHS
  // for parsing (matching what the implicit builder does).
  let parseText = text;
  if (allowEquation && text.includes('=') && !text.includes('<=') && !text.includes('>=')) {
    const eqIdx = text.indexOf('=');
    const lhs = text.substring(0, eqIdx).trim();
    const rhs = text.substring(eqIdx + 1).trim();
    parseText = `(${lhs}) - (${rhs})`;
  }

  // Attempt a real parse. If mathjs cannot parse it, it is not valid math.
  let parsed: math.MathNode;
  try {
    parsed = math.parse(parseText);
  } catch {
    return false;
  }

  // Walk the AST and reject unknown identifiers.
  const unknown = new Set<string>();
  collectUnknownSymbols(parsed, unknown);

  // Allow caller-specified extra variables.
  for (const v of allowedVars) {
    unknown.delete(v);
  }

  // If any unknown identifier remains, it is descriptive prose (or a typo).
  if (unknown.size > 0) {
    return false;
  }

  // Final guard: reject if the expression is dominated by descriptive words
  // even when it happens to parse (e.g. "x = surface" parses but is nonsense).
  const lower = text.toLowerCase();
  for (const word of DESCRIPTIVE_WORDS) {
    if (new RegExp(`\\b${word}\\b`, 'i').test(lower)) {
      return false;
    }
  }

  return true;
}

/**
 * Strips leading descriptive prose from a string, returning the pure math
 * portion. Handles cases like "Revolved x = 10" -> "x = 10", or
 * "curve y = sqrt(x)" -> "y = sqrt(x)".
 *
 * Strategy: find the first occurrence of a math variable/function/operator and
 * slice from there, but only if the leading text is clearly prose (contains
 * spaces and no math operators).
 */
export function extractPureMath(
  expr: string | undefined | null,
  allowEquation: boolean = false
): string | undefined {
  if (expr === undefined || expr === null) return undefined;
  const text = String(expr).trim();
  if (text.length === 0) return undefined;

  // If the whole string is already valid math, return it unchanged.
  if (isValidMathExpression(text, [], allowEquation)) return text;

  // Try to locate a math "anchor": a variable assignment (x =, y =, z =),
  // a known function, or a leading digit/operator.
  const anchor = text.search(/(?:\b[xyzuvt]\s*=|(?<![a-zA-Z_])[xyzuvt](?![a-zA-Z_])|\b(?:sin|cos|tan|sqrt|abs|exp|log|ln|pi|e)\b|\d)/i);
  if (anchor > 0) {
    const candidate = text.slice(anchor).trim();
    if (isValidMathExpression(candidate, [], allowEquation)) {
      return candidate;
    }
  }

  // Fallback: strip a leading "Revolved"/"curve"/"surface" style prefix.
  const stripped = text.replace(/^(?:revolved|revolution|curve|surface|solid|parametric|logical|extruded|implicit|bounded|graph|plot|function|equation|formula)\s+/i, '').trim();
  if (stripped !== text && isValidMathExpression(stripped, [], allowEquation)) {
    return stripped;
  }

  return undefined;
}

/**
 * Sanitizes a single expression field. Returns the pure math string if valid,
 * or undefined if the field contains descriptive prose (so callers can null it
 * and fall back to an explicit default rather than a silently-wrong mesh).
 */
export function guardMathField(
  expr: string | undefined | null,
  allowedVars: string[] = [],
  allowEquation: boolean = false
): string | undefined {
  if (expr === undefined || expr === null) return undefined;
  const text = String(expr).trim();
  if (text.length === 0) return undefined;

  if (isValidMathExpression(text, allowedVars, allowEquation)) {
    return text;
  }

  // Attempt to salvage a pure-math substring.
  const salvaged = extractPureMath(text, allowEquation);
  return salvaged;
}

/**
 * Sanitizes all expression fields in a plot options object.
 * Returns a new object with invalid fields nulled (so the router/builders
 * fall back to explicit defaults rather than silently rendering wrong meshes).
 */
export function sanitizeExpressionFields(
  options: Record<string, any>,
  allowedVarsMap: Record<string, string[]> = {}
): Record<string, any> {
  const result = { ...options };
  
  // Default allowed variables per field type
  const defaultAllowedVars: Record<string, string[]> = {
    equationZ: ['x', 'y', 'z'],
    curve2D: ['x', 'y'],
    fTop: ['x', 'y', 'z'],
    fBottom: ['x', 'y', 'z'],
    xUV: ['u', 'v'],
    yUV: ['u', 'v'],
    zUV: ['u', 'v'],
    zTop: ['x', 'y'],
    zBottom: ['x', 'y'],
    domainMask: ['x', 'y', 'z'],
    clippingPlane: ['x', 'y', 'z'],
  };

  // Fields that allow equation syntax (LHS = RHS)
  const allowEquationFields = new Set(['equationZ', 'fTop', 'fBottom', 'domainMask', 'clippingPlane']);

  for (const [key, value] of Object.entries(result)) {
    if (typeof value === 'string') {
      const allowedVars = allowedVarsMap[key] || defaultAllowedVars[key] || [];
      const allowEquation = allowEquationFields.has(key);
      const guarded = guardMathField(value, allowedVars, allowEquation);
      if (guarded === undefined) {
        result[key] = null;
      } else if (guarded !== value) {
        result[key] = guarded;
      }
    }
  }

  return result;
}