/**
 * CollisionDetector — Intelligent Blackboard Layout Engine, Elastic Typography & Column Flow Resolver.
 *
 * Enforces:
 * 1. Accurate multi-line & formula-complexity-aware bounding box calculations.
 * 2. Elastic column width with widow/orphan tail lookahead so short equation tails (like '= 9') never wrap awkwardly.
 * 3. Deterministic Sequential Gravity-Snap Flow in Column 1 (x = 150) and Column 2 (x = 1000) with zero vertical gaps.
 * 4. Side-by-side inline annotation alignment when placing a short note next to a short equation.
 * 5. Automatic detection of standalone mathematical equations for KaTeX routing.
 * 6. Safe Board-Full Detection (returning { x: -1, y: -1 } when both columns are full).
 */

export const CANVAS_WIDTH = 1920;
export const CANVAS_HEIGHT = 1080;

export const SAFE_MIN_X = 120;
export const SAFE_MAX_X = 1800;
export const SAFE_MIN_Y = 100;
export const SAFE_MAX_Y = 980;
export const DEFAULT_HEADER_HEIGHT = 160;
export const COL1_X = 150;
export const COL2_X = 1000;

export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Splits raw text into clean logical lines:
 * 1. Preserves explicit '\n' and escaped '\\n' line breaks.
 * 2. Automatically separates multiple numbered, lettered, or bulleted list items
 *    that were concatenated onto a single line without newlines.
 */
export function splitIntoLogicalLines(rawText: string): string[] {
  if (!rawText) return [];

  let normalized = String(rawText)
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/\\n/g, '\n');

  // Split inline numbered list items (e.g. "1. First item 2. Second item") while avoiding decimals or "z.B."
  normalized = normalized.replace(
    /(\S[^\n]{2,}?)\s+(?=(?:[2-9]\.|1\d\.|[ii]{2,3}\)|[•●▪]\s|-\s+[A-ZÄÖÜ]))/g,
    '$1\n'
  );

  // Split paired inline definitions separated by slash or space after closing paren (e.g. "Unary: ... (3²) Binary: ... (3 + 4)")
  normalized = normalized.replace(
    /(\))\s*(?:\/\s*)?(?=[A-ZÄÖÜ][a-zA-Zäöüß]+(?:\s*\([^)]+\))?\s*:)/g,
    '$1\n'
  );

  const lines = normalized
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  return lines.length > 0 ? lines : [rawText.trim()];
}

/**
 * Normalizes leaked LaTeX commands and math delimiters inside prose sentences
 * so raw dollar signs ($), backslashes (\), or unrendered symbols never appear in text/handwriting.
 */
export function normalizeProseMathAndSymbols(text: string): string {
  if (!text) return '';

  let s = String(text);

  // Strip inline $...$ delimiters while keeping their inner math content
  s = s.replace(/\$\$([^$]+)\$\$/g, '$1').replace(/\$([^$]+)\$/g, '$1');

  // Convert common LaTeX operators and arrows to clean readable notation
  s = s
    .replace(/\\cdot\b/g, '·')
    .replace(/\\times\b/g, '×')
    .replace(/\\div\b/g, '÷')
    .replace(/\\pm\b/g, '±')
    .replace(/\\mp\b/g, '∓')
    .replace(/\\neq\b/g, '!=')
    .replace(/\\leq?\b/g, '<=')
    .replace(/\\geq?\b/g, '>=')
    .replace(/\\equiv\b/g, ':=')
    .replace(/\\approx\b/g, '~=')
    .replace(/\\(?:rightarrow|to)\b/g, '->')
    .replace(/\\Rightarrow\b/g, '=>')
    .replace(/\\leftrightarrow\b/g, '<->')
    .replace(/\\Leftrightarrow\b/g, '<=>')
    .replace(/\\infty\b/g, 'inf')
    .replace(/\\quad\b/g, '  ')
    .replace(/\\qquad\b/g, '   ')
    .replace(/\\text\{([^}]*)\}/g, '$1');

  // Convert simple \frac{a}{b} inside prose to (a/b)
  s = s.replace(/\\frac\{([^{}]+)\}\{([^{}]+)\}/g, '($1/$2)');

  // Strip any non-Latin / non-German / Arabic script blocks that could produce missing-glyph boxes on the board
  s = s.replace(/\(\s*[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF\s]+\s*\)/g, '');
  s = s.replace(/[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]+/g, '');

  return s.replace(/\s{2,}/g, ' ').trim();
}

/**
 * Determines whether a text string is a standalone mathematical equation, symbolic identity,
 * or worked calculation that should be rendered with the dedicated KaTeX MathOverlay
 * rather than prose handwriting or plain canvas text.
 */
