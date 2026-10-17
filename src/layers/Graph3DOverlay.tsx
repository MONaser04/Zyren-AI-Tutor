/**
 * Graph3DOverlay — Layer for managing 3D Mathematical WebGL surfaces on the active slide.
 */

import React, { useState, forwardRef, useImperativeHandle, useCallback } from 'react';
import { ThreeGraph3DCard } from '../components/ThreeGraph3DCard';
import type { Graph3DOptions } from '../types';

export interface Graph3DItem {
  id: string;
  title?: string;
  options: Graph3DOptions;
  x: number;
  y: number;
  width?: number;
  height?: number;
}

export interface Graph3DOverlayHandle {
  addGraph3D(item: Omit<Graph3DItem, 'id'> & { id?: string }): string;
  removeGraph3D(id: string): void;
  clear(): void;
  getItemsCount(): number;
  setItems(items: Graph3DItem[]): void;
  getItems(): Graph3DItem[];
}

export interface Graph3DOverlayProps {
  onUpdatePosition?: (id: string, x: number, y: number) => void;
  onRemoveGraph3D?: (id: string) => void;
}

export const Graph3DOverlay = forwardRef<Graph3DOverlayHandle, Graph3DOverlayProps>(function Graph3DOverlay(
  { onUpdatePosition, onRemoveGraph3D },
  ref
) {
  const [graphs, setGraphs] = useState<Graph3DItem[]>([]);

  const addGraph3D = useCallback((item: Omit<Graph3DItem, 'id'> & { id?: string }): string => {
    const id = item.id || `graph3d-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const newGraph: Graph3DItem = {
      id,
      title: item.title,
      options: item.options || { plotType: 'surface' },
      x: item.x,
      y: item.y,
      width: item.width || 500,
      height: item.height || 420,
    };

    // Replace any existing 3D card at the same position to prevent overlapping stale graphs
    setGraphs((prev) => {
      const filtered = prev.filter((g) => Math.hypot(g.x - item.x, g.y - item.y) > 150 && g.id !== id);
      return [...filtered, newGraph];
    });
    return id;
  }, []);

  const removeGraph3D = useCallback((id: string) => {
    setGraphs((prev) => prev.filter((g) => g.id !== id));
    if (onRemoveGraph3D) onRemoveGraph3D(id);
  }, [onRemoveGraph3D]);

  const clear = useCallback(() => {
    setGraphs([]);
  }, []);

  const getItemsCount = useCallback(() => graphs.length, [graphs.length]);
  const setItems = useCallback((items: Graph3DItem[]) => setGraphs(items), []);
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
      addGraph3D,
      removeGraph3D,
      clear,
      getItemsCount,
      setItems,
      getItems,
    }),
    [addGraph3D, removeGraph3D, clear, getItemsCount, setItems, getItems]
  );

  return (
    <div
      className="graph-3d-overlay"
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        width: '100%',
        height: '100%',
        pointerEvents: 'none',
        zIndex: 25,
      }}
    >
      {graphs.map((graph) => (
        <ThreeGraph3DCard
          key={graph.id}
          id={graph.id}
          title={graph.title}
          options={graph.options}
          x={graph.x}
          y={graph.y}
          width={graph.width}
          height={graph.height}
          onRemove={removeGraph3D}
          onMove={handleCardMove}
        />
      ))}
    </div>
  );
});
