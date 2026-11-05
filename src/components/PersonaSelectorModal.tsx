import React from 'react';

export type VerbosityMode = 'balanced' | 'concise' | 'adaptive' | 'detailed';
export type VocalToneMode = 'natural' | 'serious' | 'friendly' | 'playful' | 'empathetic' | 'calm' | 'strict';
export type LearnerProfileMode = 'general' | 'child' | 'youth' | 'professional' | 'educator' | 'senior';

export interface SpeakingStyleConfig {
  verbosity: VerbosityMode;
  vocalTone: VocalToneMode;
  learnerProfile: LearnerProfileMode;
  learnerName?: string;
  tutorName?: string;
}

export interface StyleOptionItem<T extends string> {
  id: T;
  name: string;
  shortLabel: string;
  badge?: string;
  icon: string;
  description: string;
  accent: string;
}

export const VERBOSITY_OPTIONS: StyleOptionItem<VerbosityMode>[] = [
  {
    id: 'balanced',
    name: 'Balanced & Natural',
    shortLabel: 'Balanced',
    badge: 'Default',
    icon: '⚖️',
    description: 'Smooth, natural pacing in 1–3 crisp sentences with zero filler and instant silence when you pause to write.',
    accent: '#4ECDC4',
  },
  {
    id: 'concise',
    name: 'Ultra-Concise & Direct',
    shortLabel: 'Concise',
    badge: 'Brief',
    icon: '⚡',
    description: 'Maximum density in 1–2 short, direct sentences. Zero preamble, zero side remarks.',
    accent: '#38EF7D',
  },
  {
    id: 'adaptive',
    name: 'Dynamic & Adaptive',
    shortLabel: 'Adaptive',
    badge: 'Smart',
    icon: '🌊',
    description: 'Ultra-brief during routine steps and automatically expands only on complex conceptual hurdles.',
    accent: '#60A5FA',
  },
  {
    id: 'detailed',
    name: 'Detailed & Comprehensive',
    shortLabel: 'Detailed',
    badge: 'Deep',
    icon: '📚',
    description: 'Thorough step-by-step exposition unpacking underlying mechanisms and structural connections.',
    accent: '#C084FC',
  },
];

export const VOCAL_TONE_OPTIONS: StyleOptionItem<VocalToneMode>[] = [
  {
    id: 'natural',
    name: 'Natural & Adaptive',
    shortLabel: 'Natural',
    badge: 'Default',
    icon: '✨',
    description: 'Authentic, well-modulated vocal prosody that adapts organically without repetitive phrases.',
    accent: '#4ECDC4',
  },
  {
    id: 'serious',
    name: 'Serious & Academic',
    shortLabel: 'Serious',
    icon: '🎓',
    description: 'Composed, formal, objective, and scholarly delivery focused strictly on precision.',
    accent: '#60A5FA',
  },
  {
    id: 'friendly',
    name: 'Warm & Encouraging',
    shortLabel: 'Warm',
    icon: '🤝',
    description: 'Approachable, supportive, and motivating delivery that builds confidence naturally.',
    accent: '#FBBF24',
  },
  {
    id: 'playful',
    name: 'Cheerful & Playful',
    shortLabel: 'Playful',
    icon: '🌟',
    description: 'Upbeat, spirited, and lively vocal prosody that keeps energy high and engaging.',
    accent: '#F472B6',
  },
  {
    id: 'empathetic',
    name: 'Empathetic & Gentle',
    shortLabel: 'Empathetic',
    icon: '💙',
    description: 'Understanding, compassionate, and reassuring tone that eases frustration or stress.',
    accent: '#38BDF8',
  },
  {
    id: 'calm',
    name: 'Calm & Patient',
    shortLabel: 'Calm',
    icon: '🧘',
    description: 'Slow-paced, soothing, unhurried vocal delivery for relaxed, stress-free focus.',
    accent: '#34D399',
  },
  {
    id: 'strict',
    name: 'Strict & Intensive',
    shortLabel: 'Strict',
    icon: '🔥',
    description: 'Direct, disciplined, no-nonsense vocal delivery demanding sharp focus and rigor.',
    accent: '#FB7185',
  },
];

