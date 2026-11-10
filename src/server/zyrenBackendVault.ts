import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const APP_FOLDER_NAME = 'ZYREN_AI_Tutor';
const MAX_STORED_SESSIONS = 50;

export interface AppConfigFile {
  geminiApiKey?: string;
  keyDeletedByUser?: boolean;
  updatedAt?: number;
  verifiedAt?: number;
  providers?: Record<string, StoredProviderConfig>;
  intermediateModel?: IntermediateModelSettings;
}

export interface ResolvedKeyInfo {
  apiKey: string;
  configured: boolean;
  source: 'ui' | 'env' | 'none';
  maskedKey: string | null;
  updatedAt?: number;
  verifiedAt?: number;
}

export interface KeyValidationResult {
  valid: boolean;
  latencyMs: number;
  modelCount?: number;
  statusCode?: number;
  errorCode?: string;
  message?: string;
  error?: string;
}

export interface SessionSummaryItem {
  id: string;
  title: string;
  isAutoTitled?: boolean;
  isPinned?: boolean;
  createdAt: number;
  updatedAt: number;
  slideCount: number;
  messageCount: number;
}

export interface SessionIndexFile {
  activeSessionId: string | null;
  sessions: SessionSummaryItem[];
}

export interface MediaMetaRecord {
  mediaId: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  ext: string;
  storedFileName: string;
  createdAt: number;
}

export function getZyrenAppDataDir(customDir?: string): string {
  const override = (customDir || process.env.ZYREN_APPDATA_DIR || '').trim();
  let base: string;
  if (override) {
    base = path.resolve(override);
  } else if (process.platform === 'win32') {
    const appData = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
    base = path.join(appData, APP_FOLDER_NAME);
  } else if (process.platform === 'darwin') {
    base = path.join(os.homedir(), 'Library', 'Application Support', APP_FOLDER_NAME);
  } else {
    const xdg = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
    base = path.join(xdg, APP_FOLDER_NAME);
  }
  fs.mkdirSync(base, { recursive: true });
  return base;
}

export function writeJsonAtomic(filePath: string, data: unknown, restrictPerms = false): void {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  const tmpPath = `${filePath}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}.tmp`;
  const jsonText = JSON.stringify(data, null, 2);

  let fd: number | null = null;
  try {
    fd = fs.openSync(tmpPath, 'w', restrictPerms ? 0o600 : 0o666);
    fs.writeFileSync(fd, jsonText, { encoding: 'utf-8' });
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = null;
    fs.renameSync(tmpPath, filePath);
  } finally {
    if (fd !== null) {
      try {
        fs.closeSync(fd);
      } catch {
        // ignore
      }
    }
    if (fs.existsSync(tmpPath)) {
      try {
        fs.unlinkSync(tmpPath);
      } catch {
        // ignore
      }
    }
  }
}

export function maskApiKey(rawKey: string): string {
  const cleaned = (rawKey || '').trim();
  if (!cleaned) return '';
  if (cleaned.length <= 10) {
    return `${cleaned.slice(0, 2)}${'•'.repeat(Math.max(4, cleaned.length - 4))}${cleaned.slice(-2)}`;
  }
  return `${cleaned.slice(0, 6)}${'•'.repeat(12)}${cleaned.slice(-4)}`;
}

export function readAppConfig(appDataDir?: string): AppConfigFile {
  const cfgPath = path.join(getZyrenAppDataDir(appDataDir), 'config.json');
  if (!fs.existsSync(cfgPath)) return {};
  try {
    const raw = fs.readFileSync(cfgPath, 'utf-8');
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? (parsed as AppConfigFile) : {};
  } catch {
    return {};
  }
}

export function resolveGeminiApiKey(opts?: {
  appDataDir?: string;
  envVars?: Record<string, string | undefined>;
}): ResolvedKeyInfo {
  const cfg = readAppConfig(opts?.appDataDir);
  const uiKey = (cfg.geminiApiKey || '').trim();
  if (uiKey.length > 5) {
    return {
      apiKey: uiKey,
      configured: true,
      source: 'ui',
      maskedKey: maskApiKey(uiKey),
      updatedAt: cfg.updatedAt,
      verifiedAt: cfg.verifiedAt,
    };
  }

  if (cfg.keyDeletedByUser === true) {
    return {
      apiKey: '',
      configured: false,
      source: 'none',
      maskedKey: null,
      updatedAt: cfg.updatedAt,
    };
  }

  const envMap = opts?.envVars || process.env;
  const envKey = (envMap.GEMINI_API_KEY || envMap.GOOGLE_API_KEY || '').trim();
  if (envKey.length > 5) {
    return {
      apiKey: envKey,
      configured: true,
      source: 'env',
      maskedKey: maskApiKey(envKey),
    };
  }

  return {
    apiKey: '',
    configured: false,
    source: 'none',
    maskedKey: null,
  };
}

