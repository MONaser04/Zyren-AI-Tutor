/**
 * CollisionDetector — Intelligent Blackboard Layout Engine & Column Flow Resolver.
 *
 * Enforces:
 * 1. Accurate, formula-complexity-aware KaTeX height & bounding box calculations.
 * 2. Column-constrained bounds (Column 1 max 740px, Column 2 max 800px).
 * 3. Downward step-by-step cascade in Column 1 (x = 120 -> 900).
 * 4. Seamless Multi-Column Wrap to Column 2 (x = 980 -> 1780) below the top title header.
 * 5. Safe Board-Full Detection (returning { x: -1, y: -1 } when both columns are full).
 */

export const CANVAS_WIDTH = 1920;
export const CANVAS_HEIGHT = 1080;

export const SAFE_MIN_X = 120;
export const SAFE_MAX_X = 1800;
export const SAFE_MIN_Y = 100;
export const SAFE_MAX_Y = 980;
export const DEFAULT_HEADER_HEIGHT = 160;

export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Accurately estimates rendered height of KaTeX math expressions in displayMode.
 * Prevents vertical overlaps for multi-line formulas, large brackets, integrals, and boxed terms.
 */
export function estimateMathHeight(latex: string, fontSize: number = 28): number {
  let h = Math.max(60, fontSize * 2.1);

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
 * Computes an accurate bounding rectangle for any shape, math equation, or text.
 * Strictly constrains width to its respective column so Column 1 items never spill into Column 2.
 */
export function getShapeBounds(shape: any): BoundingBox {
  const stype = shape.shapeType || shape.kind;
  const x = shape.x ?? shape.position?.x ?? 0;
  const y = shape.y ?? shape.position?.y ?? 0;
  const isTitle = (y < 160) || shape.style === 'title';
  const maxColWidth = isTitle ? 1500 : (x < 900 ? 740 : 800);

  switch (stype) {
    case 'math': {
      const latex = shape.options?.latex || shape.options?.text || shape.text || '';
      const fontSize = shape.options?.fontSize || 28;
      const cleanLen = Math.max(1, latex.replace(/\\[a-zA-Z]+/g, 'XX').replace(/[{}^_]/g, '').length);
      const isShort = cleanLen <= 4 && !latex.includes('\\');
      const rawWidth = cleanLen * (fontSize * 0.65) + (isShort ? 14 : 40);
      const minWidth = isShort ? Math.max(20, cleanLen * fontSize * 0.6 + 10) : (cleanLen <= 8 ? 60 : 180);
      const estWidth = Math.max(minWidth, Math.min(maxColWidth, rawWidth));
      const estHeight = isShort ? Math.round(fontSize * 1.3) : estimateMathHeight(latex, fontSize);
      return { x, y, width: estWidth, height: estHeight };
    }

    case 'text': {
      const text = shape.options?.text || shape.text || '';
      const fontSize = shape.options?.fontSize || 24;
      const isStepHeader = /^(Step\s*\d+|Problem|Solution|Theorem|Definition|Summary|Key Formula|Key Steps|Example|Given functions)/i.test(text.trim());
      const isLatex = /\\[a-zA-Z]+|[_\^=+\-*/\\]/.test(text) && text.includes('\\');
      if (isLatex) {
        const cleanLen = Math.max(1, text.replace(/\\[a-zA-Z]+/g, 'XX').replace(/[{}^_]/g, '').length);
        const rawWidth = cleanLen * (fontSize * 0.65) + 30;
        const minWidth = cleanLen <= 4 ? 30 : (cleanLen <= 8 ? 60 : 180);
        const estWidth = Math.max(minWidth, Math.min(maxColWidth, rawWidth));
        const estHeight = estimateMathHeight(text, fontSize);
        return { x, y, width: estWidth, height: estHeight };
      }
      const isShortLabel = text.length <= 4 && !isStepHeader && !isTitle;
      const rawWidth = text.length * (fontSize * (isTitle ? 0.75 : 0.58)) + (isShortLabel ? 12 : 35);
      const minWidth = isShortLabel ? Math.max(20, text.length * fontSize * 0.65 + 8) : (text.length <= 8 ? 50 : (isStepHeader ? 160 : 100));
      const estWidth = Math.max(minWidth, Math.min(maxColWidth, rawWidth));
      const estHeight = isStepHeader ? 62 : (isShortLabel ? Math.max(24, Math.round(fontSize * 1.3)) : Math.max(45, fontSize * 1.8));
      return { x, y, width: estWidth, height: estHeight };
    }

    case 'graph':
    case 'graph3d':
    case 'venn':
      return {
        x,
        y,
        width: Math.min(maxColWidth, shape.width ?? 480),
        height: shape.height ?? 380,
      };

    case 'diagram':
      return {
        x: shape.x ?? 120,
        y: shape.y ?? 130,
        width: Math.min(1680, shape.width ?? 1600),
        height: shape.height ?? 450,
      };

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
      const isTitle = shape.style === 'title' || (shape.position?.y ?? shape.y ?? 0) <= 130;
      const textLen = shape.text?.length ?? 15;
      const isShort = textLen <= 12 && !isTitle;
      const fontSize = shape.fontSize ?? (isTitle ? 44 : (shape.style === 'annotation' ? 22 : 24));
      const charWidth = fontSize * (isTitle ? 0.60 : 0.52);
      const rawWidth = Math.round(textLen * charWidth + (isShort ? 10 : 20));
      const minW = isShort ? Math.max(24, textLen * 12) : 60;

      const estWidth = isTitle ? Math.max(350, Math.min(1500, rawWidth)) : Math.max(minW, rawWidth);
      const estHeight = isTitle ? 70 : (isShort ? 28 : Math.round(fontSize * 1.35));
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
    return (isTextLike && y < 160) || s.style === 'title';
  });

  if (headerShapes.length === 0) {
    return SAFE_MIN_Y;
  }

  const maxBottom = Math.max(
    ...headerShapes.map((s) => {
      const b = getShapeBounds(s);
      return b.y + b.height;
    })
  );

  return Math.max(170, maxBottom + 25);
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
  const actualMinY = Math.max(minY, SAFE_MIN_Y);
  const maxY = Math.max(actualMinY, CANVAS_HEIGHT - height - 60);

  return {
    x: Math.round(Math.max(minX, Math.min(maxX, x))),
    y: Math.round(Math.max(actualMinY, Math.min(maxY, y))),
  };
}

