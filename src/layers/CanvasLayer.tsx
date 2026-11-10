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
  zoom?: number;
  backgroundColor?: string;
}

export const CanvasLayer = forwardRef<CanvasLayerHandle, CanvasLayerProps>(
  function CanvasLayer({ width, height, zoom = 1, backgroundColor = '#1a1a2e' }, ref) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const adapterRef = useRef<RoughJsAdapter | null>(null);
    const lastAppliedZoomRef = useRef<number>(zoom);
    const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);

    const applyResize = useCallback((w: number, h: number, z: number) => {
      if (!adapterRef.current && canvasRef.current) {
        adapterRef.current = new RoughJsAdapter(canvasRef.current);
      }
      if (adapterRef.current) {
        adapterRef.current.resize(w, h, z);
        lastAppliedZoomRef.current = z;
      }
    }, []);

    useEffect(() => {
      const canvas = canvasRef.current;
      if (!canvas) return;

      if (!adapterRef.current) {
        adapterRef.current = new RoughJsAdapter(canvas);
        applyResize(width, height, zoom);
        return;
      }

      // If zoom changed significantly (step jump > 0.25) or width/height changed, apply immediately
      const zoomDiff = Math.abs(zoom - lastAppliedZoomRef.current);
      if (zoomDiff >= 0.25) {
        if (debounceTimerRef.current) {
          clearTimeout(debounceTimerRef.current);
          debounceTimerRef.current = null;
        }
        applyResize(width, height, zoom);
      } else {
        // Debounce continuous smooth gestures (wheel / trackpad pinch) to keep 60 FPS
        if (debounceTimerRef.current) {
          clearTimeout(debounceTimerRef.current);
        }
        debounceTimerRef.current = setTimeout(() => {
          applyResize(width, height, zoom);
          debounceTimerRef.current = null;
        }, 80);
      }

      return () => {
        if (debounceTimerRef.current) {
          clearTimeout(debounceTimerRef.current);
          debounceTimerRef.current = null;
        }
      };
    }, [width, height, zoom, applyResize]);

    const getAdapter = useCallback((): ICanvasAdapter => {
      if (!adapterRef.current) {
        const canvas = canvasRef.current;
        if (!canvas) {
          throw new Error('[CanvasLayer] Canvas element not available');
        }
        adapterRef.current = new RoughJsAdapter(canvas);
        adapterRef.current.resize(width, height, zoom);
      }
      return adapterRef.current;
    }, [width, height, zoom]);

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