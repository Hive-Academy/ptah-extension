/**
 * useSessions -- Session lifecycle management hook.
 *
 * TASK_2025_263 Batch 4
 *
 * Provides session CRUD operations via RPC and real-time session stats
 * via push event subscriptions. Manages the active session and session list.
 *
 * Push event subscriptions:
 *   - session:stats      -- Token usage, model, and cost information
 *   - session:id-resolved -- Backend resolves temporary tab ID to real session UUID
 *
 * Usage:
 *   const { sessions, activeSessionId, stats, createSession, loadSession } = useSessions();
 */

import { useState, useCallback, useEffect } from 'react';

import { useCliContext } from '../context/CliContext.js';

export interface Session {
  id: string;
  name: string;
  model?: string;
  createdAt: string;
}

export interface SessionStats {
  sessionId: string;
  inputTokens: number;
  outputTokens: number;
  model?: string;
  costUSD: number;
  contextUsagePercent: number;
  contextWindow: number;
  contextUsed: number;
}

export interface UseSessionsResult {
  sessions: Session[];
  activeSessionId: string | null;
  stats: SessionStats | null;
  loading: boolean;
  loadSessions: () => Promise<void>;
  createSession: () => Promise<string | null>;
  loadSession: (id: string) => Promise<void>;
  deleteSession: (id: string) => Promise<void>;
}

/** Push event payload shape for session:stats from the backend. */
interface SessionStatsPayload {
  sessionId?: string;
  tokens?: {
    input?: number;
    output?: number;
  };
  cost?: number;
  modelUsage?: Array<{
    model?: string;
    contextWindow?: number;
    lastTurnContextTokens?: number;
    costUSD?: number;
  }>;
}

/** Push event payload shape for session:id-resolved from the backend. */
interface SessionIdResolvedPayload {
  tabId?: string;
  realSessionId?: string;
}

/** RPC response shape for session:list. */
interface SessionListItem {
  id: string;
  name?: string;
  model?: string;
  createdAt?: string;
  updatedAt?: string;
}

/** RPC response shape for session:create. */
interface SessionCreateResult {
  sessionId?: string;
  id?: string;
}

/**
 * Hook providing session lifecycle management via RPC and real-time stats via push events.
 */
export function useSessions(): UseSessionsResult {
  const { transport, pushAdapter } = useCliContext();

  const [sessions, setSessions] = useState<Session[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [stats, setStats] = useState<SessionStats | null>(null);
  const [loading, setLoading] = useState(false);

  /**
   * Fetch the full session list from the backend.
   */
  const loadSessions = useCallback(async (): Promise<void> => {
    setLoading(true);
    try {
      const response = await transport.call<
        Record<string, never>,
        SessionListItem[]
      >('session:list', {} as Record<string, never>);

      if (response.success && response.data) {
        const mapped: Session[] = response.data.map((item) => ({
          id: item.id,
          name: item.name ?? `Session ${item.id.slice(0, 8)}`,
          model: item.model,
          createdAt: item.createdAt ?? new Date().toISOString(),
        }));
        setSessions(mapped);
      }
    } catch {
      // Silently fail -- sessions will remain empty
    } finally {
      setLoading(false);
    }
  }, [transport]);

  /**
   * Create a new session and return the new session ID.
   * Auto-reloads the session list after creation.
   */
  const createSession = useCallback(async (): Promise<string | null> => {
    setLoading(true);
    try {
      const response = await transport.call<
        Record<string, never>,
        SessionCreateResult
      >('session:create', {} as Record<string, never>);

      if (!response.success || !response.data) {
        return null;
      }

      const newId = response.data.sessionId ?? response.data.id ?? null;

      if (newId) {
        setActiveSessionId(newId);
        // Reload the session list to include the new session
        await loadSessions();
      }

      return newId;
    } catch {
      return null;
    } finally {
      setLoading(false);
    }
  }, [transport, loadSessions]);

  /**
   * Load (switch to) an existing session by ID.
   */
  const loadSession = useCallback(
    async (id: string): Promise<void> => {
      setLoading(true);
      try {
        const response = await transport.call<{ sessionId: string }, unknown>(
          'session:load',
          { sessionId: id },
        );

        if (response.success) {
          setActiveSessionId(id);
        }
      } catch {
        // Failed to load session
      } finally {
        setLoading(false);
      }
    },
    [transport],
  );

  /**
   * Delete a session by ID. Reloads the session list after deletion.
   * Clears the active session if the deleted session was active.
   */
  const deleteSession = useCallback(
    async (id: string): Promise<void> => {
      setLoading(true);
      try {
        const response = await transport.call<{ sessionId: string }, unknown>(
          'session:delete',
          { sessionId: id },
        );

        if (response.success) {
          // Use functional updates to avoid stale closure over activeSessionId/stats
          // (WARNING-4 fix). The previous implementation captured activeSessionId
          // at callback creation time, which could be stale if the active session
          // changed between when the callback was created and when delete completed.
          setActiveSessionId((prev) => (prev === id ? null : prev));
          setStats((prev) => (prev && prev.sessionId === id ? null : prev));
          await loadSessions();
        }
      } catch {
        // Failed to delete session
      } finally {
        setLoading(false);
      }
    },
    [transport, loadSessions],
  );

  // Subscribe to session:stats push events
  useEffect(() => {
    const handleStats = (payload: unknown): void => {
      const data = payload as SessionStatsPayload;
      if (!data.sessionId) return;

      const model =
        data.modelUsage && data.modelUsage.length > 0
          ? data.modelUsage[0].model
          : undefined;

      const contextWindow = data.modelUsage?.[0]?.contextWindow ?? 0;
      const contextUsed = data.modelUsage?.[0]?.lastTurnContextTokens ?? 0;

      setStats({
        sessionId: data.sessionId,
        inputTokens: data.tokens?.input ?? 0,
        outputTokens: data.tokens?.output ?? 0,
        model,
        costUSD: data.cost ?? data.modelUsage?.[0]?.costUSD ?? 0,
        contextWindow,
        contextUsed,
        contextUsagePercent:
          contextWindow > 0
            ? Math.round((contextUsed / contextWindow) * 100)
            : 0,
      });
    };

    pushAdapter.on('session:stats', handleStats);
    return () => {
      pushAdapter.off('session:stats', handleStats);
    };
  }, [pushAdapter]);

  // Subscribe to session:id-resolved push events
  useEffect(() => {
    const handleIdResolved = (payload: unknown): void => {
      const data = payload as SessionIdResolvedPayload;
      if (data.realSessionId) {
        setActiveSessionId(data.realSessionId);
      }
    };

    pushAdapter.on('session:id-resolved', handleIdResolved);
    return () => {
      pushAdapter.off('session:id-resolved', handleIdResolved);
    };
  }, [pushAdapter]);

  // Load sessions on mount
  useEffect(() => {
    void loadSessions();
  }, [loadSessions]);

  return {
    sessions,
    activeSessionId,
    stats,
    loading,
    loadSessions,
    createSession,
    loadSession,
    deleteSession,
  };
}
