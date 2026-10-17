/**
 * CanvasLayer — React component wrapping the Rough.js Canvas adapter.
 *
 * This is the bottom rendering layer in the Two-Layer UI architecture.
 * It renders structural diagrams (rectangles, arrows, etc.) with a
 * hand-drawn style using Rough.js.
 *
 * The component manages:
 * - Canvas element lifecycle and HiDPI scaling
 * - RoughJsAdapter initialization and exposure via imperative handle
 * - Window resize handling with content preservation
 */
import React, { useRef, useEffect, useImperativeHandle, forwardRef, useCallback } from 'react';
import { RoughJsAdapter } from '../adapters/canvas/RoughJsAdapter';
import type { ICanvasAdapter } from '../adapters/canvas/ICanvasAdapter';

export interface CanvasLayerHandle {
  getAdapter(): ICanvasAdapter;
  getCanvas(): HTMLCanvasElement | null;
}

interface CanvasLayerProps {
  width: number;
  height: number;
  backgroundColor?: string;
}

export const CanvasLayer = forwardRef<CanvasLayerHandle, CanvasLayerProps>(
  function CanvasLayer({ width, height, backgroundColor = '#1a1a2e' }, ref) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const adapterRef = useRef<RoughJsAdapter | null>(null);

    useEffect(() => {
      const canvas = canvasRef.current;
      if (!canvas) return;

      if (!adapterRef.current) {
        adapterRef.current = new RoughJsAdapter(canvas);
      }
      adapterRef.current.resize(width, height);
    }, [width, height]);

    const getAdapter = useCallback((): ICanvasAdapter => {
      if (!adapterRef.current) {
        const canvas = canvasRef.current;
        if (!canvas) {
          throw new Error('[CanvasLayer] Canvas element not available');
        }
        adapterRef.current = new RoughJsAdapter(canvas);
        adapterRef.current.resize(width, height);
      }
      return adapterRef.current;
    }, [width, height]);

    const getCanvas = useCallback((): HTMLCanvasElement | null => {
      return canvasRef.current;
    }, []);

    useImperativeHandle(ref, () => ({ getAdapter, getCanvas }), [getAdapter, getCanvas]);

    return (
      <canvas
        ref={canvasRef}
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: '100%',
          height: '100%',
          backgroundColor,
          zIndex: 1,
        }}
      />
    );
  }
);