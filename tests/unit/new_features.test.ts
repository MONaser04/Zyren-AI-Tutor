import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  deleteGeminiApiKey,
  deleteSavedSessionFromDisk,
  listSavedSessionsFromDisk,
  loadSavedSessionFromDisk,
  maskApiKey,
  resolveGeminiApiKey,
  resolveMediaFileOnDisk,
  saveMediaBinaryToDisk,
  saveSessionSnapshotToDisk,
  saveVerifiedGeminiApiKey,
  validateGeminiApiKeyLive,
} from '../../src/server/zyrenBackendVault';
import { getShapeBounds, findFreePosition } from '../../src/engine/CollisionDetector';
import { SyncEngine } from '../../src/engine/SyncEngine';
import {
  deriveSmartSessionTitle,
  hasSubstantiveSessionContent,
} from '../../src/services/sessionAutoSave';
import { formatLatexForMiniPreview } from '../../src/components/SlideThumbnail';
import {
  computeAutoFollowPan,
  computeAutoFollowTransform,
  stepAutoFollowLerp,
  stepAutoFollowTransformLerp,
} from '../../src/engine/CameraFollowController';
import { toggleSessionPinOnDisk } from '../../src/server/zyrenBackendVault';
import { createBlankWhiteboardPage } from '../../src/components/whiteboardSession';

describe('Feature 1: In-App Gemini API Key Vault & Live Verification', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zyren-vault-test-'));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('rejects malformed or unauthorized keys and NEVER saves an unverified key to disk', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ error: { message: 'API key not valid. Please pass a valid API key.' } }),
    } as any);

    const badSave = await saveVerifiedGeminiApiKey('AIzaSyInvalidKey1234567890123456', {
      appDataDir: tempDir,
      fetchImpl: mockFetch as any,
    });

    expect(badSave.valid).toBe(false);
    expect(badSave.saved).toBe(false);
    expect(fs.existsSync(path.join(tempDir, 'config.json'))).toBe(false);
  });

  it('automatically verifies valid keys live against Google API before persisting, and supports change & delete', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        models: [{ name: 'models/gemini-3.1-flash-live-preview' }],
      }),
    } as any);

    // 1. Env fallback before UI key exists
    const initial = resolveGeminiApiKey({
      appDataDir: tempDir,
      envVars: { GEMINI_API_KEY: 'AIzaSyEnvKey0000000000000000001234' },
    });
    expect(initial.configured).toBe(true);
    expect(initial.source).toBe('env');

    // 2. Save verified UI key (even if user clicked Save without clicking Test first)
    const saved = await saveVerifiedGeminiApiKey('AIzaSyLiveVerifiedKey99999999998888', {
      appDataDir: tempDir,
      fetchImpl: mockFetch as any,
    });
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(saved.valid).toBe(true);
    expect(saved.saved).toBe(true);
    expect(saved.maskedKey).toBe(maskApiKey('AIzaSyLiveVerifiedKey99999999998888'));

    const resolvedAfterSave = resolveGeminiApiKey({
      appDataDir: tempDir,
      envVars: { GEMINI_API_KEY: 'AIzaSyEnvKey0000000000000000001234' },
    });
    expect(resolvedAfterSave.source).toBe('ui');
    expect(resolvedAfterSave.apiKey).toBe('AIzaSyLiveVerifiedKey99999999998888');

    // 3. Explicit Test helper validates format & live HTTP status
    const tooShort = await validateGeminiApiKeyLive('short', mockFetch as any);
    expect(tooShort.valid).toBe(false);
    expect(tooShort.errorCode).toBe('MALFORMED_KEY');

    // 4. Delete key clears secret and sets keyDeletedByUser so .env does not silently resurrect
    const del = deleteGeminiApiKey({ appDataDir: tempDir });
    expect(del.deleted).toBe(true);
    const afterDelete = resolveGeminiApiKey({
      appDataDir: tempDir,
      envVars: { GEMINI_API_KEY: 'AIzaSyEnvKey0000000000000000001234' },
    });
    expect(afterDelete.configured).toBe(false);
    expect(afterDelete.source).toBe('none');
  });
});

