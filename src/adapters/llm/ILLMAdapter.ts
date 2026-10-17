/**
 * ILLMAdapter — Abstract interface for LLM providers.
 *
 * Isolates the system from specific LLM implementations.
 * The LLM communicates via WebSocket and produces:
 * 1. Streaming text responses (for TTS input)
 * 2. Tool calls (JSON) for whiteboard commands
 */

export interface LLMMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  toolCallId?: string;
}

export interface LLMToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface LLMStreamDelta {
  type: 'text' | 'tool_call' | 'done';
  /** Partial text content (when type === 'text') */
  text?: string;
  /** Tool call data (when type === 'tool_call') */
  toolCall?: LLMToolCall;
}

export interface LLMConfig {
  model: string;
  temperature?: number;
  maxTokens?: number;
  systemPrompt: string;
  tools: LLMToolDefinition[];
}

export interface LLMToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>; // JSON Schema
}

export interface ILLMAdapter {
  /**
   * Sends a message and streams back deltas (text + tool calls).
   */
  chat(messages: LLMMessage[], config: LLMConfig): AsyncIterable<LLMStreamDelta>;

  /**
   * Cancels an ongoing chat stream.
   */
  cancel(): void;

  /** Provider name for telemetry */
  readonly providerName: string;
}
