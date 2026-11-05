/**
 * SyncEngine — Core orchestrator for audio-visual synchronization.
 *
 * This is the heart of the AI Tutor system. It:
 * 1. Receives audio via WebRTC and alignment data via DataChannel
 * 2. Runs a requestAnimationFrame loop driven by AudioContext.currentTime
 * 3. Drains the drawing/handwriting queues at the correct audio time
 * 4. Dispatches commands to the Canvas layer (shapes) and SVG layer (handwriting)
 * 5. Handles drift correction and barge-in interruptions
 *
 * The AudioContext clock is the SINGLE SOURCE OF TRUTH for all timing.
 */
import { AudioClock } from './AudioClock';
import { SyncQueue } from './SyncQueue';
import { DriftCorrector } from './DriftCorrector';
import { InterruptionHandler } from './InterruptionHandler';
import { DataChannelProtocol } from '../transport/DataChannelProtocol';
import type {
  DrawCommand,
  ShapePayload,
  HandwritingPayload,
  ClearPayload,
  WhiteboardState,
} from '../types';
import type { ICanvasAdapter } from '../adapters/canvas/ICanvasAdapter';
import type { SVGOverlayHandle } from '../layers/SVGOverlay';
import type { MathOverlayHandle } from '../layers/MathOverlay';
import type { GraphOverlayHandle } from '../layers/GraphOverlay';
import type { Graph3DOverlayHandle } from '../layers/Graph3DOverlay';
import type { VennOverlayHandle } from '../layers/VennOverlay';
import type { SlideMediaOverlayHandle } from '../layers/SlideMediaOverlay';
import * as CollisionDetector from './CollisionDetector';
import { DiagramLayoutEngine } from './DiagramLayoutEngine';
import type { DiagramOptions } from '../types';

export interface SyncEngineConfig {
  canvasAdapter: ICanvasAdapter;
  svgOverlay: SVGOverlayHandle;
  mathOverlay?: MathOverlayHandle;
  graphOverlay?: GraphOverlayHandle;
  graph3dOverlay?: Graph3DOverlayHandle;
  vennOverlay?: VennOverlayHandle;
  mediaOverlay?: SlideMediaOverlayHandle;
  getMathOverlay?: () => MathOverlayHandle | null | undefined;
  getGraphOverlay?: () => GraphOverlayHandle | null | undefined;
  getGraph3DOverlay?: () => Graph3DOverlayHandle | null | undefined;
  getVennOverlay?: () => VennOverlayHandle | null | undefined;
  getMediaOverlay?: () => SlideMediaOverlayHandle | null | undefined;
  /** Callback to send barge-in via DataChannel */
  onBargeIn?: (clientTime: number) => void;
  /** Callback for telemetry/monitoring */
  onTelemetry?: (metrics: SyncTelemetry) => void;
  /** Callback when whiteboard is 100% full in both columns */
  onBoardFull?: () => void;
  /** Callback when active slide shapes/handwriting mutate (for live thumbnails & auto-save) */
  onBoardChange?: () => void;
  /** Callback emitting live coordinates of newly written/drawn content (for Auto-Follow Camera) */
  onWritingFocus?: (target: { x: number; y: number; width: number; height: number; kind: string }) => void;
  /** Active UI writing style getter */
  getWritingStyle?: () => string;
}

export interface SyncTelemetry {
  queueDepth: number;
  driftMs: number;
  fps: number;
  heartbeatCount: number;
  interruptionCount: number;
  state: WhiteboardState;
}

export class SyncEngine {
  readonly audioClock: AudioClock;
  readonly drawingQueue: SyncQueue;
  private readonly driftCorrector: DriftCorrector;
  private readonly interruptionHandler: InterruptionHandler;
  private readonly config: SyncEngineConfig;
  private writingStyle: string = 'mixed';

  public setWritingStyle(style: string): void {
    this.writingStyle = style;
  }

  public getWritingStyle(): string {
    return this.config.getWritingStyle?.() ?? this.writingStyle;
  }

  private get graphOverlay(): GraphOverlayHandle | undefined {
    return this.config.getGraphOverlay?.() ?? this.config.graphOverlay ?? undefined;
  }

  private get graph3dOverlay(): Graph3DOverlayHandle | undefined {
    return this.config.getGraph3DOverlay?.() ?? this.config.graph3dOverlay ?? undefined;
  }

  private get vennOverlay(): VennOverlayHandle | undefined {
    return this.config.getVennOverlay?.() ?? this.config.vennOverlay ?? undefined;
  }

  private get mediaOverlay(): SlideMediaOverlayHandle | undefined {
    return this.config.getMediaOverlay?.() ?? this.config.mediaOverlay ?? undefined;
  }

  private get mathOverlay(): MathOverlayHandle | undefined {
    return this.config.getMathOverlay?.() ?? this.config.mathOverlay ?? undefined;
  }
  private rafId: number | null = null;
  private lastFrameTime = 0;
  private frameCount = 0;
  private fps = 0;
  private telemetryInterval: ReturnType<typeof setInterval> | null = null;
  private nextZIndex = 1; // shapes start at zIndex 1 (0 is default/background)
  /** All shapes and handwriting that have been drawn, for collision detection and z-index management */
  private drawnShapes: any[] = [];
  private drawnHandwriting: HandwritingPayload[] = [];
  private lastErasedSlot: { x: number; y: number; reqX: number; reqY: number; timestamp: number } | null = null;

