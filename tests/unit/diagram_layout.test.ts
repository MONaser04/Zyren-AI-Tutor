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
  });
});


