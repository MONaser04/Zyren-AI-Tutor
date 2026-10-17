import React, { useState, useRef, useEffect } from 'react';

export interface ChatAttachment {
  name: string;
  type: 'image' | 'document';
  dataUrl?: string; // base64 representation
  size?: number;
  mimeType: string;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  timestamp: number;
  attachment?: ChatAttachment;
}

export interface ChatDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  messages: ChatMessage[];
  onSendMessage: (text: string, attachment?: ChatAttachment) => void;
  onClearChat?: () => void;
  onResetAIMemory?: () => void;
  isMicActive?: boolean;
  isSpeakerMuted?: boolean;
  onToggleSpeakerMute?: () => void;
}

export const ChatDrawer: React.FC<ChatDrawerProps> = ({
  isOpen,
  onClose,
  messages,
  onSendMessage,
  onClearChat,
  onResetAIMemory,
  isMicActive,
  isSpeakerMuted,
  onToggleSpeakerMute,
}) => {
  const [inputVal, setInputVal] = useState('');
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [pendingAttachment, setPendingAttachment] = useState<ChatAttachment | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [previewImage, setPreviewImage] = useState<string | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    if (isOpen) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, isOpen]);

  const processFile = (file: File) => {
    if (!file) return;
    const isImg = file.type.startsWith('image/');
    const reader = new FileReader();
    reader.onload = (e) => {
      const dataUrl = e.target?.result as string;
      setPendingAttachment({
        name: file.name,
        type: isImg ? 'image' : 'document',
        dataUrl,
        size: file.size,
        mimeType: file.type || (isImg ? 'image/jpeg' : 'text/plain'),
      });
    };
    reader.readAsDataURL(file);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      processFile(file);
      e.target.value = '';
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) {
      processFile(file);
    }
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.kind === 'file') {
        const file = item.getAsFile();
        if (file) {
          e.preventDefault();
          processFile(file);
          return;
        }
      }
    }
  };

  const handleSubmit = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!inputVal.trim() && !pendingAttachment) return;
    onSendMessage(inputVal.trim(), pendingAttachment || undefined);
    setInputVal('');
    setPendingAttachment(null);
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
  };

  const handleCopyMessage = (id: string, text: string) => {
    try {
      if (navigator.clipboard) {
        navigator.clipboard.writeText(text);
        setCopiedId(id);
        setTimeout(() => setCopiedId(null), 2000);
      }
    } catch (err) {
      console.error('Failed to copy text:', err);
    }
  };

  const formatFileSize = (bytes?: number) => {
    if (!bytes) return '';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  return (
    <div
      className="chat-drawer no-zoom interactive"
      onPointerDown={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      onWheel={(e) => e.stopPropagation()}
      onTouchStart={(e) => e.stopPropagation()}
      onTouchMove={(e) => e.stopPropagation()}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      onPaste={handlePaste}
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        bottom: 0,
        width: 380,
        backgroundColor: 'rgba(15, 15, 28, 0.96)',
        backdropFilter: 'blur(24px)',
        borderRight: '1px solid rgba(255, 255, 255, 0.12)',
        boxShadow: '8px 0 32px rgba(0, 0, 0, 0.6)',
        zIndex: 50,
        display: 'flex',
        flexDirection: 'column',
        transform: isOpen ? 'translateX(0)' : 'translateX(-100%)',
        transition: 'transform 0.28s cubic-bezier(0.16, 1, 0.3, 1)',
        fontFamily: "'Inter', sans-serif",
        pointerEvents: isOpen ? 'auto' : 'none',
        userSelect: 'text',
        WebkitUserSelect: 'text',
      }}
    >
      {/* Hidden File Input */}
      <input
        type="file"
        ref={fileInputRef}
        onChange={handleFileChange}
        accept="image/*,.pdf,.txt,.py,.json,.csv,.md,.js,.ts,.html,.css"
        style={{ display: 'none' }}
      />

      {/* Drag & Drop Visual Overlay */}
      {isDragging && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            backgroundColor: 'rgba(78, 205, 196, 0.25)',
            backdropFilter: 'blur(8px)',
            border: '2px dashed #4ECDC4',
            zIndex: 100,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            pointerEvents: 'none',
          }}
        >
          <span style={{ fontSize: 44, marginBottom: 8 }}>📥</span>
          <span style={{ color: '#4ECDC4', fontWeight: 700, fontSize: 16 }}>Drop File to Attach</span>
          <span style={{ color: '#FFF', fontSize: 12, opacity: 0.8, marginTop: 4 }}>
            Images (JPG, PNG) or Documents (PDF, Code, Text)
          </span>
        </div>
      )}

      {/* Fullscreen Image Preview Lightbox */}
      {previewImage && (
        <div
          onClick={() => setPreviewImage(null)}
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.88)',
            zIndex: 9999,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'zoom-out',
            padding: 24,
          }}
        >
          <img
            src={previewImage}
            alt="Preview"
            style={{
              maxWidth: '90vw',
              maxHeight: '90vh',
              borderRadius: 8,
              boxShadow: '0 8px 32px rgba(0,0,0,0.8)',
              objectFit: 'contain',
            }}
          />
        </div>
      )}

      {/* ── Header ── */}
      <div
        style={{
          padding: '16px 20px',
          borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          backgroundColor: 'rgba(255, 255, 255, 0.02)',
          userSelect: 'none',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 20 }}>💬</span>
          <div>
            <div style={{ color: '#FFFFFF', fontWeight: 700, fontSize: 15, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
              <span>ZYREN AI Tutor Live Chat</span>
              {isMicActive && (
                <span
                  style={{
                    fontSize: 10,
                    padding: '2px 6px',
                    borderRadius: 10,
                    backgroundColor: 'rgba(78, 205, 196, 0.2)',
                    color: '#4ECDC4',
                    fontWeight: 600,
                  }}
                >
                  ● Mic ON
                </span>
              )}
              {isSpeakerMuted && (
                <span
                  style={{
                    fontSize: 10,
                    padding: '2px 6px',
                    borderRadius: 10,
                    backgroundColor: 'rgba(251, 191, 36, 0.2)',
                    color: '#fbbf24',
                    fontWeight: 600,
                  }}
                >
                  🔇 Silent Mode
                </span>
              )}
            </div>
            <div style={{ color: '#888', fontSize: 11, marginTop: 2 }}>
              {messages.length} message{messages.length === 1 ? '' : 's'} recorded
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {onToggleSpeakerMute && (
            <button
              onClick={onToggleSpeakerMute}
              title={isSpeakerMuted ? 'Unmute AI Voice Output' : 'Mute AI Voice Output (Silent reading mode)'}
              style={{
                background: isSpeakerMuted ? 'rgba(251, 191, 36, 0.15)' : 'rgba(255, 255, 255, 0.06)',
                border: isSpeakerMuted ? '1px solid rgba(251, 191, 36, 0.4)' : '1px solid rgba(255, 255, 255, 0.1)',
                color: isSpeakerMuted ? '#fbbf24' : '#aaa',
                fontSize: 12,
                cursor: 'pointer',
                padding: '4px 8px',
                borderRadius: 6,
                display: 'flex',
                alignItems: 'center',
                gap: 4,
              }}
            >
              <span>{isSpeakerMuted ? '🔇' : '🔊'}</span>
            </button>
          )}

          {messages.length > 0 && onClearChat && (
            <button
              onClick={onClearChat}
              title="Clear Chat History"
              style={{
                background: 'transparent',
                border: 'none',
                color: '#777',
                fontSize: 12,
                cursor: 'pointer',
                padding: '4px 6px',
                borderRadius: 4,
              }}
              onMouseEnter={(e) => (e.currentTarget.style.color = '#ff6b6b')}
              onMouseLeave={(e) => (e.currentTarget.style.color = '#777')}
            >
              🧹 Clear
            </button>
          )}

          {onResetAIMemory && (
            <button
              onClick={onResetAIMemory}
              title="Reset AI Memory (Start New Conversation / بدء محادثة جديدة بذاكرة نظيفة)"
              style={{
                backgroundColor: 'rgba(255, 107, 107, 0.15)',
                border: '1px solid rgba(255, 107, 107, 0.35)',
                color: '#FF6B6B',
                fontSize: 12,
                fontWeight: 600,
                cursor: 'pointer',
                padding: '3px 8px',
                borderRadius: 6,
                display: 'flex',
                alignItems: 'center',
                gap: 4,
                transition: 'all 0.15s ease',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.backgroundColor = 'rgba(255, 107, 107, 0.28)';
                e.currentTarget.style.borderColor = '#FF6B6B';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = 'rgba(255, 107, 107, 0.15)';
                e.currentTarget.style.borderColor = 'rgba(255, 107, 107, 0.35)';
              }}
            >
              <span>🔄</span>
              <span>Reset AI</span>
            </button>
          )}

          <button
            onClick={onClose}
            title="Close Chat Drawer"
            style={{
              background: 'none',
              border: 'none',
              color: '#888',
              fontSize: 18,
              cursor: 'pointer',
              padding: '6px 8px',
              borderRadius: 6,
              lineHeight: 1,
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
      </div>

      {/* ── Message Thread ── */}
      <div
        className="chat-messages no-zoom interactive"
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
          gap: 14,
          userSelect: 'text',
          WebkitUserSelect: 'text',
        }}
      >
        {messages.length === 0 ? (
          <div
            style={{
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#777',
              textAlign: 'center',
              padding: '0 20px',
              userSelect: 'none',
            }}
          >
            <div style={{ fontSize: 36, marginBottom: 12 }}>🎙️</div>
            <div style={{ fontSize: 14, fontWeight: 600, color: '#aaa', marginBottom: 6 }}>
              No messages yet
            </div>
            <div style={{ fontSize: 12, lineHeight: 1.5 }}>
              Speak through your microphone, attach an image/file 📎, or type a question below to begin.
            </div>
          </div>
        ) : (
          messages.map((msg) => {
            const isUser = msg.role === 'user';
            const isCopied = copiedId === msg.id;
            const timeStr = new Date(msg.timestamp).toLocaleTimeString([], {
              hour: '2-digit',
              minute: '2-digit',
            });

            return (
              <div
                key={msg.id}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: isUser ? 'flex-end' : 'flex-start',
                  gap: 4,
                  width: '100%',
                }}
              >
                {/* Sender badge, timestamp & 1-click Copy button */}
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    width: '100%',
                    maxWidth: '88%',
                    fontSize: 11,
                    color: '#777',
                    padding: '0 2px',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span>{isUser ? '🎓 You' : '🤖 ZYREN Tutor'}</span>
                    <span>•</span>
                    <span>{timeStr}</span>
                  </div>

                  {msg.text && (
                    <button
                      onClick={() => handleCopyMessage(msg.id, msg.text)}
                      title="Copy message text"
                      style={{
                        background: isCopied ? 'rgba(78, 205, 196, 0.15)' : 'transparent',
                        border: isCopied ? '1px solid rgba(78, 205, 196, 0.4)' : '1px solid transparent',
                        color: isCopied ? '#4ECDC4' : '#888',
                        fontSize: 11,
                        cursor: 'pointer',
                        padding: '2px 6px',
                        borderRadius: 4,
                        display: 'flex',
                        alignItems: 'center',
                        gap: 4,
                        transition: 'all 0.15s ease',
                        fontFamily: "'Inter', sans-serif",
                      }}
                      onMouseEnter={(e) => {
                        if (!isCopied) {
                          e.currentTarget.style.color = '#FFF';
                          e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.08)';
                        }
                      }}
                      onMouseLeave={(e) => {
                        if (!isCopied) {
                          e.currentTarget.style.color = '#888';
                          e.currentTarget.style.backgroundColor = 'transparent';
                        }
                      }}
                    >
                      <span>{isCopied ? '✓' : '📋'}</span>
                      <span>{isCopied ? 'Copied' : 'Copy'}</span>
                    </button>
                  )}
                </div>

                {/* Message Bubble with optional Attachment */}
                <div
                  dir="auto"
                  style={{
                    maxWidth: '88%',
                    padding: '10px 14px',
                    borderRadius: isUser ? '14px 14px 2px 14px' : '14px 14px 14px 2px',
                    backgroundColor: isUser ? 'rgba(78, 205, 196, 0.18)' : 'rgba(255, 255, 255, 0.06)',
                    border: isUser ? '1px solid rgba(78, 205, 196, 0.4)' : '1px solid rgba(255, 255, 255, 0.1)',
                    color: isUser ? '#E0FFF9' : '#FFFFFF',
                    fontSize: 13,
                    lineHeight: 1.5,
                    wordBreak: 'break-word',
                    boxShadow: '0 2px 8px rgba(0,0,0,0.2)',
                    userSelect: 'text',
                    WebkitUserSelect: 'text',
                    cursor: 'text',
                    whiteSpace: 'pre-wrap',
                    unicodeBidi: 'plaintext',
                    textAlign: 'start',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 8,
                  }}
                >
                  {/* Render Attachment if present */}
                  {msg.attachment && (
                    <div style={{ marginTop: 2 }}>
                      {msg.attachment.type === 'image' && msg.attachment.dataUrl ? (
                        <div style={{ position: 'relative' }}>
                          <img
                            src={msg.attachment.dataUrl}
                            alt={msg.attachment.name}
                            onClick={() => setPreviewImage(msg.attachment?.dataUrl || null)}
                            style={{
                              maxWidth: '100%',
                              maxHeight: 200,
                              borderRadius: 8,
                              border: '1px solid rgba(255, 255, 255, 0.2)',
                              cursor: 'zoom-in',
                              objectFit: 'cover',
                              display: 'block',
                            }}
                          />
                          <div style={{ fontSize: 10, color: 'rgba(255, 255, 255, 0.7)', marginTop: 4 }}>
                            📷 {msg.attachment.name} ({formatFileSize(msg.attachment.size)})
                          </div>
                        </div>
                      ) : (
                        <div
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 8,
                            padding: '8px 10px',
                            backgroundColor: 'rgba(0, 0, 0, 0.3)',
                            border: '1px solid rgba(255, 255, 255, 0.15)',
                            borderRadius: 8,
                            fontSize: 12,
                          }}
                        >
                          <span style={{ fontSize: 18 }}>📄</span>
                          <div style={{ overflow: 'hidden' }}>
                            <div style={{ fontWeight: 600, color: '#FFF', whiteSpace: 'nowrap', textOverflow: 'ellipsis', overflow: 'hidden' }}>
                              {msg.attachment.name}
                            </div>
                            <div style={{ fontSize: 10, color: '#aaa' }}>
                              {formatFileSize(msg.attachment.size)}
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {msg.text && <div>{msg.text}</div>}
                </div>
              </div>
            );
          })
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* ── Pending Attachment Preview Chip ── */}
      {pendingAttachment && (
        <div
          style={{
            padding: '8px 16px',
            backgroundColor: 'rgba(78, 205, 196, 0.12)',
            borderTop: '1px solid rgba(78, 205, 196, 0.3)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 8,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, overflow: 'hidden' }}>
            {pendingAttachment.type === 'image' && pendingAttachment.dataUrl ? (
              <img
                src={pendingAttachment.dataUrl}
                alt="Preview"
                style={{ width: 32, height: 32, borderRadius: 4, objectFit: 'cover', border: '1px solid #4ECDC4' }}
              />
            ) : (
              <span style={{ fontSize: 20 }}>📄</span>
            )}
            <div style={{ overflow: 'hidden' }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: '#4ECDC4', whiteSpace: 'nowrap', textOverflow: 'ellipsis', overflow: 'hidden' }}>
                {pendingAttachment.name}
              </div>
              <div style={{ fontSize: 10, color: '#aaa' }}>
                {formatFileSize(pendingAttachment.size)} • Ready to send
              </div>
            </div>
          </div>
          <button
            onClick={() => setPendingAttachment(null)}
            title="Remove attachment"
            style={{
              background: 'none',
              border: 'none',
              color: '#ff6b6b',
              cursor: 'pointer',
              fontSize: 16,
              padding: '4px 6px',
              borderRadius: 4,
            }}
          >
            ✕
          </button>
        </div>
      )}

      {/* ── Multi-Line Input Box at Bottom (Shift+Enter for newline, Enter to send) ── */}
      <div
        style={{
          padding: '12px 16px',
          borderTop: '1px solid rgba(255, 255, 255, 0.08)',
          backgroundColor: 'rgba(20, 20, 36, 0.98)',
        }}
      >
        <form onSubmit={handleSubmit} style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
          {/* Attachment Button */}
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            title="Attach Image or Document (PNG, JPG, PDF, Code, Text)"
            style={{
              width: 40,
              height: 40,
              backgroundColor: pendingAttachment ? 'rgba(78, 205, 196, 0.25)' : 'rgba(255, 255, 255, 0.08)',
              border: pendingAttachment ? '1px solid #4ECDC4' : '1px solid rgba(255, 255, 255, 0.15)',
              color: pendingAttachment ? '#4ECDC4' : '#FFF',
              borderRadius: 8,
              fontSize: 16,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
              transition: 'all 0.15s ease',
            }}
          >
            📎
          </button>

          <textarea
            ref={textareaRef}
            placeholder={pendingAttachment ? `Ask about ${pendingAttachment.name}...` : "Ask ZYREN AI Tutor..."}
            value={inputVal}
            rows={Math.min(5, Math.max(1, inputVal.split('\n').length))}
            onPaste={handlePaste}
            onChange={(e) => {
              setInputVal(e.target.value);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey) {
                e.preventDefault();
                handleSubmit();
              }
            }}
            style={{
              flex: 1,
              minHeight: 40,
              maxHeight: 120,
              padding: '9px 12px',
              backgroundColor: 'rgba(0, 0, 0, 0.5)',
              color: '#FFF',
              border: '1px solid rgba(255, 255, 255, 0.15)',
              borderRadius: 8,
              fontSize: 13,
              outline: 'none',
              fontFamily: "'Inter', sans-serif",
              resize: 'none',
              lineHeight: 1.4,
              userSelect: 'text',
              WebkitUserSelect: 'text',
            }}
          />
          <button
            type="submit"
            disabled={!inputVal.trim() && !pendingAttachment}
            style={{
              height: 40,
              padding: '0 16px',
              backgroundColor: (inputVal.trim() || pendingAttachment) ? '#4ECDC4' : 'rgba(255, 255, 255, 0.08)',
              color: (inputVal.trim() || pendingAttachment) ? '#1a1a2e' : '#555',
              border: 'none',
              borderRadius: 8,
              fontWeight: 700,
              fontSize: 13,
              cursor: (inputVal.trim() || pendingAttachment) ? 'pointer' : 'default',
              transition: 'background-color 0.15s',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 4,
              flexShrink: 0,
            }}
          >
            <span>Send</span>
            <span>➤</span>
          </button>
        </form>
      </div>
    </div>
  );
};
