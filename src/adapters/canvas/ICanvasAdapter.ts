/**
 * ICanvasAdapter — Abstract interface for the structural drawing layer.
 *
 * Isolates the application from the specific canvas library (Rough.js, Fabric.js, etc.)
 * using the Adapter Pattern. The system interacts only with this interface.
 *
 * Key Features:
 * - Commit/Rollback semantics for barge-in support
 * - Shape handles for individual element management
 * - RTL-aware text rendering
 */
import type { Point, ShapeHandle, ShapeOptions, ArrowOptions, TextOptions } from '../../types';

export interface ICanvasAdapter {
  /** Draw a rectangle with optional hand-drawn style */
  drawRectangle(x: number, y: number, w: number, h: number, opts?: ShapeOptions): ShapeHandle;

  /** Draw an ellipse */
  drawEllipse(cx: number, cy: number, w: number, h: number, opts?: ShapeOptions): ShapeHandle;

  /** Draw a line between two points */
  drawLine(x1: number, y1: number, x2: number, y2: number, opts?: ShapeOptions): ShapeHandle;

  /** Draw an arrow from one point to another */
  drawArrow(from: Point, to: Point, opts?: ArrowOptions): ShapeHandle;

  /** Draw text on the canvas (for labels inside shapes) */
  drawText(text: string, x: number, y: number, opts?: TextOptions): ShapeHandle;

  /** Remove a specific shape by its handle */
  removeShape(handle: ShapeHandle): void;

  /** Clear all shapes from the canvas */
  clear(): void;

  /**
   * Marks the current state as a commit point.
   * All shapes drawn before this call are considered "committed"
   * and will survive a rollback.
   */
  commitFrame(): void;

  /**
   * Rolls back to the last commit point.
   * Removes all shapes drawn after the last commitFrame() call.
   * Used during barge-in to remove partial drawings.
   */
  rollbackToLastCommit(): void;

  /** Resize the canvas to match container dimensions */
  resize(width: number, height: number): void;

  /** Get the bounds of a shape {x, y, width, height} */
  getShapeBounds(handle: ShapeHandle): { x: number; y: number; width: number; height: number };

  /** Move a shape to a new position */
  moveShape(handle: ShapeHandle, newX: number, newY: number): void;

  /** Resize a shape */
  resizeShape(handle: ShapeHandle, newWidth: number, newHeight: number): void;

  /** Move a shape to the front (highest z-index) */
  bringToFront(handle: ShapeHandle): void;

  /** Move a shape to the back (lowest z-index) */
  sendToBack(handle: ShapeHandle): void;
}
