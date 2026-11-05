import React, { useState, useEffect } from 'react';

export interface ApiKeyStatusInfo {
  configured: boolean;
  source: 'ui' | 'env' | 'none';
  maskedKey: string | null;
  updatedAt?: number;
  verifiedAt?: number;
}

export interface ApiKeyTestResponse {
  valid: boolean;
  saved?: boolean;
  configured?: boolean;
  maskedKey?: string | null;
  source?: 'ui' | 'env' | 'none';
  latencyMs?: number;
  modelCount?: number;
  message?: string;
  error?: string;
  errorCode?: string;
}

export async function fetchApiKeyStatus(): Promise<ApiKeyStatusInfo> {
  const res = await fetch('/api/gemini-key/status');
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }
  return res.json();
}

export async function testGeminiApiKeyClient(apiKey: string): Promise<ApiKeyTestResponse> {
  const res = await fetch('/api/gemini-key/test', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ apiKey }),
  });
  return res.json();
}

export async function saveGeminiApiKeyClient(apiKey: string): Promise<ApiKeyTestResponse> {
  const res = await fetch('/api/gemini-key', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ apiKey }),
  });
  return res.json();
}

export async function deleteGeminiApiKeyClient(): Promise<{ deleted: boolean; configured: boolean; error?: string }> {
  const res = await fetch('/api/gemini-key', {
    method: 'DELETE',
  });
  return res.json();
}

// ─── Mode A: First-Time / Missing Key Full-Screen Setup Gate ────────────────

interface ApiKeyOnboardingGateProps {
  onKeyActivated: (status: ApiKeyStatusInfo) => void;
  onContinueOffline?: () => void;
}