describe('Feature 2: Continuous Dual-Tier Auto-Save (Slides + Full Chat Transcripts)', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zyren-autosave-test-'));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('guards against overwriting saved work with a blank initial slide and derives smart titles', () => {
    const blankPage = createBlankWhiteboardPage(1700000000000);
    expect(hasSubstantiveSessionContent([blankPage], [])).toBe(false);

    const chatOnly = [
      { id: 'm1', role: 'user' as const, text: 'Explain Integration by Parts step by step', timestamp: 100 },
    ];
    expect(hasSubstantiveSessionContent([blankPage], chatOnly)).toBe(true);

    const smart = deriveSmartSessionTitle('Untitled Whiteboard', true, [blankPage], chatOnly);
    expect(smart.title).toBe('Explain Integration by Parts step by step');
    expect(smart.isAutoTitled).toBe(true);

    // Explicit manual title is preserved
    const manual = deriveSmartSessionTitle('My Exam Prep', false, [blankPage], chatOnly);
    expect(manual.title).toBe('My Exam Prep');
    expect(manual.isAutoTitled).toBe(false);
  });

  it('atomically persists, indexes, reloads, and deletes full multi-slide + chat sessions on OS disk', () => {
    const slide1 = createBlankWhiteboardPage(1000);
    slide1.title = 'Grundrechenoperationen';
    slide1.shapes.push({
      id: 'math-1',
      shapeType: 'math',
      x: 120,
      y: 220,
      options: { latex: 'a \\cdot (b + c) = a \\cdot b + a \\cdot c' },
    });

    const messages = [
      { id: 'u1', role: 'user', text: 'اشرحلي خاصية التوزيع', timestamp: 1010 },
      { id: 'a1', role: 'assistant', text: 'خاصية التوزيع تعني ضرب العامل الخارجي في كل حد داخل القوس.', timestamp: 1020 },
    ];

    const res = saveSessionSnapshotToDisk(
      {
        id: 'session_test_alpha',
        title: 'Grundrechenoperationen',
        isAutoTitled: true,
        createdAt: 1000,
        updatedAt: 2000,
        activePageIndex: 0,
        pages: [slide1],
        chatMessages: messages,
      },
      { appDataDir: tempDir, setActive: true }
    );

    expect(res.ok).toBe(true);
    expect(res.summary.slideCount).toBe(1);
    expect(res.summary.messageCount).toBe(2);

    const index = listSavedSessionsFromDisk({ appDataDir: tempDir });
    expect(index.activeSessionId).toBe('session_test_alpha');
    expect(index.sessions).toHaveLength(1);

    const restored = loadSavedSessionFromDisk('latest', { appDataDir: tempDir });
    expect(restored).not.toBeNull();
    expect(restored.title).toBe('Grundrechenoperationen');
    expect(restored.pages[0].shapes[0].options.latex).toContain('a \\cdot (b + c)');
    expect(restored.chatMessages).toHaveLength(2);
    expect(restored.chatMessages[0].text).toBe('اشرحلي خاصية التوزيع');

    const afterDelete = deleteSavedSessionFromDisk('session_test_alpha', { appDataDir: tempDir });
    expect(afterDelete.sessions).toHaveLength(0);
    expect(loadSavedSessionFromDisk('latest', { appDataDir: tempDir })).toBeNull();
  });
});

describe('Feature 3: Visual PowerPoint-Style Thumbnail Formatter', () => {
  it('converts LaTeX formulas into crisp readable miniature preview text and detects boxed equations', () => {
    const formatted = formatLatexForMiniPreview('\\boxed{\\frac{a + b}{2} \\cdot x^2 = \\sqrt{9}}');
    expect(formatted.boxed).toBe(true);
    expect(formatted.display).toContain('(a + b)/(2)');
    expect(formatted.display).toContain('·');
    expect(formatted.display).toContain('x²');
    expect(formatted.display).toContain('√(9)');
  });
});

