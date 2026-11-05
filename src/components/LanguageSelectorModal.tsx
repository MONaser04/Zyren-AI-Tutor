import React, { useState, useEffect } from 'react';
import type { LanguageConfig, LanguageItem } from '../types';

export const SUPPORTED_LANGUAGES: LanguageItem[] = [
  { code: 'ar-EG', name: 'Egyptian Arabic', nativeName: 'العربية (اللهجة المصرية)', flag: '🇪🇬', family: 'Semitic' },
  { code: 'ar-SA', name: 'Modern Standard Arabic', nativeName: 'العربية (الفصحى)', flag: '🇸🇦', family: 'Semitic' },
  { code: 'ar-SY', name: 'Levantine Arabic', nativeName: 'العربية (الشامية)', flag: '🇸🇾', family: 'Semitic' },
  { code: 'ar-AE', name: 'Gulf Arabic', nativeName: 'العربية (الخليجية)', flag: '🇦🇪', family: 'Semitic' },
  { code: 'en-US', name: 'English (US)', nativeName: 'English (United States)', flag: '🇺🇸', family: 'Germanic' },
  { code: 'en-GB', name: 'English (UK)', nativeName: 'English (United Kingdom)', flag: '🇬🇧', family: 'Germanic' },
  { code: 'de-DE', name: 'German', nativeName: 'Deutsch', flag: '🇩🇪', family: 'Germanic' },
  { code: 'fr-FR', name: 'French', nativeName: 'Français', flag: '🇫🇷', family: 'Romance' },
  { code: 'es-ES', name: 'Spanish', nativeName: 'Español', flag: '🇪🇸', family: 'Romance' },
  { code: 'it-IT', name: 'Italian', nativeName: 'Italiano', flag: '🇮🇹', family: 'Romance' },
  { code: 'ru-RU', name: 'Russian', nativeName: 'Русский', flag: '🇷🇺', family: 'Slavic' },
  { code: 'zh-CN', name: 'Chinese (Mandarin)', nativeName: '中文 (普通话)', flag: '🇨🇳', family: 'Sino-Tibetan' },
  { code: 'ja-JP', name: 'Japanese', nativeName: '日本語', flag: '🇯🇵', family: 'Japonic' },
  { code: 'ko-KR', name: 'Korean', nativeName: '한국어', flag: '🇰🇷', family: 'Koreanic' },
  { code: 'tr-TR', name: 'Turkish', nativeName: 'Türkçe', flag: '🇹🇷', family: 'Turkic' },
  { code: 'pt-BR', name: 'Portuguese', nativeName: 'Português', flag: '🇧🇷', family: 'Romance' },
  { code: 'hi-IN', name: 'Hindi', nativeName: 'हिन्दी', flag: '🇮🇳', family: 'Indo-Aryan' },
  { code: 'nl-NL', name: 'Dutch', nativeName: 'Nederlands', flag: '🇳🇱', family: 'Germanic' },
  { code: 'el-GR', name: 'Greek', nativeName: 'Ελληνικά', flag: '🇬🇷', family: 'Hellenic' },
  { code: 'la-VA', name: 'Latin', nativeName: 'Lingua Latina', flag: '🏛️', family: 'Italic' },
];

export const DEFAULT_LANGUAGE_CONFIG: LanguageConfig = {
  autoDetect: false,
  primary: 'ar-EG',
  secondary: ['en-US', 'de-DE'],
};

interface LanguageSelectorModalProps {
  isOpen: boolean;
  onClose: () => void;
  config: LanguageConfig;
  onSaveConfig: (newConfig: LanguageConfig) => void;
}

