/**
 * MathOverlay — High-precision mathematical formula renderer using KaTeX.
 *
 * Sits as an overlay inside the virtual whiteboard container (1920x1080).
 * Scales and pans synchronously with the Whiteboard viewport.
 * Renders LaTeX formulas into clean, high-performance typography.
 */
import React, { useState, forwardRef, useImperativeHandle, useCallback } from 'react';
import katex from 'katex';

export interface MathItem {
  id: string;
  latex: string;
  x: number;
  y: number;
  fontSize?: number;
  color?: string;
  displayMode?: boolean;
}

export interface MathOverlayHandle {
  addMath(item: Omit<MathItem, 'id'> & { id?: string }): string;
  removeMath(id: string): void;
  clear(): void;
  getItemsCount(): number;
  setItems(items: MathItem[]): void;
  getItems(): MathItem[];
}

interface MathOverlayProps {
  defaultColor?: string;
}

export const MathOverlay = forwardRef<MathOverlayHandle, MathOverlayProps>(
  function MathOverlay({ defaultColor = '#FFFFFF' }, ref) {
    const [mathItems, setMathItems] = useState<MathItem[]>([]);

    const addMath = useCallback(
      (item: Omit<MathItem, 'id'> & { id?: string }): string => {
        const id = item.id || `math-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        const newItem: MathItem = {
          id,
          latex: item.latex,
          x: item.x,
          y: item.y,
          fontSize: item.fontSize ?? 30,
          color: item.color || defaultColor,
          displayMode: item.displayMode !== false,
        };

        setMathItems((prev) => [...prev, newItem]);
        return id;
      },
      [defaultColor]
    );

    const removeMath = useCallback((id: string) => {
      setMathItems((prev) => prev.filter((item) => item.id !== id));
    }, []);

    const clear = useCallback(() => {
      setMathItems([]);
    }, []);

    const getItemsCount = useCallback(() => mathItems.length, [mathItems.length]);
    const setItems = useCallback((items: MathItem[]) => setMathItems(items), []);
    const getItems = useCallback(() => mathItems, [mathItems]);

    useImperativeHandle(
      ref,
      () => ({
        addMath,
        removeMath,
        clear,
        getItemsCount,
        setItems,
        getItems,
      }),
      [addMath, removeMath, clear, getItemsCount, setItems, getItems]
    );

    return (
      <div
        className="math-overlay"
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: '100%',
          height: '100%',
          pointerEvents: 'none',
          zIndex: 12,
        }}
      >
        {mathItems.map((item) => {
          let html = '';
          try {
            html = katex.renderToString(item.latex, {
              displayMode: item.displayMode,
              throwOnError: false,
            });
          } catch {
            html = `<span style="color: ${item.color}">${item.latex}</span>`;
          }

          return (
            <div
              key={item.id}
              className="math-item-container"
              style={{
                position: 'absolute',
                left: `${item.x}px`,
                top: `${item.y}px`,
                maxWidth: `${Math.max(300, 1860 - item.x)}px`,
                color: item.color || defaultColor,
                fontSize: `${item.fontSize || 30}px`,
                lineHeight: 1.25,
                whiteSpace: 'normal',
                overflowWrap: 'break-word',
                display: 'inline-block',
                userSelect: 'none',
                filter: 'drop-shadow(0 2px 8px rgba(0,0,0,0.3))',
              }}
              dangerouslySetInnerHTML={{ __html: html }}
            />
          );
        })}
      </div>
    );
  }
);