describe('Feature 4: Real-Time Auto-Follow Camera Controller', () => {
  it('stays completely still (zero jitter) when writing is already inside the safe deadzone', () => {
    // Student viewing full 1920x1080 board at 0.65x fit zoom in a 1440x900 window
    const res = computeAutoFollowPan(
      { x: 300, y: 260, width: 280, height: 50, kind: 'handwriting-pen' },
      { zoom: 0.65, pan: { x: 96, y: 99 } },
      1440,
      900,
      { left: 16, right: 326, top: 68, bottom: 78 },
      0.68
    );
    expect(res.needsPan).toBe(false);
  });

  it('pans smoothly to top-right writing when student is zoomed in at bottom-left, preserving exact zoom', () => {
    // Zoomed in 2.0x looking at bottom-left (x: 100..650, y: 650..1050) -> pan = (-150, -1250)
    const currentTransform = { zoom: 2.0, pan: { x: -150, y: -1250 } };
    // AI writes in top-right column (x = 1150, y = 180)
    const target = { x: 1150, y: 180, width: 320, height: 60, kind: 'handwriting-pen' };

    const res = computeAutoFollowPan(
      target,
      currentTransform,
      1440,
      900,
      { left: 16, right: 326, top: 68, bottom: 78 },
      0.68
    );

    expect(res.needsPan).toBe(true);
    // Verify that applying desiredPan places (1150, 210) cleanly inside the unobstructed viewport!
    const newScreenX = res.desiredPanX + target.x * currentTransform.zoom;
    const newScreenY = res.desiredPanY + (target.y + 30) * currentTransform.zoom;
    expect(newScreenX).toBeGreaterThan(100);
    expect(newScreenX).toBeLessThan(1440 - 326);
    expect(newScreenY).toBeGreaterThan(68);
    expect(newScreenY).toBeLessThan(900 - 78);

    // Verify LERP converges smoothly without jumps
    let pan = { ...currentTransform.pan };
    let settled = false;
    for (let i = 0; i < 120; i++) {
      const step = stepAutoFollowLerp(pan, { x: res.desiredPanX, y: res.desiredPanY }, 1 / 60, 0.16);
      pan = step.pan;
      if (step.settled) {
        settled = true;
        break;
      }
    }
    expect(settled).toBe(true);
    expect(pan.x).toBeCloseTo(res.desiredPanX, 2);
    expect(pan.y).toBeCloseTo(res.desiredPanY, 2);
  });
});

