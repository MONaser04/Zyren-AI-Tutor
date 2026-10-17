/**
 * DataChannelProtocol — Message parsing and serialization for RTCDataChannel.
 *
 * All messages are JSON-encoded with a `type` discriminator field.
 * The DataChannel is configured as:
 *   - ordered: true (alignment data must arrive in order)
 *   - maxRetransmits: 3 (reliable enough for control data)
 *
 * Message flow:
 *   Server → Client: alignment, heartbeat, interrupt_ack, epoch_reset
 *   Client → Server: barge_in
 */
import type { DataChannelMessage, BargeInMessage } from '../types';

const VALID_MESSAGE_TYPES = new Set([
  'alignment',
  'heartbeat',
  'barge_in',
  'interrupt_ack',
  'epoch_reset',
]);

export class DataChannelProtocol {
  /**
   * Parses a raw DataChannel message (string or ArrayBuffer) into a typed message.
   * Returns null for invalid or unknown messages (fail-safe, never throws).
   */
  static parse(raw: string | ArrayBuffer): DataChannelMessage | null {
    try {
      const str = typeof raw === 'string' ? raw : new TextDecoder().decode(raw);
      const msg = JSON.parse(str);

      if (!msg || typeof msg.type !== 'string') {
        return null;
      }

      if (!VALID_MESSAGE_TYPES.has(msg.type)) {
        console.warn(`[DataChannelProtocol] Unknown message type: ${msg.type}`);
        return null;
      }

      return msg as DataChannelMessage;
    } catch (e) {
      console.error('[DataChannelProtocol] Parse error:', e);
      return null;
    }
  }

  /**
   * Creates a barge-in message to send to the server.
   */
  static createBargeIn(clientTime: number): string {
    const msg: BargeInMessage = {
      type: 'barge_in',
      clientTime,
    };
    return JSON.stringify(msg);
  }

  /**
   * Creates a heartbeat response (client → server) for RTT measurement.
   */
  static createHeartbeatResponse(serverWallTime: number, clientTime: number): string {
    return JSON.stringify({
      type: 'heartbeat_response',
      serverWallTime,
      clientTime,
    });
  }

  /**
   * Validates that a parsed alignment message has the required fields.
   */
  static isValidAlignment(msg: DataChannelMessage): boolean {
    if (msg.type !== 'alignment') return false;
    const a = msg as any;
    return (
      typeof a.chunkId === 'string' &&
      typeof a.seq === 'number' &&
      Array.isArray(a.characters) &&
      a.characters.every(
        (c: any) =>
          typeof c.char === 'string' &&
          typeof c.start === 'number' &&
          typeof c.end === 'number'
      )
    );
  }
}
