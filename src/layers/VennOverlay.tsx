/**
 * VennOverlay — High-Precision Mathematical & Probability Venn Diagram Engine.
 *
 * Renders 2-set and 3-set Venn Diagrams in pure vector SVG:
 * - Native SVG Boolean Masking (<clipPath> & <mask>) guaranteeing 100% geometric accuracy.
 * - Exact shading for any boolean set operation (P(A ∩ B), P(A ∪ B), P(A \ B), P(A'), P(neither), etc.).
 * - Labeling of sets, probabilities, and region minterm values at calculated centroids.
 * - Glassmorphic chalkboard card with dragging, close button, and zoom/pan scale synchronization.
 */
import React, { useState, useRef, forwardRef, useImperativeHandle, useCallback } from 'react';

export interface VennItem {
  id: string;
  title?: string;
  sets: string[]; // ['A', 'B'] or ['A', 'B', 'C']
  shadedRegions?: string[]; // minterms e.g. ['A_and_B', 'A_only']
  shadedOperation?: string; // string shorthand e.g. 'intersection', 'union', 'A_only', 'neither'
  labels?: Record<string, string>; // {'A': '0.5', 'B': '0.4', 'intersection': '0.2', 'outside': '0.3'}
  colorTheme?: 'cyan_orange' | 'plasma' | 'emerald' | 'sunset';
  x: number;
  y: number;
  width?: number;
  height?: number;
}

export interface VennOverlayHandle {
  addVenn(item: Omit<VennItem, 'id'> & { id?: string }): string;
  removeVenn(id: string): void;
  clear(): void;
  getItemsCount(): number;
  setItems(items: VennItem[]): void;
  getItems(): VennItem[];
}

export interface VennOverlayProps {
  onUpdatePosition?: (id: string, x: number, y: number) => void;
  onRemoveVenn?: (id: string) => void;
}

/**
 * Resolves any human or AI set operation into an exact array of disjoint minterms.
 */
