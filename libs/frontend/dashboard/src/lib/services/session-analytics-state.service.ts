import { Injectable, signal, computed, inject } from '@angular/core';
import {
  ClaudeRpcService,
  AppStateManager,
  ModelStateService,
} from '@ptah-extension/core';
import {
  ChatSessionSummary,
  SessionStatsEntry,
  resolveModelDisplayName,
} from '@ptah-extension/shared';

/**
 * Merged session data: metadata from session:list + stats from session:stats-batch.
 *
 * Combines trusted metadata (name, dates) from SessionMetadataStore with
 * real per-session stats (cost, tokens, model, messageCount) read from JSONL files.
 */
export interface DashboardSessionEntry {
  readonly sessionId: string;
  readonly name: string;
  readonly createdAt: number;
  readonly lastActivityAt: number;
  readonly model: string | null;
  readonly modelDisplayName: string;
  readonly totalCost: number | null;
  readonly tokens: {
    readonly input: number;
    readonly output: number;
    readonly cacheRead: number;
    readonly cacheCreation: number;
  };
  readonly messageCount: number;
  /** Number of agent/subagent sessions (from agent-*.jsonl files). */
  readonly agentSessionCount: number;
  /** CLI agent types used in this session (e.g., ['codex', 'copilot']). */
  readonly cliAgents: readonly string[];
  /** Per-model usage breakdown (model, tokens, cost). Empty when single/unknown model. */
  readonly modelUsageList: ReadonlyArray<{
    readonly model: string;
    readonly modelDisplayName: string;
    readonly inputTokens: number;
    readonly outputTokens: number;
    readonly costUSD: number | null;
  }>;
  /** Whether stats were successfully read from JSONL ('ok' | 'error' | 'empty'). */
  readonly status: 'ok' | 'error' | 'empty';
}

/**
 * Aggregate totals computed from displayed sessions.
 * Single-pass computation for efficiency.
 */
export interface AggregateTotals {
  readonly totalCost: number | null;
  readonly totalTokens: number;
  readonly totalInput: number;
  readonly totalOutput: number;
  readonly totalCacheRead: number;
  readonly totalCacheCreation: number;
  readonly totalMessages: number;
  readonly sessionCount: number;
  readonly totalSubagents: number;
  readonly avgCostPerSession: number | null;
}

/**
 * Date-range presets that scope which sessions feed the analytics card.
 * Bounded to two weeks so the dashboard never pulls an unbounded history —
 * the lower bound is applied server-side via the `session:list` `since` param.
 */
export type SessionDateRange = '1d' | '2d' | '3d' | '7d' | '14d';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Number of days each preset reaches back from now. */
const RANGE_DAYS: Record<SessionDateRange, number> = {
  '1d': 1,
  '2d': 2,
  '3d': 3,
  '7d': 7,
  '14d': 14,
};

/** Selectable date-range options with their display labels (UI order). */
export const SESSION_DATE_RANGE_OPTIONS: ReadonlyArray<{
  readonly value: SessionDateRange;
  readonly label: string;
}> = [
  { value: '1d', label: '1 day' },
  { value: '2d', label: '2 days' },
  { value: '3d', label: '3 days' },
  { value: '7d', label: '1 week' },
  { value: '14d', label: '2 weeks' },
];

/** Safety cap on sessions returned for a single range. */
const METADATA_LOAD_LIMIT = 200;

/**
 * SessionAnalyticsStateService (v2)
 *
 * Signal-based state service for the session analytics dashboard.
 * Makes direct RPC calls to fetch session metadata and real stats from JSONL files.
 *
 * Data flow:
 * 1. Calls `session:list` to get session metadata (names, dates, IDs)
 * 2. Calls `session:stats-batch` with session IDs to get real stats from JSONL files
 * 3. Merges metadata + stats into DashboardSessionEntry[]
 * 4. Exposes computed signals for in-range sessions, aggregates, and the date range
 */
@Injectable({ providedIn: 'root' })
export class SessionAnalyticsStateService {
  private readonly rpc = inject(ClaudeRpcService);
  private readonly appState = inject(AppStateManager);
  private readonly modelState = inject(ModelStateService);
  /** All session metadata for the workspace (names, dates, IDs). */
  private readonly _metadata = signal<ChatSessionSummary[]>([]);
  /** Per-session stats cache, accumulated across range changes. */
  private readonly _statsById = signal<Map<string, SessionStatsEntry>>(
    new Map(),
  );
  private readonly _dateRange = signal<SessionDateRange>('7d');
  private readonly _isLoading = signal(false);
  private readonly _loadError = signal<string | null>(null);
  readonly isLoading = this._isLoading.asReadonly();
  readonly loadError = this._loadError.asReadonly();
  readonly dateRange = this._dateRange.asReadonly();

  /** Number of sessions returned for the active range (capped by load limit). */
  readonly totalSessionCount = computed(() => this._metadata().length);

  /**
   * Sessions for the active date range, merged with their JSONL stats,
   * most-recent first. The range is bounded server-side by `session:list`,
   * so no client-side date filtering is needed here.
   */
  readonly displayedSessions = computed<DashboardSessionEntry[]>(() => {
    const stats = this._statsById();
    return this._metadata().map((session) =>
      this.mergeEntry(session, stats.get(session.id)),
    );
  });