export function isStandaloneMathExpression(text: string): boolean {
  if (!text) return false;
  const trimmed = text.trim();
  if (!trimmed) return false;

  // Multi-line notes/lists are handled as structured text blocks
  const lines = splitIntoLogicalLines(trimmed);
  if (lines.length > 1) return false;

  // Strip optional short list prefix like "1.", "i)", "ii)", "-"
  const withoutPrefix = trimmed.replace(/^(?:[1-9]\.|[ivx]+\)|-|\•)\s*/i, '').trim();
  if (!withoutPrefix) return false;

  // Explicitly wrapped in $...$ or $$...$$ with no surrounding prose outside
  if (/^\$\$?[^$]+\$\$?$/.test(withoutPrefix)) {
    return true;
  }

  // Structural LaTeX commands always belong in KaTeX
  if (/\\(?:frac|sqrt|sum|int|prod|oint|boxed|left|right|begin|matrix|pmatrix|bmatrix|cases|overline|underline)\b/.test(withoutPrefix)) {
    return true;
  }

  // Prose arrows ("->", "=>") or colons (other than ":=") indicate linguistic definitions/notes
  const withoutDefEq = withoutPrefix.replace(/:=/g, '=');
  if (/->|=>|:/.test(withoutDefEq)) {
    return false;
  }

  // Check if it contains LaTeX math operators (\cdot, \times, \div, \pm)
  const hasLatexOp = /\\(?:cdot|times|div|pm|mp|quad|qquad|text)\b/.test(withoutPrefix);

  // Remove LaTeX commands and math function names, then count remaining multi-letter prose words (3+ letters)
  const strippedForWords = withoutPrefix
    .replace(/\\text\{[^}]*\}/g, ' ')
    .replace(/\\[a-zA-Z]+/g, ' ')
    .replace(/\b(?:sin|cos|tan|cot|sec|csc|log|ln|exp|lim|max|min|sup|inf|mod|gcd|lcm|and|und|or|oder|mit|for)\b/gi, ' ');

  const proseWords = strippedForWords.match(/[a-zA-ZäöüßÄÖÜ]{3,}/g) || [];

  if (hasLatexOp && proseWords.length <= 1) {
    return true;
  }

  // Check for mathematical operators/exponents/relations
  const hasMathOperator = /[=+\-*/^_²³¹⁰⁴⁵⁶⁷⁸⁹±×÷·<>]/.test(withoutPrefix);
  const hasDigitOrSingleVar = /\d|\b[a-zA-Z]\b/.test(withoutPrefix);

  // Pure symbolic/numeric expression with zero prose words (e.g., "a + b = c", "3^2 = 9", "10 - 5 - 2 = 10 + (-5) + (-2)", "ii) -(-b) = b")
  if (hasMathOperator && hasDigitOrSingleVar && proseWords.length === 0) {
    return true;
  }

  return false;
}

/**
 * Cleans and normalizes a mathematical string into valid KaTeX LaTeX syntax.
 */
export function cleanLatexForMathOverlay(text: string): string {
  let s = (text || '').trim();

  // Strip outer $...$ or $$...$$
  s = s.replace(/^\$\$([\s\S]*)\$\$$/, '$1').replace(/^\$([\s\S]*)\$$/, '$1').trim();

  // If there is a leading enumeration prefix like "i) " or "ii) ", wrap the prefix in \text{...}
  const prefixMatch = s.match(/^([ivx]+\)|[1-9]\.)\s+(.*)$/i);
  if (prefixMatch) {
    s = `\\text{${prefixMatch[1]} } ${prefixMatch[2]}`;
  }

  // Convert Unicode superscripts and math symbols to clean LaTeX
  s = s
    .replace(/⁰/g, '^{0}')
    .replace(/¹/g, '^{1}')
    .replace(/²/g, '^{2}')
    .replace(/³/g, '^{3}')
    .replace(/⁴/g, '^{4}')
    .replace(/⁵/g, '^{5}')
    .replace(/⁶/g, '^{6}')
    .replace(/⁷/g, '^{7}')
    .replace(/⁸/g, '^{8}')
    .replace(/⁹/g, '^{9}')
    .replace(/ⁿ/g, '^{n}')
    .replace(/·/g, ' \\cdot ')
    .replace(/×/g, ' \\times ')
    .replace(/÷/g, ' \\div ')
    .replace(/±/g, ' \\pm ');

  return s.trim();
}

/**
 * Accurately estimates rendered height of KaTeX math expressions in displayMode.
 * Prevents vertical overlaps for multi-line formulas, large brackets, integrals, and boxed terms.
 */
