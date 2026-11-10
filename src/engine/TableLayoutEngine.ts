/**
 * TableLayoutEngine — Multi-Pass Elastic Pedagogical Table Layout Engine.
 *
 * Computes deterministic, high-readability column auto-sizing, row height
 * synchronization, and slot placement on the 1920x1080 whiteboard canvas.
 */

import type { TableColumn, TableOptions, TableTheme } from '../types';

export interface ComputedCell {
  text: string;
  isMath: boolean;
  latex?: string;
  badge?: {
    text: string;
    variant: 'success' | 'danger' | 'warning' | 'info';
  };
}

export interface ComputedRow {
  id: string;
  cells: ComputedCell[];
  height: number;
}

export interface ComputedColumn {
  id: string;
  header: string;
  width: number;
  align: 'left' | 'center' | 'right';
  color?: string;
}

export interface ComputedTableLayout {
  id: string;
  title: string;
  x: number;
  y: number;
  width: number;
  height: number;
  columns: ComputedColumn[];
  rows: ComputedRow[];
  theme: TableTheme;
  titleHeight: number;
  headerHeight: number;
  fontSize: number;
}

export class TableLayoutEngine {
  public static readonly CANVAS_WIDTH = 1920;
  public static readonly CANVAS_HEIGHT = 1080;
  public static readonly DEFAULT_START_Y = 180;
  public static readonly MIN_COL_WIDTH = 130;
  public static readonly MAX_COL_WIDTH = 580;
  public static readonly CELL_PADDING_X = 28; // 14px on left + 14px on right
  public static readonly BASE_ROW_HEIGHT = 44;
  public static readonly HEADER_HEIGHT = 46;
  public static readonly TITLE_HEIGHT = 42;