  /**
   * Smart In-Place Rewrite & Anti-Double-Write Gate:
   * Detects when a newly arriving text/handwriting/math command is an exact duplicate or a rewrite/correction
   * of an existing item at the same requested coordinates, automatically erasing the old item and returning
   * its slot so the updated item replaces it cleanly in-place without writing twice on top of each other.
   */
  private tryReplaceExistingRewrite(newText: string, reqX: number, reqY: number): { x: number; y: number } | null {
    const trimmedNew = (newText || '').trim();
    if (!trimmedNew) return null;

    // 1. Check if an item was just explicitly erased via erase_content at the same requested coordinates
    if (this.lastErasedSlot && Date.now() - this.lastErasedSlot.timestamp < 8000) {
      if (Math.abs(this.lastErasedSlot.reqX - reqX) <= 50 && Math.abs(this.lastErasedSlot.reqY - reqY) <= 50) {
        const slot = { x: this.lastErasedSlot.x, y: this.lastErasedSlot.y };
        this.lastErasedSlot = null;
        return slot;
      }
    }

    const normalizeFull = (s: string) => s.toLowerCase().replace(/[\s\$\\.,:;()\[\]{}'"`\-]/g, '');
    const extractAnchor = (s: string) => {
      const firstLine = CollisionDetector.splitIntoLogicalLines(s)[0] || s;
      const noPrefix = firstLine.replace(/^(?:[1-9]\.|[ivx]+\)|-|\•)\s*/i, '').trim();
      const head = noPrefix.split(/[=:(\n]|->|=>/)[0] || '';
      return head.toLowerCase().replace(/[^a-z0-9äöüß]/gi, '');
    };
    const extractWords = (s: string): Set<string> => {
      const matches = s.toLowerCase().match(/[a-zäöüß0-9]{3,}/gi) || [];
      return new Set(matches);
    };

    const cleanNew = normalizeFull(trimmedNew);
    const newAnchor = extractAnchor(trimmedNew);
    const newWords = extractWords(trimmedNew);

    for (let i = this.drawnShapes.length - 1; i >= 0; i--) {
      const s = this.drawnShapes[i];
      const stype = s.shapeType || s.kind;
      if (!['text', 'handwriting', 'math'].includes(stype)) continue;

      const existingText = String(s.options?.latex || s.options?.text || s.text || '').trim();
      if (!existingText) continue;

      const cleanExisting = normalizeFull(existingText);
      const isExactDuplicate = cleanNew.length >= 4 && cleanNew === cleanExisting;

      const sReqX = s.requestedX ?? s.x ?? s.position?.x ?? 0;
      const sReqY = s.requestedY ?? s.y ?? s.position?.y ?? 0;
      const sameRequestedCoord = Math.abs(sReqX - reqX) <= 45 && Math.abs(sReqY - reqY) <= 40;

      let isCoordRewrite = false;
      if (sameRequestedCoord) {
        const existingAnchor = extractAnchor(existingText);
        if (newAnchor.length >= 4 && newAnchor === existingAnchor) {
          isCoordRewrite = true;
        } else if (newWords.size >= 2) {
          const existingWords = extractWords(existingText);
          let shared = 0;
          for (const w of newWords) {
            if (existingWords.has(w)) shared++;
          }
          const minSize = Math.min(newWords.size, existingWords.size);
          if (minSize >= 2 && shared / minSize >= 0.55) {
            isCoordRewrite = true;
          }
        }
      }

      if (isExactDuplicate || isCoordRewrite) {
        const slot = {
          x: s.x ?? s.position?.x ?? reqX,
          y: s.y ?? s.position?.y ?? reqY,
        };
        const [removed] = this.drawnShapes.splice(i, 1);
        if (removed) {
          const hwIdx = this.drawnHandwriting.findIndex(
            (h) => ((h as any).id && (h as any).id === removed.id) || h.text === removed.text || normalizeFull(h.text) === cleanExisting
          );
          if (hwIdx !== -1) {
            this.drawnHandwriting.splice(hwIdx, 1);
          }
        }
        this.loadBoard([...this.drawnShapes], [...this.drawnHandwriting]);
        return slot;
      }
    }

    return null;
  }

  constructor(config: SyncEngineConfig) {
    this.config = config;
    this.audioClock = new AudioClock();
    this.drawingQueue = new SyncQueue();
    this.driftCorrector = new DriftCorrector();

    this.interruptionHandler = new InterruptionHandler({
      audioClock: this.audioClock,
      drawingQueue: this.drawingQueue,
      driftCorrector: this.driftCorrector,
      canvasAdapter: config.canvasAdapter,
      svgOverlay: config.svgOverlay,
      sendBargeIn: (time) => config.onBargeIn?.(time),
    });
  }

  // ─── Lifecycle ───────────────────────────────────────────────

  async start(): Promise<void> {
    await this.audioClock.init();
    await this.audioClock.resume();
    this.lastFrameTime = performance.now();
    this.loop();

    // Start telemetry reporting every 2 seconds
    this.telemetryInterval = setInterval(() => this.reportTelemetry(), 2000);
  }

  stop(): void {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    if (this.telemetryInterval !== null) {
      clearInterval(this.telemetryInterval);
      this.telemetryInterval = null;
    }
    this.audioClock.suspend();
  }

  dispose(): void {
    this.stop();
    this.audioClock.dispose();
  }

  // ─── Audio Track Connection ──────────────────────────────────

  /**
   * Connects a WebRTC MediaStream to the audio graph.
   * Called when a LiveKit audio track is received.
   */
  connectAudioTrack(mediaStream: MediaStream): void {
    this.audioClock.connectMediaStream(mediaStream);
    this.driftCorrector.setClientEpoch(this.audioClock.currentTime);
    this.interruptionHandler.handleNewResponse();
  }

  // ─── Message Handlers ────────────────────────────────────────

  /**
   * Handles raw DataChannel messages (alignment, heartbeat, etc.)
   */
  onDataChannelMessage(raw: string | ArrayBuffer): void {
    const msg = DataChannelProtocol.parse(raw);
    if (!msg) return;

    switch (msg.type) {
      case 'alignment':
        // Alignment data updates timing precision for handwriting
        // The actual draw commands arrive via WebSocket
        break;

      case 'heartbeat':
        this.driftCorrector.onHeartbeat(msg.serverMediaTime, this.audioClock.currentTime);
        break;

      case 'interrupt_ack':
        this.interruptionHandler.handleInterruptAck(msg.keepUntilCommitGroup);
        break;

      case 'epoch_reset':
        this.resetEpoch(msg.newServerEpoch);
        break;
    }
  }

  /**
   * Enqueues a drawing command from the LLM (via WebSocket).
   * Converts server timestamps to client time via DriftCorrector.
   */
  onDrawCommand(command: DrawCommand): void {
    const clientTime = this.driftCorrector.serverToClientTime(command.scheduledTime);
    this.drawingQueue.enqueue({
      ...command,
      scheduledTime: clientTime,
    });
  }

  /**
   * Enqueues multiple drawing commands at once.
   */
  onDrawCommands(commands: DrawCommand[]): void {
    for (const cmd of commands) {
      this.onDrawCommand(cmd);
    }
  }

  /**
   * Triggers a barge-in interruption.
   */
  bargeIn(): void {
    this.interruptionHandler.handleBargeIn();
  }

  // ─── Main Render Loop ────────────────────────────────────────

  private loop = (): void => {
    // FPS tracking
    const now = performance.now();
    this.frameCount++;
    if (now - this.lastFrameTime >= 1000) {
      this.fps = this.frameCount;
      this.frameCount = 0;
      this.lastFrameTime = now;
    }

    const audioTime = this.audioClock.currentTime;

    // 1. Drain drawing queue → dispatch to appropriate layer
    const readyCommands = this.drawingQueue.drain(audioTime);
    for (const cmd of readyCommands) {
      this.executeCommand(cmd);
    }

    // 2. Update SVG handwriting animation progress
    this.config.svgOverlay.seek(audioTime);

    // 3. Schedule next frame
    this.rafId = requestAnimationFrame(this.loop);
  };

  // ─── Command Execution ───────────────────────────────────────

  private executeCommand(cmd: DrawCommand): void {
    switch (cmd.type) {
      case 'shape':
        this.executeShapeCommand(cmd.payload as ShapePayload);
        break;
      case 'handwriting':
        this.executeHandwritingCommand(cmd.payload as HandwritingPayload);
        break;
      case 'clear':
        this.executeClearCommand(cmd.payload as ClearPayload);
        break;
      case 'highlight':
        // TODO: Implement highlight command
        break;
    }
  }

  // ─── Unified Shape & Bound Label Renderers ─────────────────

  private renderBoundLabel(
    labelText: string,
    boxX: number,
    boxY: number,
    boxWidth: number,
    boxHeight: number,
    options: any,
    isHandwritten: boolean
  ): void {
    const trimmed = labelText.trim();
    if (!trimmed) return;

    // Minimum legible font size floor (19px for Caveat handwriting, 16px for standard sans)
    const minFontSize = isHandwritten ? 19 : 16;
    const maxFontSize = isHandwritten ? 26 : 24;
    let fontSize = Math.min(maxFontSize, Math.max(minFontSize, Math.round(boxHeight * (isHandwritten ? 0.38 : 0.32))));

    const maxLineWidth = Math.max(60, boxWidth - (isHandwritten ? 20 : 16));
    const fontFamily = options?.fontFamily || (isHandwritten ? "'Caveat', cursive, sans-serif" : undefined);
    const color = options?.color || '#FFFFFF';
    const writingStyle = isHandwritten ? 'handwriting' : options?.writingStyle;

    const charRatio = isHandwritten ? 0.50 : 0.55;
    const words = trimmed.split(/\s+/);

    const buildLines = (fs: number): string[] => {
      const res: string[] = [];
      let cur = '';
      for (const w of words) {
        const test = cur ? `${cur} ${w}` : w;
        const testW = test.length * fs * charRatio;
        if (testW > maxLineWidth && cur) {
          res.push(cur);
          cur = w;
        } else {
          cur = test;
        }
      }
      if (cur) res.push(cur);
      return res;
    };

    let lines = buildLines(fontSize);

    // Dynamic Font & Height Containment: Ensure lines * lineHeight strictly fits within boxHeight - 6
    let lineHeight = Math.round(fontSize * (isHandwritten ? 1.25 : 1.2));
    let totalTextHeight = lines.length * lineHeight;

    while (totalTextHeight > boxHeight - 6 && fontSize > (isHandwritten ? 15 : 13)) {
      fontSize -= 1;
      lines = buildLines(fontSize);
      lineHeight = Math.round(fontSize * (isHandwritten ? 1.25 : 1.2));
      totalTextHeight = lines.length * lineHeight;
    }

    const startY = boxY + (boxHeight - totalTextHeight) / 2;

    lines.forEach((line, lineIdx) => {
      const lineEstimatedWidth = line.length * fontSize * charRatio;
      const lineX = boxX + Math.max(6, (boxWidth - lineEstimatedWidth) / 2);
      // With textBaseline = "top", lineY = startY + lineIdx * lineHeight centers text block vertically with exact margins
      const lineY = startY + lineIdx * lineHeight;

      this.config.canvasAdapter.drawText(line, lineX, lineY, {
        fontSize,
        color,
        fontFamily,
        writingStyle,
      });
    });
  }

  private renderRectangleWithLabel(
    x: number,
    y: number,
    width: number,
    height: number,
    options: any
  ): void {
    const isHandwritten = options?.writingStyle === 'handwriting' || this.getWritingStyle() === 'handwriting';
    const rectOpts = {
      ...options,
      writingStyle: isHandwritten ? 'handwriting' : options?.writingStyle,
    };
    this.config.canvasAdapter.drawRectangle(x, y, width, height, rectOpts);
    if (options?.label) {
      this.renderBoundLabel(String(options.label), x, y, width, height, options, isHandwritten);
    }
  }

  private renderEllipseWithLabel(
    x: number,
    y: number,
    width: number,
    height: number,
    options: any
  ): void {
    const isHandwritten = options?.writingStyle === 'handwriting' || this.getWritingStyle() === 'handwriting';
    const ellOpts = {
      ...options,
      writingStyle: isHandwritten ? 'handwriting' : options?.writingStyle,
    };
    this.config.canvasAdapter.drawEllipse(x + width / 2, y + height / 2, width, height, ellOpts);
    if (options?.label) {
      this.renderBoundLabel(String(options.label), x, y, width, height, options, isHandwritten);
    }
  }

  private executeShapeCommand(p: ShapePayload): void {
    this.saveStateForUndo();

    const requestedX = p.x;
    const requestedY = p.y;

    // Auto-route standalone mathematical equations sent to write_normal_text ('text') directly to 'math' (KaTeX)
    if (p.shapeType === 'text') {
      const rawText = String(p.options?.text || '').trim();
      const isHeader = (p as any).style === 'title' || p.y <= 130;
      if (!isHeader && CollisionDetector.isStandaloneMathExpression(rawText)) {
        p = {
          ...p,
          shapeType: 'math',
          options: {
            ...p.options,
            latex: CollisionDetector.cleanLatexForMathOverlay(rawText),
            fontSize: p.options?.fontSize ? Math.max(28, p.options.fontSize) : 30,
          },
        };
      }
    }

    // Check Smart In-Place Rewrite Gate for text and math items
    let rewriteSlot: { x: number; y: number } | null = null;
    if (p.shapeType === 'text' || p.shapeType === 'math') {
      const contentStr = String(p.options?.latex || p.options?.text || '');
      rewriteSlot = this.tryReplaceExistingRewrite(contentStr, requestedX, requestedY);
    }

    // 1. Calculate true dimensions using the layout engine
    const bounds = CollisionDetector.getShapeBounds(p);
    const width = bounds.width;
    const height = bounds.height;

    // 2. Find clean, non-overlapping position clamped strictly inside safe margins
    let finalX = rewriteSlot ? rewriteSlot.x : p.x;
    let finalY = rewriteSlot ? rewriteSlot.y : p.y;

    // Diagrams have their own comprehensive auto-layout solver, lines/arrows are connectors, and explicitly dropped media keep their exact canvas position
    const preserveExactPosition = Boolean(p.options?.preserveExactPosition);
    if (
      !rewriteSlot &&
      !preserveExactPosition &&
      p.shapeType !== 'line' &&
      p.shapeType !== 'arrow' &&
      p.shapeType !== 'diagram'
    ) {
      const isHeaderTitle = (p as any).style === 'title' || p.y <= 130;
      const freePos = CollisionDetector.findFreePosition(
        { x: p.x, y: p.y },
        { width, height },
        this.drawnShapes,
        isHeaderTitle,
        p.shapeType
      );

      if (freePos.x === -1 && freePos.y === -1) {
        // Both columns are full! Advance to new slide if configured
        if (this.config.onBoardFull) {
          this.config.onBoardFull();
        }
        finalX = CollisionDetector.COL1_X;
        finalY = 140;
      } else {
        finalX = freePos.x;
        finalY = freePos.y;

        // Optical centering for text shapes placed inside container shapes
        if (p.shapeType === 'text') {
          const parentContainer = this.drawnShapes.find((s) =>
            CollisionDetector.isInsideContainer(finalX, finalY, width, height, s)
          );
          if (parentContainer) {
            const cb = CollisionDetector.getShapeBounds(parentContainer);
            finalX = Math.round(cb.x + Math.max(10, (cb.width - width) / 2));
            finalY = Math.round(cb.y + (cb.height - height) / 2);
          }
        }

        // Auto-enclosure centering when a container shape is drawn to box an existing text/label
        if (p.shapeType === 'rectangle' || p.shapeType === 'ellipse') {
          const targetText = this.drawnShapes.find((s) => {
            const stype = s.shapeType || s.kind;
            if (!['text', 'math', 'handwriting'].includes(stype)) return false;
            const tb = CollisionDetector.getShapeBounds(s);
            const xNear = finalX <= tb.x + 100 && finalX + width >= tb.x + tb.width - 100;
            const yNear = Math.abs(finalY - tb.y) <= 80;
            return xNear && yNear;
          });

          if (targetText) {
            const tb = CollisionDetector.getShapeBounds(targetText);
            // Center the container vertically around the text's baseline:
            finalY = Math.round(tb.y - height / 2 + 5);
            // Center the container horizontally around the text if needed:
            if (Math.abs(finalX - tb.x) < 40 || finalX > tb.x) {
              finalX = Math.round(tb.x - Math.max(15, (width - tb.width) / 2));
            }
          }
        }
      }
    } else if (!rewriteSlot) {
      const clamped = CollisionDetector.clampToBounds(p.x, p.y, width, height);
      finalX = clamped.x;
      finalY = clamped.y;
    }

    // 3. Assign incrementing z-index to the new shape
    const shapeId = (p as any).id || `shape-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const shapeWithZIndex = {
      ...p,
      id: shapeId,
      x: finalX,
      y: finalY,
      requestedX,
      requestedY,
      width,
      height,
      options: {
        ...p.options,
        color: p.options?.color || '#FFFFFF',
        zIndex: this.nextZIndex++,
      },
    };

    // Add to drawn shapes list for collision detection and tracking (diagrams add their subShapes)
    if (p.shapeType !== 'diagram') {
      this.drawnShapes.push(shapeWithZIndex);
    }

    switch (p.shapeType) {
      case 'rectangle':
        this.renderRectangleWithLabel(finalX, finalY, width, height, shapeWithZIndex.options);
        break;
      case 'ellipse':
        this.renderEllipseWithLabel(finalX, finalY, width, height, shapeWithZIndex.options);
        break;
      case 'line':
        this.config.canvasAdapter.drawLine(finalX, finalY, p.toX ?? finalX + 100, p.toY ?? finalY, shapeWithZIndex.options);
        break;
      case 'arrow':
        this.config.canvasAdapter.drawArrow(
          { x: finalX, y: finalY },
          { x: p.toX ?? finalX + 100, y: p.toY ?? finalY },
          shapeWithZIndex.options
        );
        break;
      case 'graph':
        if (this.graphOverlay) {
          const graphOptions = shapeWithZIndex.options || {};
          this.graphOverlay.addGraph({
            title: graphOptions.title || 'Mathematical Function Plot',
            functions: graphOptions.functions || [],
            xRange: graphOptions.xRange || [-3, 3],
            yRange: graphOptions.yRange || [-1, 5],
            shadedRegion: graphOptions.shadedRegion,
            points: graphOptions.points || [],
            showRevolutionDisc: graphOptions.showRevolutionDisc,
            revolutionAxis: graphOptions.revolutionAxis,
            x: finalX,
            y: finalY,
            width,
            height,
          });
        }
        break;
      case 'graph3d':
        if (this.graph3dOverlay) {
          const graphOptions = shapeWithZIndex.options || {};
          this.graph3dOverlay.addGraph3D({
            title: graphOptions.title || '3D Mathematical Surface',
            options: graphOptions,
            x: finalX,
            y: finalY,
            width: width || 500,
            height: height || 420,
          });
        }
        break;
      case 'venn':
        if (this.vennOverlay) {
          const vennOptions = shapeWithZIndex.options || {};
          this.vennOverlay.addVenn({
            id: shapeWithZIndex.id,
            title: vennOptions.title || 'Probability Venn Diagram',
            sets: vennOptions.sets || ['A', 'B'],
            shadedRegions: vennOptions.shadedRegions,
            shadedOperation: vennOptions.shadedOperation,
            labels: vennOptions.labels || {},
            colorTheme: vennOptions.colorTheme || 'cyan_orange',
            x: finalX,
            y: finalY,
            width: width || 480,
            height: height || 380,
          });
        }
        break;
      case 'image':
      case 'video': {
        const rawOpts = shapeWithZIndex.options || {};
        const mOpts = (rawOpts.media || rawOpts || {}) as any;
        this.mediaOverlay?.addMedia({
          id: shapeWithZIndex.id,
          mediaId: mOpts.mediaId || shapeWithZIndex.id,
          mediaType: p.shapeType,
          url: mOpts.url || rawOpts.url || '',
          fileName: mOpts.fileName || rawOpts.label || (p.shapeType === 'video' ? 'Slide Video' : 'Slide Image'),
          mimeType: mOpts.mimeType || (p.shapeType === 'video' ? 'video/mp4' : 'image/png'),
          x: finalX,
          y: finalY,
          width: width || 520,
          height: height || 320,
          naturalWidth: mOpts.naturalWidth,
          naturalHeight: mOpts.naturalHeight,
          durationSec: mOpts.durationSec,
          posterDataUrl: mOpts.posterDataUrl,
          shareAudioWithAI: mOpts.shareAudioWithAI !== false,
        });
        break;
      }
      case 'diagram': {
        const diagramOptions = { ...((shapeWithZIndex.options || {}) as DiagramOptions) };
        if (!diagramOptions.writingStyle) {
          diagramOptions.writingStyle = (this.getWritingStyle() as any) || 'normal';
        }
        if (!diagramOptions.existingShapes) {
          const mappedHandwriting: ShapePayload[] = this.drawnHandwriting.map((h) => {
            const hText = String(h.text || '');
            const hLines = hText.split('\n');
            const maxLineLen = Math.max(...hLines.map((l) => l.length), 10);
            const fs = h.fontSize || 24;
            const estW = Math.min(650, Math.max(200, Math.round(maxLineLen * fs * 0.58)));
            const estH = Math.max(40, hLines.length * Math.round(fs * 1.4));
            return {
              kind: 'shape',
              shapeType: 'text',
              x: h.position?.x ?? 150,
              y: h.position?.y ?? 180,
              width: estW,
              height: estH,
              options: {
                text: hText,
                fontSize: fs,
                maxWidth: estW,
              },
            };
          });
          diagramOptions.existingShapes = [...this.drawnShapes, ...mappedHandwriting];
        }
        const isHandwriting = diagramOptions.writingStyle === 'handwriting' ||
          /handwritten|handwriting/i.test(diagramOptions.title || '') ||
          /handwritten|handwriting/i.test(diagramOptions.root || '');

        const subShapes = DiagramLayoutEngine.generateShapes(diagramOptions);
        for (const sub of subShapes) {
          const subWithDiagram = { ...sub, diagramId: shapeWithZIndex.id };
          this.drawnShapes.push(subWithDiagram);
          const subX = sub.x ?? 0;
          const subY = sub.y ?? 0;
          const subW = sub.width ?? 150;
          const subH = sub.height ?? 60;
          const subOpts = sub.options || {};

          if (sub.shapeType === 'rectangle') {
            this.renderRectangleWithLabel(subX, subY, subW, subH, subOpts);
          } else if (sub.shapeType === 'arrow') {
            this.config.canvasAdapter.drawArrow({ x: subX, y: subY }, { x: sub.toX ?? subX + 100, y: sub.toY ?? subY }, subOpts);
          } else if (sub.shapeType === 'line') {
            this.config.canvasAdapter.drawLine(subX, subY, sub.toX ?? subX + 100, sub.toY ?? subY, subOpts);
          } else if (sub.shapeType === 'text') {
            this.config.canvasAdapter.drawText(subOpts.text || '', subX, subY, {
              ...subOpts,
              fontFamily: subOpts.fontFamily || (isHandwriting ? "'Caveat', cursive, sans-serif" : undefined),
              writingStyle: subOpts.writingStyle || (isHandwriting ? 'handwriting' : undefined),
            });
          }
        }
        break;
      }
      case 'math':
        if (this.mathOverlay) {
          this.mathOverlay.addMath({
            latex: shapeWithZIndex.options?.latex || shapeWithZIndex.options?.text || '',
            x: finalX,
            y: finalY,
            fontSize: shapeWithZIndex.options?.fontSize || 28,
            color: shapeWithZIndex.options?.color || '#FFFFFF',
          });
        }
        break;
      case 'text': {
        // Check if text contains LaTeX formatting or math formulas
        const textOptions = shapeWithZIndex.options as any;
        const textContent = textOptions?.text || '';
        const isLatex = /\\[a-zA-Z]+|[_\^=+\-*/\\]|[\u0370-\u03FF\u2100-\u214F\u2200-\u22FF]/.test(textContent) && textContent.includes('\\');
        const isHandwritten = textOptions?.writingStyle === 'handwriting' || this.getWritingStyle() === 'handwriting';
        
        if (isLatex && this.mathOverlay) {
          this.mathOverlay.addMath({
            latex: textContent,
            x: finalX,
            y: finalY,
            fontSize: textOptions?.fontSize || 28,
            color: textOptions?.color || '#FFFFFF',
          });
        } else {
          this.config.canvasAdapter.drawText(textContent, finalX, finalY, {
            ...textOptions,
            writingStyle: isHandwritten ? 'handwriting' : textOptions?.writingStyle,
            fontFamily: textOptions?.fontFamily || (isHandwritten ? "'Caveat', cursive, sans-serif" : undefined),
          });
        }
        break;
      }
    }

    this.config.onWritingFocus?.({
      x: finalX,
      y: finalY,
      width: Math.max(80, width || 160),
      height: Math.max(40, height || 80),
      kind: p.shapeType,
    });
    this.config.onBoardChange?.();
  }

  private executeHandwritingCommand(p: HandwritingPayload): void {
    const requestedX = p.position.x;
    const requestedY = p.position.y;
    const isHeaderTitle = p.position.y <= 130 || p.style === 'title';

    // Route standalone mathematical equations sent to write_text ('handwriting') directly to MathOverlay (KaTeX)
    if (!isHeaderTitle && p.style !== 'annotation' && CollisionDetector.isStandaloneMathExpression(p.text)) {
      this.executeShapeCommand({
        kind: 'shape',
        shapeType: 'math',
        x: requestedX,
        y: requestedY,
        options: {
          latex: CollisionDetector.cleanLatexForMathOverlay(p.text),
          fontSize: 30,
          color: p.color || '#FFFFFF',
        },
      });
      return;
    }

    this.saveStateForUndo();

    // Check Smart In-Place Rewrite Gate
    let rewriteSlot: { x: number; y: number } | null = null;
    if (p.style !== 'annotation') {
      rewriteSlot = this.tryReplaceExistingRewrite(p.text, requestedX, requestedY);
    }

    const bounds = CollisionDetector.getShapeBounds(p);
    const width = bounds.width;
    const height = bounds.height;

    let finalX = rewriteSlot ? rewriteSlot.x : p.position.x;
    let finalY = rewriteSlot ? rewriteSlot.y : p.position.y;

    if (!rewriteSlot && p.style !== 'annotation') {
      const freePos = CollisionDetector.findFreePosition(
        { x: p.position.x, y: p.position.y },
        { width, height },
        this.drawnShapes,
        isHeaderTitle,
        'handwriting'
      );

      if (freePos.x === -1 && freePos.y === -1) {
        if (this.config.onBoardFull) {
          this.config.onBoardFull();
        }
        finalX = CollisionDetector.COL1_X;
        finalY = 140;
      } else {
        finalX = freePos.x;
        finalY = freePos.y;

        // Optical centering for handwriting inside container shapes (guarantees perfect vertical and horizontal centering)
        const parentContainer = this.drawnShapes.find((s) =>
          CollisionDetector.isInsideContainer(finalX, finalY, width, height, s)
        );
        if (parentContainer) {
          const cb = CollisionDetector.getShapeBounds(parentContainer);
          finalX = Math.round(cb.x + Math.max(10, (cb.width - width) / 2));
          finalY = Math.round(cb.y + cb.height / 2 + 10);
        }
      }
    } else if (!rewriteSlot) {
      const clamped = CollisionDetector.clampToBounds(p.position.x, p.position.y, width, height);
      finalX = clamped.x;
      finalY = clamped.y;
    }

    const hwId = p.id || `hw-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const allowWideElastic = finalX < 900 && CollisionDetector.isRightColumnFreeAtY(this.drawnShapes, finalY, finalY + height);

    const positionedPayload = {
      ...p,
      id: hwId,
      x: finalX,
      y: finalY,
      requestedX,
      requestedY,
      width,
      height,
      allowWideElastic,
      position: { x: finalX, y: finalY },
    };

    this.drawnShapes.push(positionedPayload as any);

    // Ensure charTimings are accurately synced with client AudioClock time
    const currentAudioTime = this.audioClock.currentTime;
    const charDuration = 0.04; // 40ms per character for natural handwriting reveal
    let timings = p.charTimings;

    if (!timings || timings.length === 0 || Math.abs(timings[0].start - currentAudioTime) > 2.0) {
      const chars = [...p.text];
      timings = chars.map((char, idx) => ({
        char,
        start: currentAudioTime + idx * charDuration,
        end: currentAudioTime + (idx + 1) * charDuration,
      }));
    }

    const mappedPayload: HandwritingPayload = {
      ...positionedPayload,
      charTimings: timings,
    };

    this.drawnHandwriting.push(mappedPayload);
    this.config.svgOverlay.addWord(mappedPayload);
    this.config.onWritingFocus?.({
      x: finalX,
      y: Math.max(0, finalY - 36),
      width: Math.max(80, width || 220),
      height: Math.max(40, height || 52),
      kind: 'handwriting',
    });
    this.config.onBoardChange?.();
  }

  public getDrawnShapes(): any[] {
    return [...this.drawnShapes];
  }

  public getDrawnHandwriting(): HandwritingPayload[] {
    return [...this.drawnHandwriting];
  }

  public loadBoard(shapes: any[], handwriting: HandwritingPayload[] = []): void {
    this.drawingQueue.flush();
    this.drawnShapes = [];
    this.drawnHandwriting = [];
    this.config.canvasAdapter.clear();
    this.config.svgOverlay.clear();
    this.mathOverlay?.clear();
    this.graphOverlay?.clear();
    this.graph3dOverlay?.clear();
    this.vennOverlay?.clear();
    this.mediaOverlay?.clear();

    // Re-render canvas shapes and math formulas
    for (const shape of shapes) {
      const x = shape.x ?? shape.position?.x ?? 0;
      const y = shape.y ?? shape.position?.y ?? 0;
      const width = shape.width ?? 150;
      const height = shape.height ?? 100;
      const options = shape.options || {};

      this.drawnShapes.push(shape);

      switch (shape.shapeType) {
        case 'rectangle':
          this.renderRectangleWithLabel(x, y, width, height, options);
          break;
        case 'ellipse':
          this.renderEllipseWithLabel(x, y, width, height, options);
          break;
        case 'line':
          this.config.canvasAdapter.drawLine(x, y, shape.toX ?? x + 100, shape.toY ?? y, options);
          break;
        case 'arrow':
          this.config.canvasAdapter.drawArrow({ x, y }, { x: shape.toX ?? x + 100, y: shape.toY ?? y }, options);
          break;
        case 'graph':
          if (this.graphOverlay) {
            const graphOptions = options || {};
            this.graphOverlay.addGraph({
              title: graphOptions.title || 'Mathematical Function Plot',
              functions: graphOptions.functions || [],
              xRange: graphOptions.xRange || [-3, 3],
              yRange: graphOptions.yRange || [-1, 5],
              shadedRegion: graphOptions.shadedRegion,
              points: graphOptions.points || [],
              showRevolutionDisc: graphOptions.showRevolutionDisc,
              revolutionAxis: graphOptions.revolutionAxis,
              x,
              y,
              width,
              height,
            });
          }
          break;
        case 'graph3d':
          if (this.graph3dOverlay) {
            this.graph3dOverlay.addGraph3D({
              title: options.title || '3D Mathematical Surface',
              options: options,
              x,
              y,
              width: width || 500,
              height: height || 420,
            });
          }
          break;
        case 'venn':
          this.vennOverlay?.addVenn({
            id: shape.id,
            title: options.title || 'Probability Venn Diagram',
            sets: options.sets || ['A', 'B'],
            shadedRegions: options.shadedRegions,
            shadedOperation: options.shadedOperation,
            labels: options.labels || {},
            colorTheme: options.colorTheme || 'cyan_orange',
            x,
            y,
            width: width || 480,
            height: height || 380,
          });
          break;
        case 'image':
        case 'video': {
          const rawOpts = options || {};
          const mOpts = (rawOpts.media || rawOpts || {}) as any;
          this.mediaOverlay?.addMedia({
            id: shape.id,
            mediaId: mOpts.mediaId || shape.id,
            mediaType: shape.shapeType,
            url: mOpts.url || rawOpts.url || '',
            fileName: mOpts.fileName || rawOpts.label || (shape.shapeType === 'video' ? 'Slide Video' : 'Slide Image'),
            mimeType: mOpts.mimeType || (shape.shapeType === 'video' ? 'video/mp4' : 'image/png'),
            x,
            y,
            width: width || 520,
            height: height || 320,
            naturalWidth: mOpts.naturalWidth,
            naturalHeight: mOpts.naturalHeight,
            durationSec: mOpts.durationSec,
            posterDataUrl: mOpts.posterDataUrl,
            shareAudioWithAI: mOpts.shareAudioWithAI !== false,
          });
          break;
        }
        case 'diagram': {
          // If sub-shapes already exist for this diagram, do not regenerate
          const hasChildren = shapes.some((s) => s.diagramId === shape.id) || this.drawnShapes.some((s) => s.diagramId === shape.id);
          if (hasChildren) {
            break;
          }
          const diagramOptions = { ...((options || {}) as DiagramOptions) };
          if (!diagramOptions.writingStyle) {
            diagramOptions.writingStyle = (this.getWritingStyle() as any) || 'normal';
          }
          if (!diagramOptions.existingShapes) {
            const mappedHandwriting: ShapePayload[] = this.drawnHandwriting.map((h) => {
              const hText = String(h.text || '');
              const hLines = hText.split('\n');
              const maxLineLen = Math.max(...hLines.map((l) => l.length), 10);
              const fs = h.fontSize || 24;
              const estW = Math.min(650, Math.max(200, Math.round(maxLineLen * fs * 0.58)));
              const estH = Math.max(40, hLines.length * Math.round(fs * 1.4));
              return {
                kind: 'shape',
                shapeType: 'text',
                x: h.position?.x ?? 150,
                y: h.position?.y ?? 180,
                width: estW,
                height: estH,
                options: {
                  text: hText,
                  fontSize: fs,
                  maxWidth: estW,
                },
              };
            });
            diagramOptions.existingShapes = [
              ...this.drawnShapes.filter((s) => s.id !== shape.id),
              ...mappedHandwriting,
            ];
          }
          const isHandwriting = diagramOptions.writingStyle === 'handwriting' ||
            /handwritten|handwriting/i.test(diagramOptions.title || '') ||
            /handwritten|handwriting/i.test(diagramOptions.root || '');

          const subShapes = DiagramLayoutEngine.generateShapes(diagramOptions);
          for (const sub of subShapes) {
            const subWithDiagram = { ...sub, diagramId: shape.id };
            this.drawnShapes.push(subWithDiagram);
            const subX = sub.x ?? 0;
            const subY = sub.y ?? 0;
            const subW = sub.width ?? 150;
            const subH = sub.height ?? 60;
            const subOpts = sub.options || {};

            if (sub.shapeType === 'rectangle') {
              this.renderRectangleWithLabel(subX, subY, subW, subH, subOpts);
            } else if (sub.shapeType === 'arrow') {
              this.config.canvasAdapter.drawArrow({ x: subX, y: subY }, { x: sub.toX ?? subX + 100, y: sub.toY ?? subY }, subOpts);
            } else if (sub.shapeType === 'text') {
              this.config.canvasAdapter.drawText(subOpts.text || '', subX, subY, {
                ...subOpts,
                fontFamily: subOpts.fontFamily || (isHandwriting ? "'Caveat', cursive, sans-serif" : undefined),
                writingStyle: subOpts.writingStyle || (isHandwriting ? 'handwriting' : undefined),
              });
            }
          }
          break;
        }
        case 'math':
          this.mathOverlay?.addMath({
            latex: options.latex || options.text || '',
            x,
            y,
            fontSize: options.fontSize || 28,
            color: options.color || '#FFFFFF',
          });
          break;
        case 'text': {
          const text = options.text || '';
          const isLatex = /\\[a-zA-Z]+|[_\^=+\-*/\\]/.test(text) && text.includes('\\');
          const isHandwritten = options.writingStyle === 'handwriting' || this.getWritingStyle() === 'handwriting';
          if (isLatex && this.mathOverlay) {
            this.mathOverlay.addMath({
              latex: text,
              x,
              y,
              fontSize: options.fontSize || 24,
              color: options.color || '#FFFFFF',
            });
          } else {
            this.config.canvasAdapter.drawText(text, x, y, {
              ...options,
              fontSize: options.fontSize || 24,
              color: options.color || '#FFFFFF',
              direction: options.direction || 'ltr',
              writingStyle: isHandwritten ? 'handwriting' : options.writingStyle,
              fontFamily: options.fontFamily || (isHandwritten ? "'Caveat', cursive, sans-serif" : undefined),
            });
          }
          break;
        }
      }
    }

    // Re-render handwriting items
    if (handwriting && handwriting.length > 0) {
      this.drawnHandwriting = [...handwriting];
      this.config.svgOverlay.setWords(handwriting);
    }
  }

  private undoStack: Array<{ shapes: any[]; handwriting: HandwritingPayload[] }> = [];
  private redoStack: Array<{ shapes: any[]; handwriting: HandwritingPayload[] }> = [];

  private saveStateForUndo(): void {
    this.undoStack.push({
      shapes: JSON.parse(JSON.stringify(this.drawnShapes)),
      handwriting: JSON.parse(JSON.stringify(this.drawnHandwriting)),
    });
    if (this.undoStack.length > 30) {
      this.undoStack.shift();
    }
  }

  public undo(): boolean {
    if (this.undoStack.length === 0) return false;
    this.redoStack.push({
      shapes: JSON.parse(JSON.stringify(this.drawnShapes)),
      handwriting: JSON.parse(JSON.stringify(this.drawnHandwriting)),
    });
    const previousState = this.undoStack.pop()!;
    this.loadBoard(previousState.shapes, previousState.handwriting);
    this.config.onBoardChange?.();
    return true;
  }

  public redo(): boolean {
    if (this.redoStack.length === 0) return false;
    this.undoStack.push({
      shapes: JSON.parse(JSON.stringify(this.drawnShapes)),
      handwriting: JSON.parse(JSON.stringify(this.drawnHandwriting)),
    });
    const nextState = this.redoStack.pop()!;
    this.loadBoard(nextState.shapes, nextState.handwriting);
    this.config.onBoardChange?.();
    return true;
  }

  public clear(): void {
    this.saveStateForUndo();
    this.redoStack = [];
    this.drawingQueue.flush();
    this.drawnShapes = [];
    this.drawnHandwriting = [];
    this.config.canvasAdapter.clear();
    this.config.svgOverlay.clear();
    this.mathOverlay?.clear();
    this.graphOverlay?.clear();
    this.graph3dOverlay?.clear();
    this.vennOverlay?.clear();
    this.mediaOverlay?.clear();
    this.config.onBoardChange?.();
  }

  public updateShapeGeometry(
    shapeId: string,
    x: number,
    y: number,
    width?: number,
    height?: number
  ): boolean {
    let changed = false;
    for (const s of this.drawnShapes) {
      if (s.id === shapeId) {
        s.x = x;
        s.y = y;
        if (width !== undefined) {
          s.width = width;
          if (s.options) s.options.width = width;
        }
        if (height !== undefined) {
          s.height = height;
          if (s.options) s.options.height = height;
        }
        changed = true;
      }
    }
    if (changed) {
      this.mediaOverlay?.updateMediaGeometry(shapeId, x, y, width, height);
      this.config.onBoardChange?.();
    }
    return changed;
  }

  public removeShapeById(shapeId: string): boolean {
    const idx = this.drawnShapes.findIndex((s) => s.id === shapeId);
    if (idx === -1) return false;
    this.saveStateForUndo();
    this.redoStack = [];
    this.drawnShapes.splice(idx, 1);
    this.mediaOverlay?.removeMedia(shapeId);
    this.config.onBoardChange?.();
    return true;
  }

  /**
   * Erases items matching the target query, or the last item, or graphs/shapes, or clears the board.
   */
  public erase(target: string = 'last'): boolean {
    const q = (target || 'last').trim().toLowerCase();

    if (q === 'redo') {
      return this.redo();
    }

    if (q === 'undo') {
      return this.undo();
    }

    this.saveStateForUndo();
    this.redoStack = [];

    if (q === 'all' || q === 'all_slides' || q === 'current_slide' || q === 'slide' || q === 'board' || q === 'everything') {
      this.clear();
      return true;
    }

    if (q === 'last' || q === 'last_item' || q === 'last_step') {
      if (this.drawnShapes.length > 0) {
        const removed = this.drawnShapes.pop();
        if (removed) {
          this.lastErasedSlot = {
            x: removed.x ?? removed.position?.x ?? CollisionDetector.COL1_X,
            y: removed.y ?? removed.position?.y ?? 180,
            reqX: removed.requestedX ?? removed.x ?? CollisionDetector.COL1_X,
            reqY: removed.requestedY ?? removed.y ?? 180,
            timestamp: Date.now(),
          };
          if (removed.kind === 'handwriting' || removed.shapeType === 'handwriting') {
            const hwIdx = this.drawnHandwriting.findIndex(
              (h) => (h.id && h.id === removed.id) || h.text === removed.text
            );
            if (hwIdx !== -1) {
              this.drawnHandwriting.splice(hwIdx, 1);
            } else if (this.drawnHandwriting.length > 0) {
              this.drawnHandwriting.pop();
            }
          }
        }
        this.loadBoard([...this.drawnShapes], [...this.drawnHandwriting]);
        this.config.onBoardChange?.();
        return true;
      } else if (this.drawnHandwriting.length > 0) {
        const removedHw = this.drawnHandwriting.pop();
        if (removedHw) {
          this.lastErasedSlot = {
            x: removedHw.position.x,
            y: removedHw.position.y,
            reqX: (removedHw as any).requestedX ?? removedHw.position.x,
            reqY: (removedHw as any).requestedY ?? removedHw.position.y,
            timestamp: Date.now(),
          };
        }
        this.loadBoard([...this.drawnShapes], [...this.drawnHandwriting]);
        this.config.onBoardChange?.();
        return true;
      }
      return false;
    }

    if (q === 'graph' || q === 'graph3d' || q === '3d' || q === 'drawing' || q === 'plot' || q === 'coordinate_system' || q === 'curve' || q === 'venn' || q === 'venn_diagram') {
      const before = this.drawnShapes.length;
      this.drawnShapes = this.drawnShapes.filter((s) => s.shapeType !== 'graph' && s.shapeType !== 'graph3d' && s.shapeType !== 'venn');
      this.loadBoard([...this.drawnShapes], [...this.drawnHandwriting]);
      if (this.drawnShapes.length < before) this.config.onBoardChange?.();
      return this.drawnShapes.length < before;
    }

    if (q === 'image' || q === 'images' || q === 'photo' || q === 'picture') {
      const before = this.drawnShapes.length;
      this.drawnShapes = this.drawnShapes.filter((s) => s.shapeType !== 'image');
      this.loadBoard([...this.drawnShapes], [...this.drawnHandwriting]);
      if (this.drawnShapes.length < before) this.config.onBoardChange?.();
      return this.drawnShapes.length < before;
    }

    if (q === 'video' || q === 'videos') {
      const before = this.drawnShapes.length;
      this.drawnShapes = this.drawnShapes.filter((s) => s.shapeType !== 'video');
      this.loadBoard([...this.drawnShapes], [...this.drawnHandwriting]);
      if (this.drawnShapes.length < before) this.config.onBoardChange?.();
      return this.drawnShapes.length < before;
    }

    if (q === 'media') {
      const before = this.drawnShapes.length;
      this.drawnShapes = this.drawnShapes.filter((s) => s.shapeType !== 'image' && s.shapeType !== 'video');
      this.loadBoard([...this.drawnShapes], [...this.drawnHandwriting]);
      if (this.drawnShapes.length < before) this.config.onBoardChange?.();
      return this.drawnShapes.length < before;
    }

    if (q === 'shape' || q === 'shapes' || q === 'diagram') {
      const before = this.drawnShapes.length;
      this.drawnShapes = this.drawnShapes.filter(
        (s) => s.shapeType !== 'rectangle' && s.shapeType !== 'ellipse' && s.shapeType !== 'line' && s.shapeType !== 'arrow' && s.shapeType !== 'diagram'
      );
      this.loadBoard([...this.drawnShapes], [...this.drawnHandwriting]);
      if (this.drawnShapes.length < before) this.config.onBoardChange?.();
      return this.drawnShapes.length < before;
    }

        // Clean query for mathematical and multi-line matching
    const cleanQ = q.replace(/[\s\$\.,:;()\[\]{}'"`\-]/g, '');
    const qFirstLine = (CollisionDetector.splitIntoLogicalLines(q)[0] || q).replace(/[\s\$\.,:;()\[\]{}'"`\-]/g, '');

    // ─── Group / Diagram-Aware Erase ────────────────────────────
    // If target matches a diagram title or diagram group, erase ALL matching shapes in that diagram
    const matchingDiagramTitle = this.drawnShapes.find((s) => {
      const dt = (s.options?.diagramTitle || s.options?.title || '').toLowerCase();
      const cleanDt = dt.replace(/[\s\$\.,:;()\[\]{}'"`\-]/g, '');
      return (
        dt.length > 0 &&
        (dt.includes(q) || q.includes(dt) || (cleanQ.length >= 4 && (cleanDt.includes(cleanQ) || cleanQ.includes(cleanDt))))
      );
    })?.options?.diagramTitle;

    if (matchingDiagramTitle) {
      const matchNorm = matchingDiagramTitle.toLowerCase().trim();
      const beforeCount = this.drawnShapes.length;
      this.drawnShapes = this.drawnShapes.filter((s) => {
        const sDt = (s.options?.diagramTitle || s.options?.title || '').toLowerCase().trim();
        return sDt !== matchNorm;
      });
      if (this.drawnShapes.length < beforeCount) {
        this.loadBoard([...this.drawnShapes], [...this.drawnHandwriting]);
        this.config.onBoardChange?.();
        return true;
      }
    }

    let removedShape = false;
    let removedHandwriting = false;

    // Synchronized Dual-Array Erase: Removes the matched item from BOTH drawnShapes AND drawnHandwriting
    for (let i = this.drawnShapes.length - 1; i >= 0; i--) {
      const s = this.drawnShapes[i];
      const latex = (s.options?.latex || '').toLowerCase();
      const text = (s.options?.text || s.text || '').toLowerCase();
      const title = (s.options?.title || s.options?.fileName || s.options?.diagramTitle || '').toLowerCase();
      const cleanLatex = latex.replace(/[\s\$\\.,:;()\[\]{}'"`\-]/g, '');
      const cleanText = text.replace(/[\s\$\\.,:;()\[\]{}'"`\-]/g, '');
      const sFirstLine = (CollisionDetector.splitIntoLogicalLines(text)[0] || text).replace(/[\s\$\\.,:;()\[\]{}'"`\-]/g, '');

      const matchesQuery =
        latex.includes(q) ||
        text.includes(q) ||
        title.includes(q) ||
        (cleanQ.length > 0 && (
          cleanLatex.includes(cleanQ) ||
          cleanText.includes(cleanQ) ||
          (cleanText.length >= 5 && cleanQ.includes(cleanText)) ||
          (qFirstLine.length >= 6 && sFirstLine.length >= 6 && (sFirstLine.includes(qFirstLine) || qFirstLine.includes(sFirstLine)))
        ));

      if (matchesQuery) {
        if (s.options?.diagramTitle) {
          const dtMatch = s.options.diagramTitle.toLowerCase().trim();
          const beforeCount = this.drawnShapes.length;
          this.drawnShapes = this.drawnShapes.filter(
            (shape) => (shape.options?.diagramTitle || '').toLowerCase().trim() !== dtMatch
          );
          if (this.drawnShapes.length < beforeCount) {
            this.loadBoard([...this.drawnShapes], [...this.drawnHandwriting]);
            this.config.onBoardChange?.();
            return true;
          }
        }
        const [removed] = this.drawnShapes.splice(i, 1);
        removedShape = true;
        if (removed) {
          this.lastErasedSlot = {
            x: removed.x ?? removed.position?.x ?? CollisionDetector.COL1_X,
            y: removed.y ?? removed.position?.y ?? 180,
            reqX: removed.requestedX ?? removed.x ?? CollisionDetector.COL1_X,
            reqY: removed.requestedY ?? removed.y ?? 180,
            timestamp: Date.now(),
          };
          // Crucial fix: Also remove the corresponding handwriting item from drawnHandwriting!
          const hwIdx = this.drawnHandwriting.findIndex((h) => {
            const hTextClean = (h.text || '').toLowerCase().replace(/[\s\$\\.,:;()\[\]{}'"`\-]/g, '');
            return (h.id && h.id === removed.id) || h.text === removed.text || (cleanText.length > 0 && hTextClean === cleanText);
          });
          if (hwIdx !== -1) {
            this.drawnHandwriting.splice(hwIdx, 1);
            removedHandwriting = true;
          }
        }
        break; // Erase ONLY the most recent match
      }
    }

    if (!removedHandwriting) {
      for (let i = this.drawnHandwriting.length - 1; i >= 0; i--) {
        const h = this.drawnHandwriting[i];
        const text = (h.text || '').toLowerCase();
        const cleanText = text.replace(/[\s\$\\.,:;()\[\]{}'"`\-]/g, '');
        const hFirstLine = (CollisionDetector.splitIntoLogicalLines(text)[0] || text).replace(/[\s\$\\.,:;()\[\]{}'"`\-]/g, '');
        if (
          text.includes(q) ||
          (cleanQ.length > 0 && (
            cleanText.includes(cleanQ) ||
            (cleanText.length >= 5 && cleanQ.includes(cleanText)) ||
            (qFirstLine.length >= 6 && hFirstLine.length >= 6 && (hFirstLine.includes(qFirstLine) || qFirstLine.includes(hFirstLine)))
          ))
        ) {
          const [removedHw] = this.drawnHandwriting.splice(i, 1);
          removedHandwriting = true;
          if (removedHw && !removedShape) {
            this.lastErasedSlot = {
              x: removedHw.position.x,
              y: removedHw.position.y,
              reqX: (removedHw as any).requestedX ?? removedHw.position.x,
              reqY: (removedHw as any).requestedY ?? removedHw.position.y,
              timestamp: Date.now(),
            };
            const sIdx = this.drawnShapes.findIndex(
              (s) => (s.id && s.id === removedHw.id) || s.text === removedHw.text
            );
            if (sIdx !== -1) {
              this.drawnShapes.splice(sIdx, 1);
              removedShape = true;
            }
          }
          break;
        }
      }
    }

    this.loadBoard([...this.drawnShapes], [...this.drawnHandwriting]);
    if (removedShape || removedHandwriting) {
      this.config.onBoardChange?.();
    }
    return removedShape || removedHandwriting;
  }

  private executeClearCommand(p: ClearPayload): void {
    if (p.target === 'all') {
      this.clear();
    }
  }

  // ─── Epoch Management ────────────────────────────────────────

  private resetEpoch(newServerEpoch: number): void {
    this.driftCorrector.reset();
    this.driftCorrector.setServerEpoch(newServerEpoch);
    this.driftCorrector.setClientEpoch(this.audioClock.currentTime);
    this.interruptionHandler.handleNewResponse();
  }

  // ─── Telemetry ───────────────────────────────────────────────

  private reportTelemetry(): void {
    if (!this.config.onTelemetry) return;

    this.config.onTelemetry({
      queueDepth: this.drawingQueue.length,
      driftMs: this.driftCorrector.lastDriftMs,
      fps: this.fps,
      heartbeatCount: this.driftCorrector.heartbeatCount,
      interruptionCount: this.interruptionHandler.interruptionCount,
      state: this.interruptionHandler.state,
    });
  }
}
