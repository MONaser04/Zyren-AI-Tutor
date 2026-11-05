import React, { useRef, useEffect, useState, useCallback } from 'react';
import { useMaybeRoomContext } from '@livekit/components-react';
import { RoomEvent, Track } from 'livekit-client';
import { CanvasLayer, type CanvasLayerHandle } from '../layers/CanvasLayer';
import { SVGOverlay, type SVGOverlayHandle } from '../layers/SVGOverlay';
import { MathOverlay, type MathOverlayHandle } from '../layers/MathOverlay';
import { GraphOverlay, type GraphOverlayHandle } from '../layers/GraphOverlay';
import { Graph3DOverlay, type Graph3DOverlayHandle } from '../layers/Graph3DOverlay';
import { VennOverlay, type VennOverlayHandle } from '../layers/VennOverlay';
import { SlideMediaOverlay, type SlideMediaOverlayHandle } from '../layers/SlideMediaOverlay';
import { SyncEngine } from '../engine/SyncEngine';
import { useTeacherStore } from '../store/useTeacherStore';
import { SlidePanel, type WhiteboardPage, type UserDrawingPath, type UserDrawingText } from './SlidePanel';
import { UserDrawingLayer } from './UserDrawingLayer';
import { FileMenu, type RecentSession } from './FileMenu';
import {
  createBlankWhiteboardPage,
  DEFAULT_WHITEBOARD_TITLE,
  reconcileLiveChatMessages,
} from './whiteboardSession';
import { VoiceSelectorModal, ALL_GEMINI_VOICES } from './VoiceSelectorModal';
import { ModelSelectorModal, SUPPORTED_MODELS } from './ModelSelectorModal';
import {
  PersonaSelectorModal,
  VERBOSITY_OPTIONS,
  VOCAL_TONE_OPTIONS,
  LEARNER_PROFILE_OPTIONS,
  type VerbosityMode,
  type VocalToneMode,
  type LearnerProfileMode,
  type SpeakingStyleConfig,
} from './PersonaSelectorModal';
import {
  LanguageSelectorModal,
  SUPPORTED_LANGUAGES,
  DEFAULT_LANGUAGE_CONFIG,
} from './LanguageSelectorModal';
import type { LanguageConfig } from '../types';
import { FloatingVideoPiP } from './FloatingVideoPiP';
import { ChatDrawer, type ChatMessage, type ChatAttachment } from './ChatDrawer';
import { ApiKeyManagerModal, type ApiKeyStatusInfo } from './ApiKeyModal';
import {
  computeAutoFollowPan,
  computeAutoFollowTransform,
  stepAutoFollowLerp,
  stepAutoFollowTransformLerp,
  type WritingFocusTarget,
} from '../engine/CameraFollowController';
import { toggleSessionPinDualTier } from '../services/sessionAutoSave';
import {
  createSessionId,
  hasSubstantiveSessionContent,
  deriveSmartSessionTitle,
  persistSessionDualTier,
  flushSessionEmergencyOnExit,
  loadLatestAutoSavedSession,
  loadSpecificSavedSession,
  listAllSavedSessions,
  deleteSavedSessionEverywhere,
  type SavedTutorSession,
  type SavedSessionSummary,
} from '../services/sessionAutoSave';
import html2canvas from 'html2canvas';
import { jsPDF } from 'jspdf';
import type { DrawCommand, HandwritingPayload, ShapePayload, SyncTelemetry, CharTiming } from '../types';

// Font URL — using Google Fonts CDN for Caveat (Latin handwritten blackboard font)
const FONT_URL = 'https://fonts.gstatic.com/s/caveat/v23/WnznHAc5bAfYB2QRah7pcpNvOx-pjSx6SII.ttf';

// Virtual world canvas dimensions (Standard 16:9 1080p canvas)
const VIRTUAL_WIDTH = 1920;
const VIRTUAL_HEIGHT = 1080;

export const WRITING_STYLES = [
  { id: 'mixed', label: 'Mixed (Auto)', short: 'Mixed', icon: '✒️' },
  { id: 'handwriting', label: 'Handwriting', short: 'Hand', icon: '✍️' },
  { id: 'normal', label: 'Normal Text', short: 'Text', icon: '🔤' },
];

function mergeVaultSummariesWithRecent(
  summaries: SavedSessionSummary[],
  existing: RecentSession[]
): RecentSession[] {
  const mapped: RecentSession[] = summaries.map((s) => ({
    id: s.id,
    name: s.title || DEFAULT_WHITEBOARD_TITLE,
    timestamp: s.updatedAt,
    slideCount: s.slideCount || 1,
    messageCount: s.messageCount || 0,
  }));
  const seenIds = new Set(mapped.map((m) => m.id));
  for (const leg of existing) {
    if (!seenIds.has(leg.id)) {
      mapped.push(leg);
    }
  }
  return mapped.sort((a, b) => b.timestamp - a.timestamp).slice(0, 40);
}

interface WhiteboardProps {
  currentVoice?: string;
  onSelectVoice?: (voiceId: string) => void;
  currentStyle?: string;
  onSelectStyle?: (style: string) => void;
  currentModel?: string;
  onSelectModel?: (modelId: string, thinkingLevel?: string) => void;
  currentThinkingLevel?: string;
  onSelectThinkingLevel?: (thinkingLevel: string) => void;
  verbosity?: VerbosityMode;
  vocalTone?: VocalToneMode;
  learnerProfile?: LearnerProfileMode;
  learnerName?: string;
  tutorName?: string;
  onUpdateSpeakingStyle?: (next: SpeakingStyleConfig) => void;
  isSpeakerMuted?: boolean;
  onToggleSpeakerMute?: () => void;
  apiKeyStatus?: ApiKeyStatusInfo | null;
  onApiKeyUpdated?: (status: ApiKeyStatusInfo) => void;
  onApiKeyDeleted?: () => void;
  languageConfig?: LanguageConfig;
  onUpdateLanguageConfig?: (next: LanguageConfig) => void;
}

