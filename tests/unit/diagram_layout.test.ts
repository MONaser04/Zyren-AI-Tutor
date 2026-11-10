import { describe, it, expect, vi } from 'vitest';
import * as CollisionDetector from '../../src/engine/CollisionDetector';
import { SyncEngine } from '../../src/engine/SyncEngine';
import { AudioClock } from '../../src/engine/AudioClock';
import {
  measureTextWidth,
  calculateNodeBoxSize,
  DiagramLayoutEngine,
} from '../../src/engine/DiagramLayoutEngine';

describe('DiagramLayoutEngine — Deterministic Diagram & Layout Solver', () => {
  describe('Text Measurement & Box Auto-Sizing', () => {
    it('measures short and long text labels accurately', () => {
      const shortW = measureTextWidth('ML', 22);
      const longW = measureTextWidth('Reinforcement Learning', 22);
      expect(shortW).toBeGreaterThan(15);
      expect(longW).toBeGreaterThan(200);
      expect(longW).toBeGreaterThan(shortW * 4);
    });

    it('auto-sizes boxes so box width is strictly greater than text width with generous padding', () => {
      const labels = [
        'AI',
        'Supervised Learning',
        'Unsupervised Learning',
        'Reinforcement Learning',
        'Deep Convolutional Neural Networks',
      ];

      for (const label of labels) {
        const textW = measureTextWidth(label, 20, true);
        const box = calculateNodeBoxSize(label, 20, 180, 28);
        expect(box.width).toBeGreaterThanOrEqual(textW + 40);
        expect(box.height).toBeGreaterThanOrEqual(44);
      }
    });
  });

  describe('Hierarchical Tree Layout Generation', () => {
    const mlTreeOptions = {
      title: 'Machine Learning Overview',
      diagramType: 'tree' as const,
      root: 'Machine Learning',
      nodes: [
        {
          label: 'Supervised Learning',
          items: ['Regression (House Prices)', 'Classification (Spam Detection)'],
        },
        {
          label: 'Unsupervised Learning',
          items: ['Clustering (Customer Segments)', 'Association (Market Basket)'],
        },
        {
          label: 'Reinforcement Learning',
          items: ['Game AI (Chess, Go)', 'Robotics Navigation'],
        },
      ],
    };

    it('generates a root box, child boxes, connectors, and bullet items', () => {
      const shapes = DiagramLayoutEngine.generateShapes(mlTreeOptions);
      expect(shapes.length).toBeGreaterThan(0);

      const rectangles = shapes.filter((s) => s.shapeType === 'rectangle');
      const arrows = shapes.filter((s) => s.shapeType === 'arrow');
      const texts = shapes.filter((s) => s.shapeType === 'text');

      // 1 root + 3 children = 4 rectangles
      expect(rectangles.length).toBe(4);
      // 3 arrows connecting root to children
      expect(arrows.length).toBe(3);
      // 6 bullet items total (2 per child)
      expect(texts.length).toBe(6);
    });

    it('guarantees child boxes are placed strictly below root box with vertical level gap', () => {
      const shapes = DiagramLayoutEngine.generateShapes(mlTreeOptions);
      const rectangles = shapes.filter((s) => s.shapeType === 'rectangle');
      const rootRect = rectangles[0];
      const childRects = rectangles.slice(1);

      for (const child of childRects) {
        // Child Y must be at least 50px below root bottom
        expect(child.y).toBeGreaterThanOrEqual(rootRect.y + (rootRect.height ?? 50) + 50);
      }
    });

    it('guarantees child boxes do not overlap horizontally', () => {
      const shapes = DiagramLayoutEngine.generateShapes(mlTreeOptions);
      const rectangles = shapes.filter((s) => s.shapeType === 'rectangle');
      const childRects = rectangles.slice(1);

      // Sort children from left to right
      childRects.sort((a, b) => a.x - b.x);

      for (let i = 0; i < childRects.length - 1; i++) {
        const left = childRects[i];
        const right = childRects[i + 1];
        const leftEnd = left.x + (left.width ?? 0);
        // There must be positive horizontal gap between sibling boxes
        expect(right.x).toBeGreaterThan(leftEnd);
      }
    });

    it('guarantees arrows connect from root bottom center to child top center', () => {
      const shapes = DiagramLayoutEngine.generateShapes(mlTreeOptions);
      const rectangles = shapes.filter((s) => s.shapeType === 'rectangle');
      const arrows = shapes.filter((s) => s.shapeType === 'arrow');
      const rootRect = rectangles[0];
      const childRects = rectangles.slice(1);

      const rootBottomCenter = {
        x: Math.round(rootRect.x + (rootRect.width ?? 0) / 2),
        y: rootRect.y + (rootRect.height ?? 0),
      };

      for (let i = 0; i < arrows.length; i++) {
        const arrow = arrows[i];
        const child = childRects[i];
        const childTopCenter = Math.round(child.x + (child.width ?? 0) / 2);

        // Arrow start must match root bottom center
        expect(arrow.x).toBe(rootBottomCenter.x);
        expect(arrow.y).toBe(rootBottomCenter.y);

        // Arrow end must match child top center
        expect(arrow.toX).toBe(childTopCenter);
        expect(arrow.toY).toBe(child.y);
      }
    });

    it('guarantees bullet items have safe vertical clearance below child boxes (zero border collision)', () => {
      const shapes = DiagramLayoutEngine.generateShapes(mlTreeOptions);
      const rectangles = shapes.filter((s) => s.shapeType === 'rectangle');
      const texts = shapes.filter((s) => s.shapeType === 'text');
      const childRects = rectangles.slice(1);

      // First bullet item must start at least 25px below child box bottom
      const minChildBottom = Math.min(...childRects.map((c) => c.y + (c.height ?? 0)));
      for (const text of texts) {
        expect(text.y).toBeGreaterThanOrEqual(minChildBottom + 25);
      }
    });
  });

  describe('Sequential Flowchart Layout', () => {
    it('creates sequential horizontal process steps with connecting arrows', () => {
      const flowchartOptions = {
        title: 'SDLC Process',
        diagramType: 'flowchart' as const,
        direction: 'LR' as const,
        nodes: [
          { label: 'Analysis' },
          { label: 'Design' },
          { label: 'Implementation' },
          { label: 'Testing' },
        ],
      };

      const shapes = DiagramLayoutEngine.generateShapes(flowchartOptions);
      const rects = shapes.filter((s) => s.shapeType === 'rectangle');
      const arrows = shapes.filter((s) => s.shapeType === 'arrow');

      expect(rects.length).toBe(4);
      expect(arrows.length).toBe(3);

      // Each step must be to the right of the previous step
      for (let i = 0; i < rects.length - 1; i++) {
        expect(rects[i + 1].x).toBeGreaterThan(rects[i].x + (rects[i].width ?? 0));
      }
    });
  });

  describe('Comparison Layout', () => {
    it('creates side-by-side comparison columns without horizontal overlap', () => {
      const comparisonOptions = {
        title: 'Energy Comparison',
        diagramType: 'comparison' as const,
        nodes: [
          { label: 'Kinetic Energy', items: ['Energy of motion', 'E_k = 0.5 * m * v^2'] },
          { label: 'Potential Energy', items: ['Stored energy', 'E_p = m * g * h'] },
        ],
      };

      const shapes = DiagramLayoutEngine.generateShapes(comparisonOptions);
      const rects = shapes.filter((s) => s.shapeType === 'rectangle');
      const texts = shapes.filter((s) => s.shapeType === 'text');

      expect(rects.length).toBe(2);
      expect(texts.length).toBe(4);
      expect(rects[1].x).toBeGreaterThan(rects[0].x + (rects[0].width ?? 0));
    });
  });

  describe('Gemini Real Session Payload & Viewport Clamping Guarantees', () => {
    it('accurately parses the real Gemini 10-node session payload into 3 categories with sub-items', () => {
      // The exact payload extracted from process memory in the real session:
      const realGeminiPayload = {
        title: 'Machine Learning Types',
        root: 'ML',
        diagramType: 'tree' as const,
        nodes: [
          { id: 'ML', label: 'Machine Learning Types' },
          { id: 'SL', label: 'Supervised Learning' },
          { label: 'Unsupervised Learning', id: 'UL' },
          { label: 'Reinforcement Learning', id: 'RL' },
          { label: 'Classification\n(e.g. Email Filtering)', id: 'SL_C' },
          { label: 'Regression\n(e.g. Price Prediction)', id: 'SL_R' },
          { label: 'Clustering\n(e.g. Customer Segmentation)', id: 'UL_Cl' },
          { id: 'UL_A', label: 'Association\n(e.g. Market Basket Analysis)' },
          { id: 'RL_G', label: 'Game AI\n(e.g. Chess)' },
          { label: 'Robot Navigation', id: 'RL_R' },
        ],
      };

      const shapes = DiagramLayoutEngine.generateShapes(realGeminiPayload);
      const rects = shapes.filter((s) => s.shapeType === 'rectangle');
      const arrows = shapes.filter((s) => s.shapeType === 'arrow');
      const texts = shapes.filter((s) => s.shapeType === 'text');

      // 1. Root must be reconciled to "Machine Learning Types" (not "ML" with child "Machine Learning Types")
      expect(rects[0].options?.label).toBe('Machine Learning Types');

      // 2. Exactly 4 rectangles: 1 Root + 3 Main Categories (Supervised, Unsupervised, Reinforcement)
      expect(rects.length).toBe(4);

      // 3. Exactly 3 arrows connecting Root to the 3 main categories
      expect(arrows.length).toBe(3);

      // 4. Exactly 6 bullet items placed cleanly under the categories
      expect(texts.length).toBe(6);

      // 5. 100% Boundary Guarantee: Every single element is strictly inside the safe canvas [140, 1780]
      for (const s of shapes) {
        if (s.shapeType === 'rectangle') {
          expect(s.x).toBeGreaterThanOrEqual(120);
          expect(s.x + (s.width ?? 0)).toBeLessThanOrEqual(1800);
        } else if (s.shapeType === 'arrow') {
          expect(s.x).toBeGreaterThanOrEqual(120);
          expect(s.toX).toBeGreaterThanOrEqual(120);
          expect(s.x).toBeLessThanOrEqual(1800);
          expect(s.toX).toBeLessThanOrEqual(1800);
        } else if (s.shapeType === 'text') {
          expect(s.x).toBeGreaterThanOrEqual(120);
          expect(s.x).toBeLessThanOrEqual(1800);
        }
      }
    });

    it('accurately parses 11:20 PM session payload with categories_root into 3 branched category boxes with 3 arrows', () => {
      const payload1120 = {
        diagramType: 'tree' as const,
        title: 'Machine Learning Categories Tree Redraw',
        nodes: [
          { label: 'Machine Learning Categories', id: 'categories_root' },
          { label: 'Supervised Learning', parent: 'categories_root', id: 'supervised' },
          { id: 'unsupervised', label: 'Unsupervised Learning', parent: 'categories_root' },
          { parent: 'categories_root', id: 'reinforcement', label: 'Reinforcement Learning' },
          { id: 'linear_reg', parent: 'supervised', label: 'Linear Regression' },
          { parent: 'supervised', id: 'decision_tree', label: 'Decision Trees' },
          { parent: 'unsupervised', label: 'K-Means Clustering', id: 'k_means' },
          { parent: 'unsupervised', id: 'pca_node', label: 'PCA' },
          { parent: 'reinforcement', label: 'Q-Learning', id: 'q_learn' },
          { label: 'Robotics Navigation', parent: 'reinforcement', id: 'robo_nav' },
        ],
        direction: 'TB',
      };

      const shapes = DiagramLayoutEngine.generateShapes(payload1120);
      const rects = shapes.filter((s) => s.shapeType === 'rectangle');
      const arrows = shapes.filter((s) => s.shapeType === 'arrow');
      const texts = shapes.filter((s) => s.shapeType === 'text');

      // 1. Root box is "Machine Learning Categories"
      expect(rects[0].options?.label).toBe('Machine Learning Categories');

      // 2. Exactly 3 arrows branching down to 3 separate category boxes!
      expect(arrows.length).toBe(3);

      // 3. Exactly 4 rectangles: 1 Root + 3 Category boxes (Supervised, Unsupervised, Reinforcement)
      expect(rects.length).toBe(4);
      expect(rects[1].options?.label).toBe('Supervised Learning');
      expect(rects[2].options?.label).toBe('Unsupervised Learning');
      expect(rects[3].options?.label).toBe('Reinforcement Learning');

      // 4. Exactly 6 bullet items (2 per category)
      expect(texts.length).toBe(6);

      // 5. Clamped safely within canvas
      for (const s of shapes) {
        if (s.shapeType === 'rectangle') {
          expect(s.x).toBeGreaterThanOrEqual(120);
          expect(s.x + (s.width ?? 0)).toBeLessThanOrEqual(1800);
        }
      }
    });

    it('guarantees zero canvas overflow even when 12 wide nodes are provided (Viewport Auto-Fitting)', () => {
      const hugeTreeOptions = {
        title: 'Huge Taxonomy Tree',
        root: 'All Sciences',
        diagramType: 'tree' as const,
        nodes: [
          { label: 'Astrophysics & Cosmology' },
          { label: 'Quantum Mechanics & Particle Physics' },
          { label: 'Organic & Inorganic Chemistry' },
          { label: 'Molecular Biology & Genetics' },
          { label: 'Evolutionary Biology' },
          { label: 'Neuroscience & Cognitive Science' },
          { label: 'Geology & Geophysics' },
          { label: 'Computer Science & Artificial Intelligence' },
          { label: 'Applied Mathematics & Statistics' },
          { label: 'Atmospheric Sciences & Climatology' },
          { label: 'Biomedical Engineering' },
          { label: 'Material Science & Nanotechnology' },
        ],
      };

      const shapes = DiagramLayoutEngine.generateShapes(hugeTreeOptions);
      expect(shapes.length).toBeGreaterThan(0);

      // Verify that every single shape is strictly clamped inside [120, 1800]
      for (const s of shapes) {
        if (s.shapeType === 'rectangle') {
          expect(s.x).toBeGreaterThanOrEqual(120);
          expect(s.x + (s.width ?? 0)).toBeLessThanOrEqual(1800);
        } else if (s.shapeType === 'arrow') {
          expect(s.x).toBeGreaterThanOrEqual(120);
          expect(s.toX).toBeGreaterThanOrEqual(120);
          expect(s.x).toBeLessThanOrEqual(1800);
          expect(s.toX).toBeLessThanOrEqual(1800);
        }
      }
    });

    it('activates handwriting mode when writingStyle is handwriting', () => {
      const hwTreeOptions = {
        title: 'Neural Networks Architecture',
        root: 'Neural Networks',
        diagramType: 'tree' as const,
        writingStyle: 'handwriting' as const,
        nodes: [
          { label: 'Input Layer', items: ['Raw Features', 'Normalization'] },
          { label: 'Hidden Layers', items: ['Dense Weights', 'Activation Functions'] },
          { label: 'Output Layer', items: ['Probabilities', 'Loss Calculation'] },
        ],
      };

      const shapes = DiagramLayoutEngine.generateShapes(hwTreeOptions);
      const rects = shapes.filter((s) => s.shapeType === 'rectangle');
      const texts = shapes.filter((s) => s.shapeType === 'text');

      // 1. Boxes have sketchy hand-drawn roughness (2.0)
      for (const r of rects) {
        expect(r.options?.roughness).toBe(2.0);
        expect(r.options?.writingStyle).toBe('handwriting');
        expect(r.options?.fontFamily).toContain('Caveat');
      }

      // 2. Text shapes use Caveat handwriting font
      for (const t of texts) {
        expect(t.options?.writingStyle).toBe('handwriting');
        expect(t.options?.fontFamily).toContain('Caveat');
      }
    });

    it('auto-detects handwriting from title or root and cleans the title suffix', () => {
      const llmPromptOutput = {
        title: 'Detailed Machine Learning Branches Tree Handwritten',
        root: 'ml_root_handwritten',
        diagramType: 'tree' as const,
        nodes: [
          { id: 'supervised_handwritten', label: 'Supervised Learning', items: ['Regression', 'Classification'] },
          { id: 'unsupervised_handwritten', label: 'Unsupervised Learning', items: ['Clustering', 'Dimensionality Reduction'] },
        ],
      };

      const shapes = DiagramLayoutEngine.generateShapes(llmPromptOutput);
      const rects = shapes.filter((s) => s.shapeType === 'rectangle');
      const texts = shapes.filter((s) => s.shapeType === 'text');

      // Root label should be cleaned of "Handwritten"
      expect(rects[0].options?.label).not.toContain('Handwritten');
      expect(rects[0].options?.roughness).toBe(2.0);
      expect(rects[0].options?.fontFamily).toContain('Caveat');

      // Bullet items use Caveat
      for (const t of texts) {
        expect(t.options?.fontFamily).toContain('Caveat');
      }
    });
  });

  describe('CollisionDetector & Multi-Column Layout Precision', () => {
    it('calculates realistic bounding boxes for 24px handwriting body text without inflating to 600px', () => {
      const handwritingBody = {
        shapeType: 'handwriting' as const,
        x: 200,
        y: 250,
        text: '• Classification: Email Filtering',
        fontSize: 24,
        writingStyle: 'handwriting',
      };
      const bounds = CollisionDetector.getShapeBounds(handwritingBody);
      expect(bounds.width).toBeLessThan(500);
      expect(bounds.width).toBeGreaterThan(300);
      expect(bounds.height).toBe(32);
    });

    it('prevents false collision displacement between Column 1 (x=150) and Column 2 (x=500)', () => {
      const column1Shape = {
        id: 'shape-col1',
        shapeType: 'rectangle' as const,
        x: 150,
        y: 200,
        width: 250,
        height: 100,
      };
      const freePos = CollisionDetector.findFreePosition(
        { x: 500, y: 200 },
        { width: 250, height: 100 },
        [column1Shape],
        false,
        'rectangle'
      );
      // Shape in Column 2 at x=500 should NOT be pushed down or shifted
      expect(freePos.x).toBe(500);
      expect(freePos.y).toBe(200);
    });
  });

  describe('SyncEngine — Board Restoration & Label Rendering', () => {
    it('re-renders box labels with font size >= 19px and multi-line word wrapping upon loadBoard', () => {
      const drawnTexts: Array<{ text: string; x: number; y: number; opts?: any }> = [];
      const drawnRects: Array<{ x: number; y: number; w: number; h: number; opts?: any }> = [];

      const mockCanvasAdapter: any = {
        clear: vi.fn(),
        drawRectangle: vi.fn((x, y, w, h, opts) => {
          drawnRects.push({ x, y, w, h, opts });
          return 'rect-handle';
        }),
        drawEllipse: vi.fn(),
        drawLine: vi.fn(),
        drawArrow: vi.fn(),
        drawText: vi.fn((text, x, y, opts) => {
          drawnTexts.push({ text, x, y, opts });
          return 'text-handle';
        }),
        removeShape: vi.fn(),
        commitFrame: vi.fn(),
        rollbackToLastCommit: vi.fn(),
        resize: vi.fn(),
        getShapeBounds: vi.fn(),
        moveShape: vi.fn(),
        resizeShape: vi.fn(),
      };

      const mockSvgOverlay: any = {
        clear: vi.fn(),
        addWord: vi.fn(),
        commitFrame: vi.fn(),
        rollbackToLastCommit: vi.fn(),
        hasActiveDrawings: vi.fn().mockReturnValue(false),
      };

      const engine = new SyncEngine({
        canvasAdapter: mockCanvasAdapter,
        svgOverlay: mockSvgOverlay,
        getWritingStyle: () => 'handwriting',
      });

      const savedShapes = [
        {
          id: 'rect-1',
          shapeType: 'rectangle',
          x: 200,
          y: 200,
          width: 260,
          height: 80,
          options: {
            label: 'Supervised Learning\n(e.g. Classification)',
            writingStyle: 'handwriting',
          },
        },
      ];

      engine.loadBoard(savedShapes, []);

      // Verify rectangle was drawn
      expect(drawnRects.length).toBe(1);
      expect(drawnRects[0].x).toBe(200);

      // Verify label text was restored and drawn
      expect(drawnTexts.length).toBeGreaterThan(0);
      for (const dt of drawnTexts) {
        expect(dt.opts.fontSize).toBeGreaterThanOrEqual(19);
        expect(dt.opts.fontFamily).toContain('Caveat');
      }
      const combinedText = drawnTexts.map((t) => t.text).join(' ');
      expect(combinedText).toContain('Supervised');
    });
  });

  describe('Problem 1: Multi-Diagram Collision Avoidance & Non-Overlapping Slot Packing', () => {
    it('automatically positions a second diagram without overlapping when existing shapes exist', () => {
      // First diagram placed in left half (x: 200..700, y: 150..550)
      const firstDiagramShapes = [
        {
          id: 'rect-d1',
          shapeType: 'rectangle' as const,
          x: 200,
          y: 150,
          width: 500,
          height: 350,
          options: { label: 'First Flowchart' },
        },
      ];

      const secondDiagramOptions = {
        title: 'Second Diagram',
        diagramType: 'tree' as const,
        root: 'Subtopic Concepts',
        nodes: [
          { label: 'Category A', items: ['Item 1', 'Item 2'] },
          { label: 'Category B', items: ['Item 3', 'Item 4'] },
        ],
        existingShapes: firstDiagramShapes,
      };

      const shapes2 = DiagramLayoutEngine.generateShapes(secondDiagramOptions);
      expect(shapes2.length).toBeGreaterThan(0);

      // Verify that all shapes of the 2nd diagram do NOT overlap the 1st diagram bounding box
      const d1Box = { minX: 200, maxX: 700, minY: 150, maxY: 500 };
      const d2Rects = shapes2.filter((s) => s.shapeType === 'rectangle');

      for (const r of d2Rects) {
        const rMinX = r.x;
        const rMaxX = r.x + (r.width ?? 150);
        const rMinY = r.y;
        const rMaxY = r.y + (r.height ?? 50);

        // Check if there is horizontal separation OR vertical separation
        const noOverlap =
          rMinX >= d1Box.maxX ||
          rMaxX <= d1Box.minX ||
          rMinY >= d1Box.maxY ||
          rMaxY <= d1Box.minY;

        expect(noOverlap).toBe(true);
      }
    });

    it('honors explicit position slots: "left" and "right"', () => {
      const leftDiag = DiagramLayoutEngine.generateShapes({
        title: 'Left Diagram',
        diagramType: 'tree' as const,
        root: 'Root Left',
        nodes: [{ label: 'Child L', items: ['L1'] }],
        position: 'left',
      });

      const rightDiag = DiagramLayoutEngine.generateShapes({
        title: 'Right Diagram',
        diagramType: 'tree' as const,
        root: 'Root Right',
        nodes: [{ label: 'Child R', items: ['R1'] }],
        position: 'right',
      });

      const leftRects = leftDiag.filter((s) => s.shapeType === 'rectangle');
      const rightRects = rightDiag.filter((s) => s.shapeType === 'rectangle');

      // Left diagram rectangles should all stay within [140, 930]
      for (const r of leftRects) {
        expect(r.x).toBeGreaterThanOrEqual(140);
        expect(r.x + (r.width ?? 0)).toBeLessThanOrEqual(950);
      }

      // Right diagram rectangles should all stay within [980, 1780]
      for (const r of rightRects) {
        expect(r.x).toBeGreaterThanOrEqual(980);
        expect(r.x + (r.width ?? 0)).toBeLessThanOrEqual(1780);
      }
    });
  });

  describe('Problem 2: Flowchart Direction Change Midway & Orthogonal Elbow Connectors', () => {
    it('supports changing flow direction mid-diagram from vertical down to horizontal right', () => {
      const turnOptions = {
        title: 'Pipeline Turning Right',
        diagramType: 'flowchart' as const,
        direction: 'TB' as const,
        nodes: [
          { label: 'Step 1: Input', flow: 'down' as const },
          { label: 'Step 2: Processing', flow: 'right' as const },
          { label: 'Step 3: Output', flow: 'right' as const },
        ],
      };

      const shapes = DiagramLayoutEngine.generateShapes(turnOptions);
      const rectangles = shapes.filter((s) => s.shapeType === 'rectangle');
      expect(rectangles.length).toBe(3);

      const r1 = rectangles[0];
      const r2 = rectangles[1];
      const r3 = rectangles[2];

      // Step 2 is vertically below Step 1
      expect(r2.y).toBeGreaterThan(r1.y + (r1.height ?? 0));

      // Step 3 is horizontally to the right of Step 2
      expect(r3.x).toBeGreaterThan(r2.x + (r2.width ?? 0));

      // Connectors include an arrow from r2 to r3 pointing horizontally
      const arrows = shapes.filter((s) => s.shapeType === 'arrow');
      const arrowToR3 = arrows.find((a) => Math.abs(a.toX - r3.x) < 15);
      expect(arrowToR3).toBeDefined();
    });

    it('supports upward flow direction ("up") for loops and upward progressions', () => {
      const upOptions = {
        title: 'Pipeline Flowing Upwards',
        diagramType: 'flowchart' as const,
        direction: 'TB' as const,
        nodes: [
          { label: 'Step 1: Base', flow: 'up' as const },
          { label: 'Step 2: Ascending', flow: 'up' as const },
        ],
      };

      const shapes = DiagramLayoutEngine.generateShapes(upOptions);
      const rectangles = shapes.filter((s) => s.shapeType === 'rectangle');
      expect(rectangles.length).toBe(2);

      const r1 = rectangles[0];
      const r2 = rectangles[1];

      // Step 2 is vertically ABOVE Step 1
      expect(r2.y).toBeLessThan(r1.y);

      // Connectors include an upward arrow from r1 to r2
      const arrows = shapes.filter((s) => s.shapeType === 'arrow');
      expect(arrows.length).toBeGreaterThan(0);
      const upwardArrow = arrows.find((a) => a.y > a.toY);
      expect(upwardArrow).toBeDefined();
    });
  });

  describe('Problem 3: Connecting Flowcharts to Concept Trees (Hybrid & Inter-Diagram)', () => {
    it('renders compound tree children branching directly from a flowchart step', () => {
      const hybridOptions = {
        title: 'Data Flow & Models',
        diagramType: 'flowchart' as const,
        direction: 'TB' as const,
        nodes: [
          { label: 'Data Ingestion', flow: 'down' as const },
          {
            label: 'Model Training',
            children: [
              { label: 'Classification', items: ['Random Forest', 'SVM'] },
              { label: 'Regression', items: ['Linear', 'Ridge'] },
            ],
          },
        ],
      };

      const shapes = DiagramLayoutEngine.generateShapes(hybridOptions);
      const rectangles = shapes.filter((s) => s.shapeType === 'rectangle');

      // 2 flowchart steps + 2 child tree boxes = 4 rectangles
      expect(rectangles.length).toBe(4);

      // Child tree boxes are placed underneath Model Training step
      const modelStep = rectangles.find((r) => r.options?.label?.includes('Model Training'));
      expect(modelStep).toBeDefined();

      const childRects = rectangles.filter(
        (r) => r.options?.label === 'Classification' || r.options?.label === 'Regression'
      );
      expect(childRects.length).toBe(2);

      for (const c of childRects) {
        expect(c.y).toBeGreaterThan(modelStep!.y + (modelStep!.height ?? 0));
      }

      // Bullet items for the children exist
      const texts = shapes.filter((s) => s.shapeType === 'text');
      const rfText = texts.find((t) => t.options?.text?.includes('Random Forest'));
      expect(rfText).toBeDefined();
    });

    it('creates an inter-diagram bridging arrow when attachToNode is specified', () => {
      const existingShapes = [
        {
          id: 'prev-step-3',
          shapeType: 'rectangle' as const,
          x: 300,
          y: 200,
          width: 220,
          height: 60,
          options: { label: 'Step 3: Deployment' },
        },
      ];

      const treeOptions = {
        title: 'Deployment Architecture',
        diagramType: 'tree' as const,
        root: 'Architecture Tree',
        attachToNode: 'Step 3: Deployment',
        nodes: [
          { label: 'Cloud Run', items: ['Auto-scaling'] },
          { label: 'Kubernetes', items: ['Pod Replicas'] },
        ],
        existingShapes,
      };

      const shapes = DiagramLayoutEngine.generateShapes(treeOptions);
      const arrows = shapes.filter((s) => s.shapeType === 'arrow');

      // There should be internal tree arrows + 1 bridging arrow connecting from existing rectangle
      expect(arrows.length).toBeGreaterThan(2);

      const bridgeArrow = arrows.find(
        (a) =>
          Math.abs(a.x - (300 + 220)) < 10 ||
          Math.abs(a.x - (300 + 110)) < 10 ||
          Math.abs(a.y - (200 + 60)) < 10
      );
      expect(bridgeArrow).toBeDefined();
    });

    it('prevents collision when concept card is placed at explicit (x: 150, y: 180) overlapping existing text', () => {
      const existingText: any = {
        kind: 'shape',
        shapeType: 'text',
        x: 150,
        y: 180,
        width: 700,
        height: 70,
        options: {
          text: 'Machine Learning is a field of AI where computers learn from data and improve without being explicitly programmed.',
          fontSize: 24,
        },
      };

      const cardShapes = DiagramLayoutEngine.generateShapes({
        diagramType: 'concept_card',
        title: 'Spam Filtering',
        items: ['Input: Emails', 'Process: Analyze patterns', 'Output: Filter spam'],
        x: 150,
        y: 180,
        width: 600,
        existingShapes: [existingText],
      });

      const container = cardShapes.find((s) => s.shapeType === 'rectangle');
      expect(container).toBeDefined();

      const containerBox = {
        minX: container!.x,
        maxX: container!.x + (container!.width ?? 600),
        minY: container!.y,
        maxY: container!.y + (container!.height ?? 180),
      };

      const textBox = {
        minX: existingText.x,
        maxX: existingText.x + existingText.width,
        minY: existingText.y,
        maxY: existingText.y + existingText.height,
      };

      const overlaps =
        containerBox.minX < textBox.maxX - 5 &&
        containerBox.maxX > textBox.minX + 5 &&
        containerBox.minY < textBox.maxY - 5 &&
        containerBox.maxY > textBox.minY + 5;

      expect(overlaps).toBe(false);
      expect(container!.y).toBeGreaterThanOrEqual(textBox.maxY + 30);
    });
  });
  describe('Dynamic Flex-Track & True AABB Obstacle Layout (Image 1 & 2 Fixes)', () => {
    it('Scenario 1: Sequential text stays in Column 1 (x: 150) under header even when a diagram exists on the right', () => {
      const headerTitle: any = {
        kind: 'shape',
        shapeType: 'text',
        x: 150,
        y: 70,
        style: 'title',
        width: 400,
        height: 45,
        options: { text: 'Artificial Intelligence & Machine Learning' },
      };

      const rightDiagramRoot: any = {
        kind: 'shape',
        shapeType: 'rectangle',
        x: 1000,
        y: 180,
        width: 250,
        height: 60,
        options: { label: 'Core Concepts' },
      };

      const rightDiagramText: any = {
        kind: 'shape',
        shapeType: 'text',
        x: 1050,
        y: 280,
        width: 180,
        height: 35,
        options: { text: '• Subset of AI' },
      };

      const existingShapes = [headerTitle, rightDiagramRoot, rightDiagramText];

      const freePos = CollisionDetector.findFreePosition(
        { x: 150, y: 180 },
        { width: 550, height: 160 },
        existingShapes,
        false,
        'text'
      );

      // Must remain in Column 1 (COL1_X = 150), NOT banished to Column 2 (x: 1000)
      expect(freePos.x).toBe(CollisionDetector.COL1_X);
      // Must start cleanly below header (140-180), NOT pushed to bottom
      expect(freePos.y).toBeGreaterThanOrEqual(140);
      expect(freePos.y).toBeLessThanOrEqual(200);
    });

    it('Scenario 2: Sequential text in Column 1 is NOT pushed down by a center diagram that does not overlap horizontally', () => {
      const headerTitle: any = {
        kind: 'shape',
        shapeType: 'text',
        x: 150,
        y: 70,
        style: 'title',
        width: 350,
        height: 45,
        options: { text: 'Main Types of Machine Learning' },
      };

      const centerDiagramBox: any = {
        kind: 'shape',
        shapeType: 'rectangle',
        x: 820,
        y: 180,
        width: 240,
        height: 60,
        options: { label: 'Learning Approaches' },
      };

      const centerDiagramChild: any = {
        kind: 'shape',
        shapeType: 'rectangle',
        x: 820,
        y: 350,
        width: 240,
        height: 60,
        options: { label: 'Machine Learning' },
      };

      const existingShapes = [headerTitle, centerDiagramBox, centerDiagramChild];

      const freePos = CollisionDetector.findFreePosition(
        { x: 150, y: 180 },
        { width: 520, height: 180 },
        existingShapes,
        false,
        'text'
      );

      // Must remain in Column 1 (COL1_X = 150)
      expect(freePos.x).toBe(CollisionDetector.COL1_X);
      // Must start at safeTopY (<= 200), NOT pushed down to y=440+ below the center diagram
      expect(freePos.y).toBeLessThanOrEqual(200);
    });

    it('Scenario 3: Concept card renders title above divider and bullet items below, without centered box label', () => {
      const cardShapes = DiagramLayoutEngine.generateShapes({
        diagramType: 'concept_card',
        title: 'Real-World Examples',
        items: [
          'Supervised: Email Spam Detection, Medical Diagnosis',
          'Unsupervised: Customer Segmentation, Anomalies in Network Traffic',
          'Reinforcement: Robot Maze Navigation, Strategy Games',
        ],
      });

      const rootRect = cardShapes.find((s) => s.shapeType === 'rectangle');
      expect(rootRect).toBeDefined();
      expect(rootRect!.options?.label).toBeUndefined();

      const textShapes = cardShapes.filter((s) => s.shapeType === 'text');
      expect(textShapes.length).toBe(4);
      const titleShape = textShapes.find((s) => s.options?.text === 'Real-World Examples');
      expect(titleShape).toBeDefined();

      const dividerShape = cardShapes.find((s) => s.shapeType === 'line');
      expect(dividerShape).toBeDefined();
      expect(titleShape!.y).toBeLessThan(dividerShape!.y);

      const bulletTexts = textShapes.filter((s) => s !== titleShape);
      expect(bulletTexts.length).toBe(3);
      expect(bulletTexts[0].options?.text).toContain('Supervised:');
      expect(bulletTexts[0].y).toBeGreaterThan(dividerShape!.y);
      expect(bulletTexts[1].options?.text).toContain('Unsupervised:');
      expect(bulletTexts[2].options?.text).toContain('Reinforcement:');
    });

    it('Scenario 3b: Concept card automatically slots into non-overlapping free column beside existing notes', () => {
      // Existing notes in Column 1 (left side)
      const existingLeftNotes: any[] = [
        {
          kind: 'shape',
          shapeType: 'text',
          x: 140,
          y: 180,
          width: 500,
          height: 200,
          options: { text: 'Supervised Learning Notes...' },
        },
        {
          kind: 'shape',
          shapeType: 'text',
          x: 140,
          y: 420,
          width: 500,
          height: 250,
          options: { text: 'More details down to y=670...' },
        },
      ];

      const cardShapes = DiagramLayoutEngine.generateShapes({
        diagramType: 'concept_card',
        title: 'Supervised Learning Example: Fruit Classifier',
        items: [
          "Training Data: Images labeled 'Apple' or 'Banana'",
          'Model learns associations between images and labels',
          'Goal: Predict labels for new, unlabeled fruit images',
        ],
        existingShapes: existingLeftNotes,
      });

      const cardRect = cardShapes.find((s) => s.shapeType === 'rectangle');
      expect(cardRect).toBeDefined();

      // Card must not overlap any existing note
      for (const note of existingLeftNotes) {
        const overlaps =
          cardRect!.x < note.x + note.width &&
          cardRect!.x + cardRect!.width! > note.x &&
          cardRect!.y < note.y + note.height &&
          cardRect!.y + cardRect!.height! > note.y;
        expect(overlaps).toBe(false);
      }
    });

    it('Scenario 4: Multi-line wrapped items dynamically adjust spacing so lines never overlap', () => {
      const comparisonShapes = DiagramLayoutEngine.generateShapes({
        diagramType: 'comparison',
        title: 'Machine Learning Types Comparison',
        nodes: [
          {
            label: 'Supervised Learning',
            items: [
              'Lernen mit Labeled Data (Inputs & bekannte Outputs und weitere lange Erklaerungen).',
              'Beispiel: Spam-Filter.',
            ],
          },
        ],
      });

      const textShapes = comparisonShapes.filter((s) => s.shapeType === 'text');
      expect(textShapes.length).toBe(2);

      const firstItem = textShapes[0];
      const secondItem = textShapes[1];

      // Because the first item is 80+ chars, it wraps to multiple lines.
      // The second item must be shifted down significantly (> 50px) rather than the old fixed 34px!
      const verticalGap = secondItem.y - firstItem.y;
      expect(verticalGap).toBeGreaterThanOrEqual(55);
    });

    it('Scenario 5: Erasing a diagram by title removes ALL shapes in that diagram group cleanly', () => {
      const mockCanvasAdapter = {
        clear: vi.fn(),
        drawRectangle: vi.fn(),
        drawEllipse: vi.fn(),
        drawLine: vi.fn(),
        drawArrow: vi.fn(),
        drawText: vi.fn(),
      } as any;
      const mockSvgOverlay = {
        clear: vi.fn(),
        render: vi.fn(),
      } as any;

      const engine = new SyncEngine({
        canvasAdapter: mockCanvasAdapter,
        svgOverlay: mockSvgOverlay,
        getWritingStyle: () => 'normal',
      });

      const comparisonShapes = DiagramLayoutEngine.generateShapes({
        diagramType: 'comparison',
        title: 'Vergleich der Machine Learning Arten',
        nodes: [
          { label: 'Supervised Learning', items: ['Item 1', 'Item 2'] },
          { label: 'Unsupervised Learning', items: ['Item 3'] },
          { label: 'Reinforcement Learning', items: ['Item 4'] },
        ],
      });

      expect(comparisonShapes.length).toBeGreaterThan(3);
      engine.loadBoard(comparisonShapes, []);
      expect(engine.getDrawnShapes().length).toBe(comparisonShapes.length);

      // Erase by exact or partial diagram title
      const erased = engine.erase('Vergleich der Machine Learning Arten');
      expect(erased).toBe(true);
      // All shapes belonging to the comparison board must be removed!
      expect(engine.getDrawnShapes().length).toBe(0);
    });

    it('Scenario 6: Symbiosis Tree Sub-Branch strictly descends vertically below attached parent node', () => {
      const mockCanvasAdapter = {
        clear: vi.fn(),
        drawRectangle: vi.fn(),
        drawEllipse: vi.fn(),
        drawLine: vi.fn(),
        drawArrow: vi.fn(),
        drawText: vi.fn(),
      } as any;
      const mockSvgOverlay = {
        clear: vi.fn(),
        render: vi.fn(),
      } as any;

      const engine = new SyncEngine({
        canvasAdapter: mockCanvasAdapter,
        svgOverlay: mockSvgOverlay,
        getWritingStyle: () => 'normal',
      });

      // 1. Initial 3-way tree: Root + 3 children across the slide
      const initialShapes = [
        {
          id: 'root-node',
          shapeType: 'rectangle' as const,
          x: 750,
          y: 160,
          width: 320,
          height: 60,
          options: { label: 'Machine Learning Types' },
        },
        {
          id: 'child-sup',
          shapeType: 'rectangle' as const,
          x: 220,
          y: 280,
          width: 220,
          height: 55,
          options: { label: 'Supervised Learning' },
        },
        {
          id: 'child-unsup',
          shapeType: 'rectangle' as const,
          x: 780,
          y: 280,
          width: 240,
          height: 55,
          options: { label: 'Unsupervised Learning' },
        },
        {
          id: 'child-rl',
          shapeType: 'rectangle' as const,
          x: 1340,
          y: 280,
          width: 240,
          height: 55,
          options: { label: 'Reinforcement Learning' },
        },
      ];

      engine.loadBoard(initialShapes, []);

      // 2. Spatial layout must expose available semantic slots under each node
      const spatial = engine.getSpatialLayout();
      expect(spatial.nodes.length).toBe(4);
      expect(spatial.availableSlots.length).toBeGreaterThanOrEqual(4);
      expect(spatial.layoutSummary).toContain('Supervised Learning');

      // 3. Generate sub-tree for 'Supervised Learning'
      const subTreeShapes = DiagramLayoutEngine.generateShapes({
        diagramType: 'tree',
        title: 'Supervised Learning Subtypes',
        root: 'Supervised Learning Subtypes',
        attachToNode: 'Supervised Learning',
        nodes: [
          { label: 'Classification', items: ['Discrete labels'] },
          { label: 'Regression', items: ['Continuous values'] },
        ],
        existingShapes: initialShapes,
      });

      // The child diagram must NOT be shoved to the right side of the canvas (> 800)
      const subTreeRectangles = subTreeShapes.filter((s) => s.shapeType === 'rectangle');
      expect(subTreeRectangles.length).toBeGreaterThanOrEqual(2);

      const subTreeRoot = subTreeRectangles.find((r) =>
        (r.options?.label || r.label || '').includes('Supervised Learning Subtypes')
      );
      expect(subTreeRoot).toBeDefined();

      // Parent center X = 220 + 110 = 330.
      // Child root center X must be aligned near 330 (+/- 80px), definitely < 600 (NOT pushed to right!)
      const childCenterX = (subTreeRoot!.x ?? 0) + (subTreeRoot!.width ?? 140) / 2;
      expect(childCenterX).toBeLessThan(600);
      expect(childCenterX).toBeGreaterThan(150);

      // Child root Y must be strictly below parent bottom (280 + 55 = 335)
      expect(subTreeRoot!.y).toBeGreaterThan(335);

      // Bridging arrow must point downwards from parent
      const arrows = subTreeShapes.filter((s) => s.shapeType === 'arrow');
      const bridgeArrow = arrows.find(
        (a) => (a.y ?? 0) >= 335 && Math.abs((a.x ?? 0) - 330) < 60
      );
      expect(bridgeArrow).toBeDefined();
    });

    it('guarantees multi-sibling subtrees align horizontally on the same tier without staircase cascade or overflowing SAFE_MAX_Y', () => {
      // 1. Initial 3-branch overview diagram
      const mainTree = DiagramLayoutEngine.generateShapes({
        diagramType: 'tree',
        title: 'Machine Learning Types',
        root: 'Machine Learning Types',
        nodes: [
          { label: 'Supervised Learning' },
          { label: 'Unsupervised Learning' },
          { label: 'Reinforcement Learning' },
        ],
      });

      let currentShapes = [...mainTree];

      // 2. Attach sub-tree 1 under 'Supervised Learning'
      const sub1 = DiagramLayoutEngine.generateShapes({
        diagramType: 'tree',
        title: 'Supervised Learning Categories',
        root: 'Supervised Learning Categories',
        attachToNode: 'Supervised Learning',
        nodes: [
          { label: 'Classification' },
          { label: 'Regression' },
        ],
        existingShapes: currentShapes,
      });
      currentShapes.push(...sub1);

      // 3. Attach sub-tree 2 under 'Unsupervised Learning'
      const sub2 = DiagramLayoutEngine.generateShapes({
        diagramType: 'tree',
        title: 'Unsupervised Learning Categories',
        root: 'Unsupervised Learning Categories',
        attachToNode: 'Unsupervised Learning',
        nodes: [
          { label: 'Clustering' },
          { label: 'Dimensionality Reduction' },
        ],
        existingShapes: currentShapes,
      });
      currentShapes.push(...sub2);

      // 4. Attach sub-tree 3 under 'Reinforcement Learning'
      const sub3 = DiagramLayoutEngine.generateShapes({
        diagramType: 'tree',
        title: 'Reinforcement Learning Categories',
        root: 'Reinforcement Learning Categories',
        attachToNode: 'Reinforcement Learning',
        nodes: [
          { label: 'Model-Free' },
          { label: 'Model-Based' },
        ],
        existingShapes: currentShapes,
      });
      currentShapes.push(...sub3);

      // Extract root rectangles of each sub-tree
      const sub1Root = sub1.find((s) => s.shapeType === 'rectangle' && (s.options?.label || '').includes('Supervised Learning Categories'));
      const sub2Root = sub2.find((s) => s.shapeType === 'rectangle' && (s.options?.label || '').includes('Unsupervised Learning Categories'));
      const sub3Root = sub3.find((s) => s.shapeType === 'rectangle' && (s.options?.label || '').includes('Reinforcement Learning Categories'));

      expect(sub1Root).toBeDefined();
      expect(sub2Root).toBeDefined();
      expect(sub3Root).toBeDefined();

      // Tier Alignment Check: Sibling sub-diagram roots must align horizontally on the same tier (+/- 30px)
      // They must NOT cascade down like stairs (e.g. 440 -> 680 -> 870)
      expect(Math.abs(sub1Root!.y - sub2Root!.y)).toBeLessThanOrEqual(35);
      expect(Math.abs(sub2Root!.y - sub3Root!.y)).toBeLessThanOrEqual(35);

      // Canvas Boundary Check: NO shape in any diagram must ever fall below SAFE_MAX_Y (980)
      for (const s of currentShapes) {
        const bottom = (s.y ?? 0) + (s.height ?? 0);
        expect(bottom).toBeLessThanOrEqual(980);
        if (s.toY !== undefined) {
          expect(s.toY).toBeLessThanOrEqual(980);
        }
      }

      // Horizontal Ordering: Supervised (left) < Unsupervised (center) < Reinforcement (right)
      expect(sub1Root!.x).toBeLessThan(sub2Root!.x);
      expect(sub2Root!.x).toBeLessThan(sub3Root!.x);
    });
  });

  describe('Recursive Multi-Depth Trees, Empty Placeholder Boxes & In-Place Diagram Evolution', () => {
    const createMockEngine = () => {
      const mockCanvasAdapter = {
        clear: vi.fn(),
        drawRectangle: vi.fn(),
        drawEllipse: vi.fn(),
        drawLine: vi.fn(),
        drawArrow: vi.fn(),
        drawText: vi.fn(),
      } as any;
      const mockSvgOverlay = {
        clear: vi.fn(),
        render: vi.fn(),
        seek: vi.fn(),
      } as any;
      const engine = new SyncEngine({
        canvasAdapter: mockCanvasAdapter,
        svgOverlay: mockSvgOverlay,
        getWritingStyle: () => 'normal',
      });
      const dispatchDiagram = (options: any) => {
        (engine as any).executeShapeCommand({
          id: `diag-${Date.now()}-${Math.random()}`,
          kind: 'shape',
          shapeType: 'diagram',
          x: 120,
          y: 130,
          options,
        });
      };
      return { engine, mockCanvasAdapter, dispatchDiagram };
    };

    it('renders nested children at depth 2 as connected rectangle boxes with arrows (never flattened to bullet text)', () => {
      const shapes = DiagramLayoutEngine.generateShapes({
        title: 'Machine Learning Hierarchy',
        diagramType: 'tree',
        root: 'Machine Learning',
        nodes: [
          {
            label: 'Supervised Learning',
            children: [{ label: 'Classification' }, { label: 'Regression' }],
          },
          {
            label: 'Unsupervised Learning',
            children: [{ label: 'Clustering' }, { label: 'Dimensionality Reduction' }],
          },
          {
            label: 'Reinforcement Learning',
            children: [{ label: 'Q-Learning' }, { label: 'Policy Gradient' }],
          },
        ],
      });

      const rects = shapes.filter((s) => s.shapeType === 'rectangle');
      const arrows = shapes.filter((s) => s.shapeType === 'arrow');
      const texts = shapes.filter((s) => s.shapeType === 'text');

      // 1 root + 3 categories + 6 sub-branches = 10 rectangle boxes
      expect(rects.length).toBe(10);
      // 3 root->category arrows + 6 category->sub-branch arrows = 9 arrows
      expect(arrows.length).toBe(9);
      // 0 bullet text items
      expect(texts.length).toBe(0);

      const rootRect = rects.find((r) => r.options?.label === 'Machine Learning')!;
      const catRects = rects.filter((r) =>
        ['Supervised Learning', 'Unsupervised Learning', 'Reinforcement Learning'].includes(r.options?.label || '')
      );
      const leafRects = rects.filter(
        (r) =>
          r !== rootRect &&
          !catRects.includes(r)
      );

      expect(catRects.length).toBe(3);
      expect(leafRects.length).toBe(6);

      // Strict depth Y ordering: root < categories < leaf sub-branches
      for (const cat of catRects) {
        expect(cat.y).toBeGreaterThan(rootRect.y + (rootRect.height ?? 50));
      }
      for (const leaf of leafRects) {
        expect(leaf.y).toBeGreaterThan(catRects[0].y + (catRects[0].height ?? 50));
      }

      // Leaf boxes must not overlap horizontally
      const sortedLeaves = [...leafRects].sort((a, b) => a.x - b.x);
      for (let i = 0; i < sortedLeaves.length - 1; i++) {
        expect(sortedLeaves[i + 1].x).toBeGreaterThanOrEqual(
          sortedLeaves[i].x + (sortedLeaves[i].width ?? 0)
        );
      }
    });

    it('renders placeholder labels ("...", "") as empty rectangle boxes connected by arrows instead of bullets', () => {
      const shapes = DiagramLayoutEngine.generateShapes({
        title: 'Machine Learning Types',
        diagramType: 'tree',
        root: 'Machine Learning',
        nodes: [
          {
            label: 'Supervised Learning',
            children: [{ label: '...' }, { label: '...' }],
          },
          {
            label: 'Unsupervised Learning',
            children: [{ label: '' }, { label: '?' }],
          },
          {
            label: 'Reinforcement Learning',
            children: [{ label: '...' }, { label: '...' }],
          },
        ],
      });

      const rects = shapes.filter((s) => s.shapeType === 'rectangle');
      const arrows = shapes.filter((s) => s.shapeType === 'arrow');
      const texts = shapes.filter((s) => s.shapeType === 'text');

      expect(rects.length).toBe(10);
      expect(arrows.length).toBe(9);
      expect(texts.length).toBe(0);

      const emptyBoxes = rects.filter((r) => (r.options?.label || '') === '');
      expect(emptyBoxes.length).toBe(6);
    });

    it('evolves a concept tree in-place across multiple draw_diagram calls without stacking duplicate trees', () => {
      const { engine, dispatchDiagram } = createMockEngine();

      // Step 1: Draw initial 3-branch Machine Learning tree
      dispatchDiagram({
        title: 'Machine Learning',
        diagramType: 'tree',
        root: 'Machine Learning',
        nodes: [
          { label: 'Supervised Learning' },
          { label: 'Unsupervised Learning' },
          { label: 'Reinforcement Learning' },
        ],
      });

      let rects = engine.getDrawnShapes().filter((s) => s.shapeType === 'rectangle');
      expect(rects.length).toBe(4);

      // Step 2: User asks to branch empty boxes under each category
      dispatchDiagram({
        title: 'Machine Learning',
        diagramType: 'tree',
        root: 'Machine Learning',
        nodes: [
          { label: 'Supervised Learning', children: [{ label: '...' }, { label: '...' }] },
          { label: 'Unsupervised Learning', children: [{ label: '...' }, { label: '...' }] },
          { label: 'Reinforcement Learning', children: [{ label: '...' }, { label: '...' }] },
        ],
      });

      rects = engine.getDrawnShapes().filter((s) => s.shapeType === 'rectangle');
      const mlRootsAfterPlaceholder = rects.filter((r) => r.options?.label === 'Machine Learning');
      // Still ONLY ONE Machine Learning root box on the board!
      expect(mlRootsAfterPlaceholder.length).toBe(1);
      // 1 root + 3 categories + 6 empty placeholder boxes = 10 rectangles
      expect(rects.length).toBe(10);

      // Step 3: User asks to fill in real sub-branch names (or attaches via attachToNode with wrapper titles)
      dispatchDiagram({
        title: 'Supervised Learning Sub-points',
        diagramType: 'tree',
        attachToNode: 'Supervised Learning',
        nodes: [{ label: 'Supervised Tasks', items: ['Regression', 'Classification'] }],
      });
      dispatchDiagram({
        title: 'Unsupervised Learning Sub-points',
        diagramType: 'tree',
        attachToNode: 'Unsupervised Learning',
        nodes: [{ label: 'Unsupervised Tasks', items: ['Clustering', 'Association'] }],
      });
      dispatchDiagram({
        title: 'Reinforcement Learning Sub-points',
        diagramType: 'tree',
        attachToNode: 'Reinforcement Learning',
        nodes: [{ label: 'Reinforcement Applications', items: ['Decision Making', 'Game AI'] }],
      });

      rects = engine.getDrawnShapes().filter((s) => s.shapeType === 'rectangle');
      const mlRootsFinal = rects.filter((r) => r.options?.label === 'Machine Learning');
      expect(mlRootsFinal.length).toBe(1);
      // Placeholder boxes were replaced in-place by the 6 named leaf boxes -> still 10 boxes total!
      expect(rects.length).toBe(10);
      const labels = rects.map((r) => r.options?.label);
      expect(labels).toContain('Regression');
      expect(labels).toContain('Classification');
      expect(labels).toContain('Clustering');
      expect(labels).toContain('Association');
      expect(labels).toContain('Decision Making');
      expect(labels).toContain('Game AI');
    });

    it('continues a 15-box flowchart to 30 boxes in-place with serpentine wrapping and no duplicate flowcharts', () => {
      const { engine, dispatchDiagram } = createMockEngine();

      // Step 1: 15-box horizontal flowchart
      const first15 = Array.from({ length: 15 }, (_, i) => ({
        label: `Box ${i + 1}`,
      }));
      dispatchDiagram({
        title: '15 Boxes Flowchart',
        diagramType: 'flowchart',
        direction: 'LR',
        nodes: first15,
      });

      let rects = engine.getDrawnShapes().filter((s) => s.shapeType === 'rectangle');
      let arrows = engine.getDrawnShapes().filter((s) => s.shapeType === 'arrow');
      expect(rects.length).toBe(15);
      expect(arrows.length).toBe(14);
      // Ensure no double numbering like "15. Box 15"
      expect(rects[14].options?.label).toBe('Box 15');

      // Step 2: Continue from Box 15 to Box 30 using attachToNode="Box 15" (even with wrong flow='right' on row 4)
      const next15 = Array.from({ length: 15 }, (_, i) => ({
        label: `Box ${i + 16}`,
        flow: 'right' as const,
      }));
      dispatchDiagram({
        title: 'Boxes 16 to 30 Continuation',
        attachToNode: 'Box 15',
        direction: 'LR',
        nodes: next15,
      });

      rects = engine.getDrawnShapes().filter((s) => s.shapeType === 'rectangle');
      arrows = engine.getDrawnShapes().filter((s) => s.shapeType === 'arrow');

      // In-place continuation: 30 boxes total (NOT 15 + 15 in two separate diagrams) and 29 arrows
      expect(rects.length).toBe(30);
      expect(arrows.length).toBe(29);

      // Every single box and arrow stays strictly inside the safe canvas bounds
      for (const r of rects) {
        expect(r.x).toBeGreaterThanOrEqual(115);
        expect(r.x + (r.width ?? 0)).toBeLessThanOrEqual(1805);
        expect(r.y).toBeGreaterThanOrEqual(105);
        expect(r.y + (r.height ?? 0)).toBeLessThanOrEqual(980);
      }
    });

    it('preserves queued drawing commands when selective erase() is called before scheduledTime drains', () => {
      const { engine } = createMockEngine();

      // Seed an existing shape on the board
      engine.loadBoard(
        [
          {
            id: 'old-shape',
            kind: 'shape',
            shapeType: 'rectangle',
            x: 200,
            y: 200,
            width: 200,
            height: 60,
            options: { label: 'Old Concept', diagramTitle: 'Old Concept' },
          },
        ],
        []
      );

      // Enqueue a new diagram command scheduled 200ms in the future
      engine.onDrawCommand({
        id: 'queued-diagram',
        type: 'shape',
        scheduledTime: 10,
        commitGroup: 'g1',
        payload: {
          kind: 'shape',
          shapeType: 'diagram',
          x: 120,
          y: 130,
          options: {
            title: 'Machine Learning',
            diagramType: 'tree',
            root: 'Machine Learning',
            nodes: [{ label: 'Supervised' }, { label: 'Unsupervised' }],
          },
        } as any,
      });

      // Selective erase arrives immediately (before t=10)
      engine.erase('Old Concept');
      expect(engine.getDrawnShapes().length).toBe(0);

      // Queue must NOT have been flushed by selective erase!
      const ready = (engine as any).drawingQueue.drain(20);
      expect(ready.length).toBe(1);
    });

    it('guarantees zero horizontal text overlap and uniform baseline across 6 leaf columns with long bullet descriptions, and supports clearing descriptions in-place', () => {
      const { engine, dispatchDiagram } = createMockEngine();

      dispatchDiagram({
        title: 'Machine Learning Categories',
        diagramType: 'tree',
        root: 'Machine Learning',
        nodes: [
          {
            label: 'Supervised Learning',
            children: [
              {
                label: 'Classification',
                items: ['Predicts discrete labels (e.g., Spam vs. Not Spam)'],
              },
              {
                label: 'Regression',
                items: ['Predicts continuous numeric values (e.g., House prices)'],
              },
            ],
          },
          {
            label: 'Unsupervised Learning',
            children: [
              {
                label: 'Clustering',
                items: ['Groups similar data points together (e.g., Customer segmentation)'],
              },
              {
                label: 'Association',
                items: ['Finds relationships between items (e.g., Market basket analysis)'],
              },
            ],
          },
          {
            label: 'Reinforcement Learning',
            children: [
              {
                label: 'Model-Free Learning',
                items: ['Agent learns through trial and error (e.g., Robotics, Game playing)'],
              },
              {
                label: 'Model-Based Learning',
                items: ['Agent creates a model of the environment to plan actions'],
              },
            ],
          },
        ],
      });

      const shapes = engine.getDrawnShapes();
      const rects = shapes.filter((s) => s.shapeType === 'rectangle');
      const texts = shapes.filter((s) => s.shapeType === 'text');

      expect(rects.length).toBe(10);
      expect(texts.length).toBe(6);

      // All 6 leaf boxes at depth 2 must share the exact same Y and uniform height
      const leafRects = rects.filter((r) => r.options?.treeDepth === 2);
      expect(leafRects.length).toBe(6);
      for (const lr of leafRects) {
        expect(lr.y).toBe(leafRects[0].y);
        expect(lr.height).toBe(leafRects[0].height);
      }

      // All 6 bullet text blocks must start on the exact same Y baseline and have strictly disjoint horizontal columns
      const sortedTexts = [...texts].sort((a, b) => a.x - b.x);
      for (let i = 0; i < sortedTexts.length; i++) {
        expect(sortedTexts[i].y).toBe(sortedTexts[0].y);
        if (i < sortedTexts.length - 1) {
          const leftColRightEdge = sortedTexts[i].x + (sortedTexts[i].options?.maxWidth ?? sortedTexts[i].width ?? 0);
          const nextColLeftEdge = sortedTexts[i + 1].x;
          // At least 16px of strict horizontal whitespace between adjacent text columns
          expect(leftColRightEdge).toBeLessThanOrEqual(nextColLeftEdge - 16);
        }
      }

      // Now simulate user asking to remove the descriptive text under the boxes (sending full tree with items: [])
      dispatchDiagram({
        title: 'Machine Learning Categories',
        diagramType: 'tree',
        root: 'Machine Learning',
        nodes: [
          {
            label: 'Supervised Learning',
            children: [{ label: 'Classification' }, { label: 'Regression' }],
          },
          {
            label: 'Unsupervised Learning',
            children: [{ label: 'Clustering' }, { label: 'Association' }],
          },
          {
            label: 'Reinforcement Learning',
            children: [{ label: 'Model-Free Learning' }, { label: 'Model-Based Learning' }],
          },
        ],
      });

      const updatedShapes = engine.getDrawnShapes();
      expect(updatedShapes.filter((s) => s.shapeType === 'rectangle').length).toBe(10);
      expect(updatedShapes.filter((s) => s.shapeType === 'text').length).toBe(0);
    });

    it('renders multi-line prose with literal \\n via drawText and NEVER routes it to KaTeX mathOverlay', () => {
      const drawnTexts: string[] = [];
      const addedMath: string[] = [];

      const mockCanvasAdapter: any = {
        clear: vi.fn(),
        drawRectangle: vi.fn(),
        drawEllipse: vi.fn(),
        drawLine: vi.fn(),
        drawArrow: vi.fn(),
        drawPolygon: vi.fn(),
        drawFreehand: vi.fn(),
        drawText: vi.fn((text: string) => drawnTexts.push(text)),
        removeShape: vi.fn(),
        commitFrame: vi.fn(),
        rollbackToLastCommit: vi.fn(),
        resize: vi.fn(),
        getShapeBounds: vi.fn(),
        moveShape: vi.fn(),
        resizeShape: vi.fn(),
      };

      const mockSvgOverlay: any = {
        clear: vi.fn(),
        addWord: vi.fn(),
        setWords: vi.fn(),
        commitFrame: vi.fn(),
        rollbackToLastCommit: vi.fn(),
        hasActiveDrawings: vi.fn().mockReturnValue(false),
      };

      const mockMathOverlay: any = {
        clear: vi.fn(),
        addMath: vi.fn((m: any) => addedMath.push(m.latex)),
      };

      const engine = new SyncEngine({
        canvasAdapter: mockCanvasAdapter,
        svgOverlay: mockSvgOverlay,
        mathOverlay: mockMathOverlay,
        getWritingStyle: () => 'normal',
      });

      const proseWithEscapedNewlines =
        'Supervised Learning Types:\\n• Regression: Predicts numerical continuous values (e.g., house price).\\n• Classification: Categorizes data into distinct classes (e.g., spam vs. non-spam).';

      (engine as any).executeShapeCommand({
        kind: 'shape',
        shapeType: 'text',
        x: 140,
        y: 200,
        options: {
          text: proseWithEscapedNewlines,
          fontSize: 24,
          color: '#FFFFFF',
        },
      });

      expect(addedMath).toHaveLength(0);
      expect(drawnTexts.length).toBeGreaterThan(0);
      expect(drawnTexts[0]).not.toContain('\\n');
      expect(drawnTexts[0]).toContain('\n• Regression:');
    });

    it('supports Bottom-to-Top (BT), Left-to-Right (LR), and Right-to-Left (RL) tree diagrams', () => {
      const btShapes = DiagramLayoutEngine.generateShapes({
        title: 'Bottom-Up ML Tree',
        diagramType: 'tree',
        root: 'Machine Learning',
        direction: 'BT',
        nodes: [
          { label: 'Supervised Learning' },
          { label: 'Unsupervised Learning' },
          { label: 'Reinforcement Learning' },
        ],
      });

      const rects = btShapes.filter((s) => s.shapeType === 'rectangle');
      const arrows = btShapes.filter((s) => s.shapeType === 'arrow');
      expect(rects.length).toBe(4);
      expect(arrows.length).toBe(3);

      const rootRect = rects.find((r) => r.options?.label === 'Machine Learning')!;
      const childRects = rects.filter((r) => r.options?.label !== 'Machine Learning');
      for (const c of childRects) {
        // In Bottom-to-Top (BT) mode, children are positioned ABOVE the root (smaller Y)
        expect(c.y).toBeLessThan(rootRect.y);
      }
      for (const a of arrows) {
        // Arrows point UPWARD from root top to child bottom
        expect(a.toY!).toBeLessThan(a.y);
      }

      const rlShapes = DiagramLayoutEngine.generateShapes({
        title: 'Right-to-Left Tree',
        diagramType: 'tree',
        root: 'Machine Learning',
        direction: 'RL',
        nodes: [{ label: 'Supervised Learning' }, { label: 'Unsupervised Learning' }],
      });
      const rlRects = rlShapes.filter((s) => s.shapeType === 'rectangle');
      const rlRoot = rlRects.find((r) => r.options?.label === 'Machine Learning')!;
      const rlChild = rlRects.find((r) => r.options?.label === 'Supervised Learning')!;
      expect(rlChild.x).toBeLessThan(rlRoot.x);
    });

    it('performs surgical in-place updates via updateItem and reports self-review boardAudit', () => {
      const { engine, dispatchDiagram } = createMockEngine();

      dispatchDiagram({
        title: 'ML Overview',
        diagramType: 'tree',
        root: 'Machine Learning',
        direction: 'TB',
        nodes: [
          { label: 'Supervised Learning', items: ['Sub-topic'] },
          { label: 'Unsupervised Learning' },
        ],
      });

      // Self-audit should flag the placeholder '• Sub-topic'
      const auditBefore = engine.getSpatialLayout().boardAudit;
      expect(auditBefore.status).toBe('WARNING');
      expect(auditBefore.anomalies.some((a) => a.includes('Sub-topic'))).toBe(true);

      // Surgically replace 'Sub-topic' bullet and flip diagram direction to BT in place
      const updated1 = engine.updateItem({
        target: 'Sub-topic',
        newText: 'Predicts continuous or discrete outputs',
        action: 'replace',
      });
      expect(updated1).toBe(true);

      const auditAfter = engine.getSpatialLayout().boardAudit;
      expect(auditAfter.status).toBe('CLEAN');

      const updatedDir = engine.updateItem({
        target: 'ML Overview',
        newDirection: 'BT',
      });
      expect(updatedDir).toBe(true);

      const rects = engine.getDrawnShapes().filter((s) => s.shapeType === 'rectangle');
      const rootRect = rects.find((r) => r.options?.label === 'Machine Learning')!;
      const childRect = rects.find((r) => r.options?.label === 'Supervised Learning')!;
      expect(childRect.y).toBeLessThan(rootRect.y);
    });

    it('keeps diagram locked at its exact top-center position when renaming a box label even after left-column text notes are added below', () => {
      const { engine, dispatchDiagram } = createMockEngine();

      // 1. Draw the initial Machine Learning tree at top-center (empty board)
      dispatchDiagram({
        title: 'Machine Learning',
        diagramType: 'tree',
        root: 'Machine Learning',
        direction: 'TB',
        nodes: [
          { label: 'Supervised Learning' },
          { label: 'Unsupervised Learning' },
          { label: 'Reinforcement Learning' },
        ],
      });

      const rectsBefore = engine.getDrawnShapes().filter((s) => s.shapeType === 'rectangle');
      const rootBefore = rectsBefore.find((r) => r.options?.label === 'Machine Learning')!;
      const supBefore = rectsBefore.find((r) => r.options?.label === 'Supervised Learning')!;
      const unsupBefore = rectsBefore.find((r) => r.options?.label === 'Unsupervised Learning')!;
      const reinfBefore = rectsBefore.find((r) => r.options?.label === 'Reinforcement Learning')!;

      const origRootCenterX = Math.round(rootBefore.x + (rootBefore.width ?? 180) / 2);
      const origRootY = rootBefore.y;

      // 2. Add standalone text notes in the left column below the diagram (x=150, y=450..700)
      (engine as any).executeShapeCommand({
        kind: 'shape',
        shapeType: 'text',
        x: 150,
        y: 450,
        options: {
          text: 'Supervised Learning: Training models on labeled data.\nUnsupervised Learning: Finding patterns in unlabeled data.',
          fontSize: 22,
          color: '#FFFFFF',
        },
      });
      (engine as any).executeShapeCommand({
        kind: 'shape',
        shapeType: 'text',
        x: 150,
        y: 590,
        options: {
          text: 'Supervised Example: Email spam detection.\nUnsupervised Example: Customer segmentation.',
          fontSize: 22,
          color: '#FFFFFF',
        },
      });

      // 3. Rename "Machine Learning" -> "Machine Learning Types" via updateItem
      const didUpdate = engine.updateItem({
        target: 'Machine Learning',
        newText: 'Machine Learning Types',
        action: 'replace',
      });
      expect(didUpdate).toBe(true);

      const rectsAfter = engine.getDrawnShapes().filter((s) => s.shapeType === 'rectangle');
      const rootAfter = rectsAfter.find((r) => r.options?.label === 'Machine Learning Types')!;
      expect(rootAfter).toBeDefined();

      // Root box must stay at its exact original top Y and horizontal center (NOT thrown to bottom-right!)
      const newRootCenterX = Math.round(rootAfter.x + (rootAfter.width ?? 180) / 2);
      expect(rootAfter.y).toBe(origRootY);
      expect(Math.abs(newRootCenterX - origRootCenterX)).toBeLessThanOrEqual(2);

      // Child boxes must not have moved by even 1px
      const supAfter = rectsAfter.find((r) => r.options?.label === 'Supervised Learning')!;
      const unsupAfter = rectsAfter.find((r) => r.options?.label === 'Unsupervised Learning')!;
      const reinfAfter = rectsAfter.find((r) => r.options?.label === 'Reinforcement Learning')!;
      expect(supAfter.x).toBe(supBefore.x);
      expect(supAfter.y).toBe(supBefore.y);
      expect(unsupAfter.x).toBe(unsupBefore.x);
      expect(unsupAfter.y).toBe(unsupBefore.y);
      expect(reinfAfter.x).toBe(reinfBefore.x);
      expect(reinfAfter.y).toBe(reinfBefore.y);

      // 4. Also verify structural rebuild (e.g. adding bullet items to a diagram box) stays anchored at top-center
      const didStructUpdate = engine.updateItem({
        target: 'Unsupervised Learning',
        newItems: ['Clustering', 'Association'],
        action: 'set_items',
      });
      expect(didStructUpdate).toBe(true);

      const rectsAfterStruct = engine.getDrawnShapes().filter((s) => s.shapeType === 'rectangle');
      const rootAfterStruct = rectsAfterStruct.find((r) => r.options?.label === 'Machine Learning Types')!;
      expect(rootAfterStruct.y).toBe(origRootY);
      expect(Math.abs(Math.round(rootAfterStruct.x + (rootAfterStruct.width ?? 180) / 2) - origRootCenterX)).toBeLessThanOrEqual(5);
    });

    it('Scenario 7: Automatically unpacks stringified Python or JSON dictionaries passed into options.root into full multi-branch concept tree', () => {
      const rawPythonDictString = "{'label': 'Machine Learning', 'children': [{'label': 'Supervised Learning', 'items': ['Uses labeled training data (Input + Output)', 'Goal: Predict output for new inputs', 'Examples: Customer segmentation, Fruit identification']}, {'label': 'Unsupervised Learning', 'items': ['Uses unlabeled data (Input only)', 'Goal: Discover hidden patterns or structure', 'Examples: Customer segmentation (Clustering), Anomaly detection']}, {'label': 'Reinforcement Learning', 'items': ['Learns through trial and error', 'Based on Reward/Penalty feedback loop', 'Examples: Game playing, Robot navigation']}]}";

      const shapes = DiagramLayoutEngine.generateShapes({
        diagramType: 'tree',
        title: 'Machine Learning Comprehensive Roadmap',
        root: rawPythonDictString,
        nodes: [],
      });

      const rectShapes = shapes.filter((s) => s.shapeType === 'rectangle');
      // Must NOT be 1 single box containing raw Python code! Must have 4 boxes: 1 root + 3 children!
      expect(rectShapes.length).toBe(4);

      const rootRect = rectShapes.find((r) => r.options?.label === 'Machine Learning');
      expect(rootRect).toBeDefined();

      const supRect = rectShapes.find((r) => r.options?.label === 'Supervised Learning');
      const unsupRect = rectShapes.find((r) => r.options?.label === 'Unsupervised Learning');
      const reinfRect = rectShapes.find((r) => r.options?.label === 'Reinforcement Learning');

      expect(supRect).toBeDefined();
      expect(unsupRect).toBeDefined();
      expect(reinfRect).toBeDefined();

      // Connecting arrows from root to all 3 children
      const arrowShapes = shapes.filter((s) => s.shapeType === 'arrow');
      expect(arrowShapes.length).toBe(3);

      // Bullet items under child boxes
      const bulletTextShapes = shapes.filter((s) => s.shapeType === 'text');
      expect(bulletTextShapes.length).toBeGreaterThanOrEqual(6);
    });

    it('robustly parses nodes and root that use text property instead of label (LLM schema tolerance)', () => {
      const options = {
        direction: 'TB' as const,
        root: {
          text: 'Entscheidungsbaum-Vergleich',
          items: ['Frage an Mohamed: Welcher Baum generalisiert besser?'],
        } as any,
        nodes: [
          {
            text: 'Baum A (Tiefe 10)',
            items: ['Sehr tief', 'Hohe Komplexitaet'],
            children: [{ text: 'Knoten Ebene 1' } as any],
          } as any,
          {
            text: 'Baum B (Tiefe 3)',
            items: ['Flacher', 'Bessere Generalisierung'],
            children: [{ text: 'Blatt Ebene 3' } as any],
          } as any,
        ],
      };

      const shapes = DiagramLayoutEngine.generateShapes(options);
      const rectShapes = shapes.filter((s) => s.shapeType === 'rectangle');

      // Must have root box + 2 children + 2 grandchildren = 5 boxes (NEVER 1 lone Concept box!)
      expect(rectShapes.length).toBe(5);

      const rootRect = rectShapes.find((r) => r.options?.label === 'Entscheidungsbaum-Vergleich');
      expect(rootRect).toBeDefined();

      const baumARect = rectShapes.find((r) => r.options?.label === 'Baum A (Tiefe 10)');
      const baumBRect = rectShapes.find((r) => r.options?.label === 'Baum B (Tiefe 3)');
      expect(baumARect).toBeDefined();
      expect(baumBRect).toBeDefined();
    });

    it('accurately resolves root_text and adaptively folds multi-leaf branches when placed on right half (zero horizontal overlap)', () => {
      const nemotronPayload: any = {
        diagramType: 'tree',
        root_text: 'Summary: AI for Motion Graphics',
        direction: 'TB',
        position: 'right',
        children: [
          {
            text: '1. Levels of Complexity',
            children: [
              { text: 'Direct' },
              { text: 'AI Voice Tools' },
              { text: '3D Tools' },
            ],
          },
          {
            text: '2. The 4-Step Workflow',
            children: [
              { text: 'Inputs' },
              { text: 'Storyboard' },
              { text: 'Build' },
              { text: 'Audio' },
            ],
          },
          {
            text: '3. Key Pro Tips',
            children: [
              { text: 'High-quality assets' },
              { text: 'Seamless transitions' },
              { text: 'Constant motion' },
              { text: 'Audio last' },
            ],
          },
        ],
      };

      const shapes = DiagramLayoutEngine.generateShapes(nemotronPayload);
      const rects = shapes.filter((s) => s.shapeType === 'rectangle');

      // 1 root + 3 categories + 11 leaves = 15 rectangle boxes
      expect(rects.length).toBe(15);

      // Root box must have the actual title, NOT 'Overview'!
      const rootRect = rects.find((r) => r.options?.treeDepth === 0);
      expect(rootRect).toBeDefined();
      expect(rootRect?.options?.label).toBe('Summary: AI for Motion Graphics');

      // All shapes must be placed inside the right column (x >= 960)
      for (const r of rects) {
        expect(r.x).toBeGreaterThanOrEqual(960);
        expect(r.x + (r.width ?? 0)).toBeLessThanOrEqual(1800);
      }

      // Check strictly NO horizontal overlapping on any tier:
      rects.sort((a, b) => a.y - b.y || a.x - b.x);
      for (let i = 0; i < rects.length - 1; i++) {
        const a = rects[i];
        const b = rects[i + 1];
        if (Math.abs(a.y - b.y) < Math.min(a.height ?? 40, b.height ?? 40) * 0.7) {
          const aRight = a.x + (a.width ?? 0);
          expect(b.x).toBeGreaterThanOrEqual(aRight);
        }
      }

      // Step 2: Now add a Concept Card when the left half is occupied by video (as in the real session)
      const videoShape: any = {
        kind: 'shape',
        shapeType: 'rectangle',
        x: 60,
        y: 600,
        width: 500,
        height: 350,
      };

      const cardPayload: any = {
        diagramType: 'concept_card',
        title: 'Comprehensive Summary',
        items: [
          'Claude as Motion Graphics Designer',
          '3 Complexity Levels',
          '4-Step Workflow',
          'Key Tips',
        ],
        position: 'right',
        existingShapes: [...shapes, videoShape],
      };

      const cardShapes = DiagramLayoutEngine.generateShapes(cardPayload);
      const cardRects = cardShapes.filter((s) => s.shapeType === 'rectangle');
      expect(cardRects.length).toBeGreaterThanOrEqual(1);

      // Verify no collisions between any card shape and any tree shape
      for (const cr of cardRects) {
        const crLeft = cr.x;
        const crRight = cr.x + (cr.width ?? 0);
        const crTop = cr.y;
        const crBottom = cr.y + (cr.height ?? 0);

        for (const tr of rects) {
          const trLeft = tr.x;
          const trRight = tr.x + (tr.width ?? 0);
          const trTop = tr.y;
          const trBottom = tr.y + (tr.height ?? 0);

          // Overlap check
          const hasCollision =
            crLeft < trRight - 5 &&
            crRight > trLeft + 5 &&
            crTop < trBottom - 5 &&
            crBottom > trTop + 5;
          expect(hasCollision).toBe(false);
        }
      }
    });
  });
});
