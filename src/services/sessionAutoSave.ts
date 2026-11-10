import type { WhiteboardPage } from '../components/SlidePanel';
import type { ChatMessage } from '../components/ChatDrawer';

export interface SavedTutorSession {
  version: '2.0';
  appName: 'AI_Tutor_Whiteboard';
  id: string;
  title: string;
  isAutoTitled?: boolean;
  isPinned?: boolean;
  createdAt: number;
  updatedAt: number;
  activePageIndex: number;
  pages: WhiteboardPage[];
  chatMessages: ChatMessage[];
}

export interface SavedSessionSummary {
  id: string;
  title: string;
  isAutoTitled?: boolean;
  isPinned?: boolean;
  createdAt: number;
  updatedAt: number;
  slideCount: number;
  messageCount: number;
}

const IDB_NAME = 'zyren_tutor_vault_v1';
const IDB_VERSION = 1;
const STORE_SESSIONS = 'sessions';
const STORE_META = 'meta';

export function createSessionId(): string {
  return `session_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export function hasSubstantiveSessionContent(
  pages: WhiteboardPage[],
  chatMessages: ChatMessage[]
): boolean {
  if (Array.isArray(chatMessages) && chatMessages.length > 0) return true;
  if (!Array.isArray(pages) || pages.length === 0) return false;
  if (pages.length > 1) return true;
  const first = pages[0];
  if (!first) return false;
  return (
    (Array.isArray(first.shapes) && first.shapes.length > 0) ||
    (Array.isArray(first.handwriting) && first.handwriting.length > 0) ||
    (Array.isArray(first.userPaths) && first.userPaths.length > 0) ||
    (Array.isArray(first.userTexts) && first.userTexts.length > 0)
  );
}

export function deriveSmartSessionTitle(
  currentTitle: string,
  isAutoTitled: boolean,
  pages: WhiteboardPage[],
  chatMessages: ChatMessage[]
): { title: string; isAutoTitled: boolean } {
  const trimmed = (currentTitle || '').trim();
  const isDefault = !trimmed || trimmed === 'Untitled Whiteboard' || trimmed === 'Untitled Session';

  // If user manually customized the title, keep it strictly
  if (!isDefault && !isAutoTitled) {
    return { title: trimmed, isAutoTitled: false };
  }

  // If an established substantive auto-title already exists (e.g. from an embedded video, initial topic, or user prompt),
  // PRESERVE IT! Never let a secondary tutor drawing in a corner overwrite an already established lesson title!
  if (!isDefault && trimmed && !/^(Whiteboard\s+)?Slide\s+\d+$/i.test(trimmed)) {
    return { title: trimmed, isAutoTitled: true };
  }

  // 1. Prefer Slide 1 primary video / media title or diagram root
  const firstSlide = pages?.[0];
  if (firstSlide) {
    // Media (YouTube video / uploaded image) is the absolute highest priority topic anchor
    const firstMedia = (firstSlide.shapes || []).find(
      (s) => s.shapeType === 'image' || s.shapeType === 'video'
    );
    if (firstMedia?.options?.media?.fileName) {
      return {
        title: firstMedia.options.media.fileName.replace(/\.[^.]+$/, '').slice(0, 48),
        isAutoTitled: true,
      };
    }

    // Diagram title if present
    const firstDiagram = (firstSlide.shapes || []).find(
      (s) => s.shapeType === 'diagram' || (s.shapeType === 'rectangle' && (s.y ?? 0) <= 160 && s.options?.label)
    );
    if (firstDiagram?.options?.label) {
      return {
        title: firstDiagram.options.label.slice(0, 48),
        isAutoTitled: true,
      };
    }

    const headerHw = (firstSlide.handwriting || []).find(
      (h) => h.style === 'title' || (h.position && h.position.y <= 150)
    );
    if (headerHw?.text?.trim()) {
      return {
        title: headerHw.text.trim().slice(0, 48),
        isAutoTitled: true,
      };
    }
    if (firstSlide.title && !/^(Whiteboard\s+)?Slide\s+\d+$/i.test(firstSlide.title.trim())) {
      return {
        title: firstSlide.title.trim().slice(0, 48),
        isAutoTitled: true,
      };
    }
  }

  // 2. Otherwise use first student prompt/message
  const firstUserMsg = (chatMessages || []).find((m) => m.role === 'user' && m.text?.trim());
  if (firstUserMsg?.text) {
    const cleanMsg = firstUserMsg.text.trim().replace(/\s+/g, ' ');
    return {
      title: cleanMsg.length > 44 ? `${cleanMsg.slice(0, 44)}…` : cleanMsg,
      isAutoTitled: true,
    };
  }

  return {
    title: trimmed || 'Untitled Whiteboard',
    isAutoTitled: true,
  };
}

// ─── Browser IndexedDB Mirror Tier ──────────────────────────────────────────

function openVaultDB(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') {
    return Promise.resolve(null);
  }
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open(IDB_NAME, IDB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE_SESSIONS)) {
          const store = db.createObjectStore(STORE_SESSIONS, { keyPath: 'id' });
          store.createIndex('updatedAt', 'updatedAt', { unique: false });
        }
        if (!db.objectStoreNames.contains(STORE_META)) {
          db.createObjectStore(STORE_META, { keyPath: 'key' });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

export async function saveSessionToIDB(
  session: SavedTutorSession,
  setActive = true
): Promise<boolean> {
  const db = await openVaultDB();
  if (!db) return false;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction([STORE_SESSIONS, STORE_META], 'readwrite');
      tx.objectStore(STORE_SESSIONS).put(session);
      if (setActive) {
        tx.objectStore(STORE_META).put({ key: 'activeSessionId', value: session.id, updatedAt: session.updatedAt });
      }
      tx.oncomplete = () => {
        db.close();
        resolve(true);
      };
      tx.onerror = () => {
        db.close();
        resolve(false);
      };
    } catch {
      db.close();
      resolve(false);
    }
  });
}

export async function loadSessionFromIDB(idOrLatest: string): Promise<SavedTutorSession | null> {
  const db = await openVaultDB();
  if (!db) return null;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction([STORE_SESSIONS, STORE_META], 'readonly');
      const sessionsStore = tx.objectStore(STORE_SESSIONS);

      const finish = (val: SavedTutorSession | null) => {
        db.close();
        resolve(val);
      };

      if (idOrLatest && idOrLatest !== 'latest') {
        const getReq = sessionsStore.get(idOrLatest);
        getReq.onsuccess = () => finish((getReq.result as SavedTutorSession) || null);
        getReq.onerror = () => finish(null);
        return;
      }

      const metaReq = tx.objectStore(STORE_META).get('activeSessionId');
      metaReq.onsuccess = () => {
        const activeId = metaReq.result?.value;
        if (activeId) {
          const byId = sessionsStore.get(activeId);
          byId.onsuccess = () => {
            if (byId.result) {
              finish(byId.result as SavedTutorSession);
            } else {
              const allReq = sessionsStore.getAll();
              allReq.onsuccess = () => {
                const list = ((allReq.result as SavedTutorSession[]) || []).sort(
                  (a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)
                );
                finish(list[0] || null);
              };
              allReq.onerror = () => finish(null);
            }
          };
          byId.onerror = () => finish(null);
        } else {
          const allReq = sessionsStore.getAll();
          allReq.onsuccess = () => {
            const list = ((allReq.result as SavedTutorSession[]) || []).sort(
              (a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)
            );
            finish(list[0] || null);
          };
          allReq.onerror = () => finish(null);
        }
      };
      metaReq.onerror = () => finish(null);
    } catch {
      db.close();
      resolve(null);
    }
  });
}

export async function listSessionsFromIDB(): Promise<SavedSessionSummary[]> {
  const db = await openVaultDB();
  if (!db) return [];
  return new Promise((resolve) => {
    try {
      const tx = db.transaction([STORE_SESSIONS], 'readonly');
      const req = tx.objectStore(STORE_SESSIONS).getAll();
      req.onsuccess = () => {
        db.close();
        const items = ((req.result as SavedTutorSession[]) || [])
          .map((s) => ({
            id: s.id,
            title: s.title || 'Untitled Whiteboard',
            isAutoTitled: s.isAutoTitled,
            isPinned: Boolean(s.isPinned),
            createdAt: s.createdAt || s.updatedAt || Date.now(),
            updatedAt: s.updatedAt || Date.now(),
            slideCount: Array.isArray(s.pages) ? s.pages.length : 1,
            messageCount: Array.isArray(s.chatMessages) ? s.chatMessages.length : 0,
          }))
          .sort((a, b) => {
            const aPin = Boolean(a.isPinned);
            const bPin = Boolean(b.isPinned);
            if (bPin !== aPin) return bPin ? 1 : -1;
            return b.updatedAt - a.updatedAt;
          });
        resolve(items);
      };
      req.onerror = () => {
        db.close();
        resolve([]);
      };
    } catch {
      db.close();
      resolve([]);
    }
  });
}

export async function deleteSessionFromIDB(id: string): Promise<void> {
  const db = await openVaultDB();
  if (!db) return;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction([STORE_SESSIONS], 'readwrite');
      tx.objectStore(STORE_SESSIONS).delete(id);
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => {
        db.close();
        resolve();
      };
    } catch {
      db.close();
      resolve();
    }
  });
}

// ─── Unified Dual-Tier Persistence (OS AppData Disk + IndexedDB + Beacon) ───

export async function persistSessionDualTier(
  session: SavedTutorSession,
  opts?: { setActive?: boolean }
): Promise<SavedSessionSummary> {
  const setActive = opts?.setActive !== false;

  // 1. Instant local IndexedDB mirror
  await saveSessionToIDB(session, setActive);

  // 2. Primary OS AppData Disk Vault via local Vite server
  try {
    const res = await fetch('/api/sessions/autosave', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...session, setActive }),
    });
    if (res.ok) {
      const data = await res.json();
      if (data?.summary) {
        return data.summary as SavedSessionSummary;
      }
    }
  } catch {
    // Offline/standalone fallback remains safe in IndexedDB
  }

  return {
    id: session.id,
    title: session.title,
    isAutoTitled: session.isAutoTitled,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    slideCount: session.pages.length,
    messageCount: session.chatMessages.length,
  };
}

export function flushSessionEmergencyOnExit(session: SavedTutorSession): void {
  // 1. Trigger non-blocking IndexedDB write
  void saveSessionToIDB(session, true);

  // 2. Transmit to OS AppData Disk Vault via Page-Lifecycle-safe sendBeacon / keepalive fetch
  try {
    const json = JSON.stringify({ ...session, setActive: true });
    const byteLength = new TextEncoder().encode(json).byteLength;

    if (typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function' && byteLength <= 60 * 1024) {
      const blob = new Blob([json], { type: 'application/json' });
      const queued = navigator.sendBeacon('/api/sessions/autosave', blob);
      if (queued) return;
    }

    void fetch('/api/sessions/autosave', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: json,
      keepalive: byteLength <= 60 * 1024,
    }).catch(() => {});
  } catch {
    // ignore teardown errors
  }
}

export async function loadLatestAutoSavedSession(): Promise<SavedTutorSession | null> {
  let diskSession: SavedTutorSession | null = null;
  try {
    const res = await fetch('/api/sessions/latest');
    if (res.ok) {
      const data = await res.json();
      if (data?.session && Array.isArray(data.session.pages)) {
        diskSession = data.session as SavedTutorSession;
      }
    }
  } catch {
    // fallback to IDB
  }

  const idbSession = await loadSessionFromIDB('latest');

  if (diskSession && idbSession) {
    return (idbSession.updatedAt || 0) > (diskSession.updatedAt || 0) ? idbSession : diskSession;
  }
  return diskSession || idbSession || null;
}

export async function loadSpecificSavedSession(id: string): Promise<SavedTutorSession | null> {
  try {
    const res = await fetch(`/api/sessions/item?id=${encodeURIComponent(id)}`);
    if (res.ok) {
      const data = await res.json();
      if (data?.session && Array.isArray(data.session.pages)) {
        return data.session as SavedTutorSession;
      }
    }
  } catch {
    // fallback to IDB
  }
  return loadSessionFromIDB(id);
}

export async function listAllSavedSessions(): Promise<SavedSessionSummary[]> {
  const byId = new Map<string, SavedSessionSummary>();

  try {
    const res = await fetch('/api/sessions');
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data?.sessions)) {
        for (const s of data.sessions as SavedSessionSummary[]) {
          byId.set(s.id, s);
        }
      }
    }
  } catch {
    // ignore
  }

  const idbList = await listSessionsFromIDB();
  for (const s of idbList) {
    const existing = byId.get(s.id);
    if (!existing || s.updatedAt > existing.updatedAt) {
      byId.set(s.id, s);
    }
  }

  return Array.from(byId.values()).sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function deleteSavedSessionEverywhere(id: string): Promise<void> {
  await deleteSessionFromIDB(id);
  try {
    await fetch(`/api/sessions/item?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
  } catch {
    // ignore
  }
}

