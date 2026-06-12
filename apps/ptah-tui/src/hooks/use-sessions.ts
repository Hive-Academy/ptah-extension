import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { EventEmitter } from 'node:events';
import { pickPrimaryModel, type ModelUsageEntry } from '@ptah-extension/shared';

export interface Session {
  readonly id: string;
  readonly name: string;
  readonly model?: string;
  readonly createdAt: string;
}

export interface SessionStats {
  readonly sessionId: string;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly model: string | null;
  readonly costUSD: number;
  readonly contextWindow: number;
  readonly contextUsed: number;
  readonly contextUsagePercent: number;
}

export interface SessionTransport {
  call<TParams = unknown, TResult = unknown>(
    method: string,
    params: TParams,
  ): Promise<{
    success: boolean;
    data?: TResult;
    error?: string;
    errorCode?: string;
  }>;
}

export type SessionPushAdapter = Pick<EventEmitter, 'on' | 'off' | 'emit'>;

interface StatsModelUsage {
  readonly model: string;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly contextWindow: number;
  readonly costUSD: number | null;
  readonly cacheReadInputTokens?: number;
  readonly lastTurnContextTokens?: number;
}

interface SessionStatsPayload {
  readonly sessionId?: string;
  readonly cost?: number | null;
  readonly tokens?: {
    readonly input?: number;
    readonly output?: number;
  };
  readonly modelUsage?: ReadonlyArray<StatsModelUsage>;
}

interface SessionIdResolvedPayload {
  readonly tabId?: string;
  readonly realSessionId?: string;
}

interface SessionListItem {
  readonly id?: string;
  readonly sessionId?: string;
  readonly name?: string;
  readonly title?: string;
  readonly model?: string;
  readonly createdAt?: string;
}

interface SessionListResponse {
  readonly sessions?: ReadonlyArray<SessionListItem>;
}

interface StatsBatchEntry {
  readonly totalCost: number | null;
  readonly tokens: {
    readonly input: number;
    readonly output: number;
  };
  readonly modelUsageList?: ReadonlyArray<{
    readonly model: string;
    readonly inputTokens: number;
    readonly outputTokens: number;
    readonly costUSD: number | null;
  }>;
  readonly status: 'ok' | 'error' | 'empty';
}

interface StatsBatchResponse {
  readonly sessionStats?: ReadonlyArray<StatsBatchEntry>;
}

function deriveStatsFromBatch(
  sessionId: string,
  entry: StatsBatchEntry,
): SessionStats | null {
  if (entry.status !== 'ok') return null;
  const usage = entry.modelUsageList ?? [];
  const model =
    usage.length > 0
      ? pickPrimaryModel(
          usage.map((u) => ({
            model: u.model,
            totalCost: u.costUSD ?? 0,
            tokens: {
              input: u.inputTokens,
              output: u.outputTokens,
              cacheRead: 0,
            },
          })),
        )
      : null;
  return {
    sessionId,
    inputTokens: entry.tokens.input,
    outputTokens: entry.tokens.output,
    model,
    costUSD: entry.totalCost ?? 0,
    contextWindow: 0,
    contextUsed: 0,
    contextUsagePercent: 0,
  };
}

function toModelUsageEntries(
  modelUsage: ReadonlyArray<StatsModelUsage>,
): ModelUsageEntry[] {
  return modelUsage.map((u) => ({
    model: u.model,
    totalCost: u.costUSD ?? 0,
    tokens: {
      input: u.inputTokens,
      output: u.outputTokens,
      cacheRead: u.cacheReadInputTokens ?? 0,
    },
  }));
}

function deriveStats(payload: SessionStatsPayload): SessionStats | null {
  if (!payload.sessionId) return null;
  const usage = payload.modelUsage ?? [];
  const model =
    usage.length > 0 ? pickPrimaryModel(toModelUsageEntries(usage)) : null;
  const primary = usage.find((u) => u.model === model) ?? usage[0] ?? undefined;
  const contextWindow = primary?.contextWindow ?? 0;
  const contextUsed = primary?.lastTurnContextTokens ?? 0;
  return {
    sessionId: payload.sessionId,
    inputTokens: payload.tokens?.input ?? 0,
    outputTokens: payload.tokens?.output ?? 0,
    model,
    costUSD: payload.cost ?? primary?.costUSD ?? 0,
    contextWindow,
    contextUsed,
    contextUsagePercent:
      contextWindow > 0 ? Math.round((contextUsed / contextWindow) * 100) : 0,
  };
}

/**
 * Framework-free session controller. Owns the session list, the active
 * session id, and the derived stats. `session:stats` now carries `modelUsage`
 * (TASK_2026_134) so the displayed model is chosen via `pickPrimaryModel`
 * rather than the old single-model assumption. `session:id-resolved`
 * `{ tabId, realSessionId }` promotes a synthetic tab id to its real SDK UUID.
 */
export class SessionController {
  private readonly transport: SessionTransport;
  private readonly pushAdapter: SessionPushAdapter;
  private readonly workspacePath: string;
  private readonly onChange: () => void;

  sessions: Session[] = [];
  activeSessionId: string | null = null;
  stats: SessionStats | null = null;
  loading = false;

