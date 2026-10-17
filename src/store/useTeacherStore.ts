/**
 * useTeacherStore — Zustand store for application state.
 *
 * Manages the reactive state that drives the UI:
 * - Connection status
 * - Whiteboard state
 * - Telemetry metrics (for debug overlay)
 * - Session configuration
 */
import { create } from 'zustand';
import type { WhiteboardState, SyncTelemetry } from '../types';

interface TeacherState {
  // Connection
  connectionState: 'disconnected' | 'connecting' | 'connected' | 'failed';
  setConnectionState: (state: TeacherState['connectionState']) => void;

  // Whiteboard
  whiteboardState: WhiteboardState;
  setWhiteboardState: (state: WhiteboardState) => void;

  // Telemetry
  telemetry: SyncTelemetry | null;
  setTelemetry: (t: SyncTelemetry) => void;

  // UI
  showDebugOverlay: boolean;
  toggleDebugOverlay: () => void;
  isDemoMode: boolean;
  setDemoMode: (mode: boolean) => void;

  // Session
  sessionStartTime: number | null;
  startSession: () => void;
  endSession: () => void;
}

export const useTeacherStore = create<TeacherState>((set) => ({
  // Connection
  connectionState: 'disconnected',
  setConnectionState: (connectionState) => set({ connectionState }),

  // Whiteboard
  whiteboardState: 'idle' as WhiteboardState,
  setWhiteboardState: (whiteboardState) => set({ whiteboardState }),

  // Telemetry
  telemetry: null,
  setTelemetry: (telemetry) => set({ telemetry }),

  // UI
  showDebugOverlay: false, // Hidden by default
  toggleDebugOverlay: () => set((s) => ({ showDebugOverlay: !s.showDebugOverlay })),
  isDemoMode: false, // Start in live AI mode
  setDemoMode: (isDemoMode) => set({ isDemoMode }),

  // Session
  sessionStartTime: null,
  startSession: () => set({ sessionStartTime: Date.now() }),
  endSession: () => set({ sessionStartTime: null }),
}));
