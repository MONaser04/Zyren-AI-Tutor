/**
 * SlideMediaOverlay — Interactive In-Slide Images & Videos Layer (1920x1080 Virtual Stage).
 *
 * Capabilities:
 * - Renders high-resolution images and HTML5 videos directly inside whiteboard slides
 * - Smooth zoom-aware dragging & 4-corner aspect-ratio resizing on the 1920x1080 stage
 * - Pass-through pointer mode when user selects Pen / Text / Eraser so annotations can be drawn directly ON TOP of media
 * - Built-in video player controls: Play/Pause, timeline scrubbing, -5s/+5s, frame-step, playback speed, volume/mute
 * - Real-time AI Perception hooks:
 *   1. `drawMediaToCanvas(ctx)` paints live decoded `<img />` and `<video />` frames + timestamp overlay for 1 FPS Gemini Live Vision
 *   2. WebAudio 16kHz PCM tap (`onVideoAudioChunk`) streams the playing video's audio track directly to Gemini Live API when enabled
 */
import React, {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react';

export interface SlideMediaItem {
  id: string;
  mediaId: string;
  mediaType: 'image' | 'video';
  url: string;
  fileName: string;
  mimeType: string;
  x: number;
  y: number;
  width: number;
  height: number;
  naturalWidth?: number;
  naturalHeight?: number;
  durationSec?: number;
  posterDataUrl?: string;
  shareAudioWithAI?: boolean;
}

export interface SlideMediaRuntimeState {
  id: string;
  mediaId: string;
  mediaType: 'image' | 'video';
  fileName: string;
  mimeType: string;
  url: string;
  x: number;
  y: number;
  width: number;
  height: number;
  durationSec: number;
  currentTimeSec: number;
  isPlaying: boolean;
  shareAudioWithAI: boolean;
}

export interface VideoControlCommand {
  action:
    | 'play'
    | 'pause'
    | 'toggle_play'
    | 'volume_up'
    | 'volume_down'
    | 'set_volume'
    | 'mute'
    | 'unmute'
    | 'set_speed'
    | 'seek_relative'
    | 'seek_to'
    | 'enable_subtitles'
    | 'disable_subtitles'
    | 'set_subtitle_language'
    | 'set_audio_language'
    | 'set_quality'
    | 'maximize'
    | 'minimize'
    | 'resize'
    | 'fullscreen';
  video_id?: string;
  volume?: number; // 0 to 100
  speed?: number; // e.g. 0.25 to 2.0
  time_sec?: number; // seconds to seek or delta
  language?: string; // language code e.g. 'ar', 'en', 'es', 'de'
  quality?: string; // 'hd1080', 'hd720', 'medium', 'auto'
  width?: number;
  height?: number;
}

export interface SlideMediaOverlayHandle {
  addMedia(item: Omit<SlideMediaItem, 'id'> & { id?: string }): string;
  updateMediaGeometry(id: string, x: number, y: number, width?: number, height?: number): void;
  removeMedia(id: string): void;
  clear(): void;
  getItems(): SlideMediaItem[];
  setItems(items: SlideMediaItem[]): void;
  getRuntimeStates(): SlideMediaRuntimeState[];
  hasPlayingVideo(): boolean;
  drawMediaToCanvas(ctx: CanvasRenderingContext2D): void;
  controlMedia(
    mediaIdOrSelector: string | undefined,
    command: VideoControlCommand
  ): { success: boolean; message: string; targetId?: string };
}

export interface SlideMediaOverlayProps {
  zoom: number;
  toolMode: 'pointer' | 'pan' | 'pen' | 'text' | 'eraser';
  onUpdateGeometry?: (id: string, x: number, y: number, width: number, height: number) => void;
  onRemoveMedia?: (id: string) => void;
  onMediaVisualFrameChanged?: (reason: string) => void;
  onVideoAudioChunk?: (base64Pcm16k: string) => void;
}

interface PlaybackTelemetry {
  currentTimeSec: number;
  durationSec: number;
  isPlaying: boolean;
  shareAudioWithAI: boolean;
}

// WeakMap ensures createMediaElementSource is NEVER called twice on the same HTMLVideoElement
interface VideoAudioGraph {
  ctx: AudioContext;
  source: MediaElementAudioSourceNode;
  processor: ScriptProcessorNode;
}
const videoAudioGraphMap = new WeakMap<HTMLVideoElement, VideoAudioGraph>();

export function extractYouTubeId(url?: string): string | null {
  if (!url) return null;
  const match = url.match(/(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
  if (match) return match[1];
  if (/^[a-zA-Z0-9_-]{11}$/.test(url.trim())) return url.trim();
  return null;
}

function formatTimestamp(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return '00:00';
  const total = Math.floor(sec);
  const hrs = Math.floor(total / 3600);
  const mins = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  if (hrs > 0) {
    return `${hrs}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

function downsampleTo16kHzInt16Base64(input: Float32Array, inputSampleRate: number): string | null {
  if (!input || input.length === 0) return null;
  // Skip completely silent buffers to save bandwidth & prevent VAD false positives
  let sumSq = 0;
  for (let i = 0; i < input.length; i += 4) {
    sumSq += input[i] * input[i];
  }
  const rms = Math.sqrt(sumSq / Math.max(1, Math.ceil(input.length / 4)));
  if (rms < 0.0015) return null;

  const targetRate = 16000;
  const ratio = inputSampleRate / targetRate;
  const outLength = Math.max(1, Math.floor(input.length / ratio));
  const pcm16 = new Int16Array(outLength);

  for (let i = 0; i < outLength; i++) {
    const startIdx = Math.floor(i * ratio);
    const endIdx = Math.min(input.length, Math.ceil((i + 1) * ratio));
    let acc = 0;
    let count = 0;
    for (let j = startIdx; j < endIdx; j++) {
      acc += input[j];
      count++;
    }
    const sample = count > 0 ? acc / count : input[Math.min(input.length - 1, startIdx)];
    const clamped = Math.max(-1, Math.min(1, sample));
    pcm16[i] = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
  }

  const bytes = new Uint8Array(pcm16.buffer);
  let binary = '';
  const chunkStep = 8192;
  for (let i = 0; i < bytes.length; i += chunkStep) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkStep));
  }
  return btoa(binary);
}

interface MediaCardProps {
  item: SlideMediaItem;
  zoom: number;
  isSelected: boolean;
  isAnnotationPassThrough: boolean;
  onSelect: (id: string) => void;
  onCommitGeometry: (id: string, x: number, y: number, width: number, height: number) => void;
  onRemove: (id: string) => void;
  onRegisterElement: (id: string, el: HTMLImageElement | HTMLVideoElement | null) => void;
  onRegisterIframe?: (id: string, el: HTMLIFrameElement | null) => void;
  onUpdatePlayback: (id: string, state: PlaybackTelemetry) => void;
  onVisualChange: (reason: string) => void;
  onVideoAudioChunk?: (base64Pcm16k: string) => void;
  onOpenFullScreen: (item: SlideMediaItem) => void;
}

const SlideMediaCard: React.FC<MediaCardProps> = React.memo(function SlideMediaCard({
  item,
  zoom,
  isSelected,
  isAnnotationPassThrough,
  onSelect,
  onCommitGeometry,
  onRemove,
  onRegisterElement,
  onRegisterIframe,
  onUpdatePlayback,
  onVisualChange,
  onVideoAudioChunk,
  onOpenFullScreen,
}) {
  const [box, setBox] = useState({
    x: item.x,
    y: item.y,
    width: item.width,
    height: item.height,
  });
  const [isInteracting, setIsInteracting] = useState(false);
  const [interactionType, setInteractionType] = useState<'drag' | 'resize' | null>(null);
  const [isHovered, setIsHovered] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(item.durationSec || 0);
  const [isMuted, setIsMuted] = useState(false);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [shareAudioWithAI, setShareAudioWithAI] = useState(item.shareAudioWithAI !== false);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const shareAudioRef = useRef(shareAudioWithAI);
  shareAudioRef.current = shareAudioWithAI;
  const onVideoAudioChunkRef = useRef(onVideoAudioChunk);
  onVideoAudioChunkRef.current = onVideoAudioChunk;

  useEffect(() => {
    setBox({
      x: item.x,
      y: item.y,
      width: item.width,
      height: item.height,
    });
  }, [item.x, item.y, item.width, item.height]);

  useEffect(() => {
    onUpdatePlayback(item.id, {
      currentTimeSec: currentTime,
      durationSec: duration,
      isPlaying,
      shareAudioWithAI,
    });
  }, [item.id, currentTime, duration, isPlaying, shareAudioWithAI, onUpdatePlayback]);

  // Attach WebAudio PCM extractor for AI video audio hearing when video plays
  const ensureAudioTapConnected = useCallback(() => {
    const videoEl = videoRef.current;
    if (!videoEl || item.mediaType !== 'video') return;

    let graph = videoAudioGraphMap.get(videoEl);
    if (!graph) {
      try {
        const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
        const ctx: AudioContext = new AudioCtx();
        const source = ctx.createMediaElementSource(videoEl);
        const processor = ctx.createScriptProcessor(4096, 1, 1);

        // Route original full-quality audio to speakers AND parallel tap to processor
        source.connect(ctx.destination);
        source.connect(processor);
        // Connect processor to a zero-gain sink so onaudioprocess fires without double-echo
        const zeroGain = ctx.createGain();
        zeroGain.gain.value = 0;
        processor.connect(zeroGain);
        zeroGain.connect(ctx.destination);

        graph = { ctx, source, processor };
        videoAudioGraphMap.set(videoEl, graph);
      } catch (err) {
        console.warn('[SlideMediaOverlay] Could not initialize WebAudio tap for video:', err);
        return;
      }
    }

    if (graph.ctx.state === 'suspended') {
      graph.ctx.resume().catch(() => {});
    }

    graph.processor.onaudioprocess = (ev: AudioProcessingEvent) => {
      const v = videoRef.current;
      if (!v || v.paused || v.ended || v.muted || !shareAudioRef.current) return;
      const chan = ev.inputBuffer.getChannelData(0);
      const b64 = downsampleTo16kHzInt16Base64(chan, ev.inputBuffer.sampleRate);
      if (b64) {
        onVideoAudioChunkRef.current?.(b64);
      }
    };
  }, [item.mediaType]);

  // Dragging handler
  const startDrag = (e: React.PointerEvent) => {
    if (isAnnotationPassThrough) return;
    if (e.button !== 0) return; // Only primary left-click initiates dragging
    e.stopPropagation();
    e.preventDefault();
    onSelect(item.id);
    setIsInteracting(true);
    setInteractionType('drag');

    const targetEl = e.currentTarget as HTMLElement;
    const pointerId = e.pointerId;
    try {
      targetEl.setPointerCapture(pointerId);
    } catch {
      // Ignore if not supported
    }

    const startClientX = e.clientX;
    const startClientY = e.clientY;
    const origX = box.x;
    const origY = box.y;
    const currW = box.width;
    const currH = box.height;
    const safeZoom = Math.max(0.2, zoom || 1);

    let latestX = origX;
    let latestY = origY;

    const cleanup = () => {
      try {
        if (targetEl.hasPointerCapture(pointerId)) {
          targetEl.releasePointerCapture(pointerId);
        }
      } catch {}
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      window.removeEventListener('mouseup', onUp);
      setIsInteracting(false);
      setInteractionType(null);
    };

    const onMove = (ev: PointerEvent) => {
      // Auto-drop guard: if mouse button was released outside window or dropped, release immediately!
      if (ev.buttons === 0) {
        onUp();
        return;
      }
      const dx = (ev.clientX - startClientX) / safeZoom;
      const dy = (ev.clientY - startClientY) / safeZoom;
      latestX = Math.round(Math.max(10, Math.min(1910 - currW, origX + dx)));
      latestY = Math.round(Math.max(10, Math.min(1070 - currH, origY + dy)));
      setBox((prev) => ({ ...prev, x: latestX, y: latestY }));
    };

    let isEnded = false;
    const onUp = () => {
      if (isEnded) return;
      isEnded = true;
      cleanup();
      onCommitGeometry(item.id, latestX, latestY, currW, currH);
      onVisualChange('media_moved');
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    window.addEventListener('mouseup', onUp);
  };

  // Corner Resize handler
  const startResize = (corner: 'nw' | 'ne' | 'sw' | 'se') => (e: React.PointerEvent) => {
    if (e.button !== 0) return; // Only primary left-click
    e.stopPropagation();
    e.preventDefault();
    onSelect(item.id);
    setIsInteracting(true);
    setInteractionType('resize');

    const targetEl = e.currentTarget as HTMLElement;
    const pointerId = e.pointerId;
    try {
      targetEl.setPointerCapture(pointerId);
    } catch {}

    const startClientX = e.clientX;
    const startClientY = e.clientY;
    const orig = { ...box };
    const aspect = orig.width / Math.max(1, orig.height);
    const safeZoom = Math.max(0.2, zoom || 1);

    let next = { ...orig };

    const cleanup = () => {
      try {
        if (targetEl.hasPointerCapture(pointerId)) {
          targetEl.releasePointerCapture(pointerId);
        }
      } catch {}
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      window.removeEventListener('mouseup', onUp);
      setIsInteracting(false);
      setInteractionType(null);
    };

    const onMove = (ev: PointerEvent) => {
      // Auto-drop guard: if mouse button was released outside window or dropped, release immediately!
      if (ev.buttons === 0) {
        onUp();
        return;
      }
      const dx = (ev.clientX - startClientX) / safeZoom;
      const dy = (ev.clientY - startClientY) / safeZoom;
      const lockAspect = !ev.shiftKey;

      let newW = orig.width;
      let newH = orig.height;
      let newX = orig.x;
      let newY = orig.y;

      if (corner === 'se') {
        newW = Math.max(160, Math.min(1760 - orig.x, orig.width + dx));
        newH = lockAspect ? Math.round(newW / aspect) : Math.max(110, Math.min(1020 - orig.y, orig.height + dy));
      } else if (corner === 'sw') {
        newW = Math.max(160, Math.min(orig.x + orig.width - 20, orig.width - dx));
        newH = lockAspect ? Math.round(newW / aspect) : Math.max(110, Math.min(1020 - orig.y, orig.height + dy));
        newX = orig.x + (orig.width - newW);
      } else if (corner === 'ne') {
        newW = Math.max(160, Math.min(1760 - orig.x, orig.width + dx));
        newH = lockAspect ? Math.round(newW / aspect) : Math.max(110, Math.min(orig.y + orig.height - 20, orig.height - dy));
        newY = orig.y + (orig.height - newH);
      } else if (corner === 'nw') {
        newW = Math.max(160, Math.min(orig.x + orig.width - 20, orig.width - dx));
        newH = lockAspect ? Math.round(newW / aspect) : Math.max(110, Math.min(orig.y + orig.height - 20, orig.height - dy));
        newX = orig.x + (orig.width - newW);
        newY = orig.y + (orig.height - newH);
      }

      if (newY + newH > 1060) {
        newH = 1060 - newY;
        if (lockAspect) newW = Math.round(newH * aspect);
      }

      next = {
        x: Math.round(Math.max(10, newX)),
        y: Math.round(Math.max(10, newY)),
        width: Math.round(Math.max(160, newW)),
        height: Math.round(Math.max(110, newH)),
      };
      setBox(next);
    };

    let isEnded = false;
    const onUp = () => {
      if (isEnded) return;
      isEnded = true;
      cleanup();
      onCommitGeometry(item.id, next.x, next.y, next.width, next.height);
      onVisualChange('media_resized');
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    window.addEventListener('mouseup', onUp);
  };

  const togglePlayPause = (e?: React.MouseEvent | React.PointerEvent) => {
    if (e) e.stopPropagation();
    const v = videoRef.current;
    if (!v) return;
    if (v.paused || v.ended) {
      ensureAudioTapConnected();
      v.play().catch((err) => console.warn('[SlideMediaOverlay] Play error:', err));
    } else {
      v.pause();
    }
  };

  const seekRelative = (deltaSec: number) => (e: React.MouseEvent) => {
    e.stopPropagation();
    const v = videoRef.current;
    if (!v) return;
    const dur = Number.isFinite(v.duration) ? v.duration : duration || 0;
    v.currentTime = Math.max(0, Math.min(dur || 1e9, v.currentTime + deltaSec));
    setCurrentTime(v.currentTime);
    onVisualChange('video_seeked');
  };

  const cycleSpeed = (e: React.MouseEvent) => {
    e.stopPropagation();
    const speeds = [0.5, 1, 1.25, 1.5, 2];
    const nextIdx = (speeds.indexOf(playbackRate) + 1) % speeds.length;
    const nextRate = speeds[nextIdx];
    setPlaybackRate(nextRate);
    if (videoRef.current) {
      videoRef.current.playbackRate = nextRate;
    }
  };

  const showChrome = isSelected || isHovered || (item.mediaType === 'video' && isPlaying);

  return (
    <div
      className="slide-media-card interactive"
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      onPointerDown={(e) => {
        if (!isAnnotationPassThrough) {
          onSelect(item.id);
        }
      }}
      style={{
        position: 'absolute',
        left: box.x,
        top: box.y,
        width: box.width,
        height: box.height,
        borderRadius: 12,
        overflow: 'visible',
        border: isSelected
          ? '2px solid #4ECDC4'
          : '1.5px solid rgba(255, 255, 255, 0.18)',
        boxShadow: isSelected
          ? '0 10px 32px rgba(0, 0, 0, 0.55), 0 0 0 3px rgba(78, 205, 196, 0.22)'
          : '0 8px 24px rgba(0, 0, 0, 0.45)',
        backgroundColor: '#0d0e1c',
        pointerEvents: isAnnotationPassThrough || isInteracting ? 'none' : 'auto',
        userSelect: 'none',
        transition: 'border-color 0.15s ease, box-shadow 0.15s ease',
      }}
    >
      {/* Floating Top Header Bar (Drag Handle + Title + AI Audio Toggle + Delete) */}
      <div
        className="no-vision interactive"
        onPointerDown={startDrag}
        style={{
          position: 'absolute',
          top: -34,
          left: 0,
          right: 0,
          height: 30,
          padding: '0 10px',
          borderRadius: 8,
          backgroundColor: 'rgba(18, 20, 38, 0.92)',
          border: '1px solid rgba(78, 205, 196, 0.35)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 8,
          opacity: showChrome ? 1 : 0,
          pointerEvents: showChrome ? 'auto' : 'none',
          cursor: isAnnotationPassThrough ? 'default' : isInteracting ? 'grabbing' : 'grab',
          transition: 'opacity 0.16s ease',
          zIndex: 5,
          touchAction: 'none',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0, flex: 1 }}>
          <span style={{ fontSize: 13 }}>{item.mediaType === 'video' ? '🎬' : '🖼️'}</span>
          <span
            style={{
              fontSize: 11,
              fontWeight: 600,
              color: '#E2E8F0',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              fontFamily: "'Inter', sans-serif",
            }}
          >
            {item.fileName}
          </span>
          <span
            style={{
              fontSize: 10,
              padding: '1px 6px',
              borderRadius: 10,
              backgroundColor: 'rgba(78, 205, 196, 0.18)',
              color: '#4ECDC4',
              fontWeight: 700,
              flexShrink: 0,
            }}
            title="ZYREN AI Tutor can see and analyze this slide media"
          >
            👁️ AI Vision Ready
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexShrink: 0 }}>
          {item.mediaType === 'video' && !extractYouTubeId(item.url) && (
            <button
              type="button"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                setShareAudioWithAI((v) => !v);
              }}
              title={
                shareAudioWithAI
                  ? 'AI Tutor hears this video audio while playing (Click to mute AI audio sharing)'
                  : 'AI audio sharing is OFF (Click so AI Tutor hears the video audio)'
              }
              style={{
                padding: '2px 7px',
                borderRadius: 6,
                border: shareAudioWithAI
                  ? '1px solid rgba(56, 239, 125, 0.5)'
                  : '1px solid rgba(255, 255, 255, 0.15)',
                backgroundColor: shareAudioWithAI
                  ? 'rgba(56, 239, 125, 0.18)'
                  : 'rgba(255, 255, 255, 0.06)',
                color: shareAudioWithAI ? '#6EE7B7' : '#94A3B8',
                fontSize: 10,
                fontWeight: 700,
                cursor: 'pointer',
              }}
            >
              {shareAudioWithAI ? '🧠🔊 AI Audio ON' : '🧠🔇 AI Audio OFF'}
            </button>
          )}

          {/* Fullscreen Modal View Button */}
          <button
            type="button"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              onOpenFullScreen(item);
            }}
            title="View Fullscreen"
            style={{
              width: 22,
              height: 22,
              borderRadius: 6,
              border: 'none',
              backgroundColor: 'rgba(255, 255, 255, 0.14)',
              color: '#F8FAFC',
              fontSize: 12,
              fontWeight: 700,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              transition: 'background-color 0.15s ease',
            }}
          >
            ⛶
          </button>

          <button
            type="button"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              onRemove(item.id);
            }}
            title="Remove from slide"
            style={{
              width: 22,
              height: 22,
              borderRadius: 6,
              border: 'none',
              backgroundColor: 'rgba(255, 107, 107, 0.2)',
              color: '#FF6B6B',
              fontSize: 12,
              fontWeight: 700,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            ✕
          </button>
        </div>
      </div>

      {/* Media Content Container */}
      <div
        onPointerDown={item.mediaType === 'image' ? startDrag : undefined}
        style={{
          width: '100%',
          height: '100%',
          borderRadius: 11,
          overflow: 'hidden',
          position: 'relative',
          backgroundColor: '#090a14',
          cursor: isAnnotationPassThrough ? 'crosshair' : item.mediaType === 'image' ? (isInteracting ? 'grabbing' : 'grab') : 'pointer',
        }}
      >
        {/* Full-bleed Transparent Shield during Drag / Resize: Prevents iframes or video from stealing mouse events */}
        {isInteracting && (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              zIndex: 9999,
              backgroundColor: 'transparent',
              cursor: interactionType === 'drag' ? 'grabbing' : 'nwse-resize',
            }}
          />
        )}
        {item.mediaType === 'image' ? (
          <img
            ref={(el) => {
              imgRef.current = el;
              onRegisterElement(item.id, el);
            }}
            src={item.url}
            alt={item.fileName}
            crossOrigin="anonymous"
            draggable={false}
            onLoad={() => onVisualChange('image_loaded')}
            style={{
              width: '100%',
              height: '100%',
              objectFit: 'contain',
              display: 'block',
              pointerEvents: 'none',
            }}
          />
        ) : extractYouTubeId(item.url) ? (
          <div style={{ width: '100%', height: '100%', position: 'relative', backgroundColor: '#05060d' }}>
            <iframe
              ref={(el) => onRegisterIframe?.(item.id, el)}
              id={`yt-iframe-${item.id}`}
              src={`https://www.youtube-nocookie.com/embed/${extractYouTubeId(item.url)}?enablejsapi=1&rel=0`}
              title={item.fileName || 'YouTube Video'}
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen
              style={{
                width: '100%',
                height: '100%',
                border: 'none',
                borderRadius: 11,
                pointerEvents: isAnnotationPassThrough ? 'none' : 'auto',
              }}
            />
          </div>
        ) : (
          <>
            <video
              ref={(el) => {
                videoRef.current = el;
                onRegisterElement(item.id, el);
              }}
              src={item.url}
              poster={item.posterDataUrl}
              crossOrigin="anonymous"
              playsInline
              preload="metadata"
              muted={isMuted}
              onClick={togglePlayPause}
              onLoadedMetadata={(e) => {
                const dur = e.currentTarget.duration;
                if (Number.isFinite(dur) && dur > 0) setDuration(dur);
                onVisualChange('video_metadata_loaded');
              }}
              onTimeUpdate={(e) => {
                setCurrentTime(e.currentTarget.currentTime);
              }}
              onSeeked={(e) => {
                setCurrentTime(e.currentTarget.currentTime);
                onVisualChange('video_seeked');
              }}
              onPlay={() => {
                setIsPlaying(true);
                ensureAudioTapConnected();
                onVisualChange('video_play');
              }}
              onPause={() => {
                setIsPlaying(false);
                onVisualChange('video_pause');
              }}
              onEnded={() => {
                setIsPlaying(false);
                onVisualChange('video_ended');
              }}
              style={{
                width: '100%',
                height: '100%',
                objectFit: 'contain',
                display: 'block',
                backgroundColor: '#05060d',
              }}
            />

            {/* Center Big Play Overlay when Paused */}
            {!isPlaying && (
              <button
                type="button"
                className="no-vision interactive"
                onPointerDown={(e) => e.stopPropagation()}
                onClick={togglePlayPause}
                title="Play Video"
                style={{
                  position: 'absolute',
                  top: '50%',
                  left: '50%',
                  transform: 'translate(-50%, -50%)',
                  width: 56,
                  height: 56,
                  borderRadius: '50%',
                  border: '2px solid rgba(78, 205, 196, 0.85)',
                  backgroundColor: 'rgba(15, 17, 34, 0.82)',
                  color: '#4ECDC4',
                  fontSize: 22,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  boxShadow: '0 6px 24px rgba(0, 0, 0, 0.65)',
                  pointerEvents: 'auto',
                }}
              >
                ▶
              </button>
            )}

            {/* Interactive Video Control Bar (Always clickable even in Pen annotation mode!) */}
            <div
              className="no-vision interactive"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => e.stopPropagation()}
              style={{
                position: 'absolute',
                left: 8,
                right: 8,
                bottom: 8,
                padding: '6px 10px',
                borderRadius: 10,
                backgroundColor: 'rgba(14, 16, 30, 0.88)',
                backdropFilter: 'blur(10px)',
                border: '1px solid rgba(255, 255, 255, 0.14)',
                display: 'flex',
                flexDirection: 'column',
                gap: 5,
                pointerEvents: 'auto',
                opacity: showChrome || !isPlaying ? 1 : 0.25,
                transition: 'opacity 0.2s ease',
              }}
            >
              {/* Timeline Scrubber */}
              <input
                type="range"
                min={0}
                max={Math.max(0.1, duration || 0.1)}
                step={0.05}
                value={Math.min(duration || 0.1, currentTime)}
                onChange={(e) => {
                  const nextT = parseFloat(e.target.value);
                  setCurrentTime(nextT);
                  if (videoRef.current) {
                    videoRef.current.currentTime = nextT;
                  }
                }}
                onMouseUp={() => onVisualChange('video_scrubbed')}
                style={{
                  width: '100%',
                  accentColor: '#4ECDC4',
                  height: 4,
                  cursor: 'pointer',
                  margin: 0,
                }}
              />

              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                  <button
                    type="button"
                    onClick={togglePlayPause}
                    title={isPlaying ? 'Pause' : 'Play'}
                    style={ctrlBtnStyle}
                  >
                    {isPlaying ? '⏸' : '▶'}
                  </button>
                  <button type="button" onClick={seekRelative(-5)} title="Back 5 seconds" style={ctrlBtnStyle}>
                    ⏪ 5s
                  </button>
                  <button type="button" onClick={seekRelative(5)} title="Forward 5 seconds" style={ctrlBtnStyle}>
                    5s ⏩
                  </button>
                  <button
                    type="button"
                    onClick={seekRelative(1 / 30)}
                    title="Step 1 Frame Forward"
                    style={ctrlBtnStyle}
                  >
                    ⏭
                  </button>
                  <span
                    style={{
                      fontSize: 11,
                      fontFamily: 'monospace',
                      color: '#E2E8F0',
                      fontWeight: 600,
                      marginLeft: 4,
                    }}
                  >
                    {formatTimestamp(currentTime)} / {formatTimestamp(duration)}
                  </span>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                  <button
                    type="button"
                    onClick={cycleSpeed}
                    title="Playback Speed"
                    style={{ ...ctrlBtnStyle, color: '#4ECDC4', fontWeight: 700 }}
                  >
                    {playbackRate}x
                  </button>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      const nextMute = !isMuted;
                      setIsMuted(nextMute);
                      if (videoRef.current) videoRef.current.muted = nextMute;
                    }}
                    title={isMuted ? 'Unmute Video' : 'Mute Video'}
                    style={ctrlBtnStyle}
                  >
                    {isMuted ? '🔇' : '🔊'}
                  </button>
                </div>
              </div>
            </div>
          </>
        )}
      </div>

      {/* 4-Corner Resize Handles (visible when selected/hovered in Pan/Select mode) */}
      {!isAnnotationPassThrough && (isSelected || isHovered) && (
        <>
          {(['nw', 'ne', 'sw', 'se'] as const).map((corner) => {
            const isTop = corner.startsWith('n');
            const isLeft = corner.endsWith('w');
            const cursorMap = {
              nw: 'nwse-resize',
              se: 'nwse-resize',
              ne: 'nesw-resize',
              sw: 'nesw-resize',
            };
            return (
              <div
                key={corner}
                className="no-vision interactive"
                onPointerDown={startResize(corner)}
                title="Drag to resize (Hold Shift for free aspect ratio)"
                style={{
                  position: 'absolute',
                  width: 14,
                  height: 14,
                  borderRadius: '50%',
                  backgroundColor: '#4ECDC4',
                  border: '2px solid #0f1021',
                  boxShadow: '0 2px 8px rgba(0,0,0,0.6)',
                  top: isTop ? -7 : undefined,
                  bottom: !isTop ? -7 : undefined,
                  left: isLeft ? -7 : undefined,
                  right: !isLeft ? -7 : undefined,
                  cursor: cursorMap[corner],
                  zIndex: 8,
                }}
              />
            );
          })}
        </>
      )}
    </div>
  );
});

