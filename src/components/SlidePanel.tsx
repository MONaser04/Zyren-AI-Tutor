/**
 * SlidePanel — PowerPoint-Style Visual Slide Sorter & Live Thumbnail Strip.
 *
 * Displays authentic 16:9 miniature previews of every whiteboard slide stacked
 * vertically with left-side slide numbering, live active-slide updates, inline
 * title renaming, quick deletion, and single-click slide navigation.
 */
import React, { useState } from 'react';
import type { HandwritingPayload } from '../types';
import { SlideThumbnail } from './SlideThumbnail';

export interface UserDrawingPath {
  id: string;
  d: string;
  color: string;
  strokeWidth: number;
}

export interface UserDrawingText {
  id: string;
  x: number;
  y: number;
  text: string;
  color: string;
  fontSize: number;
}

export interface WhiteboardPage {
  id: string;
  pageNumber: number;
  title: string;
  shapes: any[];
  handwriting: HandwritingPayload[];
  userPaths?: UserDrawingPath[];
  userTexts?: UserDrawingText[];
  createdAt: number;
}

interface SlidePanelProps {
  pages: WhiteboardPage[];
  activePageIndex: number;
  isOpen: boolean;
  onToggleOpen: () => void;
  onSelectPage: (index: number) => void;
  onAddNewPage: () => void;
  onDeletePage: (index: number) => void;
  onRenamePage?: (index: number, newTitle: string) => void;
}