export function estimateMathHeight(latex: string, fontSize: number = 28): number {
  let h = Math.max(54, fontSize * 1.9);

  const fracCount = (latex.match(/\\frac/g) || []).length;
  const intCount = (latex.match(/\\int|\\sum|\\prod|\\oint/g) || []).length;
  const hasBrackets = /\\left|\\right|\\bmatrix|\\pmatrix|\\cases|\\begin/.test(latex);
  const hasBoxed = /\\boxed/.test(latex);
  const hasSubSup = /_\{[^}]+\}|\^\{[^}]+\}/.test(latex);

  if (fracCount > 0) {
    h = Math.max(h, 75 + fracCount * 20);
  }
  if (intCount > 0) {
    h = Math.max(h, 95);
  }
  if (hasBrackets && fracCount > 0) {
    h = Math.max(h, 115);
  }
  if (hasBoxed) {
    h = Math.max(h, 90 + (fracCount > 0 ? 30 : 0));
  }
  if (hasSubSup && intCount > 0) {
    h = Math.max(h, 105);
  }

  return Math.round(h);
}

/**
 * Computes an accurate bounding rectangle for any shape, math equation, or multi-line text/handwriting.
 * Accounts for explicit '\n' line breaks, automatic list splitting, and elastic column wrapping.
 */