  /**
   * Main entrypoint to compute table layout.
   */
  public static computeLayout(
    options: TableOptions & { id?: string; x?: number; y?: number; width?: number; height?: number }
  ): ComputedTableLayout {
    const tableId = options.id || `table_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const title = (options.title || '').trim();
    const theme = options.theme || 'cyan';
    const fontSize = options.fontSize || 16;
    const isCompact = Boolean(options.compact);

    // 1. Normalize columns
    const rawCols = options.columns && options.columns.length > 0 ? options.columns : ['Column 1', 'Column 2'];
    const normalizedCols: Array<{
      id: string;
      header: string;
      explicitWidth?: number;
      align: 'left' | 'center' | 'right';
      color?: string;
    }> = rawCols.map((c, idx) => {
      if (typeof c === 'string') {
        return {
          id: `col_${idx}`,
          header: c.trim(),
          align: idx === 0 ? 'left' : 'center',
        };
      }
      return {
        id: c.id || `col_${idx}`,
        header: (c.header || `Column ${idx + 1}`).trim(),
        explicitWidth: c.width,
        align: c.align || (idx === 0 ? 'left' : 'center'),
        color: c.color,
      };
    });

    const colCount = normalizedCols.length;

    // 2. Normalize rows and parse cell contents
    const rawRows = Array.isArray(options.rows) ? options.rows : [];
    const parsedRows: ComputedCell[][] = rawRows.map((r, rowIdx) => {
      const rowCells: ComputedCell[] = [];
      for (let cIdx = 0; cIdx < colCount; cIdx++) {
        let rawVal = '';
        if (Array.isArray(r)) {
          rawVal = r[cIdx] !== undefined && r[cIdx] !== null ? String(r[cIdx]) : '';
        } else if (typeof r === 'object' && r !== null) {
          const colKey = normalizedCols[cIdx].header || normalizedCols[cIdx].id;
          rawVal = (r as any)[colKey] !== undefined ? String((r as any)[colKey]) : '';
        }
        rowCells.push(this.parseCellContent(rawVal));
      }
      return rowCells;
    });

    // 3. Pass 1: Compute Min-Content (unbreakable words) and Preferred (prose) widths for each column
    const minColWidths: number[] = [];
    const preferredColWidths: number[] = [];

    normalizedCols.forEach((col, cIdx) => {
      if (col.explicitWidth && col.explicitWidth > 40) {
        minColWidths.push(col.explicitWidth);
        preferredColWidths.push(col.explicitWidth);
        return;
      }

      // 3.1 Longest unbreakable word in header
      const headerWords = col.header.split(/\s+/).filter(Boolean);
      let longestWordW = headerWords.length > 0
        ? Math.max(...headerWords.map((w) => this.estimateTextWidth(w, fontSize + 1, true)))
        : this.estimateTextWidth(col.header, fontSize + 1, true);
      let maxNaturalW = this.estimateTextWidth(col.header, fontSize + 1, true);

      // 3.2 Longest unbreakable word across all cells in this column
      parsedRows.forEach((row) => {
        const cell = row[cIdx];
        if (cell) {
          const wordW = this.estimateLongestWordWidth(cell, fontSize);
          if (wordW > longestWordW) {
            longestWordW = wordW;
          }
          const cellNaturalW = this.estimateCellWidth(cell, fontSize);
          if (cellNaturalW > maxNaturalW) {
            maxNaturalW = cellNaturalW;
          }
        }
      });

      // minContent: Longest unbreakable word + horizontal cell padding (28px) + safety buffer (20px)
      // This strictly guarantees that whole words will NEVER be broken across lines
      const minW = Math.max(this.MIN_COL_WIDTH, longestWordW + this.CELL_PADDING_X + 20);
      minColWidths.push(minW);

      // preferredContent: Natural width with reading comfort upper clamp
      const prefW = Math.max(minW, Math.min(this.MAX_COL_WIDTH, maxNaturalW + this.CELL_PADDING_X + 16));
      preferredColWidths.push(prefW);
    });

    // 4. Pass 2: Determine Table Target Width & Canvas Slot
    const sumMin = minColWidths.reduce((a, b) => a + b, 0);
    const sumPref = preferredColWidths.reduce((a, b) => a + b, 0);

    const position = options.position || 'auto';
    let targetX = options.x !== undefined ? options.x : 160;
    let targetY = options.y !== undefined ? options.y : this.DEFAULT_START_Y;
    let targetTotalWidth = sumPref;

    if (position === 'full' || (position === 'auto' && (colCount >= 3 || sumPref > 920))) {
      // Full-width comparison table
      const maxWidthAllowed = 1580;
      targetTotalWidth = Math.max(sumMin, Math.min(maxWidthAllowed, Math.max(1200, sumPref)));
      targetX = Math.round((this.CANVAS_WIDTH - targetTotalWidth) / 2);
    } else if (position === 'right' || position === 'column_2') {
      // Column 2 placement beside left notes
      targetTotalWidth = Math.max(sumMin, Math.min(840, sumPref));
      targetX = 980;
    } else if (position === 'column_1') {
      // Column 1 placement
      targetTotalWidth = Math.max(sumMin, Math.min(800, sumPref));
      targetX = 150;
    } else if (position === 'bottom') {
      // Bottom horizontal placement
      targetTotalWidth = Math.max(sumMin, Math.min(1500, sumPref));
      targetX = Math.round((this.CANVAS_WIDTH - targetTotalWidth) / 2);
      targetY = 560;
    } else {
      // Auto compact center
      targetTotalWidth = Math.max(sumMin, Math.min(1360, sumPref));
      targetX = Math.round((this.CANVAS_WIDTH - targetTotalWidth) / 2);
    }

    // 5. Scale Column Widths to fit Target Total Width
    // Guarantee minContentWidth for every column, and distribute extra width proportionally
    const remainingExtra = Math.max(0, targetTotalWidth - sumMin);
    const excessWeights = preferredColWidths.map((pref, i) => Math.max(0, pref - minColWidths[i]));
    const sumExcess = excessWeights.reduce((a, b) => a + b, 0);

    const computedColumns: ComputedColumn[] = normalizedCols.map((col, idx) => {
      let finalW = col.explicitWidth;
      if (!finalW) {
        if (sumExcess > 0) {
          finalW = minColWidths[idx] + Math.round((excessWeights[idx] / sumExcess) * remainingExtra);
        } else {
          finalW = minColWidths[idx] + Math.round(remainingExtra / colCount);
        }
      }
      finalW = Math.max(minColWidths[idx], finalW);
      return {
        id: col.id,
        header: col.header,
        width: finalW,
        align: col.align,
        color: col.color,
      };
    });

    // Adjust rounding difference on last column
    const actualSum = computedColumns.reduce((sum, c) => sum + c.width, 0);
    const diff = targetTotalWidth - actualSum;
    if (computedColumns.length > 0 && diff !== 0) {
      computedColumns[computedColumns.length - 1].width += diff;
    }

    // 6. Pass 3: Calculate dynamic Row Heights based on wrapped content
    const baseRowH = isCompact ? 36 : this.BASE_ROW_HEIGHT;
    const computedRows: ComputedRow[] = parsedRows.map((rowCells, rowIdx) => {
      let maxCellHeight = baseRowH;

      rowCells.forEach((cell, cIdx) => {
        const colWidth = computedColumns[cIdx]?.width || 140;
        const availableTextWidth = Math.max(60, colWidth - this.CELL_PADDING_X);
        const cellH = this.estimateCellHeight(cell, availableTextWidth, fontSize, isCompact);
        if (cellH > maxCellHeight) {
          maxCellHeight = cellH;
        }
      });

      return {
        id: `row_${rowIdx}`,
        cells: rowCells,
        height: maxCellHeight,
      };
    });

    // 7. Calculate Total Table Bounding Box Height
    const titleH = title ? this.TITLE_HEIGHT : 0;
    const headerH = isCompact ? 40 : this.HEADER_HEIGHT;
    const rowsTotalH = computedRows.reduce((sum, r) => sum + r.height, 0);
    const totalTableHeight = titleH + headerH + rowsTotalH + 12; // 12px bottom padding

    return {
      id: tableId,
      title,
      x: targetX,
      y: targetY,
      width: targetTotalWidth,
      height: totalTableHeight,
      columns: computedColumns,
      rows: computedRows,
      theme,
      titleHeight: titleH,
      headerHeight: headerH,
      fontSize,
    };
  }

  /**
   * Parses raw string value into structured cell with math and badge support.
   */
  public static parseCellContent(val: string): ComputedCell {
    const raw = String(val || '').trim();
    if (!raw) {
      return { text: '', isMath: false };
    }

    // 1. Badge detection: [✓ ...], [✗ ...], [YES], [NO], etc.
    const badgeMatch = raw.match(/^\[([✓✗⚡⚠️*+\-A-Z0-9\s_]+)\]$/i);
    if (badgeMatch) {
      const inner = badgeMatch[1].trim();
      let variant: 'success' | 'danger' | 'warning' | 'info' = 'info';
      if (/^[✓+]|yes|true|pass|high|optimal|fast/i.test(inner)) {
        variant = 'success';
      } else if (/^[✗\-]|no|false|fail|poor|slow|low/i.test(inner)) {
        variant = 'danger';
      } else if (/^⚠️|warn|medium|moderate/i.test(inner)) {
        variant = 'warning';
      } else if (/^⚡|o\(1\)|quick|instant/i.test(inner)) {
        variant = 'info';
      }
      return {
        text: inner,
        isMath: false,
        badge: { text: inner, variant },
      };
    }

    // 2. LaTeX Math detection: $...$ or starts with \ or contains formula symbols
    const mathDelimMatch = raw.match(/^\$([^$]+)\$$/);
    if (mathDelimMatch) {
      return {
        text: raw,
        isMath: true,
        latex: mathDelimMatch[1].trim(),
      };
    }

    if (/^\\(frac|sqrt|sum|prod|int|alpha|beta|gamma|theta|lambda|pi|sigma|mathbf|text|mathcal|infty)/.test(raw) ||
        /\bO\([n\d\s\w^+\-*\/log]+\)/i.test(raw) ||
        /^[x-z]\s*=\s*[\d\w]/i.test(raw)) {
      return {
        text: raw,
        isMath: true,
        latex: raw,
      };
    }

    // 3. Regular text cell
    return {
      text: raw,
      isMath: false,
    };
  }

  /**
   * Estimates rendered text width in pixels.
   */
  private static estimateTextWidth(text: string, fontSize: number, isBold: boolean = false): number {
    if (!text) return 0;
    const charFactor = isBold ? 9.5 : 8.5;
    const scale = fontSize / 16;
    return Math.round(text.length * charFactor * scale);
  }

  /**
   * Estimates cell width taking into account math expressions and badges.
   */
  private static estimateCellWidth(cell: ComputedCell, fontSize: number): number {
    if (cell.badge) {
      return this.estimateTextWidth(cell.badge.text, fontSize - 1, true) + 28;
    }
    if (cell.isMath && cell.latex) {
      return this.estimateTextWidth(cell.latex, fontSize + 1, false) + 20;
    }
    return this.estimateTextWidth(cell.text, fontSize, false);
  }

  /**
   * Estimates cell height based on wrapped lines.
   */
  private static estimateCellHeight(
    cell: ComputedCell,
    availableWidth: number,
    fontSize: number,
    isCompact: boolean
  ): number {
    const naturalW = this.estimateCellWidth(cell, fontSize);
    const lines = Math.max(1, Math.ceil(naturalW / Math.max(50, availableWidth)));
    const lineHeight = isCompact ? 20 : 24;
    const padding = isCompact ? 12 : 20;
    return lines * lineHeight + padding;
  }

  /**
   * Estimates the rendered pixel width of the longest unbreakable word in a cell.
   * Guarantees that columns are never compressed below this width, preventing any word splitting.
   */
  private static estimateLongestWordWidth(cell: ComputedCell, fontSize: number): number {
    if (cell.badge) {
      return this.estimateTextWidth(cell.badge.text, fontSize - 1, true) + 28;
    }
    if (cell.isMath && cell.latex) {
      return this.estimateTextWidth(cell.latex, fontSize + 1, false) + 20;
    }
    const words = String(cell.text || '').split(/\s+/).filter(Boolean);
    if (words.length === 0) return 0;
    let maxW = 0;
    for (const w of words) {
      const wWidth = this.estimateTextWidth(w, fontSize, false);
      if (wWidth > maxW) {
        maxW = wWidth;
      }
    }
    return maxW;
  }
}