export const LEARNER_PROFILE_OPTIONS: StyleOptionItem<LearnerProfileMode>[] = [
  {
    id: 'general',
    name: 'General Learner',
    shortLabel: 'General',
    badge: 'Default',
    icon: '🌐',
    description: 'Clear, versatile academic framing suitable for any standard learner.',
    accent: '#4ECDC4',
  },
  {
    id: 'professional',
    name: 'Engineer / Doctor / University',
    shortLabel: 'Pro / Uni',
    icon: '🔬',
    description: 'Peer-level technical discourse using exact domain terminology without elementary hand-holding.',
    accent: '#C084FC',
  },
  {
    id: 'youth',
    name: 'Student / Youth',
    shortLabel: 'Student',
    icon: '🚀',
    description: 'Engaging, modern academic coaching balancing clarity with active problem-solving momentum.',
    accent: '#60A5FA',
  },
  {
    id: 'child',
    name: 'Child / Young Learner',
    shortLabel: 'Child',
    icon: '🧸',
    description: 'Simple, vivid everyday intuition and gentle step-by-step discovery for young learners.',
    accent: '#FBBF24',
  },
  {
    id: 'educator',
    name: 'Teacher / Academic Colleague',
    shortLabel: 'Educator',
    icon: '🏛️',
    description: 'Highlights instructional architecture, analytical rigor, and theoretical foundations.',
    accent: '#38BDF8',
  },
  {
    id: 'senior',
    name: 'Senior / Mature Adult',
    shortLabel: 'Senior',
    icon: '🌿',
    description: 'Dignified, courteous, unhurried, and crystal-clear communication with structured transitions.',
    accent: '#34D399',
  },
];

export interface QuickPreset {
  id: string;
  name: string;
  icon: string;
  config: SpeakingStyleConfig;
}

export const QUICK_STYLE_PRESETS: QuickPreset[] = [
  {
    id: 'default',
    name: 'Natural Default',
    icon: '⚖️',
    config: { verbosity: 'balanced', vocalTone: 'natural', learnerProfile: 'general' },
  },
  {
    id: 'laser_brief',
    name: 'Laser-Brief & Direct',
    icon: '⚡',
    config: { verbosity: 'concise', vocalTone: 'serious', learnerProfile: 'professional' },
  },
  {
    id: 'pro_academic',
    name: 'Engineer / Doctor / Uni',
    icon: '🔬',
    config: { verbosity: 'balanced', vocalTone: 'serious', learnerProfile: 'professional' },
  },
  {
    id: 'kids_fun',
    name: 'Child & Young Explorer',
    icon: '🧸',
    config: { verbosity: 'balanced', vocalTone: 'playful', learnerProfile: 'child' },
  },
  {
    id: 'calm_mentor',
    name: 'Calm & Patient Mentor',
    icon: '🧘',
    config: { verbosity: 'adaptive', vocalTone: 'calm', learnerProfile: 'general' },
  },
  {
    id: 'intensive_coach',
    name: 'Strict Exam Coach',
    icon: '🔥',
    config: { verbosity: 'concise', vocalTone: 'strict', learnerProfile: 'youth' },
  },
];

interface PersonaSelectorModalProps {
  isOpen: boolean;
  onClose: () => void;
  verbosity: VerbosityMode;
  vocalTone: VocalToneMode;
  learnerProfile: LearnerProfileMode;
  learnerName?: string;
  tutorName?: string;
  onUpdateSpeakingStyle: (next: SpeakingStyleConfig) => void;
}

