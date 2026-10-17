/**
 * AudioClock — Master time reference for the Sync Engine.
 *
 * Wraps the Web Audio API's AudioContext to provide a high-precision,
 * sample-accurate clock that serves as the single source of truth for
 * all audio-visual synchronization.
 *
 * Key Design Decision:
 * - AudioContext.currentTime is hardware-driven and monotonically increasing
 * - outputLatency compensation ensures visuals match what the user HEARS,
 *   not what the browser PROCESSES
 * - requestAnimationFrame is used only as a render trigger, never as a clock
 */
export class AudioClock {
  private ctx: AudioContext | null = null;
  private _isPlaying = false;
  private _gainNode: GainNode | null = null;

  /**
   * Lazily initializes the AudioContext.
   * Must be called after a user gesture (browser autoplay policy).
   */
  async init(): Promise<void> {
    if (this.ctx) return;
    this.ctx = new AudioContext();
    this._gainNode = this.ctx.createGain();
    this._gainNode.connect(this.ctx.destination);
  }

  /**
   * Current playback time in seconds, compensated for output latency.
   * This is the "perceptual" time — when the user actually hears the audio.
   */
  get currentTime(): number {
    if (!this.ctx) return 0;
    const outputLatency = this.ctx.outputLatency ?? 0;
    return this.ctx.currentTime - outputLatency;
  }

  /**
   * Raw AudioContext time without latency compensation.
   * Used for scheduling audio nodes (they operate in raw context time).
   */
  get rawCurrentTime(): number {
    return this.ctx?.currentTime ?? 0;
  }

  /**
   * The output latency in seconds (time between processing and speaker output).
   */
  get outputLatency(): number {
    return this.ctx?.outputLatency ?? 0;
  }

  /**
   * The underlying AudioContext for creating audio nodes.
   */
  get rawContext(): AudioContext {
    if (!this.ctx) throw new Error('AudioClock not initialized. Call init() first.');
    return this.ctx;
  }

  /**
   * The master gain node — all audio sources should connect through this.
   */
  get masterGain(): GainNode {
    if (!this._gainNode) throw new Error('AudioClock not initialized. Call init() first.');
    return this._gainNode;
  }

  /**
   * Sample rate of the audio context (typically 44100 or 48000).
   */
  get sampleRate(): number {
    return this.ctx?.sampleRate ?? 48000;
  }

  async resume(): Promise<void> {
    if (!this.ctx) await this.init();
    if (this.ctx!.state === 'suspended') {
      await this.ctx!.resume();
    }
    this._isPlaying = true;
  }

  async suspend(): Promise<void> {
    if (this.ctx && this.ctx.state === 'running') {
      await this.ctx.suspend();
    }
    this._isPlaying = false;
  }

  /**
   * Immediately stops all audio output by ramping gain to zero.
   * Faster than suspending the context (which may have latency).
   */
  muteImmediate(): void {
    if (this._gainNode && this.ctx) {
      this._gainNode.gain.setValueAtTime(0, this.ctx.currentTime);
    }
  }

  /**
   * Restores audio output after a mute.
   */
  unmuteImmediate(): void {
    if (this._gainNode && this.ctx) {
      this._gainNode.gain.setValueAtTime(1, this.ctx.currentTime);
    }
  }

  get isPlaying(): boolean {
    return this._isPlaying;
  }

  get isInitialized(): boolean {
    return this.ctx !== null;
  }

  /**
   * Creates an AudioBufferSourceNode from raw PCM data and schedules playback.
   * Returns the scheduled start time in AudioContext time.
   */
  scheduleBuffer(buffer: AudioBuffer, startAt: number): AudioBufferSourceNode {
    const source = this.rawContext.createBufferSource();
    source.buffer = buffer;
    source.connect(this.masterGain);
    source.start(startAt);
    return source;
  }

  /**
   * Connects a MediaStream (from WebRTC) to the audio graph.
   * Returns the source node for cleanup.
   */
  connectMediaStream(stream: MediaStream): MediaStreamAudioSourceNode {
    const source = this.rawContext.createMediaStreamSource(stream);
    source.connect(this.masterGain);
    return source;
  }

  dispose(): void {
    if (this.ctx) {
      this.ctx.close();
      this.ctx = null;
      this._gainNode = null;
      this._isPlaying = false;
    }
  }
}