export async function validateGeminiApiKeyLive(
  rawKey: string,
  fetchImpl: typeof fetch = fetch
): Promise<KeyValidationResult> {
  const key = (rawKey || '').trim();
  const start = performance.now();

  if (!key) {
    return {
      valid: false,
      latencyMs: 0,
      errorCode: 'EMPTY_KEY',
      error: 'Please enter a Gemini API key.',
    };
  }

  if (key.length < 20 || /\s/.test(key) || !/^[\x21-\x7E]+$/.test(key)) {
    return {
      valid: false,
      latencyMs: 0,
      errorCode: 'MALFORMED_KEY',
      error: 'Invalid key format. A Google Gemini API key must contain at least 20 printable characters without spaces.',
    };
  }

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12000);

    let res: Response;
    try {
      res = await fetchImpl('https://generativelanguage.googleapis.com/v1beta/models?pageSize=25', {
        method: 'GET',
        headers: {
          'x-goog-api-key': key,
          Accept: 'application/json',
        },
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }

    const latencyMs = Math.max(1, Math.round(performance.now() - start));
    let payload: any = null;
    try {
      payload = await res.json();
    } catch {
      payload = null;
    }

    if (res.ok && payload && Array.isArray(payload.models) && payload.models.length > 0) {
      return {
        valid: true,
        latencyMs,
        modelCount: payload.models.length,
        statusCode: res.status,
        message: `Verified & active with Google Gemini API (${latencyMs}ms).`,
      };
    }

    const rpcStatus = payload?.error?.status || `HTTP_${res.status}`;
    const rpcMessage =
      payload?.error?.message ||
      (res.status === 400 || res.status === 401
        ? 'API key is not valid. Please check the key in Google AI Studio.'
        : res.status === 403
        ? 'Permission denied. Ensure Generative Language API is enabled for this key.'
        : `Google API responded with HTTP ${res.status}.`);

    return {
      valid: false,
      latencyMs,
      statusCode: res.status,
      errorCode: rpcStatus,
      error: rpcMessage,
    };
  } catch (err: any) {
    const latencyMs = Math.max(1, Math.round(performance.now() - start));
    const isTimeout = err?.name === 'AbortError';
    return {
      valid: false,
      latencyMs,
      errorCode: isTimeout ? 'TIMEOUT' : 'NETWORK_ERROR',
      error: isTimeout
        ? 'Connection to Google Gemini API timed out (12s). Check your internet connection.'
        : `Network error while verifying key: ${err?.message || 'Unable to reach generativelanguage.googleapis.com'}`,
    };
  }
}

export async function saveVerifiedGeminiApiKey(
  rawKey: string,
  opts?: { appDataDir?: string; fetchImpl?: typeof fetch }
): Promise<
  KeyValidationResult & {
    saved: boolean;
    configured: boolean;
    source?: 'ui';
    maskedKey?: string;
    updatedAt?: number;
    verifiedAt?: number;
  }
> {
  const trimmed = (rawKey || '').trim();
  const verification = await validateGeminiApiKeyLive(trimmed, opts?.fetchImpl || fetch);

  if (!verification.valid) {
    return {
      ...verification,
      saved: false,
      configured: false,
    };
  }

  const now = Date.now();
  const cfgPath = path.join(getZyrenAppDataDir(opts?.appDataDir), 'config.json');
  const nextCfg: AppConfigFile = {
    geminiApiKey: trimmed,
    keyDeletedByUser: false,
    updatedAt: now,
    verifiedAt: now,
  };
  writeJsonAtomic(cfgPath, nextCfg, true);

  return {
    ...verification,
    saved: true,
    configured: true,
    source: 'ui',
    maskedKey: maskApiKey(trimmed),
    updatedAt: now,
    verifiedAt: now,
  };
}

export function deleteGeminiApiKey(opts?: { appDataDir?: string }): {
  deleted: boolean;
  configured: boolean;
  source: 'none';
  maskedKey: null;
  updatedAt: number;
} {
  const now = Date.now();
  const cfgPath = path.join(getZyrenAppDataDir(opts?.appDataDir), 'config.json');
  const nextCfg: AppConfigFile = {
    geminiApiKey: '',
    keyDeletedByUser: true,
    updatedAt: now,
  };
  writeJsonAtomic(cfgPath, nextCfg, true);
  return {
    deleted: true,
    configured: false,
    source: 'none',
    maskedKey: null,
    updatedAt: now,
  };
}

// ─── Session Auto-Save Disk Vault (AppData/ZYREN_AI_Tutor/sessions) ─────────

export function sanitizeSessionId(rawId: string): string {
  const cleaned = (rawId || '').trim().replace(/[^a-zA-Z0-9_-]/g, '_');
  return cleaned.slice(0, 96) || `session_${Date.now()}`;
}

