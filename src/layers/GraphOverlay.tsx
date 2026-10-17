/**
 * GraphOverlay — High-Precision Mathematical Graph & Function Plotter.
 *
 * Renders 2D mathematical coordinate systems in SVG:
 * - Smooth function curves with respect to X (y = f(x)) or Y (x = g(y))
 * - Implicit 2D algebraic curves (F(x, y) = 0, circles, ellipses, hyperbolas) via Marching Squares
 * - Coordinate axes with arrows, ticks, number labels, and subtle grid lines
 * - Calculus shaded region between curves (both dx vertical strips and dy horizontal strips)
 * - Highlighted critical/intersection points with coordinate labels
 * - 3D solid-of-revolution disc/washer visual (around X-axis or Y-axis)
 * - Self-contained glassmorphism chalkboard card
 */
import React, { useState, useRef, forwardRef, useImperativeHandle, useCallback } from 'react';
import * as math from 'mathjs';

export interface GraphPoint {
  x: number;
  y: number;
  label?: string;
  color?: string;
}

export interface GraphFunction {
  expr: string;
  label?: string;
  color?: string;
}

export interface GraphShadedRegion {
  fromX?: number;
  toX?: number;
  fromY?: number;
  toY?: number;
  fTop?: string;    // y = fTop(x)
  fBottom?: string; // y = fBottom(x)
  gRight?: string;  // x = gRight(y)
  gLeft?: string;   // x = gLeft(y)
  distribution?: 'normal' | 'gaussian';
  distMean?: number;
  distStd?: number;
  inequality?: string;
  color?: string;
  label?: string;
}

export interface GraphItem {
  id: string;
  title?: string;
  functions: (GraphFunction | string)[];
  xRange?: [number, number];
  yRange?: [number, number];
  shadedRegion?: GraphShadedRegion;
  points?: GraphPoint[];
  showRevolutionDisc?: boolean;
  revolutionAxis?: 'x' | 'y';
  x: number;
  y: number;
  width?: number;
  height?: number;
}

export interface GraphOverlayHandle {
  addGraph(item: Omit<GraphItem, 'id'> & { id?: string }): string;
  removeGraph(id: string): void;
  clear(): void;
  getItemsCount(): number;
  setItems(items: GraphItem[]): void;
  getItems(): GraphItem[];
}

const DEFAULT_CURVE_COLORS = ['#4ECDC4', '#FF9F43', '#FF6B6B', '#A8FF78', '#F368E0', '#54A0FF'];

export interface GraphOverlayProps {
  onUpdatePosition?: (id: string, x: number, y: number) => void;
  onRemoveGraph?: (id: string) => void;
}

