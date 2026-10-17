/**
 * ITTSAdapter — Abstract interface for Text-to-Speech providers.
 *
 * Isolates the system from specific TTS implementations (ElevenLabs, Azure, etc.).
 * All adapters must return an async iterable of TTSChunks containing both
 * audio data and character-level alignment information.
 */
import type { CharTiming } from '../../types';

export interface TTSChunk {
  /** Raw audio data (PCM or Opus encoded) */
  audio: ArrayBuffer;
  /** Audio format metadata */
  format: {
    sampleRate: number;
    channels: number;
    encoding: 'pcm_16' | 'opus' | 'mp3';
  };
  /** Character-level alignment data for this audio chunk */
  alignment: CharTiming[];
  /** Sequence number for ordering */
  seq: number;
  /** Whether this is the last chunk in the response */
  isFinal: boolean;
}

export interface TTSVoiceConfig {
  voiceId: string;
  language: 'ar' | 'en' | 'fr';
  speed?: number; // 0.5 - 2.0
  stability?: number; // 0.0 - 1.0
  similarityBoost?: number; // 0.0 - 1.0
}

export interface ITTSAdapter {
  /**
   * Synthesizes text into a stream of audio chunks with alignment data.
   * Each chunk contains audio + character timings for sync.
   *
   * @param text - The text to synthesize
   * @param config - Voice configuration
   * @yields TTSChunk objects in order
   */
  synthesize(text: string, config: TTSVoiceConfig): AsyncIterable<TTSChunk>;

  /**
   * Cancels an ongoing synthesis stream.
   * Used during barge-in to immediately stop TTS generation.
   */
  cancel(): void;

  /** Provider name for telemetry */
  readonly providerName: string;
}