export function Whiteboard({
  currentVoice = 'Aoede',
  onSelectVoice,
  currentStyle = 'mixed',
  onSelectStyle,
  currentModel = 'gemini-3.8-live-extended-thinking',
  onSelectModel,
  currentThinkingLevel = 'high',
  onSelectThinkingLevel,
  verbosity = 'balanced',
  vocalTone = 'natural',
  learnerProfile = 'general',
  learnerName = '',
  tutorName = 'Zyren',
  onUpdateSpeakingStyle,
  isSpeakerMuted = false,
  onToggleSpeakerMute,
  apiKeyStatus = null,
  onApiKeyUpdated,
  onApiKeyDeleted,
  languageConfig = DEFAULT_LANGUAGE_CONFIG,
  onUpdateLanguageConfig,
}: WhiteboardProps) {
  const canvasRef = useRef<CanvasLayerHandle>(null);
  const svgRef = useRef<SVGOverlayHandle>(null);
  const mathRef = useRef<MathOverlayHandle>(null);
  const graphRef = useRef<GraphOverlayHandle>(null);
  const graph3dRef = useRef<Graph3DOverlayHandle>(null);
  const vennRef = useRef<VennOverlayHandle>(null);
  const mediaRef = useRef<SlideMediaOverlayHandle>(null);
  const engineRef = useRef<SyncEngine | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const styleMenuRef = useRef<HTMLDivElement>(null);
  const quickFileInputRef = useRef<HTMLInputElement>(null);
  const slideMediaInputRef = useRef<HTMLInputElement>(null);
  const forceImmediateVisionFrameRef = useRef<boolean>(false);
  const [isCanvasDragOver, setIsCanvasDragOver] = useState<boolean>(false);
  const currentStyleRef = useRef(currentStyle);
  currentStyleRef.current = currentStyle;

  const [hasStarted, setHasStarted] = useState(false);
  const [toolMode, setToolMode] = useState<'pointer' | 'pen' | 'text' | 'eraser'>('pointer');
  const [isToolbarPinned, setIsToolbarPinned] = useState(true);
  const [isHoveringBottom, setIsHoveringBottom] = useState(false);
  const [isMicrophoneEnabled, setIsMicrophoneEnabled] = useState(false);
  const [inputText, setInputText] = useState('');
  const [attachedFile, setAttachedFile] = useState<ChatAttachment | null>(null);
  const [isVoiceModalOpen, setIsVoiceModalOpen] = useState(false);
  const [isModelModalOpen, setIsModelModalOpen] = useState(false);
  const [isPersonaModalOpen, setIsPersonaModalOpen] = useState(false);
  const [isLanguageModalOpen, setIsLanguageModalOpen] = useState(false);
  const [isApiKeyModalOpen, setIsApiKeyModalOpen] = useState(false);
  const [isChatDrawerOpen, setIsChatDrawerOpen] = useState(false);
  const [isStyleMenuOpen, setIsStyleMenuOpen] = useState(false);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const chatMessagesRef = useRef<ChatMessage[]>(chatMessages);
  chatMessagesRef.current = chatMessages;

  // Session Identity, Title & Continuous Dual-Tier Auto-Save state
  const sessionIdRef = useRef<string>(createSessionId());
  const [activeSessionId, setActiveSessionId] = useState<string>(() => sessionIdRef.current);
  const sessionCreatedAtRef = useRef<number>(Date.now());
  const isAutoTitledRef = useRef<boolean>(true);
  const autoSaveHydratedRef = useRef<boolean>(false);
  const [autoSaveState, setAutoSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('saved');
  const [lastAutoSavedAt, setLastAutoSavedAt] = useState<number | null>(null);

  const [sessionTitle, setSessionTitle] = useState<string>(DEFAULT_WHITEBOARD_TITLE);
  const sessionTitleRef = useRef<string>(sessionTitle);
  sessionTitleRef.current = sessionTitle;

  const handleUpdateSessionTitle = useCallback((nextTitle: string) => {
    isAutoTitledRef.current = false;
    setSessionTitle(nextTitle);
  }, []);

  const [recentSessions, setRecentSessions] = useState<RecentSession[]>(() => {
    try {
      const saved = localStorage.getItem('AI_TUTOR_RECENT_SESSIONS');
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });

  // Live Writing Auto-Follow Camera state (toggleable ON/OFF)
  const [isAutoFollowEnabled, setIsAutoFollowEnabled] = useState<boolean>(() => {
    try {
      const saved = localStorage.getItem('AI_TUTOR_AUTO_FOLLOW');
      return saved === null ? true : saved === 'true';
    } catch {
      return true;
    }
  });
  const isAutoFollowRef = useRef<boolean>(isAutoFollowEnabled);
  isAutoFollowRef.current = isAutoFollowEnabled;

  const [isAutoResizeEnabled, setIsAutoResizeEnabled] = useState<boolean>(() => {
    try {
      const saved = localStorage.getItem('AI_TUTOR_AUTO_RESIZE');
      return saved === null ? true : saved === 'true';
    } catch {
      return true;
    }
  });
  const isAutoResizeRef = useRef<boolean>(isAutoResizeEnabled);
  isAutoResizeRef.current = isAutoResizeEnabled;

  const lastManualCameraMoveRef = useRef<number>(-Infinity);
  const manualCooldownTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autoFollowTargetTransformRef = useRef<{ zoom: number; pan: { x: number; y: number } } | null>(null);
  const autoFollowRafRef = useRef<number | null>(null);
  const lastFocusTargetRef = useRef<WritingFocusTarget | null>(null);
  const isSwitchingSlideRef = useRef<boolean>(false);

  // Multi-Board Slide Deck state
  const [pages, setPages] = useState<WhiteboardPage[]>(() => [createBlankWhiteboardPage()]);
  const [activePageIndex, setActivePageIndex] = useState<number>(0);
  const [isSlidePanelOpen, setIsSlidePanelOpen] = useState<boolean>(() => typeof window !== 'undefined' ? window.innerWidth > 768 : true);
  const [showRotateBanner, setShowRotateBanner] = useState(true);
  const [isPortraitMobile, setIsPortraitMobile] = useState(false);

  const isChatDrawerOpenRef = useRef(isChatDrawerOpen);
  isChatDrawerOpenRef.current = isChatDrawerOpen;
  const isSlidePanelOpenRef = useRef(isSlidePanelOpen);
  isSlidePanelOpenRef.current = isSlidePanelOpen;
  const isToolbarPinnedRef = useRef(isToolbarPinned);
  isToolbarPinnedRef.current = isToolbarPinned;

  useEffect(() => {
    const checkOrientation = () => {
      const isMobile = window.innerWidth <= 768;
      const isPortrait = window.innerHeight > window.innerWidth;
      setIsPortraitMobile(isMobile && isPortrait);
    };
    checkOrientation();
    window.addEventListener('resize', checkOrientation);
    window.addEventListener('orientationchange', checkOrientation);
    return () => {
      window.removeEventListener('resize', checkOrientation);
      window.removeEventListener('orientationchange', checkOrientation);
    };
  }, []);

  const pagesRef = useRef(pages);
  pagesRef.current = pages;
  const activePageIndexRef = useRef(activePageIndex);
  activePageIndexRef.current = activePageIndex;
  
  // Unified Viewport Transform state (Zoom & Pan)
  const [transform, setTransform] = useState<{ zoom: number; pan: { x: number; y: number } }>({
    zoom: 1,
    pan: { x: 0, y: 0 },
  });

  const transformRef = useRef(transform);
  transformRef.current = transform;

  // Auto-fit Whiteboard to screen
  const autoFitCanvas = useCallback(() => {
    if (!containerRef.current) return;
    const cw = containerRef.current.clientWidth || window.innerWidth;
    const ch = containerRef.current.clientHeight || window.innerHeight;
    const isMobile = cw <= 768 || ch <= 500;
    const isLandscape = cw > ch;

    const topBarHeight = isMobile ? (isLandscape ? 38 : 46) : 60;
    const bottomBarHeight = isMobile ? (isLandscape ? 50 : 64) : 74;
    const paddingX = isMobile ? 8 : 24;

    const availWidth = Math.max(100, cw - paddingX * 2);
    const availHeight = Math.max(100, ch - topBarHeight - bottomBarHeight);

    const scaleX = availWidth / VIRTUAL_WIDTH;
    const scaleY = availHeight / VIRTUAL_HEIGHT;
    const fitZoom = Math.min(scaleX, scaleY);

    const panX = (cw - VIRTUAL_WIDTH * fitZoom) / 2;
    const panY = topBarHeight + (availHeight - VIRTUAL_HEIGHT * fitZoom) / 2;

    setTransform({
      zoom: fitZoom,
      pan: { x: panX, y: panY },
    });
  }, []);

  useEffect(() => {
    autoFitCanvas();
    const handleResize = () => {
      autoFitCanvas();
    };
    window.addEventListener('resize', handleResize);
    window.addEventListener('orientationchange', handleResize);
    return () => {
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('orientationchange', handleResize);
    };
  }, [autoFitCanvas]);

  const room = useMaybeRoomContext();
  const { setTelemetry, showDebugOverlay, toggleDebugOverlay } = useTeacherStore();

  // Track LiveKit Agent presence
  const [isAgentReady, setIsAgentReady] = useState<boolean>(() => {
    return Boolean(room && room.remoteParticipants && room.remoteParticipants.size > 0);
  });

  useEffect(() => {
    if (!room) return;
    const updateAgentStatus = () => {
      const hasAgent = room.remoteParticipants.size > 0;
      setIsAgentReady(hasAgent);
    };
    updateAgentStatus();
    room.on(RoomEvent.ParticipantConnected, updateAgentStatus);
    room.on(RoomEvent.ParticipantDisconnected, updateAgentStatus);
    room.on(RoomEvent.Connected, updateAgentStatus);
    room.on(RoomEvent.Reconnected, updateAgentStatus);

    return () => {
      room.off(RoomEvent.ParticipantConnected, updateAgentStatus);
      room.off(RoomEvent.ParticipantDisconnected, updateAgentStatus);
      room.off(RoomEvent.Connected, updateAgentStatus);
      room.off(RoomEvent.Reconnected, updateAgentStatus);
    };
  }, [room]);

  // Auto-recovery: If room connected before agent process was registered,
  // automatically reconnect the room as soon as the agent becomes ready.
  useEffect(() => {
    if (!room || room.state !== 'connected' || isAgentReady) return;

    let cancelled = false;
    const interval = setInterval(async () => {
      if (cancelled || isAgentReady) return;
      try {
        const res = await fetch('/api/agent-status');
        if (res.ok) {
          const data = await res.json();
          if (data.ready && room.remoteParticipants.size === 0) {
            console.log('[Whiteboard] Agent is ready now! Triggering soft room reconnect...');
            window.dispatchEvent(new CustomEvent('zyren-reconnect-room'));
          }
        }
      } catch {
        // ignore
      }
    }, 1500);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [room, room?.state, isAgentReady]);

  // ── Native LiveKit Video Management ──
  const [isSplitViewEnabled, setIsSplitViewEnabled] = useState(false);
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [isWebcamActive, setIsWebcamActive] = useState(false);

  // Refs for Direct Vision WebSocket & Streams
  const directVisionWsRef = useRef<WebSocket | null>(null);
  const unifiedVisionIntervalRef = useRef<number | null>(null);
  const screenStreamRef = useRef<MediaStream | null>(null);
  const webcamStreamRef = useRef<MediaStream | null>(null);
  
  const screenVideoRef = useRef<HTMLVideoElement | null>(null);
  const webcamVideoRef = useRef<HTMLVideoElement | null>(null);
  const [wsConnected, setWsConnected] = useState(false);

  // Setup video elements once
  useEffect(() => {
    if (!screenVideoRef.current) screenVideoRef.current = document.createElement('video');
    if (!webcamVideoRef.current) webcamVideoRef.current = document.createElement('video');
  }, []);

  // Sync state with LiveKit local participant
  useEffect(() => {
    if (!room) return;
    const updateVideoState = () => {
      // Sync local state if using LiveKit
    };
    room.localParticipant.on('localTrackPublished', updateVideoState);
    room.localParticipant.on('localTrackUnpublished', updateVideoState);
    return () => {
      room.localParticipant.off('localTrackPublished', updateVideoState);
      room.localParticipant.off('localTrackUnpublished', updateVideoState);
    };
  }, [room]);

  // Hot-swap voice, model, thinking level, and style metadata without wiping active settings
  useEffect(() => {
    if (room && room.localParticipant) {
      const newMeta = JSON.stringify({
        voice: currentVoice,
        style: currentStyle,
        model: currentModel,
        thinkingLevel: currentThinkingLevel,
        verbosity,
        vocalTone,
        learnerProfile,
        languageConfig,
      });
      room.localParticipant.setMetadata(newMeta);
      console.log('[Whiteboard] Hot-swapped metadata:', newMeta);
    }
    engineRef.current?.setWritingStyle(currentStyle);
  }, [
    room,
    currentVoice,
    currentStyle,
    currentModel,
    currentThinkingLevel,
    verbosity,
    vocalTone,
    learnerProfile,
    languageConfig,
  ]);

  // Close writing style menu on click outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (styleMenuRef.current && !styleMenuRef.current.contains(e.target as Node)) {
        setIsStyleMenuOpen(false);
      }
    };
    if (isStyleMenuOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isStyleMenuOpen]);

  // Maintain Persistent WebSocket Connection
  useEffect(() => {
    let ws: WebSocket;
    let reconnectTimeout: number;
    let isCleanedUp = false;

    const connect = () => {
      if (isCleanedUp) return;
      const wsHost = window.location.hostname || '127.0.0.1';
      ws = new WebSocket(`ws://${wsHost}:8888`);
      directVisionWsRef.current = ws;

      ws.onopen = () => {
        if (isCleanedUp) {
          ws.close();
          return;
        }
        console.log('[DirectVision] WS Connected');
        setWsConnected(true);
      };

      ws.onclose = () => {
        setWsConnected(false);
        if (!isCleanedUp) {
          reconnectTimeout = window.setTimeout(connect, 3000);
        }
      };

      ws.onerror = (err) => {
        console.error('[DirectVision] WS Error', err);
        ws.close();
      };
    };

    connect();

    return () => {
      isCleanedUp = true;
      clearTimeout(reconnectTimeout);
      if (ws) {
        ws.close();
      }
      directVisionWsRef.current = null;
    };
  }, []);

  // Composite 1280x720 Whiteboard Stage Capture (renders live <video>/<img> frames + annotations in <2ms on video ticks)
  const cachedOverlayCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const cachedOverlaySigRef = useRef<string>('');

  const captureCompositeWhiteboardStage = useCallback(async (forceRefreshOverlay = false): Promise<HTMLCanvasElement | null> => {
    const stageCanvas = document.createElement('canvas');
    stageCanvas.width = 1280;
    stageCanvas.height = 720;
    const stageCtx = stageCanvas.getContext('2d');
    if (!stageCtx) return null;

    // 1. Paint whiteboard background
    stageCtx.fillStyle = '#131324';
    stageCtx.fillRect(0, 0, 1280, 720);

    // 2. Paint live decoded <img> and <video> frames + [PLAYING/PAUSED MM:SS] badge directly from GPU memory
    if (mediaRef.current) {
      stageCtx.save();
      stageCtx.scale(1280 / VIRTUAL_WIDTH, 720 / VIRTUAL_HEIGHT);
      mediaRef.current.drawMediaToCanvas(stageCtx);
      stageCtx.restore();
    }

    // 3. Paint vector/DOM annotations (Rough.js, SVG handwriting, KaTeX math, graphs, user strokes) on top
    const eng = engineRef.current;
    const activeP = pagesRef.current[activePageIndexRef.current];
    const overlaySig = `${activePageIndexRef.current}:${eng ? eng.getDrawnShapes().length : 0}:${eng ? eng.getDrawnHandwriting().length : 0}:${activeP?.userPaths?.length || 0}:${activeP?.userTexts?.length || 0}`;

    if (
      forceRefreshOverlay ||
      !cachedOverlayCanvasRef.current ||
      cachedOverlaySigRef.current !== overlaySig
    ) {
      const targetEl = viewportRef.current || document.body;
      try {
        const renderedOverlay = await html2canvas(targetEl, {
          backgroundColor: null,
          width: viewportRef.current ? VIRTUAL_WIDTH : undefined,
          height: viewportRef.current ? VIRTUAL_HEIGHT : undefined,
          scale: viewportRef.current ? 1280 / VIRTUAL_WIDTH : 0.65,
          useCORS: true,
          logging: false,
          ignoreElements: (e) =>
            e.classList.contains('no-vision') || e.classList.contains('slide-media-overlay'),
          onclone: (clonedDoc) => {
            const clonedViewport = clonedDoc.querySelector('.whiteboard-viewport') as HTMLElement | null;
            if (clonedViewport) {
              clonedViewport.style.transform = 'none';
            }
          },
        });
        cachedOverlayCanvasRef.current = renderedOverlay;
        cachedOverlaySigRef.current = overlaySig;
      } catch {
        // Keep last valid overlay if html2canvas fails transiently
      }
    }

    if (cachedOverlayCanvasRef.current) {
      stageCtx.drawImage(cachedOverlayCanvasRef.current, 0, 0, 1280, 720);
    }

    return stageCanvas;
  }, []);

  // Unified Direct Vision Compositor (1 FPS Live Video Mode + 3s Static Dedup Mode)
  useEffect(() => {
    if (!wsConnected) {
      if (unifiedVisionIntervalRef.current) {
        window.clearInterval(unifiedVisionIntervalRef.current);
        unifiedVisionIntervalRef.current = null;
      }
      return;
    }

    let lastWbSignature = '';
    let lastSentTimestamp = 0;
    let isTickBusy = false;

    unifiedVisionIntervalRef.current = window.setInterval(async () => {
      if (isTickBusy) return;
      const ws = directVisionWsRef.current;
      if (!ws || ws.readyState !== WebSocket.OPEN) return;

      const now = Date.now();
      const hasPlayingSlideVideo = Boolean(mediaRef.current?.hasPlayingVideo());
      const forceImmediate = forceImmediateVisionFrameRef.current;

      // Dynamic cadence: 1000ms (1 FPS) when a slide video is playing or forced; 2000ms for screen/webcam; 3000ms for static board
      const targetCadenceMs = forceImmediate
        ? 0
        : hasPlayingSlideVideo
          ? 1000
          : isScreenSharing || isWebcamActive
            ? 2000
            : 3000;

      if (now - lastSentTimestamp < targetCadenceMs) return;

      isTickBusy = true;
      try {
        if (forceImmediate) {
          forceImmediateVisionFrameRef.current = false;
        }

        const masterCanvas = document.createElement('canvas');
        masterCanvas.width = 1280;
        masterCanvas.height = 720;
        const ctx = masterCanvas.getContext('2d');
        if (!ctx) return;

        if (isSplitViewEnabled) {
          // ── Split-View Mode: Parallel Multi-Vision (1280x720) ──
          const wbCanvas = await captureCompositeWhiteboardStage(forceImmediate);
          ctx.fillStyle = '#0f0f1b';
          ctx.fillRect(0, 0, 1280, 720);

          const hasScreen = isScreenSharing && screenVideoRef.current && screenVideoRef.current.videoWidth > 0;
          const hasWebcam = isWebcamActive && webcamVideoRef.current && webcamVideoRef.current.videoWidth > 0;

          if (hasScreen && hasWebcam) {
            if (wbCanvas) ctx.drawImage(wbCanvas, 0, 0, 640, 720);
            ctx.drawImage(screenVideoRef.current!, 640, 0, 640, 360);
            ctx.drawImage(webcamVideoRef.current!, 640, 360, 640, 360);

            ctx.font = 'bold 16px sans-serif';
            ctx.fillStyle = '#4ECDC4';
            ctx.fillText('📋 Whiteboard Tab', 16, 28);
            ctx.fillStyle = '#FF6B6B';
            ctx.fillText('🖥️ Screen Share', 656, 28);
            ctx.fillStyle = '#A8FF78';
            ctx.fillText('📷 Webcam', 656, 388);
          } else if (hasScreen) {
            if (wbCanvas) ctx.drawImage(wbCanvas, 0, 0, 640, 720);
            ctx.drawImage(screenVideoRef.current!, 640, 0, 640, 720);

            ctx.font = 'bold 18px sans-serif';
            ctx.fillStyle = '#4ECDC4';
            ctx.fillText('📋 Whiteboard Tab', 16, 30);
            ctx.fillStyle = '#FF6B6B';
            ctx.fillText('🖥️ Screen Share', 656, 30);
          } else if (hasWebcam) {
            if (wbCanvas) ctx.drawImage(wbCanvas, 0, 0, 640, 720);
            ctx.drawImage(webcamVideoRef.current!, 640, 0, 640, 720);

            ctx.font = 'bold 18px sans-serif';
            ctx.fillStyle = '#4ECDC4';
            ctx.fillText('📋 Whiteboard Tab', 16, 30);
            ctx.fillStyle = '#A8FF78';
            ctx.fillText('📷 Webcam', 656, 30);
          } else if (wbCanvas) {
            ctx.drawImage(wbCanvas, 0, 0, 1280, 720);
          }

          ws.send(
            JSON.stringify({
              image: masterCanvas.toDataURL('image/jpeg', 0.74),
              hasActiveVideo: hasPlayingSlideVideo,
              force: forceImmediate,
            })
          );
          lastSentTimestamp = now;
        } else {
          // ── Single Focus Mode (Optimal 1280x720 max resolution) ──
          if (isScreenSharing && screenVideoRef.current && screenVideoRef.current.videoWidth > 0) {
            const vidW = screenVideoRef.current.videoWidth;
            const vidH = screenVideoRef.current.videoHeight;
            const scale = Math.min(1, 1280 / vidW, 720 / vidH);
            masterCanvas.width = Math.max(1, Math.round(vidW * scale));
            masterCanvas.height = Math.max(1, Math.round(vidH * scale));
            ctx.drawImage(screenVideoRef.current, 0, 0, masterCanvas.width, masterCanvas.height);
            ws.send(JSON.stringify({ image: masterCanvas.toDataURL('image/jpeg', 0.78), hasActiveVideo: true }));
            lastSentTimestamp = now;
          } else if (isWebcamActive && webcamVideoRef.current && webcamVideoRef.current.videoWidth > 0) {
            const vidW = webcamVideoRef.current.videoWidth;
            const vidH = webcamVideoRef.current.videoHeight;
            const scale = Math.min(1, 1280 / vidW, 720 / vidH);
            masterCanvas.width = Math.max(1, Math.round(vidW * scale));
            masterCanvas.height = Math.max(1, Math.round(vidH * scale));
            ctx.drawImage(webcamVideoRef.current, 0, 0, masterCanvas.width, masterCanvas.height);
            ws.send(JSON.stringify({ image: masterCanvas.toDataURL('image/jpeg', 0.78), hasActiveVideo: true }));
            lastSentTimestamp = now;
          } else {
            const eng = engineRef.current;
            const shapesCount = eng ? eng.getDrawnShapes().length : 0;
            const hwCount = eng ? eng.getDrawnHandwriting().length : 0;
            const mediaCount = mediaRef.current ? mediaRef.current.getItems().length : 0;
            const currSig = `${activePageIndexRef.current}:${shapesCount}:${hwCount}:${mediaCount}:${Math.round(transformRef.current.zoom * 100)}:${Math.round(transformRef.current.pan.x)}:${Math.round(transformRef.current.pan.y)}`;
            if (!hasPlayingSlideVideo && !forceImmediate && currSig === lastWbSignature && now - lastSentTimestamp < 15000) {
              return;
            }
            lastWbSignature = currSig;
            const wbCanvas = await captureCompositeWhiteboardStage(forceImmediate);
            if (wbCanvas) {
              ws.send(
                JSON.stringify({
                  image: wbCanvas.toDataURL('image/jpeg', hasPlayingSlideVideo || mediaCount > 0 ? 0.76 : 0.68),
                  hasActiveVideo: hasPlayingSlideVideo,
                  force: forceImmediate,
                })
              );
              lastSentTimestamp = now;
            }
          }
        }
      } catch {
        // Silent catch
      } finally {
        isTickBusy = false;
      }
    }, 1000);

    return () => {
      if (unifiedVisionIntervalRef.current) {
        window.clearInterval(unifiedVisionIntervalRef.current);
        unifiedVisionIntervalRef.current = null;
      }
    };
  }, [isSplitViewEnabled, isScreenSharing, isWebcamActive, wsConnected, captureCompositeWhiteboardStage]);

  // Screen Share Toggle
  const handleToggleScreenShare = async () => {
    if (isScreenSharing) {
      if (screenStreamRef.current) {
        screenStreamRef.current.getTracks().forEach(t => t.stop());
        screenStreamRef.current = null;
      }
      setIsScreenSharing(false);
      setSaveToast('🖥️ Screen sharing stopped');
      setTimeout(() => setSaveToast(null), 3000);
    } else {
      try {
        const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
        screenStreamRef.current = stream;
        if (screenVideoRef.current) {
          screenVideoRef.current.srcObject = stream;
          screenVideoRef.current.play();
        }
        stream.getVideoTracks()[0].addEventListener('ended', () => {
          setIsScreenSharing(false);
          setSaveToast('🖥️ Screen sharing stopped');
          setTimeout(() => setSaveToast(null), 3000);
        });
        setIsScreenSharing(true);
        if (!isSplitViewEnabled) setIsWebcamActive(false); // In single mode, focus screen
        setSaveToast('🖥️ Direct Screen Vision Active');
        setTimeout(() => setSaveToast(null), 3000);
      } catch (err) {
        console.error(err);
      }
    }
  };

  // Webcam Toggle
  const handleToggleWebcam = async () => {
    if (isWebcamActive) {
      if (webcamStreamRef.current) {
        webcamStreamRef.current.getTracks().forEach(t => t.stop());
        webcamStreamRef.current = null;
      }
      setIsWebcamActive(false);
      setSaveToast('📷 Webcam stopped');
      setTimeout(() => setSaveToast(null), 3000);
    } else {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: { width: 1280, height: 720 }, audio: false });
        webcamStreamRef.current = stream;
        if (webcamVideoRef.current) {
          webcamVideoRef.current.srcObject = stream;
          webcamVideoRef.current.play();
        }
        stream.getVideoTracks()[0].addEventListener('ended', () => {
          setIsWebcamActive(false);
          setSaveToast('📷 Webcam stopped');
          setTimeout(() => setSaveToast(null), 3000);
        });
        setIsWebcamActive(true);
        if (!isSplitViewEnabled) setIsScreenSharing(false); // In single mode, focus webcam
        setSaveToast('📷 Direct Webcam Vision Active');
        setTimeout(() => setSaveToast(null), 3000);
      } catch (err) {
        console.error(err);
      }
    }
  };

  // Initialize and Center the Viewport on Load / Resize
  const centerViewport = useCallback(() => {
    if (containerRef.current) {
      const containerW = containerRef.current.clientWidth;
      const containerH = containerRef.current.clientHeight;
      const scale = Math.min(containerW / VIRTUAL_WIDTH, containerH / VIRTUAL_HEIGHT, 1);
      const initialPanX = (containerW - VIRTUAL_WIDTH * scale) / 2;
      const initialPanY = (containerH - VIRTUAL_HEIGHT * scale) / 2;
      setTransform({
        zoom: Math.max(0.4, Number(scale.toFixed(2))),
        pan: { x: Math.round(initialPanX), y: Math.round(initialPanY) },
      });
    }
  }, []);

  useEffect(() => {
    centerViewport();
    window.addEventListener('resize', centerViewport);
    return () => window.removeEventListener('resize', centerViewport);
  }, [centerViewport]);

  // --- Slide Deck Navigation & State Synchronization ---
  const getCurrentSyncedPages = useCallback((): WhiteboardPage[] => {
    const engine = engineRef.current;
    if (!engine) return pagesRef.current;

    const currentShapes = engine.getDrawnShapes();
    const currentHandwriting = engine.getDrawnHandwriting();

    let autoTitle = '';
    const titleH = currentHandwriting.find((h) => h.style === 'title' || (h.position && h.position.y < 160));
    if (titleH?.text) {
      autoTitle = titleH.text;
    } else {
      const firstText = currentShapes.find((s) => s.shapeType === 'text');
      if (firstText?.options?.text) {
        autoTitle = firstText.options.text;
      } else {
        const firstMath = currentShapes.find((s) => s.shapeType === 'math');
        if (firstMath?.options?.latex) {
          autoTitle = firstMath.options.latex.slice(0, 35);
        } else {
          const firstMedia = currentShapes.find((s) => s.shapeType === 'image' || s.shapeType === 'video');
          if (firstMedia?.options?.media?.fileName) {
            autoTitle = firstMedia.options.media.fileName.replace(/\.[^.]+$/, '').slice(0, 35);
          }
        }
      }
    }

    return pagesRef.current.map((p, idx) =>
      idx === activePageIndexRef.current
        ? {
            ...p,
            title: autoTitle || p.title || `Slide ${p.pageNumber}`,
            shapes: [...currentShapes],
            handwriting: [...currentHandwriting],
          }
        : p
    );
  }, []);

  const broadcastBoardStateSync = useCallback(
    (customPages?: WhiteboardPage[], customActiveIndex?: number, customTitle?: string) => {
      if (!room || room.state !== 'connected') return;

      try {
        const activeIdx = customActiveIndex ?? activePageIndexRef.current;
        const title = customTitle ?? sessionTitle;
        const allPages = customPages ?? getCurrentSyncedPages();
        const activePage = allPages[activeIdx] || allPages[0];

        const payload = {
          sessionTitle: title,
          activePageIndex: activeIdx,
          totalSlides: allPages.length,
          currentSlide: {
            pageNumber: activePage ? activePage.pageNumber : activeIdx + 1,
            title: activePage ? activePage.title : `Slide ${activeIdx + 1}`,
            mathEquations: (activePage?.shapes || [])
              .filter(
                (s) =>
                  s.shapeType === 'math' ||
                  (s.shapeType === 'text' &&
                    /\\[a-zA-Z]+|[_\^=+\-*/\\]/.test(s.options?.text || '') &&
                    (s.options?.text || '').includes('\\'))
              )
              .map((s) => s.options?.latex || s.options?.text || ''),
            plainTextNotes: [
              ...(activePage?.shapes || [])
                .filter(
                  (s) =>
                    s.shapeType === 'text' &&
                    !(
                      /\\[a-zA-Z]+|[_\^=+\-*/\\]/.test(s.options?.text || '') &&
                      (s.options?.text || '').includes('\\')
                    )
                )
                .map((s) => s.options?.text || ''),
              ...(activePage?.handwriting || []).map((h) => h.text),
            ],
            graphs2D: (activePage?.shapes || [])
              .filter((s) => s.shapeType === 'graph')
              .map((s) => ({
                title: s.options?.title || '2D Function Plot',
                functions: s.options?.functions || [],
                shadedRegion: s.options?.shadedRegion,
              })),
            graphs3D: (activePage?.shapes || [])
              .filter((s) => s.shapeType === 'graph3d')
              .map((s) => ({
                title: s.options?.title || '3D Mathematical Surface / Solid of Revolution',
                plotType: s.options?.plotType || 'surface',
                equationZ: s.options?.equationZ || '',
                curve2D: s.options?.curve2D,
                revolutionAxis: s.options?.revolutionAxis,
                revolutionAngle: s.options?.revolutionAngle,
              })),
            vennDiagrams: (activePage?.shapes || [])
              .filter((s) => s.shapeType === 'venn')
              .map((s) => ({
                title: s.options?.title || 'Probability Venn Diagram',
                sets: s.options?.sets || ['A', 'B'],
                shadedOperation: s.options?.shadedOperation,
                shadedRegions: s.options?.shadedRegions,
                labels: s.options?.labels,
              })),
            geometricShapes: (activePage?.shapes || [])
              .filter((s) => ['rectangle', 'ellipse', 'line', 'arrow'].includes(s.shapeType))
              .map((s) => ({
                id: s.id,
                type: s.shapeType,
                x: s.x,
                y: s.y,
                width: s.width,
                height: s.height,
                toX: s.toX,
                toY: s.toY,
                label: s.options?.label,
              })),
            mediaItems: (() => {
              const runtimeMap = new Map(
                (mediaRef.current?.getRuntimeStates() || []).map((rt) => [rt.id, rt])
              );
              return (activePage?.shapes || [])
                .filter((s) => s.shapeType === 'image' || s.shapeType === 'video')
                .map((s) => {
                  const m = s.options?.media;
                  const rt = s.id ? runtimeMap.get(s.id) : undefined;
                  return {
                    id: s.id,
                    mediaId: rt?.mediaId || m?.mediaId || s.id || '',
                    mediaType: s.shapeType as 'image' | 'video',
                    fileName: rt?.fileName || m?.fileName || s.options?.label || s.shapeType,
                    mimeType:
                      rt?.mimeType ||
                      m?.mimeType ||
                      (s.shapeType === 'video' ? 'video/mp4' : 'image/png'),
                    url: rt?.url || m?.url || '',
                    x: rt?.x ?? s.x,
                    y: rt?.y ?? s.y,
                    width: rt?.width ?? s.width ?? 480,
                    height: rt?.height ?? s.height ?? 320,
                    durationSec: rt?.durationSec ?? m?.durationSec ?? 0,
                    currentTimeSec: rt?.currentTimeSec ?? 0,
                    isPlaying: Boolean(rt?.isPlaying),
                    shareAudioWithAI: rt?.shareAudioWithAI ?? (m?.shareAudioWithAI !== false),
                  };
                });
            })(),
          },
          allSlidesSummary: allPages.map((p, idx) => ({
            pageNumber: p.pageNumber || idx + 1,
            title: p.title || `Slide ${idx + 1}`,
            hasEquations: (p.shapes || []).some((s) => s.shapeType === 'math'),
            has2DGraph: (p.shapes || []).some((s) => s.shapeType === 'graph'),
            has3DGraph: (p.shapes || []).some((s) => s.shapeType === 'graph3d'),
            hasMedia: (p.shapes || []).some((s) => s.shapeType === 'image' || s.shapeType === 'video'),
            mediaSummary: (p.shapes || [])
              .filter((s) => s.shapeType === 'image' || s.shapeType === 'video')
              .map(
                (s) =>
                  `${s.shapeType}: ${s.options?.media?.fileName || s.options?.label || s.shapeType}`
              )
              .slice(0, 4),
            equationsSummary: (p.shapes || [])
              .filter((s) => s.shapeType === 'math')
              .map((s) => s.options?.latex)
              .filter(Boolean)
              .slice(0, 4),
            notesSummary: [
              ...(p.shapes || []).filter((s) => s.shapeType === 'text').map((s) => s.options?.text),
              ...(p.handwriting || []).map((h) => h.text),
            ]
              .filter(Boolean)
              .slice(0, 4),
          })),
        };

        const msg = {
          type: 'board_state_sync',
          payload,
        };

        const encoded = new TextEncoder().encode(JSON.stringify(msg));
        room.localParticipant.publishData(encoded, { reliable: true });
        console.log('[Whiteboard] Broadcasted board state sync to agent:', payload.currentSlide.title, `(${allPages.length} slides)`);
      } catch (err) {
        console.warn('[Whiteboard] Could not broadcast board state sync:', err);
      }
    },
    [room, sessionTitle, getCurrentSyncedPages]
  );

  const switchToPage = useCallback((targetIndex: number) => {
    const engine = engineRef.current;
    if (!engine) return;

    const currentShapes = engine.getDrawnShapes();
    const currentHandwriting = engine.getDrawnHandwriting();

    let autoTitle = '';
    const titleH = currentHandwriting.find((h) => h.style === 'title' || (h.position && h.position.y < 160));
    if (titleH?.text) {
      autoTitle = titleH.text;
    } else {
      const firstText = currentShapes.find((s) => s.shapeType === 'text');
      if (firstText?.options?.text) {
        autoTitle = firstText.options.text;
      } else {
        const firstMath = currentShapes.find((s) => s.shapeType === 'math');
        if (firstMath?.options?.latex) {
          autoTitle = firstMath.options.latex.slice(0, 35);
        } else {
          const firstMedia = currentShapes.find((s) => s.shapeType === 'image' || s.shapeType === 'video');
          if (firstMedia?.options?.media?.fileName) {
            autoTitle = firstMedia.options.media.fileName.replace(/\.[^.]+$/, '').slice(0, 35);
          }
        }
      }
    }

    const updatedPages = pagesRef.current.map((p, idx) => {
      if (idx === activePageIndexRef.current) {
        return {
          ...p,
          title: autoTitle || p.title || `Slide ${p.pageNumber}`,
          shapes: [...currentShapes],
          handwriting: [...currentHandwriting],
        };
      }
      return p;
    });

    // Synchronously update page refs first so concurrent callbacks see target state immediately
    pagesRef.current = updatedPages;
    activePageIndexRef.current = targetIndex;
    setPages(updatedPages);
    setActivePageIndex(targetIndex);

    isSwitchingSlideRef.current = true;
    if (liveBoardSyncTimerRef.current) {
      clearTimeout(liveBoardSyncTimerRef.current);
      liveBoardSyncTimerRef.current = null;
    }

    const targetPage = updatedPages[targetIndex];
    if (targetPage) {
      engine.loadBoard(targetPage.shapes || [], targetPage.handwriting || []);
    }
    isSwitchingSlideRef.current = false;

    broadcastBoardStateSync(updatedPages, targetIndex);
  }, [broadcastBoardStateSync]);

  const addNewPage = useCallback((customTitle?: string) => {
    const engine = engineRef.current;
    if (!engine) return;

    const currentShapes = engine.getDrawnShapes();
    const currentHandwriting = engine.getDrawnHandwriting();

    let autoTitle = '';
    const titleH = currentHandwriting.find((h) => h.style === 'title' || (h.position && h.position.y < 160));
    if (titleH?.text) {
      autoTitle = titleH.text;
    } else {
      const firstText = currentShapes.find((s) => s.shapeType === 'text');
      if (firstText?.options?.text) {
        autoTitle = firstText.options.text;
      } else {
        const firstMath = currentShapes.find((s) => s.shapeType === 'math');
        if (firstMath?.options?.latex) {
          autoTitle = firstMath.options.latex.slice(0, 35);
        } else {
          const firstMedia = currentShapes.find((s) => s.shapeType === 'image' || s.shapeType === 'video');
          if (firstMedia?.options?.media?.fileName) {
            autoTitle = firstMedia.options.media.fileName.replace(/\.[^.]+$/, '').slice(0, 35);
          }
        }
      }
    }

    const updatedPages = pagesRef.current.map((p, idx) => {
      if (idx === activePageIndexRef.current) {
        return {
          ...p,
          title: autoTitle || p.title || `Slide ${p.pageNumber}`,
          shapes: [...currentShapes],
          handwriting: [...currentHandwriting],
        };
      }
      return p;
    });

    const newPageNum = updatedPages.length + 1;
    const finalTitle = customTitle && customTitle.trim() ? customTitle.trim() : `Slide ${newPageNum}`;
    const newPage: WhiteboardPage = {
      id: `page-${Date.now()}`,
      pageNumber: newPageNum,
      title: finalTitle,
      shapes: [],
      handwriting: [],
      createdAt: Date.now(),
    };

    const nextPages = [...updatedPages, newPage];
    const newIndex = nextPages.length - 1;

    // Immediately update refs synchronously so any subsequent callbacks or engine hooks see the new deck
    pagesRef.current = nextPages;
    activePageIndexRef.current = newIndex;
    setPages(nextPages);
    setActivePageIndex(newIndex);

    // Suppress live thumbnail auto-sync during page wipe to avoid race conditions
    isSwitchingSlideRef.current = true;
    if (liveBoardSyncTimerRef.current) {
      clearTimeout(liveBoardSyncTimerRef.current);
      liveBoardSyncTimerRef.current = null;
    }
    engine.clear();
    isSwitchingSlideRef.current = false;

    broadcastBoardStateSync(nextPages, newIndex);
  }, [broadcastBoardStateSync]);

  const deletePage = useCallback((indexToDelete: number) => {
    if (pagesRef.current.length <= 1) return;

    const engine = engineRef.current;
    const filtered = pagesRef.current.filter((_, idx) => idx !== indexToDelete);
    const renumbered = filtered.map((p, idx) => ({ ...p, pageNumber: idx + 1 }));

    let nextActiveIndex = activePageIndexRef.current;
    if (indexToDelete === activePageIndexRef.current) {
      nextActiveIndex = Math.max(0, indexToDelete - 1);
    } else if (indexToDelete < activePageIndexRef.current) {
      nextActiveIndex = activePageIndexRef.current - 1;
    }

    pagesRef.current = renumbered;
    activePageIndexRef.current = nextActiveIndex;
    setPages(renumbered);
    setActivePageIndex(nextActiveIndex);

    isSwitchingSlideRef.current = true;
    if (liveBoardSyncTimerRef.current) {
      clearTimeout(liveBoardSyncTimerRef.current);
      liveBoardSyncTimerRef.current = null;
    }

    if (engine && renumbered[nextActiveIndex]) {
      engine.loadBoard(renumbered[nextActiveIndex].shapes || [], renumbered[nextActiveIndex].handwriting || []);
    }
    isSwitchingSlideRef.current = false;

    broadcastBoardStateSync(renumbered, nextActiveIndex);
  }, [broadcastBoardStateSync]);

  // --- Live Slide Thumbnail Sync (PowerPoint Sorter) ---
  const liveBoardSyncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastLiveBoardSyncTsRef = useRef<number>(0);

  const flushLiveSlideSync = useCallback(() => {
    if (isSwitchingSlideRef.current) return;
    liveBoardSyncTimerRef.current = null;
    lastLiveBoardSyncTsRef.current = Date.now();
    const synced = getCurrentSyncedPages();
    pagesRef.current = synced;
    setPages(synced);
  }, [getCurrentSyncedPages]);

  const scheduleLiveSlideSync = useCallback(() => {
    if (isSwitchingSlideRef.current) return;
    const elapsed = Date.now() - lastLiveBoardSyncTsRef.current;
    if (elapsed >= 220) {
      if (liveBoardSyncTimerRef.current) {
        clearTimeout(liveBoardSyncTimerRef.current);
        liveBoardSyncTimerRef.current = null;
      }
      flushLiveSlideSync();
      return;
    }
    if (!liveBoardSyncTimerRef.current) {
      liveBoardSyncTimerRef.current = setTimeout(flushLiveSlideSync, 220 - elapsed);
    }
  }, [flushLiveSlideSync]);

  useEffect(() => {
    return () => {
      if (liveBoardSyncTimerRef.current) {
        clearTimeout(liveBoardSyncTimerRef.current);
      }
    };
  }, []);

  // --- Session & Continuous Dual-Tier Auto-Save Handlers ---
  const buildSessionSnapshot = useCallback(
    (overrideTitle?: string, overridePages?: WhiteboardPage[], overrideActiveIdx?: number): SavedTutorSession => {
      const freshPages = overridePages ?? getCurrentSyncedPages();
      const baseTitle = overrideTitle ?? sessionTitleRef.current;
      const smart = deriveSmartSessionTitle(
        baseTitle,
        overrideTitle ? false : isAutoTitledRef.current,
        freshPages,
        chatMessagesRef.current
      );
      return {
        version: '2.0',
        appName: 'AI_Tutor_Whiteboard',
        id: sessionIdRef.current,
        title: smart.title,
        isAutoTitled: smart.isAutoTitled,
        createdAt: sessionCreatedAtRef.current,
        updatedAt: Date.now(),
        activePageIndex: overrideActiveIdx ?? activePageIndexRef.current,
        pages: freshPages,
        chatMessages: chatMessagesRef.current,
      };
    },
    [getCurrentSyncedPages]
  );

  const upsertRecentFromSummary = useCallback((summary: SavedSessionSummary) => {
    setRecentSessions((prev) => {
      const entry: RecentSession = {
        id: summary.id,
        name: summary.title || DEFAULT_WHITEBOARD_TITLE,
        timestamp: summary.updatedAt,
        slideCount: summary.slideCount || 1,
        messageCount: summary.messageCount || 0,
      };
      const filtered = prev.filter((s) => s.id !== summary.id);
      const updated = [entry, ...filtered].slice(0, 40);
      try {
        localStorage.setItem('AI_TUTOR_RECENT_SESSIONS', JSON.stringify(updated.slice(0, 15)));
      } catch {
        // ignore quota errors; OS disk + IndexedDB are primary
      }
      return updated;
    });
  }, []);

  const saveRecentSession = useCallback(
    (title: string, pagesToSave: WhiteboardPage[], activeIdx: number) => {
      const snapshot = buildSessionSnapshot(title, pagesToSave, activeIdx);
      void persistSessionDualTier(snapshot, { setActive: true }).then((summary) => {
        setLastAutoSavedAt(summary.updatedAt);
        setAutoSaveState('saved');
        upsertRecentFromSummary(summary);
      });
    },
    [buildSessionSnapshot, upsertRecentFromSummary]
  );

  // Hydrate latest auto-saved session (slides + full chat conversation) on boot
  useEffect(() => {
    let cancelled = false;
    const hydrateFromVault = async () => {
      try {
        const [latest, allSummaries] = await Promise.all([
          loadLatestAutoSavedSession(),
          listAllSavedSessions(),
        ]);
        if (cancelled) return;

        // Populate past sessions in the history/vault drawer so they are readily accessible at any time
        if (allSummaries.length > 0) {
          setRecentSessions((prev) => mergeVaultSummariesWithRecent(allSummaries, prev));
        }

        // On initial app launch, start cleanly with a fresh blank canvas as requested,
        // leaving past sessions safely preserved in the history vault.
        const freshId = createSessionId();
        sessionIdRef.current = freshId;
        setActiveSessionId(freshId);
        sessionCreatedAtRef.current = Date.now();
        isAutoTitledRef.current = true;
        setSessionTitle(DEFAULT_WHITEBOARD_TITLE);
        setAutoSaveState('saved');
      } catch (err) {
        console.warn('[AutoSave] Initial session hydration warning:', err);
      } finally {
        if (!cancelled) {
          autoSaveHydratedRef.current = true;
        }
      }
    };

    void hydrateFromVault();
    return () => {
      cancelled = true;
    };
  }, []);

  // Continuous debounced Auto-Save whenever slides, drawings, or chat messages change
  useEffect(() => {
    if (!autoSaveHydratedRef.current) return;
    const syncedPages = getCurrentSyncedPages();
    if (!hasSubstantiveSessionContent(syncedPages, chatMessages)) return;

    setAutoSaveState('saving');
    const timer = setTimeout(async () => {
      try {
        const snapshot = buildSessionSnapshot();
        if (snapshot.title !== sessionTitleRef.current) {
          setSessionTitle(snapshot.title);
        }
        const summary = await persistSessionDualTier(snapshot, { setActive: true });
        setLastAutoSavedAt(summary.updatedAt);
        setAutoSaveState('saved');
        upsertRecentFromSummary(summary);
      } catch {
        setAutoSaveState('error');
      }
    }, 1100);

    return () => clearTimeout(timer);
  }, [pages, chatMessages, activePageIndex, sessionTitle, getCurrentSyncedPages, buildSessionSnapshot, upsertRecentFromSummary]);

  // Emergency W3C Page-Lifecycle flush on tab close / hide / reload (zero data loss)
  useEffect(() => {
    const emergencyFlush = () => {
      if (!autoSaveHydratedRef.current) return;
      const freshPages = getCurrentSyncedPages();
      if (!hasSubstantiveSessionContent(freshPages, chatMessagesRef.current)) return;
      const snapshot = buildSessionSnapshot(undefined, freshPages);
      flushSessionEmergencyOnExit(snapshot);
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        emergencyFlush();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('pagehide', emergencyFlush);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('pagehide', emergencyFlush);
    };
  }, [getCurrentSyncedPages, buildSessionSnapshot]);

  const currentFileHandleRef = useRef<any>(null);
  const [saveToast, setSaveToast] = useState<string | null>(null);

  const showToast = useCallback((msg: string) => {
    setSaveToast(msg);
    setTimeout(() => {
      setSaveToast((prev) => (prev === msg ? null : prev));
    }, 2500);
  }, []);

  const handleNewFile = useCallback(() => {
    const engine = engineRef.current;
    if (!engine) return;

    // Auto-archive current session into the vault before starting fresh so zero work is ever lost
    const currentSynced = getCurrentSyncedPages();
    const hadContent = hasSubstantiveSessionContent(currentSynced, chatMessagesRef.current);
    if (hadContent) {
      const archiveSnapshot = buildSessionSnapshot(undefined, currentSynced);
      void persistSessionDualTier(archiveSnapshot, { setActive: false }).then((summary) => {
        upsertRecentFromSummary(summary);
      });
    }

    const nextId = createSessionId();
    sessionIdRef.current = nextId;
    setActiveSessionId(nextId);
    sessionCreatedAtRef.current = Date.now();
    isAutoTitledRef.current = true;
    currentFileHandleRef.current = null;

    engine.clear();
    const freshPage = createBlankWhiteboardPage();
    setPages([freshPage]);
    setActivePageIndex(0);
    setChatMessages([]);
    setSessionTitle(DEFAULT_WHITEBOARD_TITLE);
    broadcastBoardStateSync([freshPage], 0, DEFAULT_WHITEBOARD_TITLE);
    if (hadContent) {
      showToast('✨ New session started (previous session auto-saved)');
    }
  }, [getCurrentSyncedPages, buildSessionSnapshot, upsertRecentFromSummary, broadcastBoardStateSync, showToast]);

  const handleSaveAs = useCallback(async () => {
    const syncedPages = getCurrentSyncedPages();
    setPages(syncedPages);

    const cleanName = (sessionTitle || 'Whiteboard_Session').replace(/[^a-zA-Z0-9_-]/g, '_');

    if ('showSaveFilePicker' in window) {
      try {
        const fileHandle = await (window as any).showSaveFilePicker({
          suggestedName: `${cleanName}.aitutor`,
          types: [
            {
              description: 'ZYREN AI Tutor Project (*.aitutor)',
              accept: { 'application/json': ['.aitutor'] },
            },
          ],
        });
        if (!fileHandle) return;

        const newTitle = fileHandle.name.replace(/\.(aitutor|json)$/i, '');
        isAutoTitledRef.current = false;
        setSessionTitle(newTitle);
        currentFileHandleRef.current = fileHandle;

        const projectData = {
          version: '2.0',
          appName: 'AI_Tutor_Whiteboard',
          id: sessionIdRef.current,
          timestamp: Date.now(),
          title: newTitle,
          activePageIndex: activePageIndexRef.current,
          pages: syncedPages,
          chatMessages: chatMessagesRef.current,
        };

        const writable = await fileHandle.createWritable();
        await writable.write(JSON.stringify(projectData, null, 2));
        await writable.close();

        saveRecentSession(newTitle, syncedPages, activePageIndexRef.current);
        showToast(`✓ Saved as "${fileHandle.name}"`);
        return;
      } catch (err: any) {
        if (err.name === 'AbortError') {
          return;
        }
        console.error('Error in showSaveFilePicker, falling back to download:', err);
      }
    }

    // Fallback for browsers without File System Access API
    const newName = window.prompt('Enter project name to save as:', cleanName) || cleanName;
    isAutoTitledRef.current = false;
    setSessionTitle(newName);
    saveRecentSession(newName, syncedPages, activePageIndexRef.current);

    const projectData = {
      version: '2.0',
      appName: 'AI_Tutor_Whiteboard',
      id: sessionIdRef.current,
      timestamp: Date.now(),
      title: newName,
      activePageIndex: activePageIndexRef.current,
      pages: syncedPages,
      chatMessages: chatMessagesRef.current,
    };

    const blob = new Blob([JSON.stringify(projectData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${newName}.aitutor`;
    a.click();
    URL.revokeObjectURL(url);
    showToast(`✓ Downloaded "${newName}.aitutor"`);
  }, [getCurrentSyncedPages, saveRecentSession, sessionTitle, showToast]);

  const handleSave = useCallback(async () => {
    const syncedPages = getCurrentSyncedPages();
    setPages(syncedPages);
    const snapshot = buildSessionSnapshot(undefined, syncedPages);
    const summary = await persistSessionDualTier(snapshot, { setActive: true });
    setLastAutoSavedAt(summary.updatedAt);
    setAutoSaveState('saved');
    upsertRecentFromSummary(summary);

    const projectData = {
      version: '2.0',
      appName: 'AI_Tutor_Whiteboard',
      id: sessionIdRef.current,
      timestamp: Date.now(),
      title: snapshot.title || 'Untitled Whiteboard',
      activePageIndex: activePageIndexRef.current,
      pages: syncedPages,
      chatMessages: chatMessagesRef.current,
    };

    // If an existing external file handle is active, also write directly to it
    if (currentFileHandleRef.current) {
      try {
        const writable = await currentFileHandleRef.current.createWritable();
        await writable.write(JSON.stringify(projectData, null, 2));
        await writable.close();
        showToast(`✓ Saved to "${currentFileHandleRef.current.name}"`);
        return;
      } catch (err) {
        console.warn('Could not write to external file handle:', err);
      }
    }

    showToast(`✓ Session saved ("${snapshot.title}")`);
  }, [getCurrentSyncedPages, buildSessionSnapshot, upsertRecentFromSummary, showToast]);

  const handleOpenFile = useCallback(
    (data: {
      id?: string;
      title?: string;
      pages: WhiteboardPage[];
      activePageIndex?: number;
      chatMessages?: ChatMessage[];
      createdAt?: number;
      isAutoTitled?: boolean;
    }) => {
      const engine = engineRef.current;
      if (!engine || !data.pages || data.pages.length === 0) return;

      const nextId = data.id || createSessionId();
      sessionIdRef.current = nextId;
      setActiveSessionId(nextId);
      sessionCreatedAtRef.current = data.createdAt || Date.now();
      isAutoTitledRef.current = Boolean(data.isAutoTitled);

      setPages(data.pages);
      const targetIdx = data.activePageIndex ?? 0;
      const safeIdx = Math.max(0, Math.min(data.pages.length - 1, targetIdx));
      setActivePageIndex(safeIdx);
      const newTitle = data.title || data.pages[0]?.title || 'Loaded Whiteboard';
      setSessionTitle(newTitle);

      const loadedMessages = Array.isArray(data.chatMessages) ? data.chatMessages : [];
      setChatMessages(loadedMessages);
      chatMessagesRef.current = loadedMessages;

      const targetPage = data.pages[safeIdx];
      if (targetPage) {
        engine.loadBoard(targetPage.shapes || [], targetPage.handwriting || []);
      }

      saveRecentSession(newTitle, data.pages, safeIdx);
      broadcastBoardStateSync(data.pages, safeIdx, newTitle);
    },
    [saveRecentSession, broadcastBoardStateSync]
  );

  const handleOpenPicker = useCallback(async () => {
    if ('showOpenFilePicker' in window) {
      try {
        const [fileHandle] = await (window as any).showOpenFilePicker({
          types: [
            {
              description: 'ZYREN AI Tutor Project (*.aitutor, *.json)',
              accept: { 'application/json': ['.aitutor', '.json'] },
            },
          ],
          multiple: false,
        });
        if (!fileHandle) return;
        const file = await fileHandle.getFile();
        const text = await file.text();
        const parsed = JSON.parse(text);
        if (parsed.pages && Array.isArray(parsed.pages)) {
          currentFileHandleRef.current = fileHandle;
          const cleanTitle = fileHandle.name.replace(/\.(aitutor|json)$/i, '');
          handleOpenFile({ ...parsed, title: parsed.title || cleanTitle });
          showToast(`✓ Opened "${fileHandle.name}"`);
        }
      } catch (err: any) {
        if (err.name !== 'AbortError') {
          console.error('Error opening file via showOpenFilePicker:', err);
        }
      }
    }
  }, [handleOpenFile, showToast]);

  const handleLoadRecent = useCallback(
    async (session: RecentSession) => {
      const fullVaultSession = await loadSpecificSavedSession(session.id);
      if (fullVaultSession && Array.isArray(fullVaultSession.pages)) {
        handleOpenFile(fullVaultSession);
        showToast(`✓ Loaded "${fullVaultSession.title}"`);
        return;
      }
      if (session.data) {
        handleOpenFile({ ...session.data, id: session.id });
        showToast(`✓ Loaded "${session.name}"`);
      }
    },
    [handleOpenFile, showToast]
  );

  const handleDeleteRecent = useCallback((id: string) => {
    void deleteSavedSessionEverywhere(id);
    if (sessionIdRef.current === id) {
      const freshId = createSessionId();
      sessionIdRef.current = freshId;
      setActiveSessionId(freshId);
    }
    setRecentSessions((prev) => {
      const updated = prev.filter((s) => s.id !== id);
      try {
        localStorage.setItem('AI_TUTOR_RECENT_SESSIONS', JSON.stringify(updated.slice(0, 15)));
      } catch {
        // ignore
      }
      return updated;
    });
  }, []);

  const handleExportPNG = useCallback(async () => {
    const viewportEl = viewportRef.current;
    if (!viewportEl) {
      alert('Whiteboard canvas is not ready for export.');
      return;
    }

    try {
      const syncedPages = getCurrentSyncedPages();
      setPages(syncedPages);

      const overlayCanvas = await html2canvas(viewportEl, {
        backgroundColor: null,
        width: VIRTUAL_WIDTH,
        height: VIRTUAL_HEIGHT,
        scale: 2, // 2x ultra high resolution
        useCORS: true,
        allowTaint: true,
        logging: false,
        ignoreElements: (e) => e.classList.contains('slide-media-overlay') || e.classList.contains('no-vision'),
        onclone: (clonedDoc) => {
          const clonedViewport = clonedDoc.querySelector('.whiteboard-viewport') as HTMLElement;
          if (clonedViewport) {
            clonedViewport.style.transform = 'none';
          }
        },
      });

      const canvas = document.createElement('canvas');
      canvas.width = VIRTUAL_WIDTH * 2;
      canvas.height = VIRTUAL_HEIGHT * 2;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.fillStyle = '#131324';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        if (mediaRef.current) {
          ctx.save();
          ctx.scale(2, 2);
          mediaRef.current.drawMediaToCanvas(ctx);
          ctx.restore();
        }
        ctx.drawImage(overlayCanvas, 0, 0, canvas.width, canvas.height);
      }

      const dataUrl = canvas.toDataURL('image/png', 1.0);
      const a = document.createElement('a');
      const cleanTitle = (sessionTitle || 'Whiteboard').replace(/[^a-zA-Z0-9_-]/g, '_');
      a.href = dataUrl;
      a.download = `${cleanTitle}_Slide_${activePageIndexRef.current + 1}.png`;
      a.click();
    } catch (err) {
      console.error('Error exporting PNG:', err);
      alert('Could not export PNG image.');
    }
  }, [getCurrentSyncedPages, sessionTitle]);

  const handleExportPDF = useCallback(async () => {
    const engine = engineRef.current;
    const viewportEl = viewportRef.current;
    if (!engine || !viewportEl) return;

    try {
      const syncedPages = getCurrentSyncedPages();
      setPages(syncedPages);

      const pdf = new jsPDF({
        orientation: 'landscape',
        unit: 'px',
        format: [VIRTUAL_WIDTH, VIRTUAL_HEIGHT],
        compress: true,
      });

      const originalIndex = activePageIndexRef.current;

      for (let i = 0; i < syncedPages.length; i++) {
        const page = syncedPages[i];
        engine.loadBoard(page.shapes || [], page.handwriting || []);
        setActivePageIndex(i);

        // Allow DOM / KaTeX / SVG to paint
        await new Promise((resolve) => setTimeout(resolve, 120));

        const canvas = await html2canvas(viewportEl, {
          backgroundColor: '#131324',
          width: VIRTUAL_WIDTH,
          height: VIRTUAL_HEIGHT,
          scale: 1.5,
          useCORS: true,
          allowTaint: true,
          logging: false,
          onclone: (clonedDoc) => {
            const clonedViewport = clonedDoc.querySelector('.whiteboard-viewport') as HTMLElement;
            if (clonedViewport) {
              clonedViewport.style.transform = 'none';
            }
          },
        });

        const imgData = canvas.toDataURL('image/jpeg', 0.95);
        if (i > 0) {
          pdf.addPage([VIRTUAL_WIDTH, VIRTUAL_HEIGHT], 'landscape');
        }
        pdf.addImage(imgData, 'JPEG', 0, 0, VIRTUAL_WIDTH, VIRTUAL_HEIGHT);
      }

      // Restore original slide
      const originalPage = syncedPages[originalIndex];
      if (originalPage) {
        engine.loadBoard(originalPage.shapes || [], originalPage.handwriting || []);
        setActivePageIndex(originalIndex);
      }

      const cleanTitle = (sessionTitle || 'Whiteboard_Session').replace(/[^a-zA-Z0-9_-]/g, '_');
      pdf.save(`${cleanTitle}.pdf`);
    } catch (err) {
      console.error('Error generating PDF:', err);
      alert('Could not generate PDF export.');
    }
  }, [getCurrentSyncedPages, sessionTitle]);

  const handleClearSlide = useCallback(() => {
    const engine = engineRef.current;
    if (!engine) return;
    engine.clear();
    const updated = pagesRef.current.map((p, idx) =>
      idx === activePageIndexRef.current
        ? { ...p, title: `Slide ${p.pageNumber}`, shapes: [], handwriting: [] }
        : p
    );
    setPages(updated);
    broadcastBoardStateSync(updated, activePageIndexRef.current);
  }, [broadcastBoardStateSync]);

  // Broadcast initial / updated board state when LiveKit room connects
  useEffect(() => {
    if (room && room.state === 'connected') {
      // Allow components to settle, then broadcast
      const timer = setTimeout(() => {
        broadcastBoardStateSync();
      }, 500);
      return () => clearTimeout(timer);
    }
  }, [room, room?.state, broadcastBoardStateSync]);

  // --- Live Writing Auto-Follow & Auto-Resize Camera Controller ---
  const startAutoFollowGlide = useCallback((desiredPanX: number, desiredPanY: number, desiredZoom?: number) => {
    const targetZoom = Number.isFinite(desiredZoom) ? desiredZoom! : transformRef.current.zoom;
    autoFollowTargetTransformRef.current = {
      zoom: targetZoom,
      pan: { x: desiredPanX, y: desiredPanY },
    };
    if (autoFollowRafRef.current !== null) return;

    let prevTs = performance.now();
    const tick = (nowTs: number) => {
      const targetTransform = autoFollowTargetTransformRef.current;
      if (
        !targetTransform ||
        !isAutoFollowRef.current ||
        (Number.isFinite(lastManualCameraMoveRef.current) && nowTs - lastManualCameraMoveRef.current < 1500)
      ) {
        autoFollowRafRef.current = null;
        autoFollowTargetTransformRef.current = null;
        return;
      }

      const dt = (nowTs - prevTs) / 1000;
      prevTs = nowTs;

      const step = stepAutoFollowTransformLerp(transformRef.current, targetTransform, dt, 0.14);
      transformRef.current = step.transform;
      setTransform(step.transform);

      if (step.settled) {
        autoFollowRafRef.current = null;
        autoFollowTargetTransformRef.current = null;
        return;
      }
      autoFollowRafRef.current = requestAnimationFrame(tick);
    };

    autoFollowRafRef.current = requestAnimationFrame(tick);
  }, []);

  const handleWritingFocus = useCallback(
    (target: WritingFocusTarget) => {
      lastFocusTargetRef.current = target;
      if (!isAutoFollowRef.current) return;
      if (Number.isFinite(lastManualCameraMoveRef.current) && performance.now() - lastManualCameraMoveRef.current < 1500) return;

      const container = containerRef.current;
      if (!container) return;
      const cw = container.clientWidth || window.innerWidth;
      const ch = container.clientHeight || window.innerHeight;
      const isMobile = cw <= 768;

      const insets = {
        left: !isMobile && isChatDrawerOpenRef.current ? 390 : 16,
        right: !isMobile && isSlidePanelOpenRef.current ? 326 : 16,
        top: 68,
        bottom: isToolbarPinnedRef.current ? 78 : 24,
      };

      const res = computeAutoFollowTransform(
        target,
        transformRef.current,
        cw,
        ch,
        insets,
        {
          deadzoneRatio: 0.68,
          autoResize: isAutoResizeRef.current,
          targetFillRatio: 0.78,
        }
      );
      if (res.needsMotion) {
        startAutoFollowGlide(res.desiredPanX, res.desiredPanY, res.desiredZoom);
      }
    },
    [startAutoFollowGlide]
  );

  const markManualCameraInteraction = useCallback(() => {
    lastManualCameraMoveRef.current = performance.now();
    if (manualCooldownTimerRef.current) {
      clearTimeout(manualCooldownTimerRef.current);
      manualCooldownTimerRef.current = null;
    }
    // Automatically reset cooldown after user stops panning/zooming, but NEVER force-glide
    // back to a stale past target! Camera follow will only track NEW live strokes when the AI writes.
    manualCooldownTimerRef.current = setTimeout(() => {
      lastManualCameraMoveRef.current = -Infinity;
      manualCooldownTimerRef.current = null;
    }, 2000);
  }, []);

  useEffect(() => {
    return () => {
      if (autoFollowRafRef.current !== null) {
        cancelAnimationFrame(autoFollowRafRef.current);
      }
      if (manualCooldownTimerRef.current) {
        clearTimeout(manualCooldownTimerRef.current);
      }
    };
  }, []);

  const toggleAutoFollow = useCallback(() => {
    const next = !isAutoFollowRef.current;
    isAutoFollowRef.current = next;
    setIsAutoFollowEnabled(next);
    try {
      localStorage.setItem('AI_TUTOR_AUTO_FOLLOW', String(next));
    } catch {
      // ignore
    }
    if (!next) {
      if (autoFollowRafRef.current !== null) {
        cancelAnimationFrame(autoFollowRafRef.current);
        autoFollowRafRef.current = null;
        autoFollowTargetTransformRef.current = null;
      }
      if (manualCooldownTimerRef.current) {
        clearTimeout(manualCooldownTimerRef.current);
        manualCooldownTimerRef.current = null;
      }
    } else {
      lastManualCameraMoveRef.current = -Infinity;
    }
    showToast(
      next
        ? '🎯 Live Writing Auto-Follow ON — tracking active strokes'
        : '⏸️ Live Writing Auto-Follow OFF — free manual camera'
    );
  }, [handleWritingFocus, showToast]);

  const toggleAutoResize = useCallback(() => {
    const next = !isAutoResizeRef.current;
    isAutoResizeRef.current = next;
    setIsAutoResizeEnabled(next);
    try {
      localStorage.setItem('AI_TUTOR_AUTO_RESIZE', String(next));
    } catch {
      // ignore
    }
    showToast(
      next
        ? '📐 Adaptive Auto-Resize ON — auto zooms & frames diagrams'
        : '📐 Adaptive Auto-Resize OFF — fixed zoom level'
    );
  }, [showToast]);

  const handleTogglePinRecent = useCallback(
    async (sessionId: string, nextPinned: boolean) => {
      try {
        await toggleSessionPinDualTier(sessionId, nextPinned);
        setRecentSessions((prev) => {
          const updated = prev.map((s) => (s.id === sessionId ? { ...s, isPinned: nextPinned } : s));
          return updated.sort((a, b) => {
            const aPin = Boolean(a.isPinned);
            const bPin = Boolean(b.isPinned);
            if (bPin !== aPin) return bPin ? 1 : -1;
            return b.timestamp - a.timestamp;
          });
        });
        showToast(nextPinned ? '📌 Session pinned to top' : '📌 Session unpinned');
      } catch (err: any) {
        console.warn('[WHITEBOARD] Failed to toggle session pin:', err);
      }
    },
    [showToast]
  );

  // Stable Callback Refs for SyncEngine to guarantee permanent singleton lifecycle
  const addNewPageRef = useRef(addNewPage);
  addNewPageRef.current = addNewPage;

  const scheduleLiveSlideSyncRef = useRef(scheduleLiveSlideSync);
  scheduleLiveSlideSyncRef.current = scheduleLiveSlideSync;

  const handleWritingFocusRef = useRef(handleWritingFocus);
  handleWritingFocusRef.current = handleWritingFocus;

  const setTelemetryRef = useRef(setTelemetry);
  setTelemetryRef.current = setTelemetry;

  // Initialize Sync Engine once on mount - lifecycle remains stable across auto-saves and re-renders
  useEffect(() => {
    const canvas = canvasRef.current;
    const svg = svgRef.current;
    const math = mathRef.current;

    if (!canvas || !svg) return;

    const engine = new SyncEngine({
      canvasAdapter: canvas.getAdapter(),
      svgOverlay: svg,
      mathOverlay: math ?? undefined,
      graphOverlay: graphRef.current ?? undefined,
      graph3dOverlay: graph3dRef.current ?? undefined,
      vennOverlay: vennRef.current ?? undefined,
      mediaOverlay: mediaRef.current ?? undefined,
      getMathOverlay: () => mathRef.current,
      getGraphOverlay: () => graphRef.current,
      getGraph3DOverlay: () => graph3dRef.current,
      getVennOverlay: () => vennRef.current,
      getMediaOverlay: () => mediaRef.current,
      getWritingStyle: () => currentStyleRef.current,
      onTelemetry: (metrics: SyncTelemetry) => setTelemetryRef.current(metrics),
      onBoardFull: () => addNewPageRef.current(),
      onBoardChange: () => scheduleLiveSlideSyncRef.current(),
      onWritingFocus: (target) => handleWritingFocusRef.current(target),
    });

    engineRef.current = engine;
    engine.start();

    return () => {
      engine.dispose();
      engineRef.current = null;
    };
  }, []);

  // --- Wheel Focal-Point Zoom ---
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleWheel = (e: WheelEvent) => {
      const target = e.target as HTMLElement;
      // Allow natural scrolling and independent zooming on chat drawer, 3D/2D graph cards, modals, and interactive overlays
      if (target && target.closest('.drawing-layer, .graph-3d-card, .three-canvas-container, .graph-card, .graph-overlay, .graph-3d-overlay, .interactive, .voice-modal-backdrop, .voice-modal-container, .voice-modal-content, .voice-modal-grid, .voice-fav-btn, .model-modal-backdrop, .model-modal-container, .model-modal-content, .model-card, .model-thinking-btn, .slide-panel, .slide-list, .file-menu-container, .chat-drawer, .chat-messages, .floating-pip-container, input, textarea, select, .no-zoom')) {
        return;
      }

      e.preventDefault();
      markManualCameraInteraction();
      const rect = container.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;

      const zoomFactor = e.deltaY < 0 ? 1.12 : 0.88;
      setTransform((prev) => {
        const newZoom = Math.max(0.3, Math.min(3.5, prev.zoom * zoomFactor));
        const newPanX = mouseX - (mouseX - prev.pan.x) * (newZoom / prev.zoom);
        const newPanY = mouseY - (mouseY - prev.pan.y) * (newZoom / prev.zoom);
        return { zoom: newZoom, pan: { x: newPanX, y: newPanY } };
      });
    };

    // --- Touch Pinch-to-Zoom & Pan ---
    let initialDist = 0;
    let initialZoom = 1;
    let initialMid = { x: 0, y: 0 };
    let lastTouch = { x: 0, y: 0 };

    const handleTouchStart = (e: TouchEvent) => {
      const target = e.target as HTMLElement;
      if (target && target.closest('.drawing-layer, .graph-3d-card, .three-canvas-container, .graph-card, .graph-overlay, .graph-3d-overlay, .interactive, .voice-modal-backdrop, .voice-modal-container, .voice-modal-content, .voice-modal-grid, .voice-fav-btn, .model-modal-backdrop, .model-modal-container, .model-modal-content, .model-card, .model-thinking-btn, .slide-panel, .slide-list, .file-menu-container, .chat-drawer, .chat-messages, .floating-pip-container, input, textarea, select, .no-zoom')) {
        return;
      }

      if (e.touches.length === 2) {
        e.preventDefault();
        const dx = e.touches[0].clientX - e.touches[1].clientX;
        const dy = e.touches[0].clientY - e.touches[1].clientY;
        initialDist = Math.hypot(dx, dy);
        const rect = container.getBoundingClientRect();
        initialMid = {
          x: (e.touches[0].clientX + e.touches[1].clientX) / 2 - rect.left,
          y: (e.touches[0].clientY + e.touches[1].clientY) / 2 - rect.top,
        };
        initialZoom = transformRef.current.zoom;
      } else if (e.touches.length === 1) {
        lastTouch = { x: e.touches[0].clientX, y: e.touches[0].clientY };
      }
    };

    const handleTouchMove = (e: TouchEvent) => {
      const target = e.target as HTMLElement;
      if (target && target.closest('.drawing-layer, .graph-3d-card, .three-canvas-container, .graph-card, .graph-overlay, .graph-3d-overlay, .interactive, .voice-modal-backdrop, .voice-modal-container, .voice-modal-content, .voice-modal-grid, .voice-fav-btn, .model-modal-backdrop, .model-modal-container, .model-modal-content, .model-card, .model-thinking-btn, .slide-panel, .slide-list, .file-menu-container, .chat-drawer, .chat-messages, .floating-pip-container, input, textarea, select, .no-zoom')) {
        return;
      }

      if (e.touches.length === 2 && initialDist > 0) {
        e.preventDefault();
        markManualCameraInteraction();
        const dx = e.touches[0].clientX - e.touches[1].clientX;
        const dy = e.touches[0].clientY - e.touches[1].clientY;
        const currentDist = Math.hypot(dx, dy);
        const scale = currentDist / initialDist;
        const newZoom = Math.max(0.3, Math.min(3.5, initialZoom * scale));

        setTransform((prev) => {
          const newPanX = initialMid.x - (initialMid.x - prev.pan.x) * (newZoom / prev.zoom);
          const newPanY = initialMid.y - (initialMid.y - prev.pan.y) * (newZoom / prev.zoom);
          return { zoom: newZoom, pan: { x: newPanX, y: newPanY } };
        });
      } else if (e.touches.length === 1) {
        markManualCameraInteraction();
        const dx = e.touches[0].clientX - lastTouch.x;
        const dy = e.touches[0].clientY - lastTouch.y;
        lastTouch = { x: e.touches[0].clientX, y: e.touches[0].clientY };
        setTransform((prev) => ({
          ...prev,
          pan: { x: prev.pan.x + dx, y: prev.pan.y + dy },
        }));
      }
    };

    const handleTouchEnd = (e: TouchEvent) => {
      if (e.touches.length < 2) {
        initialDist = 0;
      }
    };

    container.addEventListener('wheel', handleWheel, { passive: false });
    container.addEventListener('touchstart', handleTouchStart, { passive: false });
    container.addEventListener('touchmove', handleTouchMove, { passive: false });
    container.addEventListener('touchend', handleTouchEnd, { passive: false });

    return () => {
      container.removeEventListener('wheel', handleWheel);
      container.removeEventListener('touchstart', handleTouchStart);
      container.removeEventListener('touchmove', handleTouchMove);
      container.removeEventListener('touchend', handleTouchEnd);
    };
  }, []);

  // --- Mouse Drag Panning ---
  const isDraggingRef = useRef(false);
  const dragStartRef = useRef({ x: 0, y: 0 });

  const handlePointerDown = (e: React.PointerEvent) => {
    const target = e.target as HTMLElement;
    if (target.closest('.drawing-layer, button, input, textarea, a, select, [role="button"], .interactive, .slide-media-card, .slide-card, .slide-panel, .slide-list, .word-group, .graph-3d-card, .graph-3d-overlay, .math-item, canvas, .voice-modal-backdrop, .voice-modal-container, .voice-modal-content, .voice-card, .voice-filter-chip, .voice-play-btn, .voice-fav-btn, .model-modal-backdrop, .model-modal-container, .model-modal-content, .model-card, .model-thinking-btn, .chat-drawer, .chat-messages, .file-menu-container, .floating-pip-container, .no-zoom')) {
      return;
    }
    if (e.button !== 0 && e.button !== 1) return;
    isDraggingRef.current = true;
    dragStartRef.current = { x: e.clientX, y: e.clientY };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!isDraggingRef.current) return;
    markManualCameraInteraction();
    const dx = e.clientX - dragStartRef.current.x;
    const dy = e.clientY - dragStartRef.current.y;
    dragStartRef.current = { x: e.clientX, y: e.clientY };
    setTransform((prev) => ({
      ...prev,
      pan: { x: prev.pan.x + dx, y: prev.pan.y + dy },
    }));
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    isDraggingRef.current = false;
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      // Ignore if not captured
    }
  };

  // --- Zoom Controls Helpers ---
  const zoomIn = () => {
    if (!containerRef.current) return;
    markManualCameraInteraction();
    const rect = containerRef.current.getBoundingClientRect();
    const cx = rect.width / 2;
    const cy = rect.height / 2;
    setTransform((prev) => {
      const newZoom = Math.min(3.5, prev.zoom * 1.25);
      const newPanX = cx - (cx - prev.pan.x) * (newZoom / prev.zoom);
      const newPanY = cy - (cy - prev.pan.y) * (newZoom / prev.zoom);
      return { zoom: newZoom, pan: { x: newPanX, y: newPanY } };
    });
  };

  const zoomOut = () => {
    if (!containerRef.current) return;
    markManualCameraInteraction();
    const rect = containerRef.current.getBoundingClientRect();
    const cx = rect.width / 2;
    const cy = rect.height / 2;
    setTransform((prev) => {
      const newZoom = Math.max(0.3, prev.zoom / 1.25);
      const newPanX = cx - (cx - prev.pan.x) * (newZoom / prev.zoom);
      const newPanY = cy - (cy - prev.pan.y) * (newZoom / prev.zoom);
      return { zoom: newZoom, pan: { x: newPanX, y: newPanY } };
    });
  };

  const resetZoom = () => {
    markManualCameraInteraction();
    centerViewport();
  };

  // --- Unified Action History (Pen Strokes, Textboxes & Engine Actions) ---
  interface HistoryStep {
    kind: 'user';
    pageIndex: number;
    previousPaths: UserDrawingPath[];
    previousTexts: UserDrawingText[];
    nextPaths: UserDrawingPath[];
    nextTexts: UserDrawingText[];
  }
  const undoActionStackRef = useRef<HistoryStep[]>([]);
  const redoActionStackRef = useRef<HistoryStep[]>([]);

  // --- Undo & Redo Handlers (Unified across Pen, Text & AI shapes) ---
  const handleUndo = useCallback(() => {
    const activeIdx = activePageIndexRef.current;
    const action = undoActionStackRef.current.pop();

    if (action && action.pageIndex === activeIdx) {
      redoActionStackRef.current.push(action);
      setPages((prev) =>
        prev.map((p, idx) =>
          idx === activeIdx
            ? { ...p, userPaths: [...action.previousPaths], userTexts: [...action.previousTexts] }
            : p
        )
      );
      broadcastBoardStateSync();
      return;
    }

    const engine = engineRef.current;
    if (engine) {
      const undone = engine.undo();
      if (undone) {
        const currentShapes = engine.getDrawnShapes();
        const currentHandwriting = engine.getDrawnHandwriting();
        setPages((prev) =>
          prev.map((p, idx) =>
            idx === activeIdx
              ? { ...p, shapes: [...currentShapes], handwriting: [...currentHandwriting] }
              : p
          )
        );
        broadcastBoardStateSync();
        return;
      }
    }

    // Fallback: If user strokes exist on active slide, pop the last stroke
    const curP = pagesRef.current[activeIdx];
    if (curP && curP.userPaths && curP.userPaths.length > 0) {
      const prevPaths = curP.userPaths.slice(0, -1);
      setPages((prev) =>
        prev.map((p, idx) =>
          idx === activeIdx ? { ...p, userPaths: prevPaths } : p
        )
      );
      broadcastBoardStateSync();
      return;
    }
    if (curP && curP.userTexts && curP.userTexts.length > 0) {
      const prevTexts = curP.userTexts.slice(0, -1);
      setPages((prev) =>
        prev.map((p, idx) =>
          idx === activeIdx ? { ...p, userTexts: prevTexts } : p
        )
      );
      broadcastBoardStateSync();
      return;
    }
  }, [broadcastBoardStateSync]);

  const handleRedo = useCallback(() => {
    const activeIdx = activePageIndexRef.current;
    const action = redoActionStackRef.current.pop();

    if (action && action.pageIndex === activeIdx) {
      undoActionStackRef.current.push(action);
      setPages((prev) =>
        prev.map((p, idx) =>
          idx === activeIdx
            ? { ...p, userPaths: [...action.nextPaths], userTexts: [...action.nextTexts] }
            : p
        )
      );
      broadcastBoardStateSync();
      return;
    }

    const engine = engineRef.current;
    if (engine) {
      const redone = engine.redo();
      if (redone) {
        const currentShapes = engine.getDrawnShapes();
        const currentHandwriting = engine.getDrawnHandwriting();
        setPages((prev) =>
          prev.map((p, idx) =>
            idx === activeIdx
              ? { ...p, shapes: [...currentShapes], handwriting: [...currentHandwriting] }
              : p
          )
        );
        broadcastBoardStateSync();
        return;
      }
    }
  }, [broadcastBoardStateSync]);

  // --- Keyboard Shortcuts (Ctrl+Z for Undo, Ctrl+Y / Ctrl+Shift+Z for Redo) ---
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
        return;
      }

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        if (e.shiftKey) {
          e.preventDefault();
          handleRedo();
        } else {
          e.preventDefault();
          handleUndo();
        }
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        handleRedo();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleUndo, handleRedo]);

  // --- Slide Title Renaming ---
  const handleRenameSlide = useCallback(
    (index: number, newTitle: string) => {
      setPages((prev) => {
        const updated = prev.map((p, idx) => (idx === index ? { ...p, title: newTitle } : p));
        broadcastBoardStateSync(updated, activePageIndexRef.current);
        return updated;
      });
    },
    [broadcastBoardStateSync]
  );

  // --- Graph Position Updates ---
  const handleGraphPositionUpdate = useCallback((id: string, newX: number, newY: number) => {
    setPages((prev) =>
      prev.map((p, idx) =>
        idx === activePageIndexRef.current
          ? {
              ...p,
              shapes: p.shapes.map((s) => (s.id === id ? { ...s, x: newX, y: newY } : s)),
            }
          : p
      )
    );
  }, []);

  const handleGraph3DPositionUpdate = useCallback((id: string, newX: number, newY: number) => {
    setPages((prev) =>
      prev.map((p, idx) =>
        idx === activePageIndexRef.current
          ? {
              ...p,
              shapes: p.shapes.map((s) => (s.id === id ? { ...s, x: newX, y: newY } : s)),
            }
          : p
      )
    );
  }, []);

  const handleVennPositionUpdate = useCallback((id: string, newX: number, newY: number) => {
    setPages((prev) =>
      prev.map((p, idx) =>
        idx === activePageIndexRef.current
          ? {
              ...p,
              shapes: p.shapes.map((s) => (s.id === id ? { ...s, x: newX, y: newY } : s)),
            }
          : p
      )
    );
  }, []);

  const handleRemoveVenn = useCallback((id: string) => {
    setPages((prev) =>
      prev.map((p, idx) =>
        idx === activePageIndexRef.current
          ? {
              ...p,
              shapes: p.shapes.filter((s) => s.id !== id),
            }
          : p
      )
    );
  }, []);

  // --- Slide Media (Images & Videos) Handlers ---
  const handleMediaGeometryUpdate = useCallback(
    (id: string, newX: number, newY: number, newW: number, newH: number) => {
      engineRef.current?.updateShapeGeometry(id, newX, newY, newW, newH);
      setPages((prev) =>
        prev.map((p, idx) =>
          idx === activePageIndexRef.current
            ? {
                ...p,
                shapes: p.shapes.map((s) =>
                  s.id === id ? { ...s, x: newX, y: newY, width: newW, height: newH } : s
                ),
              }
            : p
        )
      );
      forceImmediateVisionFrameRef.current = true;
      broadcastBoardStateSync();
    },
    [broadcastBoardStateSync]
  );

  const handleRemoveMedia = useCallback(
    (id: string) => {
      engineRef.current?.removeShapeById(id);
      setPages((prev) =>
        prev.map((p, idx) =>
          idx === activePageIndexRef.current
            ? {
                ...p,
                shapes: p.shapes.filter((s) => s.id !== id),
              }
            : p
        )
      );
      forceImmediateVisionFrameRef.current = true;
      broadcastBoardStateSync();
    },
    [broadcastBoardStateSync]
  );

  const handleVideoAudioChunk = useCallback((base64Pcm16k: string) => {
    const ws = directVisionWsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ audio: base64Pcm16k, mimeType: 'audio/pcm;rate=16000' }));
    }
  }, []);

  const handleMediaVisualFrameChanged = useCallback(() => {
    forceImmediateVisionFrameRef.current = true;
    setTimeout(() => {
      broadcastBoardStateSync();
    }, 100);
  }, [broadcastBoardStateSync]);

  const extractMediaMetaAndPoster = useCallback(
    async (
      file: File,
      isVideo: boolean
    ): Promise<{ naturalWidth: number; naturalHeight: number; durationSec: number; posterDataUrl?: string }> => {
      const objUrl = URL.createObjectURL(file);
      try {
        if (!isVideo) {
          return await new Promise((resolve) => {
            const img = new Image();
            const timer = window.setTimeout(() => {
              resolve({ naturalWidth: 800, naturalHeight: 600, durationSec: 0 });
            }, 3500);
            img.onload = () => {
              clearTimeout(timer);
              const nw = img.naturalWidth || 800;
              const nh = img.naturalHeight || 600;
              let posterDataUrl: string | undefined;
              try {
                const scale = Math.min(1, 320 / Math.max(nw, nh));
                const c = document.createElement('canvas');
                c.width = Math.max(1, Math.round(nw * scale));
                c.height = Math.max(1, Math.round(nh * scale));
                const ctx = c.getContext('2d');
                if (ctx) {
                  ctx.drawImage(img, 0, 0, c.width, c.height);
                  posterDataUrl = c.toDataURL('image/jpeg', 0.72);
                }
              } catch {
                // ignore poster error
              }
              resolve({ naturalWidth: nw, naturalHeight: nh, durationSec: 0, posterDataUrl });
            };
            img.onerror = () => {
              clearTimeout(timer);
              resolve({ naturalWidth: 800, naturalHeight: 600, durationSec: 0 });
            };
            img.src = objUrl;
          });
        } else {
          return await new Promise((resolve) => {
            const vid = document.createElement('video');
            vid.preload = 'metadata';
            vid.muted = true;
            vid.playsInline = true;
            let settled = false;
            const finish = (nw: number, nh: number, dur: number, poster?: string) => {
              if (settled) return;
              settled = true;
              vid.removeAttribute('src');
              vid.load();
              resolve({
                naturalWidth: nw || 1280,
                naturalHeight: nh || 720,
                durationSec: Number.isFinite(dur) ? dur : 0,
                posterDataUrl: poster,
              });
            };
            const timer = window.setTimeout(() => {
              finish(vid.videoWidth || 1280, vid.videoHeight || 720, vid.duration || 0);
            }, 4000);

            vid.onloadedmetadata = () => {
              const targetT = Math.min(0.5, Math.max(0.05, (vid.duration || 1) * 0.08));
              try {
                vid.currentTime = targetT;
              } catch {
                clearTimeout(timer);
                finish(vid.videoWidth, vid.videoHeight, vid.duration);
              }
            };
            vid.onseeked = () => {
              clearTimeout(timer);
              let posterDataUrl: string | undefined;
              try {
                const nw = vid.videoWidth || 1280;
                const nh = vid.videoHeight || 720;
                const scale = Math.min(1, 320 / Math.max(nw, nh));
                const c = document.createElement('canvas');
                c.width = Math.max(1, Math.round(nw * scale));
                c.height = Math.max(1, Math.round(nh * scale));
                const ctx = c.getContext('2d');
                if (ctx) {
                  ctx.drawImage(vid, 0, 0, c.width, c.height);
                  posterDataUrl = c.toDataURL('image/jpeg', 0.72);
                }
              } catch {
                // ignore poster error
              }
              finish(vid.videoWidth, vid.videoHeight, vid.duration, posterDataUrl);
            };
            vid.onerror = () => {
              clearTimeout(timer);
              finish(1280, 720, 0);
            };
            vid.src = objUrl;
          });
        }
      } finally {
        URL.revokeObjectURL(objUrl);
      }
    },
    []
  );

  const insertMediaFilesOnSlide = useCallback(
    async (files: FileList | File[], dropVirtualPoint?: { x: number; y: number }) => {
      const engine = engineRef.current;
      if (!engine) return;
      const list = Array.from(files).filter(
        (f) => f && (f.type.startsWith('image/') || f.type.startsWith('video/') || /\.(png|jpe?g|gif|webp|svg|bmp|mp4|webm|mov|mkv|m4v|ogg)$/i.test(f.name))
      );
      if (list.length === 0) return;

      // Switch to pointer tool so student can immediately move/resize/play the inserted media
      setToolMode('pointer');

      for (let idx = 0; idx < list.length; idx++) {
        const file = list[idx];
        const isVideo =
          file.type.startsWith('video/') || /\.(mp4|webm|mov|mkv|m4v|ogg)$/i.test(file.name);
        const safeMime =
          file.type || (isVideo ? 'video/mp4' : 'image/png');
        const safeName =
          file.name || (isVideo ? `Slide_Video_${Date.now()}.mp4` : `Slide_Image_${Date.now()}.png`);

        showToast(`⏳ Placing ${isVideo ? 'video' : 'image'} "${safeName}" onto Slide ${activePageIndexRef.current + 1}...`);

        const meta = await extractMediaMetaAndPoster(file, isVideo);

        let uploadedUrl = '';
        let uploadedMediaId = `media_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

        try {
          const res = await fetch('/api/media/upload', {
            method: 'POST',
            headers: {
              'Content-Type': safeMime,
              'x-file-name': encodeURIComponent(safeName),
              'x-mime-type': safeMime,
            },
            body: file,
          });
          if (res.ok) {
            const data = await res.json();
            if (data && data.url) {
              uploadedUrl = data.url;
              uploadedMediaId = data.mediaId || uploadedMediaId;
            }
          }
        } catch (err) {
          console.warn('[SlideMedia] Binary vault upload fallback:', err);
        }

        if (!uploadedUrl) {
          uploadedUrl = URL.createObjectURL(file);
        }

        const maxW = isVideo ? 680 : 580;
        const maxH = isVideo ? 440 : 420;
        const fitScale = Math.min(1, maxW / Math.max(1, meta.naturalWidth), maxH / Math.max(1, meta.naturalHeight));
        const cardW = Math.max(220, Math.round(meta.naturalWidth * fitScale));
        const cardH = Math.max(150, Math.round(meta.naturalHeight * fitScale));

        let posX = 960 + idx * 36;
        let posY = 180 + idx * 36;
        let preserveExact = false;

        if (dropVirtualPoint) {
          posX = Math.round(
            Math.max(30, Math.min(VIRTUAL_WIDTH - cardW - 30, dropVirtualPoint.x - cardW / 2 + idx * 32))
          );
          posY = Math.round(
            Math.max(60, Math.min(VIRTUAL_HEIGHT - cardH - 30, dropVirtualPoint.y - cardH / 2 + idx * 32))
          );
          preserveExact = true;
        }

        const shapeId = `media-${uploadedMediaId}`;
        const scheduledTime = engine.audioClock.currentTime;

        engine.onDrawCommand({
          id: shapeId,
          type: 'shape',
          scheduledTime,
          commitGroup: `media-insert-${Date.now()}-${idx}`,
          payload: {
            kind: 'shape',
            id: shapeId,
            shapeType: isVideo ? 'video' : 'image',
            x: posX,
            y: posY,
            width: cardW,
            height: cardH,
            options: {
              label: safeName,
              preserveExactPosition: preserveExact,
              media: {
                mediaId: uploadedMediaId,
                mediaType: isVideo ? 'video' : 'image',
                url: uploadedUrl,
                fileName: safeName,
                mimeType: safeMime,
                naturalWidth: meta.naturalWidth,
                naturalHeight: meta.naturalHeight,
                durationSec: meta.durationSec,
                posterDataUrl: meta.posterDataUrl,
                shareAudioWithAI: true,
              },
            },
          },
        });

        showToast(
          isVideo
            ? `🎬 Video "${safeName}" placed on Slide ${activePageIndexRef.current + 1} — AI Vision & Deep Timeline Ready`
            : `🖼️ Image "${safeName}" placed on Slide ${activePageIndexRef.current + 1} — AI Vision Ready`
        );
      }

      // Sync pages, thumbnails, LiveKit board state, and trigger immediate Vision composite frame
      setTimeout(() => {
        scheduleLiveSlideSync();
        broadcastBoardStateSync();
        forceImmediateVisionFrameRef.current = true;
      }, 150);
    },
    [extractMediaMetaAndPoster, scheduleLiveSlideSync, broadcastBoardStateSync, showToast]
  );

  const handleSlideMediaInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (e.target.files && e.target.files.length > 0) {
        void insertMediaFilesOnSlide(e.target.files);
        e.target.value = '';
      }
    },
    [insertMediaFilesOnSlide]
  );

  const handleCanvasDragOver = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    if (e.dataTransfer?.types?.includes('Files')) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
      if (!isCanvasDragOver) setIsCanvasDragOver(true);
    }
  }, [isCanvasDragOver]);

  const handleCanvasDragLeave = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    if (e.currentTarget === e.target || !e.currentTarget.contains(e.relatedTarget as Node)) {
      setIsCanvasDragOver(false);
    }
  }, []);

  const handleCanvasDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      setIsCanvasDragOver(false);
      const files = e.dataTransfer?.files;
      if (!files || files.length === 0) return;

      const hasSlideMedia = Array.from(files).some(
        (f) =>
          f.type.startsWith('image/') ||
          f.type.startsWith('video/') ||
          /\.(png|jpe?g|gif|webp|svg|bmp|mp4|webm|mov|mkv|m4v|ogg)$/i.test(f.name)
      );
      if (!hasSlideMedia) return;

      e.preventDefault();
      e.stopPropagation();

      let dropPt: { x: number; y: number } | undefined;
      if (containerRef.current) {
        const rect = containerRef.current.getBoundingClientRect();
        const vx = (e.clientX - rect.left - transformRef.current.pan.x) / Math.max(0.2, transformRef.current.zoom);
        const vy = (e.clientY - rect.top - transformRef.current.pan.y) / Math.max(0.2, transformRef.current.zoom);
        dropPt = { x: vx, y: vy };
      }

      void insertMediaFilesOnSlide(files, dropPt);
    },
    [insertMediaFilesOnSlide]
  );

  // Global Ctrl+V paste onto slide when no text input is focused
  useEffect(() => {
    const handleWindowPaste = (e: ClipboardEvent) => {
      const active = document.activeElement as HTMLElement | null;
      if (
        active &&
        (active.tagName === 'INPUT' ||
          active.tagName === 'TEXTAREA' ||
          active.isContentEditable ||
          active.closest('.chat-drawer'))
      ) {
        return;
      }
      const items = e.clipboardData?.items;
      if (!items) return;
      const mediaFiles: File[] = [];
      for (let i = 0; i < items.length; i++) {
        const it = items[i];
        if (it.kind === 'file') {
          const f = it.getAsFile();
          if (f && (f.type.startsWith('image/') || f.type.startsWith('video/'))) {
            mediaFiles.push(f);
          }
        }
      }
      if (mediaFiles.length > 0) {
        e.preventDefault();
        void insertMediaFilesOnSlide(mediaFiles);
      }
    };

    window.addEventListener('paste', handleWindowPaste);
    return () => window.removeEventListener('paste', handleWindowPaste);
  }, [insertMediaFilesOnSlide]);

  const processQuickFile = (file: File) => {
    if (!file) return;
    if (file.type.startsWith('video/') || /\.(mp4|webm|mov|mkv|m4v|ogg)$/i.test(file.name)) {
      // Place video directly onto the active whiteboard slide via Binary Media Vault (zero Base64 bloat)
      void insertMediaFilesOnSlide([file]);
      return;
    }
    const isImg = file.type.startsWith('image/');
    const reader = new FileReader();
    reader.onload = (event) => {
      const dataUrl = event.target?.result as string;
      setAttachedFile({
        name: file.name || (isImg ? 'Pasted_Image.png' : 'Pasted_File'),
        type: isImg ? 'image' : 'document',
        dataUrl,
        size: file.size,
        mimeType: file.type || (isImg ? 'image/jpeg' : 'text/plain'),
      });
    };
    reader.readAsDataURL(file);
  };

  const handleQuickFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      processQuickFile(file);
      e.target.value = '';
    }
  };

  const handleQuickPaste = (e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.kind === 'file') {
        const file = item.getAsFile();
        if (file) {
          e.preventDefault();
          processQuickFile(file);
          return;
        }
      }
    }
  };

  // --- Send typed text prompt / multimodal message to AI agent ---
  const handleSendMessage = async (text: string, attachment?: ChatAttachment) => {
    if (!text.trim() && !attachment) return;
    try {
      const cleanText = text.trim();
      // Optimistically append user message to chat drawer
      setChatMessages((prev) => [
        ...prev,
        {
          id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          role: 'user',
          text: cleanText,
          timestamp: Date.now(),
          attachment,
        },
      ]);

      if (room) {
        const encoder = new TextEncoder();
        const payload = JSON.stringify({
          type: 'multimodal_prompt',
          text: cleanText,
          file: attachment?.dataUrl,
          mimeType: attachment?.mimeType || (attachment?.type === 'image' ? 'image/jpeg' : 'text/plain'),
          fileName: attachment?.name,
        });
        await room.localParticipant.publishData(encoder.encode(payload), { reliable: true });
        console.log('[Whiteboard] Sent multimodal prompt to AI:', cleanText, attachment?.name);
      }

      // If it's an image, also push to direct vision ws to update vision stream immediately
      if (attachment?.type === 'image' && attachment.dataUrl && directVisionWsRef.current?.readyState === WebSocket.OPEN) {
        directVisionWsRef.current.send(JSON.stringify({ image: attachment.dataUrl }));
      }
    } catch (err) {
      console.error('[Whiteboard] Failed to send prompt:', err);
    }
  };

  const sendPrompt = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!inputText.trim() && !attachedFile) return;
    const text = inputText.trim();
    const currentAttachment = attachedFile;
    setInputText('');
    setAttachedFile(null);
    await handleSendMessage(text, currentAttachment || undefined);
  };

  const MIC_CAPTURE_OPTIONS = {
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
  };

  // --- Toggle microphone state ---
  const toggleMicrophone = async () => {
    if (!room) return;

    try {
      const nextState = !isMicrophoneEnabled;
      await room.localParticipant.setMicrophoneEnabled(nextState, nextState ? MIC_CAPTURE_OPTIONS : undefined);
      setIsMicrophoneEnabled(nextState);
    } catch (error) {
      console.error('[Whiteboard] Failed to toggle microphone:', error);
      setIsMicrophoneEnabled(!isMicrophoneEnabled);
    }
  };

  // --- Toggle AI Tutor Voice Output (Speaker Mute / Deafen) ---
  const toggleSpeakerMute = () => {
    const nextMuted = !isSpeakerMuted;
    if (onToggleSpeakerMute) {
      onToggleSpeakerMute();
    }
    // Proactively apply volume adjustment to all remote audio tracks
    if (room) {
      try {
        room.remoteParticipants.forEach((p) => {
          p.trackPublications.forEach((pub) => {
            if (pub.kind === Track.Kind.Audio && pub.audioTrack && 'setVolume' in pub.audioTrack) {
              (pub.audioTrack as any).setVolume(nextMuted ? 0 : 1);
            }
          });
        });
      } catch (err) {
        console.error('[Whiteboard] Failed to adjust remote audio track volume:', err);
      }
    }
    setSaveToast(nextMuted ? '🔇 ZYREN AI Tutor voice muted (Silent Mode)' : '🔊 ZYREN AI Tutor voice unmuted');
    setTimeout(() => setSaveToast(null), 3000);
  };

  // --- Reset AI Memory & Context (Start fresh Turn 0 session) ---
  const handleResetAIMemory = useCallback(() => {
    // 0. Ensure audio playback remains healthy and unpaused in the browser
    try {
      if (!isSpeakerMuted) {
        document.querySelectorAll('audio').forEach((el) => {
          if (el.paused) {
            el.play().catch(() => {});
          }
        });
      }
      if (room) {
        room.remoteParticipants.forEach((p) => {
          p.trackPublications.forEach((pub) => {
            if (pub.kind === Track.Kind.Audio && pub.audioTrack && 'setVolume' in pub.audioTrack) {
              (pub.audioTrack as any).setVolume(isSpeakerMuted ? 0 : 1);
            }
          });
        });
      }
    } catch (e) {
      console.warn('[Whiteboard] Audio check on reset:', e);
    }

    // 1. Clear local frontend chat message log
    setChatMessages([]);

    // 2. Dispatch reset signal to the AI Tutor backend agent
    try {
      if (room && room.state === 'connected' && room.localParticipant) {
        const payload = JSON.stringify({
          type: 'reset_ai_memory',
          timestamp: Date.now(),
        });
        const encoder = new TextEncoder();
        room.localParticipant.publishData(encoder.encode(payload), { reliable: true });
        console.log('[Whiteboard] Dispatched reset_ai_memory signal to agent.');
      }
    } catch (err) {
      console.error('[Whiteboard] Failed to dispatch reset_ai_memory signal:', err);
    }

    // 3. Show feedback toast to user
    setSaveToast('🔄 AI Memory & Context Reset (Turn 0) — Fresh Context Ready');
    setTimeout(() => setSaveToast(null), 3500);
  }, [room, isSpeakerMuted]);

  // Keep remote audio track volumes aligned with isSpeakerMuted state and ensure playing
  useEffect(() => {
    if (!room) return;
    try {
      room.remoteParticipants.forEach((p) => {
        p.trackPublications.forEach((pub) => {
          if (pub.kind === Track.Kind.Audio && pub.audioTrack && 'setVolume' in pub.audioTrack) {
            (pub.audioTrack as any).setVolume(isSpeakerMuted ? 0 : 1);
          }
        });
      });
      if (!isSpeakerMuted) {
        document.querySelectorAll('audio').forEach((el) => {
          if (el.paused) {
            el.play().catch(() => {});
          }
        });
      }
    } catch (err) {
      // ignore
    }
  }, [isSpeakerMuted, room]);

  // Handle incoming LiveKit DataChannel messages
  useEffect(() => {
    if (!room) return;

    const handleData = (payload: Uint8Array, _participant: any, _kind: any) => {
      try {
        const decoder = new TextDecoder();
        const msg = JSON.parse(decoder.decode(payload));
        const engine = engineRef.current;
        if (!engine) return;

        // The AI sends commands just ahead of its voice
        const scheduledTime = engine.audioClock.currentTime + 0.2;

        if (msg.type === 'chat_message') {
          // Guarantee audio element is playing when AI delivers speech
          if (!isSpeakerMuted) {
            document.querySelectorAll('audio').forEach((el) => {
              if (el.paused) {
                el.play().catch(() => {});
              }
            });
          }
          const item = msg.payload;
          if (item && item.text) {
            setChatMessages((prev) => reconcileLiveChatMessages(prev, item));
          }
        } else if (msg.type === 'shape' || msg.type === 'handwriting') {
          const drawPayload = msg.payload;

          if (msg.type === 'handwriting' && drawPayload.text) {
            drawPayload.charTimings = generateTimings(drawPayload.text, scheduledTime, 0.04);
          }

          engine.onDrawCommand({
            id: `live-${Date.now()}-${Math.random()}`,
            type: msg.type,
            scheduledTime,
            commitGroup: `live-group-${Date.now()}`,
            payload: drawPayload,
          });
        } else if (msg.type === 'erase') {
          const target = msg.payload?.target || 'last';
          engine.erase(target);
          // Sync current slide's saved state
          const currentShapes = engine.getDrawnShapes();
          const currentHandwriting = engine.getDrawnHandwriting();
          setPages((prev) =>
            prev.map((p, idx) =>
              idx === activePageIndexRef.current
                ? { ...p, shapes: [...currentShapes], handwriting: [...currentHandwriting] }
                : p
            )
          );
        } else if (msg.type === 'clear') {
          const mode = msg.payload?.mode || 'current_slide';
          if (mode === 'all_slides') {
            engine.clear();
            const resetPage: WhiteboardPage = {
              id: `page-${Date.now()}`,
              pageNumber: 1,
              title: 'Slide 1',
              shapes: [],
              handwriting: [],
              createdAt: Date.now(),
            };
            setPages([resetPage]);
            setActivePageIndex(0);
          } else {
            // Wipes the active slide clean without creating a new slide
            engine.clear();
            setPages((prev) =>
              prev.map((p, idx) =>
                idx === activePageIndexRef.current
                  ? { ...p, title: `Slide ${p.pageNumber}`, shapes: [], handwriting: [] }
                  : p
              )
            );
          }
        } else if (msg.type === 'redo') {
          engine.redo();
          const currentShapes = engine.getDrawnShapes();
          const currentHandwriting = engine.getDrawnHandwriting();
          setPages((prev) =>
            prev.map((p, idx) =>
              idx === activePageIndexRef.current
                ? { ...p, shapes: [...currentShapes], handwriting: [...currentHandwriting] }
                : p
            )
          );
        } else if (msg.type === 'undo') {
          engine.undo();
          const currentShapes = engine.getDrawnShapes();
          const currentHandwriting = engine.getDrawnHandwriting();
          setPages((prev) =>
            prev.map((p, idx) =>
              idx === activePageIndexRef.current
                ? { ...p, shapes: [...currentShapes], handwriting: [...currentHandwriting] }
                : p
            )
          );
        } else if (msg.type === 'new_page') {
          const slideTitle =
            typeof msg.payload?.title === 'string' && msg.payload.title.trim()
              ? msg.payload.title.trim()
              : undefined;
          addNewPage(slideTitle);
        }

        // Keep agent memory in sync with new drawing/erasing updates
        setTimeout(() => {
          broadcastBoardStateSync();
        }, 800);
      } catch (e) {
        console.error('[Whiteboard] Error parsing data channel msg', e);
      }
    };

    room.on(RoomEvent.DataReceived, handleData);
    return () => {
      room.off(RoomEvent.DataReceived, handleData);
    };
  }, [room, addNewPage, broadcastBoardStateSync]);

  // Demo mode: run a scripted demonstration
  const runDemo = useCallback(async (lang: 'ar' | 'en' | 'de' = 'ar') => {
    const engine = engineRef.current;
    const svg = svgRef.current;
    if (!engine || !svg) return;

    setHasStarted(true);

    // Ensure audio clock is resumed (required by browser autoplay policy after a user gesture)
    await engine.audioClock.resume();

    // Clear everything first (both Canvas, SVG, and SyncEngine internal shapes)
    engine.clear();
    const canvas = canvasRef.current;
    if (canvas) canvas.getAdapter().clear();
    svg.clear();

    const baseTime = engine.audioClock.currentTime + 0.5; // Start 500ms from now

    // Demo content configuration (100% English default)
    let titleText = 'Software Architecture Overview';
    let subtitleText = 'Client-Server Three-Tier Architecture';
    let titlePos = { x: 180, y: 120 };
    let subtitlePos = { x: 180, y: 200 };
    let direction: 'rtl' | 'ltr' = 'ltr';
    let align: 'left' | 'right' = 'left';

    let label1 = 'Web Browser';
    let label2 = 'API Server';
    let label3 = 'Database';

    if (lang === 'de') {
      titleText = 'Einfuehrung in die Softwaretechnik';
      subtitleText = 'Drei-Schichten-Architektur Modell';
      label1 = 'Web-Browser';
      label2 = 'Anwendungs-Server';
      label3 = 'Datenbank';
    }

    // ── Step 1: Title handwriting (appears at T+0.3s) ─────────
    const titlePayload: HandwritingPayload = {
      kind: 'handwriting',
      text: titleText,
      position: titlePos,
      style: 'title',
      direction,
      align,
      charTimings: generateTimings(titleText, baseTime + 0.3, 0.06),
    };

    engine.onDrawCommand({
      id: 'demo-hw-1',
      type: 'handwriting',
      scheduledTime: baseTime + 0.3,
      commitGroup: 'sentence-1',
      payload: titlePayload,
    });

    // ── Step 2: Subtitle (appears at T+2.2s) ───────────────────
    const subtitlePayload: HandwritingPayload = {
      kind: 'handwriting',
      text: subtitleText,
      position: subtitlePos,
      style: 'body',
      direction,
      align,
      charTimings: generateTimings(subtitleText, baseTime + 2.2, 0.05),
    };

    engine.onDrawCommand({
      id: 'demo-hw-2',
      type: 'handwriting',
      scheduledTime: baseTime + 2.2,
      commitGroup: 'sentence-2',
      payload: subtitlePayload,
    });

    // ── Step 3: Draw diagrams (appears at T+4.0s) ──────────────
    const shapes: DrawCommand[] = [
      {
        id: 'demo-rect-1',
        type: 'shape',
        scheduledTime: baseTime + 4.0,
        commitGroup: 'diagram-1',
        payload: {
          kind: 'shape',
          shapeType: 'rectangle',
          x: 180,
          y: 440,
          width: 320,
          height: 130,
          options: { color: '#4ECDC4', roughness: 1.5 },
        } as ShapePayload,
      },
      {
        id: 'demo-rect-2',
        type: 'shape',
        scheduledTime: baseTime + 4.5,
        commitGroup: 'diagram-1',
        payload: {
          kind: 'shape',
          shapeType: 'rectangle',
          x: 760,
          y: 440,
          width: 400,
          height: 130,
          options: { color: '#FF6B6B', roughness: 1.5 },
        } as ShapePayload,
      },
      {
        id: 'demo-rect-3',
        type: 'shape',
        scheduledTime: baseTime + 5.0,
        commitGroup: 'diagram-1',
        payload: {
          kind: 'shape',
          shapeType: 'rectangle',
          x: 1420,
          y: 440,
          width: 320,
          height: 130,
          options: { color: '#45B7D1', roughness: 1.5 },
        } as ShapePayload,
      },
      {
        id: 'demo-arrow-1',
        type: 'shape',
        scheduledTime: baseTime + 5.5,
        commitGroup: 'diagram-1',
        payload: {
          kind: 'shape',
          shapeType: 'arrow',
          x: 510,
          y: 505,
          toX: 750,
          toY: 505,
          options: { color: '#FFE66D', roughness: 1 },
        } as ShapePayload,
      },
      {
        id: 'demo-arrow-2',
        type: 'shape',
        scheduledTime: baseTime + 5.8,
        commitGroup: 'diagram-1',
        payload: {
          kind: 'shape',
          shapeType: 'arrow',
          x: 1170,
          y: 505,
          toX: 1410,
          toY: 505,
          options: { color: '#FFE66D', roughness: 1 },
        } as ShapePayload,
      },
    ];

    engine.onDrawCommands(shapes);

    // ── Step 4: Label the diagram (appears at T+6.2s) ─────────
    const labels: DrawCommand[] = [
      {
        id: 'demo-label-1',
        type: 'handwriting',
        scheduledTime: baseTime + 6.2,
        commitGroup: 'diagram-1',
        payload: {
          kind: 'handwriting',
          text: label1,
          position: { x: 340, y: 520 },
          style: 'annotation',
          align: 'center',
          direction,
          charTimings: generateTimings(label1, baseTime + 6.2, 0.06),
        } as HandwritingPayload,
      },
      {
        id: 'demo-label-2',
        type: 'handwriting',
        scheduledTime: baseTime + 7.0,
        commitGroup: 'diagram-1',
        payload: {
          kind: 'handwriting',
          text: label2,
          position: { x: 960, y: 520 },
          style: 'annotation',
          align: 'center',
          direction,
          charTimings: generateTimings(label2, baseTime + 7.0, 0.05),
        } as HandwritingPayload,
      },
      {
        id: 'demo-label-3',
        type: 'handwriting',
        scheduledTime: baseTime + 7.8,
        commitGroup: 'diagram-1',
        payload: {
          kind: 'handwriting',
          text: label3,
          position: { x: 1580, y: 520 },
          style: 'annotation',
          align: 'center',
          direction,
          charTimings: generateTimings(label3, baseTime + 7.8, 0.06),
        } as HandwritingPayload,
      },
    ];

    engine.onDrawCommands(labels);

    console.log(`[Whiteboard] Demo scheduled for ${lang.toUpperCase()} — watch the magic! ✨`);
  }, [engineRef, svgRef]);

  const startSession = useCallback(async () => {
    const engine = engineRef.current;
    if (!engine) return;

    setHasStarted(true);
    await engine.audioClock.resume();

    // Preserve any auto-restored or user-drawn slides on the board and sync state to the AI agent
    broadcastBoardStateSync();

    if (room) {
      try {
        // Enable microphone with echo cancellation and noise suppression
        await room.localParticipant.setMicrophoneEnabled(true, MIC_CAPTURE_OPTIONS);
        setIsMicrophoneEnabled(true);
        console.log('[Whiteboard] Microphone successfully enabled for LiveKit session');
      } catch (err) {
        console.error('[Whiteboard] Failed to enable microphone or video on session start:', err);
        setIsMicrophoneEnabled(false);
      }
    } else {
      setIsMicrophoneEnabled(true);
    }
  }, [room, broadcastBoardStateSync]);

  // Ensure microphone is strictly disabled before Start Session is clicked
  useEffect(() => {
    if (room) {
      if (hasStarted) {
        room.localParticipant.setMicrophoneEnabled(true, MIC_CAPTURE_OPTIONS)
          .then(() => setIsMicrophoneEnabled(true))
          .catch(err => console.error('[Whiteboard] Auto-reconnect mic failed:', err));
      } else {
        room.localParticipant.setMicrophoneEnabled(false)
          .then(() => setIsMicrophoneEnabled(false))
          .catch(() => {});
      }
    }
  }, [room, hasStarted]);

  const generateTimings = (
    text: string,
    startTime: number,
    charDuration: number
  ): CharTiming[] => {
    let currentTime = startTime;
    return [...text].map((char) => {
      const timing: CharTiming = {
        char,
        start: currentTime,
        end: currentTime + charDuration,
      };
      currentTime += charDuration;
      return timing;
    });
  };

  const activeVoiceObj = ALL_GEMINI_VOICES.find((v) => v.id === currentVoice) || ALL_GEMINI_VOICES[0];
  const activeModelObj = SUPPORTED_MODELS.find((m) => m.id === currentModel) || SUPPORTED_MODELS[0];

  return (
    <div
      ref={containerRef}
      style={{
        width: '100%',
        height: '100vh',
        position: 'relative',
        backgroundColor: '#131324',
        overflow: 'hidden',
        cursor: 'grab',
        touchAction: 'none',
        userSelect: 'none',
      }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      onDragOver={handleCanvasDragOver}
      onDragLeave={handleCanvasDragLeave}
      onDrop={handleCanvasDrop}
    >
      {isCanvasDragOver && (
        <div
          className="no-vision no-zoom"
          style={{
            position: 'absolute',
            inset: 16,
            borderRadius: 16,
            border: '2px dashed #4ECDC4',
            backgroundColor: 'rgba(78, 205, 196, 0.12)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 90,
            pointerEvents: 'none',
            color: '#4ECDC4',
            fontSize: 18,
            fontWeight: 700,
            fontFamily: "'Inter', sans-serif",
            backdropFilter: 'blur(2px)',
          }}
        >
          🖼️🎬 Drop Image or Video directly onto Slide {activePageIndex + 1}
        </div>
      )}
      {/* ── Virtual Canvas Container (Fixed 1920x1080 Viewport) ── */}
      <div
        ref={viewportRef}
        className="whiteboard-viewport"
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: VIRTUAL_WIDTH,
          height: VIRTUAL_HEIGHT,
          transform: `translate(${transform.pan.x}px, ${transform.pan.y}px) scale(${transform.zoom})`,
          transformOrigin: '0 0',
          pointerEvents: 'none',
          willChange: 'transform',
        }}
      >
        {/* Layer 1: Rough.js Canvas (Shapes, Arrows, Background Diagrams) */}
        <CanvasLayer
          ref={canvasRef}
          width={VIRTUAL_WIDTH}
          height={VIRTUAL_HEIGHT}
        />

        {/* Layer 1.5: Interactive Slide Media Layer (High-Res Images & Playable Videos with AI Vision/Audio Tap) */}
        <SlideMediaOverlay
          ref={mediaRef}
          zoom={transform.zoom}
          toolMode={toolMode}
          onUpdateGeometry={handleMediaGeometryUpdate}
          onRemoveMedia={handleRemoveMedia}
          onMediaVisualFrameChanged={handleMediaVisualFrameChanged}
          onVideoAudioChunk={handleVideoAudioChunk}
        />

        {/* Layer 2: SVG Overlay (Handwritten Text & Real-time Stroke Reveal) */}
        <SVGOverlay
          ref={svgRef}
          width={VIRTUAL_WIDTH}
          height={VIRTUAL_HEIGHT}
          fontUrl={FONT_URL}
          onWritingFocus={handleWritingFocus}
        />

        {/* Layer 3: Math Overlay (High-Precision KaTeX Math & Equations) */}
        <MathOverlay
          ref={mathRef}
          defaultColor="#FFFFFF"
        />

        {/* Layer 4: Graph Overlay (2D Mathematical Function Plotter) */}
        <GraphOverlay
          ref={graphRef}
          onUpdatePosition={handleGraphPositionUpdate}
        />

        {/* Layer 5: 3D Graph Overlay (Interactive WebGL 3D Math Surfaces & Solids of Revolution) */}
        <Graph3DOverlay
          ref={graph3dRef}
        />

        {/* Layer 5.5: Venn Diagram Overlay (High-Precision Probability & Boolean Sets) */}
        <VennOverlay
          ref={vennRef}
          onUpdatePosition={handleVennPositionUpdate}
          onRemoveVenn={handleRemoveVenn}
        />

        {/* Layer 6: User Drawing Overlay (Handwriting & Text input by the user) */}
        <UserDrawingLayer
          mode={toolMode}
          zoom={transform.zoom}
          paths={pages[activePageIndex]?.userPaths || []}
          texts={pages[activePageIndex]?.userTexts || []}
          onPathsChange={(newPaths) => {
            const currentP = pagesRef.current[activePageIndexRef.current];
            const oldPaths = currentP?.userPaths || [];
            const oldTexts = currentP?.userTexts || [];
            undoActionStackRef.current.push({
              kind: 'user',
              pageIndex: activePageIndexRef.current,
              previousPaths: [...oldPaths],
              previousTexts: [...oldTexts],
              nextPaths: [...newPaths],
              nextTexts: [...oldTexts],
            });
            if (undoActionStackRef.current.length > 50) {
              undoActionStackRef.current.shift();
            }
            redoActionStackRef.current = [];
            setPages((prev) =>
              prev.map((p, idx) =>
                idx === activePageIndex ? { ...p, userPaths: newPaths } : p
              )
            );
          }}
          onTextsChange={(newTexts) => {
            const currentP = pagesRef.current[activePageIndexRef.current];
            const oldPaths = currentP?.userPaths || [];
            const oldTexts = currentP?.userTexts || [];
            undoActionStackRef.current.push({
              kind: 'user',
              pageIndex: activePageIndexRef.current,
              previousPaths: [...oldPaths],
              previousTexts: [...oldTexts],
              nextPaths: [...oldPaths],
              nextTexts: [...newTexts],
            });
            if (undoActionStackRef.current.length > 50) {
              undoActionStackRef.current.shift();
            }
            redoActionStackRef.current = [];
            setPages((prev) =>
              prev.map((p, idx) =>
                idx === activePageIndex ? { ...p, userTexts: newTexts } : p
              )
            );
          }}
          width={VIRTUAL_WIDTH}
          height={VIRTUAL_HEIGHT}
        />
      </div>

      {/* ── Top Right: AI Vision Badge & Slides Deck Pill ── */}
      <div
        className="top-right-bar no-zoom interactive"
        style={{
          position: 'fixed',
          top: 20,
          right: isSlidePanelOpen ? (typeof window !== 'undefined' && window.innerWidth <= 768 ? 20 : 336) : 20,
          zIndex: 40,
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          transition: 'right 0.25s cubic-bezier(0.16, 1, 0.3, 1)',
        }}
        onPointerDown={(e) => e.stopPropagation()}
      >
        {/* ŽYREN AI Tutor Readiness Status Badge */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '7px 14px',
            backgroundColor: isAgentReady ? 'rgba(20, 20, 38, 0.92)' : 'rgba(35, 25, 20, 0.92)',
            backdropFilter: 'blur(12px)',
            borderRadius: 20,
            border: isAgentReady ? '1px solid rgba(78, 205, 196, 0.5)' : '1px solid rgba(255, 193, 7, 0.4)',
            boxShadow: isAgentReady ? '0 4px 16px rgba(78, 205, 196, 0.2)' : '0 4px 16px rgba(0,0,0,0.3)',
            transition: 'all 0.3s ease',
          }}
          title={isAgentReady ? 'ŽYREN AI Tutor is online and ready for voice interaction' : 'Preparing ŽYREN AI Tutor agent connection...'}
        >
          <div
            style={{
              width: 8,
              height: 8,
              borderRadius: '50%',
              backgroundColor: isAgentReady ? '#4ECDC4' : '#FFB300',
              boxShadow: isAgentReady ? '0 0 10px #4ECDC4' : '0 0 8px #FFB300',
              animation: isAgentReady ? 'none' : 'zyrenPulse 1.5s infinite ease-in-out',
            }}
          />
          <span
            style={{
              fontSize: 12,
              fontWeight: 700,
              color: isAgentReady ? '#4ECDC4' : '#FFD54F',
              fontFamily: "'Inter', sans-serif",
              letterSpacing: '0.2px',
            }}
          >
            {isAgentReady ? 'ŽYREN AI Tutor Ready 🎓' : '⏳ Preparing ŽYREN AI Tutor...'}
          </span>
        </div>

        {/* Live AI Vision Feed Status Badge */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '7px 14px',
            backgroundColor: 'rgba(20, 20, 38, 0.88)',
            backdropFilter: 'blur(12px)',
            borderRadius: 20,
            border: '1px solid rgba(255, 255, 255, 0.12)',
            boxShadow: '0 4px 16px rgba(0,0,0,0.3)',
          }}
          className="no-vision"
          title={
            isSplitViewEnabled
              ? 'AI Vision: Split-View (Whiteboard + Screen + Webcam in Parallel)'
              : isScreenSharing
              ? 'AI Vision: Screen Share Stream'
              : isWebcamActive
              ? 'AI Vision: Webcam Stream'
              : 'AI Vision: Whiteboard Canvas'
          }
        >
          <div
            style={{
              width: 8,
              height: 8,
              borderRadius: '50%',
              backgroundColor: isSplitViewEnabled
                ? '#4ECDC4'
                : isScreenSharing || isWebcamActive
                ? '#FF6B6B'
                : '#A8FF78',
              boxShadow: `0 0 10px ${
                isSplitViewEnabled
                  ? '#4ECDC4'
                  : isScreenSharing || isWebcamActive
                  ? '#FF6B6B'
                  : '#A8FF78'
              }`,
            }}
          />
          <span className="vision-badge-text" style={{ fontSize: 12, fontWeight: 600, color: '#fff' }}>
            {isSplitViewEnabled
              ? '👁️ AI Vision: Split-View'
              : isScreenSharing
              ? '👁️ AI Vision: Screen'
              : isWebcamActive
              ? '👁️ AI Vision: Webcam'
              : '👁️ AI Vision: Whiteboard'}
          </span>
        </div>

        {/* Slides Deck Pill (when sidebar is closed) */}
        {!isSlidePanelOpen && (
          <button
            onClick={() => setIsSlidePanelOpen(true)}
            title="Open Whiteboard Slides Deck"
            className="slides-deck-pill"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              padding: '7px 14px',
              backgroundColor: 'rgba(20, 20, 38, 0.88)',
              backdropFilter: 'blur(12px)',
              border: '1px solid rgba(78, 205, 196, 0.4)',
              borderRadius: 20,
              color: '#4ECDC4',
              fontSize: 12,
              fontWeight: 600,
              cursor: 'pointer',
              boxShadow: '0 4px 16px rgba(0, 0, 0, 0.4)',
              fontFamily: "'Inter', sans-serif",
            }}
          >
            <span>📑</span>
            <span className="slides-pill-text">Slides ({pages.length})</span>
            <span className="slides-pill-count" style={{ display: 'none' }}>({pages.length})</span>
          </button>
        )}
      </div>

      {/* ── Save Notification Toast ── */}
      {saveToast && (
        <div
          style={{
            position: 'absolute',
            top: 20,
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 60,
            backgroundColor: 'rgba(78, 205, 196, 0.95)',
            color: '#1a1a2e',
            padding: '8px 18px',
            borderRadius: 20,
            fontSize: 13,
            fontWeight: 600,
            boxShadow: '0 4px 20px rgba(0, 0, 0, 0.4)',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            fontFamily: "'Inter', sans-serif",
            animation: 'fadeInMath 0.2s ease-out',
          }}
        >
          <span>💾</span>
          <span>{saveToast}</span>
        </div>
      )}

      {/* ── Top Left: Professional File Menu Bar ── */}
      <FileMenu
        currentTitle={sessionTitle}
        onUpdateTitle={handleUpdateSessionTitle}
        pages={pages}
        activePageIndex={activePageIndex}
        onNewFile={handleNewFile}
        onSave={handleSave}
        onSaveAs={handleSaveAs}
        onOpenPicker={handleOpenPicker}
        onOpenFile={handleOpenFile}
        onExportPNG={handleExportPNG}
        onExportPDF={handleExportPDF}
        onClearSlide={handleClearSlide}
        recentSessions={recentSessions}
        activeSessionId={activeSessionId}
        onLoadRecent={handleLoadRecent}
        onDeleteRecent={handleDeleteRecent}
        onTogglePinRecent={handleTogglePinRecent}
        onOpenVoiceModal={() => setIsVoiceModalOpen(true)}
        onOpenApiKeyModal={() => setIsApiKeyModalOpen(true)}
        autoSaveState={autoSaveState}
        lastAutoSavedAt={lastAutoSavedAt}
      />

      {/* ── Top Left: Diagnostics Overlay (Toggled via button) ── */}
      {showDebugOverlay && (
        <div
          style={{
            position: 'absolute',
            top: 68,
            left: 20,
            zIndex: 30,
            backgroundColor: 'rgba(19, 19, 36, 0.85)',
            backdropFilter: 'blur(10px)',
            border: '1px solid rgba(255, 255, 255, 0.12)',
            borderRadius: 8,
            padding: '10px 14px',
            color: '#aaa',
            fontSize: 12,
            fontFamily: 'monospace',
            pointerEvents: 'none',
          }}
        >
          <div style={{ color: '#4ECDC4', fontWeight: 'bold', marginBottom: 4 }}>📊 Diagnostic Info</div>
          <div>Zoom: {Math.round(transform.zoom * 100)}%</div>
          <div>Pan: {Math.round(transform.pan.x)}px, {Math.round(transform.pan.y)}px</div>
        </div>
      )}

      {/* ── Bottom Hover Zone for Auto-Hide Toolbar ── */}
      {!isToolbarPinned && (
        <div
          style={{
            position: 'absolute',
            bottom: 0,
            left: 0,
            width: '100%',
            height: 40,
            zIndex: 29,
          }}
          onPointerEnter={() => setIsHoveringBottom(true)}
        />
      )}

      {/* ── Full-width Bottom Controls Bar ── */}
      <div
        className="bottom-controls-bar no-zoom interactive"
        style={{
          position: 'absolute',
          bottom: 0,
          left: 0,
          width: '100%',
          zIndex: 30,
          display: 'flex',
          gap: 12,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: 'rgba(18, 18, 34, 0.94)',
          backdropFilter: 'blur(20px)',
          padding: '12px 24px',
          borderTop: '1px solid rgba(255, 255, 255, 0.12)',
          boxShadow: '0 -4px 32px rgba(0, 0, 0, 0.55)',
          overflow: 'visible',
          whiteSpace: 'nowrap',
          transform: isToolbarPinned || isHoveringBottom ? 'translateY(0)' : 'translateY(100%)',
          transition: 'transform 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
        }}
        onPointerDown={(e) => e.stopPropagation()}
        onPointerEnter={() => setIsHoveringBottom(true)}
        onPointerLeave={() => setIsHoveringBottom(false)}
      >
        {/* ── Island 1: Live Session & Prompt Communication Dock ── */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 5,
            backgroundColor: 'rgba(255, 255, 255, 0.03)',
            padding: '4px 6px',
            borderRadius: 10,
            border: '1px solid rgba(255, 255, 255, 0.08)',
          }}
        >
          {/* Pin Toolbar Button */}
          <button
            onClick={() => setIsToolbarPinned(!isToolbarPinned)}
            title={isToolbarPinned ? "Unpin Toolbar (Auto-hide)" : "Pin Toolbar"}
            style={{
              background: 'none',
              border: 'none',
              color: isToolbarPinned ? '#4ECDC4' : '#888',
              cursor: 'pointer',
              fontSize: 15,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: 4,
            }}
          >
            {isToolbarPinned ? '📌' : '📍'}
          </button>

          {!hasStarted ? (
            <button
              onClick={startSession}
              title="Start Live ZYREN AI Tutor Session"
              style={{
                padding: '7px 14px',
                fontSize: 12,
                fontWeight: 700,
                backgroundColor: '#4ECDC4',
                color: '#121222',
                border: 'none',
                borderRadius: 8,
                cursor: 'pointer',
                fontFamily: "'Inter', sans-serif",
                boxShadow: '0 2px 10px rgba(78, 205, 196, 0.4)',
                display: 'flex',
                alignItems: 'center',
                gap: 5,
                transition: 'all 0.15s ease',
              }}
            >
              <span>🚀</span>
              <span>Start</span>
            </button>
          ) : (
            <button
              onClick={toggleMicrophone}
              title={isMicrophoneEnabled ? 'Mute Microphone' : 'Unmute Microphone'}
              style={{
                padding: '7px 11px',
                fontSize: 13,
                fontWeight: 600,
                backgroundColor: isMicrophoneEnabled ? 'rgba(78, 205, 196, 0.2)' : 'rgba(248, 113, 113, 0.2)',
                color: isMicrophoneEnabled ? '#4ECDC4' : '#f87171',
                border: isMicrophoneEnabled ? '1px solid #4ECDC4' : '1px solid #f87171',
                borderRadius: 8,
                cursor: 'pointer',
                fontFamily: "'Inter', sans-serif",
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <span>🎤</span>
            </button>
          )}

          {/* AI Voice Output Mute / Speaker Toggle */}
          <button
            onClick={toggleSpeakerMute}
            title={isSpeakerMuted ? 'Unmute AI Voice Output' : 'Mute AI Voice Output (Silent reading mode)'}
            style={{
              padding: '7px 10px',
              fontSize: 13,
              fontWeight: 600,
              backgroundColor: isSpeakerMuted ? 'rgba(248, 113, 113, 0.2)' : 'rgba(78, 205, 196, 0.2)',
              color: isSpeakerMuted ? '#f87171' : '#4ECDC4',
              border: isSpeakerMuted ? '1px solid #f87171' : '1px solid #4ECDC4',
              borderRadius: 8,
              cursor: 'pointer',
              fontFamily: "'Inter', sans-serif",
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              transition: 'all 0.2s ease',
            }}
          >
            <span>{isSpeakerMuted ? '🔇' : '🔊'}</span>
          </button>

          {/* AI Chat Drawer Button */}
          <button
            onClick={() => setIsChatDrawerOpen(!isChatDrawerOpen)}
            title="Toggle ZYREN AI Tutor Live Chat & Transcripts"
            style={{
              padding: '7px 10px',
              fontSize: 13,
              fontWeight: 600,
              backgroundColor: isChatDrawerOpen ? 'rgba(78, 205, 196, 0.25)' : 'rgba(255, 255, 255, 0.07)',
              color: isChatDrawerOpen ? '#4ECDC4' : '#FFF',
              border: isChatDrawerOpen ? '1px solid #4ECDC4' : '1px solid rgba(255, 255, 255, 0.12)',
              borderRadius: 8,
              cursor: 'pointer',
              fontFamily: "'Inter', sans-serif",
              display: 'flex',
              alignItems: 'center',
              gap: 4,
            }}
          >
            <span>💬</span>
            {chatMessages.length > 0 && (
              <span
                style={{
                  fontSize: 10,
                  padding: '1px 5px',
                  borderRadius: 10,
                  backgroundColor: '#4ECDC4',
                  color: '#121222',
                  fontWeight: 700,
                  lineHeight: 1.2,
                }}
              >
                {chatMessages.length}
              </span>
            )}
          </button>

          {/* Quick Prompt Input with File Attachment */}
          <form onSubmit={sendPrompt} style={{ display: 'flex', gap: 4, alignItems: 'center', position: 'relative' }}>
            <input
              type="file"
              ref={quickFileInputRef}
              onChange={handleQuickFileChange}
              accept="image/*,video/*,.pdf,.txt,.py,.json,.csv,.md,.js,.ts,.html,.css"
              style={{ display: 'none' }}
            />

            {/* Attachment preview chip if selected */}
            {attachedFile && (
              <div
                className="no-zoom interactive"
                style={{
                  position: 'absolute',
                  bottom: 'calc(100% + 8px)',
                  left: 0,
                  backgroundColor: '#16162a',
                  border: '1px solid #4ECDC4',
                  borderRadius: 8,
                  padding: '4px 8px',
                  fontSize: 11,
                  color: '#4ECDC4',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  boxShadow: '0 4px 16px rgba(0, 0, 0, 0.6)',
                  zIndex: 100,
                  maxWidth: 200,
                }}
              >
                {attachedFile.type === 'image' && attachedFile.dataUrl ? (
                  <img
                    src={attachedFile.dataUrl}
                    alt="Preview"
                    style={{ width: 18, height: 18, borderRadius: 3, objectFit: 'cover' }}
                  />
                ) : (
                  <span>📄</span>
                )}
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {attachedFile.name}
                </span>
                <button
                  type="button"
                  onClick={() => setAttachedFile(null)}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: '#ff6b6b',
                    cursor: 'pointer',
                    fontSize: 12,
                    padding: 0,
                    lineHeight: 1,
                  }}
                >
                  ✕
                </button>
              </div>
            )}

            {/* Quick Attach Button */}
            <button
              type="button"
              onClick={() => quickFileInputRef.current?.click()}
              title="Attach Image or File to ask ZYREN AI Tutor"
              style={{
                padding: '6px 8px',
                backgroundColor: attachedFile ? 'rgba(78, 205, 196, 0.25)' : 'rgba(255, 255, 255, 0.08)',
                color: attachedFile ? '#4ECDC4' : '#FFF',
                border: attachedFile ? '1px solid #4ECDC4' : '1px solid rgba(255, 255, 255, 0.15)',
                borderRadius: 7,
                fontSize: 12,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                transition: 'all 0.15s ease',
              }}
            >
              📎
            </button>

            <textarea
              placeholder={attachedFile ? `Ask about ${attachedFile.name}...` : "Ask ZYREN AI Tutor..."}
              value={inputText}
              rows={Math.min(3, Math.max(1, inputText.split('\n').length))}
              onChange={(e) => setInputText(e.target.value)}
              onPaste={handleQuickPaste}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  if (e.shiftKey || e.ctrlKey) {
                    return;
                  } else {
                    e.preventDefault();
                    sendPrompt();
                  }
                }
              }}
              style={{
                padding: '6px 9px',
                backgroundColor: 'rgba(0, 0, 0, 0.5)',
                color: '#FFF',
                border: '1px solid rgba(255, 255, 255, 0.15)',
                borderRadius: 7,
                fontSize: 12,
                outline: 'none',
                width: 175,
                minHeight: 30,
                maxHeight: 70,
                resize: 'none',
                lineHeight: 1.35,
                fontFamily: "'Inter', sans-serif",
                overscrollBehavior: 'contain',
              }}
            />
            <button
              type="submit"
              disabled={!inputText.trim() && !attachedFile}
              style={{
                padding: '6px 10px',
                backgroundColor: (inputText.trim() || attachedFile) ? '#4ECDC4' : 'rgba(255, 255, 255, 0.08)',
                color: (inputText.trim() || attachedFile) ? '#121222' : '#666',
                border: 'none',
                borderRadius: 7,
                fontWeight: 700,
                fontSize: 11,
                cursor: (inputText.trim() || attachedFile) ? 'pointer' : 'default',
              }}
            >
              Send
            </button>
          </form>
        </div>

        {/* ── Island 2: Canvas Creation & Annotation Tools Dock ── */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 4,
            backgroundColor: 'rgba(255, 255, 255, 0.03)',
            padding: '4px 6px',
            borderRadius: 10,
            border: '1px solid rgba(255, 255, 255, 0.08)',
          }}
        >
          {/* Undo */}
          <button
            onClick={handleUndo}
            title="Undo Last Action (Ctrl+Z) — Undoes Pen, Text, and AI Drawings"
            style={{
              padding: '7px 9px',
              fontSize: 13,
              fontWeight: 600,
              backgroundColor: 'rgba(255, 255, 255, 0.07)',
              color: '#FFF',
              border: '1px solid rgba(255, 255, 255, 0.12)',
              borderRadius: 7,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <span>↩️</span>
          </button>

          {/* Redo */}
          <button
            onClick={handleRedo}
            title="Redo Last Undone Action (Ctrl+Y)"
            style={{
              padding: '7px 9px',
              fontSize: 13,
              fontWeight: 600,
              backgroundColor: 'rgba(255, 255, 255, 0.07)',
              color: '#FFF',
              border: '1px solid rgba(255, 255, 255, 0.12)',
              borderRadius: 7,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <span>↪️</span>
          </button>

          <div style={{ width: 1, height: 20, backgroundColor: 'rgba(255, 255, 255, 0.12)', margin: '0 1px' }} />

          {/* User Tools (Pointer, Pen, Text, Eraser) */}
          <button
            onClick={() => setToolMode('pointer')}
            title="Pointer Tool"
            style={{
              padding: '7px 9px',
              fontSize: 12,
              fontWeight: 600,
              backgroundColor: toolMode === 'pointer' ? 'rgba(78, 205, 196, 0.22)' : 'rgba(255, 255, 255, 0.07)',
              color: toolMode === 'pointer' ? '#4ECDC4' : '#FFF',
              border: toolMode === 'pointer' ? '1px solid #4ECDC4' : '1px solid rgba(255, 255, 255, 0.12)',
              borderRadius: 7,
              cursor: 'pointer',
            }}
          >
            🖱️
          </button>
          
          <button
            onClick={() => setToolMode('pen')}
            title="Pen Tool (Draw Handwriting)"
            style={{
              padding: '7px 9px',
              fontSize: 12,
              fontWeight: 600,
              backgroundColor: toolMode === 'pen' ? 'rgba(78, 205, 196, 0.22)' : 'rgba(255, 255, 255, 0.07)',
              color: toolMode === 'pen' ? '#4ECDC4' : '#FFF',
              border: toolMode === 'pen' ? '1px solid #4ECDC4' : '1px solid rgba(255, 255, 255, 0.12)',
              borderRadius: 7,
              cursor: 'pointer',
            }}
          >
            🖍️
          </button>
          
          <button
            onClick={() => setToolMode('text')}
            title="Text Tool (Type Normal Text)"
            style={{
              padding: '7px 9px',
              fontSize: 12,
              fontWeight: 600,
              backgroundColor: toolMode === 'text' ? 'rgba(78, 205, 196, 0.22)' : 'rgba(255, 255, 255, 0.07)',
              color: toolMode === 'text' ? '#4ECDC4' : '#FFF',
              border: toolMode === 'text' ? '1px solid #4ECDC4' : '1px solid rgba(255, 255, 255, 0.12)',
              borderRadius: 7,
              cursor: 'pointer',
            }}
          >
            🔤
          </button>
          
          <button
            onClick={() => setToolMode('eraser')}
            title="Eraser Tool"
            style={{
              padding: '7px 9px',
              fontSize: 12,
              fontWeight: 600,
              backgroundColor: toolMode === 'eraser' ? 'rgba(255, 107, 107, 0.22)' : 'rgba(255, 255, 255, 0.07)',
              color: toolMode === 'eraser' ? '#FF6B6B' : '#FFF',
              border: toolMode === 'eraser' ? '1px solid #FF6B6B' : '1px solid rgba(255, 255, 255, 0.12)',
              borderRadius: 7,
              cursor: 'pointer',
            }}
          >
            🧽
          </button>

          {/* Insert Image / Video onto Active Slide */}
          <input
            type="file"
            ref={slideMediaInputRef}
            onChange={handleSlideMediaInputChange}
            accept="image/*,video/*"
            multiple
            style={{ display: 'none' }}
          />
          <button
            onClick={() => slideMediaInputRef.current?.click()}
            title="Insert Image or Video onto Active Slide (or Drag & Drop / Ctrl+V onto Whiteboard)"
            style={{
              padding: '7px 10px',
              fontSize: 11,
              fontWeight: 600,
              backgroundColor: 'rgba(78, 205, 196, 0.16)',
              color: '#4ECDC4',
              border: '1px solid rgba(78, 205, 196, 0.45)',
              borderRadius: 7,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 4,
            }}
          >
            <span>🖼️🎬</span>
            <span>Media</span>
          </button>

          {/* Clear Slide */}
          <button
            onClick={() => {
              const engine = engineRef.current;
              if (engine) engine.clear();
              setPages((prev) =>
                prev.map((p, idx) =>
                  idx === activePageIndexRef.current
                    ? { ...p, title: `Slide ${p.pageNumber}`, shapes: [], handwriting: [], userPaths: [], userTexts: [] }
                    : p
                )
              );
            }}
            title="Clear all drawings, text, and formulas on active slide"
            style={{
              padding: '7px 9px',
              fontSize: 13,
              fontWeight: 600,
              backgroundColor: 'rgba(255, 107, 107, 0.18)',
              color: '#FF6B6B',
              border: '1px solid rgba(255, 107, 107, 0.35)',
              borderRadius: 7,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <span>🧹</span>
          </button>
        </div>

        {/* ── Island 3: Vision Feeds (Screen Share, Webcam, Split-View) ── */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 4,
            backgroundColor: 'rgba(255, 255, 255, 0.03)',
            padding: '4px 6px',
            borderRadius: 10,
            border: '1px solid rgba(255, 255, 255, 0.08)',
          }}
        >
          {/* Screen Share */}
          <button
            onClick={handleToggleScreenShare}
            title={isScreenSharing ? 'Stop Screen Sharing' : 'Share Screen with ZYREN AI Tutor'}
            style={{
              padding: '7px 9px',
              fontSize: 13,
              fontWeight: 600,
              backgroundColor: isScreenSharing ? 'rgba(255, 107, 107, 0.25)' : 'rgba(255, 255, 255, 0.07)',
              color: isScreenSharing ? '#FF6B6B' : '#FFF',
              border: isScreenSharing ? '1px solid #FF6B6B' : '1px solid rgba(255, 255, 255, 0.12)',
              borderRadius: 7,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <span>{isScreenSharing ? '⏹️' : '🖥️'}</span>
          </button>

          {/* Webcam */}
          <button
            onClick={handleToggleWebcam}
            title={isWebcamActive ? 'Turn Off Webcam' : 'Enable Webcam for AI Vision'}
            style={{
              padding: '7px 9px',
              fontSize: 13,
              fontWeight: 600,
              backgroundColor: isWebcamActive ? 'rgba(78, 205, 196, 0.25)' : 'rgba(255, 255, 255, 0.07)',
              color: isWebcamActive ? '#4ECDC4' : '#FFF',
              border: isWebcamActive ? '1px solid #4ECDC4' : '1px solid rgba(255, 255, 255, 0.12)',
              borderRadius: 7,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <span>📷</span>
          </button>

          {/* Split-View */}
          <button
            onClick={() => {
              const nextState = !isSplitViewEnabled;
              setIsSplitViewEnabled(nextState);
              setSaveToast(
                nextState
                  ? '⚡ Split-View Active: AI sees Whiteboard + Screen + Webcam in Parallel!'
                  : '🎯 Focus Mode Active: AI focuses on single active source'
              );
              setTimeout(() => setSaveToast(null), 3000);
            }}
            title="Toggle Split-View (Parallel Vision for Whiteboard + Screen + Webcam)"
            style={{
              padding: '7px 9px',
              fontSize: 11,
              fontWeight: 600,
              backgroundColor: isSplitViewEnabled ? 'rgba(168, 85, 247, 0.28)' : 'rgba(255, 255, 255, 0.07)',
              color: isSplitViewEnabled ? '#D8B4FE' : '#FFF',
              border: isSplitViewEnabled ? '1px solid #A855F7' : '1px solid rgba(255, 255, 255, 0.12)',
              borderRadius: 7,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 4,
            }}
          >
            <span>🔀</span>
            <span>{isSplitViewEnabled ? 'Split ON' : 'Split'}</span>
          </button>
        </div>

        {/* ── Island 4: AI Tutor Studio & Model Controls ── */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 4,
            backgroundColor: 'rgba(255, 255, 255, 0.03)',
            padding: '4px 6px',
            borderRadius: 10,
            border: '1px solid rgba(255, 255, 255, 0.08)',
          }}
        >
          {/* Voice Selector */}
          <button
            onClick={() => setIsVoiceModalOpen(true)}
            title="Choose from 30 Gemini Live Voice Personas"
            style={{
              padding: '7px 10px',
              fontSize: 11,
              fontWeight: 600,
              backgroundColor: 'rgba(78, 205, 196, 0.15)',
              color: '#4ECDC4',
              border: '1px solid rgba(78, 205, 196, 0.35)',
              borderRadius: 7,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 4,
            }}
          >
            <span>🎙️</span>
            <span>{activeVoiceObj.name}</span>
          </button>

          {/* Model & Thinking Level Selector */}
          <button
            onClick={() => setIsModelModalOpen(true)}
            title={`Active Gemini Model: ${activeModelObj.name} (${activeModelObj.badge})${activeModelObj.supportedThinkingLevels.length > 0 ? ` • Thinking: ${(currentThinkingLevel || 'high').toUpperCase()}` : ''}`}
            style={{
              padding: '7px 10px',
              fontSize: 11,
              fontWeight: 600,
              backgroundColor: 'rgba(168, 85, 247, 0.15)',
              color: '#C084FC',
              border: '1px solid rgba(168, 85, 247, 0.35)',
              borderRadius: 7,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 5,
              transition: 'all 0.15s ease',
            }}
          >
            <span>{activeModelObj.icon}</span>
            <span>{activeModelObj.name}</span>
            {activeModelObj.supportedThinkingLevels.length > 0 && (
              <span
                style={{
                  fontSize: 9,
                  backgroundColor: 'rgba(168, 85, 247, 0.35)',
                  padding: '1px 5px',
                  borderRadius: 4,
                  fontWeight: 700,
                  textTransform: 'uppercase',
                  color: '#FFFFFF',
                }}
              >
                {currentThinkingLevel || 'high'}
              </span>
            )}
          </button>

          {/* Speaking Style, Vocal Tone & Persona Studio Selector */}
          <button
            onClick={() => setIsPersonaModalOpen(true)}
            title={`Speaking Style & Persona: ${
              VERBOSITY_OPTIONS.find((v) => v.id === verbosity)?.name || verbosity
            } • Tutor: ${tutorName || 'Zyren'} ${learnerName ? `• Student: ${learnerName}` : '• Click to set names'} (Click to customize live)`}
            style={{
              padding: '7px 10px',
              fontSize: 11,
              fontWeight: 600,
              backgroundColor: 'rgba(56, 239, 125, 0.14)',
              color: '#38EF7D',
              border: '1px solid rgba(56, 239, 125, 0.35)',
              borderRadius: 7,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              transition: 'all 0.15s ease',
            }}
          >
            <span>🎭</span>
            <span>
              {learnerName
                ? `${learnerName} (${tutorName || 'Zyren'})`
                : `${tutorName || 'Zyren'} • Name 👤`}
            </span>
          </button>

          {/* Multilingual & Spoken Language Selector */}
          <button
            onClick={() => setIsLanguageModalOpen(true)}
            title={
              languageConfig.autoDetect
                ? 'Spoken Language: Real-Time Auto-Detect Mode (Click to configure)'
                : `Spoken Language: Primary ${
                    SUPPORTED_LANGUAGES.find((l) => l.code === languageConfig.primary)?.name || languageConfig.primary
                  } • ${languageConfig.secondary?.length || 0} Secondary (Click to configure)`
            }
            style={{
              padding: '7px 10px',
              fontSize: 11,
              fontWeight: 600,
              backgroundColor: languageConfig.autoDetect ? 'rgba(168, 85, 247, 0.14)' : 'rgba(78, 205, 196, 0.14)',
              color: languageConfig.autoDetect ? '#C084FC' : '#4ECDC4',
              border: `1px solid ${languageConfig.autoDetect ? 'rgba(168, 85, 247, 0.35)' : 'rgba(78, 205, 196, 0.35)'}`,
              borderRadius: 7,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              transition: 'all 0.15s ease',
            }}
          >
            <span>🌐</span>
            <span>
              {languageConfig.autoDetect
                ? 'Auto'
                : `${languageConfig.primary.split('-')[0].toUpperCase()}${
                    languageConfig.secondary && languageConfig.secondary.length > 0
                      ? ` +${languageConfig.secondary.length}`
                      : ''
                  }`}
            </span>
          </button>

          {/* Writing Style Selector Custom Popup */}
          <div ref={styleMenuRef} style={{ position: 'relative' }}>
            <button
              onClick={() => setIsStyleMenuOpen(!isStyleMenuOpen)}
              title={`AI Writing Style: ${WRITING_STYLES.find((s) => s.id === currentStyle)?.label || currentStyle} (Click to change)`}
              style={{
                padding: '7px 9px',
                fontSize: 11,
                fontWeight: 600,
                backgroundColor: 'rgba(255, 171, 0, 0.15)',
                color: '#FFAB00',
                border: '1px solid rgba(255, 171, 0, 0.35)',
                borderRadius: 7,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 4,
                transition: 'all 0.15s ease',
              }}
            >
              <span>{WRITING_STYLES.find((s) => s.id === currentStyle)?.icon || '✒️'}</span>
              <span>{WRITING_STYLES.find((s) => s.id === currentStyle)?.short || 'Mixed'}</span>
              <span style={{ fontSize: 8, opacity: 0.7 }}>{isStyleMenuOpen ? '▲' : '▼'}</span>
            </button>

            {isStyleMenuOpen && (
              <div
                className="no-zoom interactive"
                onPointerDown={(e) => e.stopPropagation()}
                onMouseDown={(e) => e.stopPropagation()}
                onWheel={(e) => e.stopPropagation()}
                style={{
                  position: 'absolute',
                  bottom: 'calc(100% + 8px)',
                  left: '50%',
                  transform: 'translateX(-50%)',
                  backgroundColor: '#16162a',
                  border: '1px solid rgba(255, 171, 0, 0.4)',
                  borderRadius: 10,
                  boxShadow: '0 8px 32px rgba(0, 0, 0, 0.6), 0 0 16px rgba(255, 171, 0, 0.15)',
                  padding: 4,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 2,
                  zIndex: 100,
                  minWidth: 160,
                }}
              >
                {WRITING_STYLES.map((style) => {
                  const isSelected = currentStyle === style.id;
                  return (
                    <button
                      key={style.id}
                      onClick={() => {
                        onSelectStyle?.(style.id);
                        setIsStyleMenuOpen(false);
                        if (room && room.state === 'connected') {
                          try {
                            room.localParticipant.setMetadata(
                              JSON.stringify({
                                voice: currentVoice,
                                style: style.id,
                                model: currentModel,
                                thinkingLevel: currentThinkingLevel,
                                verbosity,
                                vocalTone,
                                learnerProfile,
        languageConfig,
                              })
                            );
                            const payload = JSON.stringify({
                              type: 'change_writing_style',
                              style: style.id,
                            });
                            const encoder = new TextEncoder();
                            room.localParticipant.publishData(encoder.encode(payload), { reliable: true });
                          } catch (err) {
                            console.error('>>> [FRONTEND] Failed to publish change_writing_style:', err);
                          }
                        }
                      }}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8,
                        padding: '8px 12px',
                        borderRadius: 6,
                        border: 'none',
                        backgroundColor: isSelected ? 'rgba(255, 171, 0, 0.2)' : 'transparent',
                        color: isSelected ? '#FFAB00' : '#E0E0E0',
                        fontWeight: isSelected ? 700 : 500,
                        fontSize: 12,
                        cursor: 'pointer',
                        textAlign: 'left',
                        fontFamily: "'Inter', sans-serif",
                        transition: 'background-color 0.12s ease',
                      }}
                      onMouseEnter={(e) => {
                        if (!isSelected) e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.08)';
                      }}
                      onMouseLeave={(e) => {
                        if (!isSelected) e.currentTarget.style.backgroundColor = 'transparent';
                      }}
                    >
                      <span style={{ fontSize: 14 }}>{style.icon}</span>
                      <span>{style.label}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Gemini API Key Settings */}
          <button
            onClick={() => setIsApiKeyModalOpen(true)}
            title={
              apiKeyStatus?.configured
                ? `Gemini API Key Configured (${apiKeyStatus.maskedKey || 'Active'}) — Click to Test, Change, or Delete`
                : 'Configure Gemini API Key'
            }
            style={{
              padding: '7px 9px',
              fontSize: 11,
              fontWeight: 600,
              backgroundColor: apiKeyStatus?.configured
                ? 'rgba(56, 239, 125, 0.14)'
                : 'rgba(255, 171, 0, 0.2)',
              color: apiKeyStatus?.configured ? '#6EE7B7' : '#FFD54F',
              border: apiKeyStatus?.configured
                ? '1px solid rgba(56, 239, 125, 0.35)'
                : '1px solid rgba(255, 171, 0, 0.45)',
              borderRadius: 7,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 4,
            }}
          >
            <span>🔑</span>
            <span>API Key</span>
          </button>

          {/* Reset AI Memory / Context */}
          <button
            onClick={handleResetAIMemory}
            title="Reset AI Memory (Start New Conversation with Fresh Context)"
            style={{
              padding: '7px 9px',
              fontSize: 12,
              fontWeight: 600,
              backgroundColor: 'rgba(255, 107, 107, 0.16)',
              color: '#FF6B6B',
              border: '1px solid rgba(255, 107, 107, 0.35)',
              borderRadius: 7,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              transition: 'all 0.15s ease',
            }}
          >
            <span>🔄</span>
          </button>

          {/* Diagnostics */}
          <button
            onClick={toggleDebugOverlay}
            title="Toggle Diagnostics Overlay"
            style={{
              padding: '7px 9px',
              fontSize: 12,
              fontWeight: 500,
              backgroundColor: showDebugOverlay ? 'rgba(255, 255, 255, 0.2)' : 'rgba(255, 255, 255, 0.07)',
              color: '#aaa',
              border: '1px solid rgba(255, 255, 255, 0.12)',
              borderRadius: 7,
              cursor: 'pointer',
            }}
          >
            📊
          </button>
        </div>

        {/* ── Island 5: Zoom & Live Auto-Follow Controls Dock ── */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 4,
            backgroundColor: 'rgba(255, 255, 255, 0.03)',
            padding: '4px 6px',
            borderRadius: 10,
            border: '1px solid rgba(255, 255, 255, 0.08)',
          }}
        >
          <button
            onClick={zoomOut}
            title="Zoom Out"
            style={{
              width: 28,
              height: 28,
              borderRadius: 6,
              border: 'none',
              backgroundColor: 'rgba(255, 255, 255, 0.08)',
              color: '#fff',
              fontSize: 15,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontFamily: 'monospace',
            }}
          >
            -
          </button>

          <span
            style={{
              color: '#4ECDC4',
              fontSize: 11,
              fontWeight: 600,
              minWidth: 38,
              textAlign: 'center',
              fontFamily: 'monospace',
            }}
          >
            {Math.round(transform.zoom * 100)}%
          </span>

          <button
            onClick={zoomIn}
            title="Zoom In"
            style={{
              width: 28,
              height: 28,
              borderRadius: 6,
              border: 'none',
              backgroundColor: 'rgba(255, 255, 255, 0.08)',
              color: '#fff',
              fontSize: 15,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontFamily: 'monospace',
            }}
          >
            +
          </button>

          <button
            onClick={resetZoom}
            title="Reset View to Fit Whiteboard"
            style={{
              padding: '0 8px',
              height: 28,
              borderRadius: 6,
              border: 'none',
              backgroundColor: 'rgba(255, 255, 255, 0.08)',
              color: '#ccc',
              fontSize: 11,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              fontFamily: "'Inter', sans-serif",
            }}
          >
            <span>🖼️</span>
            <span>Fit</span>
          </button>

          {/* Toggle Live Writing Adaptive Auto-Resize */}
          <button
            onClick={toggleAutoResize}
            title={
              isAutoResizeEnabled
                ? 'Adaptive Auto-Resize is ON: Automatically zooms and frames diagrams & notes comfortably (Click to turn OFF)'
                : 'Adaptive Auto-Resize is OFF: Camera follows writing with fixed zoom level (Click to turn ON)'
            }
            style={{
              padding: '0 9px',
              height: 28,
              borderRadius: 6,
              border: isAutoResizeEnabled
                ? '1px solid rgba(96, 165, 250, 0.55)'
                : '1px solid rgba(255, 255, 255, 0.14)',
              backgroundColor: isAutoResizeEnabled
                ? 'rgba(96, 165, 250, 0.22)'
                : 'rgba(255, 255, 255, 0.06)',
              color: isAutoResizeEnabled ? '#60A5FA' : '#94A3B8',
              fontSize: 11,
              fontWeight: 700,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              fontFamily: "'Inter', sans-serif",
              transition: 'all 0.15s ease',
            }}
          >
            <span>📐</span>
            <span>{isAutoResizeEnabled ? 'Auto-Fit ON' : 'Auto-Fit OFF'}</span>
          </button>

          {/* Toggle Live Writing Auto-Follow Camera */}
          <button
            onClick={toggleAutoFollow}
            title={
              isAutoFollowEnabled
                ? 'Live Writing Auto-Follow is ON: Camera smoothly follows AI writing when zoomed in (Click to turn OFF)'
                : 'Live Writing Auto-Follow is OFF: Camera stays fixed where you place it (Click to turn ON)'
            }
            style={{
              padding: '0 9px',
              height: 28,
              borderRadius: 6,
              border: isAutoFollowEnabled
                ? '1px solid rgba(78, 205, 196, 0.55)'
                : '1px solid rgba(255, 255, 255, 0.14)',
              backgroundColor: isAutoFollowEnabled
                ? 'rgba(78, 205, 196, 0.22)'
                : 'rgba(255, 255, 255, 0.06)',
              color: isAutoFollowEnabled ? '#4ECDC4' : '#94A3B8',
              fontSize: 11,
              fontWeight: 700,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              fontFamily: "'Inter', sans-serif",
              transition: 'all 0.15s ease',
            }}
          >
            <span>🎯</span>
            <span>{isAutoFollowEnabled ? 'Follow ON' : 'Follow OFF'}</span>
          </button>
        </div>
      </div>

      {/* ── Floating Draggable PiP Windows for Webcam & Screen Sharing ── */}
      {isWebcamActive && webcamStreamRef.current && (
        <FloatingVideoPiP
          id="webcam-pip"
          title="Webcam Live"
          icon="📷"
          stream={webcamStreamRef.current}
          initialX={24}
          initialY={100}
          onClose={handleToggleWebcam}
        />
      )}

      {isScreenSharing && screenStreamRef.current && (
        <FloatingVideoPiP
          id="screen-pip"
          title="Screen Share Live"
          icon="🖥️"
          stream={screenStreamRef.current}
          initialX={typeof window !== 'undefined' ? window.innerWidth - 320 : 800}
          initialY={100}
          onClose={handleToggleScreenShare}
        />
      )}

      {/* ── Collapsible AI Chat Drawer & Real-time Transcripts ── */}
      <ChatDrawer
        isOpen={isChatDrawerOpen}
        onClose={() => setIsChatDrawerOpen(false)}
        messages={chatMessages}
        onSendMessage={handleSendMessage}
        onClearChat={() => setChatMessages([])}
        onResetAIMemory={handleResetAIMemory}
        isMicActive={isMicrophoneEnabled}
        isSpeakerMuted={isSpeakerMuted}
        onToggleSpeakerMute={toggleSpeakerMute}
      />

      {/* Multi-Board Slide Deck Panel */}
      <SlidePanel
        pages={pages}
        activePageIndex={activePageIndex}
        isOpen={isSlidePanelOpen}
        onToggleOpen={() => setIsSlidePanelOpen(!isSlidePanelOpen)}
        onSelectPage={switchToPage}
        onAddNewPage={addNewPage}
        onDeletePage={deletePage}
        onRenamePage={handleRenameSlide}
      />

      {/* 30 Gemini Voice Personas Selector Modal */}
      <VoiceSelectorModal
        isOpen={isVoiceModalOpen}
        onClose={() => setIsVoiceModalOpen(false)}
        currentVoice={currentVoice}
        onSelectVoice={(newVoice) => {
          if (onSelectVoice) {
            onSelectVoice(newVoice);
          }
          // Broadcast live change_voice message to agent over room data channel
          if (room && room.state === 'connected') {
            try {
              // Update participant metadata so the reconnected agent reads the new voice
              room.localParticipant.setMetadata(
                JSON.stringify({
                  voice: newVoice,
                  style: currentStyle,
                  model: currentModel,
                  thinkingLevel: currentThinkingLevel,
                  verbosity,
                  vocalTone,
                  learnerProfile,
        languageConfig,
                })
              );
              
              const payload = JSON.stringify({ type: 'change_voice', voice: newVoice });
              const encoder = new TextEncoder();
              room.localParticipant.publishData(encoder.encode(payload), { reliable: true });
              console.log('>>> [FRONTEND] Broadcasted change_voice to agent and updated metadata:', newVoice);
            } catch (err) {
              console.error('>>> [FRONTEND] Failed to publish change_voice:', err);
            }
          }
          const chosen = ALL_GEMINI_VOICES.find((v) => v.id === newVoice);
          setSaveToast(`🎙️ Voice switched to ${chosen?.name || newVoice} (${chosen?.tone || ''})`);
          setTimeout(() => setSaveToast(null), 3500);
        }}
      />

      {/* Gemini Live Model & Thinking Level Selector Modal */}
      <ModelSelectorModal
        isOpen={isModelModalOpen}
        onClose={() => setIsModelModalOpen(false)}
        currentModel={currentModel}
        currentThinkingLevel={currentThinkingLevel}
        onSelectModel={(newModel, newThinkingLevel) => {
          if (onSelectModel) {
            onSelectModel(newModel, newThinkingLevel);
          }
          if (newThinkingLevel && onSelectThinkingLevel) {
            onSelectThinkingLevel(newThinkingLevel);
          }
          // Broadcast live change_model message to agent over room data channel
          if (room && room.state === 'connected') {
            try {
              room.localParticipant.setMetadata(
                JSON.stringify({
                  voice: currentVoice,
                  style: currentStyle,
                  model: newModel,
                  thinkingLevel: newThinkingLevel || 'high',
                  verbosity,
                  vocalTone,
                  learnerProfile,
        languageConfig,
                })
              );

              const payload = JSON.stringify({
                type: 'change_model',
                model: newModel,
                thinking_level: newThinkingLevel || 'high',
              });
              const encoder = new TextEncoder();
              room.localParticipant.publishData(encoder.encode(payload), { reliable: true });
              console.log('>>> [FRONTEND] Broadcasted change_model to agent and updated metadata:', newModel, newThinkingLevel);
            } catch (err) {
              console.error('>>> [FRONTEND] Failed to publish change_model:', err);
            }
          }
          const chosen = SUPPORTED_MODELS.find((m) => m.id === newModel);
          const lvlText = newThinkingLevel ? ` (${newThinkingLevel.toUpperCase()})` : '';
          setSaveToast(`🤖 Model switched to ${chosen?.name || newModel}${lvlText} - History Preserved`);
          setTimeout(() => setSaveToast(null), 3500);
        }}
      />

      {/* Live Speaking Style, Vocal Tone & Persona Studio Modal */}
      <PersonaSelectorModal
        isOpen={isPersonaModalOpen}
        onClose={() => setIsPersonaModalOpen(false)}
        verbosity={verbosity}
        vocalTone={vocalTone}
        learnerProfile={learnerProfile}
        learnerName={learnerName}
        tutorName={tutorName}
        onUpdateSpeakingStyle={(next) => {
          onUpdateSpeakingStyle?.(next);
          if (room && room.state === 'connected') {
            try {
              const cleanLearnerName = (next.learnerName || '').trim();
              const cleanTutorName = (next.tutorName || tutorName || 'Zyren').trim() || 'Zyren';
              room.localParticipant.setMetadata(
                JSON.stringify({
                  voice: currentVoice,
                  style: currentStyle,
                  model: currentModel,
                  thinkingLevel: currentThinkingLevel,
                  verbosity: next.verbosity,
                  vocalTone: next.vocalTone,
                  learnerProfile: next.learnerProfile,
                  learnerName: cleanLearnerName,
                  tutorName: cleanTutorName,
                })
              );

              const payload = JSON.stringify({
                type: 'change_speaking_style',
                verbosity: next.verbosity,
                vocalTone: next.vocalTone,
                learnerProfile: next.learnerProfile,
                learnerName: cleanLearnerName,
                tutorName: cleanTutorName,
                style: currentStyle,
              });
              const encoder = new TextEncoder();
              room.localParticipant.publishData(encoder.encode(payload), { reliable: true });
              console.log('>>> [FRONTEND] Broadcasted change_speaking_style live to agent:', next);
            } catch (err) {
              console.error('>>> [FRONTEND] Failed to publish change_speaking_style:', err);
            }
          }
          const vLabel = VERBOSITY_OPTIONS.find((v) => v.id === next.verbosity)?.shortLabel || next.verbosity;
          const tLabel = VOCAL_TONE_OPTIONS.find((t) => t.id === next.vocalTone)?.shortLabel || next.vocalTone;
          const pLabel = LEARNER_PROFILE_OPTIONS.find((p) => p.id === next.learnerProfile)?.shortLabel || next.learnerProfile;
          setSaveToast(`🎭 Live Style Synced: ${vLabel} • ${tLabel} • ${pLabel}`);
          setTimeout(() => setSaveToast(null), 3000);
        }}
      />

      {/* Multilingual & Spoken Language Configuration Modal */}
      <LanguageSelectorModal
        isOpen={isLanguageModalOpen}
        onClose={() => setIsLanguageModalOpen(false)}
        config={languageConfig}
        onSaveConfig={(nextConfig) => {
          onUpdateLanguageConfig?.(nextConfig);
          if (room && room.state === 'connected') {
            try {
              room.localParticipant.setMetadata(
                JSON.stringify({
                  voice: currentVoice,
                  style: currentStyle,
                  model: currentModel,
                  thinkingLevel: currentThinkingLevel,
                  verbosity,
                  vocalTone,
                  learnerProfile,
                  languageConfig: nextConfig,
                })
              );

              const payload = JSON.stringify({
                type: 'change_language_config',
                languageConfig: nextConfig,
              });
              const encoder = new TextEncoder();
              room.localParticipant.publishData(encoder.encode(payload), { reliable: true });
              console.log('>>> [FRONTEND] Broadcasted change_language_config live to agent:', nextConfig);
            } catch (err) {
              console.error('>>> [FRONTEND] Failed to publish change_language_config:', err);
            }
          }
          const toastMsg = nextConfig.autoDetect
            ? '🌐 Language Mode: Auto-Detect Active'
            : `🌐 Language Updated: ${
                SUPPORTED_LANGUAGES.find((l) => l.code === nextConfig.primary)?.name || nextConfig.primary
              } (${nextConfig.secondary?.length || 0} Secondary)`;
          setSaveToast(toastMsg);
          setTimeout(() => setSaveToast(null), 3000);
        }}
      />

      {/* In-App Gemini API Key Management Modal (Test, Change, Delete) */}
      <ApiKeyManagerModal
        isOpen={isApiKeyModalOpen}
        onClose={() => setIsApiKeyModalOpen(false)}
        keyStatus={apiKeyStatus}
        onKeyUpdated={(nextStatus) => {
          onApiKeyUpdated?.(nextStatus);
          if (room && room.state === 'connected') {
            try {
              const payload = JSON.stringify({
                type: 'update_api_key',
                timestamp: Date.now(),
              });
              const encoder = new TextEncoder();
              room.localParticipant.publishData(encoder.encode(payload), { reliable: true });
            } catch (err) {
              console.error('>>> [FRONTEND] Failed to publish update_api_key:', err);
            }
          }
          showToast('🔑 Gemini API Key verified & synced live!');
        }}
        onKeyDeleted={() => {
          if (room && room.state === 'connected') {
            try {
              room.disconnect();
            } catch {
              // ignore
            }
          }
          onApiKeyDeleted?.();
        }}
      />
    </div>
  );
}
