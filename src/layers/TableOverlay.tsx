/**
 * TableOverlay — High-Contrast Modern Pedagogical Table Layer for Digital Whiteboard.
 *
 * Renders elegant, frosted dark slate comparison tables and matrices in 1080p canvas space.
 * Features KaTeX inline formula rendering, auto-scaling columns, status badges,
 * and seamless theme integration.
 */

import React, { useState, forwardRef, useImperativeHandle, useCallback, useRef } from 'react';
import katex from 'katex';
import type { TableOptions, TableTheme } from '../types';
import { TableLayoutEngine, type ComputedTableLayout, type ComputedCell } from '../engine/TableLayoutEngine';

export interface TableOverlayHandle {
  addTable(table: TableOptions & { id?: string; x?: number; y?: number; width?: number; height?: number }): string;
  updateTable(id: string, updates: Partial<TableOptions>): void;
  removeTable(id: string): void;
  getTables(): Array<TableOptions & { id: string }>;
  setTables(tables: Array<TableOptions & { id: string }>): void;
  clear(): void;
}

export interface TableOverlayProps {
  zoom?: number;
  onRemoveTable?: (id: string) => void;
  onUpdatePosition?: (id: string, x: number, y: number) => void;
}

interface ActiveTableItem extends TableOptions {
  id: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
}

const THEME_STYLES: Record<
  TableTheme,
  {
    headerBg: string;
    accentColor: string;
    borderColor: string;
    headerTextColor: string;
    badgeGlow: string;
  }
> = {
  cyan: {
    headerBg: 'linear-gradient(135deg, rgba(0, 229, 255, 0.20) 0%, rgba(14, 165, 233, 0.10) 100%)',
    accentColor: '#00E5FF',
    borderColor: 'rgba(0, 229, 255, 0.28)',
    headerTextColor: '#E0F7FA',
    badgeGlow: 'rgba(0, 229, 255, 0.25)',
  },
  emerald: {
    headerBg: 'linear-gradient(135deg, rgba(16, 185, 129, 0.20) 0%, rgba(5, 150, 105, 0.10) 100%)',
    accentColor: '#10B981',
    borderColor: 'rgba(16, 185, 129, 0.28)',
    headerTextColor: '#D1FAE5',
    badgeGlow: 'rgba(16, 185, 129, 0.25)',
  },
  purple: {
    headerBg: 'linear-gradient(135deg, rgba(168, 85, 247, 0.20) 0%, rgba(126, 34, 206, 0.10) 100%)',
    accentColor: '#A855F7',
    borderColor: 'rgba(168, 85, 247, 0.28)',
    headerTextColor: '#F3E8FF',
    badgeGlow: 'rgba(168, 85, 247, 0.25)',
  },
  amber: {
    headerBg: 'linear-gradient(135deg, rgba(245, 158, 11, 0.20) 0%, rgba(217, 119, 6, 0.10) 100%)',
    accentColor: '#F59E0B',
    borderColor: 'rgba(245, 158, 11, 0.28)',
    headerTextColor: '#FEF3C7',
    badgeGlow: 'rgba(245, 158, 11, 0.25)',
  },
  slate: {
    headerBg: 'linear-gradient(135deg, rgba(148, 163, 184, 0.16) 0%, rgba(71, 85, 105, 0.10) 100%)',
    accentColor: '#94A3B8',
    borderColor: 'rgba(255, 255, 255, 0.14)',
    headerTextColor: '#F8FAFC',
    badgeGlow: 'rgba(148, 163, 184, 0.20)',
  },
};

