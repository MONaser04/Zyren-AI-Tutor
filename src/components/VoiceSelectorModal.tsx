import React, { useState, useMemo, useRef, useEffect } from 'react';

export interface GeminiVoice {
  id: string;
  name: string;
  tone: string;
  gender: 'Female' | 'Male';
  description: string;
  category: 'Warm & Friendly' | 'Academic & Clear' | 'Energetic' | 'Confident & Firm' | 'Calm & Gentle';
}

export const ALL_GEMINI_VOICES: GeminiVoice[] = [
  { id: 'Aoede', name: 'Aoede', tone: 'Breezy', gender: 'Female', description: 'Breezy, natural, and friendly (Default)', category: 'Warm & Friendly' },
  { id: 'Puck', name: 'Puck', tone: 'Upbeat', gender: 'Male', description: 'Upbeat, enthusiastic, and lively', category: 'Energetic' },
  { id: 'Charon', name: 'Charon', tone: 'Informative', gender: 'Male', description: 'Academic, articulate, and structured', category: 'Academic & Clear' },
  { id: 'Kore', name: 'Kore', tone: 'Firm', gender: 'Female', description: 'Confident, clear, and assertive', category: 'Confident & Firm' },
  { id: 'Fenrir', name: 'Fenrir', tone: 'Excitable', gender: 'Male', description: 'Dynamic, passionate, and fast-paced', category: 'Energetic' },
  { id: 'Zephyr', name: 'Zephyr', tone: 'Bright', gender: 'Female', description: 'Bright, cheerful, and encouraging', category: 'Warm & Friendly' },
  { id: 'Leda', name: 'Leda', tone: 'Youthful', gender: 'Female', description: 'Youthful, vibrant, and approachable', category: 'Warm & Friendly' },
  { id: 'Orus', name: 'Orus', tone: 'Firm', gender: 'Male', description: 'Strong, authoritative, and steady', category: 'Confident & Firm' },
  { id: 'Callirrhoe', name: 'Callirrhoe', tone: 'Easy-going', gender: 'Female', description: 'Relaxed, conversational, and smooth', category: 'Calm & Gentle' },
  { id: 'Autonoe', name: 'Autonoe', tone: 'Bright', gender: 'Female', description: 'Crisp, radiant, and positive', category: 'Warm & Friendly' },
  { id: 'Enceladus', name: 'Enceladus', tone: 'Breathy', gender: 'Male', description: 'Soft-spoken, contemplative, and gentle', category: 'Calm & Gentle' },
  { id: 'Iapetus', name: 'Iapetus', tone: 'Clear', gender: 'Male', description: 'Articulate, balanced, and precise', category: 'Academic & Clear' },
  { id: 'Umbriel', name: 'Umbriel', tone: 'Easy-going', gender: 'Male', description: 'Mellow, calm, and friendly', category: 'Calm & Gentle' },
  { id: 'Algieba', name: 'Algieba', tone: 'Smooth', gender: 'Female', description: 'Poised, refined, and rhythmic', category: 'Calm & Gentle' },
  { id: 'Despina', name: 'Despina', tone: 'Smooth', gender: 'Female', description: 'Melodic, smooth, and pleasant', category: 'Calm & Gentle' },
  { id: 'Erinome', name: 'Erinome', tone: 'Clear', gender: 'Female', description: 'Expressive, clear, and focused', category: 'Academic & Clear' },
  { id: 'Algenib', name: 'Algenib', tone: 'Gravelly', gender: 'Male', description: 'Deep, resonant, and grounded', category: 'Confident & Firm' },
  { id: 'Rasalgethi', name: 'Rasalgethi', tone: 'Informative', gender: 'Male', description: 'Analytical, formal, and precise', category: 'Academic & Clear' },
  { id: 'Laomedeia', name: 'Laomedeia', tone: 'Upbeat', gender: 'Female', description: 'Optimistic, spirited, and engaging', category: 'Energetic' },
  { id: 'Achernar', name: 'Achernar', tone: 'Soft', gender: 'Female', description: 'Gentle, comforting, and quiet', category: 'Calm & Gentle' },
  { id: 'Alnilam', name: 'Alnilam', tone: 'Firm', gender: 'Male', description: 'Steadfast, confident, and direct', category: 'Confident & Firm' },
  { id: 'Schedar', name: 'Schedar', tone: 'Even', gender: 'Male', description: 'Balanced, neutral, and measured', category: 'Academic & Clear' },
  { id: 'Gacrux', name: 'Gacrux', tone: 'Mature', gender: 'Male', description: 'Mature, wise, and grounded', category: 'Confident & Firm' },
  { id: 'Pulcherrima', name: 'Pulcherrima', tone: 'Forward', gender: 'Female', description: 'Direct, lively, and proactive', category: 'Energetic' },
  { id: 'Achird', name: 'Achird', tone: 'Friendly', gender: 'Male', description: 'Warm, hospitable, and patient', category: 'Warm & Friendly' },
  { id: 'Zubenelgenubi', name: 'Zubenelgenubi', tone: 'Casual', gender: 'Male', description: 'Easy-to-follow, casual, and relaxed', category: 'Warm & Friendly' },
  { id: 'Vindemiatrix', name: 'Vindemiatrix', tone: 'Gentle', gender: 'Female', description: 'Kind-hearted, gentle, and reassuring', category: 'Calm & Gentle' },
  { id: 'Sadachbia', name: 'Sadachbia', tone: 'Lively', gender: 'Female', description: 'Sprightly, dynamic, and inspiring', category: 'Energetic' },
  { id: 'Sadaltager', name: 'Sadaltager', tone: 'Knowledgeable', gender: 'Male', description: 'Professorial, insightful, and expert', category: 'Academic & Clear' },
  { id: 'Sulafat', name: 'Sulafat', tone: 'Warm', gender: 'Female', description: 'Warm, supportive, and motivating', category: 'Warm & Friendly' },
];

