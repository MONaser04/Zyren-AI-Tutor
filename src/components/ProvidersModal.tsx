import React, { useState, useEffect, useMemo } from 'react';
import {
  ALL_PROVIDERS,
  type ProviderDefinition,
  type ProviderStatusSummary,
  type IntermediateModelSettings,
  type ThinkingLevel,
  type TestProviderResult,
} from '../types/providers';

interface ProvidersModalProps {
  isOpen: boolean;
  onClose: () => void;
  onIntermediateModelChanged?: (settings: IntermediateModelSettings) => void;
}

export const ProvidersModal: React.FC<ProvidersModalProps> = ({
  isOpen,
  onClose,
  onIntermediateModelChanged,
}) => {
  const [providers, setProviders] = useState<ProviderStatusSummary[]>([]);
  const [intermediateSettings, setIntermediateSettings] = useState<IntermediateModelSettings>({
    enabled: false,
    providerId: 'nvidia_nim',
    modelId: 'nvidia/nemotron-4-340b-instruct',
    thinkingLevel: 'high',
    customBaseUrl: '',
  });
  const [searchQuery, setSearchQuery] = useState('');
  const [editingProvider, setEditingProvider] = useState<ProviderDefinition | null>(null);
  const [editApiKey, setEditApiKey] = useState('');
  const [editBaseUrl, setEditBaseUrl] = useState('');
  const [editSelectedModel, setEditSelectedModel] = useState('');
  const [editThinkingLevel, setEditThinkingLevel] = useState<ThinkingLevel>('high');
  const [showKey, setShowKey] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [isRefreshingModels, setIsRefreshingModels] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [actionFeedback, setActionFeedback] = useState<{
    kind: 'success' | 'error' | 'info';
    text: string;
    latencyMs?: number;
  } | null>(null);
  const [localModelsCache, setLocalModelsCache] = useState<Record<string, Array<{ id: string; name?: string }>>>({});

  // 1. Fetch initial provider list & intermediate settings
  const loadData = async () => {
    try {
      const [provRes, intRes] = await Promise.all([
        fetch('/api/providers'),
        fetch('/api/intermediate-model'),
      ]);
      if (provRes.ok) {
        const provData = await provRes.json();
        if (Array.isArray(provData.providers)) {
          setProviders(provData.providers);
          const initialCache: Record<string, Array<{ id: string; name?: string }>> = {};
          provData.providers.forEach((p: ProviderStatusSummary) => {
            if (p.cachedModels && p.cachedModels.length > 0) {
              initialCache[p.id] = p.cachedModels;
            }
          });
          setLocalModelsCache((prev) => ({ ...prev, ...initialCache }));
        }
      }
      if (intRes.ok) {
        const intData = await intRes.json();
        if (intData.settings) {
          setIntermediateSettings(intData.settings);
        }
      }
    } catch (e) {
      console.error('[ProvidersModal] Failed to load providers data:', e);
    }
  };

  useEffect(() => {
    if (isOpen) {
      loadData();
      setActionFeedback(null);
      setEditingProvider(null);
    }
  }, [isOpen]);

  // 2. Toggle Intermediate Model on / off
  const handleToggleIntermediate = async () => {
    const nextEnabled = !intermediateSettings.enabled;
    const nextSettings: IntermediateModelSettings = {
      ...intermediateSettings,
      enabled: nextEnabled,
    };
    setIntermediateSettings(nextSettings);
    try {
      const res = await fetch('/api/intermediate-model', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(nextSettings),
      });
      if (res.ok) {
        onIntermediateModelChanged?.(nextSettings);
      }
    } catch (e) {
      console.error('Failed to toggle intermediate model:', e);
    }
  };

  // 3. Open Edit Dialog for a provider
  const handleOpenConfigure = (def: ProviderDefinition) => {
    const currentStatus = providers.find((p) => p.id === def.id);
    setEditingProvider(def);
    setEditApiKey('');
    setEditBaseUrl(currentStatus?.baseUrl || def.defaultBaseUrl || '');
    setEditSelectedModel(currentStatus?.selectedModel || def.defaultModel || '');
    setEditThinkingLevel(currentStatus?.thinkingLevel || 'high');
    setShowKey(false);
    setActionFeedback(null);
  };

  // 4. Test Key / Connection
  const handleTestKey = async (providerId: string, customKey?: string, customBaseUrl?: string) => {
    setIsTesting(true);
    setActionFeedback({ kind: 'info', text: 'Testing connection and verifying API credentials...' });
    try {
      const res = await fetch('/api/providers/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          providerId,
          apiKey: customKey,
          baseUrl: customBaseUrl,
        }),
      });
      const data: TestProviderResult = await res.json();
      if (data.valid) {
        setActionFeedback({
          kind: 'success',
          text: data.message || `Connected successfully (${data.latencyMs}ms)! Found ${data.modelCount ?? 0} models.`,
          latencyMs: data.latencyMs,
        });
      } else {
        setActionFeedback({
          kind: 'error',
          text: data.error || 'Connection test failed. Check API key and base URL.',
        });
      }
    } catch (err: any) {
      setActionFeedback({ kind: 'error', text: err?.message || 'Failed to reach backend test server.' });
    } finally {
      setIsTesting(false);
    }
  };

  // 5. Dynamic Model Refresh (fetches live models from provider)
  const handleRefreshModels = async (providerId: string, customKey?: string, customBaseUrl?: string) => {
    setIsRefreshingModels(providerId);
    setActionFeedback({ kind: 'info', text: 'Fetching live updated model catalog from provider...' });
    try {
      const res = await fetch('/api/providers/models', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          providerId,
          apiKey: customKey,
          baseUrl: customBaseUrl,
        }),
      });
      const data = await res.json();
      if (data.ok && Array.isArray(data.models)) {
        setLocalModelsCache((prev) => ({ ...prev, [providerId]: data.models }));
        setProviders((prev) =>
          prev.map((p) =>
            p.id === providerId
              ? { ...p, cachedModelsCount: data.models.length, cachedModels: data.models }
              : p
          )
        );
        setActionFeedback({
          kind: 'success',
          text: `Retrieved ${data.models.length} live models (${data.latencyMs || 1}ms)!`,
          latencyMs: data.latencyMs,
        });
        if (data.models.length > 0 && !editSelectedModel) {
          setEditSelectedModel(data.models[0].id);
        }
      } else {
        setActionFeedback({
          kind: 'error',
          text: data.error || 'Could not fetch models. Verify your API key.',
        });
      }
    } catch (err: any) {
      setActionFeedback({ kind: 'error', text: err?.message || 'Network error fetching models.' });
    } finally {
      setIsRefreshingModels(null);
    }
  };

  // 6. Save Provider Config
  const handleSaveConfig = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!editingProvider) return;

    setIsSaving(true);
    setActionFeedback({ kind: 'info', text: 'Saving provider configuration...' });

    try {
      const res = await fetch('/api/providers/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          providerId: editingProvider.id,
          apiKey: editApiKey.trim() || undefined,
          baseUrl: editBaseUrl.trim() || undefined,
          selectedModel: editSelectedModel.trim() || undefined,
          thinkingLevel: editThinkingLevel,
          cachedModels: localModelsCache[editingProvider.id] || undefined,
        }),
      });
      const data = await res.json();
      if (data.ok && data.provider) {
        setProviders((prev) =>
          prev.map((p) => (p.id === data.provider.id ? data.provider : p))
        );
        setActionFeedback({
          kind: 'success',
          text: `Settings for '${editingProvider.name}' saved and verified!`,
        });
        setTimeout(() => {
          setEditingProvider(null);
        }, 1200);
      } else {
        setActionFeedback({ kind: 'error', text: data.error || 'Failed to save configuration.' });
      }
    } catch (err: any) {
      setActionFeedback({ kind: 'error', text: err?.message || 'Network error saving config.' });
    } finally {
      setIsSaving(false);
    }
  };

  // 7. Delete Key
  const handleDeleteKey = async (providerId: string) => {
    try {
      const res = await fetch(`/api/providers/key?providerId=${encodeURIComponent(providerId)}`, {
        method: 'DELETE',
      });
      if (res.ok) {
        setProviders((prev) =>
          prev.map((p) =>
            p.id === providerId
              ? { ...p, configured: false, maskedKey: null, selectedModel: '' }
              : p
          )
        );
        if (editingProvider?.id === providerId) {
          setEditApiKey('');
        }
      }
    } catch (e) {
      console.error('Failed to delete key:', e);
    }
  };

  // 8. Set as active intermediate model
  const handleSetAsActiveIntermediate = async (providerId: string, modelId?: string) => {
    const prov = providers.find((p) => p.id === providerId);
    const chosenModel = modelId || prov?.selectedModel || ALL_PROVIDERS.find((p) => p.id === providerId)?.defaultModel || 'default-model';
    const nextSettings: IntermediateModelSettings = {
      enabled: true,
      providerId,
      modelId: chosenModel,
      thinkingLevel: prov?.thinkingLevel || 'high',
      customBaseUrl: prov?.baseUrl || '',
    };
    setIntermediateSettings(nextSettings);
    try {
      await fetch('/api/intermediate-model', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(nextSettings),
      });
      onIntermediateModelChanged?.(nextSettings);
      setActionFeedback({
        kind: 'success',
        text: `Active Intermediate Model set to '${chosenModel}' (${providerId})!`,
      });
    } catch (e) {
      console.error(e);
    }
  };

  const filteredProviders = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return ALL_PROVIDERS;
    return ALL_PROVIDERS.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        p.id.toLowerCase().includes(q) ||
        p.description.toLowerCase().includes(q) ||
        (p.badge && p.badge.toLowerCase().includes(q))
    );
  }, [searchQuery]);

  if (!isOpen) return null;

  return (
    <div
      className="providers-modal-backdrop"
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(5, 6, 14, 0.82)',
        backdropFilter: 'blur(12px)',
        zIndex: 99999,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
        boxSizing: 'border-box',
        fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
      }}
      onClick={onClose}
      onPointerDown={(e) => e.stopPropagation()}
      onWheel={(e) => e.stopPropagation()}
    >
      <div
        className="providers-modal-window"
        style={{
          width: '100%',
          maxWidth: 1180,
          maxHeight: '92vh',
          backgroundColor: '#0F111A',
          border: '1px solid rgba(255, 255, 255, 0.12)',
          borderRadius: 16,
          boxShadow: '0 30px 80px rgba(0, 0, 0, 0.85), 0 0 50px rgba(78, 205, 196, 0.08)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          color: '#FFFFFF',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Top Header */}
        <div
          style={{
            padding: '20px 28px',
            borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            background: 'linear-gradient(180deg, rgba(255,255,255,0.02), transparent)',
            gap: 20,
            flexWrap: 'wrap',
          }}
        >
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700, letterSpacing: '-0.3px' }}>
                Providers & Intermediate Model
              </h2>
              <span
                style={{
                  fontSize: 11,
                  padding: '3px 10px',
                  borderRadius: 999,
                  fontWeight: 700,
                  backgroundColor: intermediateSettings.enabled
                    ? 'rgba(56, 239, 125, 0.16)'
                    : 'rgba(255, 255, 255, 0.08)',
                  color: intermediateSettings.enabled ? '#38EF7D' : 'rgba(255, 255, 255, 0.6)',
                  border: intermediateSettings.enabled
                    ? '1px solid rgba(56, 239, 125, 0.35)'
                    : '1px solid rgba(255, 255, 255, 0.12)',
                }}
              >
                {intermediateSettings.enabled ? '● Intermediate Active' : '○ Native Live Voice'}
              </span>
            </div>
            <p style={{ margin: '4px 0 0', fontSize: 12.5, color: 'rgba(255, 255, 255, 0.6)' }}>
              Enable a dedicated executive model (e.g. Nemotron, DeepSeek-R1) to handle complex whiteboard execution while keeping voice lightning-fast.
            </p>
          </div>

          {/* Master Enable/Disable Toggle */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                padding: '8px 16px',
                borderRadius: 12,
                backgroundColor: 'rgba(255, 255, 255, 0.04)',
                border: '1px solid rgba(255, 255, 255, 0.1)',
              }}
            >
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: 12, fontWeight: 700 }}>
                  {intermediateSettings.enabled ? 'Executive Delegation ON' : 'Native Gemini Voice ON'}
                </div>
                <div style={{ fontSize: 11, color: 'rgba(255, 255, 255, 0.5)' }}>
                  {intermediateSettings.enabled ? `${intermediateSettings.providerId} / ${intermediateSettings.modelId.split('/').pop()}` : 'Single Model Mode'}
                </div>
              </div>
              <button
                type="button"
                onClick={handleToggleIntermediate}
                style={{
                  width: 48,
                  height: 26,
                  borderRadius: 14,
                  backgroundColor: intermediateSettings.enabled ? '#38EF7D' : 'rgba(255, 255, 255, 0.2)',
                  border: 'none',
                  cursor: 'pointer',
                  position: 'relative',
                  transition: 'background-color 0.2s',
                  padding: 2,
                }}
              >
                <div
                  style={{
                    width: 22,
                    height: 22,
                    borderRadius: '50%',
                    backgroundColor: '#FFFFFF',
                    transform: intermediateSettings.enabled ? 'translateX(22px)' : 'translateX(0)',
                    transition: 'transform 0.2s',
                    boxShadow: '0 2px 6px rgba(0,0,0,0.3)',
                  }}
                />
              </button>
            </div>

            <button
              type="button"
              onClick={onClose}
              style={{
                background: 'rgba(255, 255, 255, 0.06)',
                border: 'none',
                color: 'rgba(255, 255, 255, 0.6)',
                width: 34,
                height: 34,
                borderRadius: 10,
                cursor: 'pointer',
                fontSize: 16,
              }}
            >
              ✕
            </button>
          </div>
        </div>

        {/* Search & Stats Bar */}
        <div
          style={{
            padding: '12px 28px',
            borderBottom: '1px solid rgba(255, 255, 255, 0.06)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 16,
            backgroundColor: 'rgba(0, 0, 0, 0.2)',
          }}
        >
          <div style={{ position: 'relative', flex: 1, maxWidth: 360 }}>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search providers (NVIDIA NIM, Groq, Ollama, DeepSeek...)"
              style={{
                width: '100%',
                padding: '8px 12px 8px 32px',
                borderRadius: 8,
                backgroundColor: 'rgba(255, 255, 255, 0.05)',
                border: '1px solid rgba(255, 255, 255, 0.12)',
                color: '#FFFFFF',
                fontSize: 12.5,
                outline: 'none',
                boxSizing: 'border-box',
              }}
            />
            <span style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', fontSize: 13, color: 'rgba(255, 255, 255, 0.4)' }}>
              🔍
            </span>
          </div>

          <div style={{ fontSize: 12, color: 'rgba(255, 255, 255, 0.5)' }}>
            Showing {filteredProviders.length} of {ALL_PROVIDERS.length} Providers
          </div>
        </div>

        {/* Provider Cards Grid Body */}
        <div
          style={{
            flex: 1,
            overflowY: 'auto',
            padding: 24,
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(250px, 1fr))',
            gap: 14,
            alignContent: 'start',
          }}
        >
          {filteredProviders.map((def) => {
            const status = providers.find((p) => p.id === def.id);
            const isConfigured = Boolean(status?.configured);
            const isSelectedAsIntermediate =
              intermediateSettings.enabled && intermediateSettings.providerId === def.id;
            const models = localModelsCache[def.id] || status?.cachedModels || [];

            return (
              <div
                key={def.id}
                style={{
                  backgroundColor: isSelectedAsIntermediate
                    ? 'rgba(78, 205, 196, 0.08)'
                    : isConfigured
                    ? 'rgba(255, 255, 255, 0.03)'
                    : 'rgba(255, 255, 255, 0.015)',
                  border: isSelectedAsIntermediate
                    ? '1.5px solid #4ECDC4'
                    : isConfigured
                    ? '1px solid rgba(56, 239, 125, 0.3)'
                    : '1px solid rgba(255, 255, 255, 0.08)',
                  borderRadius: 12,
                  padding: '14px 16px',
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'space-between',
                  gap: 12,
                  transition: 'all 0.15s ease',
                  position: 'relative',
                }}
              >
                <div>
                  {/* Card Title & Status Badge */}
                  <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 6, marginBottom: 6 }}>
                    <div style={{ fontWeight: 700, fontSize: 14, color: '#FFFFFF', lineHeight: 1.2 }}>
                      {def.name}
                    </div>
                    <span
                      style={{
                        fontSize: 10,
                        fontWeight: 700,
                        padding: '2px 7px',
                        borderRadius: 4,
                        whiteSpace: 'nowrap',
                        backgroundColor: isConfigured
                          ? 'rgba(56, 239, 125, 0.15)'
                          : 'rgba(255, 171, 0, 0.15)',
                        color: isConfigured ? '#38EF7D' : '#FFAB00',
                        border: isConfigured
                          ? '1px solid rgba(56, 239, 125, 0.35)'
                          : '1px solid rgba(255, 171, 0, 0.35)',
                      }}
                    >
                      {isConfigured ? 'CONFIGURED' : 'MISSING KEY'}
                    </span>
                  </div>

                  {/* Masked Key or Env Key hint */}
                  <div style={{ fontSize: 11, color: 'rgba(255, 255, 255, 0.45)', fontFamily: 'monospace', marginBottom: 8 }}>
                    {status?.maskedKey || def.envKeyName || 'LOCAL ENDPOINT'}
                  </div>

                  {/* Provider Short Description */}
                  <p style={{ margin: 0, fontSize: 11.5, color: 'rgba(255, 255, 255, 0.65)', lineHeight: 1.35, minHeight: 32 }}>
                    {def.description}
                  </p>

                  {/* Selected Model Preview if configured */}
                  {isConfigured && (
                    <div style={{ marginTop: 8, fontSize: 11, color: '#4ECDC4', display: 'flex', alignItems: 'center', gap: 5 }}>
                      <span>🤖</span>
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {status?.selectedModel || def.defaultModel || 'Default Model'}
                      </span>
                    </div>
                  )}
                </div>

                {/* Card Actions */}
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, paddingTop: 10, borderTop: '1px solid rgba(255, 255, 255, 0.06)' }}>
                  {isConfigured ? (
                    <>
                      <button
                        type="button"
                        onClick={() => handleOpenConfigure(def)}
                        style={{
                          flex: 1,
                          padding: '6px 10px',
                          borderRadius: 6,
                          backgroundColor: 'rgba(255, 255, 255, 0.08)',
                          border: '1px solid rgba(255, 255, 255, 0.15)',
                          color: '#FFFFFF',
                          fontSize: 11.5,
                          fontWeight: 600,
                          cursor: 'pointer',
                        }}
                      >
                        Edit
                      </button>

                      <button
                        type="button"
                        disabled={isRefreshingModels === def.id}
                        onClick={() => handleRefreshModels(def.id)}
                        style={{
                          padding: '6px 10px',
                          borderRadius: 6,
                          backgroundColor: 'rgba(78, 205, 196, 0.12)',
                          border: '1px solid rgba(78, 205, 196, 0.3)',
                          color: '#4ECDC4',
                          fontSize: 11,
                          fontWeight: 600,
                          cursor: isRefreshingModels === def.id ? 'wait' : 'pointer',
                        }}
                      >
                        {isRefreshingModels === def.id ? 'Refreshing...' : 'Refresh models'}
                      </button>

                      <button
                        type="button"
                        onClick={() => handleSetAsActiveIntermediate(def.id)}
                        style={{
                          width: '100%',
                          padding: '5px 8px',
                          borderRadius: 6,
                          backgroundColor: isSelectedAsIntermediate
                            ? 'rgba(56, 239, 125, 0.2)'
                            : 'rgba(255, 255, 255, 0.04)',
                          border: isSelectedAsIntermediate
                            ? '1px solid #38EF7D'
                            : '1px solid rgba(255, 255, 255, 0.1)',
                          color: isSelectedAsIntermediate ? '#38EF7D' : 'rgba(255, 255, 255, 0.8)',
                          fontSize: 11,
                          fontWeight: 600,
                          cursor: 'pointer',
                        }}
                      >
                        {isSelectedAsIntermediate ? '✓ Active Intermediate' : 'Use as Intermediate'}
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      onClick={() => handleOpenConfigure(def)}
                      style={{
                        width: '100%',
                        padding: '7px 12px',
                        borderRadius: 6,
                        backgroundColor: 'rgba(255, 255, 255, 0.07)',
                        border: '1px solid rgba(255, 255, 255, 0.18)',
                        color: '#FFFFFF',
                        fontSize: 12,
                        fontWeight: 600,
                        cursor: 'pointer',
                      }}
                    >
                      Configure
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* Configure / Edit Modal Sub-Dialog */}
        {editingProvider && (
          <div
            style={{
              position: 'fixed',
              inset: 0,
              backgroundColor: 'rgba(0, 0, 0, 0.75)',
              backdropFilter: 'blur(8px)',
              zIndex: 100000,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: 20,
            }}
            onClick={() => setEditingProvider(null)}
          >
            <div
              style={{
                width: '100%',
                maxWidth: 540,
                backgroundColor: '#161926',
                border: '1px solid rgba(78, 205, 196, 0.4)',
                borderRadius: 16,
                padding: 24,
                boxShadow: '0 24px 60px rgba(0, 0, 0, 0.9)',
                color: '#FFFFFF',
              }}
              onClick={(e) => e.stopPropagation()}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
                <div>
                  <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>
                    Configure {editingProvider.name}
                  </h3>
                  <div style={{ fontSize: 11.5, color: '#94A3B8', marginTop: 2 }}>
                    {editingProvider.badge || editingProvider.description}
                  </div>
                </div>
                <button
                  onClick={() => setEditingProvider(null)}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: 'rgba(255, 255, 255, 0.5)',
                    fontSize: 20,
                    cursor: 'pointer',
                  }}
                >
                  ✕
                </button>
              </div>

              {editingProvider.docUrl && (
                <div style={{ marginBottom: 14, fontSize: 12 }}>
                  <a
                    href={editingProvider.docUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ color: '#4ECDC4', textDecoration: 'none', fontWeight: 600 }}
                  >
                    Open {editingProvider.name} Documentation & API Keys ↗
                  </a>
                </div>
              )}

              <form onSubmit={handleSaveConfig}>
                {/* API Key Field */}
                {!editingProvider.isLocal && (
                  <div style={{ marginBottom: 14 }}>
                    <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 6, color: '#D0D4E8' }}>
                      API Key
                    </label>
                    <div style={{ position: 'relative' }}>
                      <input
                        type={showKey ? 'text' : 'password'}
                        value={editApiKey}
                        onChange={(e) => setEditApiKey(e.target.value)}
                        placeholder={providers.find((p) => p.id === editingProvider.id)?.maskedKey || 'Paste API key...'}
                        style={{
                          width: '100%',
                          padding: '10px 40px 10px 12px',
                          borderRadius: 8,
                          backgroundColor: 'rgba(0, 0, 0, 0.4)',
                          border: '1px solid rgba(255, 255, 255, 0.18)',
                          color: '#FFFFFF',
                          fontFamily: 'monospace',
                          fontSize: 13,
                          boxSizing: 'border-box',
                        }}
                      />
                      <button
                        type="button"
                        onClick={() => setShowKey((s) => !s)}
                        style={{
                          position: 'absolute',
                          right: 10,
                          top: '50%',
                          transform: 'translateY(-50%)',
                          background: 'none',
                          border: 'none',
                          color: '#9CA3AF',
                          cursor: 'pointer',
                        }}
                      >
                        {showKey ? '🙈' : '👁️'}
                      </button>
                    </div>
                  </div>
                )}

                {/* Base URL Field */}
                <div style={{ marginBottom: 14 }}>
                  <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 6, color: '#D0D4E8' }}>
                    Base URL / Endpoint
                  </label>
                  <input
                    type="text"
                    value={editBaseUrl}
                    onChange={(e) => setEditBaseUrl(e.target.value)}
                    placeholder={editingProvider.defaultBaseUrl || 'http://localhost:8000/v1'}
                    style={{
                      width: '100%',
                      padding: '10px 12px',
                      borderRadius: 8,
                      backgroundColor: 'rgba(0, 0, 0, 0.4)',
                      border: '1px solid rgba(255, 255, 255, 0.18)',
                      color: '#FFFFFF',
                      fontFamily: 'monospace',
                      fontSize: 12.5,
                      boxSizing: 'border-box',
                    }}
                  />
                </div>

                {/* Model Selection with Refresh Button */}
                <div style={{ marginBottom: 14 }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                    <label style={{ fontSize: 12, fontWeight: 600, color: '#D0D4E8' }}>
                      Selected Model ID
                    </label>
                    <button
                      type="button"
                      disabled={isRefreshingModels === editingProvider.id}
                      onClick={() => handleRefreshModels(editingProvider.id, editApiKey, editBaseUrl)}
                      style={{
                        background: 'none',
                        border: 'none',
                        color: '#4ECDC4',
                        fontSize: 11.5,
                        fontWeight: 700,
                        cursor: 'pointer',
                        textDecoration: 'underline',
                      }}
                    >
                      {isRefreshingModels === editingProvider.id ? 'Refreshing...' : '🔄 Refresh models live'}
                    </button>
                  </div>

                  {localModelsCache[editingProvider.id]?.length ? (
                    <select
                      value={editSelectedModel}
                      onChange={(e) => setEditSelectedModel(e.target.value)}
                      style={{
                        width: '100%',
                        padding: '10px 12px',
                        borderRadius: 8,
                        backgroundColor: '#1E2235',
                        border: '1px solid rgba(78, 205, 196, 0.35)',
                        color: '#FFFFFF',
                        fontSize: 13,
                        boxSizing: 'border-box',
                      }}
                    >
                      <option value="">Choose from {localModelsCache[editingProvider.id].length} live models...</option>
                      {localModelsCache[editingProvider.id].map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.name && m.name !== m.id ? `${m.name} (${m.id})` : m.id}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      type="text"
                      value={editSelectedModel}
                      onChange={(e) => setEditSelectedModel(e.target.value)}
                      placeholder={editingProvider.modelPlaceholder || 'Model ID (e.g. nvidia/nemotron-4-340b-instruct)'}
                      style={{
                        width: '100%',
                        padding: '10px 12px',
                        borderRadius: 8,
                        backgroundColor: 'rgba(0, 0, 0, 0.4)',
                        border: '1px solid rgba(255, 255, 255, 0.18)',
                        color: '#FFFFFF',
                        fontFamily: 'monospace',
                        fontSize: 12.5,
                        boxSizing: 'border-box',
                      }}
                    />
                  )}
                </div>

                {/* Thinking Mode Level Selector */}
                <div style={{ marginBottom: 18 }}>
                  <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 8, color: '#D0D4E8' }}>
                    Thinking Mode Level
                  </label>
                  <div style={{ display: 'flex', gap: 6 }}>
                    {(['off', 'minimal', 'low', 'medium', 'high'] as ThinkingLevel[]).map((lvl) => {
                      const active = editThinkingLevel === lvl;
                      return (
                        <button
                          key={lvl}
                          type="button"
                          onClick={() => setEditThinkingLevel(lvl)}
                          style={{
                            flex: 1,
                            padding: '7px 4px',
                            borderRadius: 6,
                            border: active ? '1px solid #4ECDC4' : '1px solid rgba(255, 255, 255, 0.15)',
                            backgroundColor: active ? 'rgba(78, 205, 196, 0.25)' : 'rgba(255, 255, 255, 0.05)',
                            color: active ? '#4ECDC4' : 'rgba(255, 255, 255, 0.7)',
                            fontSize: 11.5,
                            fontWeight: 700,
                            textTransform: 'capitalize',
                            cursor: 'pointer',
                          }}
                        >
                          {lvl}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {actionFeedback && (
                  <div
                    style={{
                      marginBottom: 16,
                      padding: '10px 12px',
                      borderRadius: 8,
                      fontSize: 12,
                      backgroundColor:
                        actionFeedback.kind === 'success'
                          ? 'rgba(56, 239, 125, 0.12)'
                          : actionFeedback.kind === 'error'
                          ? 'rgba(255, 107, 107, 0.12)'
                          : 'rgba(78, 205, 196, 0.12)',
                      border:
                        actionFeedback.kind === 'success'
                          ? '1px solid rgba(56, 239, 125, 0.4)'
                          : actionFeedback.kind === 'error'
                          ? '1px solid rgba(255, 107, 107, 0.4)'
                          : '1px solid rgba(78, 205, 196, 0.4)',
                      color:
                        actionFeedback.kind === 'success'
                          ? '#6EE7B7'
                          : actionFeedback.kind === 'error'
                          ? '#FCA5A5'
                          : '#7DD3FC',
                    }}
                  >
                    {actionFeedback.text}
                  </div>
                )}

                <div style={{ display: 'flex', gap: 8, justifyContent: 'space-between' }}>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button
                      type="button"
                      disabled={isTesting}
                      onClick={() => handleTestKey(editingProvider.id, editApiKey, editBaseUrl)}
                      style={{
                        padding: '10px 14px',
                        borderRadius: 8,
                        backgroundColor: 'rgba(78, 205, 196, 0.12)',
                        border: '1px solid rgba(78, 205, 196, 0.35)',
                        color: '#4ECDC4',
                        fontSize: 12.5,
                        fontWeight: 700,
                        cursor: isTesting ? 'wait' : 'pointer',
                      }}
                    >
                      {isTesting ? 'Testing...' : 'Test Connection'}
                    </button>

                    <button
                      type="button"
                      onClick={() => handleDeleteKey(editingProvider.id)}
                      style={{
                        padding: '10px 12px',
                        borderRadius: 8,
                        backgroundColor: 'rgba(255, 107, 107, 0.1)',
                        border: '1px solid rgba(255, 107, 107, 0.3)',
                        color: '#FF6B6B',
                        fontSize: 12,
                        cursor: 'pointer',
                      }}
                    >
                      Delete Key
                    </button>
                  </div>

                  <div style={{ display: 'flex', gap: 8 }}>
                    <button
                      type="button"
                      onClick={() => setEditingProvider(null)}
                      style={{
                        padding: '10px 14px',
                        borderRadius: 8,
                        backgroundColor: 'transparent',
                        border: '1px solid rgba(255, 255, 255, 0.15)',
                        color: 'rgba(255, 255, 255, 0.7)',
                        fontSize: 12.5,
                        cursor: 'pointer',
                      }}
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={isSaving}
                      style={{
                        padding: '10px 18px',
                        borderRadius: 8,
                        backgroundColor: '#4ECDC4',
                        border: 'none',
                        color: '#12151D',
                        fontSize: 12.5,
                        fontWeight: 800,
                        cursor: isSaving ? 'wait' : 'pointer',
                      }}
                    >
                      {isSaving ? 'Saving...' : 'Save Configuration'}
                    </button>
                  </div>
                </div>
              </form>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
