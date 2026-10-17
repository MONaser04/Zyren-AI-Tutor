/**
 * RoughJsAdapter — Rough.js implementation of ICanvasAdapter.
 *
 * Wraps the Rough.js library to provide hand-drawn style structural
 * diagrams on an HTML5 Canvas, with commit/rollback semantics for
 * barge-in support.
 *
 * Rough.js is chosen over Excalidraw because:
 * 1. We only need programmatic drawing (no user interaction/editing)
 * 2. Lower coupling — Rough.js is a pure drawing lib, not a full editor
 * 3. Same visual aesthetic (Excalidraw is built on Rough.js)
 */
import rough from 'roughjs';
import type { RoughCanvas } from 'roughjs/bin/canvas';
import { v4 as uuidv4 } from 'uuid';
import type { ICanvasAdapter } from './ICanvasAdapter';
import type { Point, ShapeHandle, ShapeOptions, ArrowOptions, TextOptions } from '../../types';

interface StoredShape {
  handle: ShapeHandle;
  draw: () => void;
  zIndex: number;
}

export class RoughJsAdapter implements ICanvasAdapter {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private rc: RoughCanvas;

  /** All shapes that have been committed (survive rollback) */
  private committedShapes: StoredShape[] = [];

  /** Shapes drawn after the last commit (will be removed on rollback) */
  private pendingShapes: StoredShape[] = [];