interface VoiceSelectorModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentVoice: string;
  onSelectVoice: (voiceId: string) => void;
}

export const VoiceSelectorModal: React.FC<VoiceSelectorModalProps> = ({
  isOpen,
  onClose,
  currentVoice,
  onSelectVoice,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('All');
  const [previewVoice, setPreviewVoice] = useState<string>(currentVoice || 'Aoede');

  // Favorite Voices state (persisted in localStorage)
  const [favorites, setFavorites] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem('AI_TUTOR_FAVORITE_VOICES');
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });

  const toggleFavorite = (e: React.MouseEvent, voiceId: string) => {
    e.stopPropagation();
    setFavorites((prev) => {
      const isFav = prev.includes(voiceId);
      const updated = isFav ? prev.filter((id) => id !== voiceId) : [...prev, voiceId];
      try {
        localStorage.setItem('AI_TUTOR_FAVORITE_VOICES', JSON.stringify(updated));
      } catch {
        // Ignore storage errors
      }
      return updated;
    });
  };

  // Audio Preview Playback state
  const [playingVoiceId, setPlayingVoiceId] = useState<string | null>(null);
  const [loadingVoiceId, setLoadingVoiceId] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Sync selected voice when modal opens or currentVoice updates
  useEffect(() => {
    if (isOpen) {
      setPreviewVoice(currentVoice || 'Aoede');
    }
  }, [isOpen, currentVoice]);

  // Clean up audio on unmount or modal close
  useEffect(() => {
    if (!isOpen && audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
      setPlayingVoiceId(null);
      setLoadingVoiceId(null);
    }
  }, [isOpen]);

  const categories = ['All', 'Favorites', 'Warm & Friendly', 'Academic & Clear', 'Energetic', 'Confident & Firm', 'Calm & Gentle'];

  const filteredVoices = useMemo(() => {
    return ALL_GEMINI_VOICES.filter((v) => {
      const isFav = favorites.includes(v.id);
      const matchesCategory =
        selectedCategory === 'All'
          ? true
          : selectedCategory === 'Favorites'
          ? isFav
          : v.category === selectedCategory;
      const matchesSearch =
        searchQuery.trim() === '' ||
        v.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        v.tone.toLowerCase().includes(searchQuery.toLowerCase()) ||
        v.description.toLowerCase().includes(searchQuery.toLowerCase()) ||
        v.gender.toLowerCase().includes(searchQuery.toLowerCase());
      return matchesCategory && matchesSearch;
    });
  }, [searchQuery, selectedCategory, favorites]);

  if (!isOpen) return null;

  const handlePlayPreview = async (e: React.MouseEvent, voiceId: string) => {
    e.stopPropagation();

    // If already playing this voice, pause/stop it
    if (playingVoiceId === voiceId) {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current.currentTime = 0;
      }
      setPlayingVoiceId(null);
      return;
    }

    // Stop currently playing audio
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }

    setLoadingVoiceId(voiceId);
    try {
      const res = await fetch(`/api/voice-preview?voice=${encodeURIComponent(voiceId)}`);
      if (!res.ok) {
        throw new Error(`Error ${res.status}: ${res.statusText}`);
      }
      const data = await res.json();
      if (!data.audioUrl) {
        throw new Error(data.error || 'No audio URL returned');
      }

      const audio = new Audio(data.audioUrl);
      audioRef.current = audio;

      audio.onplay = () => {
        setLoadingVoiceId(null);
        setPlayingVoiceId(voiceId);
      };

      audio.onended = () => {
        setPlayingVoiceId(null);
        audioRef.current = null;
      };

      audio.onerror = (err) => {
        console.error('Audio playback error:', err);
        setPlayingVoiceId(null);
        setLoadingVoiceId(null);
        audioRef.current = null;
      };

      await audio.play();
    } catch (err: any) {
      console.warn('[Voice Preview] Remote synthesis unavailable, using speech synthesis fallback:', err);
      setLoadingVoiceId(null);

      if ('speechSynthesis' in window) {
        window.speechSynthesis.cancel();
        const voiceObj = ALL_GEMINI_VOICES.find((v) => v.id === voiceId);
        const utterance = new SpeechSynthesisUtterance(`Hello! I am ${voiceObj?.name || voiceId}, your ZYREN AI Tutor.`);
        const voices = window.speechSynthesis.getVoices();
        if (voiceObj?.gender === 'Female') {
          const female = voices.find((v) => v.name.toLowerCase().includes('female') || v.name.toLowerCase().includes('samantha') || v.name.toLowerCase().includes('zira'));
          if (female) utterance.voice = female;
        } else {
          const male = voices.find((v) => v.name.toLowerCase().includes('male') || v.name.toLowerCase().includes('david') || v.name.toLowerCase().includes('alex'));
          if (male) utterance.voice = male;
        }
        utterance.onstart = () => setPlayingVoiceId(voiceId);
        utterance.onend = () => setPlayingVoiceId(null);
        utterance.onerror = () => setPlayingVoiceId(null);
        window.speechSynthesis.speak(utterance);
      } else {
        setPlayingVoiceId(null);
      }
    }
  };

  const handleConfirm = () => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
    onSelectVoice(previewVoice);
    onClose();
  };

  return (
    <div
      className="voice-modal-backdrop"
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        width: '100vw',
        height: '100vh',
        backgroundColor: 'rgba(0, 0, 0, 0.8)',
        backdropFilter: 'blur(14px)',
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
      onPointerUp={(e) => e.stopPropagation()}
      onWheel={(e) => e.stopPropagation()}
    >
      <div
        className="voice-modal-container voice-modal-content"
        style={{
          width: '100%',
          maxWidth: 960,
          maxHeight: '90vh',
          backgroundColor: '#16162a',
          border: '1px solid rgba(78, 205, 196, 0.35)',
          borderRadius: 20,
          boxShadow: '0 25px 70px rgba(0, 0, 0, 0.8), 0 0 35px rgba(78, 205, 196, 0.2)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          animation: 'fadeInModal 0.22s ease-out',
        }}
        onClick={(e) => e.stopPropagation()}
        onPointerDown={(e) => e.stopPropagation()}
        onPointerUp={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div
          style={{
            padding: '22px 30px',
            borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            background: 'linear-gradient(180deg, rgba(78, 205, 196, 0.1) 0%, transparent 100%)',
          }}
        >
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontSize: 26 }}>🎙️</span>
              <h2 style={{ margin: 0, fontSize: 21, fontWeight: 700, color: '#fff', letterSpacing: '-0.02em' }}>
                ZYREN Voice Personas
              </h2>
              <span
                style={{
                  fontSize: 11,
                  padding: '3px 9px',
                  borderRadius: 12,
                  backgroundColor: 'rgba(78, 205, 196, 0.2)',
                  color: '#4ECDC4',
                  fontWeight: 700,
                  letterSpacing: '0.02em',
                }}
              >
                30 Gemini Voices
              </span>
            </div>
            <p style={{ margin: '5px 0 0', fontSize: 13, color: '#8e9aa8' }}>
              Select your preferred voice persona and preview audio samples before applying.
            </p>
          </div>

          <button
            onClick={onClose}
            aria-label="Close"
            style={{
              width: 36,
              height: 36,
              borderRadius: '50%',
              border: '1px solid rgba(255, 255, 255, 0.12)',
              backgroundColor: 'rgba(255, 255, 255, 0.05)',
              color: '#8e9aa8',
              fontSize: 18,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              transition: 'all 0.15s ease',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.15)';
              e.currentTarget.style.color = '#fff';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.05)';
              e.currentTarget.style.color = '#8e9aa8';
            }}
          >
            ✕
          </button>
        </div>

        {/* Filter & Search Bar */}
        <div style={{ padding: '16px 30px', borderBottom: '1px solid rgba(255, 255, 255, 0.06)', display: 'flex', flexDirection: 'column', gap: 12 }}>
          {/* Search Input */}
          <div style={{ position: 'relative' }}>
            <span style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', color: '#6b7280', fontSize: 15 }}>
              🔍
            </span>
            <input
              type="text"
              placeholder="Search voices by name, tone (e.g. Upbeat, Breezy), or gender..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              style={{
                width: '100%',
                boxSizing: 'border-box',
                padding: '11px 14px 11px 42px',
                backgroundColor: 'rgba(255, 255, 255, 0.05)',
                border: '1px solid rgba(255, 255, 255, 0.14)',
                borderRadius: 10,
                color: '#fff',
                fontSize: 13,
                outline: 'none',
                transition: 'border-color 0.2s ease',
                fontFamily: "'Inter', sans-serif",
              }}
              onFocus={(e) => (e.currentTarget.style.borderColor = '#4ECDC4')}
              onBlur={(e) => (e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.14)')}
            />
          </div>

          {/* Category Chips */}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {categories.map((cat) => {
              const active = selectedCategory === cat;
              const isFavCategory = cat === 'Favorites';
              return (
                <button
                  key={cat}
                  type="button"
                  className="voice-filter-chip"
                  onClick={() => setSelectedCategory(cat)}
                  style={{
                    padding: '6px 14px',
                    fontSize: 12,
                    fontWeight: 600,
                    borderRadius: 20,
                    border: active ? '1px solid #4ECDC4' : '1px solid rgba(255, 255, 255, 0.1)',
                    backgroundColor: active ? 'rgba(78, 205, 196, 0.2)' : 'rgba(255, 255, 255, 0.04)',
                    color: active ? '#4ECDC4' : '#9ca3af',
                    cursor: 'pointer',
                    transition: 'all 0.15s ease',
                    fontFamily: "'Inter', sans-serif",
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                  }}
                >
                  {isFavCategory ? (
                    <>
                      <span>❤️ Favorites</span>
                      {favorites.length > 0 && (
                        <span
                          style={{
                            fontSize: 10,
                            padding: '1px 6px',
                            borderRadius: 999,
                            backgroundColor: active ? '#4ECDC4' : 'rgba(255, 255, 255, 0.15)',
                            color: active ? '#121222' : '#fff',
                            fontWeight: 700,
                          }}
                        >
                          {favorites.length}
                        </span>
                      )}
                    </>
                  ) : (
                    cat
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* Voices Grid Container (Scrollable via Mouse Wheel and Scrollbar) */}
        <div
          className="voice-modal-grid voice-modal-content"
          style={{
            flex: 1,
            overflowY: 'auto',
            padding: '20px 30px',
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(270px, 1fr))',
            gap: 14,
            overscrollBehavior: 'contain',
          }}
          onWheel={(e) => e.stopPropagation()}
        >
          {filteredVoices.map((voice) => {
            const isSelected = previewVoice === voice.id;
            const isCurrentlyActive = currentVoice === voice.id;
            const isPlaying = playingVoiceId === voice.id;
            const isLoading = loadingVoiceId === voice.id;
            const isFav = favorites.includes(voice.id);

            return (
              <div
                key={voice.id}
                className="voice-card"
                onClick={() => setPreviewVoice(voice.id)}
                style={{
                  padding: '16px 18px',
                  borderRadius: 14,
                  border: isSelected
                    ? '2px solid #4ECDC4'
                    : '1px solid rgba(255, 255, 255, 0.09)',
                  backgroundColor: isSelected
                    ? 'rgba(78, 205, 196, 0.14)'
                    : 'rgba(255, 255, 255, 0.035)',
                  cursor: 'pointer',
                  transition: 'all 0.18s ease',
                  position: 'relative',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 8,
                  boxShadow: isSelected
                    ? '0 0 20px rgba(78, 205, 196, 0.25), 0 4px 12px rgba(0,0,0,0.3)'
                    : '0 2px 8px rgba(0,0,0,0.2)',
                  userSelect: 'none',
                }}
                onMouseEnter={(e) => {
                  if (!isSelected) {
                    e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.07)';
                    e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.22)';
                  }
                }}
                onMouseLeave={(e) => {
                  if (!isSelected) {
                    e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.035)';
                    e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.09)';
                  }
                }}
              >
                {/* Header Row */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                    <span style={{ fontSize: 18 }}>{voice.gender === 'Female' ? '👩' : '👨'}</span>
                    <span style={{ fontSize: 16, fontWeight: 700, color: isSelected ? '#4ECDC4' : '#fff' }}>
                      {voice.name}
                    </span>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <button
                      type="button"
                      className="voice-fav-btn interactive"
                      onClick={(e) => toggleFavorite(e, voice.id)}
                      onPointerDown={(e) => e.stopPropagation()}
                      onPointerUp={(e) => e.stopPropagation()}
                      title={isFav ? `Remove ${voice.name} from favorites` : `Add ${voice.name} to favorites`}
                      style={{
                        background: isFav ? 'rgba(255, 77, 109, 0.16)' : 'rgba(255, 255, 255, 0.05)',
                        border: isFav ? '1px solid rgba(255, 77, 109, 0.5)' : '1px solid rgba(255, 255, 255, 0.12)',
                        borderRadius: 8,
                        cursor: 'pointer',
                        padding: '3px 7px',
                        fontSize: 14,
                        lineHeight: 1,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        color: isFav ? '#ff4d6d' : 'rgba(255, 255, 255, 0.45)',
                        transition: 'all 0.18s ease',
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.transform = 'scale(1.15)';
                        if (!isFav) {
                          e.currentTarget.style.backgroundColor = 'rgba(255, 77, 109, 0.12)';
                        }
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.transform = 'scale(1)';
                        if (!isFav) {
                          e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.05)';
                        }
                      }}
                    >
                      {isFav ? '❤️' : '🤍'}
                    </button>

                    <span
                      style={{
                        fontSize: 11,
                        padding: '2px 8px',
                        borderRadius: 10,
                        backgroundColor: 'rgba(255, 255, 255, 0.08)',
                        color: '#d1d5db',
                        fontWeight: 600,
                      }}
                    >
                      {voice.tone}
                    </span>
                    {isCurrentlyActive && (
                      <span
                        style={{
                          fontSize: 10,
                          padding: '2px 7px',
                          borderRadius: 10,
                          backgroundColor: 'rgba(34, 197, 94, 0.22)',
                          color: '#4ade80',
                          fontWeight: 700,
                          border: '1px solid rgba(74, 222, 128, 0.4)',
                        }}
                      >
                        Active
                      </span>
                    )}
                  </div>
                </div>

                {/* Description */}
                <div style={{ fontSize: 12, color: '#9ca3af', lineHeight: 1.45 }}>
                  {voice.description}
                </div>

                {/* Audio Sample Preview Button & Category */}
                <div style={{ marginTop: 'auto', paddingTop: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: '1px solid rgba(255, 255, 255, 0.06)' }}>
                  <button
                    type="button"
                    className="voice-play-btn"
                    onClick={(e) => handlePlayPreview(e, voice.id)}
                    title={`Listen to a sample of ${voice.name}'s voice`}
                    style={{
                      padding: '5px 12px',
                      fontSize: 11,
                      fontWeight: 600,
                      borderRadius: 6,
                      border: isPlaying ? '1px solid #4ECDC4' : '1px solid rgba(255, 255, 255, 0.15)',
                      backgroundColor: isPlaying
                        ? 'rgba(78, 205, 196, 0.25)'
                        : isLoading
                        ? 'rgba(255, 255, 255, 0.1)'
                        : 'rgba(255, 255, 255, 0.07)',
                      color: isPlaying ? '#4ECDC4' : '#e2e8f0',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 5,
                      transition: 'all 0.15s ease',
                      fontFamily: "'Inter', sans-serif",
                    }}
                    onMouseEnter={(e) => {
                      if (!isPlaying) {
                        e.currentTarget.style.backgroundColor = 'rgba(78, 205, 196, 0.18)';
                        e.currentTarget.style.borderColor = 'rgba(78, 205, 196, 0.4)';
                      }
                    }}
                    onMouseLeave={(e) => {
                      if (!isPlaying) {
                        e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.07)';
                        e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.15)';
                      }
                    }}
                  >
                    {isLoading ? (
                      <>
                        <span>⏳</span>
                        <span>Loading...</span>
                      </>
                    ) : isPlaying ? (
                      <>
                        <span>🔊</span>
                        <span>Playing Sample</span>
                        <span style={{ fontSize: 10, color: '#f87171' }}>■</span>
                      </>
                    ) : (
                      <>
                        <span>▶</span>
                        <span>Listen Sample</span>
                      </>
                    )}
                  </button>

                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ fontSize: 10, color: '#6b7280' }}>
                      {voice.category}
                    </span>
                    {isSelected && (
                      <span style={{ color: '#4ECDC4', fontSize: 15, fontWeight: 'bold' }}>✓</span>
                    )}
                  </div>
                </div>
              </div>
            );
          })}

          {filteredVoices.length === 0 && selectedCategory === 'Favorites' ? (
            <div style={{ gridColumn: '1 / -1', padding: '60px 20px', textAlign: 'center', color: '#8e9aa8' }}>
              <div style={{ fontSize: 42, marginBottom: 14 }}>🤍</div>
              <div style={{ fontSize: 17, fontWeight: 700, color: '#fff', marginBottom: 8 }}>No Favorite Voices Yet</div>
              <div style={{ fontSize: 13, color: '#9ca3af', maxWidth: 380, margin: '0 auto', lineHeight: 1.5 }}>
                Click the heart icon <span style={{ color: '#ff4d6d' }}>🤍</span> on any voice persona card to bookmark it here for fast access.
              </div>
            </div>
          ) : filteredVoices.length === 0 ? (
            <div style={{ gridColumn: '1 / -1', padding: 50, textAlign: 'center', color: '#6b7280' }}>
              No voices match your search query "{searchQuery}".
            </div>
          ) : null}
        </div>

        {/* Modal Footer */}
        <div
          style={{
            padding: '18px 30px',
            borderTop: '1px solid rgba(255, 255, 255, 0.08)',
            backgroundColor: '#121222',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 13, color: '#9ca3af' }}>Selected Persona:</span>
            <span style={{ fontSize: 15, fontWeight: 700, color: '#4ECDC4' }}>
              {ALL_GEMINI_VOICES.find((v) => v.id === previewVoice)?.name} ({ALL_GEMINI_VOICES.find((v) => v.id === previewVoice)?.tone})
            </span>
          </div>

          <div style={{ display: 'flex', gap: 12 }}>
            <button
              onClick={onClose}
              style={{
                padding: '10px 20px',
                fontSize: 13,
                fontWeight: 600,
                borderRadius: 8,
                border: '1px solid rgba(255, 255, 255, 0.14)',
                backgroundColor: 'transparent',
                color: '#d1d5db',
                cursor: 'pointer',
                transition: 'all 0.15s ease',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.06)';
                e.currentTarget.style.color = '#fff';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = 'transparent';
                e.currentTarget.style.color = '#d1d5db';
              }}
            >
              Cancel
            </button>

            <button
              onClick={handleConfirm}
              style={{
                padding: '10px 26px',
                fontSize: 13,
                fontWeight: 700,
                borderRadius: 8,
                border: 'none',
                backgroundColor: '#4ECDC4',
                color: '#121222',
                cursor: 'pointer',
                boxShadow: '0 4px 16px rgba(78, 205, 196, 0.4)',
                transition: 'all 0.15s ease',
                fontFamily: "'Inter', sans-serif",
              }}
              onMouseEnter={(e) => (e.currentTarget.style.transform = 'translateY(-1px)')}
              onMouseLeave={(e) => (e.currentTarget.style.transform = 'translateY(0)')}
            >
              Apply Voice Persona
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
