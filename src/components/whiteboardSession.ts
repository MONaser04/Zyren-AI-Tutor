import type { WhiteboardPage } from './SlidePanel';
import type { ChatMessage } from './ChatDrawer';

export const DEFAULT_WHITEBOARD_TITLE = 'Untitled Whiteboard';
export const DEFAULT_WHITEBOARD_SLIDE_TITLE = 'Whiteboard Slide 1';

/**
 * Creates the blank whiteboard page used when the application starts and
 * when the user explicitly creates a new whiteboard.
 */
export function createBlankWhiteboardPage(createdAt: number = Date.now()): WhiteboardPage {
  return {
    id: `page-${createdAt}`,
    pageNumber: 1,
    title: DEFAULT_WHITEBOARD_SLIDE_TITLE,
    shapes: [],
    handwriting: [],
    createdAt,
  };
}

/**
 * Deduplicates adjacent repeating sentence or paragraph blocks caused by streaming accumulation loops.
 */
export function deduplicateRepeatedPhrases(text: string): string {
  if (!text || text.length < 30) return text;
  const cleaned = text.trim();

  // 1. Exact half duplicate (e.g. "ABC?ABC?" or "ABC\n\nDEF?ABC\n\nDEF?")
  const mid = Math.floor(cleaned.length / 2);
  if (cleaned.length % 2 === 0 && cleaned.slice(0, mid).trim() === cleaned.slice(mid).trim()) {
    return cleaned.slice(0, mid).trim();
  }

  // 2. Adjacent repeating blocks of 20+ chars
  const pattern = /(.{20,}?)(\s*[\.\?!؟]?\s*)\1(?:\2\1)*/gs;
  let prev = '';
  let curr = cleaned;
  let iterations = 0;
  while (curr !== prev && iterations < 5) {
    prev = curr;
    curr = curr.replace(pattern, '$1$2').trim();
    iterations++;
  }
  return curr;
}

/**
 * Reconciles incoming live speech/chat messages into the chat log while
 * preserving accumulated spoken user prefixes across long monologues
 * and eliminating duplicate or echoing assistant bubbles.
 */
export function reconcileLiveChatMessages(
  prev: ChatMessage[],
  item: { id?: string; role?: 'user' | 'assistant'; text?: string; timestamp?: number }
): ChatMessage[] {
  if (!item || !item.text) return prev;
  const rawText = item.text.trim();
  if (!rawText) return prev;

  const role = item.role || 'assistant';
  const cleanText = role === 'assistant' ? deduplicateRepeatedPhrases(rawText) : rawText;
  if (!cleanText) return prev;

  const existingIdx = item.id ? prev.findIndex((m) => m.id === item.id) : -1;
  if (existingIdx !== -1) {
    const updated = [...prev];
    const prevMsg = updated[existingIdx];
    const prevText = (prevMsg.text || '').trim();
    const effectiveRole = item.role || prevMsg.role;
    const nextText =
      effectiveRole === 'user' &&
      cleanText.length < prevText.length &&
      !prevText.startsWith(cleanText) &&
      !prevText.includes(cleanText)
        ? `${prevText} ${cleanText}`.trim()
        : cleanText;
    updated[existingIdx] = {
      ...prevMsg,
      text: nextText,
      role: effectiveRole,
    };
    return updated;
  }

  // Check if last message is an identical assistant message (consecutive assistant deduplication)
  if (role === 'assistant' && prev.length > 0) {
    const lastMsg = prev[prev.length - 1];
    if (lastMsg && lastMsg.role === 'assistant') {
      const lastClean = lastMsg.text.trim();
      if (lastClean === cleanText || cleanText.startsWith(lastClean) || lastClean.startsWith(cleanText)) {
        if (cleanText.length > lastClean.length) {
          const updated = [...prev];
          updated[updated.length - 1] = {
            ...lastMsg,
            text: cleanText,
            timestamp: item.timestamp || lastMsg.timestamp,
          };
          return updated;
        }
        return prev;
      }
    }
  }

  const nowTs = item.timestamp || Date.now();
  const isDuplicate = prev.some(
    (m) =>
      m.role === role &&
      m.text.trim() === cleanText &&
      Math.abs(m.timestamp - nowTs) < 30000
  );
  if (isDuplicate) return prev;

  return [
    ...prev,
    {
      id: item.id || `msg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      role,
      text: cleanText,
      timestamp: nowTs,
    },
  ];
}
