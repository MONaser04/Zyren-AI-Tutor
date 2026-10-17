import React, { useState, useEffect } from 'react';

export type ThinkingLevel = 'minimal' | 'low' | 'medium' | 'high';

export interface AIModelConfig {
  id: string;
  name: string;
  badge: string;
  description: string;
  supportedThinkingLevels: ThinkingLevel[];
  defaultThinkingLevel?: ThinkingLevel;
  icon: string;
  gradient: string;
}

export const SUPPORTED_MODELS: AIModelConfig[] = [
  {
    id: 'gemini-3.8-live-extended-thinking',
    name: 'Gemini 3.8 Live',
    badge: 'Extended Thinking',
    description: 'Deep mathematical, scientific, and Socratic reasoning with step-by-step internal deliberation.',
    supportedThinkingLevels: ['low', 'medium', 'high'],
    defaultThinkingLevel: 'high',
    icon: '🧠',
    gradient: 'linear-gradient(135deg, rgba(168, 85, 247, 0.25), rgba(78, 205, 196, 0.25))',
  },
  {
    id: 'gemini-3.8-live',
    name: 'Gemini 3.8 Live',
    badge: 'Ultra-Fast Realtime',
    description: 'Ultra-low latency conversational audio with instantaneous verbal turn-taking and zero thinking delay.',
    supportedThinkingLevels: [],
    icon: '⚡',
    gradient: 'linear-gradient(135deg, rgba(56, 239, 125, 0.25), rgba(78, 205, 196, 0.25))',
  },
  {
    id: 'gemini-3.1-flash-live-preview',
    name: 'Gemini 3.1 Flash Live',
    badge: 'Flash Live Preview',
    description: 'Lightweight, agile multimodal live preview model with configurable thinking depth.',
    supportedThinkingLevels: ['minimal', 'low', 'medium', 'high'],
    defaultThinkingLevel: 'low',
    icon: '🚀',
    gradient: 'linear-gradient(135deg, rgba(255, 171, 0, 0.25), rgba(255, 107, 107, 0.25))',
  },
];

interface ModelSelectorModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentModel: string;
  currentThinkingLevel?: string;
  onSelectModel: (modelId: string, thinkingLevel?: string) => void;
}