  /**
   * Aggregate totals across the sessions currently in range (the displayed
   * subset). Recomputing over the in-range set is what makes the metric tiles
   * track the selected date range.
   * Single-pass loop for efficiency -- avoids multiple array iterations.
   */
  readonly aggregates = computed<AggregateTotals>(() => {
    const sessions = this.displayedSessions();
    let totalCost = 0,
      totalInput = 0,
      totalOutput = 0;
    let totalCacheRead = 0,
      totalCacheCreation = 0,
      totalMessages = 0,
      totalSubagents = 0;
    let costContributorCount = 0;

    for (const s of sessions) {
      if (s.totalCost !== null) {
        totalCost += s.totalCost;
        costContributorCount++;
      }
      totalInput += s.tokens.input;
      totalOutput += s.tokens.output;
      totalCacheRead += s.tokens.cacheRead;
      totalCacheCreation += s.tokens.cacheCreation;
      totalMessages += s.messageCount;
      totalSubagents += s.agentSessionCount;
    }

    return {
      totalCost: costContributorCount > 0 ? totalCost : null,
      totalTokens:
        totalInput + totalOutput + totalCacheRead + totalCacheCreation,
      totalInput,
      totalOutput,
      totalCacheRead,
      totalCacheCreation,
      totalMessages,
      sessionCount: sessions.length,
      totalSubagents,
      avgCostPerSession:
        costContributorCount > 0 ? totalCost / costContributorCount : null,
    };
  });

  /**
   * Change the active date range and reload. The lower bound is applied
   * server-side, so a different range means a different `session:list` query.
   */
  async setDateRange(range: SessionDateRange): Promise<void> {
    if (range === this._dateRange()) return;
    this._dateRange.set(range);
    await this.loadDashboardData();
  }

  /**
   * Load dashboard data for the active date range: session list (bounded by
   * `since`) + batch stats from JSONL files.
   *
   * 1. `session:list` with a `since` lower bound -- trusted, server-bounded
   * 2. `ensureStats` reads JSONL stats for any not-yet-cached session
   *
   * Called on dashboard mount via ngOnInit and on every range change.
   */
  async loadDashboardData(): Promise<void> {
    if (this._isLoading()) return;

    this._isLoading.set(true);
    this._loadError.set(null);

    try {
      const workspacePath = this.workspacePath();
      if (!workspacePath) {
        this._loadError.set(
          'No workspace detected. Open a folder to view analytics.',
        );
        return;
      }

      const listResult = await this.rpc.call('session:list', {
        workspacePath,
        limit: METADATA_LOAD_LIMIT,
        offset: 0,
        since: this.rangeSinceMs(this._dateRange()),
      });

      if (!listResult.isSuccess() || !listResult.data) {
        throw new Error(listResult.error || 'Failed to load session list');
      }

      this._metadata.set(listResult.data.sessions);
      await this.ensureStats();
    } catch (err) {
      this._loadError.set(
        err instanceof Error ? err.message : 'Failed to load dashboard data',
      );
    } finally {
      this._isLoading.set(false);
    }
  }

  /**
   * Fetch (and cache) JSONL stats for every loaded session that doesn't yet
   * have stats. The metadata is already range-bounded, and the cache is keyed
   * by session id, so switching back to a previously-loaded range is free.
   */
  private async ensureStats(): Promise<void> {
    const workspacePath = this.workspacePath();
    if (!workspacePath) return;

    const cached = this._statsById();
    const missingIds = this._metadata()
      .filter((s) => !cached.has(s.id))
      .map((s) => s.id);

    if (missingIds.length === 0) return;

    const statsResult = await this.rpc.call('session:stats-batch', {
      sessionIds: missingIds,
      workspacePath,
    });

    if (!statsResult.isSuccess() || !statsResult.data) {
      throw new Error(statsResult.error || 'Failed to load session stats');
    }

    const next = new Map(this._statsById());
    for (const stat of statsResult.data.sessionStats) {
      next.set(stat.sessionId, stat);
    }
    this._statsById.set(next);
  }

  private workspacePath(): string {
    return this.appState.workspaceInfo()?.path || '';
  }

  /** Lower-bound timestamp (epoch ms) for a date range. */
  private rangeSinceMs(range: SessionDateRange): number {
    return Date.now() - RANGE_DAYS[range] * DAY_MS;
  }

  /** Merge trusted metadata with JSONL-derived stats into a display entry. */
  private mergeEntry(
    session: ChatSessionSummary,
    stats: SessionStatsEntry | undefined,
  ): DashboardSessionEntry {
    return {
      sessionId: session.id,
      name: session.name,
      createdAt: session.createdAt,
      lastActivityAt: session.lastActivityAt,
      model: stats?.model ?? null,
      modelDisplayName: stats?.model
        ? resolveModelDisplayName(
            stats.model,
            this.modelState.availableModels(),
          )
        : 'Unknown',
      totalCost: stats?.totalCost ?? null,
      tokens: stats?.tokens ?? {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheCreation: 0,
      },
      messageCount: stats?.messageCount ?? 0,
      agentSessionCount: stats?.agentSessionCount ?? 0,
      cliAgents: stats?.cliAgents ?? [],
      modelUsageList: (stats?.modelUsageList ?? []).map((m) => ({
        model: m.model,
        modelDisplayName: resolveModelDisplayName(
          m.model,
          this.modelState.availableModels(),
        ),
        inputTokens: m.inputTokens,
        outputTokens: m.outputTokens,
        costUSD: m.costUSD,
      })),
      status: stats?.status ?? 'empty',
    };
  }
}