export const TableOverlay = forwardRef<TableOverlayHandle, TableOverlayProps>(
  function TableOverlay({ zoom = 1, onRemoveTable, onUpdatePosition }, ref) {
    const [tables, setTablesState] = useState<ActiveTableItem[]>([]);
    const draggingIdRef = useRef<string | null>(null);
    const dragOffsetRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });

    const addTable = useCallback(
      (item: TableOptions & { id?: string; x?: number; y?: number; width?: number; height?: number }): string => {
        const id = item.id || `table_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
        setTablesState((prev) => {
          const filtered = prev.filter((t) => t.id !== id);
          return [...filtered, { ...item, id }];
        });
        return id;
      },
      []
    );

    const updateTable = useCallback((id: string, updates: Partial<TableOptions>) => {
      setTablesState((prev) =>
        prev.map((t) => (t.id === id ? { ...t, ...updates } : t))
      );
    }, []);

    const removeTable = useCallback(
      (id: string) => {
        setTablesState((prev) => prev.filter((t) => t.id !== id));
        onRemoveTable?.(id);
      },
      [onRemoveTable]
    );

    const clear = useCallback(() => {
      setTablesState([]);
    }, []);

    const getTables = useCallback((): Array<TableOptions & { id: string }> => {
      return tables;
    }, [tables]);

    const setTables = useCallback((newTables: Array<TableOptions & { id: string }>) => {
      setTablesState(newTables);
    }, []);

    useImperativeHandle(
      ref,
      () => ({
        addTable,
        updateTable,
        removeTable,
        getTables,
        setTables,
        clear,
      }),
      [addTable, updateTable, removeTable, getTables, setTables, clear]
    );

    // Drag handling for table header
    const handlePointerDown = (tableId: string, e: React.PointerEvent<HTMLDivElement>, currentX: number, currentY: number) => {
      if (e.button !== 0) return;
      const targetEl = e.currentTarget;
      const pointerId = e.pointerId;
      targetEl.setPointerCapture(pointerId);

      draggingIdRef.current = tableId;
      dragOffsetRef.current = {
        x: e.clientX / zoom - currentX,
        y: e.clientY / zoom - currentY,
      };

      const onPointerMove = (moveEvt: PointerEvent) => {
        if (draggingIdRef.current !== tableId) return;
        const newX = Math.round(moveEvt.clientX / zoom - dragOffsetRef.current.x);
        const newY = Math.round(moveEvt.clientY / zoom - dragOffsetRef.current.y);

        setTablesState((prev) =>
          prev.map((t) => (t.id === tableId ? { ...t, x: newX, y: newY } : t))
        );
        onUpdatePosition?.(tableId, newX, newY);
      };

      const onPointerUp = () => {
        if (targetEl.hasPointerCapture(pointerId)) {
          targetEl.releasePointerCapture(pointerId);
        }
        draggingIdRef.current = null;
        window.removeEventListener('pointermove', onPointerMove);
        window.removeEventListener('pointerup', onPointerUp);
        window.removeEventListener('pointercancel', onPointerUp);
      };

      window.addEventListener('pointermove', onPointerMove);
      window.addEventListener('pointerup', onPointerUp);
      window.addEventListener('pointercancel', onPointerUp);
    };

    const renderCell = (cell: ComputedCell, fontSize: number, align: 'left' | 'center' | 'right') => {
      // 1. Badge variant
      if (cell.badge) {
        const bgColors = {
          success: 'rgba(16, 185, 129, 0.18)',
          danger: 'rgba(244, 63, 94, 0.18)',
          warning: 'rgba(245, 158, 11, 0.18)',
          info: 'rgba(6, 182, 212, 0.18)',
        };
        const textColors = {
          success: '#34D399',
          danger: '#FB7185',
          warning: '#FBBF24',
          info: '#22D3EE',
        };
        const borderColors = {
          success: 'rgba(16, 185, 129, 0.35)',
          danger: 'rgba(244, 63, 94, 0.35)',
          warning: 'rgba(245, 158, 11, 0.35)',
          info: 'rgba(6, 182, 212, 0.35)',
        };

        return (
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '3px 10px',
              borderRadius: 6,
              fontSize: Math.max(12, fontSize - 2),
              fontWeight: 600,
              backgroundColor: bgColors[cell.badge.variant],
              color: textColors[cell.badge.variant],
              border: `1px solid ${borderColors[cell.badge.variant]}`,
              letterSpacing: '0.02em',
            }}
          >
            {cell.badge.text}
          </span>
        );
      }

      // 2. LaTeX Formula
      if (cell.isMath && cell.latex) {
        try {
          const html = katex.renderToString(cell.latex, {
            throwOnError: false,
            displayMode: false,
          });
          return (
            <span
              style={{
                fontSize: fontSize + 1,
                color: '#FFFFFF',
              }}
              dangerouslySetInnerHTML={{ __html: html }}
            />
          );
        } catch {
          return <span>{cell.latex}</span>;
        }
      }

      // 3. Regular Text with formatting
      return (
        <span
          style={{
            fontSize,
            lineHeight: 1.5,
            color: '#E2E8F0',
            whiteSpace: 'normal',
            wordBreak: 'normal',
            overflowWrap: 'normal',
            textAlign: align,
            display: 'inline-block',
          }}
        >
          {cell.text}
        </span>
      );
    };

    if (tables.length === 0) return null;

    return (
      <div
        className="table-overlay-container"
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: 1920,
          height: 1080,
          pointerEvents: 'none',
          zIndex: 26,
        }}
      >
        {tables.map((tableItem) => {
          const layout: ComputedTableLayout = TableLayoutEngine.computeLayout(tableItem);
          const themeStyle = THEME_STYLES[layout.theme] || THEME_STYLES.cyan;

          return (
            <div
              key={layout.id}
              style={{
                position: 'absolute',
                left: layout.x,
                top: layout.y,
                width: layout.width,
                pointerEvents: 'auto',
                backgroundColor: 'rgba(15, 23, 42, 0.72)',
                backdropFilter: 'blur(8px)',
                borderRadius: 8,
                border: `1px solid ${themeStyle.borderColor}`,
                boxShadow: '0 4px 20px rgba(0, 0, 0, 0.35)',
                overflow: 'hidden',
                userSelect: 'text',
                fontFamily: 'Inter, system-ui, -apple-system, sans-serif',
                transition: 'border-color 0.2s ease',
              }}
            >
              {/* Whiteboard Table Title Header */}
              {layout.title && (
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '9px 16px 7px 16px',
                    borderBottom: `1px solid ${themeStyle.borderColor}`,
                    background: 'rgba(255, 255, 255, 0.02)',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span
                      style={{
                        width: 7,
                        height: 7,
                        borderRadius: '50%',
                        backgroundColor: themeStyle.accentColor,
                        boxShadow: `0 0 6px ${themeStyle.accentColor}`,
                      }}
                    />
                    <span
                      style={{
                        fontSize: 14,
                        fontWeight: 700,
                        color: themeStyle.accentColor,
                        letterSpacing: '0.04em',
                        textTransform: 'uppercase',
                        fontFamily: 'Inter, system-ui, -apple-system, sans-serif',
                      }}
                    >
                      {layout.title}
                    </span>
                  </div>

                  {/* Minimalist clear button */}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      removeTable(layout.id);
                    }}
                    title="Remove Table"
                    style={{
                      background: 'transparent',
                      border: 'none',
                      color: 'rgba(255, 255, 255, 0.25)',
                      fontSize: 13,
                      cursor: 'pointer',
                      padding: '2px 5px',
                      borderRadius: 4,
                      lineHeight: 1,
                      transition: 'color 0.15s ease',
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.color = '#EF4444')}
                    onMouseLeave={(e) => (e.currentTarget.style.color = 'rgba(255, 255, 255, 0.25)')}
                  >
                    ✕
                  </button>
                </div>
              )}

              {/* Table Element */}
              <table
                style={{
                  width: '100%',
                  borderCollapse: 'collapse',
                  tableLayout: 'fixed',
                }}
              >
                {/* Column Width Specifications */}
                <colgroup>
                  {layout.columns.map((col) => (
                    <col key={col.id} style={{ width: `${col.width}px` }} />
                  ))}
                </colgroup>

                {/* Table Header */}
                <thead>
                  <tr
                    style={{
                      background: themeStyle.headerBg,
                      borderBottom: `2px solid ${themeStyle.borderColor}`,
                    }}
                  >
                    {layout.columns.map((col, cIdx) => (
                      <th
                        key={col.id}
                        style={{
                          padding: '11px 14px',
                          textAlign: col.align,
                          color: col.color || themeStyle.headerTextColor,
                          fontSize: Math.max(13, layout.fontSize),
                          fontWeight: 700,
                          letterSpacing: '0.04em',
                          textTransform: 'uppercase',
                          whiteSpace: 'nowrap',
                          borderRight:
                            cIdx < layout.columns.length - 1
                              ? '1px solid rgba(255, 255, 255, 0.08)'
                              : 'none',
                        }}
                      >
                        {col.header}
                      </th>
                    ))}
                  </tr>
                </thead>

                {/* Table Body Rows */}
                <tbody>
                  {layout.rows.map((row, rIdx) => {
                    const isEven = rIdx % 2 === 0;
                    const isHighlighted = tableItem.highlightRowIndex === rIdx;

                    return (
                      <tr
                        key={row.id}
                        style={{
                          backgroundColor: isHighlighted
                            ? 'rgba(0, 229, 255, 0.12)'
                            : isEven
                            ? 'rgba(255, 255, 255, 0.015)'
                            : 'rgba(255, 255, 255, 0.045)',
                          borderBottom:
                            rIdx < layout.rows.length - 1
                              ? '1px solid rgba(255, 255, 255, 0.07)'
                              : 'none',
                          minHeight: row.height,
                          transition: 'background-color 0.15s ease',
                        }}
                      >
                        {row.cells.map((cell, cIdx) => {
                          const col = layout.columns[cIdx];
                          const align = col ? col.align : 'left';
                          const isColHighlighted = tableItem.highlightColumnIndex === cIdx;

                          return (
                            <td
                              key={`${row.id}_c${cIdx}`}
                              style={{
                                padding: '12px 14px',
                                textAlign: align,
                                verticalAlign: 'middle',
                                borderRight:
                                  cIdx < layout.columns.length - 1
                                    ? '1px solid rgba(255, 255, 255, 0.06)'
                                    : 'none',
                                backgroundColor: isColHighlighted
                                  ? 'rgba(0, 229, 255, 0.06)'
                                  : undefined,
                              }}
                            >
                              {renderCell(cell, layout.fontSize, align)}
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          );
        })}
      </div>
    );
  }
);
