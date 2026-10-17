/**
 * AI Tutor — Core Type Definitions
 *
 * Shared types used across the Sync Engine, Adapters, Layers, and Transport.
 * All timestamps are in seconds (matching AudioContext.currentTime).
 */

// ─── Geometry Primitives ──────────────────────────────────────

export interface Point {
  x: number;
  y: number;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

// ─── Shape Options ────────────────────────────────────────────

export interface ShapeOptions {
  color?: string;
  fill?: string;
  roughness?: number;
  strokeWidth?: number;
  zIndex?: number;
  writingStyle?: 'handwriting' | 'normal' | 'mixed' | string;
}

export interface ArrowOptions extends ShapeOptions {
  headSize?: number;
}

export interface TextOptions {
  fontSize?: number;
  fontFamily?: string;
  color?: string;
  direction?: 'ltr' | 'rtl';
  style?: string;
  zIndex?: number;
  maxWidth?: number;
  writingStyle?: 'handwriting' | 'normal' | 'mixed' | string;
}

// ─── Shape Handle ─────────────────────────────────────────────

/** Opaque handle returned by the Canvas adapter for shape management */
export interface ShapeHandle {
  id: string;
  bounds: Rect;
}

// ─── Draw Commands (LLM → Client) ────────────────────────────

/** A command from the LLM describing what to draw/write */
export interface DrawCommand {
  id: string;
  type: 'shape' | 'handwriting' | 'clear' | 'highlight';
  /** AudioContext time (seconds) when this command should execute */
  scheduledTime: number;
  /** Sentence/commit group this command belongs to */
  commitGroup: string;
  payload: ShapePayload | HandwritingPayload | ClearPayload | HighlightPayload;
}

export interface Graph3DOptions {
  title?: string;
  plotType?: 'surface' | 'solid_of_revolution' | 'extrusion' | 'linear_extrusion' | 'bounded_surfaces' | 'parametric';
  equationZ?: string;
  zTop?: string;
  zBottom?: string;
  curve2D?: string;
  domainMask?: string;
  fTop?: string;
  fBottom?: string;
  revolutionAxis?: 'x' | 'y' | 'z';
  revolutionAngle?: number;
  xRange?: [number, number];
  yRange?: [number, number];
  zRange?: [number, number];
  colorTheme?: 'cyan_orange' | 'plasma' | 'electric_blue' | 'emerald';
  showWireframe?: boolean;
  autoRotate?: boolean;
  gridResolution?: number;
  resolution?: number;
  clippingPlane?: string;  // Implicit cutting plane (e.g. 'x >= 0', 'z <= 2', 'x + y >= 0')
  crossSection?: string;   // Alias for clippingPlane
}

export interface VennOptions {
  title?: string;
  sets?: string[]; // e.g. ['A', 'B'] or ['A', 'B', 'C']
  shadedRegions?: string[]; // e.g. ['intersection', 'A_only', 'B_only', 'neither']
  shadedOperation?: string; // string shorthand e.g. 'intersection', 'union', 'A_only'
  labels?: Record<string, string>; // e.g. {'A': '0.5', 'B': '0.4', 'intersection': '0.2'}
  colorTheme?: 'cyan_orange' | 'plasma' | 'emerald' | 'sunset';
}

export interface DiagramNode {
  id?: string;
  label: string;
  parentId?: string;
  parent?: string;
  items?: string[];
  color?: string;
  flow?: 'auto' | 'down' | 'right' | 'left';
  children?: DiagramNode[];
}

export interface DiagramOptions {
  title?: string;
  diagramType?: 'tree' | 'flowchart' | 'process' | 'comparison' | 'hybrid';
  root?: string;
  nodes?: DiagramNode[];
  direction?: 'TB' | 'LR' | string;
  position?: 'auto' | 'left' | 'right' | 'top' | 'bottom' | 'center' | 'custom';
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  attachToNode?: string;
  existingShapes?: ShapePayload[];
  colorTheme?: string;
  writingStyle?: 'handwriting' | 'normal' | 'mixed' | string;
}

export interface ShapePayload {
  kind: 'shape';
  shapeType: 'rectangle' | 'ellipse' | 'line' | 'arrow' | 'text' | 'math' | 'graph' | 'graph3d' | 'venn' | 'diagram';
  x: number;
  y: number;
  width?: number;
  height?: number;
  label?: string;
  toX?: number;
  toY?: number;
  options?: any;
}

export interface HandwritingPayload {
  kind: 'handwriting';
  text: string;
  position: Point;
  style: 'title' | 'body' | 'annotation';
  fontSize?: number;
  writingStyle?: 'handwriting' | 'normal' | 'mixed' | string;
  color?: string;
  direction: 'rtl' | 'ltr';
  align?: 'left' | 'center' | 'right';
  /** Per-character timing from TTS alignment (server time, will be converted) */
  charTimings: CharTiming[];
}

export interface CharTiming {
  char: string;
  /** Start time in seconds from the beginning of the current response */
  start: number;
  /** End time in seconds from the beginning of the current response */
  end: number;
}

export interface ClearPayload {
  kind: 'clear';
  target: 'all' | 'partial';
  keepIds?: string[];
}

export interface HighlightPayload {
  kind: 'highlight';
  targetId: string;
  color: string;
  duration: number;
}

// ─── DataChannel Messages (Server ↔ Client) ──────────────────

/** Alignment data received via RTCDataChannel from TTS */
export interface AlignmentMessage {
  type: 'alignment';
  /** Unique ID for this audio chunk */
  chunkId: string;
  /** Sequence number for ordering */
  seq: number;
  /** Character-level timing data */
  characters: CharTiming[];
}

/** Heartbeat for drift correction, sent every ~30s */
export interface HeartbeatMessage {
  type: 'heartbeat';
  /** Server's current media clock position in seconds */
  serverMediaTime: number;
  /** Server-side monotonic timestamp for RTT calculation */
  serverWallTime: number;
}

/** Barge-in signal from client to server */
export interface BargeInMessage {
  type: 'barge_in';
  /** Client AudioContext time when interruption was detected */
  clientTime: number;
}

/** Server acknowledgment of barge-in with cleanup instructions */
export interface InterruptAckMessage {
  type: 'interrupt_ack';
  /** The commit group ID up to which content should be kept */
  keepUntilCommitGroup: string;
}

/** Server signals new response epoch */
export interface EpochResetMessage {
  type: 'epoch_reset';
  /** New server epoch time */
  newServerEpoch: number;
}

export type DataChannelMessage =
  | AlignmentMessage
  | HeartbeatMessage
  | BargeInMessage
  | InterruptAckMessage
  | EpochResetMessage;

// ─── Sync Engine Types ────────────────────────────────────────

export interface SyncAnchor {
  /** Server TTS timestamp origin (seconds) */
  serverEpoch: number;
  /** AudioContext.currentTime when first audio chunk started playing */
  clientEpoch: number;
  /** Accumulated drift correction in seconds */
  driftCorrection: number;
}

export enum WhiteboardState {
  IDLE = 'idle',
  STREAMING = 'streaming',
  INTERRUPTED = 'interrupted',
  CLEARING = 'clearing',
  READY = 'ready',
}

// ─── Word Animation Data ──────────────────────────────────────

export interface WordAnimation {
  wordId: string;
  /** Mapped client-side start time (seconds) */
  startTime: number;
  /** Mapped client-side end time (seconds) */
  endTime: number;
  /** The SVG mask element for stroke-dashoffset animation */
  maskElement: SVGPathElement;
  /** Total path length for dashoffset calculation */
  totalLength: number;
  /** Whether this word has been fully revealed */
  completed: boolean;
}

// ─── Arabic Shaping Types ─────────────────────────────────────

export interface ShapedGlyph {
  /** The original character */
  char: string;
  /** SVG path data string (d attribute) */
  pathData: string;
  /** Glyph advance width */
  advanceWidth: number;
  /** Glyph bounding box */
  bounds: Rect;
}

export interface ShapedWord {
  /** Original text */
  text: string;
  /** Individual shaped glyphs */
  glyphs: ShapedGlyph[];
  /** Combined SVG path for the entire word */
  combinedPath: string;
  /** Reveal mask path (for stroke animation) */
  revealMaskPath: string;
  /** Total width of the word */
  totalWidth: number;
  /** Total height of the word */
  totalHeight: number;
}

export interface SyncTelemetry {
  queueDepth: number;
  driftMs: number;
  fps: number;
  heartbeatCount: number;
  interruptionCount: number;
  state: WhiteboardState;
}
