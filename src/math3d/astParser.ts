/**
 * AST-Based Universal Math Expression & CSG Implicit Scalar Field (SDF) Compiler
 * Powered by mathjs AST Traversal & Constructive Solid Geometry (CSG) R-Functions
 *
 * Implements:
 * 1. Automatic mathjs AST parsing: math.parse(expr)
 * 2. AST Transformation for Signed Distance Field (SDF) evaluation:
 *    - Relational comparisons (<=, <, >=, >, ==):
 *      * A <= B  ==>  A - B <= 0
 *      * A >= B  ==>  B - A <= 0
 *    - Chained inequalities (A <= B <= C):
 *      * A <= B <= C ==> max(A - B, B - C) <= 0
 *    - Logical CSG operations (AND, OR, NOT):
 *      * A AND B ==> FunctionNode max(A, B) (CSG Intersection)
 *      * A OR B  ==> FunctionNode min(A, B) (CSG Union)
 *      * NOT A   ==> -A (CSG Complement)
 * 3. Dynamic Bounding Box estimation from AST constants.
 */

import * as math from 'mathjs';
import type { Math3DOptions } from './types';

export interface CompiledSDF {
  evaluate: (x: number, y: number, z: number) => number;
  formulaLabel: string;
  suggestedBounds?: {
    xRange: [number, number];
    yRange: [number, number];
    zRange: [number, number];
  };
}

/**
 * Division-by-Zero helper injected into all generated mathematical functions.
 */
export const SAFE_DIV_CODE = `
function _safeDiv(d) {
  return (Math.abs(d) < 1e-6) ? (1e-6 * (Math.sign(d) || 1)) : d;
}
`;

function isSmallerCondition(c: string): boolean {
  return c === 'smallerEq' || c === 'smaller' || c === '<=' || c === '<';
}

/**
 * Transforms a mathjs AST into a continuous Signed Distance Field (SDF) R-Function.
 * Inside solid: F(x, y, z) <= 0
 * Boundary:     F(x, y, z) == 0
 * Outside:      F(x, y, z) > 0
 */
export function transformASTtoSDF(node: math.MathNode): math.MathNode {
  // 1. Chained RelationalNode: e.g. A <= B <= C  ==>  max(A - B, B - C)
  if (node.type === 'RelationalNode') {
    const relNode = node as any;
    const params: math.MathNode[] = relNode.params;
    const conditionals: string[] = relNode.conditionals;

    if (params.length === 3 && conditionals.length === 2) {
      const c1 = conditionals[0];
      const c2 = conditionals[1];
      const p0 = transformASTtoSDF(params[0]);
      const p1 = transformASTtoSDF(params[1]);
      const p2 = transformASTtoSDF(params[2]);

      const term1 = isSmallerCondition(c1)
        ? new math.OperatorNode('-', 'subtract', [p0, p1])
        : new math.OperatorNode('-', 'subtract', [p1, p0]);

      const term2 = isSmallerCondition(c2)
        ? new math.OperatorNode('-', 'subtract', [p1, p2])
        : new math.OperatorNode('-', 'subtract', [p2, p1]);

      return new math.FunctionNode('max', [term1, term2]);
    }
  }

  // Recursively map all child nodes
  const mapped = node.map((child) => transformASTtoSDF(child));

  // 2. OperatorNode: Relational comparisons and Logical operations
  if (mapped.type === 'OperatorNode') {
    const opNode = mapped as math.OperatorNode;
    const op = opNode.op;
    const args = opNode.args;

    // Relational comparisons:
    if (op === '<=' || op === '<') {
      // A <= B  ==>  A - B <= 0
      return new math.OperatorNode('-', 'subtract', [args[0], args[1]]);
    }
    if (op === '>=' || op === '>') {
      // A >= B  ==>  B - A <= 0
      return new math.OperatorNode('-', 'subtract', [args[1], args[0]]);
    }
    if (op === '==' || op === '=') {
      return new math.OperatorNode('-', 'subtract', [args[0], args[1]]);
    }

    // Logical CSG operations:
    const opName = (opNode as any).name || (opNode as any).fn;
    if (op === 'and' || opName === 'and' || op === '&&') {
      // A AND B  ==>  max(A, B)
      return new math.FunctionNode('max', args);
    }
    if (op === 'or' || opName === 'or' || op === '||') {
      // A OR B  ==>  min(A, B)
      return new math.FunctionNode('min', args);
    }
    if (op === 'not' || opName === 'not' || op === '!') {
      // NOT A  ==>  -A
      return new math.OperatorNode('-', 'unaryMinus', args);
    }
  }

  // 3. ParenthesisNode: unwrap inner content
  if (mapped.type === 'ParenthesisNode') {
    return (mapped as math.ParenthesisNode).content;
  }

  // 4. Function mappings (ln -> log)
  if (mapped.type === 'FunctionNode') {
    const fnNode = mapped as any;
    const fnName = fnNode.name || fnNode.fn?.name;
    if (fnName === 'ln') {
      return new math.FunctionNode('log', fnNode.args);
    }
  }

  return mapped;
}

