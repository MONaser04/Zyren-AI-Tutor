/**
 * WebRTCManager — LiveKit client wrapper (stub for PoC).
 *
 * In production, this wraps the LiveKit Client SDK to:
 * - Join a LiveKit room
 * - Receive audio tracks from the server
 * - Receive DataChannel messages (alignment, heartbeat)
 * - Send barge-in signals
 *
 * For the PoC, this provides a demo mode that simulates
 * WebRTC behavior using local audio files and pre-computed timestamps.
 */

export interface WebRTCManagerConfig {
  /** LiveKit server URL */
  serverUrl?: string;
  /** Room access token */
  token?: string;
  /** Callback when audio track is received */
  onAudioTrack?: (stream: MediaStream) => void;
  /** Callback when DataChannel message is received */
  onDataChannelMessage?: (data: string | ArrayBuffer) => void;
  /** Callback on connection state change */
  onConnectionStateChange?: (state: 'connecting' | 'connected' | 'disconnected' | 'failed') => void;
}

export class WebRTCManager {
  private config: WebRTCManagerConfig;
  private _isConnected = false;

  constructor(config: WebRTCManagerConfig) {
    this.config = config;
  }

  /**
   * Connects to the LiveKit room.
   * In PoC mode, simulates connection with local resources.
   */
  async connect(): Promise<void> {
    this.config.onConnectionStateChange?.('connecting');

    if (this.config.serverUrl && this.config.token) {
      // Production mode: Connect to LiveKit
      // TODO: Implement LiveKit Room connection
      console.log('[WebRTCManager] LiveKit connection not yet implemented');
    } else {
      // Demo mode: Simulate connection
      console.log('[WebRTCManager] Running in demo mode');
      await this.simulateConnection();
    }

    this._isConnected = true;
    this.config.onConnectionStateChange?.('connected');
  }

  /**
   * Sends a barge-in signal via DataChannel.
   */
  sendBargeIn(clientTime: number): void {
    if (!this._isConnected) {
      console.warn('[WebRTCManager] Cannot send barge-in: not connected');
      return;
    }

    const msg = JSON.stringify({
      type: 'barge_in',
      clientTime,
    });

    // TODO: Send via LiveKit DataChannel
    console.log('[WebRTCManager] Barge-in sent:', msg);
  }

  /**
   * Disconnects from the room.
   */
  disconnect(): void {
    this._isConnected = false;
    this.config.onConnectionStateChange?.('disconnected');
    console.log('[WebRTCManager] Disconnected');
  }

  get isConnected(): boolean {
    return this._isConnected;
  }

  /**
   * Simulates a WebRTC connection for demo/PoC mode.
   * Uses Web Audio API to create a silent audio stream.
   */
  private async simulateConnection(): Promise<void> {
    // Create a silent MediaStream for the audio clock
    const ctx = new AudioContext();
    const oscillator = ctx.createOscillator();
    const dst = ctx.createMediaStreamDestination();
    oscillator.connect(dst);
    oscillator.frequency.value = 0; // Silent
    oscillator.start();

    // Notify about the "received" audio track
    this.config.onAudioTrack?.(dst.stream);
  }
}
