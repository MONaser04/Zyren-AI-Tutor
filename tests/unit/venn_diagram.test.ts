import { describe, it, expect } from 'vitest';
import { resolveVennMinterms } from '../../src/layers/VennOverlay';

describe('VennOverlay - Boolean Set Operation & Minterm Resolver', () => {
  describe('2-Set Venn Diagrams', () => {
    it('resolves standard intersection operations (P(A ∩ B))', () => {
      const ops = ['intersection', 'intersect', 'a and b', 'P(A and B)', 'p(a intersect b)', 'a_and_b', 'both'];
      for (const op of ops) {
        const minterms = resolveVennMinterms(2, op);
        expect(Array.from(minterms)).toEqual(['A_and_B']);
      }
    });

    it('resolves union operations (P(A ∪ B)) to all three subset minterms', () => {
      const ops = ['union', 'a or b', 'P(A or B)', 'p(a union b)', 'either'];
      for (const op of ops) {
        const minterms = resolveVennMinterms(2, op);
        expect(minterms.has('A_only')).toBe(true);
        expect(minterms.has('A_and_B')).toBe(true);
        expect(minterms.has('B_only')).toBe(true);
        expect(minterms.has('neither')).toBe(false);
        expect(minterms.size).toBe(3);
      }
    });

    it('resolves relative complement / set difference A \\ B', () => {
      const ops = ['a_only', 'a only', 'a minus b', 'a \\ b', 'a and not b'];
      for (const op of ops) {
        const minterms = resolveVennMinterms(2, op);
        expect(Array.from(minterms)).toEqual(['A_only']);
      }
    });

    it('resolves relative complement / set difference B \\ A', () => {
      const ops = ['b_only', 'b only', 'b minus a', 'b \\ a', 'b and not a'];
      for (const op of ops) {
        const minterms = resolveVennMinterms(2, op);
        expect(Array.from(minterms)).toEqual(['B_only']);
      }
    });

    it('resolves complement of union (neither / outside)', () => {
      const ops = ['neither', 'none', 'outside', 'not (a or b)', 'nor'];
      for (const op of ops) {
        const minterms = resolveVennMinterms(2, op);
        expect(Array.from(minterms)).toEqual(['neither']);
      }
    });

    it('resolves complement of A (not A / A prime)', () => {
      const ops = ['complement_a', 'not a', "a'", 'p(not a)', 'a_prime'];
      for (const op of ops) {
        const minterms = resolveVennMinterms(2, op);
        expect(minterms.has('B_only')).toBe(true);
        expect(minterms.has('neither')).toBe(true);
        expect(minterms.has('A_only')).toBe(false);
        expect(minterms.has('A_and_B')).toBe(false);
        expect(minterms.size).toBe(2);
      }
    });

    it('resolves complement of B (not B / B prime)', () => {
      const ops = ['complement_b', 'not b', "b'", 'p(not b)', 'b_prime'];
      for (const op of ops) {
        const minterms = resolveVennMinterms(2, op);
        expect(minterms.has('A_only')).toBe(true);
        expect(minterms.has('neither')).toBe(true);
        expect(minterms.has('B_only')).toBe(false);
        expect(minterms.has('A_and_B')).toBe(false);
        expect(minterms.size).toBe(2);
      }
    });

    it('resolves symmetric difference (XOR: (A \\ B) ∪ (B \\ A))', () => {
      const ops = ['xor', 'symmetric_difference'];
      for (const op of ops) {
        const minterms = resolveVennMinterms(2, op);
        expect(minterms.has('A_only')).toBe(true);
        expect(minterms.has('B_only')).toBe(true);
        expect(minterms.has('A_and_B')).toBe(false);
        expect(minterms.size).toBe(2);
      }
    });

    it('honors explicit minterms when provided directly', () => {
      const explicit = ['A_only', 'neither'];
      const minterms = resolveVennMinterms(2, undefined, explicit);
      expect(Array.from(minterms)).toEqual(['A_only', 'neither']);
    });
  });

  describe('3-Set Venn Diagrams', () => {
    it('resolves intersection of all three sets (P(A ∩ B ∩ C))', () => {
      const ops = ['all', 'intersection', 'a and b and c', 'center'];
      for (const op of ops) {
        const minterms = resolveVennMinterms(3, op);
        expect(Array.from(minterms)).toEqual(['A_and_B_and_C']);
      }
    });

    it('resolves 3-set union (P(A ∪ B ∪ C)) to all seven subset regions', () => {
      const ops = ['union', 'any', 'a or b or c'];
      for (const op of ops) {
        const minterms = resolveVennMinterms(3, op);
        expect(minterms.size).toBe(7);
        expect(minterms.has('A_only')).toBe(true);
        expect(minterms.has('B_only')).toBe(true);
        expect(minterms.has('C_only')).toBe(true);
        expect(minterms.has('A_and_B_only')).toBe(true);
        expect(minterms.has('A_and_C_only')).toBe(true);
        expect(minterms.has('B_and_C_only')).toBe(true);
        expect(minterms.has('A_and_B_and_C')).toBe(true);
        expect(minterms.has('neither')).toBe(false);
      }
    });

    it('resolves pair-wise intersections in 3-set diagram', () => {
      const ab = resolveVennMinterms(3, 'a and b');
      expect(ab.has('A_and_B_only')).toBe(true);
      expect(ab.has('A_and_B_and_C')).toBe(true);
      expect(ab.size).toBe(2);

      const ac = resolveVennMinterms(3, 'a and c');
      expect(ac.has('A_and_C_only')).toBe(true);
      expect(ac.has('A_and_B_and_C')).toBe(true);
      expect(ac.size).toBe(2);

      const bc = resolveVennMinterms(3, 'b and c');
      expect(bc.has('B_and_C_only')).toBe(true);
      expect(bc.has('A_and_B_and_C')).toBe(true);
      expect(bc.size).toBe(2);
    });

    it('resolves single sets only in 3-set diagram', () => {
      expect(Array.from(resolveVennMinterms(3, 'a_only'))).toEqual(['A_only']);
      expect(Array.from(resolveVennMinterms(3, 'b_only'))).toEqual(['B_only']);
      expect(Array.from(resolveVennMinterms(3, 'c_only'))).toEqual(['C_only']);
    });

    it('resolves complement of 3-set union (neither)', () => {
      expect(Array.from(resolveVennMinterms(3, 'neither'))).toEqual(['neither']);
    });
  });
});
