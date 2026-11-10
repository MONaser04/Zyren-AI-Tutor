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
  preserveExactPosition?: boolean;
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

export type QuizType =
  | 'multiple_choice'
  | 'true_false'
  | 'matching'
  | 'fill_in_the_blank'
  | 'ordering'
  | 'short_answer';

export interface QuizOption {
  id: string;
  label?: string;
  text: string;
  isCorrect?: boolean;
  order?: number;
}

export interface QuizPair {
  leftId: string;
  leftText: string;
  rightId: string;
  rightText: string;
}

export interface QuizOptions {
  id?: string;
  quizId?: string;
  quizType: QuizType;
  question: string;
  options?: QuizOption[];
  pairs?: QuizPair[];
  blankSentence?: string;
  acceptedAnswers?: string[];
  explanation?: string;
  correctOption?: string;
  correctAnswer?: string;
  colorTheme?: 'cyan' | 'purple' | 'amber' | 'emerald';
  position?: 'auto' | 'left' | 'right' | 'top' | 'bottom' | 'center';
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  status?: 'active' | 'evaluating' | 'correct' | 'incorrect' | 'revealed';
  selectedOptionId?: string | string[];
  userMatches?: Record<string, string>;
  userTextAnswer?: string;
  userOrdering?: string[];
  aiFeedback?: string;
  score?: number;
}

export interface DiagramNode {
  id?: string;
  label?: string;
  text?: string;
  name?: string;
  parentId?: string;
  parent?: string;
  items?: string[];
  color?: string;
  flow?: 'auto' | 'down' | 'right' | 'left' | 'up';
  children?: DiagramNode[];
}

export interface DiagramOptions {
  title?: string;
  diagramType?: 'tree' | 'flowchart' | 'process' | 'comparison' | 'hybrid' | 'card' | 'concept_card';
  root?: string;
  nodes?: DiagramNode[];
  items?: string[];
  category?: string;
  direction?: 'TB' | 'BT' | 'LR' | 'RL' | string;
  position?: 'auto' | 'left' | 'right' | 'top' | 'bottom' | 'center' | 'custom';
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  attachToNode?: string;
  existingShapes?: ShapePayload[];
  colorTheme?: string;
  color?: string;
  writingStyle?: 'handwriting' | 'normal' | 'mixed' | string;
  preserveExactPosition?: boolean;
  /**
   * Preserves the exact horizontal center and top Y anchor when an existing diagram
   * is updated or expanded in place so it never jumps to another column or corner.
   */
  inPlaceAnchor?: {
    centerX: number;
    topY: number;
    minX?: number;
    maxX?: number;
  };
  /**
   * Pre-resolved hierarchical tree model. When present, the tree generator lays it out
   * directly (no root/label heuristics). Used by the SyncEngine when an existing tree
   * diagram is extended in place.
   */
  treeModel?: TreeModelNode;
}

export interface UpdateItemPayload {
  target: string;
  action?:
    | 'replace'
    | 'edit'
    | 'rename'
    | 'replace_substring'
    | 'append'
    | 'move'
    | 'change_direction'
    | 'delete_node'
    | 'delete_bullet'
    | 'set_items'
    | 'add_child';
  newText?: string;
  oldSubstring?: string;
  replaceSubstring?: string;
  withText?: string;
  appendText?: string;
  newItems?: string[];
  newChildren?: DiagramNode[];
  newDirection?: 'TB' | 'BT' | 'LR' | 'RL' | string;
  newPosition?: 'auto' | 'left' | 'right' | 'top' | 'bottom' | 'center' | 'custom';
  x?: number;
  y?: number;
  newX?: number;
  newY?: number;
  color?: string;
  newColor?: string;
  fontSize?: number;
}

/**
 * Canonical recursive model of a concept tree. Every node is drawn as a box; `items`
 * are bullet notes rendered beneath the node's box; `children` are child boxes linked
 * by connector arrows.
 */
export interface TreeModelNode {
  label: string;
  items: string[];
  children: TreeModelNode[];
  color?: string;
}

export interface SlideMediaOptions {
  mediaId: string;
  mediaType: 'image' | 'video';
  url: string;
  fileName?: string;
  mimeType?: string;
  naturalWidth?: number;
  naturalHeight?: number;
  durationSec?: number;
  posterDataUrl?: string;
  shareAudioWithAI?: boolean;
}

export interface ShapePayload {
  id?: string;
  kind: 'shape';
  shapeType: 'rectangle' | 'ellipse' | 'line' | 'arrow' | 'text' | 'math' | 'graph' | 'graph3d' | 'venn' | 'diagram' | 'image' | 'video' | 'quiz';
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
  id?: string;
  kind: 'handwriting';
  text: string;
  position: Point;
  style: 'title' | 'body' | 'annotation' | 'subtitle';
  fontSize?: number;
  writingStyle?: 'handwriting' | 'normal' | 'mixed' | string;
  color?: string;
  direction: 'rtl' | 'ltr';
  align?: 'left' | 'center' | 'right';
  allowWideElastic?: boolean;
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
  /** Whether this word starts a new explicit line (e.g. after \n or list item break) */
  lineBreakBefore?: boolean;
}

export interface LanguageItem {
  code: string;
  name: string;
  nativeName: string;
  flag: string;
  family?: string;
}

export interface LanguageConfig {
  autoDetect: boolean;
  primary: string;
  secondary: string[];
}

export interface SyncTelemetry {
  queueDepth: number;
  driftMs: number;
  fps: number;
  heartbeatCount: number;
  interruptionCount: number;
  state: WhiteboardState;
}

export * from './providers';