export function getShapeBounds(shape: any): BoundingBox {
  const stype = shape.shapeType || shape.kind;
  const x = shape.x ?? shape.position?.x ?? 0;
  const y = shape.y ?? shape.position?.y ?? 0;
  const isTitle = (y < 140 && x < 900) || shape.style === 'title';
  const maxColWidth = isTitle ? 1500 : (x < 900 ? 760 : 800);

  switch (stype) {
    case 'math': {
      const latex = shape.options?.latex || shape.options?.text || shape.text || '';
      const fontSize = shape.options?.fontSize || 28;
      const cleanLen = Math.max(1, latex.replace(/\\[a-zA-Z]+/g, 'XX').replace(/[{}^_]/g, '').length);
      const isShort = cleanLen <= 6 && !latex.includes('\\frac');
      const rawWidth = cleanLen * (fontSize * 0.62) + (isShort ? 16 : 36);
      const minWidth = isShort ? Math.max(30, cleanLen * fontSize * 0.58 + 12) : (cleanLen <= 10 ? 80 : 180);
      const estWidth = Math.max(minWidth, Math.min(maxColWidth, rawWidth));
      const estHeight = isShort ? Math.round(fontSize * 1.45) : estimateMathHeight(latex, fontSize);
      return { x, y, width: estWidth, height: estHeight };
    }

    case 'text': {
      const rawText = shape.options?.text || shape.text || '';
      const fontSize = shape.options?.fontSize || 24;
      const isStepHeader = /^(Step\s*\d+|Problem|Solution|Theorem|Definition|Summary|Key Formula|Key Steps|Example|Given functions)/i.test(rawText.trim());
      if (isStandaloneMathExpression(rawText)) {
        const cleanLen = Math.max(1, rawText.replace(/\\[a-zA-Z]+/g, 'XX').replace(/[{}^_]/g, '').length);
        const rawWidth = cleanLen * (fontSize * 0.62) + 30;
        const estWidth = Math.max(60, Math.min(maxColWidth, rawWidth));
        const estHeight = estimateMathHeight(rawText, fontSize);
        return { x, y, width: estWidth, height: estHeight };
      }

      const logicalLines = splitIntoLogicalLines(rawText);
      const charW = fontSize * (isTitle ? 0.68 : 0.54);
      const lineHeight = Math.round(fontSize * 1.42);
      const elasticAllowance = 130;

      let totalVisualLines = 0;
      let maxVisualWidth = 0;

      for (const line of logicalLines) {
        const cleanLine = normalizeProseMathAndSymbols(line);
        const lineW = Math.round(cleanLine.length * charW + 24);
        if (isTitle || lineW <= maxColWidth + elasticAllowance) {
          totalVisualLines += 1;
          maxVisualWidth = Math.max(maxVisualWidth, Math.min(maxColWidth + elasticAllowance, lineW));
        } else {
          const wrappedCount = Math.ceil(lineW / maxColWidth);
          totalVisualLines += wrappedCount;
          maxVisualWidth = Math.max(maxVisualWidth, maxColWidth);
        }
      }

      totalVisualLines = Math.max(1, totalVisualLines);
      const estWidth = Math.max(40, maxVisualWidth);
      const estHeight = isStepHeader
        ? Math.max(56, totalVisualLines * lineHeight + 12)
        : Math.max(34, totalVisualLines * lineHeight + Math.max(0, logicalLines.length - 1) * 6);

      return { x, y, width: estWidth, height: estHeight };
    }

    case 'graph':
    case 'graph3d':
    case 'venn':
    case 'quiz':
      return {
        x,
        y,
        width: Math.min(maxColWidth, shape.width ?? 480),
        height: shape.height ?? 380,
      };

    case 'table':
      return {
        x,
        y,
        width: Math.min(1600, shape.width ?? 800),
        height: Math.min(800, shape.height ?? 300),
      };

    case 'image':
    case 'video':
      return {
        x,
        y,
        width: Math.max(120, Math.min(1500, shape.width ?? 520)),
        height: Math.max(90, Math.min(840, shape.height ?? 320)),
      };

    case 'diagram': {
      const opts = (shape as any).options;
      let estW = shape.width ?? 650;
      let estH = shape.height ?? 320;
      if (!shape.width && opts) {
        const rawNodes = opts.nodes || [];
        const nodeCount = rawNodes.length + (opts.root ? 1 : 0);
        if (opts.diagramType === 'comparison') {
          estW = Math.max(450, Math.min(1400, nodeCount * 260));
          estH = Math.max(260, Math.min(600, 320));
        } else if (opts.diagramType === 'card' || opts.diagramType === 'concept_card') {
          estW = opts.width || 540;
          const itemCount = (opts.items || []).length || (opts.nodes || []).length || 3;
          estH = Math.max(160, 90 + itemCount * 36);
        } else if (opts.direction === 'LR') {
          estW = Math.max(380, Math.min(1300, nodeCount * 220));
          estH = Math.max(180, Math.min(500, nodeCount * 80));
        } else {
          estW = Math.max(380, Math.min(1400, nodeCount * 180));
          estH = Math.max(200, Math.min(550, 240 + (nodeCount > 3 ? 100 : 0)));
        }
      }
      return {
        x: shape.x ?? 140,
        y: shape.y ?? 160,
        width: Math.min(1600, estW),
        height: Math.min(750, estH),
      };
    }

    case 'rectangle':
      return {
        x,
        y,
        width: Math.min(maxColWidth, shape.width ?? 150),
        height: Math.min(600, shape.height ?? 100),
      };

    case 'ellipse': {
      const w = Math.min(maxColWidth, shape.width ?? 120);
      const h = shape.height ?? 100;
      return {
        x: x - w / 2,
        y: y - h / 2,
        width: w,
        height: h,
      };
    }

    case 'line':
    case 'arrow': {
      const toX = shape.toX ?? x + 100;
      const toY = shape.toY ?? y;
      return {
        x: Math.min(x, toX),
        y: Math.min(y, toY),
        width: Math.max(40, Math.abs(toX - x)),
        height: Math.max(30, Math.abs(toY - y)),
      };
    }

    case 'handwriting': {
      const rawText = shape.text ?? '';
      const isShort = rawText.length <= 12 && !isTitle;
      const fontSize = shape.fontSize ?? (isTitle ? 44 : (shape.style === 'annotation' ? 22 : 24));
      const charWidth = fontSize * (isTitle ? 0.60 : 0.52);
      const lineHeight = Math.round(fontSize * 1.35);
      const elasticAllowance = 140;

      const logicalLines = splitIntoLogicalLines(rawText);
      let totalVisualLines = 0;
      let maxVisualWidth = 0;

      for (const line of logicalLines) {
        const cleanLine = normalizeProseMathAndSymbols(line);
        const lineW = Math.round(cleanLine.length * charWidth + (isShort ? 10 : 20));
        if (isTitle || lineW <= maxColWidth + elasticAllowance) {
          totalVisualLines += 1;
          maxVisualWidth = Math.max(maxVisualWidth, Math.min(maxColWidth + elasticAllowance, lineW));
        } else {
          const wrappedCount = Math.ceil(lineW / maxColWidth);
          totalVisualLines += wrappedCount;
          maxVisualWidth = Math.max(maxVisualWidth, maxColWidth);
        }
      }

      totalVisualLines = Math.max(1, totalVisualLines);
      const minW = isShort ? Math.max(24, rawText.length * 12) : 60;
      const estWidth = isTitle ? Math.max(350, Math.min(1500, maxVisualWidth)) : Math.max(minW, maxVisualWidth);
      const estHeight = isTitle
        ? 70
        : (isShort && totalVisualLines === 1
            ? 28
            : totalVisualLines * lineHeight + Math.max(0, logicalLines.length - 1) * 6);

      return {
        x,
        y,
        width: estWidth,
        height: estHeight,
      };
    }

    default:
      return { x, y, width: shape.width ?? 120, height: shape.height ?? 70 };
  }
}

/**
 * Checks if two bounding boxes intersect (with optional padding).
 */
export function boxesOverlap(a: BoundingBox, b: BoundingBox, padding: number = 14): boolean {
  return !(
    a.x + a.width + padding < b.x ||
    b.x + b.width + padding < a.x ||
    a.y + a.height + padding < b.y ||
    b.y + b.height + padding < a.y
  );
}

/**
 * Returns the bottom Y-coordinate of any title/header text across the top of the board.
 */