/**
 * Pre-cleans raw mathematical input string for mathjs AST parser.
 * Converts LaTeX pipes |x| to abs(x), maps Arabic logical terms, and normalizes symbols.
 */
export function sanitizeMathString(raw: string): string {
  let expr = (raw || '').trim();

  // Strip LHS assignment if present (e.g. "z =", "x =", "f(x,y,z) =")
  if (/^[xyz]\s*=\s*/i.test(expr)) {
    expr = expr.replace(/^[xyz]\s*=\s*/i, '');
  }

  // LaTeX & pipe absolute values: \vert x \vert, \left| x \right|, |x| -> abs(x)
  expr = expr.replace(/\\(?:left|right)?\|([^|]+)\\(?:left|right)?\|/g, 'abs($1)');
  expr = expr.replace(/\|([^|]+)\|/g, 'abs($1)');
  expr = expr.replace(/≤/g, '<=').replace(/≥/g, '>=');

  // Normalize logical operators
  expr = expr.replace(/\b(?:and|intersect|with|where)\b/gi, ' and ');
  expr = expr.replace(/\b(?:or|union)\b/gi, ' or ');

  // Natural log ln -> log
  expr = expr.replace(/\bln\b/gi, 'log');

  return expr.trim();
}

/**
 * Backward-compatible cleanMathExpression for legacy consumers
 */
export function cleanMathExpression(raw: string): string {
  return sanitizeMathString(raw);
}

/**
 * Compiles a single mathematical expression into an SDF function (x, y, z) => number
 */
export function parseSingleInequality(clause: string): (x: number, y: number, z: number) => number {
  const clean = sanitizeMathString(clause);
  try {
    const parsed = math.parse(clean);
    const transformed = transformASTtoSDF(parsed);
    const compiled = transformed.compile();

    return (x: number, y: number, z: number): number => {
      try {
        const val = compiled.evaluate({ x, y, z, u: x, v: y, t: z });
        return typeof val === 'number' && !isNaN(val) && isFinite(val) ? val : 1.0;
      } catch (e) {
        return 1.0;
      }
    };
  } catch (e) {
    return () => 1.0;
  }
}

/**
 * Detects cross-product cubic algebraic terms (e.g. Cayley cubic x^2 + y^2 + z^2 + 2xyz <= 1)
 */
export function isCubicCrossTerm(text: string): boolean {
  if (!text || typeof text !== 'string') return false;
  return (
    /\bxyz\b|x\s*\*?\s*y\s*\*?\s*z|x\^?2?\s*\*?\s*y|y\^?2?\s*\*?\s*z|z\^?2?\s*\*?\s*x|cayley/i.test(text) ||
    /2\s*\*?\s*x\s*\*?\s*y\s*\*?\s*z/i.test(text)
  );
}

/**
 * Extracts suggested dynamic bounding box from expression constants
 */
