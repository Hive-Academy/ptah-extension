import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { EventEmitter } from 'node:events';
import {
  pickPrimaryModel,
  type ModelUsageEntry,
  type ResultStatsPayload,
  type SessionStatsEntry,
} from '@ptah-extension/shared';

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
  /**
   * Session-lifetime cost in USD from the backend snapshot. `null` means
   * unknown and must be rendered as unavailable, never as $0.
   */
  readonly costUSD: number | null;
  /** True when `costUSD` is a lower bound (`knownCost` under partial pricing). */
  readonly costPartial: boolean;
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

/**
 * A `session:stats` push as it arrives over the wire. Every field is treated
 * as possibly absent because the payload crosses a process boundary untyped.
 */
type SessionStatsPush = Partial<ResultStatsPayload>;

type StatsModelUsage = NonNullable<ResultStatsPayload['modelUsage']>[number];

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

interface StatsBatchResponse {
  readonly sessionStats?: ReadonlyArray<SessionStatsEntry>;
}

type SessionCost = Pick<SessionStats, 'costUSD' | 'costPartial'>;

const UNKNOWN_COST: SessionCost = { costUSD: null, costPartial: false };

function isKnownCost(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

/**
 * The session cost a backend snapshot supports: the full total when pricing
 * is complete, otherwise the priced subtotal flagged as a lower bound,
 * otherwise unknown. A per-turn cost or a per-model row is never a session
 * total, so neither is consulted here.
 */
function sessionCostOf(
  entry: Pick<SessionStatsEntry, 'totalCost' | 'knownCost'>,
): SessionCost {
  if (isKnownCost(entry.totalCost)) {
    return { costUSD: entry.totalCost, costPartial: false };
  }
  if (isKnownCost(entry.knownCost)) {
    return { costUSD: entry.knownCost, costPartial: true };
  }
  return UNKNOWN_COST;
}

/**
 * The session cost to show for `sessionId`: the snapshot's, when the snapshot
 * is usable and belongs to that session; otherwise the value already shown for
 * the same session; otherwise unknown. A snapshot naming another session never
 * supplies the cost, so a malformed payload cannot show another session's money.
 */
function sessionCostFor(
  sessionId: string,
  snapshot: SessionStatsEntry | undefined,
  previous: SessionStats | null,
): SessionCost {
  if (
    snapshot &&
    snapshot.status === 'ok' &&
    snapshot.sessionId === sessionId
  ) {
    return sessionCostOf(snapshot);
  }
  if (previous && previous.sessionId === sessionId) {
    return { costUSD: previous.costUSD, costPartial: previous.costPartial };
  }
  return UNKNOWN_COST;
}

function deriveStatsFromBatch(
  sessionId: string,
  entry: SessionStatsEntry,
  previous: SessionStats | null,
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
    ...sessionCostFor(sessionId, entry, previous),
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

function deriveStats(
  payload: SessionStatsPush,
  previous: SessionStats | null,
): SessionStats | null {
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
    // `turnCost` is this turn's spend only and is never the session cost.
    ...sessionCostFor(payload.sessionId, payload.sessionStats, previous),
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

  /**
   * Incremented on every applied `session:stats` push. Only pushes for the
   * active session are applied, so a change here always concerns the session
   * an in-flight seed was started for.
   */
  private pushGeneration = 0;
  /**
   * Latest push per session received while no session is active, so a new
   * session's first push is not lost if it lands before `session:id-resolved`.
   * Emptied whenever the active session changes.
   */
  private readonly unresolvedPushes = new Map<string, SessionStatsPush>();
  /** Incremented when a stats-batch seed starts; only the newest may apply. */
  private seedSequence = 0;

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
        this.activate(id);
        await this.seedStats(id);
      }
    } catch {
      // failed to load — keep current active session
    } finally {
      this.loading = false;
      this.onChange();
    }
  }

  /**
   * Seeds stats from a `session:stats-batch` snapshot. The result is applied
   * only when it is still the newest information: no push was accepted while
   * the request was in flight, no later seed has started, and `id` is still
   * the active session. Otherwise it is dropped, success or failure alike.
   */
  private async seedStats(id: string): Promise<void> {
    const seed = ++this.seedSequence;
    const pushGeneration = this.pushGeneration;
    let next: SessionStats | null;
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
      next = entry ? deriveStatsFromBatch(id, entry, this.stats) : null;
    } catch {
      next = null;
    }
    if (
      seed === this.seedSequence &&
      pushGeneration === this.pushGeneration &&
      this.activeSessionId === id
    ) {
      this.stats = next;
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
        if (this.activeSessionId === id) this.activate(null);
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
    this.activate(id);
    this.onChange();
  }

  /**
   * Makes `id` the active session. When the session actually changes, the
   * previous session's stats are cleared so its figures are never shown under
   * the new session while that session's seed or first push is pending.
   */
  private activate(id: string | null): void {
    if (id !== this.activeSessionId) this.stats = null;
    this.activeSessionId = id;
    this.unresolvedPushes.clear();
  }

  /**
   * Applies a push only when it belongs to the active session. While no
   * session is active (a new session whose id is not yet resolved) the push is
   * held and applied by `handleIdResolved` if it names the resolved id.
   */
  private handleStats(payload: unknown): void {
    const push = payload as SessionStatsPush;
    if (!push.sessionId) return;
    if (this.activeSessionId === null) {
      this.unresolvedPushes.set(push.sessionId, push);
      return;
    }
    if (push.sessionId !== this.activeSessionId) return;
    this.applyPush(push);
  }

  private applyPush(push: SessionStatsPush): void {
    const next = deriveStats(push, this.stats);
    if (!next) return;
    this.pushGeneration++;
    this.stats = next;
    this.onChange();
  }

  private handleIdResolved(payload: unknown): void {
    const data = payload as SessionIdResolvedPayload;
    if (data.realSessionId && data.realSessionId.length > 0) {
      const held = this.unresolvedPushes.get(data.realSessionId);
      this.activate(data.realSessionId);
      if (held) this.applyPush(held);
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