export const PersonaSelectorModal: React.FC<PersonaSelectorModalProps> = ({
  isOpen,
  onClose,
  verbosity,
  vocalTone,
  learnerProfile,
  learnerName = '',
  tutorName = 'Zyren',
  onUpdateSpeakingStyle,
}) => {
  if (!isOpen) return null;

  const handleSelectVerbosity = (nextVerbosity: VerbosityMode) => {
    onUpdateSpeakingStyle({
      verbosity: nextVerbosity,
      vocalTone,
      learnerProfile,
    });
  };

  const handleSelectTone = (nextTone: VocalToneMode) => {
    onUpdateSpeakingStyle({
      verbosity,
      vocalTone: nextTone,
      learnerProfile,
    });
  };

  const handleSelectProfile = (nextProfile: LearnerProfileMode) => {
    onUpdateSpeakingStyle({
      verbosity,
      vocalTone,
      learnerProfile: nextProfile,
    });
  };

  const handleApplyPreset = (preset: QuickPreset) => {
    onUpdateSpeakingStyle(preset.config);
  };

  const isDefault =
    verbosity === 'balanced' && vocalTone === 'natural' && learnerProfile === 'general';

  return (
    <div
      className="persona-modal-backdrop voice-modal-backdrop"
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.78)',
        backdropFilter: 'blur(8px)',
        zIndex: 99999,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
        boxSizing: 'border-box',
      }}
      onClick={onClose}
      onPointerDown={(e) => e.stopPropagation()}
      onPointerUp={(e) => e.stopPropagation()}
      onWheel={(e) => e.stopPropagation()}
    >
      <div
        className="persona-modal-container voice-modal-container interactive"
        style={{
          backgroundColor: '#141722',
          border: '1px solid rgba(255, 255, 255, 0.14)',
          borderRadius: 16,
          width: '100%',
          maxWidth: 780,
          boxShadow: '0 24px 64px rgba(0, 0, 0, 0.88)',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
          maxHeight: '90vh',
          fontFamily: "'Inter', sans-serif",
        }}
        onClick={(e) => e.stopPropagation()}
        onPointerDown={(e) => e.stopPropagation()}
        onPointerUp={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          style={{
            padding: '18px 24px',
            borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            background: 'linear-gradient(180deg, rgba(78, 205, 196, 0.08), transparent)',
          }}
        >
          <div>
            <h3
              style={{
                margin: 0,
                fontSize: 18,
                fontWeight: 700,
                color: '#FFFFFF',
                display: 'flex',
                alignItems: 'center',
                gap: 8,
              }}
            >
              <span>🎭</span> Speaking Style, Vocal Tone & Persona Studio
              <span
                style={{
                  fontSize: 10,
                  fontWeight: 700,
                  padding: '2px 8px',
                  borderRadius: 999,
                  backgroundColor: 'rgba(56, 239, 125, 0.15)',
                  color: '#38EF7D',
                  border: '1px solid rgba(56, 239, 125, 0.35)',
                  textTransform: 'uppercase',
                  letterSpacing: 0.5,
                }}
              >
                Live Mid-Session Sync
              </span>
            </h3>
            <p style={{ margin: '4px 0 0 0', fontSize: 12, color: 'rgba(255, 255, 255, 0.6)' }}>
              Changes apply instantaneously to your active session without restarting or losing context.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            style={{
              background: 'transparent',
              border: 'none',
              color: 'rgba(255, 255, 255, 0.55)',
              fontSize: 22,
              cursor: 'pointer',
              padding: 4,
              lineHeight: 1,
            }}
          >
            ×
          </button>
        </div>

        {/* Scrollable Body */}
        <div
          style={{
            padding: '18px 24px',
            overflowY: 'auto',
            display: 'flex',
            flexDirection: 'column',
            gap: 20,
          }}
          onWheel={(e) => e.stopPropagation()}
        >
          {/* Quick 1-Click Presets */}
          <div>
            <div
              style={{
                fontSize: 11,
                fontWeight: 700,
                textTransform: 'uppercase',
                letterSpacing: 0.8,
                color: 'rgba(255, 255, 255, 0.5)',
                marginBottom: 8,
              }}
            >
              ⚡ Quick 1-Click Presets
            </div>
            <div
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                gap: 8,
              }}
            >
              {QUICK_STYLE_PRESETS.map((preset) => {
                const active =
                  verbosity === preset.config.verbosity &&
                  vocalTone === preset.config.vocalTone &&
                  learnerProfile === preset.config.learnerProfile;
                return (
                  <button
                    key={preset.id}
                    type="button"
                    onClick={() => handleApplyPreset(preset)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                      padding: '7px 12px',
                      borderRadius: 999,
                      border: active
                        ? '1px solid #4ECDC4'
                        : '1px solid rgba(255, 255, 255, 0.12)',
                      backgroundColor: active
                        ? 'rgba(78, 205, 196, 0.18)'
                        : 'rgba(255, 255, 255, 0.04)',
                      color: active ? '#4ECDC4' : '#E2E8F0',
                      fontSize: 12,
                      fontWeight: active ? 700 : 500,
                      cursor: 'pointer',
                      transition: 'all 0.15s ease',
                    }}
                  >
                    <span>{preset.icon}</span>
                    <span>{preset.name}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Section: Names & Identity Personalization (Prominent at Top) */}
          <div
            style={{
              padding: '14px 16px',
              borderRadius: 12,
              backgroundColor: 'rgba(78, 205, 196, 0.08)',
              border: '1px solid rgba(78, 205, 196, 0.35)',
              boxShadow: '0 2px 12px rgba(78, 205, 196, 0.06)',
            }}
          >
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
                gap: 16,
              }}
            >
              {/* Student Name */}
              <div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                  <div
                    style={{
                      fontSize: 11,
                      fontWeight: 700,
                      letterSpacing: '0.06em',
                      textTransform: 'uppercase',
                      color: '#4ECDC4',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                    }}
                  >
                    <span>👤</span>
                    <span>Student Name (Optional)</span>
                  </div>
                </div>
                <input
                  type="text"
                  value={learnerName || ''}
                  onChange={(e) => {
                    onUpdateSpeakingStyle({
                      verbosity,
                      vocalTone,
                      learnerProfile,
                      learnerName: e.target.value,
                      tutorName,
                    });
                  }}
                  placeholder="e.g. Enter your name"
                  maxLength={40}
                  style={{
                    width: '100%',
                    padding: '10px 12px',
                    borderRadius: 8,
                    border: '1px solid rgba(78, 205, 196, 0.45)',
                    backgroundColor: 'rgba(0, 0, 0, 0.35)',
                    color: '#FFFFFF',
                    fontSize: 13,
                    outline: 'none',
                    fontFamily: "'Inter', sans-serif",
                    boxSizing: 'border-box',
                  }}
                />
                <div style={{ fontSize: 10, color: 'rgba(255, 255, 255, 0.5)', marginTop: 4 }}>
                  The tutor addresses you by this name.
                </div>
              </div>

              {/* Tutor Name */}
              <div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                  <div
                    style={{
                      fontSize: 11,
                      fontWeight: 700,
                      letterSpacing: '0.06em',
                      textTransform: 'uppercase',
                      color: '#38EF7D',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                    }}
                  >
                    <span>🎓</span>
                    <span>Tutor Name (Default: Zyren)</span>
                  </div>
                  {tutorName && tutorName !== 'Zyren' && (
                    <button
                      type="button"
                      onClick={() => {
                        onUpdateSpeakingStyle({
                          verbosity,
                          vocalTone,
                          learnerProfile,
                          learnerName,
                          tutorName: 'Zyren',
                        });
                      }}
                      style={{
                        background: 'transparent',
                        border: 'none',
                        color: 'rgba(255, 255, 255, 0.5)',
                        fontSize: 10,
                        cursor: 'pointer',
                        padding: 0,
                        textDecoration: 'underline',
                      }}
                    >
                      Reset to Zyren
                    </button>
                  )}
                </div>
                <input
                  type="text"
                  value={tutorName}
                  onChange={(e) => {
                    onUpdateSpeakingStyle({
                      verbosity,
                      vocalTone,
                      learnerProfile,
                      learnerName,
                      tutorName: e.target.value,
                    });
                  }}
                  placeholder="e.g. Zyren"
                  maxLength={40}
                  style={{
                    width: '100%',
                    padding: '10px 12px',
                    borderRadius: 8,
                    border: '1px solid rgba(56, 239, 125, 0.45)',
                    backgroundColor: 'rgba(0, 0, 0, 0.35)',
                    color: '#FFFFFF',
                    fontSize: 13,
                    outline: 'none',
                    fontFamily: "'Inter', sans-serif",
                    boxSizing: 'border-box',
                  }}
                />
                <div style={{ fontSize: 10, color: 'rgba(255, 255, 255, 0.5)', marginTop: 4 }}>
                  Identity name the AI Tutor adopts.
                </div>
              </div>
            </div>

            <div
              style={{
                fontSize: 10,
                color: 'rgba(255, 255, 255, 0.4)',
                borderTop: '1px solid rgba(255, 255, 255, 0.08)',
                marginTop: 10,
                paddingTop: 6,
                display: 'flex',
                justifyContent: 'space-between',
              }}
            >
              <span>Saved locally on your device only</span>
              <span>Default tutor: Zyren</span>
            </div>
          </div>

          {/* Dimension 1: Response Length & Verbosity */}
          <div>
            <div
              style={{
                fontSize: 12,
                fontWeight: 700,
                color: '#FFFFFF',
                marginBottom: 8,
                display: 'flex',
                alignItems: 'center',
                gap: 6,
              }}
            >
              <span>📏</span>
              <span>1. Response Length & Verbosity</span>
            </div>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))',
                gap: 10,
              }}
            >
              {VERBOSITY_OPTIONS.map((item) => {
                const selected = verbosity === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => handleSelectVerbosity(item.id)}
                    style={{
                      textAlign: 'left',
                      padding: 12,
                      borderRadius: 12,
                      border: selected
                        ? `2px solid ${item.accent}`
                        : '1px solid rgba(255, 255, 255, 0.1)',
                      backgroundColor: selected
                        ? 'rgba(78, 205, 196, 0.1)'
                        : 'rgba(255, 255, 255, 0.025)',
                      cursor: 'pointer',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 6,
                      transition: 'all 0.15s ease',
                    }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: 6,
                      }}
                    >
                      <span
                        style={{
                          fontSize: 13,
                          fontWeight: 700,
                          color: selected ? item.accent : '#FFFFFF',
                          display: 'flex',
                          alignItems: 'center',
                          gap: 6,
                        }}
                      >
                        <span>{item.icon}</span>
                        <span>{item.name}</span>
                      </span>
                      {item.badge && (
                        <span
                          style={{
                            fontSize: 9,
                            fontWeight: 700,
                            padding: '2px 6px',
                            borderRadius: 4,
                            backgroundColor: 'rgba(255, 255, 255, 0.1)',
                            color: '#CBD5E1',
                            textTransform: 'uppercase',
                          }}
                        >
                          {item.badge}
                        </span>
                      )}
                    </div>
                    <div
                      style={{
                        fontSize: 11,
                        lineHeight: 1.4,
                        color: 'rgba(255, 255, 255, 0.62)',
                      }}
                    >
                      {item.description}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Dimension 2: Vocal Tone & Expressive Attitude */}
          <div>
            <div
              style={{
                fontSize: 12,
                fontWeight: 700,
                color: '#FFFFFF',
                marginBottom: 8,
                display: 'flex',
                alignItems: 'center',
                gap: 6,
              }}
            >
              <span>🎵</span>
              <span>2. Vocal Tone & Expressive Attitude</span>
            </div>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))',
                gap: 10,
              }}
            >
              {VOCAL_TONE_OPTIONS.map((item) => {
                const selected = vocalTone === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => handleSelectTone(item.id)}
                    style={{
                      textAlign: 'left',
                      padding: 12,
                      borderRadius: 12,
                      border: selected
                        ? `2px solid ${item.accent}`
                        : '1px solid rgba(255, 255, 255, 0.1)',
                      backgroundColor: selected
                        ? 'rgba(78, 205, 196, 0.1)'
                        : 'rgba(255, 255, 255, 0.025)',
                      cursor: 'pointer',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 5,
                      transition: 'all 0.15s ease',
                    }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: 6,
                      }}
                    >
                      <span
                        style={{
                          fontSize: 13,
                          fontWeight: 700,
                          color: selected ? item.accent : '#FFFFFF',
                          display: 'flex',
                          alignItems: 'center',
                          gap: 6,
                        }}
                      >
                        <span>{item.icon}</span>
                        <span>{item.name}</span>
                      </span>
                      {item.badge && (
                        <span
                          style={{
                            fontSize: 9,
                            fontWeight: 700,
                            padding: '2px 6px',
                            borderRadius: 4,
                            backgroundColor: 'rgba(255, 255, 255, 0.1)',
                            color: '#CBD5E1',
                            textTransform: 'uppercase',
                          }}
                        >
                          {item.badge}
                        </span>
                      )}
                    </div>
                    <div
                      style={{
                        fontSize: 11,
                        lineHeight: 1.4,
                        color: 'rgba(255, 255, 255, 0.62)',
                      }}
                    >
                      {item.description}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Dimension 3: Learner Profile / Target Audience */}
          <div>
            <div
              style={{
                fontSize: 12,
                fontWeight: 700,
                color: '#FFFFFF',
                marginBottom: 8,
                display: 'flex',
                alignItems: 'center',
                gap: 6,
              }}
            >
              <span>👤</span>
              <span>3. Learner Profile & Audience Adaptation</span>
            </div>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))',
                gap: 10,
              }}
            >
              {LEARNER_PROFILE_OPTIONS.map((item) => {
                const selected = learnerProfile === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => handleSelectProfile(item.id)}
                    style={{
                      textAlign: 'left',
                      padding: 12,
                      borderRadius: 12,
                      border: selected
                        ? `2px solid ${item.accent}`
                        : '1px solid rgba(255, 255, 255, 0.1)',
                      backgroundColor: selected
                        ? 'rgba(78, 205, 196, 0.1)'
                        : 'rgba(255, 255, 255, 0.025)',
                      cursor: 'pointer',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 5,
                      transition: 'all 0.15s ease',
                    }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: 6,
                      }}
                    >
                      <span
                        style={{
                          fontSize: 13,
                          fontWeight: 700,
                          color: selected ? item.accent : '#FFFFFF',
                          display: 'flex',
                          alignItems: 'center',
                          gap: 6,
                        }}
                      >
                        <span>{item.icon}</span>
                        <span>{item.name}</span>
                      </span>
                      {item.badge && (
                        <span
                          style={{
                            fontSize: 9,
                            fontWeight: 700,
                            padding: '2px 6px',
                            borderRadius: 4,
                            backgroundColor: 'rgba(255, 255, 255, 0.1)',
                            color: '#CBD5E1',
                            textTransform: 'uppercase',
                          }}
                        >
                          {item.badge}
                        </span>
                      )}
                    </div>
                    <div
                      style={{
                        fontSize: 11,
                        lineHeight: 1.4,
                        color: 'rgba(255, 255, 255, 0.62)',
                      }}
                    >
                      {item.description}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div
          style={{
            padding: '14px 24px',
            borderTop: '1px solid rgba(255, 255, 255, 0.08)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            backgroundColor: 'rgba(0, 0, 0, 0.25)',
          }}
        >
          <button
            type="button"
            disabled={isDefault}
            onClick={() =>
              onUpdateSpeakingStyle({
                verbosity: 'balanced',
                vocalTone: 'natural',
                learnerProfile: 'general',
                learnerName: '',
                tutorName: 'Zyren',
              })
            }
            style={{
              padding: '8px 14px',
              borderRadius: 8,
              border: '1px solid rgba(255, 255, 255, 0.15)',
              backgroundColor: isDefault ? 'transparent' : 'rgba(255, 255, 255, 0.06)',
              color: isDefault ? 'rgba(255, 255, 255, 0.3)' : '#E2E8F0',
              fontSize: 12,
              fontWeight: 600,
              cursor: isDefault ? 'default' : 'pointer',
            }}
          >
            ↺ Reset to Default
          </button>

          <button
            type="button"
            onClick={onClose}
            style={{
              padding: '9px 22px',
              borderRadius: 8,
              border: 'none',
              background: 'linear-gradient(135deg, #4ECDC4, #38EF7D)',
              color: '#0F172A',
              fontSize: 13,
              fontWeight: 700,
              cursor: 'pointer',
              boxShadow: '0 4px 14px rgba(78, 205, 196, 0.35)',
            }}
          >
            Done (Synced Live)
          </button>
        </div>
      </div>
    </div>
  );
};
