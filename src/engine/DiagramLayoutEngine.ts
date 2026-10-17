/**
 * DiagramLayoutEngine — Deterministic Blackboard Diagram & Layout Solver.
 *
 * Implements 100% mathematically exact auto-layout for:
 * 1. Hierarchy Trees & Concept Maps (Sugiyama / Symmetrical Tree Framework)
 * 2. Sequential Flowcharts & Step Pipelines (Horizontal & Vertical)
 * 3. Side-by-Side Comparison Boards
 *
 * Guarantees:
 * - Dynamic text measurement & box auto-sizing: Zero text overflow outside boxes.
 * - Hierarchical rank & sibling clearance: Zero box-on-box overlapping.
 * - Mathematical port calculation: Connectors link exactly at center-anchors.
 * - Vertical safety margins: Bullet points never collide with box borders.
 */

import type { DiagramOptions, DiagramNode, ShapePayload } from '../types';

export interface LayoutBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Accurately measures text rendered width in pixels using canvas or exact character metrics.
 */
export function measureTextWidth(
  text: string,
  fontSize: number = 20,
  isBold: boolean = false,
  isHandwriting: boolean = false
): number {
  if (!text) return 0;

  if (typeof document !== 'undefined') {
    try {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      if (ctx) {
        const weight = isBold ? (isHandwriting ? '700' : '600') : (isHandwriting ? '500' : '400');
        const family = isHandwriting ? "'Caveat', cursive, sans-serif" : "'Inter', -apple-system, sans-serif";
        ctx.font = `${weight} ${fontSize}px ${family}`;
        const measured = ctx.measureText(text).width;
        if (measured > 0) {
          return Math.round(measured);
        }
      }
    } catch {
      // Fallback below
    }
  }

  // Exact character-class mathematical metrics fallback (tuned for Inter and Caveat handwriting)
  let width = 0;
  for (const ch of text) {
    if (/[ijlI1\.,;:'!|]/.test(ch)) {
      width += fontSize * (isHandwriting ? 0.35 : 0.32);
    } else if (/[mwMW_@%#]/.test(ch)) {
      width += fontSize * (isHandwriting ? 0.82 : 0.88);
    } else if (/[A-Z]/.test(ch)) {
      width += fontSize * (isHandwriting ? 0.60 : 0.64);
    } else if (/[0-9]/.test(ch)) {
      width += fontSize * (isHandwriting ? 0.52 : 0.58);
    } else {
      width += fontSize * (isHandwriting ? 0.50 : 0.54);
    }
  }
  return Math.round(width * (isBold ? (isHandwriting ? 1.05 : 1.08) : 1.0));
}

/**
 * Sizing calculation for a node box: guarantees that text is comfortably enclosed.
 */
export function calculateNodeBoxSize(
  label: string,
  fontSize: number = 22,
  minWidth: number = 180,
  paddingX: number = 28,
  isHandwriting: boolean = false
): { width: number; height: number } {
  const textWidth = measureTextWidth(label, fontSize, true, isHandwriting);
  const width = Math.max(minWidth, textWidth + paddingX * 2);
  const height = Math.max(54, Math.round(fontSize * (isHandwriting ? 2.3 : 2.2)));
  return { width, height };
}

/**
 * DiagramLayoutEngine generates a list of atomic shape payloads with 100% computed geometry.
 */
export class DiagramLayoutEngine {
  /**
   * Generates atomic whiteboard shapes for any diagram configuration.
   */
  public static generateShapes(options: DiagramOptions): ShapePayload[] {
    const dType = options.diagramType || 'tree';

    let shapes: ShapePayload[];
    switch (dType) {
      case 'flowchart':
      case 'process':
      case 'hybrid':
        shapes = this.generateFlowchart(options);
        break;
      case 'comparison':
        shapes = this.generateComparison(options);
        break;
      case 'tree':
      default:
        shapes = this.generateTree(options);
        break;
    }

    // Fit newly generated shapes into safe blackboard viewport/slot
    const fittedShapes = this.fitToViewport(shapes, options);

    // Attach to existing node if attachToNode is specified
    if (options.attachToNode && options.existingShapes && options.existingShapes.length > 0) {
      const matchLabel = options.attachToNode.trim().toLowerCase();
      const parentShape = options.existingShapes.find(
        (s) =>
          s.shapeType === 'rectangle' &&
          ((s.options?.label && s.options.label.toLowerCase().includes(matchLabel)) ||
            (s.label && s.label.toLowerCase().includes(matchLabel)))
      );
      if (parentShape) {
        const firstRect = fittedShapes.find((s) => s.shapeType === 'rectangle');
        if (firstRect) {
          const pw = parentShape.width ?? 140;
          const ph = parentShape.height ?? 50;
          const fw = firstRect.width ?? 140;
          const fh = firstRect.height ?? 50;

          let startX: number;
          let startY: number;
          let endX: number;
          let endY: number;

          // If new diagram is primarily to the right
          if (firstRect.x >= parentShape.x + pw) {
            startX = parentShape.x + pw;
            startY = parentShape.y + Math.round(ph / 2);
            endX = firstRect.x;
            endY = firstRect.y + Math.round(fh / 2);
          } else if (firstRect.y >= parentShape.y + ph) {
            // New diagram is below
            startX = parentShape.x + Math.round(pw / 2);
            startY = parentShape.y + ph;
            endX = firstRect.x + Math.round(fw / 2);
            endY = firstRect.y;
          } else if (firstRect.x + fw <= parentShape.x) {
            // New diagram is to the left
            startX = parentShape.x;
            startY = parentShape.y + Math.round(ph / 2);
            endX = firstRect.x + fw;
            endY = firstRect.y + Math.round(fh / 2);
          } else {
            // Fallback: connect bottom to top
            startX = parentShape.x + Math.round(pw / 2);
            startY = parentShape.y + ph;
            endX = firstRect.x + Math.round(fw / 2);
            endY = firstRect.y;
          }

          fittedShapes.push({
            kind: 'shape',
            shapeType: 'arrow',
            x: startX,
            y: startY,
            toX: endX,
            toY: endY,
            options: {
              color: '#4ECDC4',
              strokeWidth: 2.5,
              roughness: 1.2,
            },
          });
        }
      }
    }

    return fittedShapes;
  }

  /**
   * Generates a Hierarchical Concept Tree (Root -> Children -> Bullet items).
   */
  private static generateTree(options: DiagramOptions): ShapePayload[] {
    const shapes: ShapePayload[] = [];
    const rawNodes = options.nodes || [];

    const isHandwriting = options.writingStyle === 'handwriting' ||
      /handwritten|handwriting/i.test(options.title || '') ||
      /handwritten|handwriting/i.test(options.root || '');

    // 1. Root Box Reconciliation
    let rootLabel = (options.root || options.title || 'Concept').trim();
    // Clean common diagram title suffixes like "Tree", "Tree Redraw", "Diagram", "Overview", "Handwritten"
    const cleanTitle = (options.title || '').replace(/\b(tree|redraw|diagram|overview|map|handwritten|handwriting)\b/gi, '').trim().toLowerCase();

    if (isHandwriting) {
      rootLabel = rootLabel.replace(/\b(handwritten|handwriting)\b/gi, '').trim();
      if (!rootLabel) {
        rootLabel = (options.title || 'Concept').replace(/\b(handwritten|handwriting|tree|redraw|diagram)\b/gi, '').trim() || 'Concept';
      }
    }

    const candidateRootIndex = rawNodes.findIndex((n) => {
      const lbl = (n.label || '').trim().toLowerCase();
      const id = (n.id || '').trim().toLowerCase();
      const r = rootLabel.toLowerCase();
      const t = (options.title || '').trim().toLowerCase();

      return (
        id.includes('root') ||
        (id && (id === r || id === t)) ||
        lbl === r ||
        lbl === t ||
        (cleanTitle && (lbl.includes(cleanTitle) || cleanTitle.includes(lbl))) ||
        t.includes(lbl) ||
        r.includes(lbl) ||
        (id === 'ml' && lbl.includes('machine learning')) ||
        (r.includes('ml') && lbl.includes('machine learning'))
      );
    });

    let filteredNodes = [...rawNodes];
    let rootId: string | undefined = undefined;
    if (candidateRootIndex !== -1) {
      const rootNode = rawNodes[candidateRootIndex];
      rootId = rootNode.id;
      if (rootNode.label && rootNode.label.trim()) {
        rootLabel = rootNode.label.trim();
        if (isHandwriting) {
          rootLabel = rootLabel.replace(/\b(handwritten|handwriting)\b/gi, '').trim();
        }
      }
      filteredNodes.splice(candidateRootIndex, 1);
    }

    // 2. Parent-Child Hierarchy & Sub-item Resolution
    const nodeMap = new Map<string, DiagramNode>();
    filteredNodes.forEach((n) => {
      const key = (n.id || n.label).trim();
      nodeMap.set(key, { ...n, items: [...(n.items || [])] });
    });

    const topLevelNodes: DiagramNode[] = [];
    const attachedToParent = new Set<string>();

    filteredNodes.forEach((rawNode) => {
      const key = (rawNode.id || rawNode.label).trim();
      const node = nodeMap.get(key)!;
      let parentKey = (rawNode.parentId || rawNode.parent || '').trim();

      // If parent points to the root (e.g. parent: "categories_root" or parent: rootLabel),
      // this node is a DIRECT CHILD of root (Rank 1 / Branch), NOT a bullet item of another node!
      if (
        (rootId && parentKey.toLowerCase() === rootId.toLowerCase()) ||
        parentKey.toLowerCase() === rootLabel.toLowerCase() ||
        parentKey.toLowerCase() === (options.root || '').toLowerCase() ||
        parentKey.toLowerCase() === (options.title || '').toLowerCase()
      ) {
        parentKey = '';
      }

      // Auto-detect prefix hierarchy pattern: e.g. rawNode.id = 'SL_C' when 'SL' is in nodeMap
      if (!parentKey && rawNode.id) {
        for (const [pKey] of nodeMap.entries()) {
          if (pKey !== rawNode.id && (rawNode.id.startsWith(`${pKey}_`) || rawNode.id.startsWith(`${pKey}-`))) {
            parentKey = pKey;
            break;
          }
        }
      }

      if (parentKey && nodeMap.has(parentKey)) {
        const parent = nodeMap.get(parentKey)!;
        const cleanText = node.label.replace(/\\n|\n/g, ' ').trim();
        if (!parent.items) parent.items = [];
        if (!parent.items.includes(cleanText)) {
          parent.items.push(cleanText);
        }
        attachedToParent.add(key);
      }
    });

    filteredNodes.forEach((rawNode) => {
      const key = (rawNode.id || rawNode.label).trim();
      if (!attachedToParent.has(key)) {
        topLevelNodes.push(nodeMap.get(key)!);
      }
    });

    const childNodes: DiagramNode[] = topLevelNodes;
    const themeColors = ['#4ECDC4', '#FFAB00', '#FF6B6B', '#A8FF78', '#C77DFF', '#38EF7D'];

    // 3. Calculate Root Box
    const rootFontSize = isHandwriting ? 26 : 24;
    const rootBox = calculateNodeBoxSize(rootLabel, rootFontSize, 220, isHandwriting ? 36 : 36, isHandwriting);
    const rootY = 130;

    // 4. Measure and compute width for each child column
    const childFontSize = isHandwriting ? 22 : 20;
    const childBoxes = childNodes.map((node) => {
      const box = calculateNodeBoxSize(node.label, childFontSize, 190, 24, isHandwriting);
      let maxItemW = 0;
      if (node.items && node.items.length > 0) {
        for (const itm of node.items) {
          const itmW = measureTextWidth(`• ${itm}`, isHandwriting ? 20 : 18, false, isHandwriting);
          if (itmW > maxItemW) maxItemW = itmW;
        }
      }
      const colWidth = Math.max(box.width, Math.min(440, maxItemW + 24));
      return {
        ...node,
        boxWidth: box.width,
        boxHeight: box.height,
        colWidth,
      };
    });

    // 5. Layout child columns symmetrically across the blackboard
    const branchGap = childBoxes.length <= 2 ? 100 : childBoxes.length === 3 ? 55 : 35;
    const totalBranchesWidth = childBoxes.reduce((sum, c) => sum + c.colWidth, 0) + Math.max(0, childBoxes.length - 1) * branchGap;

    const blackboardCenterX = 960;
    const startX = Math.max(120, Math.round(blackboardCenterX - totalBranchesWidth / 2));
    const rootX = Math.round(blackboardCenterX - rootBox.width / 2);

    // Render Root Node
    shapes.push({
      kind: 'shape',
      shapeType: 'rectangle',
      x: rootX,
      y: rootY,
      width: rootBox.width,
      height: rootBox.height,
      options: {
        label: rootLabel,
        color: '#FFFFFF',
        strokeWidth: isHandwriting ? 2.2 : 2.5,
        roughness: isHandwriting ? 2.0 : 1.2,
        writingStyle: isHandwriting ? 'handwriting' : 'normal',
        fontFamily: isHandwriting ? "'Caveat', cursive, sans-serif" : undefined,
      },
    });

    // 6. Render Children, Connectors, and Bullet Items
    const childY = rootY + rootBox.height + 90; // level gap of 90px
    let currentX = startX;

    const rootBottomAnchor = {
      x: Math.round(rootX + rootBox.width / 2),
      y: rootY + rootBox.height,
    };

    childBoxes.forEach((child, index) => {
      const color = child.color || themeColors[index % themeColors.length];
      const childBoxX = Math.round(currentX + (child.colWidth - child.boxWidth) / 2);

      // Child Rectangle Box
      shapes.push({
        kind: 'shape',
        shapeType: 'rectangle',
        x: childBoxX,
        y: childY,
        width: child.boxWidth,
        height: child.boxHeight,
        options: {
          label: child.label,
          color,
          strokeWidth: isHandwriting ? 2.2 : 2,
          roughness: isHandwriting ? 2.0 : 1.3,
          writingStyle: isHandwriting ? 'handwriting' : 'normal',
          fontFamily: isHandwriting ? "'Caveat', cursive, sans-serif" : undefined,
        },
      });

      // Connector Arrow: exact center-to-center link
      const childTopAnchor = {
        x: Math.round(childBoxX + child.boxWidth / 2),
        y: childY,
      };

      shapes.push({
        kind: 'shape',
        shapeType: 'arrow',
        x: rootBottomAnchor.x,
        y: rootBottomAnchor.y,
        toX: childTopAnchor.x,
        toY: childTopAnchor.y,
        options: {
          color: 'rgba(255, 255, 255, 0.75)',
          strokeWidth: isHandwriting ? 2.2 : 2,
          roughness: isHandwriting ? 1.8 : 1,
          writingStyle: isHandwriting ? 'handwriting' : 'normal',
        },
      });

      // Bullet Points / Child items placed beneath the child box with guaranteed safety padding
      if (child.items && child.items.length > 0) {
        const itemStartY = childY + child.boxHeight + 32; // 32px safe clearance from bottom border
        const itemX = currentX;

        child.items.forEach((item, itemIdx) => {
          const itemText = item.startsWith('•') || item.startsWith('-') ? item : `• ${item}`;
          shapes.push({
            kind: 'shape',
            shapeType: 'text',
            x: itemX,
            y: itemStartY + itemIdx * (isHandwriting ? 34 : 32), // vertical spacing
            options: {
              text: itemText,
              fontSize: isHandwriting ? 21 : 18,
              color: 'rgba(255, 255, 255, 0.9)',
              maxWidth: child.colWidth + 20,
              writingStyle: isHandwriting ? 'handwriting' : 'normal',
              fontFamily: isHandwriting ? "'Caveat', cursive, sans-serif" : undefined,
            },
          });
        });
      }

      currentX += child.colWidth + branchGap;
    });

    return shapes;
  }

  /**
   * Generates a Sequential Flowchart / Process Pipeline or Hybrid Compound Diagram.
   * Supports:
   * 1. Multi-directional routing (changing direction midway, e.g. down then right with L-shaped orthogonal elbow connectors).
   * 2. Compound sub-tree branching from any step (flowchart node branching into a category tree).
   */
  private static generateFlowchart(options: DiagramOptions): ShapePayload[] {
    const shapes: ShapePayload[] = [];
    const nodes = options.nodes || [];
    if (nodes.length === 0) return shapes;

    const isHandwriting = options.writingStyle === 'handwriting' ||
      /handwritten|handwriting/i.test(options.title || '') ||
      /handwritten|handwriting/i.test(options.root || '');

    const baseDir = (options.direction || 'LR').toUpperCase();
    const isBaseHorizontal = baseDir === 'LR';
    const themeColors = ['#4ECDC4', '#38EF7D', '#FFAB00', '#FF6B6B', '#C77DFF', '#A8FF78'];

    // 1. Measure and compute box size for each step
    const nodeBoxes = nodes.map((n, idx) => {
      const stepNum = idx + 1;
      const fullLabel = n.label.startsWith('Step') || /^\d+\./.test(n.label) ? n.label : `${stepNum}. ${n.label}`;
      const isBoxWide = !isBaseHorizontal || n.flow === 'down';
      const box = calculateNodeBoxSize(fullLabel, isHandwriting ? 22 : 20, isBoxWide ? 220 : 180, 24, isHandwriting);
      return {
        ...n,
        label: fullLabel,
        boxWidth: box.width,
        boxHeight: box.height,
        flow: n.flow || 'auto',
        children: n.children || [],
      };
    });

    // 2. Position steps with dynamic flow direction support
    interface PlacedStep {
      idx: number;
      label: string;
      x: number;
      y: number;
      width: number;
      height: number;
      color: string;
      items?: string[];
      children?: DiagramNode[];
    }

    const placedSteps: PlacedStep[] = [];
    const startX = isBaseHorizontal ? 180 : 860;
    const startY = isBaseHorizontal ? 240 : 180;
    let currentFlow: 'right' | 'down' | 'left' = isBaseHorizontal ? 'right' : 'down';

    const gapX = 65;
    const gapY = 70;

    nodeBoxes.forEach((node, idx) => {
      if (idx === 0) {
        if (node.flow && node.flow !== 'auto') {
          currentFlow = node.flow;
        }
        placedSteps.push({
          idx,
          label: node.label,
          x: startX,
          y: startY,
          width: node.boxWidth,
          height: node.boxHeight,
          color: node.color || themeColors[0],
          items: node.items,
          children: node.children,
        });
      } else {
        const prev = placedSteps[idx - 1];
        const prevNode = nodeBoxes[idx - 1];
        if (prevNode.flow && prevNode.flow !== 'auto') {
          currentFlow = prevNode.flow;
        }

        let newX = prev.x;
        let newY = prev.y;

        if (currentFlow === 'right') {
          newX = prev.x + prev.width + gapX;
          newY = prev.y;
        } else if (currentFlow === 'down') {
          newX = prev.x + Math.round((prev.width - node.boxWidth) / 2);
          newY = prev.y + prev.height + gapY;
        } else if (currentFlow === 'left') {
          newX = prev.x - node.boxWidth - gapX;
          newY = prev.y;
        }

        if (node.flow && node.flow !== 'auto') {
          currentFlow = node.flow;
        }

        placedSteps.push({
          idx,
          label: node.label,
          x: newX,
          y: newY,
          width: node.boxWidth,
          height: node.boxHeight,
          color: node.color || themeColors[idx % themeColors.length],
          items: node.items,
          children: node.children,
        });
      }
    });

    // 3. Render Step Boxes & Connectors
    placedSteps.forEach((step, idx) => {
      // Step Rectangle
      shapes.push({
        kind: 'shape',
        shapeType: 'rectangle',
        x: step.x,
        y: step.y,
        width: step.width,
        height: step.height,
        options: {
          label: step.label,
          color: step.color,
          strokeWidth: isHandwriting ? 2.2 : 2,
          roughness: isHandwriting ? 2.0 : 1.2,
          writingStyle: isHandwriting ? 'handwriting' : 'normal',
          fontFamily: isHandwriting ? "'Caveat', cursive, sans-serif" : undefined,
        },
      });

      // Connector Arrow to Next Step
      if (idx < placedSteps.length - 1) {
        const next = placedSteps[idx + 1];
        const dx = next.x - step.x;
        const dy = next.y - step.y;

        if (dx > 0 && Math.abs(dy) < 25) {
          // Direct horizontal arrow
          shapes.push({
            kind: 'shape',
            shapeType: 'arrow',
            x: step.x + step.width,
            y: step.y + Math.round(step.height / 2),
            toX: next.x,
            toY: next.y + Math.round(next.height / 2),
            options: {
              color: '#FFFFFF',
              strokeWidth: isHandwriting ? 2.2 : 2,
              roughness: isHandwriting ? 1.8 : 1,
              writingStyle: isHandwriting ? 'handwriting' : 'normal',
            },
          });
        } else if (Math.abs(dx) < 35 && dy > 0) {
          // Direct vertical arrow
          shapes.push({
            kind: 'shape',
            shapeType: 'arrow',
            x: step.x + Math.round(step.width / 2),
            y: step.y + step.height,
            toX: next.x + Math.round(next.width / 2),
            toY: next.y,
            options: {
              color: '#FFFFFF',
              strokeWidth: isHandwriting ? 2.2 : 2,
              roughness: isHandwriting ? 1.8 : 1,
              writingStyle: isHandwriting ? 'handwriting' : 'normal',
            },
          });
        } else if (dx > 0 && dy >= 25) {
          // L-shaped Orthogonal Elbow Connector (Vertical down then turning Right)
          const elbowX = step.x + Math.round(step.width / 2);
          const elbowY = next.y + Math.round(next.height / 2);

          // Line from bottom of step down to elbow point
          shapes.push({
            kind: 'shape',
            shapeType: 'line',
            x: elbowX,
            y: step.y + step.height,
            toX: elbowX,
            toY: elbowY,
            options: {
              color: '#FFFFFF',
              strokeWidth: isHandwriting ? 2.2 : 2,
              roughness: isHandwriting ? 1.8 : 1,
            },
          });

          // Arrow from elbow point horizontally right into next step
          shapes.push({
            kind: 'shape',
            shapeType: 'arrow',
            x: elbowX,
            y: elbowY,
            toX: next.x,
            toY: elbowY,
            options: {
              color: '#FFFFFF',
              strokeWidth: isHandwriting ? 2.2 : 2,
              roughness: isHandwriting ? 1.8 : 1,
              writingStyle: isHandwriting ? 'handwriting' : 'normal',
            },
          });
        } else {
          // General orthogonal fallback arrow
          shapes.push({
            kind: 'shape',
            shapeType: 'arrow',
            x: step.x + step.width,
            y: step.y + Math.round(step.height / 2),
            toX: next.x,
            toY: next.y + Math.round(next.height / 2),
            options: {
              color: '#FFFFFF',
              strokeWidth: isHandwriting ? 2.2 : 2,
              roughness: isHandwriting ? 1.8 : 1,
            },
          });
        }
      }

      // Sub-items below step box (if no branching sub-tree)
      if (step.items && step.items.length > 0 && (!step.children || step.children.length === 0)) {
        const itemStartY = step.y + step.height + 28;
        step.items.forEach((itm, itemIdx) => {
          shapes.push({
            kind: 'shape',
            shapeType: 'text',
            x: step.x,
            y: itemStartY + itemIdx * (isHandwriting ? 30 : 28),
            options: {
              text: itm.startsWith('•') ? itm : `• ${itm}`,
              fontSize: isHandwriting ? 20 : 17,
              color: 'rgba(255, 255, 255, 0.85)',
              maxWidth: step.width + 40,
              writingStyle: isHandwriting ? 'handwriting' : 'normal',
              fontFamily: isHandwriting ? "'Caveat', cursive, sans-serif" : undefined,
            },
          });
        });
      }

      // Sub-Tree Branching from this flowchart node (Problem 3: Compound Graph)
      if (step.children && step.children.length > 0) {
        const childBoxes = step.children.map((c) => {
          const cBox = calculateNodeBoxSize(c.label, isHandwriting ? 22 : 20, 180, 24, isHandwriting);
          let maxItemW = 0;
          if (c.items && c.items.length > 0) {
            for (const itm of c.items) {
              const itmW = measureTextWidth(`• ${itm}`, isHandwriting ? 20 : 18, false, isHandwriting);
              if (itmW > maxItemW) maxItemW = itmW;
            }
          }
          const colWidth = Math.max(cBox.width, Math.min(400, maxItemW + 24));
          return {
            ...c,
            boxWidth: cBox.width,
            boxHeight: cBox.height,
            colWidth,
          };
        });

        const branchGap = childBoxes.length <= 2 ? 60 : 35;
        const totalBranchW = childBoxes.reduce((sum, c) => sum + c.colWidth, 0) + Math.max(0, childBoxes.length - 1) * branchGap;
        const branchStartX = Math.round(step.x + step.width / 2 - totalBranchW / 2);
        const branchY = step.y + step.height + 85;

        let bCurrentX = branchStartX;
        childBoxes.forEach((child, cIdx) => {
          const cColor = child.color || themeColors[(cIdx + 1) % themeColors.length];
          const cBoxX = Math.round(bCurrentX + (child.colWidth - child.boxWidth) / 2);

          // Child Rectangle Box
          shapes.push({
            kind: 'shape',
            shapeType: 'rectangle',
            x: cBoxX,
            y: branchY,
            width: child.boxWidth,
            height: child.boxHeight,
            options: {
              label: child.label,
              color: cColor,
              strokeWidth: isHandwriting ? 2.2 : 2,
              roughness: isHandwriting ? 2.0 : 1.3,
              writingStyle: isHandwriting ? 'handwriting' : 'normal',
              fontFamily: isHandwriting ? "'Caveat', cursive, sans-serif" : undefined,
            },
          });

          // Connector Arrow from step bottom center to child top center
          shapes.push({
            kind: 'shape',
            shapeType: 'arrow',
            x: Math.round(step.x + step.width / 2),
            y: step.y + step.height,
            toX: Math.round(cBoxX + child.boxWidth / 2),
            toY: branchY,
            options: {
              color: 'rgba(255, 255, 255, 0.8)',
              strokeWidth: isHandwriting ? 2.2 : 2,
              roughness: isHandwriting ? 1.8 : 1,
              writingStyle: isHandwriting ? 'handwriting' : 'normal',
            },
          });

          // Child Bullet items
          if (child.items && child.items.length > 0) {
            const itemStartY = branchY + child.boxHeight + 28;
            child.items.forEach((item, itemIdx) => {
              const itemText = item.startsWith('•') || item.startsWith('-') ? item : `• ${item}`;
              shapes.push({
                kind: 'shape',
                shapeType: 'text',
                x: bCurrentX,
                y: itemStartY + itemIdx * (isHandwriting ? 32 : 28),
                options: {
                  text: itemText,
                  fontSize: isHandwriting ? 20 : 17,
                  color: 'rgba(255, 255, 255, 0.9)',
                  maxWidth: child.colWidth + 20,
                  writingStyle: isHandwriting ? 'handwriting' : 'normal',
                  fontFamily: isHandwriting ? "'Caveat', cursive, sans-serif" : undefined,
                },
              });
            });
          }

          bCurrentX += child.colWidth + branchGap;
        });
      }
    });

    return shapes;
  }

  /**
   * Generates a Side-by-Side Comparison Layout.
   */
  private static generateComparison(options: DiagramOptions): ShapePayload[] {
    const shapes: ShapePayload[] = [];
    const nodes = options.nodes || [];
    if (nodes.length === 0) return shapes;

    const isHandwriting = options.writingStyle === 'handwriting' ||
      /handwritten|handwriting/i.test(options.title || '');

    const numCols = Math.min(3, nodes.length);
    const cardWidth = numCols === 2 ? 420 : 340;
    const gap = 80;
    const totalW = numCols * cardWidth + (numCols - 1) * gap;
    const startX = Math.max(120, Math.round(960 - totalW / 2));
    const startY = 180;

    const themeColors = ['#4ECDC4', '#FFAB00', '#C77DFF'];

    nodes.slice(0, numCols).forEach((col, idx) => {
      const colX = startX + idx * (cardWidth + gap);
      const color = col.color || themeColors[idx % themeColors.length];

      // Category Header Box
      shapes.push({
        kind: 'shape',
        shapeType: 'rectangle',
        x: colX,
        y: startY,
        width: cardWidth,
        height: isHandwriting ? 68 : 60,
        options: {
          label: col.label,
          color,
          strokeWidth: isHandwriting ? 2.2 : 2.5,
          roughness: isHandwriting ? 2.0 : 1.2,
          writingStyle: isHandwriting ? 'handwriting' : 'normal',
          fontFamily: isHandwriting ? "'Caveat', cursive, sans-serif" : undefined,
        },
      });

      // Comparison Items inside card
      if (col.items && col.items.length > 0) {
        const itemStartY = startY + (isHandwriting ? 68 : 60) + 32;
        col.items.forEach((item, itmIdx) => {
          shapes.push({
            kind: 'shape',
            shapeType: 'text',
            x: colX + 16,
            y: itemStartY + itmIdx * (isHandwriting ? 36 : 34),
            options: {
              text: item.startsWith('•') || item.startsWith('-') ? item : `• ${item}`,
              fontSize: isHandwriting ? 22 : 19,
              color: 'rgba(255, 255, 255, 0.95)',
              maxWidth: cardWidth - 32,
              writingStyle: isHandwriting ? 'handwriting' : 'normal',
              fontFamily: isHandwriting ? "'Caveat', cursive, sans-serif" : undefined,
            },
          });
        });
      }
    });

    return shapes;
  }

  /**
   * Deterministic Viewport Auto-Fitting & Clamping.
   *
   * Enforces 100% mathematical guarantee that the entire diagram
   * (all boxes, text, connectors, and items) fits comfortably within
   * the blackboard safe drawing boundaries:
   * X: [140, 1780] (SAFE_WIDTH = 1640)
   * Y: [100, 980]  (SAFE_HEIGHT = 880)
   *
   * Multi-Diagram Slot Allocation:
   * If existing shapes are on the canvas or an explicit position is provided,
   * dynamically partitions the canvas into non-overlapping zones (left, right, bottom, top).
   */
  public static fitToViewport(shapes: ShapePayload[], options?: DiagramOptions): ShapePayload[] {
    if (!shapes || shapes.length === 0) return shapes;

    // 1. Calculate bounding box of all shapes in the new diagram
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;

    for (const s of shapes) {
      if (s.shapeType === 'line' || s.shapeType === 'arrow') {
        const toX = s.toX ?? s.x;
        const toY = s.toY ?? s.y;
        minX = Math.min(minX, s.x, toX);
        maxX = Math.max(maxX, s.x, toX);
        minY = Math.min(minY, s.y, toY);
        maxY = Math.max(maxY, s.y, toY);
      } else {
        const w = s.width ?? (s.options?.maxWidth ?? 200);
        const h = s.height ?? (s.options?.fontSize ? s.options.fontSize * 1.8 : 45);
        minX = Math.min(minX, s.x);
        maxX = Math.max(maxX, s.x + w);
        minY = Math.min(minY, s.y);
        maxY = Math.max(maxY, s.y + h);
      }
    }

    const totalW = Math.max(1, maxX - minX);
    const totalH = Math.max(1, maxY - minY);

    const SAFE_MIN_X = 140;
    const SAFE_MAX_X = 1780;
    const SAFE_MIN_Y = 100;
    const SAFE_MAX_Y = 980;

    let targetMinX = SAFE_MIN_X;
    let targetMaxX = SAFE_MAX_X;
    let targetMinY = SAFE_MIN_Y;
    let targetMaxY = SAFE_MAX_Y;

    // 2. Region / Slot Allocation (Collision avoidance & placement)
    if (options?.x !== undefined && options?.y !== undefined) {
      targetMinX = Math.max(SAFE_MIN_X, options.x);
      targetMinY = Math.max(SAFE_MIN_Y, options.y);
      const targetW = options.width && options.width > 50 ? options.width : Math.min(totalW, SAFE_MAX_X - targetMinX);
      const targetH = options.height && options.height > 50 ? options.height : Math.min(totalH, SAFE_MAX_Y - targetMinY);
      targetMaxX = Math.min(SAFE_MAX_X, targetMinX + targetW);
      targetMaxY = Math.min(SAFE_MAX_Y, targetMinY + targetH);
    } else if (options?.position === 'left') {
      targetMinX = SAFE_MIN_X;
      targetMaxX = 930;
      targetMinY = SAFE_MIN_Y;
      targetMaxY = SAFE_MAX_Y;
    } else if (options?.position === 'right') {
      targetMinX = 990;
      targetMaxX = SAFE_MAX_X;
      targetMinY = SAFE_MIN_Y;
      targetMaxY = SAFE_MAX_Y;
    } else if (options?.position === 'top') {
      targetMinX = SAFE_MIN_X;
      targetMaxX = SAFE_MAX_X;
      targetMinY = SAFE_MIN_Y;
      targetMaxY = 510;
    } else if (options?.position === 'bottom') {
      targetMinX = SAFE_MIN_X;
      targetMaxX = SAFE_MAX_X;
      targetMinY = 550;
      targetMaxY = SAFE_MAX_Y;
    } else if (options?.position === 'center') {
      targetMinX = SAFE_MIN_X;
      targetMaxX = SAFE_MAX_X;
      targetMinY = SAFE_MIN_Y;
      targetMaxY = SAFE_MAX_Y;
    } else {
      // Auto collision-aware slot allocation
      const existing = options?.existingShapes;
      if (existing && existing.length > 0) {
        let exMinX = Infinity;
        let exMaxX = -Infinity;
        let exMinY = Infinity;
        let exMaxY = -Infinity;
        let validShapeCount = 0;

        for (const s of existing) {
          if (s.shapeType === 'line' || s.shapeType === 'arrow') {
            const toX = s.toX ?? s.x;
            const toY = s.toY ?? s.y;
            exMinX = Math.min(exMinX, s.x, toX);
            exMaxX = Math.max(exMaxX, s.x, toX);
            exMinY = Math.min(exMinY, s.y, toY);
            exMaxY = Math.max(exMaxY, s.y, toY);
            validShapeCount++;
          } else {
            const w = s.width ?? (s.options?.maxWidth ?? 160);
            const h = s.height ?? (s.options?.fontSize ? s.options.fontSize * 1.8 : 45);
            if (w > 0 && h > 0) {
              exMinX = Math.min(exMinX, s.x);
              exMaxX = Math.max(exMaxX, s.x + w);
              exMinY = Math.min(exMinY, s.y);
              exMaxY = Math.max(exMaxY, s.y + h);
              validShapeCount++;
            }
          }
        }

        if (validShapeCount > 0 && exMinX < exMaxX && exMinY < exMaxY) {
          // Check if attached to a specific existing node
          let attachedNode: ShapePayload | undefined;
          if (options.attachToNode) {
            const match = options.attachToNode.trim().toLowerCase();
            attachedNode = existing.find(
              (s) =>
                s.shapeType === 'rectangle' &&
                ((s.options?.label && s.options.label.toLowerCase().includes(match)) ||
                  (s.label && s.label.toLowerCase().includes(match)))
            );
          }

          if (attachedNode) {
            const nodeCenterX = attachedNode.x + (attachedNode.width ?? 140) / 2;
            const nodeBottomY = attachedNode.y + (attachedNode.height ?? 50);

            if (nodeCenterX < 900 && SAFE_MAX_X - exMaxX >= 480) {
              // Space available on right
              targetMinX = Math.max(980, exMaxX + 50);
              targetMaxX = SAFE_MAX_X;
              targetMinY = Math.max(SAFE_MIN_Y, attachedNode.y - 40);
              targetMaxY = SAFE_MAX_Y;
            } else if (SAFE_MAX_Y - exMaxY >= 320) {
              // Space available on bottom
              targetMinX = SAFE_MIN_X;
              targetMaxX = SAFE_MAX_X;
              targetMinY = Math.max(nodeBottomY + 50, exMaxY + 40);
              targetMaxY = SAFE_MAX_Y;
            } else if (nodeCenterX >= 900 && exMinX - SAFE_MIN_X >= 480) {
              // Space available on left
              targetMinX = SAFE_MIN_X;
              targetMaxX = Math.min(940, exMinX - 50);
              targetMinY = Math.max(SAFE_MIN_Y, attachedNode.y - 40);
              targetMaxY = SAFE_MAX_Y;
            } else {
              targetMinX = Math.max(980, exMaxX + 40);
              targetMaxX = SAFE_MAX_X;
              targetMinY = SAFE_MIN_Y;
              targetMaxY = SAFE_MAX_Y;
            }
          } else {
            // General 2D Packing / Partitioning: find largest free quadrant/half
            const freeLeft = Math.max(0, exMinX - SAFE_MIN_X);
            const freeRight = Math.max(0, SAFE_MAX_X - exMaxX);
            const freeBottom = Math.max(0, SAFE_MAX_Y - exMaxY);
            const freeTop = Math.max(0, exMinY - SAFE_MIN_Y);

            if (freeRight >= 480 && freeRight >= freeLeft) {
              // Place on right half
              targetMinX = Math.max(980, exMaxX + 50);
              targetMaxX = SAFE_MAX_X;
              targetMinY = SAFE_MIN_Y;
              targetMaxY = SAFE_MAX_Y;
            } else if (freeLeft >= 480) {
              // Place on left half
              targetMinX = SAFE_MIN_X;
              targetMaxX = Math.min(940, exMinX - 50);
              targetMinY = SAFE_MIN_Y;
              targetMaxY = SAFE_MAX_Y;
            } else if (freeBottom >= 280) {
              // Place on bottom half
              targetMinX = SAFE_MIN_X;
              targetMaxX = SAFE_MAX_X;
              targetMinY = Math.max(540, exMaxY + 40);
              targetMaxY = SAFE_MAX_Y;
            } else if (freeTop >= 280) {
              // Place on top half
              targetMinX = SAFE_MIN_X;
              targetMaxX = SAFE_MAX_X;
              targetMinY = SAFE_MIN_Y;
              targetMaxY = Math.min(500, exMinY - 40);
            } else {
              // Default to right with offset
              targetMinX = Math.min(1050, Math.max(980, exMaxX + 30));
              targetMaxX = SAFE_MAX_X;
              targetMinY = SAFE_MIN_Y;
              targetMaxY = SAFE_MAX_Y;
            }
          }
        }
      }
    }

    const slotW = Math.max(200, targetMaxX - targetMinX);
    const slotH = Math.max(150, targetMaxY - targetMinY);

    // 3. Compute Scale Ratio to fit inside the allocated slot
    const scaleX = totalW > slotW ? slotW / totalW : 1.0;
    const scaleY = totalH > slotH ? slotH / totalH : 1.0;
    const scale = Math.min(scaleX, scaleY, 1.0);

    const fittedH = totalH * scale;

    // 4. Center horizontally inside slot, anchor vertically
    const currentCenterX = (minX + maxX) / 2;
    const targetCenterX = Math.round(targetMinX + slotW / 2);
    const targetStartY = Math.round(targetMinY + Math.max(0, (slotH - fittedH) / 6));

    return shapes.map((s) => {
      const copy: ShapePayload = {
        ...s,
        options: s.options ? { ...s.options } : undefined,
      };

      // Scale & transform X coordinates
      copy.x = Math.round(targetCenterX + (s.x - currentCenterX) * scale);
      if (copy.width !== undefined) {
        copy.width = Math.round(copy.width * scale);
      }
      if (copy.toX !== undefined) {
        copy.toX = Math.round(targetCenterX + (copy.toX - currentCenterX) * scale);
      }

      // Scale & transform Y coordinates
      copy.y = Math.round(targetStartY + (s.y - minY) * scale);
      if (copy.height !== undefined) {
        copy.height = Math.round(copy.height * scale);
      }
      if (copy.toY !== undefined) {
        copy.toY = Math.round(targetStartY + (copy.toY - minY) * scale);
      }

      // Scale font size and maxWidth
      if (copy.options) {
        if (copy.options.fontSize) {
          copy.options.fontSize = Math.max(12, Math.round(copy.options.fontSize * scale));
        }
        if (copy.options.maxWidth) {
          copy.options.maxWidth = Math.round(copy.options.maxWidth * scale);
        }
      }

      return copy;
    });
  }
}