  /** Auto-incrementing z-index counter for new shapes (starts at 1) */
  private nextZIndex = 1;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Failed to get 2D context from canvas');
    this.ctx = ctx;
    this.rc = rough.canvas(canvas);
  }

  drawRectangle(x: number, y: number, w: number, h: number, opts?: ShapeOptions): ShapeHandle {
    const handle: ShapeHandle = {
      id: uuidv4(),
      bounds: { x, y, width: w, height: h },
    };

    const isHandwritten = opts?.writingStyle === 'handwriting';
    const drawFn = () => {
      this.rc.rectangle(x, y, w, h, {
        roughness: opts?.roughness ?? (isHandwritten ? 2.0 : 1.5),
        bowing: isHandwritten ? 1.5 : 1.0,
        stroke: opts?.color ?? '#FFFFFF',
        strokeWidth: opts?.strokeWidth ?? (isHandwritten ? 2.2 : 2),
        fill: opts?.fill,
        fillStyle: 'hachure',
      });
    };

    this.pendingShapes.push({ handle, draw: drawFn, zIndex: opts?.zIndex ?? 0 });
    drawFn(); // Draw immediately
    return handle;
  }

  drawEllipse(cx: number, cy: number, w: number, h: number, opts?: ShapeOptions): ShapeHandle {
    const handle: ShapeHandle = {
      id: uuidv4(),
      bounds: { x: cx - w / 2, y: cy - h / 2, width: w, height: h },
    };

    const isHandwritten = opts?.writingStyle === 'handwriting';
    const drawFn = () => {
      this.rc.ellipse(cx, cy, w, h, {
        roughness: opts?.roughness ?? (isHandwritten ? 2.0 : 1.5),
        bowing: isHandwritten ? 1.5 : 1.0,
        stroke: opts?.color ?? '#FFFFFF',
        strokeWidth: opts?.strokeWidth ?? (isHandwritten ? 2.2 : 2),
        fill: opts?.fill,
        fillStyle: 'hachure',
      });
    };

    this.pendingShapes.push({ handle, draw: drawFn, zIndex: opts?.zIndex ?? this.nextZIndex++ });
    drawFn();
    return handle;
  }

  drawLine(x1: number, y1: number, x2: number, y2: number, opts?: ShapeOptions): ShapeHandle {
    const handle: ShapeHandle = {
      id: uuidv4(),
      bounds: {
        x: Math.min(x1, x2),
        y: Math.min(y1, y2),
        width: Math.abs(x2 - x1),
        height: Math.abs(y2 - y1),
      },
    };

    const isHandwritten = opts?.writingStyle === 'handwriting';
    const drawFn = () => {
      this.rc.line(x1, y1, x2, y2, {
        roughness: opts?.roughness ?? (isHandwritten ? 1.8 : 1),
        bowing: isHandwritten ? 1.4 : 0.85,
        stroke: opts?.color ?? '#FFFFFF',
        strokeWidth: opts?.strokeWidth ?? (isHandwritten ? 2.2 : 2),
      });
    };

    this.pendingShapes.push({ handle, draw: drawFn, zIndex: opts?.zIndex ?? this.nextZIndex++ });
    drawFn();
    return handle;
  }

  drawArrow(from: Point, to: Point, opts?: ArrowOptions): ShapeHandle {
    const handle: ShapeHandle = {
      id: uuidv4(),
      bounds: {
        x: Math.min(from.x, to.x),
        y: Math.min(from.y, to.y),
        width: Math.abs(to.x - from.x),
        height: Math.abs(to.y - from.y),
      },
    };

    const isHandwritten = opts?.writingStyle === 'handwriting';
    const roughness = opts?.roughness ?? (isHandwritten ? 1.8 : 1);
    const strokeWidth = opts?.strokeWidth ?? (isHandwritten ? 2.2 : 2);
    const bowing = isHandwritten ? 1.4 : 0.85;

    const drawFn = () => {
      // Draw the line
      this.rc.line(from.x, from.y, to.x, to.y, {
        roughness,
        bowing,
        stroke: opts?.color ?? '#FFFFFF',
        strokeWidth,
      });

      // Draw arrowhead
      const headSize = opts?.headSize ?? (isHandwritten ? 14 : 12);
      const angle = Math.atan2(to.y - from.y, to.x - from.x);
      const a1x = to.x - headSize * Math.cos(angle - Math.PI / 6);
      const a1y = to.y - headSize * Math.sin(angle - Math.PI / 6);
      const a2x = to.x - headSize * Math.cos(angle + Math.PI / 6);
      const a2y = to.y - headSize * Math.sin(angle + Math.PI / 6);

      this.rc.line(to.x, to.y, a1x, a1y, {
        roughness,
        bowing,
        stroke: opts?.color ?? '#FFFFFF',
        strokeWidth,
      });
      this.rc.line(to.x, to.y, a2x, a2y, {
        roughness,
        bowing,
        stroke: opts?.color ?? '#FFFFFF',
        strokeWidth,
      });
    };

    this.pendingShapes.push({ handle, draw: drawFn, zIndex: opts?.zIndex ?? this.nextZIndex++ });
    drawFn();
    return handle;
  }

  drawText(text: string, x: number, y: number, opts?: TextOptions): ShapeHandle {
    const isHandwritten = opts?.writingStyle === 'handwriting' || (opts?.fontFamily && opts.fontFamily.includes('Caveat'));
    const defaultFontFamily = isHandwritten
      ? "'Caveat', 'Segoe Print', 'Comic Sans MS', cursive, sans-serif"
      : "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
    const fontFamily = opts?.fontFamily ?? defaultFontFamily;
    const baseFontSize = opts?.fontSize ?? 22;
    // Caveat has a smaller optical x-height than sans-serif, scale slightly if not explicitly overridden
    const fontSize = isHandwritten && !opts?.fontFamily ? Math.round(baseFontSize * 1.15) : baseFontSize;
    const color = opts?.color ?? '#FFFFFF';
    const direction = opts?.direction ?? 'ltr';

    const isStepHeader = /^(Step\s*\d+|Problem|Solution|Theorem|Definition|Summary|Key Formula|Key Steps|Example|Given functions)/i.test(text.trim());
    const isMainTitle = (y < 140) || opts?.style === 'title' || fontSize >= 32;

    const handle: ShapeHandle = {
      id: uuidv4(),
      bounds: { x, y: y - fontSize, width: 0, height: fontSize },
    };

    const drawFn = () => {
      this.ctx.save();
      const fontWeight = isHandwritten ? (isStepHeader || isMainTitle ? '700' : '500') : (isStepHeader || isMainTitle ? '600' : '400');
      this.ctx.font = `${fontWeight} ${fontSize}px ${fontFamily}`;
      this.ctx.direction = direction;
      this.ctx.textBaseline = 'top';

      // Determine smart maximum wrapping width based on coordinate x and whiteboard limits
      // Canvas width is 1920, right safe margin is 60px (1860px max x).
      const availableWidth = Math.max(300, 1860 - x);
      const maxWidth = opts?.maxWidth ?? (isMainTitle ? availableWidth : Math.min(850, availableWidth));

      // Multi-line word wrapping algorithm
      const lines: string[] = [];
      const paragraphs = (text || '').split('\n');

      for (const paragraph of paragraphs) {
        if (!paragraph.trim()) {
          lines.push('');
          continue;
        }
        const words = paragraph.split(' ');
        let currentLine = '';
        for (const word of words) {
          const testLine = currentLine ? `${currentLine} ${word}` : word;
          const testWidth = this.ctx.measureText(testLine).width;
          if (testWidth > maxWidth && currentLine) {
            lines.push(currentLine);
            currentLine = word;
          } else {
            currentLine = testLine;
          }
        }
        if (currentLine) {
          lines.push(currentLine);
        }
      }

      const lineHeight = Math.round(fontSize * 1.45);
      let maxLineWidth = 0;
      for (const line of lines) {
        const w = this.ctx.measureText(line).width;
        if (w > maxLineWidth) maxLineWidth = w;
      }

      const totalHeight = Math.max(fontSize, lines.length * lineHeight);
      handle.bounds.width = maxLineWidth;
      handle.bounds.height = totalHeight;

      // ── Step Header Pill Badge (Khan Academy / Modern Blackboard Style) ──
      if (isStepHeader) {
        const badgeWidth = maxLineWidth + 24;
        const badgeHeight = totalHeight + 8;

        // Background rounded capsule badge
        this.ctx.fillStyle = 'rgba(78, 205, 196, 0.12)';
        this.ctx.strokeStyle = 'rgba(78, 205, 196, 0.35)';
        this.ctx.lineWidth = 1;
        this.ctx.beginPath();
        if (typeof this.ctx.roundRect === 'function') {
          this.ctx.roundRect(x - 8, y - 4, badgeWidth, badgeHeight, 6);
        } else {
          this.ctx.rect(x - 8, y - 4, badgeWidth, badgeHeight);
        }
        this.ctx.fill();
        this.ctx.stroke();

        // Left accent vertical pill bar
        this.ctx.fillStyle = '#4ECDC4';
        this.ctx.beginPath();
        if (typeof this.ctx.roundRect === 'function') {
          this.ctx.roundRect(x - 6, y - 2, 4, badgeHeight - 4, 2);
        } else {
          this.ctx.rect(x - 6, y - 2, 4, badgeHeight - 4);
        }
        this.ctx.fill();

        // Text color for step badge
        this.ctx.fillStyle = '#4ECDC4';
        lines.forEach((line, idx) => {
          this.ctx.fillText(line, x + 6, y + idx * lineHeight);
        });
      } else {
        this.ctx.fillStyle = color;
        lines.forEach((line, idx) => {
          this.ctx.fillText(line, x, y + idx * lineHeight);
        });
      }

      // ── Main Topic Title Glowing Accent Underline ──
      if (isMainTitle) {
        const lineWidth = Math.max(200, maxLineWidth + 20);
        this.rc.line(x, y + totalHeight + 4, x + lineWidth, y + totalHeight + 4, {
          stroke: '#4ECDC4',
          strokeWidth: 2.5,
          roughness: 0.3,
        });
      }

      this.ctx.restore();
    };

    this.pendingShapes.push({ handle, draw: drawFn, zIndex: opts?.zIndex ?? this.nextZIndex++ });
    drawFn();
    return handle;
  }

  removeShape(handle: ShapeHandle): void {
    this.committedShapes = this.committedShapes.filter((s) => s.handle.id !== handle.id);
    this.pendingShapes = this.pendingShapes.filter((s) => s.handle.id !== handle.id);
    this.redraw();
  }

  clear(): void {
    this.committedShapes = [];
    this.pendingShapes = [];
    this.ctx.save();
    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.ctx.restore();
  }

  commitFrame(): void {
    this.committedShapes.push(...this.pendingShapes);
    this.pendingShapes = [];
  }

  rollbackToLastCommit(): void {
    this.pendingShapes = [];
    this.redraw();
  }

  resize(width: number, height: number): void {
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = width * dpr;
    this.canvas.height = height * dpr;
    this.canvas.style.width = `${width}px`;
    this.canvas.style.height = `${height}px`;
    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.ctx.scale(dpr, dpr);
    this.redraw();
  }

  getCanvasElement(): HTMLCanvasElement {
    return this.canvas;
  }
  getShapeBounds(handle: ShapeHandle): { x: number; y: number; width: number; height: number } {
    return handle.bounds;
  }

  moveShape(handle: ShapeHandle, newX: number, newY: number): void {
    handle.bounds.x = newX;
    handle.bounds.y = newY;
    this.redraw();
  }

  resizeShape(handle: ShapeHandle, newWidth: number, newHeight: number): void {
    handle.bounds.width = newWidth;
    handle.bounds.height = newHeight;
    this.redraw();
  }

  bringToFront(handle: ShapeHandle): void {
    const shape =
      this.committedShapes.find((s) => s.handle.id === handle.id) ||
      this.pendingShapes.find((s) => s.handle.id === handle.id);
    if (shape) {
      shape.zIndex = ++this.nextZIndex;
      this.redraw();
    }
  }

  sendToBack(handle: ShapeHandle): void {
    const shape =
      this.committedShapes.find((s) => s.handle.id === handle.id) ||
      this.pendingShapes.find((s) => s.handle.id === handle.id);
    if (shape) {
      shape.zIndex = --this.nextZIndex;
      this.redraw();
    }
  }

  /**
   * Clears and re-draws all committed + pending shapes.
   * Called after rollback, resize, or shape removal.
   * Shapes are drawn in z-index order (lower z-index first) so higher
   * z-index shapes appear on top.
   */
  private redraw(): void {
    this.ctx.save();
    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.ctx.restore();

    // Sort committed shapes by z-index (stable sort, lower z-index drawn first)
    const sortedCommitted = [...this.committedShapes].sort(
      (a, b) => (a.zIndex ?? 0) - (b.zIndex ?? 0)
    );
    for (const shape of sortedCommitted) {
      shape.draw();
    }

    // Sort pending shapes by z-index (stable sort, lower z-index drawn first)
    const sortedPending = [...this.pendingShapes].sort(
      (a, b) => (a.zIndex ?? 0) - (b.zIndex ?? 0)
    );
    for (const shape of sortedPending) {
      shape.draw();
    }
  }
}