const ctrlBtnStyle: React.CSSProperties = {
  padding: '2px 6px',
  borderRadius: 5,
  border: '1px solid rgba(255, 255, 255, 0.14)',
  backgroundColor: 'rgba(255, 255, 255, 0.08)',
  color: '#F8FAFC',
  fontSize: 11,
  cursor: 'pointer',
  lineHeight: 1.3,
};

export const SlideMediaOverlay = forwardRef<SlideMediaOverlayHandle, SlideMediaOverlayProps>(
  function SlideMediaOverlay(
    {
      zoom,
      toolMode,
      onUpdateGeometry,
      onRemoveMedia,
      onMediaVisualFrameChanged,
      onVideoAudioChunk,
    },
    ref
  ) {
    const [items, setItemsState] = useState<SlideMediaItem[]>([]);
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [fullscreenItem, setFullscreenItem] = useState<SlideMediaItem | null>(null);

    const itemsRef = useRef<SlideMediaItem[]>([]);
    itemsRef.current = items;

    const elementsMapRef = useRef<Map<string, HTMLImageElement | HTMLVideoElement>>(new Map());
    const iframesMapRef = useRef<Map<string, HTMLIFrameElement>>(new Map());
    const volumeStateMapRef = useRef<Map<string, number>>(new Map());
    const playbackMapRef = useRef<Map<string, PlaybackTelemetry>>(new Map());
    const ytThumbsRef = useRef<Map<string, HTMLImageElement>>(new Map());

    const registerIframe = useCallback((id: string, el: HTMLIFrameElement | null) => {
      if (el) {
        iframesMapRef.current.set(id, el);
      } else {
        iframesMapRef.current.delete(id);
      }
    }, []);

    useEffect(() => {
      if (!fullscreenItem) return;
      const onKeyDown = (e: KeyboardEvent) => {
        if (e.key === 'Escape') setFullscreenItem(null);
      };
      window.addEventListener('keydown', onKeyDown);
      return () => window.removeEventListener('keydown', onKeyDown);
    }, [fullscreenItem]);

    const registerElement = useCallback((id: string, el: HTMLImageElement | HTMLVideoElement | null) => {
      if (el) {
        elementsMapRef.current.set(id, el);
      } else {
        elementsMapRef.current.delete(id);
      }
    }, []);

    const updatePlayback = useCallback((id: string, state: PlaybackTelemetry) => {
      playbackMapRef.current.set(id, state);
    }, []);

    const addMedia = useCallback((item: Omit<SlideMediaItem, 'id'> & { id?: string }): string => {
      const id = item.id || `media-shape-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      const normalized: SlideMediaItem = {
        ...item,
        id,
      };
      setItemsState((prev) => {
        const exists = prev.some((m) => m.id === id);
        return exists ? prev.map((m) => (m.id === id ? normalized : m)) : [...prev, normalized];
      });
      setSelectedId(id);
      return id;
    }, []);

    const removeMedia = useCallback(
      (id: string) => {
        setItemsState((prev) => prev.filter((m) => m.id !== id));
        elementsMapRef.current.delete(id);
        iframesMapRef.current.delete(id);
        volumeStateMapRef.current.delete(id);
        playbackMapRef.current.delete(id);
        if (selectedId === id) setSelectedId(null);
        onRemoveMedia?.(id);
        onMediaVisualFrameChanged?.('media_removed');
      },
      [selectedId, onRemoveMedia, onMediaVisualFrameChanged]
    );

    const clear = useCallback(() => {
      setItemsState([]);
      elementsMapRef.current.clear();
      iframesMapRef.current.clear();
      volumeStateMapRef.current.clear();
      playbackMapRef.current.clear();
      setSelectedId(null);
    }, []);

    const setItems = useCallback((nextItems: SlideMediaItem[]) => {
      setItemsState(nextItems);
      setSelectedId(null);
    }, []);

    const getItems = useCallback(() => itemsRef.current, []);

    const getRuntimeStates = useCallback((): SlideMediaRuntimeState[] => {
      return itemsRef.current.map((m) => {
        const pb = playbackMapRef.current.get(m.id);
        return {
          id: m.id,
          mediaId: m.mediaId,
          mediaType: m.mediaType,
          fileName: m.fileName,
          mimeType: m.mimeType,
          url: m.url,
          x: m.x,
          y: m.y,
          width: m.width,
          height: m.height,
          durationSec: pb?.durationSec ?? m.durationSec ?? 0,
          currentTimeSec: pb?.currentTimeSec ?? 0,
          isPlaying: Boolean(pb?.isPlaying),
          shareAudioWithAI: pb?.shareAudioWithAI ?? (m.shareAudioWithAI !== false),
        };
      });
    }, []);

    const hasPlayingVideo = useCallback((): boolean => {
      for (const m of itemsRef.current) {
        if (m.mediaType === 'video') {
          const el = elementsMapRef.current.get(m.id) as HTMLVideoElement | undefined;
          if (el && !el.paused && !el.ended) return true;
          const pb = playbackMapRef.current.get(m.id);
          if (pb?.isPlaying) return true;
        }
      }
      return false;
    }, []);

    const drawMediaToCanvas = useCallback((ctx: CanvasRenderingContext2D) => {
      for (const m of itemsRef.current) {
        const ytId = extractYouTubeId(m.url);
        if (ytId) {
          try {
            let thumb = ytThumbsRef.current.get(ytId);
            if (!thumb) {
              thumb = new Image();
              thumb.crossOrigin = 'anonymous';
              thumb.src = `https://img.youtube.com/vi/${ytId}/hqdefault.jpg`;
              ytThumbsRef.current.set(ytId, thumb);
            }
            ctx.save();
            ctx.beginPath();
            ctx.rect(m.x, m.y, m.width, m.height);
            ctx.clip();
            if (thumb.complete && thumb.naturalWidth > 0) {
              ctx.drawImage(thumb, m.x, m.y, m.width, m.height);
            } else {
              ctx.fillStyle = '#0f172a';
              ctx.fillRect(m.x, m.y, m.width, m.height);
            }
            ctx.strokeStyle = '#FF0000';
            ctx.lineWidth = 2;
            ctx.strokeRect(m.x, m.y, m.width, m.height);
            const badge = `YOUTUBE: ${m.fileName || ytId}`;
            ctx.font = 'bold 14px Inter, sans-serif';
            const textW = Math.min(m.width - 12, ctx.measureText(badge).width + 24);
            ctx.fillStyle = 'rgba(10, 12, 24, 0.88)';
            ctx.fillRect(m.x + 6, m.y + 6, textW, 24);
            ctx.fillStyle = '#FF0000';
            ctx.fillText('▶', m.x + 12, m.y + 23);
            ctx.fillStyle = '#F8FAFC';
            ctx.fillText(badge, m.x + 30, m.y + 23, m.width - 36);
            ctx.restore();
          } catch {}
          continue;
        }

        const el = elementsMapRef.current.get(m.id);
        if (!el) continue;

        try {
          let srcW = 0;
          let srcH = 0;
          if (m.mediaType === 'image') {
            const img = el as HTMLImageElement;
            if (!img.complete || img.naturalWidth === 0) continue;
            srcW = img.naturalWidth;
            srcH = img.naturalHeight;
          } else {
            const vid = el as HTMLVideoElement;
            if (vid.readyState < 2 || vid.videoWidth === 0) continue;
            srcW = vid.videoWidth;
            srcH = vid.videoHeight;
          }

          // Background frame card
          ctx.save();
          ctx.fillStyle = '#090a14';
          ctx.fillRect(m.x, m.y, m.width, m.height);

          // Fit 'contain' inside (m.x, m.y, m.width, m.height) matching CSS objectFit: 'contain'
          const scale = Math.min(m.width / srcW, m.height / srcH);
          const drawW = srcW * scale;
          const drawH = srcH * scale;
          const drawX = m.x + (m.width - drawW) / 2;
          const drawY = m.y + (m.height - drawH) / 2;

          ctx.drawImage(el, drawX, drawY, drawW, drawH);

          // Subtle border & timestamp badge for AI spatial + temporal grounding
          ctx.strokeStyle = '#4ECDC4';
          ctx.lineWidth = 2;
          ctx.strokeRect(m.x, m.y, m.width, m.height);

          if (m.mediaType === 'video') {
            const vid = el as HTMLVideoElement;
            const cur = formatTimestamp(vid.currentTime || 0);
            const dur = formatTimestamp(vid.duration || m.durationSec || 0);
            const stateTag = vid.paused ? 'PAUSED' : 'PLAYING';
            const badge = `VIDEO [${stateTag} ${cur}/${dur}] ${m.fileName}`;
            ctx.font = 'bold 14px Inter, sans-serif';
            const textW = Math.min(m.width - 12, ctx.measureText(badge).width + 16);
            ctx.fillStyle = 'rgba(10, 12, 24, 0.82)';
            ctx.fillRect(m.x + 6, m.y + 6, textW, 24);
            ctx.fillStyle = '#4ECDC4';
            ctx.fillText(badge, m.x + 14, m.y + 23, m.width - 20);
          }
          ctx.restore();
        } catch {
          // ignore cross-origin or transient decode error
        }
      }
    }, []);

    const isUpdatingGeometryRef = useRef(false);

    const handleCommitGeometry = useCallback(
      (id: string, x: number, y: number, width: number, height: number) => {
        if (isUpdatingGeometryRef.current) return;
        isUpdatingGeometryRef.current = true;
        try {
          setItemsState((prev) =>
            prev.map((m) => (m.id === id ? { ...m, x, y, width, height } : m))
          );
          onUpdateGeometry?.(id, x, y, width, height);
        } finally {
          isUpdatingGeometryRef.current = false;
        }
      },
      [onUpdateGeometry]
    );

    const updateMediaGeometry = useCallback(
      (id: string, x: number, y: number, width?: number, height?: number) => {
        if (isUpdatingGeometryRef.current) return;
        isUpdatingGeometryRef.current = true;
        try {
          let hasChanged = false;
          let finalW = width;
          let finalH = height;
          setItemsState((prev) =>
            prev.map((m) => {
              if (m.id === id) {
                const w = width !== undefined ? width : m.width;
                const h = height !== undefined ? height : m.height;
                finalW = w;
                finalH = h;
                if (m.x === x && m.y === y && m.width === w && m.height === h) {
                  return m;
                }
                hasChanged = true;
                return { ...m, x, y, width: w, height: h };
              }
              return m;
            })
          );
          if (hasChanged) {
            onUpdateGeometry?.(id, x, y, finalW ?? 640, finalH ?? 360);
          }
        } finally {
          isUpdatingGeometryRef.current = false;
        }
      },
      [onUpdateGeometry]
    );

    const sendYouTubeCommand = useCallback((iframe: HTMLIFrameElement, func: string, args: any[] = []): boolean => {
      try {
        if (iframe.contentWindow) {
          iframe.contentWindow.postMessage(
            JSON.stringify({
              event: 'command',
              func,
              args,
            }),
            '*'
          );
          return true;
        }
      } catch (err) {
        console.warn('[SlideMediaOverlay] Failed to postMessage to YouTube iframe:', err);
      }
      return false;
    }, []);

    const controlMedia = useCallback(
      (
        mediaIdOrSelector: string | undefined,
        command: VideoControlCommand
      ): { success: boolean; message: string; targetId?: string } => {
        const action = command.action;
        const allItems = itemsRef.current;
        const videoItems = allItems.filter((m) => m.mediaType === 'video');

        if (videoItems.length === 0) {
          return { success: false, message: 'No video items currently exist on the whiteboard slide.' };
        }

        let target: SlideMediaItem | undefined;
        if (mediaIdOrSelector && !['latest', 'video', 'all', 'current'].includes(mediaIdOrSelector.trim().toLowerCase())) {
          const s = mediaIdOrSelector.trim().toLowerCase();
          target = videoItems.find(
            (m) =>
              m.id.toLowerCase() === s ||
              m.mediaId.toLowerCase() === s ||
              (m.fileName && m.fileName.toLowerCase().includes(s))
          );
        }

        if (!target) {
          if (selectedId) {
            target = videoItems.find((m) => m.id === selectedId);
          }
          if (!target) {
            target = videoItems[videoItems.length - 1];
          }
        }

        if (!target) {
          return { success: false, message: 'Could not resolve target video.' };
        }

        const ytId = extractYouTubeId(target.url);
        let iframe: HTMLIFrameElement | null = null;
        let videoEl: HTMLVideoElement | null = null;

        if (ytId) {
          iframe = iframesMapRef.current.get(target.id) || null;
          if (!iframe) {
            iframe = (document.getElementById(`yt-iframe-${target.id}`) as HTMLIFrameElement) || null;
          }
          if (!iframe && typeof document !== 'undefined') {
            iframe = (document.querySelector(`iframe[src*="${ytId}"]`) as HTMLIFrameElement) || null;
          }
        } else {
          const el = elementsMapRef.current.get(target.id);
          if (el && el instanceof HTMLVideoElement) {
            videoEl = el;
          }
        }

        const targetLabel = target.fileName || target.id;

        switch (action) {
          case 'play': {
            if (ytId && iframe) {
              sendYouTubeCommand(iframe, 'playVideo');
            } else if (videoEl) {
              videoEl.play().catch((err) => console.warn('[SlideMediaOverlay] Play error:', err));
            }
            onMediaVisualFrameChanged?.('video_play');
            return { success: true, message: `Started playback for '${targetLabel}'.`, targetId: target.id };
          }

          case 'pause': {
            if (ytId && iframe) {
              sendYouTubeCommand(iframe, 'pauseVideo');
            } else if (videoEl) {
              videoEl.pause();
            }
            onMediaVisualFrameChanged?.('video_pause');
            return { success: true, message: `Paused video '${targetLabel}'.`, targetId: target.id };
          }

          case 'toggle_play': {
            if (ytId && iframe) {
              const pb = playbackMapRef.current.get(target.id);
              if (pb?.isPlaying) {
                sendYouTubeCommand(iframe, 'pauseVideo');
              } else {
                sendYouTubeCommand(iframe, 'playVideo');
              }
            } else if (videoEl) {
              if (videoEl.paused || videoEl.ended) {
                videoEl.play().catch((err) => console.warn('[SlideMediaOverlay] Play error:', err));
              } else {
                videoEl.pause();
              }
            }
            onMediaVisualFrameChanged?.('video_toggle_play');
            return { success: true, message: `Toggled playback for '${targetLabel}'.`, targetId: target.id };
          }

          case 'volume_up': {
            const curVol = volumeStateMapRef.current.get(target.id) ?? (ytId ? 100 : Math.round((videoEl?.volume ?? 1) * 100));
            const newVol = Math.min(100, curVol + 15);
            volumeStateMapRef.current.set(target.id, newVol);
            if (ytId && iframe) {
              sendYouTubeCommand(iframe, 'unMute');
              sendYouTubeCommand(iframe, 'setVolume', [newVol]);
            } else if (videoEl) {
              videoEl.muted = false;
              videoEl.volume = newVol / 100;
            }
            return { success: true, message: `Volume raised to ${newVol}% for '${targetLabel}'.`, targetId: target.id };
          }

          case 'volume_down': {
            const curVol = volumeStateMapRef.current.get(target.id) ?? (ytId ? 100 : Math.round((videoEl?.volume ?? 1) * 100));
            const newVol = Math.max(0, curVol - 15);
            volumeStateMapRef.current.set(target.id, newVol);
            if (ytId && iframe) {
              sendYouTubeCommand(iframe, 'setVolume', [newVol]);
            } else if (videoEl) {
              videoEl.volume = newVol / 100;
            }
            return { success: true, message: `Volume lowered to ${newVol}% for '${targetLabel}'.`, targetId: target.id };
          }

          case 'set_volume': {
            const newVol = Math.max(0, Math.min(100, command.volume ?? 100));
            volumeStateMapRef.current.set(target.id, newVol);
            if (ytId && iframe) {
              if (newVol > 0) sendYouTubeCommand(iframe, 'unMute');
              sendYouTubeCommand(iframe, 'setVolume', [newVol]);
            } else if (videoEl) {
              if (newVol > 0) videoEl.muted = false;
              videoEl.volume = newVol / 100;
            }
            return { success: true, message: `Volume set to ${newVol}% for '${targetLabel}'.`, targetId: target.id };
          }

          case 'mute': {
            if (ytId && iframe) {
              sendYouTubeCommand(iframe, 'mute');
            } else if (videoEl) {
              videoEl.muted = true;
            }
            return { success: true, message: `Muted '${targetLabel}'.`, targetId: target.id };
          }

          case 'unmute': {
            if (ytId && iframe) {
              sendYouTubeCommand(iframe, 'unMute');
              const lastVol = volumeStateMapRef.current.get(target.id) ?? 100;
              sendYouTubeCommand(iframe, 'setVolume', [lastVol]);
            } else if (videoEl) {
              videoEl.muted = false;
            }
            return { success: true, message: `Unmuted '${targetLabel}'.`, targetId: target.id };
          }

          case 'set_speed': {
            const speed = Math.max(0.25, Math.min(2.0, command.speed ?? 1.0));
            if (ytId && iframe) {
              sendYouTubeCommand(iframe, 'setPlaybackRate', [speed]);
            } else if (videoEl) {
              videoEl.playbackRate = speed;
            }
            return { success: true, message: `Playback speed set to ${speed}x for '${targetLabel}'.`, targetId: target.id };
          }

          case 'seek_to': {
            const sec = Math.max(0, command.time_sec ?? 0);
            if (ytId && iframe) {
              sendYouTubeCommand(iframe, 'seekTo', [sec, true]);
            } else if (videoEl) {
              videoEl.currentTime = sec;
            }
            onMediaVisualFrameChanged?.('video_seeked');
            return { success: true, message: `Seeked to ${formatTimestamp(sec)} in '${targetLabel}'.`, targetId: target.id };
          }

          case 'seek_relative': {
            const delta = command.time_sec ?? 5;
            if (ytId && iframe) {
              const pb = playbackMapRef.current.get(target.id);
              const cur = pb?.currentTimeSec ?? 0;
              const nextTime = Math.max(0, cur + delta);
              sendYouTubeCommand(iframe, 'seekTo', [nextTime, true]);
            } else if (videoEl) {
              videoEl.currentTime = Math.max(0, (videoEl.currentTime || 0) + delta);
            }
            onMediaVisualFrameChanged?.('video_seeked');
            return { success: true, message: `Seeked ${delta >= 0 ? '+' : ''}${delta}s in '${targetLabel}'.`, targetId: target.id };
          }

          case 'enable_subtitles': {
            const lang = (command.language || 'en').toLowerCase();
            if (ytId && iframe) {
              sendYouTubeCommand(iframe, 'loadModule', ['captions']);
              sendYouTubeCommand(iframe, 'setOption', ['captions', 'track', { languageCode: lang }]);
            } else if (videoEl) {
              for (let i = 0; i < videoEl.textTracks.length; i++) {
                const tr = videoEl.textTracks[i];
                if (tr.language.toLowerCase().startsWith(lang) || !command.language) {
                  tr.mode = 'showing';
                }
              }
            }
            return { success: true, message: `Enabled subtitles (${lang}) for '${targetLabel}'.`, targetId: target.id };
          }

          case 'disable_subtitles': {
            if (ytId && iframe) {
              sendYouTubeCommand(iframe, 'unloadModule', ['captions']);
              sendYouTubeCommand(iframe, 'setOption', ['captions', 'track', {}]);
            } else if (videoEl) {
              for (let i = 0; i < videoEl.textTracks.length; i++) {
                videoEl.textTracks[i].mode = 'hidden';
              }
            }
            return { success: true, message: `Disabled subtitles for '${targetLabel}'.`, targetId: target.id };
          }

          case 'set_subtitle_language': {
            const lang = (command.language || 'en').toLowerCase();
            if (ytId && iframe) {
              sendYouTubeCommand(iframe, 'loadModule', ['captions']);
              sendYouTubeCommand(iframe, 'setOption', ['captions', 'track', { languageCode: lang }]);
            } else if (videoEl) {
              for (let i = 0; i < videoEl.textTracks.length; i++) {
                const tr = videoEl.textTracks[i];
                if (tr.language.toLowerCase() === lang || tr.language.toLowerCase().startsWith(lang) || tr.label.toLowerCase().includes(lang)) {
                  tr.mode = 'showing';
                } else {
                  tr.mode = 'hidden';
                }
              }
            }
            return { success: true, message: `Set subtitle language to '${lang}' for '${targetLabel}'.`, targetId: target.id };
          }

          case 'set_audio_language': {
            const lang = (command.language || 'en').toLowerCase();
            if (videoEl) {
              const audioTracks = (videoEl as any).audioTracks;
              if (audioTracks && audioTracks.length > 0) {
                for (let i = 0; i < audioTracks.length; i++) {
                  const tr = audioTracks[i];
                  tr.enabled = tr.language?.toLowerCase() === lang || tr.label?.toLowerCase().includes(lang);
                }
                return { success: true, message: `Set audio dubbing track to '${lang}' for local video.`, targetId: target.id };
              }
            }
            if (ytId) {
              return { success: true, message: `YouTube audio dubbing language requested (${lang}). Note: YouTube embeds manage multi-audio tracks natively via user player settings.`, targetId: target.id };
            }
            return { success: true, message: `Audio dubbing selection requested for '${targetLabel}'.`, targetId: target.id };
          }

          case 'set_quality': {
            const q = command.quality || 'auto';
            if (ytId && iframe) {
              sendYouTubeCommand(iframe, 'setPlaybackQuality', [q]);
              sendYouTubeCommand(iframe, 'setPlaybackQualityRange', [q, q]);
            }
            return { success: true, message: `Requested quality level '${q}' for '${targetLabel}'.`, targetId: target.id };
          }

          case 'maximize': {
            updateMediaGeometry(target.id, 160, 100, 1600, 880);
            onMediaVisualFrameChanged?.('video_maximized');
            return { success: true, message: `Maximized video '${targetLabel}' to 1600x880.`, targetId: target.id };
          }

          case 'minimize': {
            updateMediaGeometry(target.id, 1340, 680, 500, 320);
            onMediaVisualFrameChanged?.('video_minimized');
            return { success: true, message: `Minimized video '${targetLabel}' to 500x320.`, targetId: target.id };
          }

          case 'resize': {
            const w = Math.max(200, Math.min(1800, command.width ?? target.width));
            const h = Math.max(120, Math.min(1000, command.height ?? target.height));
            updateMediaGeometry(target.id, target.x, target.y, w, h);
            onMediaVisualFrameChanged?.('video_resized');
            return { success: true, message: `Resized video '${targetLabel}' to ${w}x${h}.`, targetId: target.id };
          }

          case 'fullscreen': {
            setFullscreenItem(target);
            return { success: true, message: `Opened video '${targetLabel}' in fullscreen view.`, targetId: target.id };
          }

          default:
            return { success: false, message: `Unknown video control action '${action}'.`, targetId: target.id };
        }
      },
      [selectedId, sendYouTubeCommand, updateMediaGeometry, onMediaVisualFrameChanged]
    );

    useImperativeHandle(
      ref,
      () => ({
        addMedia,
        updateMediaGeometry,
        removeMedia,
        clear,
        getItems,
        setItems,
        getRuntimeStates,
        hasPlayingVideo,
        drawMediaToCanvas,
        controlMedia,
      }),
      [
        addMedia,
        updateMediaGeometry,
        removeMedia,
        clear,
        getItems,
        setItems,
        getRuntimeStates,
        hasPlayingVideo,
        drawMediaToCanvas,
        controlMedia,
      ]
    );

    const isAnnotationPassThrough = toolMode !== 'pointer' && toolMode !== 'pan';

    return (
      <div
        className="slide-media-overlay"
        onPointerDown={(e) => {
          if (e.target === e.currentTarget) {
            setSelectedId(null);
          }
        }}
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: '100%',
          height: '100%',
          pointerEvents: 'none',
          zIndex: 6, // Above Rough.js Canvas background (1), below SVG handwriting (10), Math, and UserDrawingLayer (20) so both AI & Student can annotate right over images/videos!
        }}
      >
        {items.map((item) => (
          <SlideMediaCard
            key={item.id}
            item={item}
            zoom={zoom}
            isSelected={selectedId === item.id}
            isAnnotationPassThrough={isAnnotationPassThrough}
            onSelect={setSelectedId}
            onCommitGeometry={handleCommitGeometry}
            onRemove={removeMedia}
            onRegisterElement={registerElement}
            onRegisterIframe={registerIframe}
            onUpdatePlayback={updatePlayback}
            onVisualChange={(reason) => onMediaVisualFrameChanged?.(reason)}
            onVideoAudioChunk={onVideoAudioChunk}
            onOpenFullScreen={(m) => setFullscreenItem(m)}
          />
        ))}

        {/* Global Fullscreen Modal for Images & Videos with Close Button */}
        {fullscreenItem && (
          <div
            style={{
              position: 'fixed',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              zIndex: 999999,
              backgroundColor: 'rgba(7, 9, 19, 0.94)',
              backdropFilter: 'blur(10px)',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              pointerEvents: 'auto',
            }}
            onClick={() => setFullscreenItem(null)}
          >
            {/* Top Bar with Title & Close Button */}
            <div
              style={{
                position: 'absolute',
                top: 20,
                left: 30,
                right: 30,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                zIndex: 1000000,
              }}
              onClick={(e) => e.stopPropagation()}
            >
              <div
                style={{
                  color: '#F8FAFC',
                  fontSize: 16,
                  fontWeight: 700,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                }}
              >
                <span>{fullscreenItem.mediaType === 'image' ? '🖼️' : '🎬'}</span>
                <span>
                  {fullscreenItem.fileName ||
                    (fullscreenItem.mediaType === 'image' ? 'Image View' : 'Video Player')}
                </span>
              </div>
              <button
                type="button"
                onClick={() => setFullscreenItem(null)}
                title="Close Fullscreen (Esc)"
                style={{
                  padding: '8px 16px',
                  borderRadius: 8,
                  backgroundColor: 'rgba(255, 107, 107, 0.25)',
                  border: '1px solid #FF6B6B',
                  color: '#FF6B6B',
                  fontSize: 14,
                  fontWeight: 700,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  transition: 'all 0.15s ease',
                }}
              >
                <span>✕</span>
                <span>Close</span>
              </button>
            </div>

            {/* Content Display */}
            <div
              style={{
                maxWidth: '92vw',
                maxHeight: '85vh',
                width: 'auto',
                height: 'auto',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
              onClick={(e) => e.stopPropagation()}
            >
              {fullscreenItem.mediaType === 'image' ? (
                <img
                  src={fullscreenItem.url}
                  alt={fullscreenItem.fileName}
                  style={{
                    maxWidth: '92vw',
                    maxHeight: '85vh',
                    objectFit: 'contain',
                    borderRadius: 12,
                    boxShadow: '0 20px 50px rgba(0,0,0,0.8)',
                  }}
                />
              ) : extractYouTubeId(fullscreenItem.url) ? (
                <iframe
                  src={`https://www.youtube-nocookie.com/embed/${extractYouTubeId(
                    fullscreenItem.url
                  )}?autoplay=1&rel=0`}
                  title={fullscreenItem.fileName}
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                  allowFullScreen
                  style={{
                    width: '88vw',
                    height: '80vh',
                    border: 'none',
                    borderRadius: 12,
                    boxShadow: '0 20px 50px rgba(0,0,0,0.8)',
                  }}
                />
              ) : (
                <video
                  src={fullscreenItem.url}
                  controls
                  autoPlay
                  style={{
                    maxWidth: '92vw',
                    maxHeight: '85vh',
                    borderRadius: 12,
                    boxShadow: '0 20px 50px rgba(0,0,0,0.8)',
                  }}
                />
              )}
            </div>
          </div>
        )}
      </div>
    );
  }
);
