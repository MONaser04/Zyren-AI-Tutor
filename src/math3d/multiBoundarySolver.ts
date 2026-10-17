import { compileMathFunction, compileDomainMask } from './compiler';

export interface BoundaryPair {
  upperFn: (x: number, y: number) => number;
  lowerFn: (x: number, y: number) => number;
  maskFn: (x: number, y: number) => boolean;
}

export interface MultiBoundarySystem {
  evaluateAt: (x: number, y: number) => { zMax: number; zMin: number; isValid: boolean };
  formulaLabel: string;
}

/**
 * Parses any compound set of 3D spatial inequalities/equations:
 * e.g. "x^2 + z^2 <= 1 and y^2 + z^2 <= 1"
 * e.g. "x^2 + z^2 <= 1 and x^2 + y^2 <= 1"
 * e.g. "z <= x + 2 and z >= x^2 + y^2"
 * e.g. "x^2 + y^2 + z^2 <= 4 and z >= 1"
 */
export function buildMultiBoundarySystem(
  rawExpr: string,
  explicitZTop?: string,
  explicitZBottom?: string,
  explicitDomainMask?: string
): MultiBoundarySystem {
  const cleanInput = (rawExpr || '').trim();

  // If explicit zTop and zBottom were given separately and no complex compound expression:
  if (explicitZTop && explicitZBottom && !cleanInput.includes(' and ') && !cleanInput.includes('&&')) {
    const topFn = compileMathFunction(explicitZTop, (x, y) => x + 2);
    const botFn = compileMathFunction(explicitZBottom, (x, y) => x * x + y * y);
    const maskFn = compileDomainMask(explicitDomainMask);

    return {
      evaluateAt: (x: number, y: number) => {
        const inMask = maskFn(x, y);
        if (!inMask) return { zMax: 0, zMin: 0, isValid: false };
        const zt = topFn(x, y);
        const zb = botFn(x, y);
        return { zMax: zt, zMin: zb, isValid: zt >= zb - 1e-4 };
      },
      formulaLabel: `[${explicitZBottom} ≤ z ≤ ${explicitZTop}]`,
    };
  }

  // Tokenize compound statements by: 'and', '&&', ';', '\n', ','
  const clauses = cleanInput
    .split(/\s+(?:and|&&)\s+|[;\n,]+/i)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  // If no clauses found, fallback to defaults
  if (clauses.length === 0) {
    const topFn = compileMathFunction(explicitZTop || 'x + 2');
    const botFn = compileMathFunction(explicitZBottom || 'x^2 + y^2');
    const maskFn = compileDomainMask(explicitDomainMask);

    return {
      evaluateAt: (x: number, y: number) => {
        const inMask = maskFn(x, y);
        if (!inMask) return { zMax: 0, zMin: 0, isValid: false };
        const zt = topFn(x, y);
        const zb = botFn(x, y);
        return { zMax: zt, zMin: zb, isValid: zt >= zb - 1e-4 };
      },
      formulaLabel: `[${explicitZBottom || 'x^2 + y^2'} ≤ z ≤ ${explicitZTop || 'x + 2'}]`,
    };
  }

  const boundaryPairs: BoundaryPair[] = [];
  const domain2DMasks: Array<(x: number, y: number) => boolean> = [];

  if (explicitDomainMask) {
    domain2DMasks.push(compileDomainMask(explicitDomainMask));
  }

  for (const rawClause of clauses) {
    let clause = rawClause.toLowerCase().replace(/\s+/g, ' ');

    // Extract constant or radius squared on RHS
    const rMatch = clause.match(/(?:<=|=|≤|>=|≥)\s*(\d+(?:\.\d+)?)/);
    const rSq = rMatch ? parseFloat(rMatch[1]) : 1;

    // 1. Horizontal Cylinder along Y: x^2 + z^2 <= R^2 or z^2 <= R^2 - x^2
    if (clause.includes('x^2 + z^2') || clause.includes('x**2 + z**2') || clause.includes('z^2 + x^2') || clause.includes('z**2 + x**2')) {
      boundaryPairs.push({
        upperFn: (x) => Math.sqrt(Math.max(0, rSq - x * x)),
        lowerFn: (x) => -Math.sqrt(Math.max(0, rSq - x * x)),
        maskFn: (x) => x * x <= rSq + 1e-5,
      });
      continue;
    }

    // 2. Horizontal Cylinder along X: y^2 + z^2 <= R^2 or z^2 <= R^2 - y^2
    if (clause.includes('y^2 + z^2') || clause.includes('y**2 + z**2') || clause.includes('z^2 + y^2') || clause.includes('z**2 + y**2')) {
      boundaryPairs.push({
        upperFn: (_x, y) => Math.sqrt(Math.max(0, rSq - y * y)),
        lowerFn: (_x, y) => -Math.sqrt(Math.max(0, rSq - y * y)),
        maskFn: (_x, y) => y * y <= rSq + 1e-5,
      });
      continue;
    }

    // 3. Sphere: x^2 + y^2 + z^2 <= R^2
    if (clause.includes('x^2 + y^2 + z^2') || clause.includes('x**2 + y**2 + z**2')) {
      boundaryPairs.push({
        upperFn: (x, y) => Math.sqrt(Math.max(0, rSq - x * x - y * y)),
        lowerFn: (x, y) => -Math.sqrt(Math.max(0, rSq - x * x - y * y)),
        maskFn: (x, y) => x * x + y * y <= rSq + 1e-5,
      });
      continue;
    }

    // 4. Vertical Cylinder / 2D Disk in XY plane: x^2 + y^2 <= R^2
    if (clause.includes('x^2 + y^2') || clause.includes('x**2 + y**2')) {
      domain2DMasks.push((x, y) => x * x + y * y <= rSq + 1e-5);
      continue;
    }

    // 5. Lower half-space or cut: z >= val or z > val
    const zLowerMatch = clause.match(/z\s*(?:>=|≥|>)\s*([^<>=≤≥]+)/);
    if (zLowerMatch) {
      const rhsFn = compileMathFunction(zLowerMatch[1]);
      boundaryPairs.push({
        upperFn: () => Infinity,
        lowerFn: (x, y) => rhsFn(x, y),
        maskFn: () => true,
      });
      continue;
    }

    // 6. Upper half-space or cut: z <= val or z < val
    const zUpperMatch = clause.match(/z\s*(?:<=|≤|<)\s*([^<>=≤≥]+)/);
    if (zUpperMatch) {
      const rhsFn = compileMathFunction(zUpperMatch[1]);
      boundaryPairs.push({
        upperFn: (x, y) => rhsFn(x, y),
        lowerFn: () => -Infinity,
        maskFn: () => true,
      });
      continue;
    }

    // 7. General z^2 <= g(x, y)
    const zSqMatch = clause.match(/z\s*(?:\^|\*\*)\s*2\s*(?:<=|≤|=)\s*(.+)/);
    if (zSqMatch) {
      const gFn = compileMathFunction(zSqMatch[1]);
      boundaryPairs.push({
        upperFn: (x, y) => Math.sqrt(Math.max(0, gFn(x, y))),
        lowerFn: (x, y) => -Math.sqrt(Math.max(0, gFn(x, y))),
        maskFn: (x, y) => gFn(x, y) >= -1e-5,
      });
      continue;
    }

    // 8. General 2D domain condition (e.g. abs(x) <= 1, y <= x)
    domain2DMasks.push(compileDomainMask(clause));
  }

  // If no boundary pairs formed (e.g. all clauses were 2D), add fallback explicit surfaces
  if (boundaryPairs.length === 0) {
    const topFn = compileMathFunction(explicitZTop || 'x + 2');
    const botFn = compileMathFunction(explicitZBottom || 'x^2 + y^2');
    boundaryPairs.push({
      upperFn: topFn,
      lowerFn: botFn,
      maskFn: () => true,
    });
  }

  // Composite evaluator function
  const evaluateAt = (x: number, y: number) => {
    // 1. Check all 2D domain masks
    for (const mask of domain2DMasks) {
      if (!mask(x, y)) {
        return { zMax: 0, zMin: 0, isValid: false };
      }
    }

    // 2. Check each boundary pair mask
    for (const pair of boundaryPairs) {
      if (!pair.maskFn(x, y)) {
        return { zMax: 0, zMin: 0, isValid: false };
      }
    }

    // 3. Compute dynamic intersection: zMax = min(all upper), zMin = max(all lower)
    let zMax = Infinity;
    let zMin = -Infinity;

    for (const pair of boundaryPairs) {
      const u = pair.upperFn(x, y);
      const l = pair.lowerFn(x, y);
      if (u < zMax) zMax = u;
      if (l > zMin) zMin = l;
    }

    // Valid only if zMax >= zMin
    const isValid = zMax >= zMin - 1e-4 && isFinite(zMax) && isFinite(zMin);
    return { zMax, zMin, isValid };
  };

  return {
    evaluateAt,
    formulaLabel: cleanInput || `[${explicitZBottom || 'z_min'} ≤ z ≤ ${explicitZTop || 'z_max'}]`,
  };
}
