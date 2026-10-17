import React, { useState, useRef, useEffect } from 'react';

export interface FloatingVideoPiPProps {
  id: string;
  title: string;
  icon: string;
  stream: MediaStream | null;
  initialX?: number;
  initialY?: number;
  initialWidth?: number;
  initialHeight?: number;
  onClose: () => void;
}

export const FloatingVideoPiP: React.FC<FloatingVideoPiPProps> = ({
  title,
  icon,
  stream,
  initialX = 24,
  initialY = 80,
  initialWidth = 280,
  initialHeight = 180,
  onClose,
}) => {
  const [pos, setPos] = useState({ x: initialX, y: initialY });
  const [isMinimized, setIsMinimized] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const isDraggingRef = useRef(false);
  const dragStartRef = useRef({ mouseX: 0, mouseY: 0, startX: 0, startY: 0 });

  useEffect(() => {
    if (videoRef.current && stream) {
      videoRef.current.srcObject = stream;
      videoRef.current.play().catch((e) => console.warn('[FloatingPiP] play() failed:', e));
    }
  }, [stream]);

  const handlePointerDown = (e: React.PointerEvent) => {
    e.stopPropagation();
    if ((e.target as HTMLElement).closest('button')) return;
    isDraggingRef.current = true;
    dragStartRef.current = {
      mouseX: e.clientX,
      mouseY: e.clientY,
      startX: pos.x,
      startY: pos.y,
    };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!isDraggingRef.current) return;
    const dx = e.clientX - dragStartRef.current.mouseX;
    const dy = e.clientY - dragStartRef.current.mouseY;
    setPos({
      x: Math.max(10, Math.min(window.innerWidth - 120, dragStartRef.current.startX + dx)),
      y: Math.max(10, Math.min(window.innerHeight - 80, dragStartRef.current.startY + dy)),
    });
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    isDraggingRef.current = false;
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {}
  };

  return (
    <div
      className="floating-pip-container no-zoom interactive"
      style={{
        position: 'fixed',
        left: `${pos.x}px`,
        top: `${pos.y}px`,
        width: isMinimized ? 220 : initialWidth,
        zIndex: 55,
        backgroundColor: 'rgba(20, 20, 38, 0.94)',
        backdropFilter: 'blur(16px)',
        border: '1px solid rgba(78, 205, 196, 0.35)',
        borderRadius: 12,
        boxShadow: '0 8px 32px rgba(0, 0, 0, 0.6), 0 0 16px rgba(78, 205, 196, 0.15)',
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
        userSelect: 'none',
        transition: 'width 0.2s cubic-bezier(0.16, 1, 0.3, 1)',
        fontFamily: "'Inter', sans-serif",
      }}
      onPointerDown={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      onWheel={(e) => e.stopPropagation()}
      onTouchStart={(e) => e.stopPropagation()}
      onTouchMove={(e) => e.stopPropagation()}
    >
      {/* ── Draggable Header ── */}
      <div
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '7px 10px',
          backgroundColor: 'rgba(255, 255, 255, 0.05)',
          borderBottom: isMinimized ? 'none' : '1px solid rgba(255, 255, 255, 0.08)',
          cursor: 'grab',
          touchAction: 'none',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, overflow: 'hidden' }}>
          <span style={{ color: '#4ECDC4', fontSize: 13 }}>⠿</span>
          <span style={{ fontSize: 13 }}>{icon}</span>
          <span
            style={{
              color: '#FFFFFF',
              fontSize: 12,
              fontWeight: 600,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              maxWidth: 130,
            }}
          >
            {title}
          </span>
          <span
            style={{
              width: 7,
              height: 7,
              borderRadius: '50%',
              backgroundColor: '#A8FF78',
              boxShadow: '0 0 8px #A8FF78',
              flexShrink: 0,
            }}
          />
        </div>

        {/* Action Controls */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          {/* Minimize / Expand */}
          <button
            onClick={() => setIsMinimized(!isMinimized)}
            title={isMinimized ? 'Expand' : 'Minimize'}
            style={{
              background: 'transparent',
              border: 'none',
              color: '#aaa',
              fontSize: 12,
              cursor: 'pointer',
              padding: '2px 4px',
              borderRadius: 4,
              lineHeight: 1,
            }}
            onMouseEnter={(e) => (e.currentTarget.style.color = '#fff')}
            onMouseLeave={(e) => (e.currentTarget.style.color = '#aaa')}
          >
            {isMinimized ? '🗖' : '🗕'}
          </button>

          {/* Close */}
          <button
            onClick={onClose}
            title="Close Feed"
            style={{
              background: 'transparent',
              border: 'none',
              color: '#888',
              fontSize: 12,
              cursor: 'pointer',
              padding: '2px 4px',
              borderRadius: 4,
              lineHeight: 1,
            }}
            onMouseEnter={(e) => (e.currentTarget.style.color = '#ff6b6b')}
            onMouseLeave={(e) => (e.currentTarget.style.color = '#888')}
          >
            ✕
          </button>
        </div>
      </div>

      {/* ── Live Video Viewport ── */}
      {!isMinimized && (
        <div
          style={{
            position: 'relative',
            width: '100%',
            height: initialHeight,
            backgroundColor: '#0a0a14',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            style={{
              width: '100%',
              height: '100%',
              objectFit: 'contain',
              display: 'block',
            }}
          />
        </div>
      )}
    </div>
  );
};
