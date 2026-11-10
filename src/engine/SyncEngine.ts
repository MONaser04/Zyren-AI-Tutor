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
  UpdateItemPayload,
  WhiteboardState,
} from '../types';
import type { ICanvasAdapter } from '../adapters/canvas/ICanvasAdapter';
import type { SVGOverlayHandle } from '../layers/SVGOverlay';
import type { MathOverlayHandle } from '../layers/MathOverlay';
import type { GraphOverlayHandle } from '../layers/GraphOverlay';
import type { Graph3DOverlayHandle } from '../layers/Graph3DOverlay';
import type { VennOverlayHandle } from '../layers/VennOverlay';
import type { QuizOverlayHandle } from '../layers/QuizOverlay';
import type { TableOverlayHandle } from '../layers/TableOverlay';
import type { SlideMediaOverlayHandle } from '../layers/SlideMediaOverlay';
import * as CollisionDetector from './CollisionDetector';
import { DiagramLayoutEngine, calculateNodeBoxSize } from './DiagramLayoutEngine';
import type { DiagramOptions, DiagramNode, TreeModelNode } from '../types';
import {
  buildTreeModelFromOptions,
  cloneTree,
  isSameOrRelatedTree,
  mergeIncomingTreeIntoExisting,
  isContinuationOfFlowchart,
  mergeFlowchartNodes,
  normalizeLabel,
} from './TreeDiagramModel';

interface StoredDiagramMeta {
  diagramId: string;
  diagramTitle: string;
  diagramType: string;
  treeModel?: TreeModelNode;
  flowchartNodes?: DiagramNode[];
  cardItems?: string[];
  baseOptions?: DiagramOptions;
  anchorSlot?: {
    centerX: number;
    topY: number;
    minX: number;
    maxX: number;
  };
}

export interface SyncEngineConfig {
  canvasAdapter: ICanvasAdapter;
  svgOverlay: SVGOverlayHandle;
  mathOverlay?: MathOverlayHandle;
  graphOverlay?: GraphOverlayHandle;
  graph3dOverlay?: Graph3DOverlayHandle;
  vennOverlay?: VennOverlayHandle;
  mediaOverlay?: SlideMediaOverlayHandle;
  quizOverlay?: QuizOverlayHandle;
  tableOverlay?: TableOverlayHandle;
  getMathOverlay?: () => MathOverlayHandle | null | undefined;
  getGraphOverlay?: () => GraphOverlayHandle | null | undefined;
  getGraph3DOverlay?: () => Graph3DOverlayHandle | null | undefined;
  getVennOverlay?: () => VennOverlayHandle | null | undefined;
  getMediaOverlay?: () => SlideMediaOverlayHandle | null | undefined;
  getQuizOverlay?: () => QuizOverlayHandle | null | undefined;
  getTableOverlay?: () => TableOverlayHandle | null | undefined;
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

  private get quizOverlay(): QuizOverlayHandle | undefined {
    return this.config.getQuizOverlay?.() ?? this.config.quizOverlay ?? undefined;
  }