export function getHeaderBottom(existingShapes: any[]): number {
  const headerShapes = existingShapes.filter((s) => {
    const stype = s.shapeType || s.kind;
    const isTextLike = stype === 'text' || stype === 'handwriting';
    const y = s.y ?? s.position?.y ?? 0;
    return (isTextLike && y < 145) || s.style === 'title';
  });

  if (headerShapes.length === 0) {
    return 135;
  }

  const maxBottom = Math.max(
    ...headerShapes.map((s) => {
      const b = getShapeBounds(s);
      return b.y + b.height;
    })
  );

  return Math.max(165, maxBottom + 24);
}

/**
 * Clamps coordinates strictly within the visible whiteboard bounds.
 */
export function clampToBounds(
  x: number,
  y: number,
  width: number,
  height: number,
  minY: number = SAFE_MIN_Y
): { x: number; y: number } {
  const minX = SAFE_MIN_X;
  const maxX = Math.max(SAFE_MIN_X, Math.min(SAFE_MAX_X - width, CANVAS_WIDTH - width - 60));
  const actualMinY = Math.max(minY, 60);
  const maxY = Math.max(actualMinY, CANVAS_HEIGHT - height - 60);

  return {
    x: Math.round(Math.max(minX, Math.min(maxX, x))),
    y: Math.round(Math.max(actualMinY, Math.min(maxY, y))),
  };
}

/**
 * Checks if a candidate container shape (rectangle or ellipse) encloses an existing element.
 */
export function enclosesShape(
  containerX: number,
  containerY: number,
  containerWidth: number,
  containerHeight: number,
  childShape: any
): boolean {
  const childBounds = getShapeBounds(childShape);
  const tol = 24;
  const childCenterX = childBounds.x + childBounds.width / 2;
  const childCenterY = childBounds.y + childBounds.height / 2;

  const centerInside =
    childCenterX >= containerX - tol &&
    childCenterX <= containerX + containerWidth + tol &&
    childCenterY >= containerY - tol &&
    childCenterY <= containerY + containerHeight + tol;

  const fitsInside =
    childBounds.width <= containerWidth * 1.35 &&
    childBounds.height <= containerHeight * 1.35;

  return centerInside && fitsInside;
}

/**
 * Checks if a candidate element (e.g. text/label/number) is positioned inside an existing container shape.
 */
export function isInsideContainer(
  targetX: number,
  targetY: number,
  targetWidth: number,
  targetHeight: number,
  container: any
): boolean {
  const cType = container.shapeType || container.kind;
  if (cType !== 'rectangle' && cType !== 'ellipse') {
    return false;
  }
  const cb = getShapeBounds(container);
  if (targetWidth > cb.width * 1.35 || targetHeight > cb.height * 1.35) {
    return false;
  }
  const centerX = targetX + targetWidth / 2;
  const centerY = targetY + targetHeight / 2;
  const hTol = 15;
  const vTol = 15;

  const centerContained =
    centerX >= cb.x - hTol &&
    centerX <= cb.x + cb.width + hTol &&
    centerY >= cb.y - vTol &&
    centerY <= cb.y + cb.height + vTol;

  const startContained =
    targetX >= cb.x - 5 &&
    targetX <= cb.x + cb.width * 0.85 &&
    targetY >= cb.y - 5 &&
    targetY <= cb.y + cb.height * 0.85;

  return centerContained || startContained;
}

/**
 * Checks if a candidate bounding box collides with any existing shape in the list.
 */
