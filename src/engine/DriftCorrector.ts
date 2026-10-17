/**
 * DriftCorrector — Epoch anchoring with gradual drift correction.
 *
 * Maps server-side TTS timestamps to client AudioContext time.
 * Over long sessions (30+ min), the server's media clock and the client's
 * AudioContext can drift by 50-200ms. This module:
 *
 * 1. Anchors a server epoch to a client epoch when the first audio arrives
 * 2. Periodically receives heartbeat messages with the server's current time
 * 3. Computes drift and applies gradual "slew" correction (max per frame)
 *    to avoid visible jumps in the animation
 *
 * Design Principle: Never hard-correct. Always slew smoothly.
 */
import type { SyncAnchor } from '../types';

export class DriftCorrector {
  private anchor: SyncAnchor = {
    serverEpoch: 0,
    clientEpoch: 0,
    driftCorrection: 0,
  };

  /**
   * Maximum drift correction applied per animation frame (seconds).
   * At 60fps, this allows ~120ms/sec max correction rate.
   * Prevents visible "jumps" in animation timing.
   */
  private readonly MAX_CORRECTION_PER_FRAME = 0.002; // 2ms

  /**
   * If measured drift exceeds this threshold, force a hard reset.
   * This handles catastrophic cases (e.g., device sleep, network outage).
   */
  private readonly HARD_RESET_THRESHOLD = 0.5; // 500ms

  private _lastMeasuredDrift = 0;
  private _heartbeatCount = 0;
  private _isAnchored = false;

  /**
   * Sets the client-side epoch — called when the first audio chunk
   * from a new response starts playing.
   */
  setClientEpoch(clientTime: number): void {
    this.anchor.clientEpoch = clientTime;
    this._isAnchored = true;
  }

  /**
   * Sets the server-side epoch — called when the first alignment
   * message arrives with the server's reference time.
   */
  setServerEpoch(serverTime: number): void {
    this.anchor.serverEpoch = serverTime;
  }

  /**
   * Maps a server-side TTS timestamp to client AudioContext time.
   * This is the primary conversion used by the Sync Engine.
   *
   * @param serverTimestamp - Time in seconds from the server's TTS clock
   * @returns Equivalent time in AudioContext.currentTime domain
   */
  serverToClientTime(serverTimestamp: number): number {
    return (
      this.anchor.clientEpoch +
      (serverTimestamp - this.anchor.serverEpoch) +
      this.anchor.driftCorrection
    );
  }

  /**
   * Called on each heartbeat message from the server.
   * Computes the drift between expected and actual client time,
   * then applies gradual correction.
   *
   * @param serverNow - Server's current media clock (seconds)
   * @param clientNow - Client's current AudioContext.currentTime (seconds)
   */
  onHeartbeat(serverNow: number, clientNow: number): void {
    this._heartbeatCount++;

    // What the client time SHOULD be based on the server's clock
    const expectedClientTime = this.serverToClientTime(serverNow);

    // Actual drift: positive = client is ahead, negative = client is behind
    const measuredDrift = clientNow - expectedClientTime;
    this._lastMeasuredDrift = measuredDrift;

    // Catastrophic drift → hard reset
    if (Math.abs(measuredDrift) > this.HARD_RESET_THRESHOLD) {
      console.warn(
        `[DriftCorrector] Catastrophic drift detected: ${(measuredDrift * 1000).toFixed(1)}ms. Hard resetting.`
      );
      this.anchor.driftCorrection += measuredDrift;
      return;
    }

    // Gradual slew correction
    const correction =
      Math.sign(measuredDrift) *
      Math.min(Math.abs(measuredDrift), this.MAX_CORRECTION_PER_FRAME);

    this.anchor.driftCorrection += correction;
  }

  /**
   * Returns the last measured drift in milliseconds.
   * Positive = client ahead, Negative = client behind.
   * Used for telemetry/monitoring.
   */
  get lastDriftMs(): number {
    return this._lastMeasuredDrift * 1000;
  }

  get heartbeatCount(): number {
    return this._heartbeatCount;
  }

  get isAnchored(): boolean {
    return this._isAnchored;
  }

  get totalCorrection(): number {
    return this.anchor.driftCorrection;
  }

  /**
   * Resets the corrector for a new response epoch.
   * Called after barge-in or when a new teaching segment begins.
   */
  reset(): void {
    this.anchor = {
      serverEpoch: 0,
      clientEpoch: 0,
      driftCorrection: 0,
    };
    this._lastMeasuredDrift = 0;
    this._isAnchored = false;
    // Preserve heartbeat count for lifetime telemetry
  }
}
