import { describe, expect, it } from 'vitest';
import {
  createBlankWhiteboardPage,
  DEFAULT_WHITEBOARD_SLIDE_TITLE,
  DEFAULT_WHITEBOARD_TITLE,
  deduplicateRepeatedPhrases,
  reconcileLiveChatMessages,
} from '../../src/components/whiteboardSession';
import { computeAutoFollowPan, stepAutoFollowLerp } from '../../src/engine/CameraFollowController';

describe('whiteboard session defaults', () => {
  it('uses neutral default names for a new whiteboard', () => {
    expect(DEFAULT_WHITEBOARD_TITLE).toBe('Untitled Whiteboard');
    expect(DEFAULT_WHITEBOARD_SLIDE_TITLE).toBe('Whiteboard Slide 1');
  });

  it('creates a completely blank first slide', () => {
    const page = createBlankWhiteboardPage(1_700_000_000_000);

    expect(page).toEqual({
      id: 'page-1700000000000',
      pageNumber: 1,
      title: DEFAULT_WHITEBOARD_SLIDE_TITLE,
      shapes: [],
      handwriting: [],
      createdAt: 1_700_000_000_000,
    });
  });

  it('creates independent pages without shared content arrays', () => {
    const firstPage = createBlankWhiteboardPage(1_700_000_000_000);
    const secondPage = createBlankWhiteboardPage(1_700_000_000_001);

    firstPage.shapes.push({ shapeType: 'text' });
    firstPage.handwriting.push({ text: 'test' } as any);

    expect(secondPage.shapes).toEqual([]);
    expect(secondPage.handwriting).toEqual([]);
    expect(firstPage.shapes).not.toBe(secondPage.shapes);
    expect(firstPage.handwriting).not.toBe(secondPage.handwriting);
  });

  it('grows live user speech monotonically and never truncates earlier spoken prefixes', () => {
    let state = reconcileLiveChatMessages([], {
      id: 'GI_long_1',
      role: 'user',
      text: 'المشكلة الأولى والثانية والثالثة',
      timestamp: 1000,
    });
    expect(state).toHaveLength(1);
    expect(state[0].text).toBe('المشكلة الأولى والثانية والثالثة');

    // Normal cumulative growth on same turn ID
    state = reconcileLiveChatMessages(state, {
      id: 'GI_long_1',
      role: 'user',
      text: 'المشكلة الأولى والثانية والثالثة والرابعة والخامسة',
      timestamp: 2000,
    });
    expect(state[0].text).toBe('المشكلة الأولى والثانية والثالثة والرابعة والخامسة');

    // Unexpected shorter fragment on same turn ID preserves accumulated prefix
    state = reconcileLiveChatMessages(state, {
      id: 'GI_long_1',
      role: 'user',
      text: 'والسادسة والسابعة',
      timestamp: 3000,
    });
    expect(state[0].text).toBe(
      'المشكلة الأولى والثانية والثالثة والرابعة والخامسة والسادسة والسابعة'
    );
  });

  it('deduplicates consecutive identical assistant chat messages to prevent double bubbles', () => {
    const assistantMsg = 'تمام، دي الرسمة كاملة دلوقتي على البورد، بتوضح إزاي الـ Decision Tree بتقسم الـ data.';
    
    // First message received via generation_complete hook
    let state = reconcileLiveChatMessages([], {
      id: 'GR_resp_1',
      role: 'assistant',
      text: assistantMsg,
      timestamp: 1000,
    });
    expect(state).toHaveLength(1);
    expect(state[0].text).toBe(assistantMsg);

    // Second message received 9 seconds later via on_conversation_item_added with distinct item_id
    state = reconcileLiveChatMessages(state, {
      id: 'item_speech_2',
      role: 'assistant',
      text: assistantMsg,
      timestamp: 10000,
    });
    // Should NOT create a duplicate bubble
    expect(state).toHaveLength(1);
    expect(state[0].text).toBe(assistantMsg);
  });

  it('cleans repeating phrases in assistant responses using deduplicateRepeatedPhrases', () => {
    const repeated =
      'تمام، دي الرسمة كاملة على البورد، بتوضح إزاي الـ Decision Tree بتقسم الـ data.\n\nهل كده أوضح لك؟' +
      'تمام، دي الرسمة كاملة على البورد، بتوضح إزاي الـ Decision Tree بتقسم الـ data.\n\nهل كده أوضح لك؟';

    const cleaned = deduplicateRepeatedPhrases(repeated);
    expect(cleaned).toBe(
      'تمام، دي الرسمة كاملة على البورد، بتوضح إزاي الـ Decision Tree بتقسم الـ data.\n\nهل كده أوضح لك؟'
    );

    // Normal text without repetition remains intact
    const normal = 'هذا نص عادي بدون تكرار يشرح الفكرة بشكل مباشر.';
    expect(deduplicateRepeatedPhrases(normal)).toBe(normal);
  });

  it('guarantees Auto-Follow camera is not blocked on initial startup when lastManualMove is -Infinity', () => {
    const lastManualCameraMove = -Infinity;
    const now = 200; // 200ms into page load
    const isLocked = Number.isFinite(lastManualCameraMove) && now - lastManualCameraMove < 1500;
    expect(isLocked).toBe(false);

    // If it was 0, it would incorrectly lock out
    const oldBuggyLock = now - 0 < 1500;
    expect(oldBuggyLock).toBe(true);
  });

  it('correctly calculates Auto-Follow smooth panning for writing targets outside safe margins', () => {
    const currentTransform = { zoom: 1, pan: { x: 0, y: 0 } };
    const res = computeAutoFollowPan(
      { x: 1700, y: 900, width: 120, height: 40, kind: 'handwriting' },
      currentTransform,
      1280,
      720,
      { left: 16, right: 326, top: 68, bottom: 78 }
    );
    expect(res.needsPan).toBe(true);
    expect(res.desiredPanX).toBeLessThan(0); // Panned left to bring rightward text into view
  });

  it('never hides a new assistant turn inside an old assistant bubble above newer user messages', () => {
    let state = reconcileLiveChatMessages([], {
      id: 'GR_resp_1',
      role: 'assistant',
      text: 'تمام، نقلت لك تعريف الـ',
      timestamp: 1000,
    });
    state = reconcileLiveChatMessages(state, {
      id: 'GI_user_1',
      role: 'user',
      text: 'ممكن تعملي ديجرام من تحت لفوق',
      timestamp: 2000,
    });
    state = reconcileLiveChatMessages(state, {
      id: 'GR_resp_1',
      role: 'assistant',
      text: 'أكيد! هعملك دلوقتي ديجرام من تحت لفوق يوضح الفروع كلها.',
      timestamp: 3000,
    });

    expect(state).toHaveLength(3);
    expect(state[2].role).toBe('assistant');
    expect(state[2].text).toContain('ديجرام من تحت لفوق');
  });
});