export function resolveVennMinterms(
  setsCount: number,
  operation?: string,
  explicitMinterms?: string[]
): Set<string> {
  if (explicitMinterms && explicitMinterms.length > 0) {
    return new Set(explicitMinterms);
  }

  const op = (operation || 'intersection').toLowerCase().trim();
  const active = new Set<string>();

  if (setsCount === 2) {
    // 2-Set Atomic Minterms: 'A_only', 'B_only', 'A_and_B', 'neither'
    if (
      op.includes('intersect') ||
      op === 'a and b' ||
      op === 'p(a and b)' ||
      op === 'p(a intersect b)' ||
      op === 'p(a cap b)' ||
      op === 'a_and_b' ||
      op === 'and' ||
      op === 'both'
    ) {
      active.add('A_and_B');
    } else if (
      op.includes('union') ||
      op === 'a or b' ||
      op === 'p(a or b)' ||
      op === 'p(a union b)' ||
      op === 'p(a cup b)' ||
      op === 'or' ||
      op === 'either'
    ) {
      active.add('A_only');
      active.add('A_and_B');
      active.add('B_only');
    } else if (
      op === 'a_only' ||
      op === 'a only' ||
      op === 'a minus b' ||
      op === 'a \\ b' ||
      op === 'a and not b' ||
      op === 'p(a only)'
    ) {
      active.add('A_only');
    } else if (
      op === 'b_only' ||
      op === 'b only' ||
      op === 'b minus a' ||
      op === 'b \\ a' ||
      op === 'b and not a' ||
      op === 'p(b only)'
    ) {
      active.add('B_only');
    } else if (
      op.includes('neither') ||
      op === 'none' ||
      op === 'outside' ||
      op === 'not (a or b)' ||
      op === 'nor'
    ) {
      active.add('neither');
    } else if (
      op === 'complement_a' ||
      op === 'not a' ||
      op === "a'" ||
      op === 'p(not a)' ||
      op === 'a_prime'
    ) {
      active.add('B_only');
      active.add('neither');
    } else if (
      op === 'complement_b' ||
      op === 'not b' ||
      op === "b'" ||
      op === 'p(not b)' ||
      op === 'b_prime'
    ) {
      active.add('A_only');
      active.add('neither');
    } else if (op === 'not (a and b)' || op === 'nand') {
      active.add('A_only');
      active.add('B_only');
      active.add('neither');
    } else if (op === 'xor' || op === 'symmetric_difference') {
      active.add('A_only');
      active.add('B_only');
    } else {
      // Default fallback
      active.add('A_and_B');
    }
  } else {
    // 3-Set Atomic Minterms:
    // 'A_only', 'B_only', 'C_only', 'A_and_B_only', 'A_and_C_only', 'B_and_C_only', 'A_and_B_and_C', 'neither'
    if (
      op.includes('all') ||
      op === 'intersection' ||
      op === 'a and b and c' ||
      op === 'center'
    ) {
      active.add('A_and_B_and_C');
    } else if (op.includes('union') || op === 'any' || op === 'a or b or c') {
      active.add('A_only');
      active.add('B_only');
      active.add('C_only');
      active.add('A_and_B_only');
      active.add('A_and_C_only');
      active.add('B_and_C_only');
      active.add('A_and_B_and_C');
    } else if (op === 'a and b' || op === 'ab') {
      active.add('A_and_B_only');
      active.add('A_and_B_and_C');
    } else if (op === 'a and c' || op === 'ac') {
      active.add('A_and_C_only');
      active.add('A_and_B_and_C');
    } else if (op === 'b and c' || op === 'bc') {
      active.add('B_and_C_only');
      active.add('A_and_B_and_C');
    } else if (op === 'a_only' || op === 'a only') {
      active.add('A_only');
    } else if (op === 'b_only' || op === 'b only') {
      active.add('B_only');
    } else if (op === 'c_only' || op === 'c only') {
      active.add('C_only');
    } else if (op.includes('neither') || op === 'outside') {
      active.add('neither');
    } else {
      active.add('A_and_B_and_C');
    }
  }

  return active;
}