function collidesWithAny(
  targetX: number,
  targetY: number,
  width: number,
  height: number,
  shapes: any[],
  margin: number = 14,
  isCandidateTextOrMath: boolean = false,
  isCandidateContainer: boolean = false
): boolean {
  const targetBottom = targetY + height;
  for (const s of shapes) {
    const stype = s.shapeType || s.kind;
    if (stype === 'line' || stype === 'arrow') {
      continue;
    }
    if (isCandidateTextOrMath && isInsideContainer(targetX, targetY, width, height, s)) {
      continue;
    }
    const isTargetTextOrMath = ['text', 'math', 'handwriting'].includes(stype);
    if (isCandidateContainer && isTargetTextOrMath && enclosesShape(targetX, targetY, width, height, s)) {
      continue;
    }

    const b = getShapeBounds(s);
    const shapeBottom = b.y + b.height;
    const xOverlap = targetX < b.x + b.width && targetX + width > b.x;
    if (xOverlap) {
      const yOverlap = targetY < shapeBottom + margin && targetBottom > b.y - margin;
      if (yOverlap) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Checks whether the right column (Column 2) has any obstacles within a given vertical band [yStart, yEnd].
 * Used by SVGOverlay and RoughJsAdapter to allow wider elastic line-wrapping when the right half is empty.
 */
export function isRightColumnFreeAtY(existingShapes: any[], yStart: number, yEnd: number): boolean {
  for (const s of existingShapes) {
    const stype = s.shapeType || s.kind;
    if (stype === 'line' || stype === 'arrow') continue;
    const b = getShapeBounds(s);
    if (b.x >= 880) {
      const yOverlap = yStart < b.y + b.height + 30 && yEnd > b.y - 30;
      if (yOverlap) return false;
    }
  }
  return true;
}

/**
 * Intelligent Blackboard Layout & Gravity-Snap Column Flow Resolver:
 * 1. Contained Labels (text/numbers inside boxes/ellipses): Allowed directly inside containers.
 * 2. Spatial Diagrams (rectangles, ellipses, shapes, graphs): Preserves 2D relative geometry.
 * 3. Side-by-Side Inline Annotations: Places a short note cleanly to the right of a short equation on the same row.
 * 4. Sequential Gravity-Snap Flow (math formulas, step notes, handwriting):
 *    - Normalizes X to the active column margin (COL1_X = 150 or COL2_X = 1000).
 *    - Snaps Y sequentially below the last item in the active column (24-36px rhythm), preventing giant vertical gaps or out-of-order jumps.
 * 5. Multi-column wrap and automatic board full detection.
 */
export function findFreePosition(
  preferredPos: { x: number; y: number },
  shapeSize: { width: number; height: number },
  existingShapes: any[],
  isHeaderTitle: boolean = false,
  shapeType: string = 'text'
): { x: number; y: number } {
  // ── Header Title Zone ──
  if (isHeaderTitle || (preferredPos.y <= 130 && preferredPos.x < 900)) {
    const headerY = Math.min(75, Math.max(60, preferredPos.y));
    const headerX = COL1_X;
    const hasExistingHeader = existingShapes.some((s) => {
      const y = s.y ?? s.position?.y ?? 0;
      const x = s.x ?? s.position?.x ?? 0;
      return (y < 140 || s.style === 'title') && Math.abs(x - headerX) < 300;
    });
    if (!hasExistingHeader) {
      return clampToBounds(headerX, headerY, shapeSize.width, shapeSize.height, 60);
    }
    // If a main header already exists in Column 1 and this is a Column 2 header:
    if (preferredPos.x >= 900) {
      return clampToBounds(COL2_X, headerY, shapeSize.width, shapeSize.height, 60);
    }
    // Otherwise cascade into body flow below the existing header
  }

  const headerBottom = getHeaderBottom(existingShapes);
  const safeTopY = Math.max(140, headerBottom);

  const isGeometric = ['rectangle', 'ellipse', 'shape', 'diagram', 'graph', 'graph3d', 'venn', 'image', 'video'].includes(shapeType);
  const isCandidateContainer = ['rectangle', 'ellipse'].includes(shapeType);
  const isTextOrMath = ['text', 'math', 'handwriting'].includes(shapeType);

  // ── Step 0: Contained Label Check (Text inside a container shape) ──
  if (isTextOrMath) {
    const parentContainer = existingShapes.find((s) =>
      isInsideContainer(preferredPos.x, preferredPos.y, shapeSize.width, shapeSize.height, s)
    );
    if (parentContainer) {
      const collidesWithSibling = existingShapes.some((s) => {
        const stype = s.shapeType || s.kind;
        if (stype !== 'text' && stype !== 'math' && stype !== 'handwriting') return false;
        const b = getShapeBounds(s);
        const xOverlap = preferredPos.x < b.x + b.width && preferredPos.x + shapeSize.width > b.x;
        const yOverlap = preferredPos.y < b.y + b.height + 6 && preferredPos.y + shapeSize.height > b.y - 6;
        return xOverlap && yOverlap;
      });

      if (!collidesWithSibling) {
        return clampToBounds(preferredPos.x, preferredPos.y, shapeSize.width, shapeSize.height, SAFE_MIN_Y);
      }
    }
  }

  const geometricMinY = preferredPos.x < 450 ? Math.max(SAFE_MIN_Y, headerBottom) : SAFE_MIN_Y;

  // ── Step 1: Spatial Diagram / Graph Placement (Preserves intended 2D coordinates) ──
  if (isGeometric) {
    if (!collidesWithAny(preferredPos.x, preferredPos.y, shapeSize.width, shapeSize.height, existingShapes, 10, false, isCandidateContainer)) {
      return clampToBounds(preferredPos.x, preferredPos.y, shapeSize.width, shapeSize.height, geometricMinY);
    }

    const overlapping = existingShapes.filter((s) => {
      const stype = s.shapeType || s.kind;
      if (stype === 'line' || stype === 'arrow') return false;
      const isTargetTextOrMath = ['text', 'math', 'handwriting'].includes(stype);
      if (isCandidateContainer && isTargetTextOrMath && enclosesShape(preferredPos.x, preferredPos.y, shapeSize.width, shapeSize.height, s)) {
        return false;
      }
      const b = getShapeBounds(s);
      const xOverlap = preferredPos.x < b.x + b.width && preferredPos.x + shapeSize.width > b.x;
      const yOverlap = preferredPos.y < b.y + b.height + 10 && preferredPos.y + shapeSize.height > b.y - 10;
      return xOverlap && yOverlap;
    });

    if (overlapping.length > 0) {
      const maxBottom = Math.max(...overlapping.map((s) => {
        const b = getShapeBounds(s);
        return b.y + b.height;
      }));
      const shiftedY = maxBottom + 24;
      if (shiftedY + shapeSize.height <= SAFE_MAX_Y) {
        return clampToBounds(preferredPos.x, shiftedY, shapeSize.width, shapeSize.height, geometricMinY);
      }
    }
  }

  // ── Step 2: Sequential Lecture Flow with True-Track Obstacle Filtering ──
  // Column 1 target horizontal footprint
  const targetCol1X = COL1_X;
  const targetCol1W = Math.max(shapeSize.width, 540);

  // Obstacles that ACTUALLY intersect horizontally with the Column 1 track
  const col1Shapes = existingShapes.filter((s) => {
    const stype = s.shapeType || s.kind;
    if (stype === 'line' || stype === 'arrow') return false;
    const b = getShapeBounds(s);
    if (b.y < safeTopY - 25 || s.style === 'title') return false;
    // An obstacle in Column 1 MUST overlap horizontally with the Column 1 footprint [COL1_X .. COL1_X + targetCol1W]
    const xOverlap = b.x < targetCol1X + targetCol1W - 20 && b.x + b.width > targetCol1X + 20;
    return xOverlap;
  });

  // Column 2 target horizontal footprint
  const targetCol2X = COL2_X;
  const targetCol2W = Math.max(shapeSize.width, 540);

  // Obstacles that ACTUALLY intersect horizontally with the Column 2 track
  const col2Shapes = existingShapes.filter((s) => {
    const stype = s.shapeType || s.kind;
    if (stype === 'line' || stype === 'arrow') return false;
    const b = getShapeBounds(s);
    if (b.y < safeTopY - 25 || s.style === 'title') return false;
    // An obstacle in Column 2 MUST overlap horizontally with the Column 2 footprint [COL2_X .. COL2_X + targetCol2W]
    const xOverlap = b.x < targetCol2X + targetCol2W - 20 && b.x + b.width > targetCol2X + 20;
    return xOverlap;
  });

  // ── Step 2.0: Side-by-Side Same-Row Annotation Check ──
  // If the AI explicitly requested an X offset (e.g. x=280..650) at the same Y as the last short equation in Column 1,
  // place it cleanly beside that equation on the exact same horizontal row instead of pushing it down at a weird indentation.
  if (isTextOrMath && preferredPos.x >= 260 && preferredPos.x < 750 && col1Shapes.length > 0) {
    const lastCol1 = col1Shapes[col1Shapes.length - 1];
    const lastBounds = getShapeBounds(lastCol1);
    if (lastBounds.width <= 320 && Math.abs(preferredPos.y - lastBounds.y) <= 75) {
      const sideX = Math.max(preferredPos.x, Math.round(lastBounds.x + lastBounds.width + 36));
      const sideY = lastBounds.y + Math.max(0, Math.round((lastBounds.height - shapeSize.height) / 2));
      if (
        sideX + shapeSize.width <= 920 &&
        !collidesWithAny(sideX, sideY, shapeSize.width, shapeSize.height, col1Shapes, 10, true)
      ) {
        return clampToBounds(sideX, sideY, shapeSize.width, shapeSize.height, safeTopY);
      }
    }
  }

  const minVerticalGap = shapeType === 'math' ? 28 : 22;
  const maxVerticalGap = 38;

  // ── Step 2.1: Column 1 Sequential Gravity-Snap Flow ──
  // Place in Column 1 if preferredPos is on left side (preferredPos.x < 900)
  if (preferredPos.x < 900) {
    let candidateY = safeTopY;
    if (col1Shapes.length > 0) {
      const col1MaxBottom = Math.max(
        ...col1Shapes.map((s) => {
          const b = getShapeBounds(s);
          return b.y + b.height;
        })
      );
      const minNextY = col1MaxBottom + minVerticalGap;
      const maxNextY = col1MaxBottom + maxVerticalGap;
      candidateY = Math.max(minNextY, Math.min(maxNextY, preferredPos.y));
    } else {
      // First item in Column 1 always snaps cleanly to safeTopY (eliminates jumping to bottom of slide)
      candidateY = safeTopY;
    }

    // Conceptual Flow & Widow Heading Prevention:
    // If placing a short introductory line/heading in Column 1 leaves less than 130px remaining before SAFE_MAX_Y,
    // and Column 2 has ample room (>= 280px), transition the heading cleanly to Column 2 so it stays with its explanations.
    const isHeadingLike = shapeSize.height <= 60 && shapeType === 'text';
    const remainingCol1Space = SAFE_MAX_Y - (candidateY + shapeSize.height);
    const col2AvailableSpace =
      col2Shapes.length === 0
        ? SAFE_MAX_Y - safeTopY
        : SAFE_MAX_Y -
          Math.max(
            ...col2Shapes.map((s) => {
              const b = getShapeBounds(s);
              return b.y + b.height;
            })
          );

    const shouldOverflowHeadingToCol2 = isHeadingLike && remainingCol1Space < 130 && col2AvailableSpace >= 280;

    if (!shouldOverflowHeadingToCol2) {
      let curCol1Y = candidateY;
      while (
        curCol1Y + shapeSize.height <= SAFE_MAX_Y &&
        collidesWithAny(COL1_X, curCol1Y, shapeSize.width, shapeSize.height, existingShapes, 10, false, isCandidateContainer)
      ) {
        const hit = existingShapes.filter((s) => {
          const b = getShapeBounds(s);
          return (
            COL1_X < b.x + b.width + 10 &&
            COL1_X + shapeSize.width > b.x - 10 &&
            curCol1Y < b.y + b.height + 10 &&
            curCol1Y + shapeSize.height > b.y - 10
          );
        });
        if (hit.length === 0) break;
        const maxHitBottom = Math.max(...hit.map((s) => getShapeBounds(s).y + getShapeBounds(s).height));
        curCol1Y = maxHitBottom + minVerticalGap;
      }
      if (curCol1Y + shapeSize.height <= SAFE_MAX_Y) {
        return clampToBounds(COL1_X, curCol1Y, shapeSize.width, shapeSize.height, safeTopY);
      }
    }
  }

  // ── Step 2.2: Column 2 Sequential Gravity-Snap Flow (Overflow or Explicit Right Column) ──
  let col2Y = safeTopY;
  if (col2Shapes.length > 0) {
    const col2MaxBottom = Math.max(
      ...col2Shapes.map((s) => {
        const b = getShapeBounds(s);
        return b.y + b.height;
      })
    );
    const minNextY = col2MaxBottom + minVerticalGap;
    const maxNextY = col2MaxBottom + maxVerticalGap;
    col2Y = Math.max(minNextY, Math.min(maxNextY, preferredPos.y));
  } else {
    // First item in Column 2 always snaps cleanly to safeTopY (eliminates huge mid-column vertical gaps)
    col2Y = safeTopY;
  }

  while (
    col2Y + shapeSize.height <= SAFE_MAX_Y &&
    collidesWithAny(COL2_X, col2Y, shapeSize.width, shapeSize.height, existingShapes, 10, false, isCandidateContainer)
  ) {
    const hit = existingShapes.filter((s) => {
      const b = getShapeBounds(s);
      return (
        COL2_X < b.x + b.width + 10 &&
        COL2_X + shapeSize.width > b.x - 10 &&
        col2Y < b.y + b.height + 10 &&
        col2Y + shapeSize.height > b.y - 10
      );
    });
    if (hit.length === 0) break;
    const maxHitBottom = Math.max(...hit.map((s) => getShapeBounds(s).y + getShapeBounds(s).height));
    col2Y = maxHitBottom + minVerticalGap;
  }

  if (col2Y + shapeSize.height <= SAFE_MAX_Y) {
    return clampToBounds(COL2_X, col2Y, shapeSize.width, shapeSize.height, safeTopY);
  }

  // ── Step 3: Board is 100% Saturated in Both Columns ─────────
  return { x: -1, y: -1 };
}

/**
 * Checks if both Column 1 and Column 2 are completely full/saturated with content.
 */
export function isBoardSaturated(existingShapes: any[]): boolean {
  if (existingShapes.length < 4) return false;

  const col1Shapes = existingShapes.filter((s) => {
    const b = getShapeBounds(s);
    return b.x < 900 && b.y >= 160;
  });

  const col2Shapes = existingShapes.filter((s) => {
    const b = getShapeBounds(s);
    return b.x >= 900 && b.y >= 160;
  });

  const col1Bottom = col1Shapes.length > 0 ? Math.max(...col1Shapes.map((s) => getShapeBounds(s).y + getShapeBounds(s).height)) : 0;
  const col2Bottom = col2Shapes.length > 0 ? Math.max(...col2Shapes.map((s) => getShapeBounds(s).y + getShapeBounds(s).height)) : 0;

  return col1Bottom > 820 && col2Bottom > 750;
}
