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
  getMathOverlay?: () => MathOverlayHandle | null | undefined;
  getGraphOverlay?: () => GraphOverlayHandle | null | undefined;
  getGraph3DOverlay?: () => Graph3DOverlayHandle | null | undefined;
  getVennOverlay?: () => VennOverlayHandle | null | undefined;
  /** Callback to send barge-in via DataChannel */
  onBargeIn?: (clientTime: number) => void;
  /** Callback for telemetry/monitoring */
  onTelemetry?: (metrics: SyncTelemetry) => void;
  /** Callback when whiteboard is 100% full in both columns */
  onBoardFull?: () => void;
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

    // If text wraps into 3 or more lines in a compact box, scale font down gently towards minFontSize
    if (lines.length > 2 && fontSize > minFontSize) {
      fontSize = Math.max(minFontSize, Math.round(fontSize * 0.85));
      lines = buildLines(fontSize);
    }

    const lineHeight = Math.round(fontSize * (isHandwritten ? 1.25 : 1.2));
    const totalTextHeight = lines.length * lineHeight;
    const startY = boxY + (boxHeight - totalTextHeight) / 2;

    lines.forEach((line, lineIdx) => {
      const lineEstimatedWidth = line.length * fontSize * charRatio;
      const lineX = boxX + Math.max(6, (boxWidth - lineEstimatedWidth) / 2);
      const lineY = startY + lineIdx * lineHeight + fontSize * (isHandwritten ? 0.65 : 0.75);

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
    // Auto-wipe saturated board if starting a new topic/problem from the top
    if (p.y <= 220 && CollisionDetector.isBoardSaturated(this.drawnShapes)) {
      this.clear();
    }

    // 1. Calculate true dimensions using the layout engine
    const bounds = CollisionDetector.getShapeBounds(p);
    const width = bounds.width;
    const height = bounds.height;

    // 2. Find clean, non-overlapping position clamped strictly inside safe margins
    let finalX = p.x;
    let finalY = p.y;

    if (p.shapeType !== 'line' && p.shapeType !== 'arrow') {
      const isHeaderTitle = (p as any).style === 'title' || p.y <= 130;
      const freePos = CollisionDetector.findFreePosition(
        { x: p.x, y: p.y },
        { width, height },
        this.drawnShapes,
        isHeaderTitle,
        p.shapeType
      );

      if (freePos.x === -1 && freePos.y === -1) {
        // Both columns are full! Advance to new slide
        if (this.config.onBoardFull) {
          this.config.onBoardFull();
        }
        this.clear();
        finalX = CollisionDetector.SAFE_MIN_X;
        finalY = 120;
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
    } else {
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
      width,
      height,
      options: {
        ...p.options,
        color: p.options?.color || '#FFFFFF',
        zIndex: this.nextZIndex++,
      },
    };

    // Add to drawn shapes list for collision detection and tracking
    this.drawnShapes.push(shapeWithZIndex);

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
      case 'diagram': {
        const diagramOptions = { ...((shapeWithZIndex.options || {}) as DiagramOptions) };
        if (!diagramOptions.writingStyle) {
          diagramOptions.writingStyle = (this.getWritingStyle() as any) || 'normal';
        }
        if (!diagramOptions.existingShapes) {
          diagramOptions.existingShapes = this.drawnShapes;
        }
        const isHandwriting = diagramOptions.writingStyle === 'handwriting' ||
          /handwritten|handwriting/i.test(diagramOptions.title || '') ||
          /handwritten|handwriting/i.test(diagramOptions.root || '');

        const subShapes = DiagramLayoutEngine.generateShapes(diagramOptions);
        for (const sub of subShapes) {
          this.drawnShapes.push(sub);
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
  }

  private executeHandwritingCommand(p: HandwritingPayload): void {
    this.saveStateForUndo();
    // Auto-wipe saturated board if starting a new topic/title from the top
    if (p.position.y <= 220 && CollisionDetector.isBoardSaturated(this.drawnShapes)) {
      this.clear();
    }

    const bounds = CollisionDetector.getShapeBounds(p);
    const width = bounds.width;
    const height = bounds.height;

    let finalX = p.position.x;
    let finalY = p.position.y;

    if (p.style !== 'annotation') {
      const isHeaderTitle = p.position.y <= 130 || p.style === 'title';
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
        this.clear();
        finalX = CollisionDetector.SAFE_MIN_X;
        finalY = 120;
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
    } else {
      const clamped = CollisionDetector.clampToBounds(p.position.x, p.position.y, width, height);
      finalX = clamped.x;
      finalY = clamped.y;
    }

    const positionedPayload = {
      ...p,
      x: finalX,
      y: finalY,
      width,
      height,
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
        case 'diagram': {
          const diagramOptions = { ...((options || {}) as DiagramOptions) };
          if (!diagramOptions.writingStyle) {
            diagramOptions.writingStyle = (this.getWritingStyle() as any) || 'normal';
          }
          if (!diagramOptions.existingShapes) {
            diagramOptions.existingShapes = this.drawnShapes;
          }
          const isHandwriting = diagramOptions.writingStyle === 'handwriting' ||
            /handwritten|handwriting/i.test(diagramOptions.title || '') ||
            /handwritten|handwriting/i.test(diagramOptions.root || '');

          const subShapes = DiagramLayoutEngine.generateShapes(diagramOptions);
          for (const sub of subShapes) {
            this.drawnShapes.push(sub);
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
        this.drawnShapes.pop();
        this.loadBoard([...this.drawnShapes], [...this.drawnHandwriting]);
        return true;
      } else if (this.drawnHandwriting.length > 0) {
        this.drawnHandwriting.pop();
        this.loadBoard([...this.drawnShapes], [...this.drawnHandwriting]);
        return true;
      }
      return false;
    }

    if (q === 'graph' || q === 'graph3d' || q === '3d' || q === 'drawing' || q === 'plot' || q === 'coordinate_system' || q === 'curve' || q === 'venn' || q === 'venn_diagram') {
      const before = this.drawnShapes.length;
      this.drawnShapes = this.drawnShapes.filter((s) => s.shapeType !== 'graph' && s.shapeType !== 'graph3d' && s.shapeType !== 'venn');
      this.loadBoard([...this.drawnShapes], [...this.drawnHandwriting]);
      return this.drawnShapes.length < before;
    }

    if (q === 'shape' || q === 'shapes' || q === 'diagram') {
      const before = this.drawnShapes.length;
      this.drawnShapes = this.drawnShapes.filter(
        (s) => s.shapeType !== 'rectangle' && s.shapeType !== 'ellipse' && s.shapeType !== 'line' && s.shapeType !== 'arrow' && s.shapeType !== 'diagram'
      );
      this.loadBoard([...this.drawnShapes], [...this.drawnHandwriting]);
      return this.drawnShapes.length < before;
    }

    // Filter by text / latex / title query match
    const initialShapesCount = this.drawnShapes.length;
    const initialHwCount = this.drawnHandwriting.length;

    // Clean query for mathematical symbol matching
    const cleanQ = q.replace(/[\s\$\\]/g, '');

    // Safe Erase Logic: We only want to erase the MOST RECENT single item that matches the query,
    // to avoid accidentally wiping out multiple unrelated shapes if the AI sends a short/generic substring.
    let removedShape = false;
    for (let i = this.drawnShapes.length - 1; i >= 0; i--) {
      const s = this.drawnShapes[i];
      const latex = (s.options?.latex || '').toLowerCase();
      const text = (s.options?.text || s.text || '').toLowerCase();
      const title = (s.options?.title || '').toLowerCase();
      const cleanLatex = latex.replace(/[\s\$\\]/g, '');
      const cleanText = text.replace(/[\s\$\\]/g, '');

      if (
        latex.includes(q) ||
        text.includes(q) ||
        title.includes(q) ||
        (cleanQ.length > 0 && (cleanLatex.includes(cleanQ) || cleanText.includes(cleanQ)))
      ) {
        this.drawnShapes.splice(i, 1);
        removedShape = true;
        break; // Erase ONLY the most recent match
      }
    }

    let removedHandwriting = false;
    if (!removedShape) {
      for (let i = this.drawnHandwriting.length - 1; i >= 0; i--) {
        const h = this.drawnHandwriting[i];
        const text = (h.text || '').toLowerCase();
        const cleanText = text.replace(/[\s\$\\]/g, '');
        if (text.includes(q) || (cleanQ.length > 0 && cleanText.includes(cleanQ))) {
          this.drawnHandwriting.splice(i, 1);
          removedHandwriting = true;
          break; // Erase ONLY the most recent match
        }
      }
    }

    this.loadBoard([...this.drawnShapes], [...this.drawnHandwriting]);
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