describe('Feature 5: Slide Embedded Images & Videos Vault + Collision & SyncEngine Lifecycle', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zyren-media-vault-test-'));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('stores binary image & video blobs on disk without bloating JSON and resolves them safely', () => {
    const fakeMp4 = Buffer.from([0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x6d, 0x70, 0x34, 0x32]);
    const meta = saveMediaBinaryToDisk({
      buffer: fakeMp4,
      originalName: 'lecture_demo.mp4',
      mimeType: 'video/mp4',
      appDataDir: tempDir,
    });

    expect(meta.mediaId).toMatch(/^media_\d+_[a-z0-9]+$/);
    expect(meta.url).toBe(`/api/media/${meta.storedFileName}`);
    expect(meta.sizeBytes).toBe(fakeMp4.length);

    const resolvedById = resolveMediaFileOnDisk(meta.mediaId, { appDataDir: tempDir });
    expect(resolvedById).not.toBeNull();
    expect(resolvedById!.mimeType).toBe('video/mp4');
    expect(fs.readFileSync(resolvedById!.filePath).equals(fakeMp4)).toBe(true);

    const resolvedByFileName = resolveMediaFileOnDisk(meta.storedFileName, { appDataDir: tempDir });
    expect(resolvedByFileName).not.toBeNull();
    expect(resolvedByFileName!.sizeBytes).toBe(fakeMp4.length);
  });

  it('tracks image & video bounding boxes in CollisionDetector and supports move/resize/remove/undo/redo in SyncEngine', async () => {
    const videoShape = {
      id: 'media-vid-1',
      shapeType: 'video' as const,
      x: 100,
      y: 140,
      options: {
        id: 'media-vid-1',
        mediaType: 'video' as const,
        url: '/api/media/media_123.mp4',
        fileName: 'kinematics.mp4',
        mimeType: 'video/mp4',
        width: 560,
        height: 315,
      },
    };

    const bounds = getShapeBounds({
      shapeType: 'video',
      x: videoShape.x,
      y: videoShape.y,
      width: videoShape.options.width,
      height: videoShape.options.height,
    });
    expect(bounds.width).toBe(560);
    expect(bounds.height).toBe(315);

    const nextPos = findFreePosition(
      { x: 150, y: 180 },
      { width: 320, height: 60 },
      [
        {
          shapeType: 'video',
          x: 150,
          y: 180,
          width: 560,
          height: 315,
        },
      ],
      false,
      'math'
    );
    expect(nextPos.y).toBeGreaterThanOrEqual(180 + 315);

    const addedMedia: any[] = [];
    const mockMediaOverlay = {
      addMedia: vi.fn((item) => addedMedia.push({ ...item })),
      updateMediaGeometry: vi.fn((id, x, y, width, height) => {
        const found = addedMedia.find((m) => m.id === id);
        if (found) {
          found.x = x;
          found.y = y;
          found.width = width;
          found.height = height;
        }
      }),
      removeMedia: vi.fn((id) => {
        const idx = addedMedia.findIndex((m) => m.id === id);
        if (idx >= 0) addedMedia.splice(idx, 1);
      }),
      clear: vi.fn(() => {
        addedMedia.length = 0;
      }),
      eraseNear: vi.fn(() => null),
      hasPlayingVideo: vi.fn(() => false),
      getRuntimeStates: vi.fn(() => []),
      drawMediaToCanvas: vi.fn(),
    };

    const engine = new SyncEngine({
      canvasAdapter: { clear: vi.fn(), drawText: vi.fn(), drawLine: vi.fn(), drawArrow: vi.fn() } as any,
      svgOverlay: { clear: vi.fn(), setWords: vi.fn(), addWord: vi.fn(), seek: vi.fn() } as any,
      mediaOverlay: mockMediaOverlay as any,
    });

    engine.executeShapeCommand(videoShape as any);
    expect(addedMedia).toHaveLength(1);
    expect(addedMedia[0].fileName).toBe('kinematics.mp4');

    // Drag/Resize geometry update
    const updated = engine.updateShapeGeometry('media-vid-1', 240, 180, 640, 360);
    expect(updated).toBe(true);
    expect(engine.getDrawnShapes()[0].x).toBe(240);
    expect(engine.getDrawnShapes()[0].width).toBe(640);
    expect(engine.getDrawnShapes()[0].options.width).toBe(640);

    // Undo / Redo
    engine.undo();
    expect(engine.getDrawnShapes()).toHaveLength(0);
    expect(addedMedia).toHaveLength(0);

    engine.redo();
    expect(engine.getDrawnShapes()).toHaveLength(1);
    expect(addedMedia).toHaveLength(1);

    // Explicit delete by ID
    const removed = engine.removeShapeById('media-vid-1');
    expect(removed).toBe(true);
    expect(engine.getDrawnShapes()).toHaveLength(0);
    expect(addedMedia).toHaveLength(0);
  });
});