function getSessionsDir(appDataDir?: string): string {
  const dir = path.join(getZyrenAppDataDir(appDataDir), 'sessions');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function readSessionIndex(sessionsDir: string): SessionIndexFile {
  const indexPath = path.join(sessionsDir, 'index.json');
  if (fs.existsSync(indexPath)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(indexPath, 'utf-8'));
      if (parsed && Array.isArray(parsed.sessions)) {
        return {
          activeSessionId: typeof parsed.activeSessionId === 'string' ? parsed.activeSessionId : null,
          sessions: parsed.sessions,
        };
      }
    } catch {
      // Rebuild below if corrupted
    }
  }

  // Self-healing rebuild from *.aitutor.json files on disk
  const rebuilt: SessionSummaryItem[] = [];
  try {
    const files = fs.readdirSync(sessionsDir).filter((f) => f.endsWith('.aitutor.json'));
    for (const file of files) {
      try {
        const full = JSON.parse(fs.readFileSync(path.join(sessionsDir, file), 'utf-8'));
        if (full && full.id && Array.isArray(full.pages)) {
          rebuilt.push({
            id: sanitizeSessionId(full.id),
            title: full.title || 'Untitled Whiteboard',
            isAutoTitled: Boolean(full.isAutoTitled),
            createdAt: Number(full.createdAt) || Number(full.timestamp) || Date.now(),
            updatedAt: Number(full.updatedAt) || Number(full.timestamp) || Date.now(),
            slideCount: full.pages.length,
            messageCount: Array.isArray(full.chatMessages) ? full.chatMessages.length : 0,
          });
        }
      } catch {
        // skip unreadable file
      }
    }
  } catch {
    // ignore
  }

  rebuilt.sort((a, b) => b.updatedAt - a.updatedAt);
  return {
    activeSessionId: rebuilt[0]?.id || null,
    sessions: rebuilt,
  };
}

export function saveSessionSnapshotToDisk(
  payload: any,
  opts?: { appDataDir?: string; setActive?: boolean }
): { ok: boolean; summary: SessionSummaryItem } {
  if (!payload || typeof payload !== 'object' || !Array.isArray(payload.pages) || payload.pages.length === 0) {
    throw new Error('Invalid session payload: pages array is required.');
  }

  const sessionsDir = getSessionsDir(opts?.appDataDir);
  const safeId = sanitizeSessionId(payload.id || `session_${Date.now()}`);
  const now = Date.now();
  const createdAt = Number(payload.createdAt) || Number(payload.timestamp) || now;
  const updatedAt = Number(payload.updatedAt) || now;
  const chatMessages = Array.isArray(payload.chatMessages) ? payload.chatMessages : [];
  const title = String(payload.title || 'Untitled Whiteboard').trim() || 'Untitled Whiteboard';

  const currentIndex = readSessionIndex(sessionsDir);
  const existingInIdx = currentIndex.sessions.find((s) => s.id === safeId);
  const isPinned = payload.isPinned !== undefined ? Boolean(payload.isPinned) : Boolean(existingInIdx?.isPinned);

  const normalizedRecord = {
    version: '2.0',
    appName: 'AI_Tutor_Whiteboard',
    id: safeId,
    title,
    isAutoTitled: Boolean(payload.isAutoTitled),
    isPinned,
    createdAt,
    updatedAt,
    timestamp: updatedAt,
    activePageIndex: Math.max(0, Math.min(payload.pages.length - 1, Number(payload.activePageIndex) || 0)),
    pages: payload.pages,
    chatMessages,
  };

  const sessionFilePath = path.join(sessionsDir, `${safeId}.aitutor.json`);
  writeJsonAtomic(sessionFilePath, normalizedRecord, false);

  const summary: SessionSummaryItem = {
    id: safeId,
    title,
    isAutoTitled: Boolean(payload.isAutoTitled),
    isPinned,
    createdAt,
    updatedAt,
    slideCount: payload.pages.length,
    messageCount: chatMessages.length,
  };

  const filtered = currentIndex.sessions.filter((s) => s.id !== safeId);
  const merged = [summary, ...filtered].sort((a, b) => {
    const aPin = Boolean(a.isPinned);
    const bPin = Boolean(b.isPinned);
    if (bPin !== aPin) return bPin ? 1 : -1;
    return b.updatedAt - a.updatedAt;
  });

  // Protect pinned sessions from automatic eviction!
  const pinnedSessions = merged.filter((s) => s.isPinned);
  const unpinnedSessions = merged.filter((s) => !s.isPinned);
  const maxUnpinned = Math.max(10, MAX_STORED_SESSIONS - pinnedSessions.length);
  const keptUnpinned = unpinnedSessions.slice(0, maxUnpinned);
  const evicted = unpinnedSessions.slice(maxUnpinned);

  for (const old of evicted) {
    const oldFile = path.join(sessionsDir, `${sanitizeSessionId(old.id)}.aitutor.json`);
    if (fs.existsSync(oldFile)) {
      try {
        fs.unlinkSync(oldFile);
      } catch {
        // ignore
      }
    }
  }

  const kept = [...pinnedSessions, ...keptUnpinned].sort((a, b) => {
    const aPin = Boolean(a.isPinned);
    const bPin = Boolean(b.isPinned);
    if (bPin !== aPin) return bPin ? 1 : -1;
    return b.updatedAt - a.updatedAt;
  });

  const nextIndex: SessionIndexFile = {
    activeSessionId: opts?.setActive === false ? (currentIndex.activeSessionId || safeId) : safeId,
    sessions: kept,
  };
  writeJsonAtomic(path.join(sessionsDir, 'index.json'), nextIndex, false);

  return { ok: true, summary };
}