  private readonly onStats: (payload: unknown) => void;
  private readonly onIdResolved: (payload: unknown) => void;

  constructor(
    transport: SessionTransport,
    pushAdapter: SessionPushAdapter,
    workspacePath: string,
    onChange: () => void,
  ) {
    this.transport = transport;
    this.pushAdapter = pushAdapter;
    this.workspacePath = workspacePath;
    this.onChange = onChange;

    this.onStats = (payload) => this.handleStats(payload);
    this.onIdResolved = (payload) => this.handleIdResolved(payload);

    this.pushAdapter.on('session:stats', this.onStats);
    this.pushAdapter.on('session:id-resolved', this.onIdResolved);
  }

  dispose(): void {
    this.pushAdapter.off('session:stats', this.onStats);
    this.pushAdapter.off('session:id-resolved', this.onIdResolved);
  }

  async loadSessions(): Promise<void> {
    this.loading = true;
    this.onChange();
    try {
      const response = await this.transport.call<
        { workspacePath: string },
        SessionListResponse
      >('session:list', { workspacePath: this.workspacePath });
      if (response.success && response.data?.sessions) {
        this.sessions = response.data.sessions.map((item) => {
          const id = item.id ?? item.sessionId ?? '';
          return {
            id,
            name: item.name ?? item.title ?? `Session ${id.slice(0, 8)}`,
            model: item.model,
            createdAt: item.createdAt ?? new Date().toISOString(),
          };
        });
      }
    } catch {
      // leave the existing list intact on failure
    } finally {
      this.loading = false;
      this.onChange();
    }
  }

  async loadSession(id: string): Promise<void> {
    this.loading = true;
    this.onChange();
    try {
      const response = await this.transport.call<
        { sessionId: string },
        unknown
      >('session:load', { sessionId: id });
      if (response.success) {
        this.activeSessionId = id;
        await this.seedStats(id);
      }
    } catch {
      // failed to load — keep current active session
    } finally {
      this.loading = false;
      this.onChange();
    }
  }

  private async seedStats(id: string): Promise<void> {
    try {
      const response = await this.transport.call<
        { sessionIds: string[]; workspacePath: string },
        StatsBatchResponse
      >('session:stats-batch', {
        sessionIds: [id],
        workspacePath: this.workspacePath,
      });
      const entry = response.success
        ? response.data?.sessionStats?.[0]
        : undefined;
      this.stats = entry ? deriveStatsFromBatch(id, entry) : null;
    } catch {
      this.stats = null;
    }
  }

  async deleteSession(id: string): Promise<void> {
    this.loading = true;
    this.onChange();
    try {
      const response = await this.transport.call<
        { sessionId: string },
        unknown
      >('session:delete', { sessionId: id });
      if (response.success) {
        if (this.activeSessionId === id) this.activeSessionId = null;
        if (this.stats && this.stats.sessionId === id) this.stats = null;
        await this.loadSessions();
      }
    } catch {
      // failed to delete
    } finally {
      this.loading = false;
      this.onChange();
    }
  }

  setActiveSession(id: string | null): void {
    this.activeSessionId = id;
    this.onChange();
  }

  private handleStats(payload: unknown): void {
    const next = deriveStats(payload as SessionStatsPayload);
    if (!next) return;
    this.stats = next;
    this.onChange();
  }

  private handleIdResolved(payload: unknown): void {
    const data = payload as SessionIdResolvedPayload;
    if (data.realSessionId && data.realSessionId.length > 0) {
      this.activeSessionId = data.realSessionId;
      this.onChange();
    }
  }
}

export interface UseSessionsResult {
  sessions: Session[];
  activeSessionId: string | null;
  stats: SessionStats | null;
  loading: boolean;
  loadSessions: () => Promise<void>;
  loadSession: (id: string) => Promise<void>;
  deleteSession: (id: string) => Promise<void>;
  setActiveSession: (id: string | null) => void;
}

export function useSessions(
  transport: SessionTransport,
  pushAdapter: SessionPushAdapter,
  workspacePath: string,
): UseSessionsResult {
  const [, setVersion] = useState(0);
  const controller = useMemo(
    () =>
      new SessionController(transport, pushAdapter, workspacePath, () =>
        setVersion((v) => v + 1),
      ),
    [transport, pushAdapter, workspacePath],
  );
  const mounted = useRef(false);

  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      void controller.loadSessions();
    }
    return () => controller.dispose();
  }, [controller]);

  const loadSessions = useCallback(
    () => controller.loadSessions(),
    [controller],
  );
  const loadSession = useCallback(
    (id: string) => controller.loadSession(id),
    [controller],
  );
  const deleteSession = useCallback(
    (id: string) => controller.deleteSession(id),
    [controller],
  );
  const setActiveSession = useCallback(
    (id: string | null) => controller.setActiveSession(id),
    [controller],
  );

  return {
    sessions: controller.sessions,
    activeSessionId: controller.activeSessionId,
    stats: controller.stats,
    loading: controller.loading,
    loadSessions,
    loadSession,
    deleteSession,
    setActiveSession,
  };
}