describe('Feature 6: Adaptive Auto-Resize & Camera Framing (Auto-Fit)', () => {
  it('smoothly scales down zoom when a large diagram exceeds the safe viewport area', () => {
    // Large diagram spanning 950px width x 550px height
    const diagramTarget = {
      x: 300,
      y: 200,
      width: 950,
      height: 550,
      kind: 'diagram',
    };

    const currentTransform = {
      zoom: 1.5, // Student is zoomed in
      pan: { x: 0, y: 0 },
    };

    const containerWidth = 1200;
    const containerHeight = 700;
    const insets = { left: 50, right: 50, top: 60, bottom: 60 };

    const result = computeAutoFollowTransform(
      diagramTarget,
      currentTransform,
      containerWidth,
      containerHeight,
      insets,
      { autoResize: true, deadzoneRatio: 0.7, targetFillRatio: 0.78 }
    );

    expect(result.needsMotion).toBe(true);
    expect(result.needsZoom).toBe(true);
    // Desired zoom must be lower than 1.5 to comfortably fit 950px into ~850px safe area
    expect(result.desiredZoom).toBeLessThan(1.2);
    expect(result.desiredZoom).toBeGreaterThanOrEqual(0.52);
  });

  it('preserves user zoom when content fits easily within the safe area', () => {
    const smallTarget = {
      x: 400,
      y: 300,
      width: 140,
      height: 60,
      kind: 'rectangle',
    };

    const currentTransform = {
      zoom: 1.0,
      pan: { x: 0, y: 0 },
    };

    const result = computeAutoFollowTransform(
      smallTarget,
      currentTransform,
      1920,
      1080,
      { left: 0, right: 0, top: 60, bottom: 60 },
      { autoResize: true }
    );

    expect(result.needsZoom).toBe(false);
    expect(result.desiredZoom).toBe(1.0);
  });

  it('interpolates both zoom and pan simultaneously in stepAutoFollowTransformLerp', () => {
    const current = { zoom: 1.5, pan: { x: 100, y: 50 } };
    const target = { zoom: 0.85, pan: { x: -200, y: -100 } };

    const step1 = stepAutoFollowTransformLerp(current, target, 0.016, 0.14);
    expect(step1.settled).toBe(false);
    expect(step1.transform.zoom).toBeLessThan(1.5);
    expect(step1.transform.zoom).toBeGreaterThan(0.85);
    expect(step1.transform.pan.x).toBeLessThan(100);

    // After large dt or multiple steps, it settles exactly
    const stepFinal = stepAutoFollowTransformLerp(target, target, 0.016, 0.14);
    expect(stepFinal.settled).toBe(true);
    expect(stepFinal.transform.zoom).toBe(0.85);
    expect(stepFinal.transform.pan.x).toBe(-200);
  });
});

describe('Feature 7: Session Pinning & Eviction Immunity', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zyren-pin-test-'));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('toggles session pin state and prioritizes pinned sessions at the top', () => {
    // 1. Create two sessions
    saveSessionSnapshotToDisk(
      {
        id: 'session-alpha',
        title: 'Alpha Session',
        pages: [{ id: 'p1', shapes: [], handwriting: [], userPaths: [], userTexts: [] }],
        updatedAt: 1000,
      },
      { appDataDir: tempDir }
    );

    saveSessionSnapshotToDisk(
      {
        id: 'session-beta',
        title: 'Beta Session',
        pages: [{ id: 'p1', shapes: [], handwriting: [], userPaths: [], userTexts: [] }],
        updatedAt: 2000,
      },
      { appDataDir: tempDir }
    );

    // Initially beta is first because updatedAt 2000 > 1000
    let index = listSavedSessionsFromDisk({ appDataDir: tempDir });
    expect(index.sessions[0].id).toBe('session-beta');

    // 2. Pin alpha session
    const pinRes = toggleSessionPinOnDisk('session-alpha', true, { appDataDir: tempDir });
    expect(pinRes.ok).toBe(true);
    expect(pinRes.isPinned).toBe(true);

    // Alpha is now at the top despite older updatedAt!
    index = listSavedSessionsFromDisk({ appDataDir: tempDir });
    expect(index.sessions[0].id).toBe('session-alpha');
    expect(index.sessions[0].isPinned).toBe(true);

    // 3. Unpin alpha session
    const unpinRes = toggleSessionPinOnDisk('session-alpha', false, { appDataDir: tempDir });
    expect(unpinRes.isPinned).toBe(false);

    index = listSavedSessionsFromDisk({ appDataDir: tempDir });
    expect(index.sessions[0].id).toBe('session-beta');
  });
});