export function listSavedSessionsFromDisk(opts?: { appDataDir?: string }): SessionIndexFile {
  const sessionsDir = getSessionsDir(opts?.appDataDir);
  return readSessionIndex(sessionsDir);
}

export function loadSavedSessionFromDisk(
  idOrLatest: string,
  opts?: { appDataDir?: string }
): any | null {
  const sessionsDir = getSessionsDir(opts?.appDataDir);
  const idx = readSessionIndex(sessionsDir);

  let targetId = idOrLatest;
  if (!targetId || targetId === 'latest') {
    targetId = idx.activeSessionId || idx.sessions[0]?.id || '';
  }
  if (!targetId) return null;

  const safeId = sanitizeSessionId(targetId);
  const filePath = path.join(sessionsDir, `${safeId}.aitutor.json`);
  if (!fs.existsSync(filePath)) {
    // Fallback to newest available session if activeSessionId was stale
    for (const item of idx.sessions) {
      const candidatePath = path.join(sessionsDir, `${sanitizeSessionId(item.id)}.aitutor.json`);
      if (fs.existsSync(candidatePath)) {
        try {
          return JSON.parse(fs.readFileSync(candidatePath, 'utf-8'));
        } catch {
          // continue
        }
      }
    }
    return null;
  }

  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch {
    return null;
  }
}

export function deleteSavedSessionFromDisk(
  rawId: string,
  opts?: { appDataDir?: string }
): SessionIndexFile {
  const sessionsDir = getSessionsDir(opts?.appDataDir);
  const safeId = sanitizeSessionId(rawId);
  const filePath = path.join(sessionsDir, `${safeId}.aitutor.json`);
  if (fs.existsSync(filePath)) {
    try {
      fs.unlinkSync(filePath);
    } catch {
      // ignore
    }
  }

  const idx = readSessionIndex(sessionsDir);
  const remaining = idx.sessions.filter((s) => s.id !== safeId);
  const nextActive = idx.activeSessionId === safeId ? (remaining[0]?.id || null) : idx.activeSessionId;
  const nextIndex: SessionIndexFile = {
    activeSessionId: nextActive,
    sessions: remaining,
  };
  writeJsonAtomic(path.join(sessionsDir, 'index.json'), nextIndex, false);
  return nextIndex;
}

// ─── Binary Slide Media Vault (Images & Videos on Disk) ──────────────────────

const MIME_TO_EXT: Record<string, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg',
  'image/webp': '.webp',
  'image/gif': '.gif',
  'image/svg+xml': '.svg',
  'image/bmp': '.bmp',
  'video/mp4': '.mp4',
  'video/webm': '.webm',
  'video/quicktime': '.mov',
  'video/ogg': '.ogv',
  'video/x-matroska': '.mkv',
  'video/x-msvideo': '.avi',
};

const EXT_TO_MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.bmp': 'image/bmp',
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.ogv': 'video/ogg',
  '.ogg': 'video/ogg',
  '.mkv': 'video/x-matroska',
  '.avi': 'video/x-msvideo',
};

export function getMediaDir(customAppDataDir?: string): string {
  const dir = path.join(getZyrenAppDataDir(customAppDataDir), 'media');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function sanitizeMediaId(rawId: string): string {
  const cleaned = String(rawId || '')
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .slice(0, 96);
  return cleaned || `media_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function resolveSafeExtension(mimeType: string, originalName?: string): string {
  const cleanMime = String(mimeType || '').split(';')[0].trim().toLowerCase();
  if (MIME_TO_EXT[cleanMime]) {
    return MIME_TO_EXT[cleanMime];
  }
  const rawExt = path.extname(String(originalName || '')).toLowerCase();
  if (rawExt && EXT_TO_MIME[rawExt]) {
    return rawExt === '.jpeg' ? '.jpg' : rawExt;
  }
  if (cleanMime.startsWith('video/')) return '.mp4';
  return '.png';
}

export function saveMediaBinaryToDisk(params: {
  buffer: Buffer;
  mimeType: string;
  originalName?: string;
  mediaId?: string;
  appDataDir?: string;
}): MediaMetaRecord & { url: string; filePath: string } {
  if (!params.buffer || params.buffer.length === 0) {
    throw new Error('Cannot store empty media buffer.');
  }
  const mediaDir = getMediaDir(params.appDataDir);
  const safeId = sanitizeMediaId(
    params.mediaId || `media_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
  );
  const ext = resolveSafeExtension(params.mimeType, params.originalName);
  const resolvedMime =
    String(params.mimeType || '').split(';')[0].trim().toLowerCase() ||
    EXT_TO_MIME[ext] ||
    'application/octet-stream';
  const storedFileName = `${safeId}${ext}`;
  const filePath = path.join(mediaDir, storedFileName);
  const tmpPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;

  let fd: number | null = null;
  try {
    fd = fs.openSync(tmpPath, 'w');
    fs.writeFileSync(fd, params.buffer);
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = null;
    fs.renameSync(tmpPath, filePath);
  } finally {
    if (fd !== null) {
      try {
        fs.closeSync(fd);
      } catch {
        // ignore
      }
    }
    if (fs.existsSync(tmpPath)) {
      try {
        fs.unlinkSync(tmpPath);
      } catch {
        // ignore
      }
    }
  }

  const meta: MediaMetaRecord = {
    mediaId: safeId,
    fileName: String(params.originalName || storedFileName).trim() || storedFileName,
    mimeType: resolvedMime,
    sizeBytes: params.buffer.length,
    ext,
    storedFileName,
    createdAt: Date.now(),
  };

  writeJsonAtomic(path.join(mediaDir, `${safeId}.meta.json`), meta, false);

  return {
    ...meta,
    url: `/api/media/${storedFileName}`,
    filePath,
  };
}