export const ApiKeyOnboardingGate: React.FC<ApiKeyOnboardingGateProps> = ({
  onKeyActivated,
  onContinueOffline,
}) => {
  const [keyInput, setKeyInput] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [feedback, setFeedback] = useState<{
    kind: 'success' | 'error' | 'info';
    text: string;
    latencyMs?: number;
  } | null>(null);
  const [lastVerifiedInput, setLastVerifiedInput] = useState<string>('');

  const busy = isTesting || isSaving;

  const handlePaste = async () => {
    try {
      const clip = await navigator.clipboard.readText();
      if (clip && clip.trim()) {
        setKeyInput(clip.trim());
        setFeedback(null);
      }
    } catch {
      // Clipboard permission declined; user can Ctrl+V directly
    }
  };

  const handleTestOnly = async () => {
    const trimmed = keyInput.trim();
    if (!trimmed) {
      setFeedback({ kind: 'error', text: 'Please paste your Gemini API key first.' });
      return;
    }
    setIsTesting(true);
    setFeedback({ kind: 'info', text: 'Testing connection with Google Gemini API...' });
    try {
      const result = await testGeminiApiKeyClient(trimmed);
      if (result.valid) {
        setLastVerifiedInput(trimmed);
        setFeedback({
          kind: 'success',
          text: result.message || 'API Key is active, valid, and ready to use!',
          latencyMs: result.latencyMs,
        });
      } else {
        setLastVerifiedInput('');
        setFeedback({
          kind: 'error',
          text: result.error || 'This API key could not be verified.',
        });
      }
    } catch (err: any) {
      setLastVerifiedInput('');
      setFeedback({
        kind: 'error',
        text: err?.message || 'Unable to reach verification server.',
      });
    } finally {
      setIsTesting(false);
    }
  };

  const handleActivate = async (e?: React.FormEvent) => {
    e?.preventDefault();
    const trimmed = keyInput.trim();
    if (!trimmed) {
      setFeedback({ kind: 'error', text: 'Please enter your Gemini API key to continue.' });
      return;
    }

    setIsSaving(true);
    setFeedback({
      kind: 'info',
      text:
        lastVerifiedInput === trimmed
          ? 'Activating your verified Gemini API key...'
          : 'Automatically testing & verifying your API key with Google Gemini...',
    });

    try {
      // Server ALWAYS runs live verification against Google before persisting
      const res = await saveGeminiApiKeyClient(trimmed);
      if (res.saved && res.valid) {
        setFeedback({
          kind: 'success',
          text: `Verified & activated (${res.latencyMs || 1}ms)! Launching ZYREN AI Tutor...`,
          latencyMs: res.latencyMs,
        });
        onKeyActivated({
          configured: true,
          source: 'ui',
          maskedKey: res.maskedKey || null,
          updatedAt: Date.now(),
          verifiedAt: Date.now(),
        });
      } else {
        setFeedback({
          kind: 'error',
          text: res.error || 'Verification failed. Please check that the API key is active.',
        });
      }
    } catch (err: any) {
      setFeedback({
        kind: 'error',
        text: err?.message || 'Could not save and verify API key.',
      });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div
      style={{
        minHeight: '100dvh',
        width: '100%',
        background: 'radial-gradient(circle at 50% 18%, #1d2242 0%, #111222 65%, #0b0c17 100%)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
        boxSizing: 'border-box',
        fontFamily: "'Inter', sans-serif",
        color: '#FFFFFF',
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: 520,
          backgroundColor: 'rgba(22, 24, 46, 0.94)',
          backdropFilter: 'blur(24px)',
          border: '1px solid rgba(78, 205, 196, 0.35)',
          borderRadius: 18,
          padding: '32px 30px',
          boxShadow: '0 24px 64px rgba(0, 0, 0, 0.65), 0 0 40px rgba(78, 205, 196, 0.12)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 18 }}>
          <div
            style={{
              width: 52,
              height: 52,
              borderRadius: 14,
              background: 'linear-gradient(135deg, rgba(78, 205, 196, 0.25), rgba(168, 85, 247, 0.25))',
              border: '1px solid rgba(78, 205, 196, 0.45)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 26,
            }}
          >
            🔑
          </div>
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#4ECDC4', letterSpacing: '0.8px', textTransform: 'uppercase' }}>
              First-Time Quick Setup
            </div>
            <h2 style={{ margin: '4px 0 0', fontSize: 21, fontWeight: 700, color: '#FFFFFF' }}>
              Connect Your Gemini API Key
            </h2>
          </div>
        </div>

        <p style={{ margin: '0 0 18px', fontSize: 13.5, lineHeight: 1.6, color: '#B8BCD0' }}>
          Enter your Google Gemini API key once below. ZYREN automatically tests and verifies your key before activating it, and stores it securely on your device—no editing program files required.
        </p>

        <div
          style={{
            marginBottom: 18,
            padding: '10px 14px',
            borderRadius: 10,
            backgroundColor: 'rgba(78, 205, 196, 0.08)',
            border: '1px solid rgba(78, 205, 196, 0.2)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 10,
            fontSize: 12.5,
          }}
        >
          <span style={{ color: '#CFD3E6' }}>Need a key? Create one in seconds from Google AI Studio:</span>
          <a
            href="https://aistudio.google.com/apikey"
            target="_blank"
            rel="noopener noreferrer"
            style={{
              color: '#4ECDC4',
              fontWeight: 700,
              textDecoration: 'none',
              whiteSpace: 'nowrap',
              padding: '5px 10px',
              borderRadius: 6,
              backgroundColor: 'rgba(78, 205, 196, 0.14)',
              border: '1px solid rgba(78, 205, 196, 0.35)',
            }}
          >
            Get API Key ↗
          </a>
        </div>

        <form onSubmit={handleActivate}>
          <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#D0D4E8', marginBottom: 8 }}>
            Gemini API Key
          </label>
          <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
            <div style={{ position: 'relative', flex: 1 }}>
              <input
                type={showKey ? 'text' : 'password'}
                value={keyInput}
                onChange={(e) => {
                  setKeyInput(e.target.value);
                  if (feedback?.kind === 'error') setFeedback(null);
                }}
                placeholder="AIzaSy..."
                autoFocus
                spellCheck={false}
                autoComplete="off"
                disabled={busy}
                style={{
                  width: '100%',
                  boxSizing: 'border-box',
                  padding: '12px 42px 12px 14px',
                  borderRadius: 10,
                  border:
                    lastVerifiedInput && lastVerifiedInput === keyInput.trim()
                      ? '1.5px solid #38EF7D'
                      : '1px solid rgba(255, 255, 255, 0.2)',
                  backgroundColor: 'rgba(8, 9, 18, 0.75)',
                  color: '#FFFFFF',
                  fontSize: 13.5,
                  fontFamily: 'monospace',
                  outline: 'none',
                }}
              />
              <button
                type="button"
                onClick={() => setShowKey((s) => !s)}
                title={showKey ? 'Hide API key' : 'Show API key'}
                style={{
                  position: 'absolute',
                  right: 8,
                  top: '50%',
                  transform: 'translateY(-50%)',
                  background: 'none',
                  border: 'none',
                  color: '#9CA3AF',
                  cursor: 'pointer',
                  fontSize: 15,
                  padding: 4,
                }}
              >
                {showKey ? '🙈' : '👁️'}
              </button>
            </div>

            <button
              type="button"
              onClick={handlePaste}
              disabled={busy}
              title="Paste from clipboard"
              style={{
                padding: '0 14px',
                borderRadius: 10,
                border: '1px solid rgba(255, 255, 255, 0.16)',
                backgroundColor: 'rgba(255, 255, 255, 0.07)',
                color: '#E5E7EB',
                fontSize: 12.5,
                fontWeight: 600,
                cursor: busy ? 'default' : 'pointer',
                whiteSpace: 'nowrap',
              }}
            >
              📋 Paste
            </button>
          </div>

          {feedback && (
            <div
              style={{
                marginBottom: 16,
                padding: '11px 14px',
                borderRadius: 10,
                fontSize: 12.5,
                lineHeight: 1.5,
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                backgroundColor:
                  feedback.kind === 'success'
                    ? 'rgba(56, 239, 125, 0.12)'
                    : feedback.kind === 'error'
                    ? 'rgba(255, 107, 107, 0.14)'
                    : 'rgba(78, 205, 196, 0.12)',
                border:
                  feedback.kind === 'success'
                    ? '1px solid rgba(56, 239, 125, 0.45)'
                    : feedback.kind === 'error'
                    ? '1px solid rgba(255, 107, 107, 0.45)'
                    : '1px solid rgba(78, 205, 196, 0.35)',
                color:
                  feedback.kind === 'success'
                    ? '#6EE7B7'
                    : feedback.kind === 'error'
                    ? '#FCA5A5'
                    : '#7DD3FC',
              }}
            >
              <span style={{ fontSize: 16 }}>
                {feedback.kind === 'success' ? '✅' : feedback.kind === 'error' ? '❌' : '⏳'}
              </span>
              <span style={{ flex: 1 }}>{feedback.text}</span>
            </div>
          )}

          <div style={{ display: 'flex', gap: 10 }}>
            <button
              type="button"
              onClick={handleTestOnly}
              disabled={busy || !keyInput.trim()}
              style={{
                padding: '12px 18px',
                borderRadius: 10,
                border: '1px solid rgba(78, 205, 196, 0.45)',
                backgroundColor: 'rgba(78, 205, 196, 0.12)',
                color: '#4ECDC4',
                fontWeight: 700,
                fontSize: 13.5,
                cursor: busy || !keyInput.trim() ? 'not-allowed' : 'pointer',
                opacity: busy || !keyInput.trim() ? 0.55 : 1,
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                whiteSpace: 'nowrap',
              }}
            >
              <span>🧪</span>
              <span>{isTesting ? 'Testing...' : 'Test Key'}</span>
            </button>

            <button
              type="submit"
              disabled={busy || !keyInput.trim()}
              style={{
                flex: 1,
                padding: '12px 20px',
                borderRadius: 10,
                border: 'none',
                background: 'linear-gradient(135deg, #4ECDC4 0%, #38EF7D 100%)',
                color: '#101426',
                fontWeight: 800,
                fontSize: 14,
                cursor: busy || !keyInput.trim() ? 'not-allowed' : 'pointer',
                opacity: busy || !keyInput.trim() ? 0.55 : 1,
                boxShadow: '0 6px 20px rgba(78, 205, 196, 0.3)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 8,
              }}
            >
              <span>🚀</span>
              <span>{isSaving ? 'Verifying & Saving...' : 'Verify & Launch ZYREN'}</span>
            </button>
          </div>
        </form>

        {onContinueOffline && (
          <div style={{ marginTop: 18, textAlign: 'center' }}>
            <button
              type="button"
              onClick={onContinueOffline}
              disabled={busy}
              style={{
                background: 'none',
                border: 'none',
                color: '#8890A6',
                fontSize: 12,
                cursor: 'pointer',
                textDecoration: 'underline',
              }}
            >
              Open Whiteboard in Offline / Standalone Mode (without AI voice)
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

// ─── Mode B: Already-Configured Key Management Modal ────────────────────────

interface ApiKeyManagerModalProps {
  isOpen: boolean;
  onClose: () => void;
  keyStatus: ApiKeyStatusInfo | null;
  onKeyUpdated: (status: ApiKeyStatusInfo) => void;
  onKeyDeleted: () => void;
}

export const ApiKeyManagerModal: React.FC<ApiKeyManagerModalProps> = ({
  isOpen,
  onClose,
  keyStatus,
  onKeyUpdated,
  onKeyDeleted,
}) => {
  const [isReplacing, setIsReplacing] = useState(false);
  const [newKeyInput, setNewKeyInput] = useState('');
  const [showNewKey, setShowNewKey] = useState(false);
  const [isTestingCurrent, setIsTestingCurrent] = useState(false);
  const [isTestingNew, setIsTestingNew] = useState(false);
  const [isSavingNew, setIsSavingNew] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [statusBanner, setStatusBanner] = useState<{
    kind: 'success' | 'error' | 'info';
    text: string;
  } | null>(null);

  useEffect(() => {
    if (isOpen) {
      setIsReplacing(!keyStatus?.configured);
      setNewKeyInput('');
      setShowNewKey(false);
      setConfirmDelete(false);
      setStatusBanner(null);
    }
  }, [isOpen, keyStatus?.configured]);

  if (!isOpen) return null;

  const busy = isTestingCurrent || isTestingNew || isSavingNew || isDeleting;

  const handleTestCurrentKey = async () => {
    setIsTestingCurrent(true);
    setStatusBanner({ kind: 'info', text: 'Testing your active Gemini API key with Google servers...' });
    try {
      const res = await testGeminiApiKeyClient('__CURRENT__');
      if (res.valid) {
        setStatusBanner({
          kind: 'success',
          text: `Active key is healthy and verified (${res.latencyMs || 1}ms)!`,
        });
      } else {
        setStatusBanner({
          kind: 'error',
          text: res.error || 'Current API key failed verification. Please replace it below.',
        });
      }
    } catch (err: any) {
      setStatusBanner({
        kind: 'error',
        text: err?.message || 'Network error while testing current API key.',
      });
    } finally {
      setIsTestingCurrent(false);
    }
  };

  const handleTestNewKey = async () => {
    const trimmed = newKeyInput.trim();
    if (!trimmed) {
      setStatusBanner({ kind: 'error', text: 'Please enter a new Gemini API key to test.' });
      return;
    }
    setIsTestingNew(true);
    setStatusBanner({ kind: 'info', text: 'Testing new API key with Google Gemini...' });
    try {
      const res = await testGeminiApiKeyClient(trimmed);
      if (res.valid) {
        setStatusBanner({
          kind: 'success',
          text: res.message || `New API key verified (${res.latencyMs || 1}ms)! Click Save to apply it.`,
        });
      } else {
        setStatusBanner({
          kind: 'error',
          text: res.error || 'New API key is invalid.',
        });
      }
    } catch (err: any) {
      setStatusBanner({
        kind: 'error',
        text: err?.message || 'Failed to test new API key.',
      });
    } finally {
      setIsTestingNew(false);
    }
  };

  const handleSaveNewKey = async (e?: React.FormEvent) => {
    e?.preventDefault();
    const trimmed = newKeyInput.trim();
    if (!trimmed) {
      setStatusBanner({ kind: 'error', text: 'Please enter the new Gemini API key first.' });
      return;
    }

    setIsSavingNew(true);
    setStatusBanner({
      kind: 'info',
      text: 'Automatically verifying & activating new API key...',
    });

    try {
      // Automatically tests live on server before saving even if user didn't click Test
      const res = await saveGeminiApiKeyClient(trimmed);
      if (res.saved && res.valid) {
        const updatedStatus: ApiKeyStatusInfo = {
          configured: true,
          source: 'ui',
          maskedKey: res.maskedKey || null,
          updatedAt: Date.now(),
          verifiedAt: Date.now(),
        };
        onKeyUpdated(updatedStatus);
        setNewKeyInput('');
        setIsReplacing(false);
        setStatusBanner({
          kind: 'success',
          text: `New API key verified (${res.latencyMs || 1}ms) and synced live to your session!`,
        });
      } else {
        setStatusBanner({
          kind: 'error',
          text: res.error || 'Verification failed — your previous key was kept intact.',
        });
      }
    } catch (err: any) {
      setStatusBanner({
        kind: 'error',
        text: err?.message || 'Error saving new API key.',
      });
    } finally {
      setIsSavingNew(false);
    }
  };

  const handleDeleteKey = async () => {
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    setIsDeleting(true);
    try {
      const res = await deleteGeminiApiKeyClient();
      if (res.deleted) {
        onClose();
        onKeyDeleted();
      } else {
        setStatusBanner({ kind: 'error', text: res.error || 'Could not delete API key.' });
      }
    } catch (err: any) {
      setStatusBanner({ kind: 'error', text: err?.message || 'Error deleting API key.' });
    } finally {
      setIsDeleting(false);
      setConfirmDelete(false);
    }
  };

  return (
    <div
      className="no-zoom interactive"
      onClick={onClose}
      onPointerDown={(e) => e.stopPropagation()}
      onWheel={(e) => e.stopPropagation()}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 220,
        backgroundColor: 'rgba(6, 7, 16, 0.76)',
        backdropFilter: 'blur(10px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 20,
        fontFamily: "'Inter', sans-serif",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%',
          maxWidth: 500,
          backgroundColor: '#16182E',
          border: '1px solid rgba(78, 205, 196, 0.35)',
          borderRadius: 16,
          padding: '24px 26px',
          boxShadow: '0 24px 60px rgba(0, 0, 0, 0.7)',
          color: '#FFFFFF',
        }}
      >
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 22 }}>🔑</span>
            <div>
              <h3 style={{ margin: 0, fontSize: 17, fontWeight: 700 }}>Gemini API Key Settings</h3>
              <div style={{ fontSize: 11.5, color: '#94A3B8', marginTop: 2 }}>
                Manage, test, update, or remove your live Gemini API key
              </div>
            </div>
          </div>

          <button
            onClick={onClose}
            style={{
              background: 'rgba(255, 255, 255, 0.06)',
              border: 'none',
              color: '#94A3B8',
              width: 32,
              height: 32,
              borderRadius: 8,
              cursor: 'pointer',
              fontSize: 16,
            }}
          >
            ✕
          </button>
        </div>

        {/* Active Configured Key Card */}
        {keyStatus?.configured && (
          <div
            style={{
              padding: '14px 16px',
              borderRadius: 12,
              backgroundColor: 'rgba(12, 14, 28, 0.75)',
              border: '1px solid rgba(56, 239, 125, 0.3)',
              marginBottom: 16,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  color: '#38EF7D',
                  backgroundColor: 'rgba(56, 239, 125, 0.14)',
                  padding: '3px 9px',
                  borderRadius: 20,
                }}
              >
                ● Configured & Active
              </span>
              <span style={{ fontSize: 11, color: '#94A3B8' }}>
                Source: {keyStatus.source === 'ui' ? 'In-App Vault' : '.env File'}
              </span>
            </div>

            <div
              style={{
                fontFamily: 'monospace',
                fontSize: 14,
                color: '#E2E8F0',
                letterSpacing: '0.6px',
                padding: '8px 10px',
                backgroundColor: 'rgba(255, 255, 255, 0.04)',
                borderRadius: 8,
                marginBottom: 12,
              }}
            >
              {keyStatus.maskedKey || 'AIza••••••••••••'}
            </div>

            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              <button
                type="button"
                onClick={handleTestCurrentKey}
                disabled={busy}
                style={{
                  padding: '8px 13px',
                  borderRadius: 8,
                  border: '1px solid rgba(78, 205, 196, 0.45)',
                  backgroundColor: 'rgba(78, 205, 196, 0.14)',
                  color: '#4ECDC4',
                  fontSize: 12.5,
                  fontWeight: 700,
                  cursor: busy ? 'not-allowed' : 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                }}
              >
                <span>🧪</span>
                <span>{isTestingCurrent ? 'Testing...' : 'Test Current Key'}</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setIsReplacing((prev) => !prev);
                  setConfirmDelete(false);
                }}
                disabled={busy}
                style={{
                  padding: '8px 13px',
                  borderRadius: 8,
                  border: '1px solid rgba(255, 255, 255, 0.18)',
                  backgroundColor: isReplacing ? 'rgba(255, 255, 255, 0.15)' : 'rgba(255, 255, 255, 0.06)',
                  color: '#F1F5F9',
                  fontSize: 12.5,
                  fontWeight: 600,
                  cursor: busy ? 'not-allowed' : 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                }}
              >
                <span>🔄</span>
                <span>{isReplacing ? 'Cancel Change' : 'Change Key'}</span>
              </button>

              <button
                type="button"
                onClick={handleDeleteKey}
                disabled={busy}
                style={{
                  marginLeft: 'auto',
                  padding: '8px 13px',
                  borderRadius: 8,
                  border: '1px solid rgba(255, 107, 107, 0.45)',
                  backgroundColor: confirmDelete ? '#EF4444' : 'rgba(255, 107, 107, 0.12)',
                  color: confirmDelete ? '#FFFFFF' : '#FF6B6B',
                  fontSize: 12.5,
                  fontWeight: 700,
                  cursor: busy ? 'not-allowed' : 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                }}
              >
                <span>🗑️</span>
                <span>
                  {isDeleting ? 'Deleting...' : confirmDelete ? 'Confirm Delete?' : 'Delete Key'}
                </span>
              </button>
            </div>
          </div>
        )}

        {/* Status Feedback */}
        {statusBanner && (
          <div
            style={{
              marginBottom: 14,
              padding: '10px 13px',
              borderRadius: 10,
              fontSize: 12.5,
              lineHeight: 1.45,
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              backgroundColor:
                statusBanner.kind === 'success'
                  ? 'rgba(56, 239, 125, 0.12)'
                  : statusBanner.kind === 'error'
                  ? 'rgba(255, 107, 107, 0.14)'
                  : 'rgba(78, 205, 196, 0.12)',
              border:
                statusBanner.kind === 'success'
                  ? '1px solid rgba(56, 239, 125, 0.4)'
                  : statusBanner.kind === 'error'
                  ? '1px solid rgba(255, 107, 107, 0.4)'
                  : '1px solid rgba(78, 205, 196, 0.35)',
              color:
                statusBanner.kind === 'success'
                  ? '#6EE7B7'
                  : statusBanner.kind === 'error'
                  ? '#FCA5A5'
                  : '#7DD3FC',
            }}
          >
            <span>{statusBanner.kind === 'success' ? '✅' : statusBanner.kind === 'error' ? '❌' : '⏳'}</span>
            <span style={{ flex: 1 }}>{statusBanner.text}</span>
          </div>
        )}

        {/* Replace / Set New Key Form */}
        {isReplacing && (
          <form
            onSubmit={handleSaveNewKey}
            style={{
              padding: '14px 16px',
              borderRadius: 12,
              backgroundColor: 'rgba(255, 255, 255, 0.03)',
              border: '1px solid rgba(255, 255, 255, 0.1)',
            }}
          >
            <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#CBD5E1', marginBottom: 8 }}>
              Enter New Gemini API Key
            </label>
            <div style={{ position: 'relative', marginBottom: 12 }}>
              <input
                type={showNewKey ? 'text' : 'password'}
                value={newKeyInput}
                onChange={(e) => setNewKeyInput(e.target.value)}
                placeholder="Paste new AIzaSy... key"
                autoFocus
                spellCheck={false}
                autoComplete="off"
                disabled={busy}
                style={{
                  width: '100%',
                  boxSizing: 'border-box',
                  padding: '10px 38px 10px 12px',
                  borderRadius: 8,
                  border: '1px solid rgba(255, 255, 255, 0.2)',
                  backgroundColor: 'rgba(0, 0, 0, 0.45)',
                  color: '#FFFFFF',
                  fontFamily: 'monospace',
                  fontSize: 13,
                  outline: 'none',
                }}
              />
              <button
                type="button"
                onClick={() => setShowNewKey((s) => !s)}
                style={{
                  position: 'absolute',
                  right: 8,
                  top: '50%',
                  transform: 'translateY(-50%)',
                  background: 'none',
                  border: 'none',
                  color: '#94A3B8',
                  cursor: 'pointer',
                  fontSize: 14,
                }}
              >
                {showNewKey ? '🙈' : '👁️'}
              </button>
            </div>

            <div style={{ display: 'flex', gap: 8 }}>
              <button
                type="button"
                onClick={handleTestNewKey}
                disabled={busy || !newKeyInput.trim()}
                style={{
                  padding: '9px 14px',
                  borderRadius: 8,
                  border: '1px solid rgba(78, 205, 196, 0.45)',
                  backgroundColor: 'rgba(78, 205, 196, 0.12)',
                  color: '#4ECDC4',
                  fontWeight: 700,
                  fontSize: 12.5,
                  cursor: busy || !newKeyInput.trim() ? 'not-allowed' : 'pointer',
                  opacity: busy || !newKeyInput.trim() ? 0.5 : 1,
                }}
              >
                🧪 {isTestingNew ? 'Testing...' : 'Test'}
              </button>

              <button
                type="submit"
                disabled={busy || !newKeyInput.trim()}
                style={{
                  flex: 1,
                  padding: '9px 16px',
                  borderRadius: 8,
                  border: 'none',
                  backgroundColor: '#4ECDC4',
                  color: '#121222',
                  fontWeight: 800,
                  fontSize: 13,
                  cursor: busy || !newKeyInput.trim() ? 'not-allowed' : 'pointer',
                  opacity: busy || !newKeyInput.trim() ? 0.5 : 1,
                }}
              >
                💾 {isSavingNew ? 'Testing & Saving...' : 'Verify & Save Key'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
};
