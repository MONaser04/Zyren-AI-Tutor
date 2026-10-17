import { describe, it, expect } from 'vitest';
import { compile2DMathFunction } from '../../src/layers/GraphOverlay';

describe('GraphOverlay - 2D Math Function & Shading Compiler', () => {
  it('correctly evaluates standard polynomials and quadratics', () => {
    const fn1 = compile2DMathFunction('x^2 + 1');
    expect(fn1(0, 0)).toBe(1);
    expect(fn1(2, 0)).toBe(5);
    expect(fn1(-2, 0)).toBe(5);

    const fn2 = compile2DMathFunction('-x^2 + 3');
    expect(fn2(0, 0)).toBe(3);
    expect(fn2(1, 0)).toBe(2);
    expect(fn2(-1, 0)).toBe(2);
  });

  it('strips LHS function assignments (y =, f(x) =, etc.) cleanly', () => {
    const fn1 = compile2DMathFunction('y = 4 - x^2');
    expect(fn1(0, 0)).toBe(4);
    expect(fn1(2, 0)).toBe(0);

    const fn2 = compile2DMathFunction('f(x) = 2x + 1');
    expect(fn2(3, 0)).toBe(7);

    const fn3 = compile2DMathFunction('f1(x) = -x^2 + 3');
    expect(fn3(0, 0)).toBe(3);

    const fn4 = compile2DMathFunction('g(y) = y^2');
    expect(fn4(0, 3)).toBe(9);
  });

  it('handles trigonometric functions and square roots', () => {
    const fnSin = compile2DMathFunction('sin(x)');
    expect(fnSin(0, 0)).toBeCloseTo(0);
    expect(fnSin(Math.PI / 2, 0)).toBeCloseTo(1);

    const fnSqrt = compile2DMathFunction('sqrt(x + 4)');
    expect(fnSqrt(0, 0)).toBe(2);
    expect(fnSqrt(5, 0)).toBe(3);
  });

  it('handles LaTeX expressions and unicode symbols', () => {
    const fnLatex = compile2DMathFunction('\\frac{1}{2} x + 1');
    expect(fnLatex(4, 0)).toBe(3);

    const fnUnicode = compile2DMathFunction('x² − 4');
    expect(fnUnicode(3, 0)).toBe(5);
  });

  it('handles physics functions with variable t (e.g. v(t) = 2t + 3)', () => {
    const fnVelocity = compile2DMathFunction('v(t) = 2t + 3');
    expect(fnVelocity(0, 0)).toBe(3);
    expect(fnVelocity(5, 0)).toBe(13);

    const fnPos = compile2DMathFunction('s(t) = t^2 + 3t');
    expect(fnPos(0, 0)).toBe(0);
    expect(fnPos(5, 0)).toBe(40);
  });
});