export const ModelSelectorModal: React.FC<ModelSelectorModalProps> = ({
  isOpen,
  onClose,
  currentModel,
  currentThinkingLevel = 'high',
  onSelectModel,
}) => {
  const [selectedModelId, setSelectedModelId] = useState<string>(currentModel);
  const [selectedThinkingLevel, setSelectedThinkingLevel] = useState<ThinkingLevel>(
    (currentThinkingLevel as ThinkingLevel) || 'high'
  );

  // Sync state only when modal opens
  useEffect(() => {
    if (isOpen) {
      setSelectedModelId(currentModel);
      setSelectedThinkingLevel((currentThinkingLevel as ThinkingLevel) || 'high');
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const activeModelConfig = SUPPORTED_MODELS.find((m) => m.id === selectedModelId) || SUPPORTED_MODELS[0];

  const handleModelChange = (model: AIModelConfig) => {
    setSelectedModelId(model.id);
    if (model.supportedThinkingLevels.length > 0) {
      if (!model.supportedThinkingLevels.includes(selectedThinkingLevel)) {
        setSelectedThinkingLevel(model.defaultThinkingLevel || model.supportedThinkingLevels[0]);
      }
    }
  };

  const handleApply = (overrideModelId?: string, overrideThinking?: ThinkingLevel) => {
    const targetModelId = overrideModelId || selectedModelId;
    const targetConfig = SUPPORTED_MODELS.find((m) => m.id === targetModelId) || activeModelConfig;
    const thinkingToPass =
      targetConfig.supportedThinkingLevels.length > 0
        ? overrideThinking || selectedThinkingLevel
        : undefined;
    onSelectModel(targetModelId, thinkingToPass);
    onClose();
  };

  return (
    <div
      className="model-modal-backdrop voice-modal-backdrop"
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.75)',
        backdropFilter: 'blur(8px)',
        zIndex: 99999,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 20,
        boxSizing: 'border-box',
      }}
      onClick={onClose}
      onPointerDown={(e) => e.stopPropagation()}
      onPointerUp={(e) => e.stopPropagation()}
      onWheel={(e) => e.stopPropagation()}
    >
      <div
        className="model-modal-container model-modal-content voice-modal-container voice-modal-content"
        style={{
          backgroundColor: '#161922',
          border: '1px solid rgba(255, 255, 255, 0.15)',
          borderRadius: 16,
          width: '100%',
          maxWidth: 620,
          boxShadow: '0 24px 64px rgba(0, 0, 0, 0.85)',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
          maxHeight: '90vh',
        }}
        onClick={(e) => e.stopPropagation()}
        onPointerDown={(e) => e.stopPropagation()}
        onPointerUp={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          style={{
            padding: '20px 24px',
            borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            background: 'linear-gradient(180deg, rgba(255,255,255,0.03), transparent)',
          }}
        >
          <div>
            <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: '#FFFFFF', display: 'flex', alignItems: 'center', gap: 8 }}>
              <span>🤖</span> Choose AI Live Model
            </h3>
            <p style={{ margin: '4px 0 0 0', fontSize: 12, color: 'rgba(255, 255, 255, 0.6)' }}>
              Switch dynamically in real time. Conversation history & whiteboard state are 100% preserved.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            onPointerDown={(e) => e.stopPropagation()}
            onPointerUp={(e) => e.stopPropagation()}
            style={{
              background: 'transparent',
              border: 'none',
              color: 'rgba(255, 255, 255, 0.5)',
              fontSize: 22,
              cursor: 'pointer',
              padding: 4,
              lineHeight: 1,
            }}
          >
            ×
          </button>
        </div>

        {/* Content Body */}
        <div
          style={{
            padding: '20px 24px',
            overflowY: 'auto',
            display: 'flex',
            flexDirection: 'column',
            gap: 14,
          }}
          onWheel={(e) => e.stopPropagation()}
        >
          {SUPPORTED_MODELS.map((model) => {
            const isSelected = selectedModelId === model.id;
            return (
              <div
                key={model.id}
                role="button"
                tabIndex={0}
                className="model-card voice-card interactive"
                onClick={() => handleModelChange(model)}
                onDoubleClick={() => {
                  handleModelChange(model);
                  const thinking =
                    model.supportedThinkingLevels.length > 0
                      ? model.supportedThinkingLevels.includes(selectedThinkingLevel)
                        ? selectedThinkingLevel
                        : model.defaultThinkingLevel || model.supportedThinkingLevels[0]
                      : undefined;
                  handleApply(model.id, thinking);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    handleModelChange(model);
                  }
                }}
                onPointerDown={(e) => e.stopPropagation()}
                onPointerUp={(e) => e.stopPropagation()}
                style={{
                  border: isSelected ? '2px solid #4ECDC4' : '1px solid rgba(255, 255, 255, 0.1)',
                  borderRadius: 12,
                  padding: 16,
                  cursor: 'pointer',
                  backgroundColor: isSelected ? 'rgba(78, 205, 196, 0.08)' : 'rgba(255, 255, 255, 0.02)',
                  boxShadow: isSelected ? '0 0 20px rgba(78, 205, 196, 0.2)' : 'none',
                  transition: 'all 0.18s ease',
                  position: 'relative',
                  userSelect: 'none',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span style={{ fontSize: 20 }}>{model.icon}</span>
                    <span style={{ fontWeight: 700, fontSize: 15, color: '#FFFFFF' }}>{model.name}</span>
                    <span
                      style={{
                        fontSize: 11,
                        padding: '2px 8px',
                        borderRadius: 999,
                        backgroundColor: isSelected ? 'rgba(78, 205, 196, 0.25)' : 'rgba(255, 255, 255, 0.08)',
                        color: isSelected ? '#4ECDC4' : 'rgba(255, 255, 255, 0.7)',
                        fontWeight: 600,
                      }}
                    >
                      {model.badge}
                    </span>
                  </div>
                  <div
                    role="radio"
                    aria-checked={isSelected}
                    style={{
                      width: 18,
                      height: 18,
                      borderRadius: '50%',
                      border: isSelected ? '5px solid #4ECDC4' : '2px solid rgba(255, 255, 255, 0.3)',
                      backgroundColor: isSelected ? '#FFFFFF' : 'transparent',
                      transition: 'all 0.15s ease',
                      flexShrink: 0,
                    }}
                  />
                </div>
                <p style={{ margin: 0, fontSize: 13, color: 'rgba(255, 255, 255, 0.7)', lineHeight: 1.4 }}>
                  {model.description}
                </p>

                {/* Thinking Level Selector inside selected card if supported */}
                {isSelected && model.supportedThinkingLevels.length > 0 && (
                  <div
                    style={{
                      marginTop: 14,
                      paddingTop: 12,
                      borderTop: '1px solid rgba(255, 255, 255, 0.08)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      flexWrap: 'wrap',
                      gap: 10,
                    }}
                    onClick={(e) => e.stopPropagation()}
                    onPointerDown={(e) => e.stopPropagation()}
                    onPointerUp={(e) => e.stopPropagation()}
                  >
                    <div style={{ fontSize: 12, fontWeight: 600, color: '#4ECDC4', display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span>⚙️</span> Thinking Level:
                    </div>
                    <div style={{ display: 'flex', gap: 6 }}>
                      {model.supportedThinkingLevels.map((lvl) => {
                        const isLvlActive = selectedThinkingLevel === lvl;
                        return (
                          <button
                            key={lvl}
                            type="button"
                            className="model-thinking-btn interactive"
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelectedThinkingLevel(lvl);
                            }}
                            onPointerDown={(e) => e.stopPropagation()}
                            onPointerUp={(e) => e.stopPropagation()}
                            style={{
                              padding: '5px 12px',
                              fontSize: 12,
                              fontWeight: 600,
                              textTransform: 'capitalize',
                              borderRadius: 6,
                              cursor: 'pointer',
                              border: isLvlActive ? '1px solid #4ECDC4' : '1px solid rgba(255, 255, 255, 0.15)',
                              backgroundColor: isLvlActive ? 'rgba(78, 205, 196, 0.25)' : 'rgba(255, 255, 255, 0.05)',
                              color: isLvlActive ? '#4ECDC4' : 'rgba(255, 255, 255, 0.8)',
                              transition: 'all 0.15s ease',
                            }}
                          >
                            {lvl}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Footer */}
        <div
          style={{
            padding: '16px 24px',
            borderTop: '1px solid rgba(255, 255, 255, 0.08)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            backgroundColor: 'rgba(0, 0, 0, 0.2)',
          }}
          onPointerDown={(e) => e.stopPropagation()}
          onPointerUp={(e) => e.stopPropagation()}
        >
          <div style={{ fontSize: 12, color: 'rgba(78, 205, 196, 0.9)', display: 'flex', alignItems: 'center', gap: 5 }}>
            <span>🔄</span> Seamless mid-session switch
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <button
              type="button"
              onClick={onClose}
              onPointerDown={(e) => e.stopPropagation()}
              onPointerUp={(e) => e.stopPropagation()}
              style={{
                padding: '8px 16px',
                fontSize: 13,
                fontWeight: 600,
                color: 'rgba(255, 255, 255, 0.7)',
                backgroundColor: 'transparent',
                border: '1px solid rgba(255, 255, 255, 0.15)',
                borderRadius: 8,
                cursor: 'pointer',
              }}
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => handleApply()}
              onPointerDown={(e) => e.stopPropagation()}
              onPointerUp={(e) => e.stopPropagation()}
              style={{
                padding: '8px 20px',
                fontSize: 13,
                fontWeight: 600,
                color: '#12151D',
                backgroundColor: '#4ECDC4',
                border: 'none',
                borderRadius: 8,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                boxShadow: '0 4px 14px rgba(78, 205, 196, 0.35)',
              }}
            >
              <span>✓</span> Apply & Continue
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