export function resolveMediaFileOnDisk(
  rawToken: string,
  opts?: { appDataDir?: string }
): { filePath: string; mimeType: string; sizeBytes: number; fileName: string; mediaId: string } | null {
  const token = decodeURIComponent(String(rawToken || '').trim()).replace(/^\/api\/media\//, '');
  if (!token || token.includes('..') || token.includes('/') || token.includes('\\')) {
    return null;
  }

  const mediaDir = getMediaDir(opts?.appDataDir);
  const ext = path.extname(token).toLowerCase();
  const baseId = sanitizeMediaId(ext ? token.slice(0, -ext.length) : token);
  const metaPath = path.join(mediaDir, `${baseId}.meta.json`);

  if (fs.existsSync(metaPath)) {
    try {
      const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8')) as MediaMetaRecord;
      const candidatePath = path.join(mediaDir, path.basename(meta.storedFileName));
      if (path.dirname(candidatePath) === mediaDir && fs.existsSync(candidatePath)) {
        const stat = fs.statSync(candidatePath);
        return {
          filePath: candidatePath,
          mimeType: meta.mimeType || EXT_TO_MIME[path.extname(candidatePath).toLowerCase()] || 'application/octet-stream',
          sizeBytes: stat.size,
          fileName: meta.fileName || meta.storedFileName,
          mediaId: meta.mediaId || baseId,
        };
      }
    } catch {
      // fallback below
    }
  }

  const directPath = path.join(mediaDir, path.basename(token));
  if (path.dirname(directPath) === mediaDir && fs.existsSync(directPath) && fs.statSync(directPath).isFile()) {
    const stat = fs.statSync(directPath);
    const dExt = path.extname(directPath).toLowerCase();
    return {
      filePath: directPath,
      mimeType: EXT_TO_MIME[dExt] || 'application/octet-stream',
      sizeBytes: stat.size,
      fileName: path.basename(directPath),
      mediaId: baseId,
    };
  }

  return null;
}

export function toggleSessionPinOnDisk(
  sessionId: string,
  isPinned?: boolean,
  opts?: { appDataDir?: string }
): { ok: boolean; id: string; isPinned: boolean; summary?: SessionSummaryItem } {
  const sessionsDir = getSessionsDir(opts?.appDataDir);
  const safeId = sanitizeSessionId(sessionId);
  const currentIndex = readSessionIndex(sessionsDir);
  const target = currentIndex.sessions.find((s) => s.id === safeId);

  if (!target) {
    return { ok: false, id: safeId, isPinned: false };
  }

  const nextPinned = isPinned !== undefined ? Boolean(isPinned) : !target.isPinned;
  target.isPinned = nextPinned;

  const sessionFilePath = path.join(sessionsDir, `${safeId}.aitutor.json`);
  if (fs.existsSync(sessionFilePath)) {
    try {
      const data = JSON.parse(fs.readFileSync(sessionFilePath, 'utf-8'));
      data.isPinned = nextPinned;
      writeJsonAtomic(sessionFilePath, data, false);
    } catch {
      // ignore
    }
  }

  currentIndex.sessions.sort((a, b) => {
    const aPin = Boolean(a.isPinned);
    const bPin = Boolean(b.isPinned);
    if (bPin !== aPin) return bPin ? 1 : -1;
    return b.updatedAt - a.updatedAt;
  });

  writeJsonAtomic(path.join(sessionsDir, 'index.json'), currentIndex, false);
  return { ok: true, id: safeId, isPinned: nextPinned, summary: target };
}

// ─── Multi-Provider & Intermediate Executive Model Vault ───────────────────

import {
  ALL_PROVIDERS,
  type IntermediateModelSettings,
  type ProviderDefinition,
  type ProviderStatusSummary,
  type StoredProviderConfig,
  type TestProviderResult,
  type ThinkingLevel,
} from '../types/providers.ts';

export { ALL_PROVIDERS };
export type {
  IntermediateModelSettings,
  ProviderDefinition,
  ProviderStatusSummary,
  StoredProviderConfig,
  TestProviderResult,
  ThinkingLevel,
};

function resolveModelEndpoint(def: ProviderDefinition, baseUrl: string, apiKey: string): string {
  let cleanBase = (baseUrl || def.defaultBaseUrl || '').replace(/\/+$/, '');
  if (def.id === 'gemini') {
    if (cleanBase.includes('googleapis.com')) {
      return `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}&pageSize=50`;
    }
  }
  if (def.id === 'ollama' && !cleanBase.endsWith('/v1')) {
    return `${cleanBase}/api/tags`;
  }
  if (cleanBase.endsWith('/models')) {
    return cleanBase;
  }
  return `${cleanBase}/models`;
}

function extractModelsFromPayload(payload: any): Array<{ id: string; name?: string; description?: string }> {
  if (!payload) return [];
  const list: Array<{ id: string; name?: string; description?: string }> = [];

  if (Array.isArray(payload.data)) {
    for (const item of payload.data) {
      const id = typeof item === 'string' ? item : item?.id;
      if (id && typeof id === 'string') {
        list.push({
          id: id.trim(),
          name: typeof item?.name === 'string' ? item.name.trim() : id.trim(),
          description: typeof item?.description === 'string' ? item.description : undefined,
        });
      }
    }
    return list;
  }

  if (Array.isArray(payload.models)) {
    for (const item of payload.models) {
      if (typeof item === 'string') {
        list.push({ id: item, name: item });
      } else if (item && typeof item.name === 'string') {
        const cleanId = item.name.replace(/^models\//, '');
        list.push({
          id: cleanId,
          name: item.displayName || cleanId,
          description: item.description,
        });
      } else if (item && typeof item.id === 'string') {
        list.push({ id: item.id, name: item.name || item.id });
      }
    }
    return list;
  }

  if (Array.isArray(payload)) {
    for (const item of payload) {
      const id = typeof item === 'string' ? item : item?.id || item?.name;
      if (id && typeof id === 'string') {
        list.push({ id: id.trim(), name: id.trim() });
      }
    }
    return list;
  }

  return list;
}

export function listAllProviderStatuses(opts?: {
  appDataDir?: string;
  envVars?: Record<string, string | undefined>;
}): ProviderStatusSummary[] {
  const cfg = readAppConfig(opts?.appDataDir);
  const providersMap = (cfg.providers || {}) as Record<string, StoredProviderConfig>;
  const envMap = opts?.envVars || process.env;

  return ALL_PROVIDERS.map((def) => {
    const stored = providersMap[def.id] || {};
    const envKey = def.envKeyName ? (envMap[def.envKeyName] || '').trim() : '';
    const effectiveKey = (stored.apiKey || '').trim() || envKey;
    const isConfigured = def.isLocal ? true : effectiveKey.length > 3;
    const baseUrl = (stored.baseUrl || '').trim() || def.defaultBaseUrl || '';
    const selectedModel = (stored.selectedModel || '').trim() || def.defaultModel || '';
    const cachedModels = Array.isArray(stored.cachedModels) ? stored.cachedModels : [];
    const thinkingLevel = stored.thinkingLevel || 'high';

    return {
      id: def.id,
      name: def.name,
      configured: isConfigured,
      maskedKey: effectiveKey ? maskApiKey(effectiveKey) : null,
      baseUrl,
      selectedModel,
      cachedModelsCount: cachedModels.length,
      cachedModels,
      thinkingLevel,
      isLocal: Boolean(def.isLocal),
      updatedAt: stored.updatedAt,
      verifiedAt: stored.verifiedAt,
    };
  });
}

export function getProviderConfig(
  providerId: string,
  opts?: { appDataDir?: string; envVars?: Record<string, string | undefined> }
): StoredProviderConfig & { effectiveApiKey: string; effectiveBaseUrl: string } {
  const def = ALL_PROVIDERS.find((p) => p.id === providerId);
  const cfg = readAppConfig(opts?.appDataDir);
  const stored = ((cfg.providers || {})[providerId] || {}) as StoredProviderConfig;
  const envMap = opts?.envVars || process.env;
  const envKey = def?.envKeyName ? (envMap[def.envKeyName] || '').trim() : '';
  const effectiveApiKey = (stored.apiKey || '').trim() || envKey;
  const effectiveBaseUrl = (stored.baseUrl || '').trim() || def?.defaultBaseUrl || '';

  return {
    ...stored,
    id: providerId,
    effectiveApiKey,
    effectiveBaseUrl,
  };
}

export async function testProviderConnection(
  providerId: string,
  customKey?: string,
  customBaseUrl?: string,
  fetchImpl: typeof fetch = fetch
): Promise<TestProviderResult> {
  const def = ALL_PROVIDERS.find((p) => p.id === providerId);
  if (!def) {
    return { valid: false, latencyMs: 0, error: `Unknown provider: ${providerId}` };
  }

  const start = performance.now();
  const rawKey = (customKey !== undefined ? customKey : '').trim();
  const rawBaseUrl = (customBaseUrl !== undefined ? customBaseUrl : def.defaultBaseUrl || '').trim();

  if (!def.isLocal && !rawKey) {
    return { valid: false, latencyMs: 0, error: 'Please enter an API key for this provider.' };
  }

  const endpoint = resolveModelEndpoint(def, rawBaseUrl, rawKey);
  const headers: Record<string, string> = {
    Accept: 'application/json',
  };

  if (rawKey) {
    if (def.authHeaderType === 'api-key') {
      headers['api-key'] = rawKey;
    } else {
      headers['Authorization'] = `Bearer ${rawKey}`;
    }
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);
    let res: Response;
    try {
      res = await fetchImpl(endpoint, {
        method: 'GET',
        headers,
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }

    const latencyMs = Math.max(1, Math.round(performance.now() - start));
    let data: any = null;
    try {
      data = await res.json();
    } catch {
      data = null;
    }

    if (res.ok) {
      const models = extractModelsFromPayload(data);
      return {
        valid: true,
        latencyMs,
        modelCount: models.length,
        statusCode: res.status,
        message: `Verified & active (${latencyMs}ms). Found ${models.length} live models.`,
      };
    }

    const errMessage = data?.error?.message || data?.message || `HTTP ${res.status}: ${res.statusText}`;
    return {
      valid: false,
      latencyMs,
      statusCode: res.status,
      errorCode: `HTTP_${res.status}`,
      error: errMessage,
    };
  } catch (err: any) {
    const latencyMs = Math.max(1, Math.round(performance.now() - start));
    const isTimeout = err?.name === 'AbortError';
    return {
      valid: false,
      latencyMs,
      errorCode: isTimeout ? 'TIMEOUT' : 'NETWORK_ERROR',
      error: isTimeout
        ? 'Connection timed out (12s). Verify URL and network connectivity.'
        : `Network error: ${err?.message || 'Failed to reach provider endpoint'}`,
    };
  }
}

export async function fetchProviderModelsLive(
  providerId: string,
  customKey?: string,
  customBaseUrl?: string,
  opts?: { appDataDir?: string; fetchImpl?: typeof fetch }
): Promise<{ ok: boolean; models: Array<{ id: string; name?: string }>; error?: string; latencyMs?: number }> {
  const def = ALL_PROVIDERS.find((p) => p.id === providerId);
  if (!def) {
    return { ok: false, models: [], error: `Unknown provider: ${providerId}` };
  }

  const currentStored = getProviderConfig(providerId, { appDataDir: opts?.appDataDir });
  const rawKey = (customKey !== undefined ? customKey : currentStored.effectiveApiKey || '').trim();
  const rawBaseUrl = (customBaseUrl !== undefined ? customBaseUrl : currentStored.effectiveBaseUrl || def.defaultBaseUrl || '').trim();

  if (!def.isLocal && !rawKey) {
    return { ok: false, models: [], error: 'API key is required to refresh models.' };
  }

  const start = performance.now();
  const endpoint = resolveModelEndpoint(def, rawBaseUrl, rawKey);
  const headers: Record<string, string> = {
    Accept: 'application/json',
  };

  if (rawKey) {
    if (def.authHeaderType === 'api-key') {
      headers['api-key'] = rawKey;
    } else {
      headers['Authorization'] = `Bearer ${rawKey}`;
    }
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    let res: Response;
    try {
      res = await (opts?.fetchImpl || fetch)(endpoint, {
        method: 'GET',
        headers,
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }

    const latencyMs = Math.max(1, Math.round(performance.now() - start));
    let data: any = null;
    try {
      data = await res.json();
    } catch {
      data = null;
    }

    if (!res.ok) {
      const errMessage = data?.error?.message || data?.message || `HTTP ${res.status}: ${res.statusText}`;
      return { ok: false, models: [], error: errMessage, latencyMs };
    }

    const models = extractModelsFromPayload(data);
    models.sort((a, b) => a.id.localeCompare(b.id));

    // Persist refreshed models to config.json cache
    const cfgPath = path.join(getZyrenAppDataDir(opts?.appDataDir), 'config.json');
    const cfg = readAppConfig(opts?.appDataDir);
    const now = Date.now();
    const prevProviders = cfg.providers || {};
    const existing = prevProviders[providerId] || { id: providerId, configured: true };

    prevProviders[providerId] = {
      ...existing,
      id: providerId,
      apiKey: rawKey || existing.apiKey,
      baseUrl: rawBaseUrl,
      configured: def.isLocal ? true : Boolean(rawKey),
      cachedModels: models,
      updatedAt: now,
      verifiedAt: now,
    };

    cfg.providers = prevProviders;
    writeJsonAtomic(cfgPath, cfg, true);

    return { ok: true, models, latencyMs };
  } catch (err: any) {
    const latencyMs = Math.max(1, Math.round(performance.now() - start));
    return {
      ok: false,
      models: [],
      latencyMs,
      error: err?.message || 'Failed to fetch models from provider.',
    };
  }
}

export function saveProviderConfig(
  providerId: string,
  payload: {
    apiKey?: string;
    baseUrl?: string;
    selectedModel?: string;
    thinkingLevel?: ThinkingLevel;
    cachedModels?: Array<{ id: string; name?: string }>;
  },
  opts?: { appDataDir?: string }
): { ok: boolean; provider: ProviderStatusSummary } {
  const def = ALL_PROVIDERS.find((p) => p.id === providerId);
  if (!def) {
    throw new Error(`Unknown provider: ${providerId}`);
  }

  const cfgPath = path.join(getZyrenAppDataDir(opts?.appDataDir), 'config.json');
  const cfg = readAppConfig(opts?.appDataDir);
  const now = Date.now();
  const prevProviders = cfg.providers || {};
  const existing = prevProviders[providerId] || { id: providerId, configured: false };

  const cleanKey = payload.apiKey !== undefined ? payload.apiKey.trim() : existing.apiKey;
  const cleanBaseUrl = payload.baseUrl !== undefined ? payload.baseUrl.trim() : existing.baseUrl;
  const cleanSelectedModel = payload.selectedModel !== undefined ? payload.selectedModel.trim() : existing.selectedModel;
  const cleanThinking = payload.thinkingLevel || existing.thinkingLevel || 'high';
  const cleanCached = Array.isArray(payload.cachedModels) ? payload.cachedModels : existing.cachedModels;

  const nextConfig: StoredProviderConfig = {
    id: providerId,
    apiKey: cleanKey,
    baseUrl: cleanBaseUrl,
    configured: def.isLocal ? true : Boolean(cleanKey && cleanKey.length > 3),
    selectedModel: cleanSelectedModel,
    thinkingLevel: cleanThinking,
    cachedModels: cleanCached,
    updatedAt: now,
    verifiedAt: existing.verifiedAt || now,
  };

  prevProviders[providerId] = nextConfig;
  cfg.providers = prevProviders;
  writeJsonAtomic(cfgPath, cfg, true);

  const effectiveKey = nextConfig.apiKey || '';
  return {
    ok: true,
    provider: {
      id: providerId,
      name: def.name,
      configured: nextConfig.configured,
      maskedKey: effectiveKey ? maskApiKey(effectiveKey) : null,
      baseUrl: nextConfig.baseUrl || def.defaultBaseUrl || '',
      selectedModel: nextConfig.selectedModel || def.defaultModel || '',
      cachedModelsCount: (nextConfig.cachedModels || []).length,
      cachedModels: nextConfig.cachedModels || [],
      thinkingLevel: nextConfig.thinkingLevel || 'high',
      isLocal: Boolean(def.isLocal),
      updatedAt: nextConfig.updatedAt,
      verifiedAt: nextConfig.verifiedAt,
    },
  };
}

export function deleteProviderKey(
  providerId: string,
  opts?: { appDataDir?: string }
): { ok: boolean; providerId: string } {
  const cfgPath = path.join(getZyrenAppDataDir(opts?.appDataDir), 'config.json');
  const cfg = readAppConfig(opts?.appDataDir);
  if (cfg.providers && cfg.providers[providerId]) {
    cfg.providers[providerId].apiKey = '';
    cfg.providers[providerId].configured = false;
    cfg.providers[providerId].updatedAt = Date.now();
    writeJsonAtomic(cfgPath, cfg, true);
  }
  return { ok: true, providerId };
}

export function getIntermediateModelSettings(opts?: { appDataDir?: string }): IntermediateModelSettings {
  const cfg = readAppConfig(opts?.appDataDir);
  const stored = cfg.intermediateModel;
  return {
    enabled: Boolean(stored?.enabled),
    providerId: stored?.providerId || 'nvidia_nim',
    modelId: stored?.modelId || 'nvidia/nemotron-4-340b-instruct',
    thinkingLevel: stored?.thinkingLevel || 'high',
    customBaseUrl: stored?.customBaseUrl || '',
    updatedAt: stored?.updatedAt,
  };
}

export function saveIntermediateModelSettings(
  settings: Partial<IntermediateModelSettings>,
  opts?: { appDataDir?: string }
): IntermediateModelSettings {
  const cfgPath = path.join(getZyrenAppDataDir(opts?.appDataDir), 'config.json');
  const cfg = readAppConfig(opts?.appDataDir);
  const current = getIntermediateModelSettings(opts);
  const now = Date.now();

  const nextSettings: IntermediateModelSettings = {
    enabled: settings.enabled !== undefined ? Boolean(settings.enabled) : current.enabled,
    providerId: (settings.providerId || current.providerId || 'nvidia_nim').trim(),
    modelId: (settings.modelId || current.modelId || 'nvidia/nemotron-4-340b-instruct').trim(),
    thinkingLevel: settings.thinkingLevel || current.thinkingLevel || 'high',
    customBaseUrl: settings.customBaseUrl !== undefined ? settings.customBaseUrl.trim() : current.customBaseUrl,
    updatedAt: now,
  };

  cfg.intermediateModel = nextSettings;
  writeJsonAtomic(cfgPath, cfg, true);
  return nextSettings;
}