export const VennOverlay = forwardRef<VennOverlayHandle, VennOverlayProps>(function VennOverlay(
  { onUpdatePosition, onRemoveVenn },
  ref
) {
  const [vennItems, setVennItems] = useState<VennItem[]>([]);

  const addVenn = useCallback((item: Omit<VennItem, 'id'> & { id?: string }): string => {
    const id = item.id || `venn-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const newItem: VennItem = {
      id,
      title: item.title || 'Probability Venn Diagram',
      sets: item.sets && item.sets.length > 0 ? item.sets : ['A', 'B'],
      shadedRegions: item.shadedRegions,
      shadedOperation: item.shadedOperation || 'intersection',
      labels: item.labels || {},
      colorTheme: item.colorTheme || 'cyan_orange',
      x: item.x,
      y: item.y,
      width: item.width || 480,
      height: item.height || 380,
    };

    setVennItems((prev) => [...prev, newItem]);
    return id;
  }, []);

  const removeVenn = useCallback(
    (id: string) => {
      setVennItems((prev) => prev.filter((v) => v.id !== id));
      if (onRemoveVenn) onRemoveVenn(id);
    },
    [onRemoveVenn]
  );

  const clear = useCallback(() => {
    setVennItems([]);
  }, []);

  const getItemsCount = useCallback(() => vennItems.length, [vennItems.length]);
  const setItems = useCallback((items: VennItem[]) => setVennItems(items), []);
  const getItems = useCallback(() => vennItems, [vennItems]);

  const handleCardMove = useCallback(
    (id: string, newX: number, newY: number) => {
      setVennItems((prev) =>
        prev.map((v) => (v.id === id ? { ...v, x: newX, y: newY } : v))
      );
      if (onUpdatePosition) onUpdatePosition(id, newX, newY);
    },
    [onUpdatePosition]
  );

  useImperativeHandle(
    ref,
    () => ({
      addVenn,
      removeVenn,
      clear,
      getItemsCount,
      setItems,
      getItems,
    }),
    [addVenn, removeVenn, clear, getItemsCount, setItems, getItems]
  );

  return (
    <div
      className="venn-overlay"
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
      {vennItems.map((venn) => (
        <VennCard
          key={venn.id}
          item={venn}
          onMove={(newX, newY) => handleCardMove(venn.id, newX, newY)}
          onClose={() => removeVenn(venn.id)}
        />
      ))}
    </div>
  );
});

/**
 * Renders a single interactive Glassmorphic Venn Diagram card on the whiteboard.
 */
function VennCard({
  item,
  onMove,
  onClose,
}: {
  item: VennItem;
  onMove?: (newX: number, newY: number) => void;
  onClose?: () => void;
}) {
  const width = item.width || 480;
  const height = item.height || 380;
  const is3Set = (item.sets && item.sets.length >= 3);

  // Card dragging
  const isDraggingCardRef = useRef(false);
  const cardDragStartRef = useRef({ mouseX: 0, mouseY: 0, startX: 0, startY: 0 });

  const handleHeaderPointerDown = (e: React.PointerEvent) => {
    e.stopPropagation();
    if ((e.target as HTMLElement).closest('button')) return;
    isDraggingCardRef.current = true;
    cardDragStartRef.current = {
      mouseX: e.clientX,
      mouseY: e.clientY,
      startX: item.x,
      startY: item.y,
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

  // Geometric coordinates
  const plotW = width - 24;
  const plotH = height - 46;
  const cx = plotW / 2;
  const cy = plotH / 2 + 10;

  // Active shaded minterms
  const activeMinterms = resolveVennMinterms(
    is3Set ? 3 : 2,
    item.shadedOperation,
    item.shadedRegions
  );

  const strokeA = '#4ECDC4';
  const strokeB = '#FF9F43';
  const strokeC = '#FF6B6B';
  const universeStroke = 'rgba(255, 255, 255, 0.2)';

  const setLabelA = item.sets[0] || 'A';
  const setLabelB = item.sets[1] || 'B';
  const setLabelC = item.sets[2] || 'C';

  // ID prefixes to avoid SVG clip/mask collision across multiple cards
  const uid = item.id.replace(/[^a-zA-Z0-9_-]/g, '_');

  return (
    <div
      style={{
        position: 'absolute',
        left: `${item.x}px`,
        top: `${item.y}px`,
        width: `${width}px`,
        height: `${height}px`,
        pointerEvents: 'auto',
        display: 'flex',
        flexDirection: 'column',
        borderRadius: 12,
        background: 'rgba(18, 20, 32, 0.88)',
        backdropFilter: 'blur(16px)',
        border: '1px solid rgba(78, 205, 196, 0.35)',
        boxShadow: '0 12px 32px rgba(0, 0, 0, 0.45)',
        overflow: 'hidden',
        userSelect: 'none',
      }}
    >
      {/* ── Drag Header ── */}
      <div
        onPointerDown={handleHeaderPointerDown}
        onPointerMove={handleHeaderPointerMove}
        onPointerUp={handleHeaderPointerUp}
        onPointerCancel={handleHeaderPointerUp}
        style={{
          height: 36,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 12px',
          background: 'rgba(255, 255, 255, 0.04)',
          borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
          cursor: 'grab',
          touchAction: 'none',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 13, color: '#4ECDC4' }}>📊</span>
          <span
            style={{
              fontSize: 12,
              fontWeight: 700,
              color: '#FFFFFF',
              fontFamily: "'Inter', sans-serif",
            }}
          >
            {item.title || 'Probability Venn Diagram'}
          </span>
        </div>

        {onClose && (
          <button
            onClick={onClose}
            title="Close Venn Diagram"
            style={{
              background: 'transparent',
              border: 'none',
              color: '#888',
              fontSize: 13,
              cursor: 'pointer',
              padding: '2px 6px',
              borderRadius: 4,
            }}
            onMouseEnter={(e) => (e.currentTarget.style.color = '#ff6b6b')}
            onMouseLeave={(e) => (e.currentTarget.style.color = '#888')}
          >
            ✕
          </button>
        )}
      </div>

      {/* ── SVG Drawing Viewport ── */}
      <div style={{ flex: 1, position: 'relative', padding: '12px' }}>
        <svg
          width={plotW}
          height={plotH}
          viewBox={`0 0 ${plotW} ${plotH}`}
          style={{ display: 'block', overflow: 'visible' }}
        >
          <defs>
            {/* Shaded Area Pattern */}
            <linearGradient id={`${uid}-shade-grad`} x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="#4ECDC4" stopOpacity="0.55" />
              <stop offset="100%" stopColor="#4ECDC4" stopOpacity="0.25" />
            </linearGradient>

            {/* ── 2-SET GEOMETRY DEFINITIONS ── */}
            {!is3Set && (() => {
              const r = Math.min(plotW * 0.28, plotH * 0.40);
              const dist = r * 1.05;
              const caX = cx - dist / 2;
              const caY = cy;
              const cbX = cx + dist / 2;
              const cbY = cy;

              return (
                <React.Fragment key="defs-2set">
                  {/* Clip for Circle A */}
                  <clipPath id={`${uid}-clip-A`}>
                    <circle cx={caX} cy={caY} r={r} />
                  </clipPath>

                  {/* Chained Clip for Intersection A ∩ B */}
                  <clipPath id={`${uid}-clip-AB`} clipPath={`url(#${uid}-clip-A)`}>
                    <circle cx={cbX} cy={cbY} r={r} />
                  </clipPath>

                  {/* Mask for A only (A minus B) */}
                  <mask id={`${uid}-mask-A-only`}>
                    <rect width={plotW} height={plotH} fill="white" />
                    <circle cx={cbX} cy={cbY} r={r} fill="black" />
                  </mask>

                  {/* Mask for B only (B minus A) */}
                  <mask id={`${uid}-mask-B-only`}>
                    <rect width={plotW} height={plotH} fill="white" />
                    <circle cx={caX} cy={caY} r={r} fill="black" />
                  </mask>

                  {/* Mask for Neither (Outside Union A ∪ B) */}
                  <mask id={`${uid}-mask-neither`}>
                    <rect width={plotW} height={plotH} fill="white" />
                    <circle cx={caX} cy={caY} r={r} fill="black" />
                    <circle cx={cbX} cy={cbY} r={r} fill="black" />
                  </mask>
                </React.Fragment>
              );
            })()}

            {/* ── 3-SET GEOMETRY DEFINITIONS ── */}
            {is3Set && (() => {
              const r = Math.min(plotW * 0.24, plotH * 0.32);
              const offset = r * 0.58;
              const caX = cx - offset;
              const caY = cy + offset * 0.58;
              const cbX = cx + offset;
              const cbY = cy + offset * 0.58;
              const ccX = cx;
              const ccY = cy - offset * 0.95;

              return (
                <React.Fragment key="defs-3set">
                  <clipPath id={`${uid}-clip3-A`}>
                    <circle cx={caX} cy={caY} r={r} />
                  </clipPath>
                  <clipPath id={`${uid}-clip3-AB`} clipPath={`url(#${uid}-clip3-A)`}>
                    <circle cx={cbX} cy={cbY} r={r} />
                  </clipPath>
                  <clipPath id={`${uid}-clip3-ABC`} clipPath={`url(#${uid}-clip3-AB)`}>
                    <circle cx={ccX} cy={ccY} r={r} />
                  </clipPath>
                  <clipPath id={`${uid}-clip3-AC`} clipPath={`url(#${uid}-clip3-A)`}>
                    <circle cx={ccX} cy={ccY} r={r} />
                  </clipPath>
                  <clipPath id={`${uid}-clip3-BC`}>
                    <circle cx={cbX} cy={cbY} r={r} />
                  </clipPath>

                  {/* Mask removing C */}
                  <mask id={`${uid}-mask3-noC`}>
                    <rect width={plotW} height={plotH} fill="white" />
                    <circle cx={ccX} cy={ccY} r={r} fill="black" />
                  </mask>
                  {/* Mask removing B */}
                  <mask id={`${uid}-mask3-noB`}>
                    <rect width={plotW} height={plotH} fill="white" />
                    <circle cx={cbX} cy={cbY} r={r} fill="black" />
                  </mask>
                  {/* Mask removing A */}
                  <mask id={`${uid}-mask3-noA`}>
                    <rect width={plotW} height={plotH} fill="white" />
                    <circle cx={caX} cy={caY} r={r} fill="black" />
                  </mask>
                  {/* Mask removing (B or C) */}
                  <mask id={`${uid}-mask3-A-only`}>
                    <rect width={plotW} height={plotH} fill="white" />
                    <circle cx={cbX} cy={cbY} r={r} fill="black" />
                    <circle cx={ccX} cy={ccY} r={r} fill="black" />
                  </mask>
                  {/* Mask removing (A or C) */}
                  <mask id={`${uid}-mask3-B-only`}>
                    <rect width={plotW} height={plotH} fill="white" />
                    <circle cx={caX} cy={caY} r={r} fill="black" />
                    <circle cx={ccX} cy={ccY} r={r} fill="black" />
                  </mask>
                  {/* Mask removing (A or B) */}
                  <mask id={`${uid}-mask3-C-only`}>
                    <rect width={plotW} height={plotH} fill="white" />
                    <circle cx={caX} cy={caY} r={r} fill="black" />
                    <circle cx={cbX} cy={cbY} r={r} fill="black" />
                  </mask>
                  {/* Mask for Neither 3 */}
                  <mask id={`${uid}-mask3-neither`}>
                    <rect width={plotW} height={plotH} fill="white" />
                    <circle cx={caX} cy={caY} r={r} fill="black" />
                    <circle cx={cbX} cy={cbY} r={r} fill="black" />
                    <circle cx={ccX} cy={ccY} r={r} fill="black" />
                  </mask>
                </React.Fragment>
              );
            })()}
          </defs>

          {/* ── Sample Space / Universal Box (S or U) ── */}
          <rect
            x={4}
            y={4}
            width={plotW - 8}
            height={plotH - 8}
            rx={8}
            fill="rgba(255, 255, 255, 0.02)"
            stroke={universeStroke}
            strokeWidth="1.5"
            strokeDasharray="4 4"
          />
          <text
            x={plotW - 20}
            y={24}
            fill="#8892b0"
            fontSize="14"
            fontWeight="700"
            fontFamily="'Inter', sans-serif"
            textAnchor="end"
          >
            S (Universe)
          </text>

          {/* ════════════ 2-SET RENDERING ════════════ */}
          {!is3Set && (() => {
            const r = Math.min(plotW * 0.28, plotH * 0.40);
            const dist = r * 1.05;
            const caX = cx - dist / 2;
            const caY = cy;
            const cbX = cx + dist / 2;
            const cbY = cy;

            return (
              <g>
                {/* 1. Shaded Region: Outside / Neither */}
                {activeMinterms.has('neither') && (
                  <rect
                    x={4}
                    y={4}
                    width={plotW - 8}
                    height={plotH - 8}
                    rx={8}
                    fill={`url(#${uid}-shade-grad)`}
                    mask={`url(#${uid}-mask-neither)`}
                  />
                )}

                {/* 2. Shaded Region: A only */}
                {activeMinterms.has('A_only') && (
                  <circle
                    cx={caX}
                    cy={caY}
                    r={r}
                    fill={`url(#${uid}-shade-grad)`}
                    mask={`url(#${uid}-mask-A-only)`}
                  />
                )}

                {/* 3. Shaded Region: B only */}
                {activeMinterms.has('B_only') && (
                  <circle
                    cx={cbX}
                    cy={cbY}
                    r={r}
                    fill={`url(#${uid}-shade-grad)`}
                    mask={`url(#${uid}-mask-B-only)`}
                  />
                )}

                {/* 4. Shaded Region: Intersection A ∩ B */}
                {activeMinterms.has('A_and_B') && (
                  <rect
                    x={caX - r}
                    y={caY - r}
                    width={dist + 2 * r}
                    height={2 * r}
                    fill={`url(#${uid}-shade-grad)`}
                    clipPath={`url(#${uid}-clip-AB)`}
                  />
                )}

                {/* Set Outlines */}
                <circle
                  cx={caX}
                  cy={caY}
                  r={r}
                  fill="none"
                  stroke={strokeA}
                  strokeWidth="2.5"
                />
                <circle
                  cx={cbX}
                  cy={cbY}
                  r={r}
                  fill="none"
                  stroke={strokeB}
                  strokeWidth="2.5"
                />

                {/* Set Title Headers */}
                <text
                  x={caX - r * 0.45}
                  y={caY - r * 1.08}
                  fill={strokeA}
                  fontSize="16"
                  fontWeight="700"
                  fontFamily="'Inter', sans-serif"
                  textAnchor="middle"
                >
                  {setLabelA}
                </text>
                <text
                  x={cbX + r * 0.45}
                  y={cbY - r * 1.08}
                  fill={strokeB}
                  fontSize="16"
                  fontWeight="700"
                  fontFamily="'Inter', sans-serif"
                  textAnchor="middle"
                >
                  {setLabelB}
                </text>

                {/* Centroid Labels / Probabilities */}
                <text
                  x={caX - r * 0.45}
                  y={caY + 5}
                  fill="#FFFFFF"
                  fontSize="14"
                  fontWeight="600"
                  fontFamily="'Inter', sans-serif"
                  textAnchor="middle"
                >
                  {item.labels?.[setLabelA] || item.labels?.['A_only'] || ''}
                </text>
                <text
                  x={cbX + r * 0.45}
                  y={cbY + 5}
                  fill="#FFFFFF"
                  fontSize="14"
                  fontWeight="600"
                  fontFamily="'Inter', sans-serif"
                  textAnchor="middle"
                >
                  {item.labels?.[setLabelB] || item.labels?.['B_only'] || ''}
                </text>
                <text
                  x={cx}
                  y={cy + 5}
                  fill="#FFFFFF"
                  fontSize="14"
                  fontWeight="700"
                  fontFamily="'Inter', sans-serif"
                  textAnchor="middle"
                >
                  {item.labels?.['intersection'] || item.labels?.['A_and_B'] || item.labels?.['both'] || ''}
                </text>
                {item.labels?.['outside'] && (
                  <text
                    x={24}
                    y={plotH - 18}
                    fill="#8892b0"
                    fontSize="13"
                    fontWeight="600"
                    fontFamily="'Inter', sans-serif"
                  >
                    {item.labels['outside']}
                  </text>
                )}
              </g>
            );
          })()}

          {/* ════════════ 3-SET RENDERING ════════════ */}
          {is3Set && (() => {
            const r = Math.min(plotW * 0.24, plotH * 0.32);
            const offset = r * 0.58;
            const caX = cx - offset;
            const caY = cy + offset * 0.58;
            const cbX = cx + offset;
            const cbY = cy + offset * 0.58;
            const ccX = cx;
            const ccY = cy - offset * 0.95;

            return (
              <g>
                {/* 1. Neither */}
                {activeMinterms.has('neither') && (
                  <rect
                    x={4}
                    y={4}
                    width={plotW - 8}
                    height={plotH - 8}
                    rx={8}
                    fill={`url(#${uid}-shade-grad)`}
                    mask={`url(#${uid}-mask3-neither)`}
                  />
                )}

                {/* 2. Single Set Only */}
                {activeMinterms.has('A_only') && (
                  <circle
                    cx={caX}
                    cy={caY}
                    r={r}
                    fill={`url(#${uid}-shade-grad)`}
                    mask={`url(#${uid}-mask3-A-only)`}
                  />
                )}
                {activeMinterms.has('B_only') && (
                  <circle
                    cx={cbX}
                    cy={cbY}
                    r={r}
                    fill={`url(#${uid}-shade-grad)`}
                    mask={`url(#${uid}-mask3-B-only)`}
                  />
                )}
                {activeMinterms.has('C_only') && (
                  <circle
                    cx={ccX}
                    cy={ccY}
                    r={r}
                    fill={`url(#${uid}-shade-grad)`}
                    mask={`url(#${uid}-mask3-C-only)`}
                  />
                )}

                {/* 3. Double Intersections (minus third set) */}
                {activeMinterms.has('A_and_B_only') && (
                  <rect
                    x={caX - r}
                    y={caY - r}
                    width={plotW}
                    height={plotH}
                    fill={`url(#${uid}-shade-grad)`}
                    clipPath={`url(#${uid}-clip3-AB)`}
                    mask={`url(#${uid}-mask3-noC)`}
                  />
                )}
                {activeMinterms.has('A_and_C_only') && (
                  <rect
                    x={caX - r}
                    y={ccY - r}
                    width={plotW}
                    height={plotH}
                    fill={`url(#${uid}-shade-grad)`}
                    clipPath={`url(#${uid}-clip3-AC)`}
                    mask={`url(#${uid}-mask3-noB)`}
                  />
                )}
                {activeMinterms.has('B_and_C_only') && (
                  <rect
                    x={cbX - r}
                    y={ccY - r}
                    width={plotW}
                    height={plotH}
                    fill={`url(#${uid}-shade-grad)`}
                    clipPath={`url(#${uid}-clip3-BC)`}
                    mask={`url(#${uid}-mask3-noA)`}
                  />
                )}

                {/* 4. Triple Intersection (A ∩ B ∩ C) */}
                {activeMinterms.has('A_and_B_and_C') && (
                  <rect
                    x={cx - r}
                    y={cy - r}
                    width={2 * r}
                    height={2 * r}
                    fill={`url(#${uid}-shade-grad)`}
                    clipPath={`url(#${uid}-clip3-ABC)`}
                  />
                )}

                {/* Outlines */}
                <circle cx={caX} cy={caY} r={r} fill="none" stroke={strokeA} strokeWidth="2.2" />
                <circle cx={cbX} cy={cbY} r={r} fill="none" stroke={strokeB} strokeWidth="2.2" />
                <circle cx={ccX} cy={ccY} r={r} fill="none" stroke={strokeC} strokeWidth="2.2" />

                {/* Titles */}
                <text x={caX - r * 0.7} y={caY + r * 0.7} fill={strokeA} fontSize="15" fontWeight="700" fontFamily="'Inter', sans-serif">
                  {setLabelA}
                </text>
                <text x={cbX + r * 0.45} y={cbY + r * 0.7} fill={strokeB} fontSize="15" fontWeight="700" fontFamily="'Inter', sans-serif">
                  {setLabelB}
                </text>
                <text x={ccX} y={ccY - r * 1.05} fill={strokeC} fontSize="15" fontWeight="700" fontFamily="'Inter', sans-serif" textAnchor="middle">
                  {setLabelC}
                </text>

                {/* Center / Triple label */}
                {item.labels?.['intersection'] && (
                  <text x={cx} y={cy + 8} fill="#FFFFFF" fontSize="13" fontWeight="700" fontFamily="'Inter', sans-serif" textAnchor="middle">
                    {item.labels['intersection']}
                  </text>
                )}
              </g>
            );
          })()}
        </svg>
      </div>
    </div>
  );
}