export const GraphOverlay = forwardRef<GraphOverlayHandle, GraphOverlayProps>(function GraphOverlay(
  { onUpdatePosition, onRemoveGraph },
  ref
) {
  const [graphs, setGraphs] = useState<GraphItem[]>([]);

  const addGraph = useCallback((item: Omit<GraphItem, 'id'> & { id?: string }): string => {
    const id = item.id || `graph-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const newGraph: GraphItem = {
      id,
      title: item.title || 'Mathematical Function Plot',
      functions: item.functions || [],
      xRange: item.xRange || [-3, 3],
      yRange: item.yRange || [-1, 5],
      shadedRegion: item.shadedRegion,
      points: item.points || [],
      showRevolutionDisc: !!item.showRevolutionDisc,
      revolutionAxis: item.revolutionAxis || 'x',
      x: item.x,
      y: item.y,
      width: item.width || 480,
      height: item.height || 380,
    };

    setGraphs((prev) => [...prev, newGraph]);
    return id;
  }, []);

  const removeGraph = useCallback(
    (id: string) => {
      setGraphs((prev) => prev.filter((g) => g.id !== id));
      if (onRemoveGraph) onRemoveGraph(id);
    },
    [onRemoveGraph]
  );

  const clear = useCallback(() => {
    setGraphs([]);
  }, []);

  const getItemsCount = useCallback(() => graphs.length, [graphs.length]);
  const setItems = useCallback((items: GraphItem[]) => setGraphs(items), []);
  const getItems = useCallback(() => graphs, [graphs]);

  const handleCardMove = useCallback(
    (id: string, newX: number, newY: number) => {
      setGraphs((prev) =>
        prev.map((g) => (g.id === id ? { ...g, x: newX, y: newY } : g))
      );
      if (onUpdatePosition) onUpdatePosition(id, newX, newY);
    },
    [onUpdatePosition]
  );

  useImperativeHandle(
    ref,
    () => ({
      addGraph,
      removeGraph,
      clear,
      getItemsCount,
      setItems,
      getItems,
    }),
    [addGraph, removeGraph, clear, getItemsCount, setItems, getItems]
  );

  return (
    <div
      className="graph-overlay"
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        width: '100%',
        height: '100%',
        pointerEvents: 'none',
        zIndex: 11,
      }}
    >
      {graphs.map((graph) => (
        <GraphCard
          key={graph.id}
          graph={graph}
          onMove={(newX, newY) => handleCardMove(graph.id, newX, newY)}
          onClose={() => removeGraph(graph.id)}
        />
      ))}
    </div>
  );
});

/**
 * Parsed 2D Mathematical Curve Information
 */
export type CurveType = 'y_of_x' | 'x_of_y' | 'implicit';

export interface Parsed2DCurve {
  type: CurveType;
  cleanExpr: string;
  originalExpr: string;
  label: string;
  color: string;
  evalFn: (x: number, y: number) => number;
}

/**
 * Classifies and compiles a 2D equation into an executable evaluator:
 * - 'y_of_x': y = f(x)
 * - 'x_of_y': x = g(y)
 * - 'implicit': F(x, y) = 0
 */
export function parse2DCurve(rawExpr: string, defaultColor: string, index: number): Parsed2DCurve {
  let clean = rawExpr.trim();
  let type: CurveType = 'y_of_x';
  let exprBody = clean;
  let label = clean;

  // 1. Explicit LHS identification (supporting v(t), s(t), f(x), g(y), etc.)
  if (
    /^(?:[a-zA-Z_]\w*\s*\(\s*[xXtTuU]\s*\)|y\s*\(?\s*[xXtTuU]?\s*\)?)\s*=\s*/i.test(clean) ||
    /^y\s*=\s*/i.test(clean)
  ) {
    type = 'y_of_x';
    exprBody = clean.replace(/^(?:[a-zA-Z_]\w*\s*\(\s*[xXtTuU]\s*\)|y\s*\(?\s*[xXtTuU]?\s*\)?)\s*=\s*/i, '');
    label = `y = ${exprBody}`;
  } else if (
    /^(?:[a-zA-Z_]\w*\s*\(\s*[yY]\s*\)|x\s*\(?\s*[yY]?\s*\)?)\s*=\s*/i.test(clean) ||
    /^x\s*=\s*/i.test(clean) ||
    /^g\s*\(\s*y\s*\)\s*=\s*/i.test(clean)
  ) {
    type = 'x_of_y';
    exprBody = clean.replace(/^(?:[a-zA-Z_]\w*\s*\(\s*[yY]\s*\)|x\s*\(?\s*[yY]?\s*\)?)\s*=\s*/i, '').replace(/^g\s*\(\s*y\s*\)\s*=\s*/i, '');
    label = `x = ${exprBody}`;
  } else if (clean.includes('=')) {
    // Equation with '=' like x^2 + y^2 = 4
    const parts = clean.split('=');
    const lhs = parts[0].trim();
    const rhs = parts.slice(1).join('=').trim();
    type = 'implicit';
    exprBody = `(${lhs}) - (${rhs})`;
    label = clean;
  } else {
    // No explicit '='; check variable presence (excluding letters in function names)
    const strippedFunctions = clean
      .replace(/\b(sin|cos|tan|asin|acos|atan|sinh|cosh|tanh|sqrt|cbrt|abs|exp|ln|log|pi|pow|max|min)\b/gi, '');
    const hasX = /(?<![a-zA-Z_])[xtu](?![a-zA-Z_])/i.test(strippedFunctions);
    const hasY = /(?<![a-zA-Z_])y(?![a-zA-Z_])/i.test(strippedFunctions);

    if (hasY && !hasX) {
      type = 'x_of_y';
      label = `x = ${clean}`;
    } else if (hasX && hasY) {
      type = 'implicit';
      label = `${clean} = 0`;
    } else {
      type = 'y_of_x';
      label = `y = ${clean}`;
    }
  }

  const evalFn = compile2DMathFunction(exprBody);

  return {
    type,
    cleanExpr: exprBody,
    originalExpr: rawExpr,
    label: label || `f${index + 1}(x) = ${rawExpr}`,
    color: defaultColor,
    evalFn,
  };
}

/**
 * Compiles a raw 2D mathematical expression string into a high-speed JavaScript evaluator f(x, y).
 */
export function compile2DMathFunction(rawExpr: string): (x: number, y: number) => number {
  if (!rawExpr || typeof rawExpr !== 'string') {
    return () => 0;
  }

  let s = rawExpr.trim();

  // 1. Strip LHS assignment if present: y =, x =, f(x) =, v(t) =, s(t) =, g(y) =, f1(x) =, y1 =, z =
  s = s.replace(/^(?:[a-zA-Z_]\w*\s*\(\s*[a-zA-Z_]\w*\s*\)|[xyzXYZtuTU]|[a-zA-Z_]\w*)\s*=\s*/, '');
  s = s.trim();

  // 2. Strip LaTeX expressions if present: \frac{a}{b} -> ((a)/(b)), \sin, \cos, \cdot, etc.
  s = s.replace(/\\frac\{([^}]+)\}\{([^}]+)\}/g, '(($1)/($2))');
  s = s.replace(/\\cdot|\\times/g, '*');
  s = s.replace(/\\left\(|\\right\)/g, (m) => (m === '\\left(' ? '(' : ')'));
  s = s.replace(/\\(?:sin|cos|tan|asin|acos|atan|sinh|cosh|tanh|sqrt|cbrt|abs|exp|ln|log)/g, (m) => m.slice(1));
  s = s.replace(/\\/g, '');

  // 3. Normalize unicode symbols and superscripts
  s = s.replace(/−/g, '-').replace(/×/g, '*').replace(/÷/g, '/');
  s = s.replace(/²/g, '^2').replace(/³/g, '^3');

  // 4. Try math.compile first (robust mathjs AST compiler)
  try {
    const mathJsExpr = s.replace(/(\d)\s*([a-zA-Z(])/g, '$1*$2');
    const compiled = math.compile(mathJsExpr);
    return (x: number, y: number) => {
      try {
        const val = compiled.evaluate({ x, y, t: x, u: x, r: x, theta: x, v: y });
        return typeof val === 'number' && !isNaN(val) && isFinite(val) ? val : NaN;
      } catch {
        return NaN;
      }
    };
  } catch {
    // Fallback to JS new Function evaluator
  }

  // 5. JavaScript new Function fallback
  try {
    let jsExpr = s
      .replace(/\bsin\b/gi, 'Math.sin')
      .replace(/\bcos\b/gi, 'Math.cos')
      .replace(/\btan\b/gi, 'Math.tan')
      .replace(/\basin\b/gi, 'Math.asin')
      .replace(/\bacos\b/gi, 'Math.acos')
      .replace(/\batan\b/gi, 'Math.atan')
      .replace(/\bsqrt\b/gi, 'Math.sqrt')
      .replace(/\bcbrt\b/gi, 'Math.cbrt')
      .replace(/\babs\b/gi, 'Math.abs')
      .replace(/\bexp\b/gi, 'Math.exp')
      .replace(/\bln\b/gi, 'Math.log')
      .replace(/\blog\b/gi, 'Math.log10')
      .replace(/\bpi\b/gi, 'Math.PI')
      .replace(/\be\b/gi, 'Math.E');

    jsExpr = jsExpr.replace(/(\d)\s*([a-zA-Z(])/g, '$1*$2');
    jsExpr = jsExpr.replace(/(\))\s*([a-zA-Z0-9(])/g, '$1*$2');
    jsExpr = jsExpr.replace(/(^|[(+\-*/=,])\s*-\s*/g, '$1(0-1)*');
    jsExpr = jsExpr.replace(/\^/g, '**');

    // eslint-disable-next-line no-new-func
    const fn = new Function('x', 'y', `
      const t = x;
      const u = x;
      const r = x;
      const theta = x;
      try {
        const val = ${jsExpr};
        return (typeof val === 'number' && !isNaN(val) && isFinite(val)) ? val : NaN;
      } catch(e) {
        return NaN;
      }
    `);
    return fn as (x: number, y: number) => number;
  } catch (err) {
    console.warn('[GraphOverlay] Failed to compile 2D math:', rawExpr, err);
    return () => NaN;
  }
}

/**
 * Renders a single self-contained mathematical coordinate graph.
 */
function GraphCard({
  graph,
  onMove,
  onClose,
}: {
  graph: GraphItem;
  onMove?: (newX: number, newY: number) => void;
  onClose?: () => void;
}) {
  const cardRef = useRef<HTMLDivElement>(null);
  const width = graph.width || 480;
  const height = graph.height || 380;
  const padding = { top: 38, right: 35, bottom: 38, left: 45 };

  const defaultXRange: [number, number] = graph.xRange || [-3, 3];
  const defaultYRange: [number, number] = graph.yRange || [-1, 5];

  const [xRange, setXRange] = useState<[number, number]>(defaultXRange);
  const [yRange, setYRange] = useState<[number, number]>(defaultYRange);
  const [isPanning, setIsPanning] = useState<boolean>(false);

  const [xMin, xMax] = xRange;
  const [yMin, yMax] = yRange;

  const xRangeRef = useRef(xRange);
  xRangeRef.current = xRange;
  const yRangeRef = useRef(yRange);
  yRangeRef.current = yRange;

  // ── 1. Card Window Dragging on Whiteboard ──
  const isDraggingCardRef = useRef(false);
  const cardDragStartRef = useRef({ mouseX: 0, mouseY: 0, startX: 0, startY: 0 });

  const handleHeaderPointerDown = (e: React.PointerEvent) => {
    e.stopPropagation();
    if ((e.target as HTMLElement).closest('button')) return;
    isDraggingCardRef.current = true;
    cardDragStartRef.current = {
      mouseX: e.clientX,
      mouseY: e.clientY,
      startX: graph.x,
      startY: graph.y,
    };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };

  const handleHeaderPointerMove = (e: React.PointerEvent) => {
    if (!isDraggingCardRef.current) return;
    const dx = e.clientX - cardDragStartRef.current.mouseX;
    const dy = e.clientY - cardDragStartRef.current.mouseY;
    if (onMove) {
      onMove(
        Math.round(cardDragStartRef.current.startX + dx),
        Math.round(cardDragStartRef.current.startY + dy)
      );
    }
  };

  const handleHeaderPointerUp = (e: React.PointerEvent) => {
    isDraggingCardRef.current = false;
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {}
  };

  // ── 2. Coordinate Panning inside Graph ──
  const isPanningPlotRef = useRef(false);
  const panStartRef = useRef({
    mouseX: 0,
    mouseY: 0,
    xMin: defaultXRange[0],
    xMax: defaultXRange[1],
    yMin: defaultYRange[0],
    yMax: defaultYRange[1],
  });

  const plotW = width - padding.left - padding.right;
  const plotH = height - padding.top - padding.bottom;

  const handlePlotPointerDown = (e: React.PointerEvent) => {
    e.stopPropagation();
    if ((e.target as HTMLElement).closest('button')) return;
    isPanningPlotRef.current = true;
    setIsPanning(true);
    panStartRef.current = {
      mouseX: e.clientX,
      mouseY: e.clientY,
      xMin: xRangeRef.current[0],
      xMax: xRangeRef.current[1],
      yMin: yRangeRef.current[0],
      yMax: yRangeRef.current[1],
    };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };

  const handlePlotPointerMove = (e: React.PointerEvent) => {
    if (!isPanningPlotRef.current) return;
    const dx = e.clientX - panStartRef.current.mouseX;
    const dy = e.clientY - panStartRef.current.mouseY;

    const spanX = panStartRef.current.xMax - panStartRef.current.xMin;
    const spanY = panStartRef.current.yMax - panStartRef.current.yMin;

    const dxMath = (dx / plotW) * spanX;
    const dyMath = (dy / plotH) * spanY;

    setXRange([panStartRef.current.xMin - dxMath, panStartRef.current.xMax - dxMath]);
    setYRange([panStartRef.current.yMin + dyMath, panStartRef.current.yMax + dyMath]);
  };

  const handlePlotPointerUp = (e: React.PointerEvent) => {
    isPanningPlotRef.current = false;
    setIsPanning(false);
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {}
  };

  // ── 3. Zooming Handlers ──
  const handleZoomIn2D = () => {
    setXRange(([min, max]) => {
      const mid = (min + max) / 2;
      const span = (max - min) * 0.75;
      return [mid - span / 2, mid + span / 2];
    });
    setYRange(([min, max]) => {
      const mid = (min + max) / 2;
      const span = (max - min) * 0.75;
      return [mid - span / 2, mid + span / 2];
    });
  };

  const handleZoomOut2D = () => {
    setXRange(([min, max]) => {
      const mid = (min + max) / 2;
      const span = (max - min) * 1.33;
      return [mid - span / 2, mid + span / 2];
    });
    setYRange(([min, max]) => {
      const mid = (min + max) / 2;
      const span = (max - min) * 1.33;
      return [mid - span / 2, mid + span / 2];
    });
  };

  const handleReset2D = () => {
    setXRange(defaultXRange);
    setYRange(defaultYRange);
  };

  const handleWheel2D = (e: React.WheelEvent) => {
    e.stopPropagation();
    e.preventDefault();
    const rect = cardRef.current?.getBoundingClientRect();
    const factor = e.deltaY < 0 ? 0.85 : 1.18;

    if (rect) {
      const mousePxX = e.clientX - rect.left;
      const mousePxY = e.clientY - rect.top;

      const [curXMin, curXMax] = xRangeRef.current;
      const [curYMin, curYMax] = yRangeRef.current;

      const mathX = curXMin + ((mousePxX - padding.left) / plotW) * (curXMax - curXMin);
      const mathY = curYMin + ((padding.top + plotH - mousePxY) / plotH) * (curYMax - curYMin);

      setXRange([mathX - (mathX - curXMin) * factor, mathX + (curXMax - mathX) * factor]);
      setYRange([mathY - (mathY - curYMin) * factor, mathY + (curYMax - mathY) * factor]);
    } else {
      if (e.deltaY < 0) handleZoomIn2D();
      else handleZoomOut2D();
    }
  };

  // Coordinate mapping functions
  const toSvgX = (xVal: number) => padding.left + ((xVal - xMin) / (xMax - xMin)) * plotW;
  const toSvgY = (yVal: number) => padding.top + plotH - ((yVal - yMin) / (yMax - yMin)) * plotH;

  const originX = toSvgX(0);
  const originY = toSvgY(0);

  // Generate grid ticks
  const xTicks = generateTicks(xMin, xMax, 6);
  const yTicks = generateTicks(yMin, yMax, 6);

  // Parse functions
  const parsedCurves: Parsed2DCurve[] = (graph.functions || []).map((f, i) => {
    const rawExpr = typeof f === 'string' ? f : f.expr;
    const defaultColor =
      typeof f !== 'string' && f.color
        ? f.color
        : DEFAULT_CURVE_COLORS[i % DEFAULT_CURVE_COLORS.length];
    const curve = parse2DCurve(rawExpr, defaultColor, i);
    if (typeof f !== 'string' && f.label) {
      curve.label = f.label;
    }
    return curve;
  });

  return (
    <div
      ref={cardRef}
      className="graph-card interactive no-zoom"
      style={{
        position: 'absolute',
        left: `${graph.x}px`,
        top: `${graph.y}px`,
        width: `${width}px`,
        height: `${height}px`,
        backgroundColor: 'rgba(18, 18, 36, 0.94)',
        backdropFilter: 'blur(16px)',
        border: '1.5px solid rgba(78, 205, 196, 0.35)',
        borderRadius: 12,
        boxShadow: '0 8px 32px rgba(0, 0, 0, 0.55)',
        overflow: 'hidden',
        fontFamily: "'Inter', sans-serif",
        userSelect: 'none',
        pointerEvents: 'auto',
        display: 'flex',
        flexDirection: 'column',
      }}
      onWheel={handleWheel2D}
    >
      {/* ── Top Drag Handle & Title Bar ── */}
      <div
        onPointerDown={handleHeaderPointerDown}
        onPointerMove={handleHeaderPointerMove}
        onPointerUp={handleHeaderPointerUp}
        onPointerCancel={handleHeaderPointerUp}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '6px 10px',
          backgroundColor: 'rgba(255, 255, 255, 0.05)',
          borderBottom: '1px solid rgba(255, 255, 255, 0.1)',
          cursor: 'grab',
          touchAction: 'none',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, overflow: 'hidden' }}>
          <span style={{ color: '#4ECDC4', fontSize: 13, cursor: 'grab' }} title="Drag to move graph">
            ⠿
          </span>
          <span
            style={{
              color: '#FFFFFF',
              fontSize: 12,
              fontWeight: 700,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              maxWidth: 220,
            }}
          >
            {graph.title || '2D Function Plot'}
          </span>
        </div>

        {/* Action Controls in Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {/* Zoom Buttons */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              background: 'rgba(255, 255, 255, 0.08)',
              borderRadius: 4,
              padding: '1px 2px',
              gap: 2,
            }}
          >
            <button
              onClick={handleZoomIn2D}
              title="Zoom In (Scroll wheel up)"
              style={{
                background: 'transparent',
                border: 'none',
                color: '#4ecdc4',
                fontSize: 12,
                fontWeight: 700,
                padding: '2px 5px',
                cursor: 'pointer',
                lineHeight: 1,
              }}
            >
              +
            </button>
            <span style={{ color: 'rgba(255, 255, 255, 0.2)', fontSize: 10 }}>|</span>
            <button
              onClick={handleZoomOut2D}
              title="Zoom Out (Scroll wheel down)"
              style={{
                background: 'transparent',
                border: 'none',
                color: '#4ecdc4',
                fontSize: 12,
                fontWeight: 700,
                padding: '2px 5px',
                cursor: 'pointer',
                lineHeight: 1,
              }}
            >
              −
            </button>
          </div>

          <button
            onClick={handleReset2D}
            title="Reset Pan & Zoom"
            style={{
              background: 'rgba(255, 255, 255, 0.08)',
              border: 'none',
              borderRadius: 4,
              color: '#aaa',
              fontSize: 10,
              padding: '2px 5px',
              cursor: 'pointer',
            }}
          >
            ↺
          </button>

          {onClose && (
            <button
              onClick={onClose}
              title="Close Graph"
              style={{
                background: 'transparent',
                border: 'none',
                color: '#666',
                fontSize: 12,
                cursor: 'pointer',
                padding: '2px 5px',
                borderRadius: 4,
                lineHeight: 1,
              }}
              onMouseEnter={(e) => (e.currentTarget.style.color = '#ff6b6b')}
              onMouseLeave={(e) => (e.currentTarget.style.color = '#666')}
            >
              ✕
            </button>
          )}
        </div>
      </div>

      {/* ── Interactive Coordinate SVG (Pan Drag Area) ── */}
      <div
        onPointerDown={handlePlotPointerDown}
        onPointerMove={handlePlotPointerMove}
        onPointerUp={handlePlotPointerUp}
        onPointerCancel={handlePlotPointerUp}
        style={{
          flex: 1,
          cursor: isPanning ? 'grabbing' : 'grab',
          touchAction: 'none',
          position: 'relative',
        }}
        title="Drag inside to pan coordinate system • Scroll to zoom"
      >
        <svg width={width} height={height - 36} style={{ display: 'block' }}>
          <defs>
            {/* Axis Arrow Marker */}
            <marker id="axis-arrow" viewBox="0 0 10 10" refX="6" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
              <path d="M 0 1.5 L 8 5 L 0 8.5 z" fill="#8892b0" />
            </marker>
            {/* Shaded Area Pattern / Gradient */}
            <linearGradient id="shaded-area-grad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#4ECDC4" stopOpacity="0.45" />
              <stop offset="100%" stopColor="#4ECDC4" stopOpacity="0.15" />
            </linearGradient>
        </defs>

        {/* Graph Title */}
        <text x={padding.left} y={24} fill="#FFFFFF" fontSize="13" fontWeight="700" fontFamily="'Inter', sans-serif">
          {graph.title}
        </text>

        {/* Background Grid Lines */}
        {xTicks.map((tick) => {
          const sx = toSvgX(tick);
          return (
            <line
              key={`grid-x-${tick}`}
              x1={sx}
              y1={padding.top}
              x2={sx}
              y2={padding.top + plotH}
              stroke="rgba(255, 255, 255, 0.06)"
              strokeWidth="1"
              strokeDasharray="3 3"
            />
          );
        })}

        {yTicks.map((tick) => {
          const sy = toSvgY(tick);
          return (
            <line
              key={`grid-y-${tick}`}
              x1={padding.left}
              y1={sy}
              x2={padding.left + plotW}
              y2={sy}
              stroke="rgba(255, 255, 255, 0.06)"
              strokeWidth="1"
              strokeDasharray="3 3"
            />
          );
        })}

        {/* Calculus Shaded Region Between Curves (Both dx and dy) */}
        {graph.shadedRegion && (
          <ShadedRegionPath
            region={graph.shadedRegion}
            xMin={xMin}
            xMax={xMax}
            yMin={yMin}
            yMax={yMax}
            toSvgX={toSvgX}
            toSvgY={toSvgY}
          />
        )}

        {/* 3D Solid of Revolution Slices (Discs/Washers around X or Y axis) */}
        {graph.showRevolutionDisc && (
          <g opacity="0.65">
            {graph.revolutionAxis === 'y' ? (
              <>
                {/* Horizontal disks revolving around Y-axis */}
                <ellipse
                  cx={originX}
                  cy={toSvgY((yMin + yMax) * 0.35)}
                  rx={Math.max(12, Math.abs(toSvgX(1.8) - originX))}
                  ry={8}
                  fill="rgba(78, 205, 196, 0.08)"
                  stroke="#4ECDC4"
                  strokeWidth="1.2"
                  strokeDasharray="3 3"
                />
                <ellipse
                  cx={originX}
                  cy={toSvgY((yMin + yMax) * 0.65)}
                  rx={Math.max(16, Math.abs(toSvgX(2.4) - originX))}
                  ry={10}
                  fill="rgba(255, 159, 67, 0.12)"
                  stroke="#FF9F43"
                  strokeWidth="1.2"
                />
              </>
            ) : (
              <>
                {/* Vertical disks revolving around X-axis */}
                <ellipse
                  cx={toSvgX((xMin + xMax) * 0.35)}
                  cy={originY}
                  rx={12}
                  ry={Math.max(12, Math.abs(originY - toSvgY(1.8)))}
                  fill="rgba(78, 205, 196, 0.08)"
                  stroke="#4ECDC4"
                  strokeWidth="1.2"
                  strokeDasharray="3 3"
                />
                <ellipse
                  cx={toSvgX((xMin + xMax) * 0.65)}
                  cy={originY}
                  rx={14}
                  ry={Math.max(14, Math.abs(originY - toSvgY(2.2)))}
                  fill="rgba(255, 159, 67, 0.12)"
                  stroke="#FF9F43"
                  strokeWidth="1.2"
                />
              </>
            )}
          </g>
        )}

        {/* X and Y Axes */}
        {/* Y Axis */}
        <line
          x1={Math.max(padding.left, Math.min(padding.left + plotW, originX))}
          y1={padding.top + plotH + 10}
          x2={Math.max(padding.left, Math.min(padding.left + plotW, originX))}
          y2={padding.top - 10}
          stroke="#8892b0"
          strokeWidth="1.5"
          markerEnd="url(#axis-arrow)"
        />
        {/* X Axis */}
        <line
          x1={padding.left - 10}
          y1={Math.max(padding.top, Math.min(padding.top + plotH, originY))}
          x2={padding.left + plotW + 15}
          y2={Math.max(padding.top, Math.min(padding.top + plotH, originY))}
          stroke="#8892b0"
          strokeWidth="1.5"
          markerEnd="url(#axis-arrow)"
        />

        {/* Axis Labels (x, y) */}
        <text
          x={padding.left + plotW + 22}
          y={Math.max(padding.top + 12, Math.min(padding.top + plotH + 4, originY + 4))}
          fill="#4ECDC4"
          fontSize="13"
          fontWeight="700"
          fontStyle="italic"
        >
          x
        </text>
        <text
          x={Math.max(padding.left - 14, Math.min(padding.left + plotW - 14, originX - 14))}
          y={padding.top - 12}
          fill="#4ECDC4"
          fontSize="13"
          fontWeight="700"
          fontStyle="italic"
        >
          y
        </text>

        {/* X Axis Tick Labels */}
        {xTicks.map((tick) => {
          if (tick === 0 && originY >= padding.top && originY <= padding.top + plotH) return null;
          const sx = toSvgX(tick);
          const sy = Math.max(padding.top, Math.min(padding.top + plotH, originY));
          return (
            <g key={`xtick-${tick}`}>
              <line x1={sx} y1={sy - 3} x2={sx} y2={sy + 3} stroke="#8892b0" strokeWidth="1" />
              <text x={sx} y={sy + 14} fill="#8892b0" fontSize="10" textAnchor="middle" fontFamily="monospace">
                {tick}
              </text>
            </g>
          );
        })}

        {/* Y Axis Tick Labels */}
        {yTicks.map((tick) => {
          if (tick === 0) return null;
          const sx = Math.max(padding.left, Math.min(padding.left + plotW, originX));
          const sy = toSvgY(tick);
          return (
            <g key={`ytick-${tick}`}>
              <line x1={sx - 3} y1={sy} x2={sx + 3} y2={sy} stroke="#8892b0" strokeWidth="1" />
              <text x={sx - 8} y={sy + 3} fill="#8892b0" fontSize="10" textAnchor="end" fontFamily="monospace">
                {tick}
              </text>
            </g>
          );
        })}

        {/* Plotted Function Curves (X-axis, Y-axis, and Implicit) */}
        {parsedCurves.map((curve, idx) => {
          const pathD = buildCurvePath2D(
            curve,
            xMin,
            xMax,
            yMin,
            yMax,
            toSvgX,
            toSvgY,
            padding.left,
            padding.top,
            plotW,
            plotH
          );
          if (!pathD) return null;

          return (
            <g key={`curve-${idx}`}>
              <path
                d={pathD}
                fill="none"
                stroke={curve.color}
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                filter="drop-shadow(0 0 4px rgba(78, 205, 196, 0.4))"
              />
            </g>
          );
        })}

        {/* Critical / Intersection Points */}
        {(graph.points || []).map((pt, pIdx) => {
          const px = toSvgX(pt.x);
          const py = toSvgY(pt.y);
          const ptColor = pt.color || '#FF6B6B';

          return (
            <g key={`pt-${pIdx}`}>
              <circle cx={px} cy={py} r="5" fill={ptColor} stroke="#FFFFFF" strokeWidth="1.5" />
              {pt.label && (
                <text
                  x={px + 8}
                  y={py - 8}
                  fill="#FFFFFF"
                  fontSize="11"
                  fontWeight="600"
                  filter="drop-shadow(0 2px 4px rgba(0,0,0,0.8))"
                >
                  {pt.label}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      </div>

      {/* Curve Legends at Top Right */}
      <div
        style={{
          position: 'absolute',
          top: 10,
          right: 12,
          display: 'flex',
          flexDirection: 'column',
          gap: 4,
          alignItems: 'flex-end',
        }}
      >
        {parsedCurves.map((curve, i) => (
          <div
            key={`leg-${i}`}
            style={{
              padding: '2px 8px',
              borderRadius: 4,
              backgroundColor: 'rgba(0, 0, 0, 0.6)',
              border: `1px solid ${curve.color}66`,
              color: curve.color,
              fontSize: 11,
              fontWeight: 600,
              fontFamily: 'monospace',
            }}
          >
            {curve.label}
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Universal 2D Curve Path Generator:
 * - 'y_of_x': Samples x in [xMin, xMax], calculates y = f(x)
 * - 'x_of_y': Samples y in [yMin, yMax], calculates x = g(y) (horizontal curves on Y-axis!)
 * - 'implicit': Uses 2D Marching Squares to trace F(x, y) = 0 contour line segments
 */
function buildCurvePath2D(
  curve: Parsed2DCurve,
  xMin: number,
  xMax: number,
  yMin: number,
  yMax: number,
  toSvgX: (x: number) => number,
  toSvgY: (y: number) => number,
  leftBound: number,
  topBound: number,
  plotW: number,
  plotH: number
): string {
  const rightBound = leftBound + plotW;
  const bottomBound = topBound + plotH;
  const SAMPLES = 160;

  // 1. Explicit Function of X: y = f(x)
  if (curve.type === 'y_of_x') {
    let path = '';
    let inSegment = false;
    const dx = (xMax - xMin) / SAMPLES;

    for (let i = 0; i <= SAMPLES; i++) {
      const x = xMin + i * dx;
      const y = curve.evalFn(x, 0);

      if (isNaN(y) || !isFinite(y)) {
        inSegment = false;
        continue;
      }

      const sx = toSvgX(x);
      const sy = toSvgY(y);

      // Clamp out-of-bounds spikes
      const isOut = sy < topBound - 50 || sy > bottomBound + 50;

      if (!isOut) {
        if (!inSegment) {
          path += ` M ${sx.toFixed(1)} ${sy.toFixed(1)}`;
          inSegment = true;
        } else {
          path += ` L ${sx.toFixed(1)} ${sy.toFixed(1)}`;
        }
      } else {
        inSegment = false;
      }
    }
    return path;
  }

  // 2. Explicit Function of Y: x = g(y) (Horizontal / Y-Axis Functions!)
  if (curve.type === 'x_of_y') {
    let path = '';
    let inSegment = false;
    const dy = (yMax - yMin) / SAMPLES;

    for (let i = 0; i <= SAMPLES; i++) {
      const y = yMin + i * dy;
      const x = curve.evalFn(0, y);

      if (isNaN(x) || !isFinite(x)) {
        inSegment = false;
        continue;
      }

      const sx = toSvgX(x);
      const sy = toSvgY(y);

      // Clamp out-of-bounds spikes
      const isOut = sx < leftBound - 50 || sx > rightBound + 50;

      if (!isOut) {
        if (!inSegment) {
          path += ` M ${sx.toFixed(1)} ${sy.toFixed(1)}`;
          inSegment = true;
        } else {
          path += ` L ${sx.toFixed(1)} ${sy.toFixed(1)}`;
        }
      } else {
        inSegment = false;
      }
    }
    return path;
  }

  // 3. Implicit 2D Algebraic Curve F(x, y) = 0 (Marching Squares)
  if (curve.type === 'implicit') {
    const gridRes = 80;
    const dx = (xMax - xMin) / gridRes;
    const dy = (yMax - yMin) / gridRes;

    // Evaluate scalar field on 2D grid
    const grid: number[][] = [];
    for (let i = 0; i <= gridRes; i++) {
      grid[i] = [];
      const x = xMin + i * dx;
      for (let j = 0; j <= gridRes; j++) {
        const y = yMin + j * dy;
        const val = curve.evalFn(x, y);
        grid[i][j] = isNaN(val) ? 1.0 : val;
      }
    }

    let path = '';

    // Marching squares cell contouring
    for (let i = 0; i < gridRes; i++) {
      const x0 = xMin + i * dx;
      const x1 = x0 + dx;

      for (let j = 0; j < gridRes; j++) {
        const y0 = yMin + j * dy;
        const y1 = y0 + dy;

        const v00 = grid[i][j];         // Bottom-left
        const v10 = grid[i + 1][j];     // Bottom-right
        const v11 = grid[i + 1][j + 1]; // Top-right
        const v01 = grid[i][j + 1];     // Top-left

        let cellIndex = 0;
        if (v00 > 0) cellIndex |= 1;
        if (v10 > 0) cellIndex |= 2;
        if (v11 > 0) cellIndex |= 4;
        if (v01 > 0) cellIndex |= 8;

        if (cellIndex === 0 || cellIndex === 15) continue;

        // Linear interpolation helper on square edge
        const interp = (valA: number, valB: number) => {
          const denom = valB - valA;
          return Math.abs(denom) < 1e-7 ? 0.5 : Math.max(0, Math.min(1, -valA / denom));
        };

        // Edge crossing points in math coordinates
        const bottomEdge = [x0 + interp(v00, v10) * dx, y0];
        const rightEdge = [x1, y0 + interp(v10, v11) * dy];
        const topEdge = [x0 + interp(v01, v11) * dx, y1];
        const leftEdge = [x0, y0 + interp(v00, v01) * dy];

        const addSegment = (p1: number[], p2: number[]) => {
          const sx1 = toSvgX(p1[0]);
          const sy1 = toSvgY(p1[1]);
          const sx2 = toSvgX(p2[0]);
          const sy2 = toSvgY(p2[1]);
          path += ` M ${sx1.toFixed(1)} ${sy1.toFixed(1)} L ${sx2.toFixed(1)} ${sy2.toFixed(1)}`;
        };

        switch (cellIndex) {
          case 1:
          case 14:
            addSegment(leftEdge, bottomEdge);
            break;
          case 2:
          case 13:
            addSegment(bottomEdge, rightEdge);
            break;
          case 3:
          case 12:
            addSegment(leftEdge, rightEdge);
            break;
          case 4:
          case 11:
            addSegment(rightEdge, topEdge);
            break;
          case 5:
            addSegment(leftEdge, topEdge);
            addSegment(bottomEdge, rightEdge);
            break;
          case 6:
          case 9:
            addSegment(bottomEdge, topEdge);
            break;
          case 7:
          case 8:
            addSegment(leftEdge, topEdge);
            break;
          case 10:
            addSegment(leftEdge, bottomEdge);
            addSegment(topEdge, rightEdge);
            break;
        }
      }
    }

    return path;
  }

  return '';
}

/**
 * Builds SVG polygon path for calculus region between curves:
 * Supports BOTH vertical strips (dx integration) and horizontal strips (dy integration along Y-axis).
 */
function ShadedRegionPath({
  region,
  xMin,
  xMax,
  yMin,
  yMax,
  toSvgX,
  toSvgY,
}: {
  region: GraphShadedRegion;
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
  toSvgX: (x: number) => number;
  toSvgY: (y: number) => number;
}) {
  const steps = 100;

  // 1. Horizontal Integration with respect to Y (dy integration)
  if (region.fromY !== undefined || region.toY !== undefined || region.gRight !== undefined) {
    const rawFromY = region.fromY !== undefined ? Number(region.fromY) : yMin;
    const rawToY = region.toY !== undefined ? Number(region.toY) : yMax;
    const minY = Math.min(rawFromY, rawToY);
    const maxY = Math.max(rawFromY, rawToY);

    const fromY = Math.max(yMin, minY);
    const toY = Math.min(yMax, maxY);
    if (fromY >= toY) return null;

    const stepDy = (toY - fromY) / steps;

    const gRightExpr = region.gRight || region.fTop || '0';
    const gLeftExpr = region.gLeft || region.fBottom || '0';

    const rightFn = compile2DMathFunction(gRightExpr);
    const leftFn = compile2DMathFunction(gLeftExpr);

    const rightPoints: Array<{ x: number; y: number }> = [];
    const leftPoints: Array<{ x: number; y: number }> = [];

    for (let i = 0; i <= steps; i++) {
      const y = fromY + i * stepDy;
      const xR = rightFn(0, y);
      const xL = leftFn(0, y);

      if (!isNaN(xR) && isFinite(xR) && !isNaN(xL) && isFinite(xL)) {
        rightPoints.push({ x: toSvgX(xR), y: toSvgY(y) });
        leftPoints.push({ x: toSvgX(xL), y: toSvgY(y) });
      }
    }

    if (rightPoints.length < 2) return null;

    let d = `M ${rightPoints[0].x.toFixed(1)} ${rightPoints[0].y.toFixed(1)}`;
    for (let i = 1; i < rightPoints.length; i++) {
      d += ` L ${rightPoints[i].x.toFixed(1)} ${rightPoints[i].y.toFixed(1)}`;
    }
    for (let i = leftPoints.length - 1; i >= 0; i--) {
      d += ` L ${leftPoints[i].x.toFixed(1)} ${leftPoints[i].y.toFixed(1)}`;
    }
    d += ' Z';

    const strokeColor = region.color || '#4ECDC4';
    const fillColor = region.color ? `${region.color}40` : 'url(#shaded-area-grad)';

    return <path d={d} fill={fillColor} stroke={strokeColor} strokeWidth="1.5" strokeDasharray="3 3" />;
  }

  // 2. Vertical Integration with respect to X (dx integration)
  const rawFromX = region.fromX !== undefined ? Number(region.fromX) : xMin;
  const rawToX = region.toX !== undefined ? Number(region.toX) : xMax;
  const minX = Math.min(rawFromX, rawToX);
  const maxX = Math.max(rawFromX, rawToX);

  const fromX = Math.max(xMin, minX);
  const toX = Math.min(xMax, maxX);
  if (fromX >= toX) return null;

  const stepDx = (toX - fromX) / steps;

  let topFn: (x: number, y: number) => number;
  let bottomFn: (x: number, y: number) => number;

  if (region.distribution === 'normal' || region.distribution === 'gaussian') {
    const mu = region.distMean ?? 0;
    const sigma = Math.max(1e-4, region.distStd ?? 1);
    const factor = 1 / (sigma * Math.sqrt(2 * Math.PI));
    topFn = (x: number) => {
      const z = (x - mu) / sigma;
      return factor * Math.exp(-0.5 * z * z);
    };
    bottomFn = () => 0;
  } else {
    topFn = compile2DMathFunction(region.fTop || '0');
    bottomFn = compile2DMathFunction(region.fBottom || '0');
  }

  const topPoints: Array<{ x: number; y: number }> = [];
  const bottomPoints: Array<{ x: number; y: number }> = [];

  for (let i = 0; i <= steps; i++) {
    const x = fromX + i * stepDx;
    const yTop = topFn(x, 0);
    const yBottom = bottomFn(x, 0);

    if (!isNaN(yTop) && isFinite(yTop) && !isNaN(yBottom) && isFinite(yBottom)) {
      topPoints.push({ x: toSvgX(x), y: toSvgY(yTop) });
      bottomPoints.push({ x: toSvgX(x), y: toSvgY(yBottom) });
    }
  }

  if (topPoints.length < 2) return null;

  // Build polygon: forward along top, then backward along bottom
  let d = `M ${topPoints[0].x.toFixed(1)} ${topPoints[0].y.toFixed(1)}`;
  for (let i = 1; i < topPoints.length; i++) {
    d += ` L ${topPoints[i].x.toFixed(1)} ${topPoints[i].y.toFixed(1)}`;
  }
  for (let i = bottomPoints.length - 1; i >= 0; i--) {
    d += ` L ${bottomPoints[i].x.toFixed(1)} ${bottomPoints[i].y.toFixed(1)}`;
  }
  d += ' Z';

  const strokeColor = region.color || '#4ECDC4';
  const fillColor = region.color ? `${region.color}40` : 'url(#shaded-area-grad)';

  return <path d={d} fill={fillColor} stroke={strokeColor} strokeWidth="1.5" strokeDasharray="3 3" />;
}

/**
 * Safely evaluates mathematical expressions (legacy backwards-compatibility).
 */
export function evaluateMathExpression(expr: string, xVal: number): number {
  const fn = compile2DMathFunction(expr);
  return fn(xVal, 0);
}

/**
 * Generates nice integer or half-integer grid tick intervals.
 */
function generateTicks(min: number, max: number, targetCount: number = 6): number[] {
  const range = max - min;
  const roughStep = range / targetCount;
  const magnitude = Math.pow(10, Math.floor(Math.log10(roughStep)));
  const normalized = roughStep / magnitude;

  let step = magnitude;
  if (normalized > 5) step = 5 * magnitude;
  else if (normalized > 2) step = 2 * magnitude;
  else if (normalized > 1) step = 1 * magnitude;

  if (step === 0) step = 1;

  const ticks: number[] = [];
  const start = Math.ceil(min / step) * step;
  for (let t = start; t <= max; t += step) {
    ticks.push(Number(t.toFixed(2)));
  }
  return ticks;
}
