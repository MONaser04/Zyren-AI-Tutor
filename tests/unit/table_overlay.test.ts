import { describe, it, expect } from 'vitest';
import { TableLayoutEngine } from '../../src/engine/TableLayoutEngine';
import type { TableOptions } from '../../src/types';

describe('TableLayoutEngine Unit Tests', () => {
  it('parses badges, math formulas, and regular text in cells accurately', () => {
    const successBadge = TableLayoutEngine.parseCellContent('[✓ Stable]');
    expect(successBadge.badge).toBeDefined();
    expect(successBadge.badge?.text).toBe('✓ Stable');
    expect(successBadge.badge?.variant).toBe('success');

    const dangerBadge = TableLayoutEngine.parseCellContent('[✗ Unstable]');
    expect(dangerBadge.badge).toBeDefined();
    expect(dangerBadge.badge?.variant).toBe('danger');

    const mathCell = TableLayoutEngine.parseCellContent('$O(n \\log n)$');
    expect(mathCell.isMath).toBe(true);
    expect(mathCell.latex).toBe('O(n \\log n)');

    const bareFormulaCell = TableLayoutEngine.parseCellContent('\\frac{a}{b}');
    expect(bareFormulaCell.isMath).toBe(true);
    expect(bareFormulaCell.latex).toBe('\\frac{a}{b}');

    const textCell = TableLayoutEngine.parseCellContent('Divide and Conquer algorithm');
    expect(textCell.isMath).toBe(false);
    expect(textCell.text).toBe('Divide and Conquer algorithm');
  });

  it('computes elastic column widths and row heights for comparison tables', () => {
    const options: TableOptions = {
      title: 'Sorting Algorithms Comparison',
      columns: ['Algorithm', 'Time Complexity', 'Space', 'Stability'],
      rows: [
        ['Merge Sort', '$O(n \\log n)$', '$O(n)$', '[✓ Stable]'],
        ['Quick Sort', '$O(n \\log n)$', '$O(\\log n)$', '[✗ Unstable]'],
        ['Bubble Sort', '$O(n^2)$', '$O(1)$', '[✓ Stable]'],
      ],
      position: 'full',
      theme: 'cyan',
    };

    const layout = TableLayoutEngine.computeLayout(options);

    expect(layout.title).toBe('Sorting Algorithms Comparison');
    expect(layout.theme).toBe('cyan');
    expect(layout.columns.length).toBe(4);
    expect(layout.rows.length).toBe(3);

    // Columns should sum up to target width
    const totalColsWidth = layout.columns.reduce((sum, c) => sum + c.width, 0);
    expect(totalColsWidth).toBe(layout.width);

    // First column ('Algorithm') should be left-aligned by default
    expect(layout.columns[0].align).toBe('left');
    // Middle columns should be center-aligned
    expect(layout.columns[1].align).toBe('center');

    // Height must be positive and bounded
    expect(layout.height).toBeGreaterThan(150);
    expect(layout.x).toBeGreaterThanOrEqual(100);
    expect(layout.y).toBe(180);
  });

  it('allocates proper slot dimensions for right-column position', () => {
    const options: TableOptions = {
      title: 'Quick Summary',
      columns: ['Property', 'Value'],
      rows: [
        ['Time Complexity', '$O(1)$'],
        ['Access Pattern', 'Direct Hash Indexing'],
      ],
      position: 'right',
      theme: 'emerald',
    };

    const layout = TableLayoutEngine.computeLayout(options);

    expect(layout.x).toBe(980);
    expect(layout.width).toBeLessThanOrEqual(840);
    expect(layout.theme).toBe('emerald');
    expect(layout.columns.length).toBe(2);
    expect(layout.rows.length).toBe(2);
  });

  it('handles object row records and custom explicit column widths', () => {
    const options: TableOptions = {
      title: 'System Benchmarks',
      columns: [
        { header: 'System', width: 220, align: 'left' },
        { header: 'Throughput', align: 'right' },
      ],
      rows: [
        { System: 'Rust Engine', Throughput: '1,200,000 req/s' },
        { System: 'Node.js', Throughput: '240,000 req/s' },
      ],
      theme: 'purple',
    };

    const layout = TableLayoutEngine.computeLayout(options);

    expect(layout.columns[0].width).toBeGreaterThanOrEqual(220);
    expect(layout.columns[0].align).toBe('left');
    expect(layout.columns[1].align).toBe('right');
    expect(layout.rows[0].cells[0].text).toBe('Rust Engine');
    expect(layout.rows[0].cells[1].text).toBe('1,200,000 req/s');
  });
});
