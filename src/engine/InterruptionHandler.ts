/**
 * InterruptionHandler — Barge-in protocol implementation.
 *
 * Manages the coordinated shutdown of audio, animation, and drawing
 * when the user interrupts the teacher mid-sentence.
 *
 * Protocol:
 * 1. User starts speaking → VAD detects → barge_in message sent
 * 2. Client immediately: stops audio, freezes SVG, flushes queues
 * 3. Server acknowledges: sends interrupt_ack with keepUntilCommitGroup
 * 4. Client cleans up: removes uncommitted shapes, resets epoch
 * 5. New response begins with fresh epoch
 */
import type { WhiteboardState } from '../types';
import type { SyncQueue } from './SyncQueue';
import type { AudioClock } from './AudioClock';
import type { DriftCorrector } from './DriftCorrector';
import type { ICanvasAdapter } from '../adapters/canvas/ICanvasAdapter';

export interface InterruptionDeps {
  audioClock: AudioClock;
  drawingQueue: SyncQueue;
  driftCorrector: DriftCorrector;
  canvasAdapter: ICanvasAdapter;
  svgOverlay: {
    freezeCurrentAnimation(): void;
    removePartialGlyphs(): void;
  };
  sendBargeIn(clientTime: number): void;
}

export class InterruptionHandler {
  private deps: InterruptionDeps;
  private _state: WhiteboardState = 'idle' as WhiteboardState;
  private _interruptionCount = 0;

  constructor(deps: InterruptionDeps) {
    this.deps = deps;
  }

  get state(): WhiteboardState {
    return this._state;
  }

  get interruptionCount(): number {
    return this._interruptionCount;
  }

  /**
   * Called when user starts speaking (VAD triggers).
   * Initiates the immediate client-side shutdown.
   */
  handleBargeIn(): void {
    if (this._state === 'interrupted' as WhiteboardState) return; // Already interrupted
    this._interruptionCount++;
    this._state = 'interrupted' as WhiteboardState;

    console.log(`[InterruptionHandler] Barge-in #${this._interruptionCount}`);

    // 1. Immediately stop audio (mute, don't suspend — faster)
    this.deps.audioClock.muteImmediate();

    // 2. Freeze SVG handwriting animation
    this.deps.svgOverlay.freezeCurrentAnimation();

    // 3. Rollback canvas to last committed state
    this.deps.canvasAdapter.rollbackToLastCommit();

    // 4. Flush all pending drawing commands
    this.deps.drawingQueue.flush();

    // 5. Notify server
    this.deps.sendBargeIn(this.deps.audioClock.currentTime);
  }

  /**
   * Called when server acknowledges the interruption.
   * Cleans up partial content and prepares for the new response.
   */
  handleInterruptAck(_keepUntilCommitGroup: string): void {
    this._state = 'clearing' as WhiteboardState;

    // Remove uncommitted SVG handwriting
    this.deps.svgOverlay.removePartialGlyphs();

    // Reset drift corrector for new epoch
    this.deps.driftCorrector.reset();

    // Restore audio
    this.deps.audioClock.unmuteImmediate();

    this._state = 'ready' as WhiteboardState;
  }

  /**
   * Called when a new response stream begins.
   * Sets up fresh epoch anchoring.
   */
  handleNewResponse(): void {
    this._state = 'streaming' as WhiteboardState;
    this.deps.driftCorrector.setClientEpoch(this.deps.audioClock.currentTime);
  }

  /**
   * Resets the handler state (e.g., on full session reset).
   */
  reset(): void {
    this._state = 'idle' as WhiteboardState;
  }
}