export function SlidePanel({
  pages,
  activePageIndex,
  isOpen,
  onToggleOpen,
  onSelectPage,
  onAddNewPage,
  onDeletePage,
  onRenamePage,
}: SlidePanelProps) {
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editTitle, setEditTitle] = useState<string>('');
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

  const startRename = (index: number, currentTitle: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingIndex(index);
    setEditTitle(currentTitle || `Slide ${index + 1}`);
  };

  const handleRenameSubmit = (index: number) => {
    if (editingIndex === null) return;
    const finalTitle = editTitle.trim() || `Slide ${index + 1}`;
    if (onRenamePage) {
      onRenamePage(index, finalTitle);
    }
    setEditingIndex(null);
  };

  return (
    <>
      <div
        className="slide-panel-drawer slide-panel no-zoom"
        onPointerDown={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}
        onWheel={(e) => e.stopPropagation()}
        onTouchStart={(e) => e.stopPropagation()}
        onTouchMove={(e) => e.stopPropagation()}
        style={{
          position: 'fixed',
          top: 0,
          right: 0,
          bottom: 0,
          width: 316,
          backgroundColor: 'rgba(15, 15, 28, 0.96)',
          backdropFilter: 'blur(22px)',
          borderLeft: '1px solid rgba(255, 255, 255, 0.1)',
          boxShadow: '-8px 0 32px rgba(0, 0, 0, 0.55)',
          zIndex: 50,
          display: 'flex',
          flexDirection: 'column',
          transform: isOpen ? 'translateX(0)' : 'translateX(100%)',
          transition: 'transform 0.25s cubic-bezier(0.16, 1, 0.3, 1)',
          fontFamily: "'Inter', sans-serif",
          pointerEvents: isOpen ? 'auto' : 'none',
        }}
      >
        {/* Drawer Header */}
        <div
          className="slide-panel-header no-zoom"
          onWheel={(e) => e.stopPropagation()}
          style={{
            padding: '15px 18px',
            borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 18 }}>📑</span>
            <div>
              <div style={{ color: '#FFFFFF', fontWeight: 700, fontSize: 14.5 }}>Slides Navigator</div>
              <div style={{ color: '#8890A6', fontSize: 11.5 }}>
                {pages.length} {pages.length === 1 ? 'slide' : 'slides'} • Live Preview
              </div>
            </div>
          </div>

          <button
            onClick={onToggleOpen}
            title="Close Slides Panel"
            style={{
              background: 'none',
              border: 'none',
              color: '#888',
              fontSize: 17,
              cursor: 'pointer',
              padding: '6px 8px',
              borderRadius: 6,
              lineHeight: 1,
              transition: 'color 0.15s, background-color 0.15s',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.color = '#FFF';
              e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.1)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.color = '#888';
              e.currentTarget.style.backgroundColor = 'transparent';
            }}
          >
            ✕
          </button>
        </div>

        {/* PowerPoint-Style Vertical Thumbnail Strip */}
        <div
          className="slide-list no-zoom interactive"
          onWheel={(e) => e.stopPropagation()}
          onTouchStart={(e) => e.stopPropagation()}
          onTouchMove={(e) => e.stopPropagation()}
          style={{
            flex: 1,
            overflowY: 'auto',
            overscrollBehavior: 'contain',
            padding: '14px 14px 18px 10px',
            display: 'flex',
            flexDirection: 'column',
            gap: 14,
          }}
        >
          {pages.map((page, index) => {
            const isActive = index === activePageIndex;
            const isHovered = hoveredIndex === index;

            return (
              <div
                key={page.id}
                className="slide-card"
                onClick={() => onSelectPage(index)}
                onMouseEnter={() => setHoveredIndex(index)}
                onMouseLeave={() => setHoveredIndex((prev) => (prev === index ? null : prev))}
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: 8,
                  padding: '6px 8px 6px 4px',
                  borderRadius: 10,
                  backgroundColor: isActive
                    ? 'rgba(78, 205, 196, 0.1)'
                    : isHovered
                    ? 'rgba(255, 255, 255, 0.045)'
                    : 'transparent',
                  cursor: 'pointer',
                  transition: 'background-color 0.15s ease',
                }}
              >
                {/* PowerPoint Left Slide Number Gutter */}
                <div
                  style={{
                    width: 22,
                    paddingTop: 4,
                    textAlign: 'right',
                    fontSize: 12,
                    fontWeight: isActive ? 800 : 600,
                    color: isActive ? '#4ECDC4' : '#7E869E',
                    fontVariantNumeric: 'tabular-nums',
                    flexShrink: 0,
                    userSelect: 'none',
                  }}
                >
                  {page.pageNumber || index + 1}
                </div>

                {/* Right Column: 16:9 Live Visual Thumbnail + Caption */}
                <div style={{ flex: 1, minWidth: 0, position: 'relative' }}>
                  <div style={{ position: 'relative' }}>
                    <SlideThumbnail page={page} isActive={isActive} />

                    {/* Floating Quick Action Buttons on Hover / Active */}
                    {(isHovered || isActive) && (
                      <div
                        style={{
                          position: 'absolute',
                          top: 6,
                          right: 6,
                          display: 'flex',
                          gap: 4,
                          zIndex: 4,
                        }}
                      >
                        <button
                          type="button"
                          onClick={(e) => startRename(index, page.title, e)}
                          title="Rename slide"
                          style={{
                            width: 24,
                            height: 24,
                            borderRadius: 5,
                            border: '1px solid rgba(255, 255, 255, 0.18)',
                            backgroundColor: 'rgba(15, 16, 30, 0.85)',
                            color: '#CBD5E1',
                            fontSize: 11,
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            padding: 0,
                          }}
                        >
                          ✎
                        </button>

                        {pages.length > 1 && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              onDeletePage(index);
                            }}
                            title="Delete slide"
                            style={{
                              width: 24,
                              height: 24,
                              borderRadius: 5,
                              border: '1px solid rgba(255, 107, 107, 0.35)',
                              backgroundColor: 'rgba(20, 12, 20, 0.88)',
                              color: '#FF6B6B',
                              fontSize: 11,
                              cursor: 'pointer',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              padding: 0,
                            }}
                          >
                            🗑️
                          </button>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Compact Editable Slide Caption Underneath Preview */}
                  {editingIndex === index ? (
                    <div style={{ marginTop: 6 }} onClick={(e) => e.stopPropagation()}>
                      <input
                        type="text"
                        value={editTitle}
                        onChange={(e) => setEditTitle(e.target.value)}
                        onBlur={() => handleRenameSubmit(index)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') handleRenameSubmit(index);
                          if (e.key === 'Escape') setEditingIndex(null);
                        }}
                        autoFocus
                        style={{
                          width: '100%',
                          backgroundColor: 'rgba(0, 0, 0, 0.65)',
                          color: '#4ECDC4',
                          border: '1px solid #4ECDC4',
                          borderRadius: 5,
                          padding: '3px 7px',
                          fontSize: 11.5,
                          fontWeight: 600,
                          outline: 'none',
                          fontFamily: "'Inter', sans-serif",
                          boxSizing: 'border-box',
                        }}
                      />
                    </div>
                  ) : (
                    <div
                      onDoubleClick={(e) => startRename(index, page.title, e)}
                      title={`${page.title || `Slide ${page.pageNumber}`} (Double-click to rename)`}
                      style={{
                        marginTop: 5,
                        fontSize: 11.5,
                        fontWeight: isActive ? 700 : 500,
                        color: isActive ? '#E2E8F0' : '#94A3B8',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                        padding: '0 2px',
                      }}
                    >
                      {page.title || `Slide ${page.pageNumber || index + 1}`}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* Bottom "+ New Whiteboard Slide" Button */}
        <div
          style={{
            padding: '14px 16px',
            borderTop: '1px solid rgba(255, 255, 255, 0.08)',
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          <button
            onClick={onAddNewPage}
            style={{
              padding: '10px 14px',
              backgroundColor: '#4ECDC4',
              color: '#131528',
              border: 'none',
              borderRadius: 8,
              fontWeight: 700,
              fontSize: 13,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
              boxShadow: '0 4px 14px rgba(78, 205, 196, 0.25)',
              transition: 'background-color 0.15s, transform 0.15s',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = '#38b2ac';
              e.currentTarget.style.transform = 'translateY(-1px)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = '#4ECDC4';
              e.currentTarget.style.transform = 'translateY(0)';
            }}
          >
            <span style={{ fontSize: 16, lineHeight: 1 }}>+</span>
            <span>New Slide</span>
          </button>
        </div>
      </div>
    </>
  );
}
