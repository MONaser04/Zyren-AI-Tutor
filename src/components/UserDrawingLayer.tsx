import React, { useRef, useState, useEffect } from 'react';
import type { UserDrawingPath, UserDrawingText } from './SlidePanel';

interface UserDrawingLayerProps {
  mode: 'pointer' | 'pen' | 'text' | 'eraser';
  zoom: number;
  paths: UserDrawingPath[];
  texts: UserDrawingText[];
  onPathsChange: (paths: UserDrawingPath[]) => void;
  onTextsChange: (texts: UserDrawingText[]) => void;
  width: number;
  height: number;
}

export function UserDrawingLayer({
  mode,
  zoom,
  paths,
  texts,
  onPathsChange,
  onTextsChange,
  width,
  height,
}: UserDrawingLayerProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  
  // Pen state
  const [isDrawing, setIsDrawing] = useState(false);
  const [currentPath, setCurrentPath] = useState<Point[]>([]);

  // Text state
  const [textInput, setTextInput] = useState<{ x: number; y: number; value: string } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  interface Point {
    x: number;
    y: number;
  }

  // Focus input when it appears
  useEffect(() => {
    if (textInput && inputRef.current) {
      inputRef.current.focus();
    }
  }, [textInput]);

  const getVirtualCoords = (e: React.PointerEvent<SVGSVGElement> | React.MouseEvent<SVGSVGElement>): Point => {
    if (!svgRef.current) return { x: 0, y: 0 };
    const rect = svgRef.current.getBoundingClientRect();
    const x = (e.clientX - rect.left) / zoom;
    const y = (e.clientY - rect.top) / zoom;
    return { x, y };
  };

  const handlePointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    if (mode === 'pointer') return;
    
    // Disable default behavior like scrolling
    e.preventDefault();
    e.stopPropagation();

    const pt = getVirtualCoords(e);

    if (mode === 'text') {
      if (textInput) {
        // Commit previous text
        commitText();
      }
      setTextInput({ x: pt.x, y: pt.y, value: '' });
      return;
    }

    if (mode === 'pen' || mode === 'eraser') {
      if (textInput) commitText(); // commit any active text just in case
      setIsDrawing(true);
      if (mode === 'pen') {
        setCurrentPath([pt]);
      }
      (e.target as Element).setPointerCapture(e.pointerId);
      
      // If we just clicked an element to erase it
      if (mode === 'eraser') {
        const el = document.elementFromPoint(e.clientX, e.clientY);
        if (el && el.hasAttribute('data-id')) {
          const id = el.getAttribute('data-id');
          if (id) {
            if (id.startsWith('path-')) {
              onPathsChange(paths.filter(p => p.id !== id));
            } else if (id.startsWith('text-')) {
              onTextsChange(texts.filter(t => t.id !== id));
            }
          }
        }
      }
    }
  };

  const handlePointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (mode === 'eraser' && isDrawing) {
      e.preventDefault();
      e.stopPropagation();
      const el = document.elementFromPoint(e.clientX, e.clientY);
      if (el && el.hasAttribute('data-id')) {
        const id = el.getAttribute('data-id');
        if (id) {
          if (id.startsWith('path-')) {
            onPathsChange(paths.filter(p => p.id !== id));
          } else if (id.startsWith('text-')) {
            onTextsChange(texts.filter(t => t.id !== id));
          }
        }
      }
      return;
    }

    if (!isDrawing || mode !== 'pen') return;
    e.preventDefault();
    e.stopPropagation();
    const pt = getVirtualCoords(e);
    setCurrentPath((prev) => [...prev, pt]);
  };

  const handlePointerUp = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!isDrawing || (mode !== 'pen' && mode !== 'eraser')) return;
    e.preventDefault();
    e.stopPropagation();
    setIsDrawing(false);

    if (currentPath.length > 1) {
      // Create SVG path string
      const d = currentPath.map((p, i) => (i === 0 ? `M ${p.x} ${p.y}` : `L ${p.x} ${p.y}`)).join(' ');
      const newPath: UserDrawingPath = {
        id: `path-${Date.now()}`,
        d,
        color: '#4ECDC4', // Default cyan color
        strokeWidth: 3,
      };
      onPathsChange([...paths, newPath]);
    }
    setCurrentPath([]);
  };

  const commitText = () => {
    if (textInput && textInput.value.trim() !== '') {
      const newText: UserDrawingText = {
        id: `text-${Date.now()}`,
        x: textInput.x,
        y: textInput.y,
        text: textInput.value,
        color: '#FFFFFF',
        fontSize: 24,
      };
      onTextsChange([...texts, newText]);
    }
    setTextInput(null);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      commitText();
    } else if (e.key === 'Escape') {
      setTextInput(null); // Cancel
    }
  };

  // Generate the current drawing path
  const currentPathString = currentPath.length > 0 
    ? currentPath.map((p, i) => (i === 0 ? `M ${p.x} ${p.y}` : `L ${p.x} ${p.y}`)).join(' ') 
    : '';

  return (
    <div
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        width: '100%',
        height: '100%',
        pointerEvents: mode === 'pointer' ? 'none' : 'auto',
        zIndex: 50, // Above canvas/overlays, below UI
      }}
    >
      <svg
        ref={svgRef}
        className="drawing-layer"
        width="100%"
        height="100%"
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: '100%',
          height: '100%',
          cursor: mode === 'pen' ? 'crosshair' : mode === 'text' ? 'text' : mode === 'eraser' ? 'url("data:image/svg+xml;utf8,<svg xmlns=\'http://www.w3.org/2000/svg\' width=\'24\' height=\'24\' viewBox=\'0 0 24 24\' fill=\'none\' stroke=\'white\' stroke-width=\'2\'><rect x=\'3\' y=\'3\' width=\'18\' height=\'18\' rx=\'4\'/></svg>") 12 12, crosshair' : 'default',
          touchAction: mode !== 'pointer' ? 'none' : 'auto', // Prevent scrolling when drawing on touch devices
        }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerLeave={handlePointerUp}
      >
        <g>
          {/* Render committed paths */}
          {paths.map((p) => (
            <path
              key={p.id}
              data-id={p.id}
              d={p.d}
              stroke={p.color}
              strokeWidth={p.strokeWidth}
              fill="none"
              strokeLinecap="round"
              strokeLinejoin="round"
              style={{ pointerEvents: mode === 'eraser' ? 'stroke' : 'none' }}
            />
          ))}

          {/* Render current drawing path */}
          {currentPathString && (
            <path
              d={currentPathString}
              stroke="#4ECDC4"
              strokeWidth={3}
              fill="none"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          )}

          {/* Render committed texts */}
          {texts.map((t) => (
            <text
              key={t.id}
              data-id={t.id}
              x={t.x}
              y={t.y}
              fill={t.color}
              fontSize={t.fontSize}
              fontFamily="'Inter', sans-serif"
              alignmentBaseline="middle"
              style={{ pointerEvents: mode === 'eraser' ? 'all' : 'none' }}
            >
              {t.text}
            </text>
          ))}
        </g>
      </svg>

      {/* Render text input overlay */}
      {textInput && (
        <input
          ref={inputRef}
          type="text"
          value={textInput.value}
          onChange={(e) => setTextInput({ ...textInput, value: e.target.value })}
          onBlur={commitText}
          onKeyDown={handleKeyDown}
          style={{
            position: 'absolute',
            left: textInput.x,
            top: textInput.y,
            transform: 'translateY(-50%)', // Center alignment to match svg text alignmentBaseline="middle"
            fontSize: 24,
            fontFamily: "'Inter', sans-serif",
            color: '#FFFFFF',
            background: 'rgba(0,0,0,0.5)',
            border: '1px solid #4ECDC4',
            outline: 'none',
            padding: '2px 4px',
            minWidth: 100,
            pointerEvents: 'auto',
          }}
        />
      )}
    </div>
  );
}