  private get tableOverlay(): TableOverlayHandle | undefined {
    return this.config.getTableOverlay?.() ?? this.config.tableOverlay ?? undefined;
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
        this.loadBoard([...this.drawnShapes], [...this.drawnHandwriting], false);
        return slot;
      }
    }

    return null;
  }

  private mapHandwritingToShapes(): ShapePayload[] {
    return this.drawnHandwriting.map((h) => {
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
  }

  private collectStoredDiagrams(): StoredDiagramMeta[] {
    const seen = new Set<string>();
    const list: StoredDiagramMeta[] = [];
    for (let i = this.drawnShapes.length - 1; i >= 0; i--) {
      const s = this.drawnShapes[i];
      const meta = (s?.options?.diagramMeta || s?.diagramMeta) as StoredDiagramMeta | undefined;
      if (meta && meta.diagramId && !seen.has(meta.diagramId)) {
        seen.add(meta.diagramId);
        list.push(meta);
      }
    }
    return list;
  }

  /**
   * Computes the current canvas anchor (centerX, topY, slotMinX, slotMaxX) of an existing diagram
   * so in-place updates and evolutions stay locked at the diagram's home position instead of
   * being re-allocated into another column or corner.
   */
  private computeDiagramAnchor(
    diagramId: string,
    existingMeta?: StoredDiagramMeta
  ): { centerX: number; topY: number; minX: number; maxX: number } | undefined {
    const diagShapes = this.drawnShapes.filter((s) => s.diagramId === diagramId);
    if (diagShapes.length === 0) {
      return existingMeta?.anchorSlot;
    }

    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    for (const s of diagShapes) {
      if (s.shapeType === 'line' || s.shapeType === 'arrow') {
        const sx = s.x ?? 0;
        const sy = s.y ?? 0;
        const toX = s.toX ?? sx;
        const toY = s.toY ?? sy;
        minX = Math.min(minX, sx, toX);
        maxX = Math.max(maxX, sx, toX);
        minY = Math.min(minY, sy, toY);
      } else {
        const sx = s.x ?? 0;
        const sy = s.y ?? 0;
        const sw = s.width ?? (s.options?.maxWidth ?? 200);
        minX = Math.min(minX, sx);
        maxX = Math.max(maxX, sx + sw);
        minY = Math.min(minY, sy);
      }
    }

    if (!Number.isFinite(minX) || !Number.isFinite(maxX) || !Number.isFinite(minY)) {
      return existingMeta?.anchorSlot;
    }

    const centerX = Math.round((minX + maxX) / 2);
    const topY = Math.round(minY);
    const isCentered = (minX < 960 && maxX > 960) || Math.abs(centerX - 960) <= 250;
    const slotMinX = existingMeta?.anchorSlot?.minX ?? (isCentered ? 140 : maxX <= 960 ? 140 : 980);
    const slotMaxX = existingMeta?.anchorSlot?.maxX ?? (isCentered ? 1780 : minX >= 960 ? 1780 : 940);

    return {
      centerX,
      topY,
      minX: slotMinX,
      maxX: slotMaxX,
    };
  }

  /**
   * When an existing diagram expands downward in place (e.g. adding child tiers or bullet items),
   * smoothly pushes down any standalone shapes located underneath the diagram that would otherwise
   * be overlapped by the newly grown diagram bottom.
   */
  private pushDownOverlappingShapesBelowDiagram(diagramId: string, diagramTopY: number): void {
    const diagShapes = this.drawnShapes.filter(
      (s) => s.diagramId === diagramId && s.shapeType !== 'line' && s.shapeType !== 'arrow'
    );
    if (diagShapes.length === 0) return;

    let requiredShiftDown = 0;
    for (const other of this.drawnShapes) {
      if (other.diagramId === diagramId) continue;
      if (other.shapeType === 'line' || other.shapeType === 'arrow') continue;
      const ob = CollisionDetector.getShapeBounds(other);
      if (ob.y < diagramTopY - 10) continue;

      for (const ds of diagShapes) {
        const db = CollisionDetector.getShapeBounds(ds);
        const horizOverlap = ob.x < db.x + db.width + 12 && ob.x + ob.width > db.x - 12;
        const vertOverlap = ob.y < db.y + db.height + 18 && ob.y + ob.height > db.y - 12;
        if (horizOverlap && vertOverlap) {
          const needed = db.y + db.height + 24 - ob.y;
          if (needed > requiredShiftDown) {
            requiredShiftDown = needed;
          }
        }
      }
    }

    if (requiredShiftDown > 0) {
      let diagMinX = Infinity;
      let diagMaxX = -Infinity;
      for (const ds of diagShapes) {
        const db = CollisionDetector.getShapeBounds(ds);
        diagMinX = Math.min(diagMinX, db.x);
        diagMaxX = Math.max(diagMaxX, db.x + db.width);
      }

      for (const other of this.drawnShapes) {
        if (other.diagramId === diagramId) continue;
        const ob = CollisionDetector.getShapeBounds(other);
        if (ob.y >= diagramTopY && ob.x < diagMaxX + 20 && ob.x + ob.width > diagMinX - 20) {
          other.y = Math.min(1020 - (ob.height || 40), (other.y ?? 0) + requiredShiftDown);
          if (other.toY !== undefined) {
            other.toY += requiredShiftDown;
          }
        }
      }
    }
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

    if (p.options?.text && typeof p.options.text === 'string' && (p.options.text.includes('\\n') || p.options.text.includes('\\t'))) {
      p = {
        ...p,
        options: {
          ...p.options,
          text: p.options.text.replace(/\\n/g, '\n').replace(/\\t/g, ' '),
        },
      };
    }
    if (p.options?.label && typeof p.options.label === 'string' && (p.options.label.includes('\\n') || p.options.label.includes('\\t'))) {
      p = {
        ...p,
        options: {
          ...p.options,
          label: p.options.label.replace(/\\n/g, '\n').replace(/\\t/g, ' '),
        },
      };
    }

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
    let width = bounds.width;
    let height = bounds.height;

    // Support Symbiosis slot / attachToNode for text, math, and concept notes
    const attachTo = (p.options?.attachToNode || (p as any).attach_to_node || '').trim().toLowerCase();
    const slotReq = (p.options?.slot || (p as any).slot || '').trim().toLowerCase();

    if (attachTo && (p.shapeType === 'text' || p.shapeType === 'math')) {
      const matchedNode = this.drawnShapes.find((s) => {
        if (s.shapeType !== 'rectangle') return false;
        const l = (s.options?.label || s.label || '').toLowerCase();
        return l.includes(attachTo);
      });
      if (matchedNode) {
        const mw = matchedNode.width ?? 140;
        const mh = matchedNode.height ?? 50;
        const mx = matchedNode.x ?? 0;
        const my = matchedNode.y ?? 0;
        const mCenterX = mx + mw / 2;
        const mBottom = my + mh;

        const trackMinX = mCenterX - width / 2;
        const trackMaxX = mCenterX + width / 2;
        const colObstacles = this.drawnShapes.filter((s) => {
          if (s === matchedNode || s.shapeType === 'line' || s.shapeType === 'arrow') return false;
          const sx = s.x ?? 0;
          const sw = s.width ?? 140;
          return sx < trackMaxX + 10 && sx + sw > trackMinX - 10;
        });

        const maxBottom = colObstacles.length > 0
          ? Math.max(mBottom, ...colObstacles.map((s) => (s.y ?? 0) + (s.height ?? 45)))
          : mBottom;

        p.x = Math.round(mCenterX - width / 2);
        p.y = maxBottom + 25;
      }
    } else if (slotReq === 'side_notes' || slotReq === 'margin' || slotReq === 'side_notes_left') {
      const targetX = 140;
      const marginObstacles = this.drawnShapes.filter((s) => {
        if (s.shapeType === 'line' || s.shapeType === 'arrow') return false;
        const sx = s.x ?? 0;
        const sw = s.width ?? 140;
        return sx < targetX + width + 10 && sx + sw > targetX - 10;
      });
      const maxBottom = marginObstacles.length > 0
        ? Math.max(140, ...marginObstacles.map((s) => (s.y ?? 0) + (s.height ?? 45)))
        : 140;
      p.x = targetX;
      p.y = maxBottom + 25;
    } else if (slotReq === 'side_notes_right') {
      const targetX = 1460;
      const marginObstacles = this.drawnShapes.filter((s) => {
        if (s.shapeType === 'line' || s.shapeType === 'arrow') return false;
        const sx = s.x ?? 0;
        const sw = s.width ?? 140;
        return sx < targetX + width + 10 && sx + sw > targetX - 10;
      });
      const maxBottom = marginObstacles.length > 0
        ? Math.max(140, ...marginObstacles.map((s) => (s.y ?? 0) + (s.height ?? 45)))
        : 140;
      p.x = targetX;
      p.y = maxBottom + 25;
    }

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
      case 'quiz':
        if (this.quizOverlay) {
          const qOpts = shapeWithZIndex.options || {};
          this.quizOverlay.addQuiz({
            id: shapeWithZIndex.id,
            quizId: shapeWithZIndex.id,
            quizType: qOpts.quizType || 'multiple_choice',
            question: qOpts.question || shapeWithZIndex.label || 'Quiz Question',
            options: qOpts.options,
            pairs: qOpts.pairs,
            blankSentence: qOpts.blankSentence,
            acceptedAnswers: qOpts.acceptedAnswers,
            explanation: qOpts.explanation,
            colorTheme: qOpts.colorTheme || 'cyan',
            position: qOpts.position || 'auto',
            x: finalX,
            y: finalY,
            width: width || 520,
            height: height || 360,
            status: qOpts.status || 'active',
          });
        }
        break;
      case 'table':
        if (this.tableOverlay) {
          const tOpts = shapeWithZIndex.options || {};
          this.tableOverlay.addTable({
            id: shapeWithZIndex.id,
            title: tOpts.title || shapeWithZIndex.label || '',
            columns: tOpts.columns || ['Column 1', 'Column 2'],
            rows: tOpts.rows || [],
            theme: tOpts.theme || 'cyan',
            position: tOpts.position || 'auto',
            fontSize: tOpts.fontSize,
            compact: tOpts.compact,
            x: finalX,
            y: finalY,
            width: width,
            height: height,
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
        const mappedHandwriting = this.mapHandwritingToShapes();
        const storedDiagrams = this.collectStoredDiagrams();
        const rawDType = (diagramOptions.diagramType || 'tree').toLowerCase();

        let effectiveDiagramId = shapeWithZIndex.id || `diagram-${Date.now()}-${Math.random()}`;
        let effectiveOptions: DiagramOptions = { ...diagramOptions };
        let effectiveMeta: StoredDiagramMeta | null = null;
        let didReplaceExisting = false;

        // 1. Check in-place Flowchart continuation / evolution (e.g. extending 15 boxes -> 30 boxes)
        for (const meta of storedDiagrams) {
          if (
            meta.flowchartNodes &&
            meta.flowchartNodes.length > 0 &&
            isContinuationOfFlowchart(meta.flowchartNodes, meta.diagramTitle, diagramOptions)
          ) {
            const anchor = this.computeDiagramAnchor(meta.diagramId, meta);
            const mergedNodes = mergeFlowchartNodes(meta.flowchartNodes, diagramOptions.nodes || []);
            this.drawnShapes = this.drawnShapes.filter((s) => s.diagramId !== meta.diagramId);
            effectiveDiagramId = meta.diagramId;
            effectiveOptions = {
              ...(meta.baseOptions || {}),
              ...diagramOptions,
              diagramType: 'flowchart',
              direction: diagramOptions.direction || meta.baseOptions?.direction || 'LR',
              title: meta.diagramTitle || diagramOptions.title,
              attachToNode: undefined,
              nodes: mergedNodes,
              inPlaceAnchor: anchor,
              existingShapes: [...this.drawnShapes, ...mappedHandwriting],
            };
            effectiveMeta = {
              diagramId: effectiveDiagramId,
              diagramTitle: effectiveOptions.title || meta.diagramTitle || '',
              diagramType: 'flowchart',
              flowchartNodes: mergedNodes,
              anchorSlot: anchor,
              baseOptions: { ...effectiveOptions, existingShapes: undefined, inPlaceAnchor: undefined },
            };
            didReplaceExisting = true;
            break;
          }
        }

        // 2. Check in-place Concept-Tree evolution / sub-branch expansion / placeholder replacement
        if (!didReplaceExisting && rawDType === 'tree') {
          const incomingTree = buildTreeModelFromOptions(diagramOptions);

          for (const meta of storedDiagrams) {
            if (
              meta.treeModel &&
              isSameOrRelatedTree(
                meta.treeModel,
                meta.diagramTitle,
                incomingTree,
                diagramOptions.title || '',
                diagramOptions.attachToNode
              )
            ) {
              const candidateTree = cloneTree(meta.treeModel);
              if (
                mergeIncomingTreeIntoExisting(
                  candidateTree,
                  incomingTree,
                  diagramOptions.attachToNode,
                  diagramOptions.title
                )
              ) {
                const anchor = this.computeDiagramAnchor(meta.diagramId, meta);
                this.drawnShapes = this.drawnShapes.filter((s) => s.diagramId !== meta.diagramId);
                effectiveDiagramId = meta.diagramId;
                effectiveOptions = {
                  ...(meta.baseOptions || {}),
                  ...diagramOptions,
                  diagramType: 'tree',
                  title: meta.diagramTitle || diagramOptions.title,
                  root: candidateTree.label || meta.baseOptions?.root || diagramOptions.root,
                  attachToNode: undefined,
                  treeModel: candidateTree,
                  inPlaceAnchor: anchor,
                  existingShapes: [...this.drawnShapes, ...mappedHandwriting],
                };
                effectiveMeta = {
                  diagramId: effectiveDiagramId,
                  diagramTitle: effectiveOptions.title || candidateTree.label || '',
                  diagramType: 'tree',
                  treeModel: candidateTree,
                  anchorSlot: anchor,
                  baseOptions: {
                    ...effectiveOptions,
                    existingShapes: undefined,
                    treeModel: undefined,
                    inPlaceAnchor: undefined,
                  },
                };
                didReplaceExisting = true;
                break;
              }
            }
          }

          // Also support upgrading a standalone root rectangle box into a tree in place
          if (!didReplaceExisting) {
            const matchTarget = normalizeLabel(diagramOptions.attachToNode || incomingTree.label);
            if (matchTarget) {
              const standaloneIdx = this.drawnShapes.findIndex((s) => {
                if (s.diagramId || s.shapeType !== 'rectangle') return false;
                const sLbl = normalizeLabel(s.options?.label || s.options?.text || '');
                return Boolean(sLbl && sLbl === matchTarget);
              });
              if (standaloneIdx !== -1) {
                const standaloneShape = this.drawnShapes[standaloneIdx];
                const stLabel = (standaloneShape.options?.label || standaloneShape.options?.text || '').trim();
                const stX = standaloneShape.x ?? 400;
                const stY = standaloneShape.y ?? 180;
                const stW = standaloneShape.width ?? 200;
                const stCenterX = Math.round(stX + stW / 2);
                const stAnchor = {
                  centerX: stCenterX,
                  topY: Math.round(stY),
                  minX: 140,
                  maxX: 1780,
                };
                const candidateTree: TreeModelNode = { label: stLabel, items: [], children: [] };
                if (
                  mergeIncomingTreeIntoExisting(
                    candidateTree,
                    incomingTree,
                    diagramOptions.attachToNode,
                    diagramOptions.title
                  )
                ) {
                  this.drawnShapes.splice(standaloneIdx, 1);
                  effectiveOptions = {
                    ...diagramOptions,
                    diagramType: 'tree',
                    root: candidateTree.label,
                    attachToNode: undefined,
                    treeModel: candidateTree,
                    inPlaceAnchor: stAnchor,
                    existingShapes: [...this.drawnShapes, ...mappedHandwriting],
                  };
                  effectiveMeta = {
                    diagramId: effectiveDiagramId,
                    diagramTitle: effectiveOptions.title || candidateTree.label || '',
                    diagramType: 'tree',
                    treeModel: candidateTree,
                    anchorSlot: stAnchor,
                    baseOptions: {
                      ...effectiveOptions,
                      existingShapes: undefined,
                      treeModel: undefined,
                      inPlaceAnchor: undefined,
                    },
                  };
                  didReplaceExisting = true;
                }
              }
            }
          }

          if (!effectiveMeta) {
            effectiveOptions.treeModel = incomingTree;
            effectiveMeta = {
              diagramId: effectiveDiagramId,
              diagramTitle: diagramOptions.title || incomingTree.label || '',
              diagramType: 'tree',
              treeModel: incomingTree,
              baseOptions: { ...diagramOptions, existingShapes: undefined, treeModel: undefined },
            };
          }
        }

        // 3. Check in-place Concept-Card evolution / refinement
        if (!didReplaceExisting && (rawDType === 'concept_card' || rawDType === 'card')) {
          const incomingTitleNorm = normalizeLabel(diagramOptions.title || diagramOptions.root || '');
          const incomingAttachNorm = normalizeLabel(diagramOptions.attachToNode || '');
          const incomingItems = diagramOptions.items || (diagramOptions.nodes ? diagramOptions.nodes.map((n) => n.label) : []);

          for (const meta of storedDiagrams) {
            if (meta.diagramType === 'concept_card' || meta.diagramType === 'card') {
              const metaTitleNorm = normalizeLabel(meta.diagramTitle || '');
              const titlesMatch =
                metaTitleNorm.length > 0 &&
                incomingTitleNorm.length > 0 &&
                (metaTitleNorm === incomingTitleNorm ||
                  metaTitleNorm.includes(incomingTitleNorm) ||
                  incomingTitleNorm.includes(metaTitleNorm));

              const attachMatches =
                incomingAttachNorm.length > 0 &&
                metaTitleNorm.length > 0 &&
                (metaTitleNorm.includes(incomingAttachNorm) || incomingAttachNorm.includes(metaTitleNorm));

              if (titlesMatch || attachMatches) {
                const anchor = this.computeDiagramAnchor(meta.diagramId, meta);
                this.drawnShapes = this.drawnShapes.filter((s) => s.diagramId !== meta.diagramId);
                effectiveDiagramId = meta.diagramId;
                const mergedItems = incomingItems.length > 0 ? incomingItems : (meta.cardItems || []);
                const cleanMerged = (mergedItems || []).filter((x): x is string => typeof x === 'string');
                effectiveOptions = {
                  ...(meta.baseOptions || {}),
                  ...diagramOptions,
                  diagramType: 'concept_card',
                  title: diagramOptions.title || meta.diagramTitle,
                  items: cleanMerged,
                  inPlaceAnchor: anchor,
                  existingShapes: [...this.drawnShapes, ...mappedHandwriting],
                };
                effectiveMeta = {
                  diagramId: effectiveDiagramId,
                  diagramTitle: effectiveOptions.title || meta.diagramTitle || '',
                  diagramType: 'concept_card',
                  cardItems: cleanMerged,
                  anchorSlot: anchor,
                  baseOptions: {
                    ...effectiveOptions,
                    existingShapes: undefined,
                    inPlaceAnchor: undefined,
                  },
                };
                didReplaceExisting = true;
                break;
              }
            }
          }

          if (!effectiveMeta) {
            const cleanIncoming = (incomingItems || []).filter((x): x is string => typeof x === 'string');
            effectiveMeta = {
              diagramId: effectiveDiagramId,
              diagramTitle: diagramOptions.title || diagramOptions.root || '',
              diagramType: 'concept_card',
              cardItems: cleanIncoming,
              baseOptions: { ...diagramOptions, existingShapes: undefined },
            };
          }
        }

        if (!effectiveMeta) {
          const isFlow = rawDType === 'flowchart' || rawDType === 'process' || rawDType === 'hybrid';
          const isCard = rawDType === 'concept_card' || rawDType === 'card';
          const incomingItems = (diagramOptions.items || (diagramOptions.nodes ? diagramOptions.nodes.map((n) => n.label) : [])).filter((x): x is string => typeof x === 'string');
          effectiveMeta = {
            diagramId: effectiveDiagramId,
            diagramTitle: diagramOptions.title || diagramOptions.root || '',
            diagramType: isFlow ? 'flowchart' : isCard ? 'concept_card' : rawDType,
            ...(isFlow ? { flowchartNodes: [...(diagramOptions.nodes || [])] } : {}),
            ...(isCard ? { cardItems: incomingItems } : {}),
            baseOptions: { ...diagramOptions, existingShapes: undefined },
          };
        }

        if (!effectiveOptions.existingShapes) {
          effectiveOptions.existingShapes = [...this.drawnShapes, ...mappedHandwriting];
        }
        const isHandwriting = effectiveOptions.writingStyle === 'handwriting' ||
          /handwritten|handwriting/i.test(effectiveOptions.title || '') ||
          /handwritten|handwriting/i.test(effectiveOptions.root || '');

        const subShapes = DiagramLayoutEngine.generateShapes(effectiveOptions);
        let dMinX = Infinity;
        let dMinY = Infinity;
        let dMaxX = -Infinity;
        let dMaxY = -Infinity;

        subShapes.forEach((sub, idx) => {
          const subW = sub.width ?? 150;
          const subH = sub.height ?? 60;
          const subWithDiagram = {
            ...sub,
            diagramId: effectiveDiagramId,
            width: subW,
            height: subH,
            options: {
              ...sub.options,
              diagramTitle: effectiveMeta!.diagramTitle,
              ...(idx === 0 ? { diagramMeta: effectiveMeta } : {}),
            },
          };
          this.drawnShapes.push(subWithDiagram);
          const subX = sub.x ?? 0;
          const subY = sub.y ?? 0;
          const subOpts = sub.options || {};

          dMinX = Math.min(dMinX, subX);
          dMinY = Math.min(dMinY, subY);
          dMaxX = Math.max(dMaxX, subX + subW, sub.toX ?? subX);
          dMaxY = Math.max(dMaxY, subY + subH, sub.toY ?? subY);

          if (!didReplaceExisting) {
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
        });

        if (Number.isFinite(dMinX) && Number.isFinite(dMaxX) && dMaxX > dMinX && effectiveMeta) {
          const cX = Math.round((dMinX + dMaxX) / 2);
          const isCentered = (dMinX < 960 && dMaxX > 960) || Math.abs(cX - 960) <= 250;
          effectiveMeta.anchorSlot = {
            centerX: cX,
            topY: Math.round(dMinY),
            minX: effectiveMeta.anchorSlot?.minX ?? (isCentered ? 140 : dMaxX <= 960 ? 140 : 980),
            maxX: effectiveMeta.anchorSlot?.maxX ?? (isCentered ? 1780 : dMinX >= 960 ? 1780 : 940),
          };
          finalX = dMinX;
          finalY = dMinY;
          width = dMaxX - dMinX;
          height = Math.max(80, dMaxY - dMinY);
        }

        if (didReplaceExisting) {
          this.pushDownOverlappingShapesBelowDiagram(effectiveDiagramId, Math.round(dMinY));
          this.loadBoard([...this.drawnShapes], [...this.drawnHandwriting], false);
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
        // Check if text contains standalone LaTeX formatting or math formulas
        const textOptions = shapeWithZIndex.options as any;
        const textContent = String(textOptions?.text || '').replace(/\\n/g, '\n').replace(/\\t/g, ' ');
        const isLatex = CollisionDetector.isStandaloneMathExpression(textContent);
        const isHandwritten = textOptions?.writingStyle === 'handwriting' || this.getWritingStyle() === 'handwriting';
        
        if (isLatex && this.mathOverlay) {
          this.mathOverlay.addMath({
            latex: CollisionDetector.cleanLatexForMathOverlay(textContent),
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
    if (typeof p.text === 'string' && (p.text.includes('\\n') || p.text.includes('\\t'))) {
      p = {
        ...p,
        text: p.text.replace(/\\n/g, '\n').replace(/\\t/g, ' '),
      };
    }
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

  public getSpatialLayout(): {
    leftColumn: { occupied: boolean; summary: string[]; freeHeight: number };
    rightColumn: { occupied: boolean; summary: string[]; freeHeight: number };
    bottomZone: { occupied: boolean; summary: string[]; freeHeight: number };
    nodes: Array<{ label: string; x: number; y: number; width: number; height: number; centerX: number; bottom: number }>;
    availableSlots: Array<{
      name: string;
      description: string;
      targetNode?: string;
      type: 'under_node' | 'margin' | 'bottom';
      centerX?: number;
      freeHeight: number;
      isAvailable: boolean;
    }>;
    layoutSummary: string;
    isSlideSaturated: boolean;
    boardAudit: {
      status: 'CLEAN' | 'WARNING';
      anomalies: string[];
      elementCount: number;
      activeDiagrams: string[];
      recentItems: string[];
    };
  } {
    const SAFE_MIN_Y = 140;
    const SAFE_MAX_Y = 980;
    const allShapes = [...this.drawnShapes];
    const solid = allShapes.filter((s) => {
      if (s.shapeType === 'line' || s.shapeType === 'arrow') return false;
      if ((s.y ?? 0) <= 130 || (s as any).style === 'title' || s.options?.style === 'title') return false;
      return true;
    });

    const getLabel = (s: any): string => {
      const txt = (
        s.options?.diagramTitle ||
        s.options?.label ||
        s.label ||
        s.options?.text ||
        s.text ||
        s.options?.title ||
        s.shapeType ||
        ''
      ).trim();
      return txt.replace(/^[•\-\*⇒\s]+/, '').slice(0, 32);
    };

    const left = solid.filter((s) => (s.x ?? 0) + (s.width ?? 140) / 2 < 960);
    const right = solid.filter((s) => (s.x ?? 0) + (s.width ?? 140) / 2 >= 960);

    const leftBottom = left.length > 0 ? Math.max(...left.map((s) => (s.y ?? 0) + (s.height ?? 45))) : SAFE_MIN_Y;
    const rightBottom = right.length > 0 ? Math.max(...right.map((s) => (s.y ?? 0) + (s.height ?? 45))) : SAFE_MIN_Y;
    const allBottom = solid.length > 0 ? Math.max(...solid.map((s) => (s.y ?? 0) + (s.height ?? 45))) : SAFE_MIN_Y;

    const leftSummary = Array.from(new Set(left.map(getLabel).filter(Boolean))).slice(0, 4);
    const rightSummary = Array.from(new Set(right.map(getLabel).filter(Boolean))).slice(0, 4);
    const bottomSummary = Array.from(new Set(solid.filter((s) => (s.y ?? 0) >= 500).map(getLabel).filter(Boolean))).slice(0, 4);

    const leftFree = Math.max(0, SAFE_MAX_Y - leftBottom);
    const rightFree = Math.max(0, SAFE_MAX_Y - rightBottom);
    const bottomFree = Math.max(0, SAFE_MAX_Y - allBottom);

    const prominentNodes = solid
      .filter((s) => s.shapeType === 'rectangle' && (s.options?.label || s.label))
      .map((s) => ({
        label: (s.options?.label || s.label || '').trim(),
        x: s.x ?? 0,
        y: s.y ?? 0,
        width: s.width ?? 140,
        height: s.height ?? 50,
        centerX: Math.round((s.x ?? 0) + (s.width ?? 140) / 2),
        bottom: Math.round((s.y ?? 0) + (s.height ?? 50)),
      }));

    const availableSlots: Array<{
      name: string;
      description: string;
      targetNode?: string;
      type: 'under_node' | 'margin' | 'bottom';
      centerX?: number;
      freeHeight: number;
      isAvailable: boolean;
    }> = [];

    for (const node of prominentNodes) {
      const nodeLeft = node.x;
      const nodeRight = node.x + node.width;
      const trackObstacles = solid.filter((s) => {
        if (s.options?.label === node.label || s.label === node.label) return false;
        const sx = s.x ?? 0;
        const sw = s.width ?? 140;
        const sy = s.y ?? 0;
        const horizOverlap = sx < nodeRight - 15 && sx + sw > nodeLeft + 15;
        return horizOverlap && sy >= node.bottom - 10;
      });
      const colMaxBottom = trackObstacles.length > 0
        ? Math.max(node.bottom, ...trackObstacles.map((s) => (s.y ?? 0) + (s.height ?? 45)))
        : node.bottom;
      const freeH = Math.max(0, SAFE_MAX_Y - colMaxBottom);
      availableSlots.push({
        name: `under_${node.label.toLowerCase().replace(/[^a-z0-9]+/g, '_').slice(0, 24)}`,
        description: `Directly below '${node.label}'`,
        targetNode: node.label,
        type: 'under_node',
        centerX: node.centerX,
        freeHeight: freeH,
        isAvailable: freeH >= 140,
      });
    }

    availableSlots.push({
      name: 'side_notes_left',
      description: 'Left margin notes area',
      type: 'margin',
      freeHeight: leftFree,
      isAvailable: leftFree >= 120,
    });
    availableSlots.push({
      name: 'side_notes_right',
      description: 'Right margin notes area',
      type: 'margin',
      freeHeight: rightFree,
      isAvailable: rightFree >= 120,
    });

    const availableNodeSlots = availableSlots.filter((s) => s.type === 'under_node' && s.isAvailable);
    const bothColumnsFull = leftFree < 200 && rightFree < 200;
    const isSaturated =
      bothColumnsFull ||
      (bottomFree < 120 && leftFree < 260 && rightFree < 260) ||
      (prominentNodes.length >= 6 && availableNodeSlots.length === 0 && leftFree < 260 && rightFree < 260);

    const nodeNames = prominentNodes.map((n) => `'${n.label}'`).join(', ');
    const openSlots = availableSlots.filter((s) => s.isAvailable).map((s) => s.description).join('; ');
    const layoutSummary = prominentNodes.length > 0
      ? `Active nodes: [${nodeNames}]. Available slots: [${openSlots || 'None - Slide is Full'}]. Slide saturated: ${isSaturated}`
      : `Board is mostly blank. Available for new diagrams or notes.`;

    // Self-Review / Board Audit for real-time AI quality assurance
    const anomalies: string[] = [];
    const activeDiagramSet = new Set<string>();
    for (const s of allShapes) {
      const dt = (s.options?.diagramTitle || s.diagramMeta?.diagramTitle || '').trim();
      if (dt) activeDiagramSet.add(dt);
      const rawTxt = String(s.options?.text || s.options?.label || s.options?.latex || s.text || '').trim();
      if (/^(•\s*)?(\.{2,}|sub-?topic|placeholder|todo|tbd)$/i.test(rawTxt)) {
        anomalies.push(`Placeholder or incomplete text detected: "${rawTxt}"`);
      }
      if (rawTxt.includes('\\n')) {
        anomalies.push(`Unescaped literal \\n detected in "${rawTxt.slice(0, 30)}"`);
      }
      const b = CollisionDetector.getShapeBounds(s);
      if (s.shapeType !== 'line' && s.shapeType !== 'arrow') {
        if (b.x < 10 || b.x + b.width > 1910 || b.y + b.height > 1065) {
          anomalies.push(`Item "${getLabel(s)}" is near/outside canvas edge (${Math.round(b.x)}, ${Math.round(b.y)})`);
        }
      }
    }

    // Check pairwise text/box overlap among solid elements
    for (let i = 0; i < solid.length; i++) {
      for (let j = i + 1; j < solid.length; j++) {
        const a = solid[i];
        const b = solid[j];
        if (a.diagramId && b.diagramId && a.diagramId === b.diagramId) continue;
        const ba = CollisionDetector.getShapeBounds(a);
        const bb = CollisionDetector.getShapeBounds(b);
        if (
          CollisionDetector.isInsideContainer(ba.x, ba.y, ba.width, ba.height, b) ||
          CollisionDetector.isInsideContainer(bb.x, bb.y, bb.width, bb.height, a)
        ) {
          continue;
        }
        const overlapX = Math.min(ba.x + ba.width, bb.x + bb.width) - Math.max(ba.x, bb.x);
        const overlapY = Math.min(ba.y + ba.height, bb.y + bb.height) - Math.max(ba.y, bb.y);
        if (overlapX > 14 && overlapY > 12) {
          anomalies.push(`Visual overlap between "${getLabel(a)}" and "${getLabel(b)}"`);
        }
      }
    }

    const recentItems = solid
      .slice(-5)
      .map((s) => `${s.shapeType || s.kind || 'item'}("${getLabel(s)}")@(${Math.round(s.x ?? 0)},${Math.round(s.y ?? 0)})`);

    return {
      leftColumn: {
        occupied: left.length > 0,
        summary: leftSummary,
        freeHeight: leftFree,
      },
      rightColumn: {
        occupied: right.length > 0,
        summary: rightSummary,
        freeHeight: rightFree,
      },
      bottomZone: {
        occupied: bottomSummary.length > 0,
        summary: bottomSummary,
        freeHeight: bottomFree,
      },
      nodes: prominentNodes,
      availableSlots,
      layoutSummary,
      isSlideSaturated: isSaturated,
      boardAudit: {
        status: anomalies.length > 0 ? 'WARNING' : 'CLEAN',
        anomalies: Array.from(new Set(anomalies)).slice(0, 5),
        elementCount: solid.length,
        activeDiagrams: Array.from(activeDiagramSet),
        recentItems,
      },
    };
  }

  public loadBoard(shapes: any[], handwriting: HandwritingPayload[] = [], flushQueue: boolean = true): void {
    if (flushQueue) {
      this.drawingQueue.flush();
    }
    this.drawnShapes = [];
    this.drawnHandwriting = [];
    this.config.canvasAdapter.clear();
    this.config.svgOverlay.clear();
    this.mathOverlay?.clear();
    this.graphOverlay?.clear();
    this.graph3dOverlay?.clear();
    this.vennOverlay?.clear();
    this.mediaOverlay?.clear();
    this.quizOverlay?.clear();
    this.tableOverlay?.clear();

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
        case 'quiz':
          this.quizOverlay?.addQuiz({
            id: shape.id,
            quizId: shape.id,
            quizType: options.quizType || 'multiple_choice',
            question: options.question || shape.label || 'Quiz Question',
            options: options.options,
            pairs: options.pairs,
            blankSentence: options.blankSentence,
            acceptedAnswers: options.acceptedAnswers,
            explanation: options.explanation,
            colorTheme: options.colorTheme || 'cyan',
            position: options.position || 'auto',
            x,
            y,
            width: width || 520,
            height: height || 360,
            status: options.status || 'active',
          });
          break;
        case 'table':
          this.tableOverlay?.addTable({
            id: shape.id,
            title: options.title || shape.label || '',
            columns: options.columns || ['Column 1', 'Column 2'],
            rows: options.rows || [],
            theme: options.theme || 'cyan',
            position: options.position || 'auto',
            fontSize: options.fontSize,
            compact: options.compact,
            x,
            y,
            width,
            height,
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
            const subW = sub.width ?? 150;
            const subH = sub.height ?? 60;
            const subWithDiagram = {
              ...sub,
              diagramId: shape.id,
              width: subW,
              height: subH,
              options: {
                ...sub.options,
                diagramTitle: diagramOptions.title || diagramOptions.root || '',
              },
            };
            this.drawnShapes.push(subWithDiagram);
            const subX = sub.x ?? 0;
            const subY = sub.y ?? 0;
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
          const text = String(options.text || '').replace(/\\n/g, '\n').replace(/\\t/g, ' ');
          const isLatex = CollisionDetector.isStandaloneMathExpression(text);
          const isHandwritten = options.writingStyle === 'handwriting' || this.getWritingStyle() === 'handwriting';
          if (isLatex && this.mathOverlay) {
            this.mathOverlay.addMath({
              latex: CollisionDetector.cleanLatexForMathOverlay(text),
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
    this.quizOverlay?.clear();
    this.tableOverlay?.clear();
    this.config.onBoardChange?.();
  }

  public updateShapeGeometry(
    shapeId: string,
    x: number,
    y: number,
    width?: number,
    height?: number,
    notifyOverlay: boolean = false
  ): boolean {
    let changed = false;
    for (const s of this.drawnShapes) {
      if (s.id === shapeId) {
        if (s.x === x && s.y === y && (width === undefined || s.width === width) && (height === undefined || s.height === height)) {
          return false;
        }
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
      if (notifyOverlay) {
        this.mediaOverlay?.updateMediaGeometry(shapeId, x, y, width, height);
      }
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
        this.loadBoard([...this.drawnShapes], [...this.drawnHandwriting], false);
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
        this.loadBoard([...this.drawnShapes], [...this.drawnHandwriting], false);
        this.config.onBoardChange?.();
        return true;
      }
      return false;
    }

    if (q === 'graph' || q === 'graph3d' || q === '3d' || q === 'drawing' || q === 'plot' || q === 'coordinate_system' || q === 'curve' || q === 'venn' || q === 'venn_diagram') {
      const before = this.drawnShapes.length;
      this.drawnShapes = this.drawnShapes.filter((s) => s.shapeType !== 'graph' && s.shapeType !== 'graph3d' && s.shapeType !== 'venn');
      this.loadBoard([...this.drawnShapes], [...this.drawnHandwriting], false);
      if (this.drawnShapes.length < before) this.config.onBoardChange?.();
      return this.drawnShapes.length < before;
    }

    if (q === 'image' || q === 'images' || q === 'photo' || q === 'picture') {
      const before = this.drawnShapes.length;
      this.drawnShapes = this.drawnShapes.filter((s) => s.shapeType !== 'image');
      this.loadBoard([...this.drawnShapes], [...this.drawnHandwriting], false);
      if (this.drawnShapes.length < before) this.config.onBoardChange?.();
      return this.drawnShapes.length < before;
    }

    if (q === 'video' || q === 'videos') {
      const before = this.drawnShapes.length;
      this.drawnShapes = this.drawnShapes.filter((s) => s.shapeType !== 'video');
      this.loadBoard([...this.drawnShapes], [...this.drawnHandwriting], false);
      if (this.drawnShapes.length < before) this.config.onBoardChange?.();
      return this.drawnShapes.length < before;
    }

    if (q === 'media') {
      const before = this.drawnShapes.length;
      this.drawnShapes = this.drawnShapes.filter((s) => s.shapeType !== 'image' && s.shapeType !== 'video');
      this.loadBoard([...this.drawnShapes], [...this.drawnHandwriting], false);
      if (this.drawnShapes.length < before) this.config.onBoardChange?.();
      return this.drawnShapes.length < before;
    }

    if (q === 'shape' || q === 'shapes' || q === 'diagram') {
      const before = this.drawnShapes.length;
      this.drawnShapes = this.drawnShapes.filter(
        (s) => s.shapeType !== 'rectangle' && s.shapeType !== 'ellipse' && s.shapeType !== 'line' && s.shapeType !== 'arrow' && s.shapeType !== 'diagram'
      );
      this.loadBoard([...this.drawnShapes], [...this.drawnHandwriting], false);
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
        this.loadBoard([...this.drawnShapes], [...this.drawnHandwriting], false);
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
            this.loadBoard([...this.drawnShapes], [...this.drawnHandwriting], false);
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

    this.loadBoard([...this.drawnShapes], [...this.drawnHandwriting], false);
    if (removedShape || removedHandwriting) {
      this.config.onBoardChange?.();
    }
    return removedShape || removedHandwriting;
  }

  /**
   * Surgical in-place modification of an existing text block, formula, label, bullet note,
   * diagram node, or diagram direction without erasing or recreating the slide.
   */
  public updateItem(payload: UpdateItemPayload): boolean {
    const rawTarget = (payload.target || '').trim();
    if (!rawTarget && !payload.newDirection) return false;

    const action = payload.action || 'replace';
    const normTarget = rawTarget.toLowerCase();
    const cleanTarget = normTarget.replace(/[\s\$\\.,:;()\[\]{}'"`\-•\*⇒]/g, '');
    const unescapedNewText =
      typeof payload.newText === 'string'
        ? payload.newText.replace(/\\n/g, '\n').replace(/\\t/g, ' ')
        : undefined;
    const cleanedItems = Array.isArray(payload.newItems)
      ? payload.newItems.map((it) => String(it).replace(/\\n/g, '\n').trim()).filter(Boolean)
      : undefined;

    this.saveStateForUndo();

    // ─── 1. Surgical Diagram-Level & Node-Level In-Place Update ──────────────────
    const diagramMetas = new Map<string, any>();
    for (const s of this.drawnShapes) {
      const dm = s.options?.diagramMeta || s.diagramMeta;
      const dId = s.diagramId || dm?.diagramId;
      if (dId && dm && !diagramMetas.has(dId)) {
        diagramMetas.set(dId, dm);
      }
    }

    for (const meta of diagramMetas.values()) {
      const diagTitleNorm = String(meta.diagramTitle || '').toLowerCase().trim();
      const targetMatchesDiagram =
        !rawTarget ||
        (diagTitleNorm.length > 0 && (diagTitleNorm.includes(normTarget) || normTarget.includes(diagTitleNorm)));

      let mutatedDiagram = false;
      let pureBoxLabelUpdate: { oldLabel: string; newLabel: string; color?: string } | null = null;

      if (payload.newDirection && (targetMatchesDiagram || diagramMetas.size === 1)) {
        meta.baseOptions = {
          ...(meta.baseOptions || {}),
          direction: DiagramLayoutEngine.normalizeDirection(payload.newDirection, 'TB'),
        };
        mutatedDiagram = true;
      }

      if (meta.treeModel && rawTarget) {
        const candidateTree = cloneTree(meta.treeModel);
        const matchesNodeText = (txt: string): boolean => {
          const tLow = txt.toLowerCase().trim();
          const tClean = tLow.replace(/[\s\$\\.,:;()\[\]{}'"`\-•\*⇒]/g, '');
          return (
            tLow === normTarget ||
            tLow.includes(normTarget) ||
            normTarget.includes(tLow) ||
            (cleanTarget.length >= 3 && (tClean.includes(cleanTarget) || cleanTarget.includes(tClean)))
          );
        };

        const mutateTreeNode = (node: TreeModelNode): boolean => {
          if (matchesNodeText(node.label)) {
            if (action === 'delete_node') {
              return false;
            }
            const oldLbl = node.label;
            let modifiedLabelOnly = false;
            if (unescapedNewText !== undefined) {
              if (action === 'append' && !cleanedItems) {
                const trimmedNew = unescapedNewText.trim();
                const isShortLabelSuffix =
                  trimmedNew.split(/\s+/).length <= 3 &&
                  !trimmedNew.includes(':') &&
                  !trimmedNew.startsWith('•') &&
                  !trimmedNew.startsWith('-');
                if (trimmedNew.toLowerCase().includes(oldLbl.toLowerCase())) {
                  node.label = trimmedNew;
                  modifiedLabelOnly = true;
                } else if (isShortLabelSuffix) {
                  node.label = `${oldLbl} ${trimmedNew}`.trim();
                  modifiedLabelOnly = true;
                } else {
                  node.items = [...(node.items || []), unescapedNewText];
                }
              } else if (action === 'replace_substring' && payload.oldSubstring) {
                node.label = node.label.split(payload.oldSubstring).join(unescapedNewText);
                modifiedLabelOnly = !cleanedItems;
              } else if (!cleanedItems) {
                node.label = unescapedNewText;
                modifiedLabelOnly = true;
              }
            }
            if (cleanedItems) {
              node.items = action === 'append' ? [...(node.items || []), ...cleanedItems] : [...cleanedItems];
              modifiedLabelOnly = false;
            }
            if (payload.color) {
              node.color = payload.color;
              if (unescapedNewText === undefined && !cleanedItems) {
                modifiedLabelOnly = true;
              }
            }
            if (modifiedLabelOnly && !payload.newDirection) {
              pureBoxLabelUpdate = {
                oldLabel: oldLbl,
                newLabel: node.label,
                color: payload.color,
              };
            }
            return true;
          }

          // Check bullet items inside this node
          if (node.items && node.items.length > 0) {
            for (let i = 0; i < node.items.length; i++) {
              if (matchesNodeText(node.items[i])) {
                if (action === 'delete_node' || action === 'delete_bullet') {
                  node.items.splice(i, 1);
                  return true;
                }
                if (unescapedNewText !== undefined) {
                  if (action === 'replace_substring' && payload.oldSubstring) {
                    node.items[i] = node.items[i].split(payload.oldSubstring).join(unescapedNewText);
                  } else if (action === 'append') {
                    node.items[i] = `${node.items[i]} ${unescapedNewText}`.trim();
                  } else {
                    node.items[i] = unescapedNewText;
                  }
                  return true;
                }
              }
            }
          }

          if (node.children && node.children.length > 0) {
            for (let i = 0; i < node.children.length; i++) {
              const child = node.children[i];
              if (action === 'delete_node' && matchesNodeText(child.label)) {
                node.children.splice(i, 1);
                return true;
              }
              if (mutateTreeNode(child)) {
                return true;
              }
            }
          }
          return false;
        };

        if (mutateTreeNode(candidateTree)) {
          meta.treeModel = candidateTree;
          meta.diagramTitle = candidateTree.label || meta.diagramTitle;
          mutatedDiagram = true;
        }
      } else if (meta.flowchartNodes && Array.isArray(meta.flowchartNodes) && rawTarget) {
        const nodesCopy: DiagramNode[] = JSON.parse(JSON.stringify(meta.flowchartNodes));
        for (let i = 0; i < nodesCopy.length; i++) {
          const fn = nodesCopy[i];
          const lblLow = String(fn.label || '').toLowerCase();
          const cleanLbl = lblLow.replace(/^\d+\.\s*/, '');
          if (
            lblLow.includes(normTarget) ||
            normTarget.includes(cleanLbl) ||
            (cleanTarget.length >= 3 && cleanLbl.replace(/\s+/g, '').includes(cleanTarget))
          ) {
            if (action === 'delete_node') {
              nodesCopy.splice(i, 1);
              mutatedDiagram = true;
              break;
            }
            const oldLbl = fn.label;
            let modifiedLabelOnly = false;
            if (unescapedNewText !== undefined) {
              if (action === 'replace_substring' && payload.oldSubstring) {
                fn.label = (fn.label || '').split(payload.oldSubstring).join(unescapedNewText);
                modifiedLabelOnly = !cleanedItems;
              } else if (action === 'append' && !cleanedItems) {
                const trimmedNew = unescapedNewText.trim();
                const isShortLabelSuffix =
                  trimmedNew.split(/\s+/).length <= 3 &&
                  !trimmedNew.includes(':') &&
                  !trimmedNew.startsWith('•') &&
                  !trimmedNew.startsWith('-');
                if (oldLbl && trimmedNew.toLowerCase().includes(oldLbl.toLowerCase())) {
                  fn.label = trimmedNew;
                  modifiedLabelOnly = true;
                } else if (isShortLabelSuffix) {
                  fn.label = `${oldLbl || ''} ${trimmedNew}`.trim();
                  modifiedLabelOnly = true;
                } else {
                  fn.items = [...(fn.items || []), unescapedNewText];
                }
              } else if (!cleanedItems) {
                fn.label = unescapedNewText;
                modifiedLabelOnly = true;
              }
            }
            if (cleanedItems) {
              fn.items = action === 'append' ? [...(fn.items || []), ...cleanedItems] : [...cleanedItems];
              modifiedLabelOnly = false;
            }
            if (payload.color) {
              fn.color = payload.color;
              if (unescapedNewText === undefined && !cleanedItems) {
                modifiedLabelOnly = true;
              }
            }
            if (modifiedLabelOnly && !payload.newDirection) {
              pureBoxLabelUpdate = {
                oldLabel: oldLbl || '',
                newLabel: fn.label || '',
                color: payload.color,
              };
            }
            mutatedDiagram = true;
            break;
          }
        }
        if (mutatedDiagram) {
          meta.flowchartNodes = nodesCopy;
        }
      } else if ((meta.diagramType === 'concept_card' || meta.diagramType === 'card') && (targetMatchesDiagram || !rawTarget)) {
        let cardItemsCopy = [...(meta.cardItems || meta.baseOptions?.items || [])];
        const oldTitle = meta.diagramTitle || '';

        if (unescapedNewText !== undefined && (targetMatchesDiagram || normTarget === normalizeLabel(oldTitle))) {
          if (action === 'replace_substring' && payload.oldSubstring) {
            meta.diagramTitle = oldTitle.split(payload.oldSubstring).join(unescapedNewText);
            mutatedDiagram = true;
          } else if (!cleanedItems) {
            meta.diagramTitle = unescapedNewText;
            mutatedDiagram = true;
          }
        }

        if (cleanedItems) {
          cardItemsCopy = action === 'append' ? [...cardItemsCopy, ...cleanedItems] : [...cleanedItems];
          meta.cardItems = cardItemsCopy;
          mutatedDiagram = true;
        }

        if (rawTarget && cardItemsCopy.length > 0) {
          for (let i = 0; i < cardItemsCopy.length; i++) {
            const itemLow = cardItemsCopy[i].toLowerCase();
            if (itemLow.includes(normTarget) || normTarget.includes(itemLow.replace(/^\d+\.\s*|•\s*/, ''))) {
              if (action === 'delete_node' || action === 'delete_bullet') {
                cardItemsCopy.splice(i, 1);
                meta.cardItems = cardItemsCopy;
                mutatedDiagram = true;
                break;
              }
              if (unescapedNewText !== undefined) {
                if (action === 'replace_substring' && payload.oldSubstring) {
                  cardItemsCopy[i] = cardItemsCopy[i].split(payload.oldSubstring).join(unescapedNewText);
                } else if (action === 'append') {
                  cardItemsCopy[i] = `${cardItemsCopy[i]} ${unescapedNewText}`.trim();
                } else {
                  cardItemsCopy[i] = unescapedNewText;
                }
                meta.cardItems = cardItemsCopy;
                mutatedDiagram = true;
                break;
              }
            }
          }
        }

        if (payload.color) {
          meta.baseOptions = { ...(meta.baseOptions || {}), color: payload.color };
          mutatedDiagram = true;
        }

        if (mutatedDiagram) {
          meta.cardItems = cardItemsCopy;
          if (meta.baseOptions) {
            meta.baseOptions.items = cardItemsCopy;
            meta.baseOptions.title = meta.diagramTitle;
          }
        }
      }

      if (mutatedDiagram) {
        // Tier 1: Pure Surgical Box Label / Color Edit in Place (zero displacement of any box or arrow)
        if (pureBoxLabelUpdate) {
          const targetOldNorm = normalizeLabel(pureBoxLabelUpdate.oldLabel);
          const rectShape = this.drawnShapes.find(
            (s) =>
              s.diagramId === meta.diagramId &&
              s.shapeType === 'rectangle' &&
              normalizeLabel(s.options?.label || s.label || '') === targetOldNorm
          );
          if (rectShape) {
            const currentW = rectShape.width ?? 180;
            const oldLeft = rectShape.x ?? 0;
            const oldRight = oldLeft + currentW;
            const centerX = oldLeft + currentW / 2;

            rectShape.options = {
              ...(rectShape.options || {}),
              label: pureBoxLabelUpdate.newLabel,
              diagramTitle: meta.diagramTitle,
              ...(pureBoxLabelUpdate.color ? { color: pureBoxLabelUpdate.color } : {}),
            };
            if ((rectShape as any).label !== undefined) {
              (rectShape as any).label = pureBoxLabelUpdate.newLabel;
            }

            const isHw =
              rectShape.options?.writingStyle === 'handwriting' || this.getWritingStyle() === 'handwriting';
            const fs = rectShape.options?.fontSize || (isHw ? 24 : 20);
            const neededBox = calculateNodeBoxSize(
              pureBoxLabelUpdate.newLabel,
              fs,
              currentW,
              isHw ? 28 : 24,
              isHw,
              420
            );

            if (neededBox.width > currentW) {
              let maxHalfWidth = Math.min(centerX - 140, 1780 - centerX);
              const ry = rectShape.y ?? 0;
              const rh = rectShape.height ?? 54;
              for (const other of this.drawnShapes) {
                if (other === rectShape || other.shapeType !== 'rectangle') continue;
                const oy = other.y ?? 0;
                const oh = other.height ?? 54;
                if (oy < ry + rh + 8 && oy + oh > ry - 8) {
                  const ox = other.x ?? 0;
                  const ow = other.width ?? 160;
                  if (ox + ow <= centerX) {
                    maxHalfWidth = Math.min(maxHalfWidth, centerX - (ox + ow + 14));
                  } else if (ox >= centerX) {
                    maxHalfWidth = Math.min(maxHalfWidth, ox - 14 - centerX);
                  }
                }
              }
              const finalW = Math.max(currentW, Math.min(neededBox.width, Math.floor(maxHalfWidth * 2)));
              const newLeft = Math.round(centerX - finalW / 2);
              const newRight = newLeft + finalW;
              rectShape.width = finalW;
              rectShape.x = newLeft;

              // Adjust any horizontal connector arrows attached to the left/right edges of this box
              for (const conn of this.drawnShapes) {
                if (
                  conn.diagramId !== meta.diagramId ||
                  (conn.shapeType !== 'arrow' && conn.shapeType !== 'line')
                ) {
                  continue;
                }
                const cy = conn.y ?? 0;
                const cToY = conn.toY ?? cy;
                if (cy >= ry - 4 && cy <= ry + rh + 4) {
                  if (Math.abs((conn.x ?? 0) - oldRight) <= 4) conn.x = newRight;
                  else if (Math.abs((conn.x ?? 0) - oldLeft) <= 4) conn.x = newLeft;
                }
                if (cToY >= ry - 4 && cToY <= ry + rh + 4) {
                  if (Math.abs((conn.toX ?? 0) - oldLeft) <= 4) conn.toX = newLeft;
                  else if (Math.abs((conn.toX ?? 0) - oldRight) <= 4) conn.toX = newRight;
                }
              }
            }

            this.loadBoard([...this.drawnShapes], [...this.drawnHandwriting], false);
            this.config.onBoardChange?.();
            return true;
          }
        }

        // Tier 2: Structural In-Place Diagram Rebuild anchored at the diagram's home position
        const anchor = this.computeDiagramAnchor(meta.diagramId, meta);
        meta.anchorSlot = anchor;
        const otherShapes = this.drawnShapes.filter((s) => s.diagramId !== meta.diagramId);
        const mappedHw = this.drawnHandwriting.map((h) => ({
          kind: 'handwriting' as const,
          x: h.position.x,
          y: h.position.y,
          text: h.text,
          fontSize: h.fontSize,
        }));
        const rebuildOptions: DiagramOptions = {
          ...(meta.baseOptions || {}),
          diagramType: meta.diagramType || 'tree',
          title: meta.diagramTitle,
          root: meta.treeModel?.label || meta.baseOptions?.root || meta.diagramTitle,
          direction: meta.baseOptions?.direction,
          treeModel: meta.treeModel,
          nodes: meta.flowchartNodes,
          items: meta.cardItems || meta.baseOptions?.items,
          inPlaceAnchor: anchor,
          existingShapes: [...otherShapes, ...mappedHw],
        };
        const regenerated = DiagramLayoutEngine.generateShapes(rebuildOptions).map((gs, idx) => ({
          ...gs,
          id: `${meta.diagramId}-s-${idx}`,
          diagramId: meta.diagramId,
          diagramMeta: meta,
          zIndex: idx,
          options: {
            ...gs.options,
            diagramTitle: meta.diagramTitle,
            ...(idx === 0 ? { diagramMeta: meta } : {}),
          },
        }));
        this.drawnShapes = [...otherShapes, ...regenerated];
        if (anchor) {
          this.pushDownOverlappingShapesBelowDiagram(meta.diagramId, anchor.topY);
        }
        meta.anchorSlot = this.computeDiagramAnchor(meta.diagramId, meta);
        this.loadBoard([...this.drawnShapes], [...this.drawnHandwriting], false);
        this.config.onBoardChange?.();
        return true;
      }
    }

    // ─── 2. Surgical Standalone Item Update (Text, Math, Handwriting, Shape) ─────
    for (let i = this.drawnShapes.length - 1; i >= 0; i--) {
      const s = this.drawnShapes[i];
      const textVal = String(s.options?.text || s.options?.label || s.options?.latex || s.text || '');
      const textLow = textVal.toLowerCase();
      const textClean = textLow.replace(/[\s\$\\.,:;()\[\]{}'"`\-•\*⇒]/g, '');

      const isMatch =
        rawTarget.length > 0 &&
        (textLow.includes(normTarget) ||
          normTarget.includes(textLow) ||
          (cleanTarget.length >= 3 && (textClean.includes(cleanTarget) || cleanTarget.includes(textClean))));

      if (!isMatch) continue;

      if (action === 'delete_node') {
        return this.erase(rawTarget);
      }

      let updatedText = textVal;
      if (unescapedNewText !== undefined) {
        if (action === 'replace_substring' && payload.oldSubstring) {
          updatedText = textVal.includes(payload.oldSubstring)
            ? textVal.split(payload.oldSubstring).join(unescapedNewText)
            : unescapedNewText;
        } else if (action === 'append') {
          updatedText = `${textVal}\n${unescapedNewText}`.trim();
        } else {
          updatedText = unescapedNewText;
        }
      } else if (cleanedItems && cleanedItems.length > 0) {
        const bullets = cleanedItems.map((it) => (it.startsWith('•') ? it : `• ${it}`)).join('\n');
        updatedText = action === 'append' ? `${textVal}\n${bullets}`.trim() : bullets;
      }

      const newX = typeof payload.x === 'number' ? payload.x : (s.x ?? s.position?.x ?? 100);
      const newY = typeof payload.y === 'number' ? payload.y : (s.y ?? s.position?.y ?? 180);
      const newColor = payload.color || s.options?.color || s.color;
      const newFontSize = payload.fontSize || s.options?.fontSize || s.fontSize;

      const updatedShape = {
        ...s,
        x: newX,
        y: newY,
        ...(s.position ? { position: { x: newX, y: newY } } : {}),
        ...(s.text !== undefined ? { text: updatedText } : {}),
        ...(newColor ? { color: newColor } : {}),
        ...(newFontSize ? { fontSize: newFontSize } : {}),
        options: {
          ...(s.options || {}),
          ...(s.shapeType === 'math'
            ? { latex: CollisionDetector.cleanLatexForMathOverlay(updatedText) }
            : s.shapeType === 'rectangle' || s.shapeType === 'ellipse'
              ? { label: updatedText }
              : { text: updatedText }),
          ...(newColor ? { color: newColor } : {}),
          ...(newFontSize ? { fontSize: newFontSize } : {}),
        },
      };

      const newBounds = CollisionDetector.getShapeBounds(updatedShape);
      updatedShape.width = newBounds.width;
      updatedShape.height = newBounds.height;
      this.drawnShapes[i] = updatedShape;

      // Also update matching handwriting entry if present
      const hwIdx = this.drawnHandwriting.findIndex(
        (h) => (h.id && h.id === s.id) || (h.text && h.text.toLowerCase() === textLow)
      );
      if (hwIdx !== -1) {
        const hw = this.drawnHandwriting[hwIdx];
        const chars = [...updatedText];
        const nowT = this.audioClock.currentTime;
        this.drawnHandwriting[hwIdx] = {
          ...hw,
          text: updatedText,
          position: { x: newX, y: newY },
          ...(newColor ? { color: newColor } : {}),
          ...(newFontSize ? { fontSize: newFontSize } : {}),
          charTimings: chars.map((char, idx) => ({
            char,
            start: nowT + idx * 0.02,
            end: nowT + (idx + 1) * 0.02,
          })),
        };
      }

      this.loadBoard([...this.drawnShapes], [...this.drawnHandwriting], false);
      this.config.onBoardChange?.();
      return true;
    }

    return false;
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