export async function toggleSessionPinDualTier(
  id: string,
  isPinned?: boolean
): Promise<{ ok: boolean; isPinned: boolean }> {
  let targetPinned = isPinned;

  // 1. Update IndexedDB mirror
  const db = await openVaultDB();
  if (db) {
    await new Promise<void>((resolve) => {
      try {
        const tx = db.transaction([STORE_SESSIONS], 'readwrite');
        const store = tx.objectStore(STORE_SESSIONS);
        const req = store.get(id);
        req.onsuccess = () => {
          const session = req.result as SavedTutorSession;
          if (session) {
            targetPinned = isPinned !== undefined ? isPinned : !session.isPinned;
            session.isPinned = targetPinned;
            store.put(session);
          }
        };
        tx.oncomplete = () => {
          db.close();
          resolve();
        };
        tx.onerror = () => {
          db.close();
          resolve();
        };
      } catch {
        db.close();
        resolve();
      }
    });
  }

  // 2. Update Disk AppData backend vault
  try {
    const res = await fetch('/api/sessions/pin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, isPinned: targetPinned }),
    });
    if (res.ok) {
      const data = await res.json();
      return { ok: true, isPinned: Boolean(data?.isPinned ?? targetPinned) };
    }
  } catch {
    // Fallback succeeds via IndexedDB
  }

  return { ok: true, isPinned: Boolean(targetPinned) };
}
