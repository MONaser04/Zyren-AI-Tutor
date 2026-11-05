import React, { useState, useEffect, useRef } from 'react';
import type { WhiteboardPage } from './SlidePanel';
import type { ChatMessage } from './ChatDrawer';

export interface RecentSession {
  id: string;
  name: string;
  timestamp: number;
  slideCount: number;
  messageCount?: number;
  data?: {
    id?: string;
    title: string;
    activePageIndex: number;
    pages: WhiteboardPage[];
    chatMessages?: ChatMessage[];
  };
}

interface FileMenuProps {
  currentTitle: string;
  onUpdateTitle: (title: string) => void;
  pages: WhiteboardPage[];
  activePageIndex: number;
  onNewFile: () => void;
  onSave: () => void;
  onSaveAs: () => void;
  onOpenPicker: () => void;
  onOpenFile: (data: {
    id?: string;
    title?: string;
    pages: WhiteboardPage[];
    activePageIndex?: number;
    chatMessages?: ChatMessage[];
  }) => void;
  onExportPNG: () => void;
  onExportPDF: () => void;
  onClearSlide: () => void;
  recentSessions: RecentSession[];
  activeSessionId?: string;
  onLoadRecent: (session: RecentSession) => void;
  onDeleteRecent: (id: string) => void;
  onOpenVoiceModal?: () => void;
  onOpenApiKeyModal?: () => void;
  autoSaveState?: 'idle' | 'saving' | 'saved' | 'error';
  lastAutoSavedAt?: number | null;
}