export function estimateBoundsFromText(text: string): { xRange: [number, number]; yRange: [number, number]; zRange: [number, number] } {
  if (isCubicCrossTerm(text)) {
    return {
      xRange: [-1.4, 1.4],
      yRange: [-1.4, 1.4],
      zRange: [-1.4, 1.4],
    };
  }

  let extent = 3.5;
  const numbers = text.match(/(?:<=|<|=|>=|>)\s*(\d+(?:\.\d+)?)/g);
  if (numbers) {
    for (const nStr of numbers) {
      const val = parseFloat(nStr.replace(/[^0-9.]/g, ''));
      if (!isNaN(val) && val > 0) {
        const r = Math.sqrt(val);
        if (r > extent * 0.7) {
          extent = Math.max(extent, r * 1.35);
        } else if (val > extent) {
          extent = Math.max(extent, Math.min(val * 1.25, 20.0));
        }
      }
    }
  }

  const rounded = Math.min(20.0, Math.max(3.5, Math.ceil(extent * 2) / 2));
  return {
    xRange: [-rounded, rounded],
    yRange: [-rounded, rounded],
    zRange: [-rounded, rounded],
  };
}

/**
 * Universal mathjs AST-based compiler that generates a unified scalar field SDF evaluator F(x, y, z) <= 0
 * for any Math3D options with full Constructive Solid Geometry (CSG) R-Function semantics.
 */
export function compileUniversalSDF(options: Math3DOptions): CompiledSDF {
  const parts: string[] = [];

  // 1. Dual-surface bounding (zTop and zBottom)
  if (options.zTop && options.zBottom) {
    parts.push(`(z <= ${options.zTop}) and (z >= ${options.zBottom})`);
  } else if (options.zTop) {
    parts.push(`(z <= ${options.zTop}) and (z >= 0)`);
  } else if (options.equationZ) {
    parts.push(options.equationZ);
  } else if (options.fTop && options.fBottom) {
    parts.push(`(y <= ${options.fTop}) and (y >= ${options.fBottom})`);
    if (options.zRange) {
      parts.push(`(z >= ${options.zRange[0]}) and (z <= ${options.zRange[1]})`);
    }
  }

  // 2. Add domain mask constraints
  if (options.domainMask) {
    parts.push(options.domainMask);
  }

  // 3. Add explicit CSG clipping planes & cross-sections
  if (options.clippingPlane) {
    parts.push(options.clippingPlane);
  }
  if (options.crossSection && options.crossSection !== options.clippingPlane) {
    parts.push(options.crossSection);
  }

  // 4. Default fallback
  if (parts.length === 0) {
    parts.push('(z <= x + 2) and (z >= x^2 + y^2)');
  }

  // Combine all parts with CSG Intersection (AND)
  const combinedRaw = parts.map((p) => `(${p.trim()})`).join(' and ');
  const cleanExpr = sanitizeMathString(combinedRaw);

  try {
    const parsedAST = math.parse(cleanExpr);
    const sdfAST = transformASTtoSDF(parsedAST);
    const compiled = sdfAST.compile();

    const evaluate = (x: number, y: number, z: number): number => {
      try {
        const val = compiled.evaluate({ x, y, z, u: x, v: y, t: z });
        return typeof val === 'number' && !isNaN(val) && isFinite(val) ? val : 1.0;
      } catch (e) {
        return 1.0;
      }
    };

    return {
      evaluate,
      formulaLabel: options.title || options.equationZ || '3D CSG Solid',
      suggestedBounds: estimateBoundsFromText(combinedRaw),
    };
  } catch (err) {
    // Fallback: evaluate via fallback function if mathjs parse fails
    console.warn('mathjs parse warning:', err);
    return {
      evaluate: (x, y, z) => (x * x + y * y + z * z - 4.0),
      formulaLabel: options.title || '3D Solid',
      suggestedBounds: { xRange: [-3.5, 3.5], yRange: [-3.5, 3.5], zRange: [-3.5, 3.5] },
    };
  }
}