/**
 * Checks if a candidate container shape (rectangle or ellipse) encloses an existing element
 * (e.g. text/math/handwriting). If the candidate container covers or encloses the existing element,
 * this is an ENCLOSURE / CONTAINER CREATION action (like drawing a box around a word), NOT an obstacle collision.
 */
export function enclosesShape(
  containerX: number,
  containerY: number,
  containerWidth: number,
  containerHeight: number,
  childShape: any
): boolean {
  const childBounds = getShapeBounds(childShape);
  const tol = 24; // tolerance
  const childCenterX = childBounds.x + childBounds.width / 2;
  const childCenterY = childBounds.y + childBounds.height / 2;

  // The child's center or major area must be within the container's bounds
  const centerInside =
    childCenterX >= containerX - tol &&
    childCenterX <= containerX + containerWidth + tol &&
    childCenterY >= containerY - tol &&
    childCenterY <= containerY + containerHeight + tol;

  // And the child fits reasonably inside the container
  const fitsInside =
    childBounds.width <= containerWidth * 1.35 &&
    childBounds.height <= containerHeight * 1.35;

  return centerInside && fitsInside;
}

/**
 * Checks if a candidate element (e.g. text/label/number) is positioned inside an existing
 * container shape (rectangle or ellipse). In modern whiteboard systems (tldraw, Excalidraw, Figma),
 * text inside a container is classified as a contained child/label, NOT an obstacle collision.
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
  // Ensure the candidate isn't vastly oversized relative to container (must fit reasonably)
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
 * Checks if a candidate bounding box collides with any existing shape in the list,
 * using a vertical safety margin to guarantee visual breathing room.
 * Lines and arrows are intentionally excluded as obstacles so diagram connectors don't block shapes.
 * If candidate is a text/label that is contained inside a container shape, it is allowed as a label.
 * If candidate is a container shape that encloses existing text, it is allowed as an enclosing frame.
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
    // Exclude connectors/lines/arrows from acting as solid blocking obstacles
    if (stype === 'line' || stype === 'arrow') {
      continue;
    }
    // Direction 1: Candidate is text/math and it is inside an existing container -> ALLOW!
    if (isCandidateTextOrMath && isInsideContainer(targetX, targetY, width, height, s)) {
      continue;
    }
    // Direction 2: Candidate is a container shape and it ENCLOSES an existing text/math item -> ALLOW!
    const isTargetTextOrMath = ['text', 'math', 'handwriting'].includes(stype);
    if (isCandidateContainer && isTargetTextOrMath && enclosesShape(targetX, targetY, width, height, s)) {
      continue;
    }

    const b = getShapeBounds(s);
    const shapeBottom = b.y + b.height;
    // Check horizontal overlap
    const xOverlap = targetX < b.x + b.width && targetX + width > b.x;
    if (xOverlap) {
      // Check vertical overlap with safety margin
      const yOverlap = targetY < shapeBottom + margin && targetBottom > b.y - margin;
      if (yOverlap) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Intelligent Blackboard Layout & Collision Resolver:
 * 1. Contained Labels (text/numbers inside boxes/ellipses): Allowed directly inside containers.
 * 2. Spatial Diagrams (rectangles, ellipses, shapes): Preserves 2D relative geometry.
 *    If preferredPos is collision-free, keeps it. If colliding, shifts with minimal vertical displacement.
 * 3. Sequential Lecture Flow (math formulas, step notes, handwriting):
 *    If colliding with existing content in the active column, cascades neatly downward below the lowest item.
 * 4. Multi-column wrap and automatic board full detection.
 */
