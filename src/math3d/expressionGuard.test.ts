import { describe, it, expect } from 'vitest';
import { 
  isValidMathExpression, 
  extractPureMath, 
  sanitizeExpressionFields 
} from './expressionGuard';

describe('expressionGuard', () => {
  describe('isValidMathExpression', () => {
    it('should accept valid explicit equations', () => {
      expect(isValidMathExpression('sin(x)*cos(y)', ['x', 'y'])).toBe(true);
      expect(isValidMathExpression('x^2 + y^2', ['x', 'y'])).toBe(true);
      expect(isValidMathExpression('1/y', ['x', 'y'])).toBe(true);
      expect(isValidMathExpression('sqrt(x^2 + y^2)', ['x', 'y'])).toBe(true);
    });

    it('should accept valid implicit equations (using <=, >=, <, >)', () => {
      expect(isValidMathExpression('x^2 + y^2 + z^2 <= 1', ['x', 'y', 'z'])).toBe(true);
      expect(isValidMathExpression('x^2 + y^2 <= 1', ['x', 'y', 'z'])).toBe(true);
      expect(isValidMathExpression('x^2 + y^2 + z^2 <= 1 and z >= 0', ['x', 'y', 'z'])).toBe(true);
      expect(isValidMathExpression('x^2 + y^2 < 4', ['x', 'y', 'z'])).toBe(true);
      expect(isValidMathExpression('z > x^2 + y^2', ['x', 'y', 'z'])).toBe(true);
    });

    it('should accept equality equations (handled by implicit builder)', () => {
      // The implicit builder converts "LHS = RHS" to "LHS - RHS" before evaluation
      // So we should accept = as valid for equationZ field
      expect(isValidMathExpression('x^2 + y^2 + z^2 = 1', ['x', 'y', 'z'], true)).toBe(true);
      expect(isValidMathExpression('x = 10', ['x'], true)).toBe(true);
    });

    it('should accept valid parametric equations', () => {
      expect(isValidMathExpression('u*cos(v)', ['u', 'v'])).toBe(true);
      expect(isValidMathExpression('u*sin(v)', ['u', 'v'])).toBe(true);
      expect(isValidMathExpression('v', ['u', 'v'])).toBe(true);
    });

    it('should accept valid revolution curves', () => {
      expect(isValidMathExpression('x = 10', ['x'])).toBe(true);
      expect(isValidMathExpression('y = x^2', ['x', 'y'])).toBe(true);
      expect(isValidMathExpression('sqrt(x)', ['x'])).toBe(true);
    });

    it('should reject descriptive titles', () => {
      expect(isValidMathExpression('Parametric Surface', ['x', 'y', 'z'])).toBe(false);
      expect(isValidMathExpression('Logical Solid', ['x', 'y', 'z'])).toBe(false);
      expect(isValidMathExpression('Revolved x = 10', ['x', 'y'])).toBe(false);
      expect(isValidMathExpression('3D Mathematical Graph', ['x', 'y', 'z'])).toBe(false);
      expect(isValidMathExpression('Surface Plot', ['x', 'y', 'z'])).toBe(false);
    });

    it('should reject empty or whitespace', () => {
      expect(isValidMathExpression('', ['x', 'y'])).toBe(false);
      expect(isValidMathExpression('   ', ['x', 'y'])).toBe(false);
    });

    it('should reject expressions with unknown symbols', () => {
      expect(isValidMathExpression('foo(x)', ['x'])).toBe(false);
      expect(isValidMathExpression('x + unknown', ['x'])).toBe(false);
    });
  });

  describe('extractPureMath', () => {
    it('should extract math from descriptive prefixes', () => {
      expect(extractPureMath('Revolved x = 10')).toBe('x = 10');
      expect(extractPureMath('Parametric: u*cos(v)')).toBe('u*cos(v)');
      expect(extractPureMath('Surface: sin(x)*cos(y)')).toBe('sin(x)*cos(y)');
      expect(extractPureMath('Logical Solid: x^2 + y^2 <= 1')).toBe('x^2 + y^2 <= 1');
    });

    it('should return original if no descriptive prefix', () => {
      expect(extractPureMath('x^2 + y^2')).toBe('x^2 + y^2');
      expect(extractPureMath('sin(u)*v')).toBe('sin(u)*v');
    });
  });

  describe('sanitizeExpressionFields', () => {
    it('should sanitize all expression fields in plot options', () => {
      const options = {
        equationZ: 'Parametric Surface',
        curve2D: 'Revolved x = 10',
        fTop: 'Logical Solid',
        fBottom: 'z = 0',
        xUV: 'u*cos(v)',
        yUV: 'u*sin(v)',
        zUV: 'v',
        zTop: 'sqrt(1 - x^2 - y^2)',
        zBottom: '0',
        domainMask: 'x^2 + y^2 <= 1',
        clippingPlane: 'z = 0.5',
      };

      const sanitized = sanitizeExpressionFields(options);

      // Descriptive titles should be nulled (no salvageable math)
      expect(sanitized.equationZ).toBeNull();
      expect(sanitized.fTop).toBeNull();

      // Descriptive text WITH salvageable math should be extracted
      expect(sanitized.curve2D).toBe('x = 10');

      // Valid math should be preserved
      expect(sanitized.fBottom).toBe('z = 0');
      expect(sanitized.xUV).toBe('u*cos(v)');
      expect(sanitized.yUV).toBe('u*sin(v)');
      expect(sanitized.zUV).toBe('v');
      expect(sanitized.zTop).toBe('sqrt(1 - x^2 - y^2)');
      expect(sanitized.zBottom).toBe('0');
      expect(sanitized.domainMask).toBe('x^2 + y^2 <= 1');
      expect(sanitized.clippingPlane).toBe('z = 0.5');
    });

    it('should handle missing fields gracefully', () => {
      const options = {
        equationZ: 'x^2 + y^2',
      };

      const sanitized = sanitizeExpressionFields(options);
      expect(sanitized.equationZ).toBe('x^2 + y^2');
    });
  });
});