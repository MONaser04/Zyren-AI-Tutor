import { useState, useEffect } from 'react';
import { LiveKitRoom, RoomAudioRenderer } from '@livekit/components-react';
import '@livekit/components-styles';
import { Whiteboard } from './components/Whiteboard';
import {
  ApiKeyOnboardingGate,
  fetchApiKeyStatus,
  type ApiKeyStatusInfo,
} from './components/ApiKeyModal';
import type { VerbosityMode, VocalToneMode, LearnerProfileMode, SpeakingStyleConfig } from './components/PersonaSelectorModal';
import { DEFAULT_LANGUAGE_CONFIG } from './components/LanguageSelectorModal';
import type { LanguageConfig } from './types';

function App() {
  const [token, setToken] = useState<string>('');
  const [url, setUrl] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [isConnecting, setIsConnecting] = useState(true);
  const [retryCount, setRetryCount] = useState(0);
  const [connectionState, setConnectionState] = useState<'idle' | 'connecting' | 'connected' | 'disconnected' | 'error'>('idle');
  const [resourcesLoaded, setResourcesLoaded] = useState(false);
  const [forceDemo, setForceDemo] = useState(false);
  const [apiKeyStatus, setApiKeyStatus] = useState<ApiKeyStatusInfo | null>(null);
  const [apiKeyChecked, setApiKeyChecked] = useState<boolean>(false);
  const [selectedVoice, setSelectedVoice] = useState<string>(() => {
    return localStorage.getItem('AI_TUTOR_SELECTED_VOICE') || 'Aoede';
  });
  const [writingStyle, setWritingStyle] = useState<string>(() => {
    return localStorage.getItem('AI_TUTOR_WRITING_STYLE') || 'mixed';
  });
  const [selectedModel, setSelectedModel] = useState<string>(() => {
    return localStorage.getItem('AI_TUTOR_SELECTED_MODEL') || 'gemini-3.8-live-extended-thinking';
  });
  const [thinkingLevel, setThinkingLevel] = useState<string>(() => {
    return localStorage.getItem('AI_TUTOR_THINKING_LEVEL') || 'high';
  });
  const [verbosity, setVerbosity] = useState<VerbosityMode>(() => {
    return (localStorage.getItem('AI_TUTOR_VERBOSITY') as VerbosityMode) || 'balanced';
  });
  const [vocalTone, setVocalTone] = useState<VocalToneMode>(() => {
    return (localStorage.getItem('AI_TUTOR_VOCAL_TONE') as VocalToneMode) || 'natural';
  });
  const [learnerProfile, setLearnerProfile] = useState<LearnerProfileMode>(() => {
    return (localStorage.getItem('AI_TUTOR_LEARNER_PROFILE') as LearnerProfileMode) || 'general';
  });
  const [learnerName, setLearnerName] = useState<string>(() => {
    try {
      return localStorage.getItem('AI_TUTOR_LEARNER_NAME') || '';
    } catch {
      return '';
    }
  });
  const [languageConfig, setLanguageConfig] = useState<LanguageConfig>(() => {
    try {
      const saved = localStorage.getItem('AI_TUTOR_LANGUAGE_CONFIG');
      return saved ? JSON.parse(saved) : DEFAULT_LANGUAGE_CONFIG;
    } catch {
      return DEFAULT_LANGUAGE_CONFIG;
    }
  });
  const [isSpeakerMuted, setIsSpeakerMuted] = useState<boolean>(() => {
    return localStorage.getItem('AI_TUTOR_SPEAKER_MUTED') === 'true';
  });
  const MAX_RETRIES = 5;

  const handleSelectVoice = (newVoice: string) => {
    localStorage.setItem('AI_TUTOR_SELECTED_VOICE', newVoice);
    setSelectedVoice(newVoice);
  };

  const handleSelectStyle = (newStyle: string) => {
    localStorage.setItem('AI_TUTOR_WRITING_STYLE', newStyle);
    setWritingStyle(newStyle);
  };

  const handleSelectModel = (newModel: string, newThinkingLevel?: string) => {
    localStorage.setItem('AI_TUTOR_SELECTED_MODEL', newModel);
    setSelectedModel(newModel);
    if (newThinkingLevel) {
      localStorage.setItem('AI_TUTOR_THINKING_LEVEL', newThinkingLevel);
      setThinkingLevel(newThinkingLevel);
    }
  };

  const handleSelectThinkingLevel = (newLevel: string) => {
    localStorage.setItem('AI_TUTOR_THINKING_LEVEL', newLevel);
    setThinkingLevel(newLevel);
  };

  const handleUpdateSpeakingStyle = (next: SpeakingStyleConfig) => {
    localStorage.setItem('AI_TUTOR_VERBOSITY', next.verbosity);
    localStorage.setItem('AI_TUTOR_VOCAL_TONE', next.vocalTone);
    localStorage.setItem('AI_TUTOR_LEARNER_PROFILE', next.learnerProfile);
    if (next.learnerName !== undefined) {
      const cleanName = next.learnerName.trim();
      localStorage.setItem('AI_TUTOR_LEARNER_NAME', cleanName);
      setLearnerName(cleanName);
    }
    setVerbosity(next.verbosity);
    setVocalTone(next.vocalTone);
    setLearnerProfile(next.learnerProfile);
  };

  const handleUpdateLanguageConfig = (next: LanguageConfig) => {
    localStorage.setItem('AI_TUTOR_LANGUAGE_CONFIG', JSON.stringify(next));
    setLanguageConfig(next);
  };

  const handleToggleSpeakerMute = () => {
    setIsSpeakerMuted(prev => {
      const next = !prev;
      localStorage.setItem('AI_TUTOR_SPEAKER_MUTED', String(next));
      return next;
    });
  };

  // Check Gemini API Key status on boot (In-App Vault or .env)
  useEffect(() => {
    let active = true;
    fetchApiKeyStatus()
      .then((status) => {
        if (!active) return;
        setApiKeyStatus(status);
        setApiKeyChecked(true);
      })
      .catch(() => {
        if (!active) return;
        setApiKeyStatus({ configured: false, source: 'none', maskedKey: null });
        setApiKeyChecked(true);
      });
    return () => {
      active = false;
    };
  }, []);

  const handleApiKeyUpdated = (nextStatus: ApiKeyStatusInfo) => {
    setApiKeyStatus(nextStatus);
    if (forceDemo && nextStatus.configured) {
      setForceDemo(false);
      setError(null);
      setIsConnecting(true);
      setConnectionState('idle');
    }
  };

  const handleApiKeyDeleted = () => {
    setToken('');
    setUrl('');
    setForceDemo(false);
    setError(null);
    setIsConnecting(true);
    setConnectionState('idle');
    setApiKeyStatus({ configured: false, source: 'none', maskedKey: null });
  };

  // Listen for agent readiness event to re-dispatch room if created early
  useEffect(() => {
    const handleReconnect = () => {
      console.log('[App] Received zyren-reconnect-room event, refreshing room token...');
      setRetryCount(prev => prev + 1);
    };
    window.addEventListener('zyren-reconnect-room', handleReconnect);
    return () => window.removeEventListener('zyren-reconnect-room', handleReconnect);
  }, []);

  useEffect(() => {
    if (!apiKeyChecked || forceDemo || !apiKeyStatus?.configured) {
      return;
    }

    let mounted = true;
    let retryTimeout: ReturnType<typeof setTimeout> | null = null;

    const waitForAgent = async () => {
      // Check if agent is registered before creating room (up to 60 attempts * 1s = 60s)
      for (let i = 0; i < 60; i++) {
        if (!mounted) return;
        try {
          const statusRes = await fetch('/api/agent-status');
          if (statusRes.ok) {
            const statusData = await statusRes.json();
            if (statusData.ready) break;
          }
        } catch {
          // ignore network glitch while starting
        }
        await new Promise(r => setTimeout(r, 1000));
      }
    };

    const fetchToken = async () => {
      try {
        const res = await fetch(
          `/api/token?voice=${encodeURIComponent(selectedVoice)}&style=${encodeURIComponent(writingStyle)}&model=${encodeURIComponent(selectedModel)}&thinkingLevel=${encodeURIComponent(thinkingLevel)}&verbosity=${encodeURIComponent(verbosity)}&vocalTone=${encodeURIComponent(vocalTone)}&learnerProfile=${encodeURIComponent(learnerProfile)}&learnerName=${encodeURIComponent(learnerName)}&languageConfig=${encodeURIComponent(JSON.stringify(languageConfig))}`
        );
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}: ${res.statusText}`);
        }
        const data = await res.json();

        if (mounted) {
          if (data.error) {
            handleError(data.error);
          } else {
            setToken(data.token || '');
            setUrl(data.url || '');
            setIsConnecting(false);
            setConnectionState('connected');
          }
        }
      } catch (err: any) {
        if (mounted) {
          console.error('[App] fetchToken error:', err);
          handleError(err.message || 'Unknown error fetching token');
        }
      }
    };

    const handleError = (msg: string) => {
      console.error('[App] Error:', msg);
      setError(msg);
      setIsConnecting(false);
      setConnectionState('error');

      // Auto-retry logic
      if (retryCount < MAX_RETRIES) {
        setRetryCount(prev => prev + 1);
        retryTimeout = setTimeout(() => {
          if (mounted) {
            console.log('[App] Retrying connection...');
            fetchToken();
          }
        }, 2000 * Math.pow(2, retryCount)); // exponential backoff
      }
    };

    const cleanup = () => {
      mounted = false;
      if (retryTimeout) {
        clearTimeout(retryTimeout);
      }
    };

    const startFlow = async () => {
      await waitForAgent();
      if (mounted) {
        await fetchToken();
      }
    };
    startFlow();

    return () => {
      cleanup();
    };
  }, [retryCount, apiKeyChecked, apiKeyStatus?.configured, forceDemo]);

  // Wait for resources (font, etc.) to load before showing the whiteboard
  useEffect(() => {
    if ((connectionState === 'connected' || forceDemo) && !resourcesLoaded) {
      const timeout = setTimeout(() => {
        setResourcesLoaded(true);
      }, 1000); // give font time to load from CDN
      return () => clearTimeout(timeout);
    }
  }, [connectionState, resourcesLoaded, forceDemo]);

  // If forceDemo is enabled, directly render Whiteboard
  if (forceDemo) {
    return (
      <div style={{ height: '100vh', width: '100%', display: 'flex', flexDirection: 'column' }}>
        <Whiteboard 
          currentVoice={selectedVoice} 
          onSelectVoice={handleSelectVoice}
          currentStyle={writingStyle}
          onSelectStyle={handleSelectStyle}
          currentModel={selectedModel}
          onSelectModel={handleSelectModel}
          currentThinkingLevel={thinkingLevel}
          onSelectThinkingLevel={handleSelectThinkingLevel}
          verbosity={verbosity}
          vocalTone={vocalTone}
          learnerProfile={learnerProfile}
          learnerName={learnerName}
          onUpdateSpeakingStyle={handleUpdateSpeakingStyle}
          isSpeakerMuted={isSpeakerMuted}
          onToggleSpeakerMute={handleToggleSpeakerMute}
          apiKeyStatus={apiKeyStatus}
          onApiKeyUpdated={handleApiKeyUpdated}
          onApiKeyDeleted={handleApiKeyDeleted}
        languageConfig={languageConfig}
        onUpdateLanguageConfig={handleUpdateLanguageConfig}
        />
      </div>
    );
  }

  // First-Time / Missing Gemini API Key Welcome Setup Gate
  if (apiKeyChecked && !apiKeyStatus?.configured) {
    return (
      <ApiKeyOnboardingGate
        onKeyActivated={(nextStatus) => {
          setApiKeyStatus(nextStatus);
          setError(null);
          setIsConnecting(true);
          setConnectionState('idle');
        }}
        onContinueOffline={() => setForceDemo(true)}
      />
    );
  }

  if (isConnecting && connectionState === 'idle') {
    return (
      <div style={{ padding: 40, textAlign: 'center', height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div>
          <div style={{ fontSize: 48, marginBottom: 16, color: '#4ECDC4' }}>🎓</div>
          <h2>Connecting to ŽYREN AI Tutor...</h2>
          <p>Initializing LiveKit room connection...</p>
          <div style={{ border: '1px solid #4ECDC4', borderRadius: 8, padding: 20, maxWidth: 320, margin: '20px auto 0' }}>
            <p>Attempt {retryCount + 1}/{MAX_RETRIES}</p>
            <button
              onClick={() => setForceDemo(true)}
              style={{
                marginTop: 12,
                padding: '10px 18px',
                backgroundColor: '#4ECDC4',
                color: '#1a1a2e',
                border: 'none',
                borderRadius: 6,
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              🚀 Open Whiteboard in Demo Mode
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (isConnecting && connectionState === 'connecting') {
    return (
      <div style={{ padding: 40, textAlign: 'center', height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div>
          <div style={{ fontSize: 48, marginBottom: 16, color: '#4ECDC4' }}>🔗</div>
          <h2>Establishing Connection...</h2>
          <p>Connecting to LiveKit room. Please wait...</p>
          <div style={{ border: '1px solid #4ECDC4', borderRadius: 8, padding: 20, maxWidth: 320, margin: '20px auto 0' }}>
            <button
              onClick={() => setForceDemo(true)}
              style={{
                padding: '10px 18px',
                backgroundColor: '#4ECDC4',
                color: '#1a1a2e',
                border: 'none',
                borderRadius: 6,
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              🚀 Open Whiteboard in Demo Mode
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ padding: 20, color: '#fff', textAlign: 'center', height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: '#131324' }}>
        <div>
          <h2>🚫 LiveKit Server Not Connected</h2>
          <p style={{ color: '#aaa', margin: '12px 0' }}>{error}</p>
          <div style={{ display: 'flex', gap: 12, justifyContent: 'center', marginTop: 20 }}>
            <button
              onClick={() => setForceDemo(true)}
              style={{
                padding: '12px 24px',
                backgroundColor: '#4ECDC4',
                color: '#1a1a2e',
                border: 'none',
                borderRadius: 8,
                fontWeight: 600,
                fontSize: 15,
                cursor: 'pointer',
              }}
            >
              ✨ Open Whiteboard (Demo / Standalone Mode)
            </button>
            <button
              onClick={() => window.location.reload()}
              style={{
                padding: '12px 20px',
                backgroundColor: 'rgba(255,255,255,0.1)',
                color: '#fff',
                border: '1px solid rgba(255,255,255,0.2)',
                borderRadius: 8,
                cursor: 'pointer',
              }}
            >
              Retry Connection
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!token || !url) {
    return (
      <div style={{ padding: 20, height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <h2>📡 Waiting for token...</h2>
        <p>The room token is being generated. Please wait.</p>
      </div>
    );
  }

  if (connectionState === 'disconnected') {
    return (
      <div style={{ padding: 20, color: 'orange', textAlign: 'center', height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <h2>⚠️ Connection Lost</h2>
        <p>The connection to the LiveKit room was lost.</p>
        <p style={{ marginTop: 12, fontSize: 14 }}>
          The room may have been terminated or network issues occurred.<br />
          <a href="javascript:void(0)" onClick={() => window.location.reload()}
             style={{ color: '#666', textDecoration: 'underline', fontSize: 14, marginTop: 12 }}>
             Retry
          </a>
        </p>
      </div>
    );
  }

  if (!resourcesLoaded) {
    return (
      <div style={{ padding: 40, textAlign: 'center', height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div>
          <div style={{ fontSize: 48, marginBottom: 16, color: '#4ECDC4' }}>📚</div>
          <h2>Loading resources...</h2>
          <p>Initializing Arabic font and whiteboard tools...</p>
          <div style={{ border: '1px solid #4ECDC4', borderRadius: 8, padding: 20, maxWidth: 300, marginTop: 20 }}>
            <p>This may take a moment on first connection.</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <LiveKitRoom
      key={token}
      video={false}
      audio={false}
      token={token}
      serverUrl={url}
      connect={true}
      style={{ height: '100dvh', maxHeight: '100dvh', width: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}
    >
      <Whiteboard 
        currentVoice={selectedVoice} 
        onSelectVoice={handleSelectVoice}
        currentStyle={writingStyle}
        onSelectStyle={handleSelectStyle}
        currentModel={selectedModel}
        onSelectModel={handleSelectModel}
        currentThinkingLevel={thinkingLevel}
        onSelectThinkingLevel={handleSelectThinkingLevel}
        verbosity={verbosity}
        vocalTone={vocalTone}
        learnerProfile={learnerProfile}
        learnerName={learnerName}
        onUpdateSpeakingStyle={handleUpdateSpeakingStyle}
        isSpeakerMuted={isSpeakerMuted}
        onToggleSpeakerMute={handleToggleSpeakerMute}
        apiKeyStatus={apiKeyStatus}
        onApiKeyUpdated={handleApiKeyUpdated}
        onApiKeyDeleted={handleApiKeyDeleted}
        languageConfig={languageConfig}
        onUpdateLanguageConfig={handleUpdateLanguageConfig}
      />
      <RoomAudioRenderer muted={isSpeakerMuted} volume={isSpeakerMuted ? 0 : 1} />
    </LiveKitRoom>
  );
}

export default App;