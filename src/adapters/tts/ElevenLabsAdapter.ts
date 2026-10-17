/**
 * ElevenLabsAdapter — ElevenLabs TTS implementation of ITTSAdapter.
 *
 * Uses the ElevenLabs streaming API with character-level timestamps.
 * Endpoint: POST /v1/text-to-speech/{voice_id}/stream-input (WebSocket)
 *
 * This is a client-side stub/interface definition. In production, the actual
 * ElevenLabs API calls happen on the server-side (LiveKit Agent Worker).
 * The client receives the processed chunks via WebRTC DataChannel.
 *
 * This adapter is provided for:
 * 1. Architecture documentation
 * 2. Direct client-side usage in the PoC/demo mode
 * 3. Future reference for server-side implementation
 */
import type { ITTSAdapter, TTSChunk, TTSVoiceConfig } from './ITTSAdapter';
import type { CharTiming } from '../../types';

export class ElevenLabsAdapter implements ITTSAdapter {
  readonly providerName = 'elevenlabs';

  private apiKey: string;
  private baseUrl: string;
  private abortController: AbortController | null = null;

  constructor(apiKey: string, baseUrl = 'https://api.elevenlabs.io') {
    this.apiKey = apiKey;
    this.baseUrl = baseUrl;
  }

  async *synthesize(text: string, config: TTSVoiceConfig): AsyncIterable<TTSChunk> {
    this.abortController = new AbortController();
    const { signal } = this.abortController;

    const url = `${this.baseUrl}/v1/text-to-speech/${config.voiceId}/stream/with-timestamps`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'xi-api-key': this.apiKey,
      },
      body: JSON.stringify({
        text,
        model_id: 'eleven_flash_v2_5',
        voice_settings: {
          stability: config.stability ?? 0.5,
          similarity_boost: config.similarityBoost ?? 0.75,
          speed: config.speed ?? 1.0,
        },
        output_format: 'pcm_24000',
      }),
      signal,
    });

    if (!response.ok) {
      throw new Error(`ElevenLabs API error: ${response.status} ${response.statusText}`);
    }

    const reader = response.body?.getReader();
    if (!reader) throw new Error('No response body');

    const decoder = new TextDecoder();
    let buffer = '';
    let seq = 0;

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        // Parse newline-delimited JSON chunks
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          if (!line.trim()) continue;

          try {
            const chunk = JSON.parse(line);

            if (chunk.audio_base64) {
              const audioData = this.base64ToArrayBuffer(chunk.audio_base64);
              const alignment: CharTiming[] = [];

              // Extract character-level timestamps
              if (chunk.alignment) {
                const chars = chunk.alignment.characters || [];
                const starts = chunk.alignment.character_start_times_seconds || [];
                const ends = chunk.alignment.character_end_times_seconds || [];

                for (let i = 0; i < chars.length; i++) {
                  alignment.push({
                    char: chars[i],
                    start: starts[i] ?? 0,
                    end: ends[i] ?? starts[i] ?? 0,
                  });
                }
              }

              const ttsChunk: TTSChunk = {
                audio: audioData,
                format: {
                  sampleRate: 24000,
                  channels: 1,
                  encoding: 'pcm_16',
                },
                alignment,
                seq: seq++,
                isFinal: false,
              };

              yield ttsChunk;
            }
          } catch {
            // Skip malformed JSON lines
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  cancel(): void {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
  }

  private base64ToArrayBuffer(base64: string): ArrayBuffer {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes.buffer;
  }
}