export function findFreePosition(
  preferredPos: { x: number; y: number },
  shapeSize: { width: number; height: number },
  existingShapes: any[],
  isHeaderTitle: boolean = false,
  shapeType: string = 'text'
): { x: number; y: number } {
  // If this is a main topic header title or placed in the top header zone:
  if (isHeaderTitle || (preferredPos.y <= 130 && preferredPos.x < 900)) {
    return clampToBounds(preferredPos.x, Math.min(80, Math.max(60, preferredPos.y)), shapeSize.width, shapeSize.height, 60);
  }

  const headerBottom = getHeaderBottom(existingShapes);
  const safeTopY = Math.max(180, headerBottom);

  const isGeometric = ['rectangle', 'ellipse', 'shape', 'diagram'].includes(shapeType);
  const isCandidateContainer = ['rectangle', 'ellipse'].includes(shapeType);
  const isTextOrMath = ['text', 'math', 'handwriting'].includes(shapeType);

  // ── Step 0: Contained Label Check (Text inside a container shape) ──
  if (isTextOrMath) {
    const parentContainer = existingShapes.find((s) =>
      isInsideContainer(preferredPos.x, preferredPos.y, shapeSize.width, shapeSize.height, s)
    );
    if (parentContainer) {
      // Check if it collides with ANOTHER text inside the same container
      const collidesWithSibling = existingShapes.some((s) => {
        const stype = s.shapeType || s.kind;
        if (stype !== 'text' && stype !== 'math' && stype !== 'handwriting') return false;
        const b = getShapeBounds(s);
        const xOverlap = preferredPos.x < b.x + b.width && preferredPos.x + shapeSize.width > b.x;
        const yOverlap = preferredPos.y < b.y + b.height + 6 && preferredPos.y + shapeSize.height > b.y - 6;
        return xOverlap && yOverlap;
      });

      if (!collidesWithSibling) {
        // Comfortably contained inside container, with no sibling overlap -> place it directly!
        return clampToBounds(preferredPos.x, preferredPos.y, shapeSize.width, shapeSize.height, SAFE_MIN_Y);
      }
    }
  }

  const geometricMinY = preferredPos.x < 450 ? Math.max(SAFE_MIN_Y, headerBottom) : SAFE_MIN_Y;

  // ── Step 1: Spatial Diagram Placement (Preserves intended 2D coordinates) ──
  if (isGeometric) {
    // If the requested position is collision-free (or encloses an existing text element), keep exact coordinates!
    if (!collidesWithAny(preferredPos.x, preferredPos.y, shapeSize.width, shapeSize.height, existingShapes, 10, false, isCandidateContainer)) {
      return clampToBounds(preferredPos.x, preferredPos.y, shapeSize.width, shapeSize.height, geometricMinY);
    }

    // If an actual collision occurs, shift vertically below the colliding obstacle at the same X
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
      const shiftedY = maxBottom + 20;
      if (shiftedY + shapeSize.height <= SAFE_MAX_Y) {
        return clampToBounds(preferredPos.x, shiftedY, shapeSize.width, shapeSize.height, geometricMinY);
      }
    }
  }

  // ── Step 2: Sequential Lecture Step (Math & Text Flow) ──
  // If the requested position does not collide with any existing shape, respect it!
  if (!collidesWithAny(preferredPos.x, preferredPos.y, shapeSize.width, shapeSize.height, existingShapes, 14, isTextOrMath)) {
    return clampToBounds(preferredPos.x, Math.max(safeTopY, preferredPos.y), shapeSize.width, shapeSize.height, safeTopY);
  }

  const targetColX = Math.max(SAFE_MIN_X, preferredPos.x);

  // ── Step 2.1: Local Column Flow (Preserves intended horizontal domain) ──
  // Find shapes that actually horizontally overlap with this element's X domain
  const overlappingLocalShapes = existingShapes.filter((s) => {
    const stype = s.shapeType || s.kind;
    if (stype === 'line' || stype === 'arrow') return false;
    const b = getShapeBounds(s);
    const xOverlap = targetColX < b.x + b.width - 4 && targetColX + shapeSize.width > b.x + 4;
    return xOverlap && b.y >= safeTopY - 30;
  });

  let candidateY = safeTopY;
  if (overlappingLocalShapes.length > 0) {
    const requestedY = Math.max(safeTopY, preferredPos.y);
    if (!collidesWithAny(targetColX, requestedY, shapeSize.width, shapeSize.height, overlappingLocalShapes, 14, isTextOrMath)) {
      candidateY = requestedY;
    } else {
      const maxBottom = Math.max(
        ...overlappingLocalShapes.map((s) => {
          const b = getShapeBounds(s);
          return b.y + b.height;
        })
      );
      candidateY = maxBottom + 24;
    }
  } else {
    candidateY = Math.max(120, Math.min(180, preferredPos.y));
  }

  if (candidateY + shapeSize.height <= SAFE_MAX_Y) {
    return clampToBounds(targetColX, candidateY, shapeSize.width, shapeSize.height, safeTopY);
  }

  // ── Step 2.2: Multi-column Overflow (If local region is full, wrap to Column 2) ──
  const COL2_X = 1000;
  if (targetColX < 900) {
    const col2Shapes = existingShapes.filter((s) => {
      const stype = s.shapeType || s.kind;
      if (stype === 'line' || stype === 'arrow') return false;
      const b = getShapeBounds(s);
      return b.x >= 900 && b.y >= safeTopY - 30;
    });

    let col2Y = safeTopY;
    if (col2Shapes.length > 0) {
      const requestedY = Math.max(safeTopY, preferredPos.y);
      if (!collidesWithAny(COL2_X, requestedY, shapeSize.width, shapeSize.height, col2Shapes, 14, isTextOrMath)) {
        col2Y = requestedY;
      } else {
        const maxBottom = Math.max(
          ...col2Shapes.map((s) => {
            const b = getShapeBounds(s);
            return b.y + b.height;
          })
        );
        col2Y = maxBottom + 24;
      }
    } else {
      col2Y = Math.max(safeTopY, Math.min(220, preferredPos.y));
    }

    if (col2Y + shapeSize.height <= SAFE_MAX_Y) {
      return clampToBounds(COL2_X, col2Y, shapeSize.width, shapeSize.height, safeTopY);
    }
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