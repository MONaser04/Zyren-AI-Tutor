/**
 * GeminiAdapter — Google Gemini LLM implementation of ILLMAdapter.
 *
 * Stub implementation for the PoC phase. In production, the LLM calls
 * happen on the server-side (LiveKit Agent Worker). This adapter is for:
 * 1. Architecture documentation
 * 2. Direct usage in demo/test modes
 * 3. Future server-side implementation reference
 */
import type { ILLMAdapter, LLMMessage, LLMConfig, LLMStreamDelta } from './ILLMAdapter';

export class GeminiAdapter implements ILLMAdapter {
  readonly providerName = 'gemini';

  private apiKey: string;
  private baseUrl: string;
  private abortController: AbortController | null = null;

  constructor(apiKey: string, baseUrl = 'https://generativelanguage.googleapis.com') {
    this.apiKey = apiKey;
    this.baseUrl = baseUrl;
  }

  async *chat(messages: LLMMessage[], config: LLMConfig): AsyncIterable<LLMStreamDelta> {
    this.abortController = new AbortController();

    // Stub: In PoC mode, yield pre-scripted responses
    // In production, this connects to the Gemini API via server relay
    console.log('[GeminiAdapter] Chat called with', messages.length, 'messages');
    console.log('[GeminiAdapter] Config:', config.model);

    yield {
      type: 'text',
      text: 'Hello, I am your AI Tutor. Let us begin our session.',
    };

    yield {
      type: 'tool_call',
      toolCall: {
        id: 'demo-tool-1',
        name: 'whiteboard',
        arguments: {
          action: 'draw_diagram',
          elements: [
            { type: 'rectangle', x: 100, y: 100, width: 200, height: 80, label: 'Sample' },
          ],
        },
      },
    };

    yield { type: 'done' };
  }

  cancel(): void {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
  }
}
