/**
 * SlidePanel — Collapsible Slide Deck & Multi-Board History Manager.
 *
 * Provides a PowerPoint-like slide navigation panel on the right side:
 * - Vertical list of whiteboard slides with preview cards and metadata.
 * - Single-click switching between previous and current boards.
 * - "+ New Board" button to add a fresh blank slide.
 * - Smooth collapse / expand drawer animation with a floating trigger pill.
 */
import React, { useState } from 'react';
import type { HandwritingPayload } from '../types';

export interface UserDrawingPath { id: string; d: string; color: string; strokeWidth: number; }
export interface UserDrawingText { id: string; x: number; y: number; text: string; color: string; fontSize: number; }

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
      {/* Slide Deck Sidebar Drawer */}
      <div
        className="slide-panel-drawer no-zoom"
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
          width: 300,
          backgroundColor: 'rgba(15, 15, 28, 0.94)',
          backdropFilter: 'blur(20px)',
          borderLeft: '1px solid rgba(255, 255, 255, 0.1)',
          boxShadow: '-8px 0 32px rgba(0, 0, 0, 0.5)',
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
            padding: '18px 20px',
            borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 18 }}>📑</span>
            <div>
              <div style={{ color: '#FFFFFF', fontWeight: 600, fontSize: 15 }}>Whiteboard Slides</div>
              <div style={{ color: '#888', fontSize: 12 }}>{pages.length} {pages.length === 1 ? 'board' : 'boards'} in session</div>
            </div>
          </div>

          <button
            onClick={onToggleOpen}
            title="Close Slides Panel"
            style={{
              background: 'none',
              border: 'none',
              color: '#888',
              fontSize: 18,
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

        {/* Scrollable Slide List */}
        <div
          className="slide-list no-zoom interactive"
          onWheel={(e) => e.stopPropagation()}
          onTouchStart={(e) => e.stopPropagation()}
          onTouchMove={(e) => e.stopPropagation()}
          style={{
            flex: 1,
            overflowY: 'auto',
            overscrollBehavior: 'contain',
            padding: '16px',
            display: 'flex',
            flexDirection: 'column',
            gap: 12,
          }}
        >
          {pages.map((page, index) => {
            const isActive = index === activePageIndex;
            const mathCount = page.shapes.filter((s) => s.shapeType === 'math').length;
            const diagramCount = page.shapes.filter((s) => s.shapeType !== 'math' && s.shapeType !== 'text').length;
            const textCount = page.shapes.filter((s) => s.shapeType === 'text').length + page.handwriting.length;

            return (
              <div
                key={page.id}
                onClick={() => onSelectPage(index)}
                style={{
                  padding: '12px 14px',
                  borderRadius: 10,
                  backgroundColor: isActive ? 'rgba(78, 205, 196, 0.12)' : 'rgba(255, 255, 255, 0.03)',
                  border: isActive ? '1.5px solid #4ECDC4' : '1px solid rgba(255, 255, 255, 0.08)',
                  cursor: 'pointer',
                  position: 'relative',
                  transition: 'all 0.18s ease',
                  boxShadow: isActive ? '0 4px 16px rgba(78, 205, 196, 0.15)' : 'none',
                }}
                onMouseEnter={(e) => {
                  if (!isActive) {
                    e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.07)';
                    e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.2)';
                  }
                }}
                onMouseLeave={(e) => {
                  if (!isActive) {
                    e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.03)';
                    e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.08)';
                  }
                }}
              >
                {/* Slide Card Header */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span
                      style={{
                        padding: '2px 7px',
                        borderRadius: 4,
                        fontSize: 11,
                        fontWeight: 700,
                        backgroundColor: isActive ? '#4ECDC4' : 'rgba(255, 255, 255, 0.1)',
                        color: isActive ? '#1a1a2e' : '#aaa',
                      }}
                    >
                      Slide {page.pageNumber}
                    </span>
                    {isActive && (
                      <span
                        style={{
                          fontSize: 10,
                          fontWeight: 600,
                          color: '#4ECDC4',
                          display: 'flex',
                          alignItems: 'center',
                          gap: 4,
                        }}
                      >
                        ● Active
                      </span>
                    )}
                  </div>

                  {pages.length > 1 && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onDeletePage(index);
                      }}
                      title="Delete Slide"
                      style={{
                        background: 'none',
                        border: 'none',
                        color: '#666',
                        fontSize: 13,
                        cursor: 'pointer',
                        padding: '3px 6px',
                        borderRadius: 4,
                        transition: 'color 0.15s, background-color 0.15s',
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.color = '#FF6B6B';
                        e.currentTarget.style.backgroundColor = 'rgba(255, 107, 107, 0.15)';
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.color = '#666';
                        e.currentTarget.style.backgroundColor = 'transparent';
                      }}
                    >
                      🗑️
                    </button>
                  )}
                </div>

                {/* Slide Title / Summary (Click or pencil icon to rename) */}
                {editingIndex === index ? (
                  <div
                    style={{ marginBottom: 6 }}
                    onClick={(e) => e.stopPropagation()}
                  >
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
                        backgroundColor: 'rgba(0, 0, 0, 0.6)',
                        color: '#4ECDC4',
                        border: '1px solid #4ECDC4',
                        borderRadius: 4,
                        padding: '4px 8px',
                        fontSize: 12,
                        fontWeight: 600,
                        outline: 'none',
                        fontFamily: "'Inter', sans-serif",
                        boxSizing: 'border-box',
                      }}
                    />
                  </div>
                ) : (
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      marginBottom: 6,
                    }}
                    title="Click pencil to rename slide"
                  >
                    <div
                      style={{
                        color: '#e0e0e0',
                        fontSize: 13,
                        fontWeight: 500,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                        flex: 1,
                        marginRight: 6,
                      }}
                      onDoubleClick={(e) => startRename(index, page.title, e)}
                    >
                      {page.title || `Whiteboard Step #${page.pageNumber}`}
                    </div>
                    <button
                      onClick={(e) => startRename(index, page.title, e)}
                      title="Rename slide"
                      style={{
                        background: 'transparent',
                        border: 'none',
                        color: '#777',
                        fontSize: 12,
                        cursor: 'pointer',
                        padding: '2px 4px',
                        borderRadius: 4,
                        transition: 'color 0.15s',
                      }}
                      onMouseEnter={(e) => (e.currentTarget.style.color = '#4ECDC4')}
                      onMouseLeave={(e) => (e.currentTarget.style.color = '#777')}
                    >
                      ✎
                    </button>
                  </div>
                )}

                {/* Content Metadata Pills */}
                <div style={{ display: 'flex', gap: 6, fontSize: 11, color: '#777' }}>
                  <span>∑ {mathCount} math</span>
                  <span>•</span>
                  <span>📐 {diagramCount} shapes</span>
                  <span>•</span>
                  <span>✏️ {textCount} notes</span>
                </div>
              </div>
            );
          })}
        </div>

        {/* Bottom Actions */}
        <div
          style={{
            padding: '16px 20px',
            borderTop: '1px solid rgba(255, 255, 255, 0.08)',
            display: 'flex',
            flexDirection: 'column',
            gap: 10,
          }}
        >
          <button
            onClick={onAddNewPage}
            style={{
              padding: '11px 16px',
              backgroundColor: '#4ECDC4',
              color: '#1a1a2e',
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
            <span>New Whiteboard Slide</span>
          </button>
        </div>
      </div>
    </>
  );
}