export const LanguageSelectorModal: React.FC<LanguageSelectorModalProps> = ({
  isOpen,
  onClose,
  config,
  onSaveConfig,
}) => {
  const [autoDetect, setAutoDetect] = useState<boolean>(config.autoDetect);
  const [primary, setPrimary] = useState<string>(config.primary);
  const [secondary, setSecondary] = useState<string[]>(config.secondary || []);
  const [isAddingSecondary, setIsAddingSecondary] = useState<boolean>(false);
  const [selectedToAdd, setSelectedToAdd] = useState<string>('');

  // Sync state whenever modal is opened
  useEffect(() => {
    if (isOpen) {
      setAutoDetect(config.autoDetect);
      setPrimary(config.primary || 'ar-EG');
      setSecondary(config.secondary || []);
      setIsAddingSecondary(false);
      setSelectedToAdd('');
    }
  }, [isOpen, config]);

  if (!isOpen) return null;

  const totalLanguages = autoDetect ? 0 : 1 + secondary.length;

  const findLanguage = (code: string): LanguageItem => {
    return (
      SUPPORTED_LANGUAGES.find((lang) => lang.code === code) || {
        code,
        name: code,
        nativeName: code,
        flag: '🌐',
      }
    );
  };

  const handleAddSecondary = () => {
    if (!selectedToAdd) return;
    if (selectedToAdd === primary) return;
    if (secondary.includes(selectedToAdd)) return;

    setSecondary([...secondary, selectedToAdd]);
    setSelectedToAdd('');
    setIsAddingSecondary(false);
  };

  const handleRemoveSecondary = (index: number) => {
    const updated = [...secondary];
    updated.splice(index, 1);
    setSecondary(updated);
  };

  const handleMoveUp = (index: number) => {
    if (index <= 0) return;
    const updated = [...secondary];
    const temp = updated[index - 1];
    updated[index - 1] = updated[index];
    updated[index] = temp;
    setSecondary(updated);
  };

  const handleMoveDown = (index: number) => {
    if (index >= secondary.length - 1) return;
    const updated = [...secondary];
    const temp = updated[index + 1];
    updated[index + 1] = updated[index];
    updated[index] = temp;
    setSecondary(updated);
  };

  const handlePrimaryChange = (newPrimary: string) => {
    setPrimary(newPrimary);
    // If the new primary was in secondaries, remove it cleanly
    if (secondary.includes(newPrimary)) {
      setSecondary(secondary.filter((c) => c !== newPrimary));
    }
  };

  const handleApply = () => {
    onSaveConfig({
      autoDetect,
      primary,
      secondary,
    });
    onClose();
  };

  const handleReset = () => {
    setAutoDetect(DEFAULT_LANGUAGE_CONFIG.autoDetect);
    setPrimary(DEFAULT_LANGUAGE_CONFIG.primary);
    setSecondary([...DEFAULT_LANGUAGE_CONFIG.secondary]);
    setIsAddingSecondary(false);
  };

  // Candidates for secondary languages (exclude primary and already added)
  const availableForSecondary = SUPPORTED_LANGUAGES.filter(
    (lang) => lang.code !== primary && !secondary.includes(lang.code)
  );

  return (
    <div
      className="language-modal-backdrop"
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.78)',
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
        className="language-modal-container"
        style={{
          backgroundColor: '#161922',
          border: '1px solid rgba(255, 255, 255, 0.15)',
          borderRadius: 16,
          width: '100%',
          maxWidth: 680,
          boxShadow: '0 24px 64px rgba(0, 0, 0, 0.9)',
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
              <span>🌐</span> Multilingual & Speech Language Configuration
            </h3>
            <p style={{ margin: '4px 0 0 0', fontSize: 12, color: 'rgba(255, 255, 255, 0.6)' }}>
              Configure spoken language priorities, bilingual code-switching, and real-time detection.
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
            gap: 18,
          }}
        >
          {/* Stability Guide Banner in English */}
          <div
            style={{
              backgroundColor: 'rgba(20, 24, 36, 0.85)',
              border: '1px solid rgba(255, 255, 255, 0.12)',
              borderRadius: 12,
              padding: 14,
              boxShadow: 'inset 0 1px 2px rgba(0,0,0,0.3)',
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                marginBottom: 10,
              }}
            >
              <span style={{ fontSize: 12, fontWeight: 700, color: '#E0E7FF', letterSpacing: '0.3px' }}>
                ⚡ MULTIMODAL SPEECH STABILITY BENCHMARK (GOOGLE GEMINI LIVE)
              </span>
              <span
                style={{
                  fontSize: 10,
                  fontWeight: 700,
                  padding: '2px 8px',
                  borderRadius: 6,
                  textTransform: 'uppercase',
                  backgroundColor: autoDetect
                    ? 'rgba(168, 85, 247, 0.25)'
                    : totalLanguages === 1
                    ? 'rgba(56, 239, 125, 0.25)'
                    : totalLanguages === 2
                    ? 'rgba(96, 165, 250, 0.25)'
                    : totalLanguages === 3
                    ? 'rgba(251, 191, 36, 0.25)'
                    : 'rgba(248, 113, 113, 0.25)',
                  color: autoDetect
                    ? '#C084FC'
                    : totalLanguages === 1
                    ? '#38EF7D'
                    : totalLanguages === 2
                    ? '#60A5FA'
                    : totalLanguages === 3
                    ? '#FBBF24'
                    : '#F87171',
                  border: `1px solid ${
                    autoDetect
                      ? 'rgba(168, 85, 247, 0.5)'
                      : totalLanguages === 1
                      ? 'rgba(56, 239, 125, 0.5)'
                      : totalLanguages === 2
                      ? 'rgba(96, 165, 250, 0.5)'
                      : totalLanguages === 3
                      ? 'rgba(251, 191, 36, 0.5)'
                      : 'rgba(248, 113, 113, 0.5)'
                  }`,
                }}
              >
                {autoDetect ? 'Dynamic Auto-Detect' : `${totalLanguages} Active ${totalLanguages === 1 ? 'Language' : 'Languages'}`}
              </span>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 8 }}>
              {/* 1 Language */}
              <div
                style={{
                  padding: '8px 10px',
                  borderRadius: 8,
                  backgroundColor:
                    !autoDetect && totalLanguages === 1
                      ? 'rgba(56, 239, 125, 0.12)'
                      : 'rgba(255, 255, 255, 0.02)',
                  border:
                    !autoDetect && totalLanguages === 1
                      ? '1px solid rgba(56, 239, 125, 0.4)'
                      : '1px solid rgba(255, 255, 255, 0.05)',
                }}
              >
                <div style={{ fontSize: 11, fontWeight: 700, color: '#38EF7D', display: 'flex', alignItems: 'center', gap: 4 }}>
                  <span>🟢</span> 1 Language: Ultra-Stable (Optimal)
                </div>
                <div style={{ fontSize: 10, color: 'rgba(255, 255, 255, 0.65)', marginTop: 3, lineHeight: 1.35 }}>
                  Maximum acoustic accuracy, zero switching latency, and 100% deterministic speech recognition.
                </div>
              </div>

              {/* 2 Languages */}
              <div
                style={{
                  padding: '8px 10px',
                  borderRadius: 8,
                  backgroundColor:
                    !autoDetect && totalLanguages === 2
                      ? 'rgba(96, 165, 250, 0.12)'
                      : 'rgba(255, 255, 255, 0.02)',
                  border:
                    !autoDetect && totalLanguages === 2
                      ? '1px solid rgba(96, 165, 250, 0.4)'
                      : '1px solid rgba(255, 255, 255, 0.05)',
                }}
              >
                <div style={{ fontSize: 11, fontWeight: 700, color: '#60A5FA', display: 'flex', alignItems: 'center', gap: 4 }}>
                  <span>🔵</span> 2 Languages: Highly Stable (Recommended)
                </div>
                <div style={{ fontSize: 10, color: 'rgba(255, 255, 255, 0.65)', marginTop: 3, lineHeight: 1.35 }}>
                  Official Gemini Live standard. Seamless bilingual code-switching. Pairing with English provides highest stability.
                </div>
              </div>

              {/* 3 Languages */}
              <div
                style={{
                  padding: '8px 10px',
                  borderRadius: 8,
                  backgroundColor:
                    !autoDetect && totalLanguages === 3
                      ? 'rgba(251, 191, 36, 0.12)'
                      : 'rgba(255, 255, 255, 0.02)',
                  border:
                    !autoDetect && totalLanguages === 3
                      ? '1px solid rgba(251, 191, 36, 0.4)'
                      : '1px solid rgba(255, 255, 255, 0.05)',
                }}
              >
                <div style={{ fontSize: 11, fontWeight: 700, color: '#FBBF24', display: 'flex', alignItems: 'center', gap: 4 }}>
                  <span>🟡</span> 3 Languages: Moderate Stability
                </div>
                <div style={{ fontSize: 10, color: 'rgba(255, 255, 255, 0.65)', marginTop: 3, lineHeight: 1.35 }}>
                  Functional with strict secondary priority. Minor chance of short-word acoustic overlap or slight latency.
                </div>
              </div>

              {/* 4+ Languages */}
              <div
                style={{
                  padding: '8px 10px',
                  borderRadius: 8,
                  backgroundColor:
                    !autoDetect && totalLanguages >= 4
                      ? 'rgba(248, 113, 113, 0.12)'
                      : 'rgba(255, 255, 255, 0.02)',
                  border:
                    !autoDetect && totalLanguages >= 4
                      ? '1px solid rgba(248, 113, 113, 0.4)'
                      : '1px solid rgba(255, 255, 255, 0.05)',
                }}
              >
                <div style={{ fontSize: 11, fontWeight: 700, color: '#F87171', display: 'flex', alignItems: 'center', gap: 4 }}>
                  <span>🔴</span> 4+ Languages: Experimental / Low Stability
                </div>
                <div style={{ fontSize: 10, color: 'rgba(255, 255, 255, 0.65)', marginTop: 3, lineHeight: 1.35 }}>
                  Elevated risk of phonetic drift, voice accent bleeding, and unprompted language hallucination.
                </div>
              </div>
            </div>
          </div>

          {/* Mode Switcher: Auto-Detect Toggle Card */}
          <div
            style={{
              padding: '14px 18px',
              borderRadius: 12,
              backgroundColor: autoDetect ? 'rgba(168, 85, 247, 0.12)' : 'rgba(255, 255, 255, 0.04)',
              border: autoDetect ? '1px solid rgba(168, 85, 247, 0.4)' : '1px solid rgba(255, 255, 255, 0.08)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 16,
              transition: 'all 0.2s ease',
            }}
          >
            <div>
              <div style={{ fontSize: 13, fontWeight: 700, color: autoDetect ? '#C084FC' : '#FFFFFF', display: 'flex', alignItems: 'center', gap: 8 }}>
                <span>✨</span> Real-Time Auto-Detect Mode
              </div>
              <div style={{ fontSize: 11, color: 'rgba(255, 255, 255, 0.6)', marginTop: 4, lineHeight: 1.4 }}>
                {autoDetect
                  ? 'Active: ZYREN automatically detects and adapts to whichever language you speak on the fly.'
                  : 'Disabled: ZYREN is strictly constrained to your manually chosen Primary and Prioritized Secondary languages.'}
              </div>
            </div>

            <button
              type="button"
              onClick={() => setAutoDetect(!autoDetect)}
              style={{
                padding: '8px 16px',
                fontSize: 12,
                fontWeight: 700,
                backgroundColor: autoDetect ? '#A855F7' : 'rgba(255, 255, 255, 0.1)',
                color: '#FFFFFF',
                border: 'none',
                borderRadius: 8,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                transition: 'all 0.2s ease',
                flexShrink: 0,
              }}
            >
              <span>{autoDetect ? '✓ Enabled' : '○ Enable Auto'}</span>
            </button>
          </div>

          {/* Primary Language Section */}
          <div
            style={{
              opacity: autoDetect ? 0.75 : 1,
              transition: 'opacity 0.2s ease',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
              <label style={{ fontSize: 12, fontWeight: 700, color: '#FFFFFF', display: 'flex', alignItems: 'center', gap: 6 }}>
                <span>👑</span> Primary Spoken Language
              </label>
              <span style={{ fontSize: 10, color: 'rgba(255, 255, 255, 0.5)' }}>
                Conversational syntax, core explanations & questions
              </span>
            </div>

            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                backgroundColor: 'rgba(0, 0, 0, 0.25)',
                border: '1px solid rgba(255, 255, 255, 0.12)',
                borderRadius: 10,
                padding: '8px 14px',
              }}
            >
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  padding: '3px 8px',
                  borderRadius: 6,
                  backgroundColor: 'rgba(78, 205, 196, 0.18)',
                  color: '#4ECDC4',
                  border: '1px solid rgba(78, 205, 196, 0.35)',
                  letterSpacing: '0.8px',
                }}
              >
                {primary.toUpperCase()}
              </span>
              <select
                value={primary}
                onChange={(e) => handlePrimaryChange(e.target.value)}
                style={{
                  flex: 1,
                  background: 'transparent',
                  border: 'none',
                  color: '#FFFFFF',
                  fontSize: 13,
                  fontWeight: 600,
                  outline: 'none',
                  cursor: 'pointer',
                }}
              >
                {SUPPORTED_LANGUAGES.map((lang) => (
                  <option key={lang.code} value={lang.code} style={{ backgroundColor: '#1A1D27', color: '#FFFFFF' }}>
                    {lang.name} — {lang.nativeName}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Secondary Languages Section with Priority */}
          <div
            style={{
              opacity: autoDetect ? 0.75 : 1,
              transition: 'opacity 0.2s ease',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
              <div>
                <label style={{ fontSize: 12, fontWeight: 700, color: '#FFFFFF', display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span>🎯</span> Secondary Languages & Priority Hierarchy
                </label>
                <span style={{ fontSize: 10, color: 'rgba(255, 255, 255, 0.5)' }}>
                  Used for academic definitions, technical terms, formula names, drills, or direct switches
                </span>
              </div>

              {availableForSecondary.length > 0 && !isAddingSecondary && (
                <button
                  type="button"
                  onClick={() => setIsAddingSecondary(true)}
                  style={{
                    padding: '5px 12px',
                    fontSize: 11,
                    fontWeight: 700,
                    backgroundColor: 'rgba(78, 205, 196, 0.15)',
                    color: '#4ECDC4',
                    border: '1px solid rgba(78, 205, 196, 0.4)',
                    borderRadius: 6,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 4,
                  }}
                >
                  <span>+</span> Add Language
                </button>
              )}
            </div>

            {/* Inline Add Picker */}
            {isAddingSecondary && (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  backgroundColor: 'rgba(78, 205, 196, 0.08)',
                  border: '1px dashed rgba(78, 205, 196, 0.5)',
                  borderRadius: 10,
                  padding: '10px 14px',
                  marginBottom: 10,
                }}
              >
                <select
                  value={selectedToAdd}
                  onChange={(e) => setSelectedToAdd(e.target.value)}
                  style={{
                    flex: 1,
                    backgroundColor: '#1E2230',
                    border: '1px solid rgba(255, 255, 255, 0.15)',
                    color: '#FFFFFF',
                    fontSize: 12,
                    borderRadius: 6,
                    padding: '6px 10px',
                    outline: 'none',
                  }}
                >
                  <option value="">-- Choose a secondary language --</option>
                  {availableForSecondary.map((lang) => (
                    <option key={lang.code} value={lang.code}>
                      {lang.name} — {lang.nativeName}
                    </option>
                  ))}
                </select>

                <button
                  type="button"
                  onClick={handleAddSecondary}
                  disabled={!selectedToAdd}
                  style={{
                    padding: '6px 14px',
                    fontSize: 11,
                    fontWeight: 700,
                    backgroundColor: selectedToAdd ? '#4ECDC4' : 'rgba(255, 255, 255, 0.1)',
                    color: selectedToAdd ? '#000000' : 'rgba(255, 255, 255, 0.4)',
                    border: 'none',
                    borderRadius: 6,
                    cursor: selectedToAdd ? 'pointer' : 'not-allowed',
                  }}
                >
                  Confirm Add
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setIsAddingSecondary(false);
                    setSelectedToAdd('');
                  }}
                  style={{
                    padding: '6px 10px',
                    fontSize: 11,
                    backgroundColor: 'transparent',
                    color: 'rgba(255, 255, 255, 0.5)',
                    border: 'none',
                    cursor: 'pointer',
                  }}
                >
                  Cancel
                </button>
              </div>
            )}

            {/* List of Secondary Languages */}
            {secondary.length === 0 ? (
              <div
                style={{
                  padding: '16px 20px',
                  backgroundColor: 'rgba(0, 0, 0, 0.15)',
                  border: '1px dashed rgba(255, 255, 255, 0.1)',
                  borderRadius: 10,
                  textAlign: 'center',
                  fontSize: 11,
                  color: 'rgba(255, 255, 255, 0.4)',
                }}
              >
                No secondary languages configured (Monolingual mode). Click "+ Add Language" to enable bilingual/multilingual code-switching.
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {secondary.map((code, idx) => {
                  const lang = findLanguage(code);
                  return (
                    <div
                      key={code}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        padding: '10px 14px',
                        backgroundColor: 'rgba(0, 0, 0, 0.3)',
                        border: '1px solid rgba(255, 255, 255, 0.08)',
                        borderRadius: 8,
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <span
                          style={{
                            fontSize: 10,
                            fontWeight: 700,
                            padding: '2px 6px',
                            borderRadius: 4,
                            backgroundColor: idx === 0 ? 'rgba(78, 205, 196, 0.2)' : 'rgba(255, 255, 255, 0.08)',
                            color: idx === 0 ? '#4ECDC4' : 'rgba(255, 255, 255, 0.7)',
                            letterSpacing: '0.5px',
                          }}
                        >
                          PRIORITY #{idx + 1}
                        </span>
                        <span
                          style={{
                            fontSize: 10,
                            fontWeight: 700,
                            padding: '2px 6px',
                            borderRadius: 4,
                            backgroundColor: 'rgba(255, 255, 255, 0.06)',
                            color: 'rgba(255, 255, 255, 0.85)',
                            letterSpacing: '0.5px',
                          }}
                        >
                          {lang.code.toUpperCase()}
                        </span>
                        <div>
                          <span style={{ fontSize: 12, fontWeight: 600, color: '#FFFFFF' }}>{lang.name}</span>
                          <span style={{ fontSize: 11, color: 'rgba(255, 255, 255, 0.5)', marginLeft: 6 }}>
                            ({lang.nativeName})
                          </span>
                        </div>
                      </div>

                      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                        {/* Move Up */}
                        <button
                          type="button"
                          onClick={() => handleMoveUp(idx)}
                          disabled={idx === 0}
                          title="Increase Priority"
                          style={{
                            background: 'rgba(255, 255, 255, 0.06)',
                            border: 'none',
                            color: idx === 0 ? 'rgba(255, 255, 255, 0.2)' : 'rgba(255, 255, 255, 0.8)',
                            padding: '4px 8px',
                            borderRadius: 4,
                            cursor: idx === 0 ? 'not-allowed' : 'pointer',
                            fontSize: 10,
                          }}
                        >
                          ▲
                        </button>

                        {/* Move Down */}
                        <button
                          type="button"
                          onClick={() => handleMoveDown(idx)}
                          disabled={idx === secondary.length - 1}
                          title="Decrease Priority"
                          style={{
                            background: 'rgba(255, 255, 255, 0.06)',
                            border: 'none',
                            color: idx === secondary.length - 1 ? 'rgba(255, 255, 255, 0.2)' : 'rgba(255, 255, 255, 0.8)',
                            padding: '4px 8px',
                            borderRadius: 4,
                            cursor: idx === secondary.length - 1 ? 'not-allowed' : 'pointer',
                            fontSize: 10,
                          }}
                        >
                          ▼
                        </button>

                        {/* Delete / Remove */}
                        <button
                          type="button"
                          onClick={() => handleRemoveSecondary(idx)}
                          title="Delete Language"
                          style={{
                            background: 'rgba(248, 113, 113, 0.1)',
                            border: '1px solid rgba(248, 113, 113, 0.2)',
                            color: '#F87171',
                            padding: '4px 8px',
                            borderRadius: 4,
                            cursor: 'pointer',
                            fontSize: 11,
                            marginLeft: 4,
                          }}
                        >
                          🗑️
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Footer Actions */}
        <div
          style={{
            padding: '16px 24px',
            borderTop: '1px solid rgba(255, 255, 255, 0.08)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            background: 'linear-gradient(0deg, rgba(255,255,255,0.02), transparent)',
          }}
        >
          <button
            type="button"
            onClick={handleReset}
            style={{
              background: 'transparent',
              border: '1px solid rgba(255, 255, 255, 0.15)',
              color: 'rgba(255, 255, 255, 0.6)',
              padding: '8px 14px',
              borderRadius: 8,
              fontSize: 11,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            Reset to Default
          </button>

          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <button
              type="button"
              onClick={onClose}
              style={{
                background: 'transparent',
                border: 'none',
                color: 'rgba(255, 255, 255, 0.6)',
                padding: '8px 14px',
                fontSize: 12,
                cursor: 'pointer',
              }}
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleApply}
              style={{
                background: 'linear-gradient(135deg, #4ECDC4, #38EF7D)',
                border: 'none',
                color: '#0D1117',
                padding: '8px 20px',
                borderRadius: 8,
                fontSize: 12,
                fontWeight: 700,
                cursor: 'pointer',
                boxShadow: '0 4px 14px rgba(78, 205, 196, 0.35)',
              }}
            >
              Apply Language Settings
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