export const FileMenu: React.FC<FileMenuProps> = ({
  currentTitle,
  onUpdateTitle,
  onNewFile,
  onSave,
  onSaveAs,
  onOpenPicker,
  onOpenFile,
  onExportPNG,
  onExportPDF,
  recentSessions,
  activeSessionId,
  onLoadRecent,
  onDeleteRecent,
  onOpenApiKeyModal,
  autoSaveState = 'saved',
  lastAutoSavedAt,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [isRecentSubmenuOpen, setIsRecentSubmenuOpen] = useState(false);
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [titleInput, setTitleInput] = useState(currentTitle);
  const menuRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setTitleInput(currentTitle);
  }, [currentTitle]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setIsOpen(false);
        setIsRecentSubmenuOpen(false);
      }
    };
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen]);

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const text = event.target?.result as string;
        const parsed = JSON.parse(text);
        if (parsed.pages && Array.isArray(parsed.pages)) {
          onOpenFile(parsed);
          setIsOpen(false);
        } else {
          alert('Invalid whiteboard project file format.');
        }
      } catch (err) {
        console.error('Error reading project file:', err);
        alert('Could not read project file: Invalid JSON.');
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const handleTitleSubmit = () => {
    setIsEditingTitle(false);
    if (titleInput.trim()) {
      onUpdateTitle(titleInput.trim());
    } else {
      setTitleInput(currentTitle);
    }
  };

  const autoSaveTimeStr = lastAutoSavedAt
    ? new Date(lastAutoSavedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : '';

  return (
    <div
      ref={menuRef}
      className="file-menu-container file-menu-bar no-zoom interactive"
      style={{
        position: 'absolute',
        top: 16,
        left: 20,
        zIndex: 50,
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        userSelect: 'none',
      }}
      onPointerDown={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      onWheel={(e) => e.stopPropagation()}
      onTouchStart={(e) => e.stopPropagation()}
      onTouchMove={(e) => e.stopPropagation()}
    >
      <input
        ref={fileInputRef}
        type="file"
        accept=".aitutor,.json"
        style={{ display: 'none' }}
        onChange={handleFileInputChange}
      />

      {/* Brand, File Menu, Session Title & Live Auto-Save Status */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          backgroundColor: 'rgba(26, 26, 46, 0.88)',
          backdropFilter: 'blur(14px)',
          border: '1px solid rgba(255, 255, 255, 0.14)',
          borderRadius: 10,
          padding: '4px 10px',
          boxShadow: '0 4px 20px rgba(0, 0, 0, 0.35)',
        }}
      >
        {/* App Logo */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, paddingRight: 6, borderRight: '1px solid rgba(255, 255, 255, 0.12)' }}>
          <span style={{ fontSize: 18 }}>🎓</span>
          <span className="brand-text" style={{ fontSize: 13, fontWeight: 700, color: '#4ECDC4', letterSpacing: '0.3px', fontFamily: "'Inter', sans-serif" }}>
            ZYREN AI Tutor
          </span>
        </div>

        {/* File Dropdown Button */}
        <div style={{ position: 'relative' }}>
          <button
            onClick={() => setIsOpen(!isOpen)}
            style={{
              padding: '6px 12px',
              fontSize: 13,
              fontWeight: 600,
              backgroundColor: isOpen ? 'rgba(78, 205, 196, 0.2)' : 'transparent',
              color: isOpen ? '#4ECDC4' : '#e0e0e0',
              border: 'none',
              borderRadius: 6,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              fontFamily: "'Inter', sans-serif",
              transition: 'all 0.15s ease',
            }}
          >
            <span>📁 File</span>
            <span style={{ fontSize: 10, opacity: 0.7 }}>{isOpen ? '▲' : '▼'}</span>
          </button>

          {isOpen && (
            <div
              style={{
                position: 'absolute',
                top: 'calc(100% + 8px)',
                left: 0,
                width: 265,
                backgroundColor: 'rgba(20, 20, 38, 0.97)',
                backdropFilter: 'blur(20px)',
                border: '1px solid rgba(255, 255, 255, 0.18)',
                borderRadius: 10,
                padding: '6px 0',
                boxShadow: '0 8px 32px rgba(0, 0, 0, 0.55)',
                display: 'flex',
                flexDirection: 'column',
                zIndex: 100,
                fontFamily: "'Inter', sans-serif",
              }}
            >
              {/* New Session */}
              <button
                onClick={() => {
                  setIsOpen(false);
                  onNewFile();
                }}
                className="file-menu-item"
                style={menuItemStyle}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span>✨</span>
                  <span>New Session (Auto-Saves Current)</span>
                </div>
              </button>

              {/* Save */}
              <button
                onClick={() => {
                  setIsOpen(false);
                  onSave();
                }}
                className="file-menu-item"
                style={menuItemStyle}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span>💾</span>
                  <span>Save Now</span>
                </div>
              </button>

              {/* Save As */}
              <button
                onClick={() => {
                  setIsOpen(false);
                  onSaveAs();
                }}
                className="file-menu-item"
                style={menuItemStyle}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span>📥</span>
                  <span>Export File... (.aitutor)</span>
                </div>
              </button>

              {/* Open File */}
              <button
                onClick={() => {
                  setIsOpen(false);
                  if (onOpenPicker) {
                    onOpenPicker();
                  } else {
                    fileInputRef.current?.click();
                  }
                }}
                className="file-menu-item"
                style={menuItemStyle}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span>📂</span>
                  <span>Open Project File...</span>
                </div>
              </button>

              {/* Saved / Auto-Saved Sessions History */}
              <div
                style={{ position: 'relative' }}
                onMouseEnter={() => setIsRecentSubmenuOpen(true)}
                onMouseLeave={() => setIsRecentSubmenuOpen(false)}
              >
                <button
                  onClick={() => setIsRecentSubmenuOpen(!isRecentSubmenuOpen)}
                  className="file-menu-item"
                  style={{ ...menuItemStyle, justifyContent: 'space-between' }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span>🕒</span>
                    <span>Saved Sessions ({recentSessions.length})</span>
                  </div>
                  <span style={{ fontSize: 11, opacity: 0.7 }}>▶</span>
                </button>

                {isRecentSubmenuOpen && (
                  <div
                    style={{
                      position: 'absolute',
                      top: 0,
                      left: 'calc(100% + 4px)',
                      width: 310,
                      maxHeight: 360,
                      overflowY: 'auto',
                      backgroundColor: 'rgba(20, 20, 38, 0.98)',
                      backdropFilter: 'blur(20px)',
                      border: '1px solid rgba(255, 255, 255, 0.18)',
                      borderRadius: 10,
                      padding: '6px 0',
                      boxShadow: '0 8px 32px rgba(0, 0, 0, 0.6)',
                      zIndex: 110,
                    }}
                  >
                    {recentSessions.length === 0 ? (
                      <div style={{ padding: '14px 16px', fontSize: 12, color: '#777', textAlign: 'center' }}>
                        No auto-saved sessions yet
                      </div>
                    ) : (
                      recentSessions.map((session) => {
                        const isCurrent = activeSessionId && session.id === activeSessionId;
                        return (
                          <div
                            key={session.id}
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'space-between',
                              padding: '8px 14px',
                              cursor: 'pointer',
                              backgroundColor: isCurrent ? 'rgba(78, 205, 196, 0.1)' : 'transparent',
                              borderLeft: isCurrent ? '2.5px solid #4ECDC4' : '2.5px solid transparent',
                              transition: 'background 0.15s',
                            }}
                            className="recent-session-item"
                            onClick={() => {
                              setIsOpen(false);
                              setIsRecentSubmenuOpen(false);
                              onLoadRecent(session);
                            }}
                          >
                            <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginRight: 8, flex: 1 }}>
                              <div style={{ color: isCurrent ? '#4ECDC4' : '#fff', fontSize: 12, fontWeight: isCurrent ? 700 : 500, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                {session.name || 'Untitled Session'} {isCurrent ? '• Active' : ''}
                              </div>
                              <div style={{ color: '#888', fontSize: 10.5, marginTop: 2 }}>
                                {session.slideCount || 1} slide{(session.slideCount || 1) > 1 ? 's' : ''}
                                {typeof session.messageCount === 'number' ? ` • 💬 ${session.messageCount}` : ''}
                                {' • '}
                                {new Date(session.timestamp).toLocaleDateString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                              </div>
                            </div>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                onDeleteRecent(session.id);
                              }}
                              title="Delete saved session"
                              style={{
                                background: 'transparent',
                                border: 'none',
                                color: '#666',
                                fontSize: 12,
                                cursor: 'pointer',
                                padding: '2px 6px',
                                borderRadius: 4,
                              }}
                              onMouseEnter={(e) => (e.currentTarget.style.color = '#ff6b6b')}
                              onMouseLeave={(e) => (e.currentTarget.style.color = '#666')}
                            >
                              ✕
                            </button>
                          </div>
                        );
                      })
                    )}
                  </div>
                )}
              </div>

              <div style={{ height: 1, backgroundColor: 'rgba(255, 255, 255, 0.1)', margin: '6px 0' }} />

              {/* Export PNG */}
              <button
                onClick={() => {
                  setIsOpen(false);
                  onExportPNG();
                }}
                className="file-menu-item"
                style={menuItemStyle}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span>🖼️</span>
                  <span>Export as PNG Image</span>
                </div>
              </button>

              {/* Export PDF */}
              <button
                onClick={() => {
                  setIsOpen(false);
                  onExportPDF();
                }}
                className="file-menu-item"
                style={menuItemStyle}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span>📑</span>
                  <span>Export All Slides as PDF</span>
                </div>
              </button>

              {onOpenApiKeyModal && (
                <>
                  <div style={{ height: 1, backgroundColor: 'rgba(255, 255, 255, 0.1)', margin: '6px 0' }} />
                  <button
                    onClick={() => {
                      setIsOpen(false);
                      onOpenApiKeyModal();
                    }}
                    className="file-menu-item"
                    style={menuItemStyle}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <span>🔑</span>
                      <span>Gemini API Key Settings...</span>
                    </div>
                  </button>
                </>
              )}
            </div>
          )}
        </div>

        {/* Current Session Title (Click to rename) */}
        <div style={{ paddingLeft: 6, borderLeft: '1px solid rgba(255, 255, 255, 0.12)', display: 'flex', alignItems: 'center', gap: 8 }}>
          {isEditingTitle ? (
            <input
              type="text"
              value={titleInput}
              onChange={(e) => setTitleInput(e.target.value)}
              onBlur={handleTitleSubmit}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleTitleSubmit();
                if (e.key === 'Escape') {
                  setTitleInput(currentTitle);
                  setIsEditingTitle(false);
                }
              }}
              autoFocus
              style={{
                backgroundColor: 'rgba(0, 0, 0, 0.5)',
                color: '#4ECDC4',
                border: '1px solid #4ECDC4',
                borderRadius: 4,
                padding: '2px 6px',
                fontSize: 12,
                fontWeight: 600,
                outline: 'none',
                fontFamily: "'Inter', sans-serif",
                width: 180,
              }}
            />
          ) : (
            <div
              onClick={() => setIsEditingTitle(true)}
              title="Click to edit session title"
              className="session-title-badge"
              style={{
                color: '#ccc',
                fontSize: 12,
                fontWeight: 500,
                cursor: 'pointer',
                padding: '2px 6px',
                borderRadius: 4,
                transition: 'color 0.15s, background 0.15s',
                maxWidth: 190,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                fontFamily: "'Inter', sans-serif",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.color = '#fff';
                e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.08)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.color = '#ccc';
                e.currentTarget.style.backgroundColor = 'transparent';
              }}
            >
              {currentTitle || 'Untitled Whiteboard'} ✎
            </div>
          )}

          {/* Subtle Auto-Save Status Indicator (Word / Gemini / Antigravity style) */}
          <span
            title={
              autoSaveState === 'saving'
                ? 'Auto-saving slides & chat conversation...'
                : lastAutoSavedAt
                ? `All slides & conversations auto-saved (${autoSaveTimeStr})`
                : 'Continuous Auto-Save active'
            }
            style={{
              fontSize: 10.5,
              fontWeight: 600,
              color:
                autoSaveState === 'saving'
                  ? '#FFD54F'
                  : autoSaveState === 'error'
                  ? '#FF6B6B'
                  : '#6EE7B7',
              backgroundColor: 'rgba(255, 255, 255, 0.05)',
              padding: '2px 7px',
              borderRadius: 12,
              whiteSpace: 'nowrap',
              fontFamily: "'Inter', sans-serif",
            }}
          >
            {autoSaveState === 'saving'
              ? '⟳ Saving...'
              : autoSaveState === 'error'
              ? '⚠ Save retry'
              : '✓ Auto-saved'}
          </span>
        </div>
      </div>
    </div>
  );
};

const menuItemStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  width: '100%',
  padding: '8px 16px',
  backgroundColor: 'transparent',
  border: 'none',
  color: '#e0e0e0',
  fontSize: 13,
  fontWeight: 500,
  cursor: 'pointer',
  textAlign: 'left',
  transition: 'background-color 0.15s, color 0.15s',
};
