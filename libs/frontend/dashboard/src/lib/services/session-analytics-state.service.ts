import {
  Injectable,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import {
  AppStateManager,
  ClaudeRpcService,
  ModelStateService,
  type RpcResult,
} from '@ptah-extension/core';
import {
  SESSION_STATS_BATCH_MAX_IDS,
  resolveModelDisplayName,
  type ChatSessionSummary,
  type SessionStatsBatchResult,
  type SessionStatsCoverage,
  type SessionStatsEntry,
  type SessionStatsPricingCoverage,
} from '@ptah-extension/shared';

/**
 * Where a session's stats are in the progressive load.
 *
 * `'pending'` means its page has not arrived yet. The other three are the
 * host's own `SessionStatsEntry.status`.
 */
export type DashboardStatsStatus = 'pending' | 'ok' | 'error' | 'empty';

/**
 * Merged session data: metadata from session:list + stats from session:stats-batch.
 *
 * Combines trusted metadata (name, dates) from SessionMetadataStore with
 * per-session usage read from the transcript for the selected range.
 */
export interface DashboardSessionEntry {
  readonly sessionId: string;
  readonly name: string;
  readonly createdAt: number;
  readonly lastActivityAt: number;
  readonly model: string | null;
  readonly modelDisplayName: string;
  /**
   * Estimate from recorded usage and the CURRENT rate card. `null` means
   * unknown (no counted model has a price, or the stats are not in yet) —
   * never render it as $0.
   */
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
  readonly status: DashboardStatsStatus;
  /** `null` while pending. `'partial'` when some usage could not be counted. */
  readonly coverage: SessionStatsCoverage | null;
  /** Usage records left out of the range because they carry no timestamp. */
  readonly untimestampedCount: number;
  /** `null` while pending or when the host did not report it. */
  readonly pricingCoverage: SessionStatsPricingCoverage | null;
}

/**
 * Aggregate totals computed from displayed sessions.
 * Single-pass computation for efficiency.
 */
export interface AggregateTotals {
  /** Sum of the known session estimates; `null` when no session has one. */
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
  /** Sessions whose stats page has not arrived yet. */
  readonly pendingSessionCount: number;
  /** Sessions the host could not read (or whose page failed). */
  readonly errorSessionCount: number;
  /** Readable sessions whose range coverage is partial. */
  readonly partialSessionCount: number;
  /** Untimestamped usage records excluded across all sessions. */
  readonly untimestampedCount: number;
  /** Sessions with usage but no known price — excluded from `totalCost`. */
  readonly unknownCostSessionCount: number;
  /** Sessions where only part of the usage has a price. */
  readonly partiallyPricedSessionCount: number;
}

/** Progress of the stats pages for the active load. */
export interface SessionStatsProgress {
  readonly loaded: number;
  readonly total: number;
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
export const SESSION_ANALYTICS_SESSION_CAP = 200;

/** Separator for stats keys. An escape, never a literal NUL byte in source. */
const KEY_SEPARATOR = '\u0000';

/**
 * One load of the analytics card: a workspace, a range and ONE `until`
 * captured when the load started. Every page of the load uses the same
 * `[since, until)` window, so pages painted early and late add up to one
 * consistent picture.
 */
interface AnalyticsLoad {
  readonly generation: number;
  readonly workspacePath: string;
  readonly range: SessionDateRange;
  readonly since: number;
  readonly until: number;
  /** Stats key prefix: workspace / range / since / until. */
  readonly keyPrefix: string;
  readonly controller: AbortController;
}

/**
 * SessionAnalyticsStateService
 *
 * Signal-based state for the session analytics card.
 *
 * Data flow for one load:
 * 1. `session:list` bounded by `since` (at most {@link SESSION_ANALYTICS_SESSION_CAP}).
 * 2. `session:stats-batch` in pages of at most `SESSION_STATS_BATCH_MAX_IDS`,
 *    scope `'range'`, one shared `[since, until)`. Pages run one after another
 *    and each page is merged into the signals as soon as it arrives, so the
 *    first sessions paint before the last page is read.
 *
 * Staleness: every load gets a new generation and its own `AbortController`.
 * A range change, a workspace change or `cancelLoad()` aborts the previous
 * load, and a response is written only while its generation, workspace and
 * range are all still current. Stats are stored under a
 * workspace/range/since/until/session key, and only the active load's keys are
 * ever read, so even an entry that slipped through could not be displayed.
 *
 * The frontend abort releases the awaited call and stops further pages; the
 * host bounds its own work per page. The RPC timeout is the default one — a
 * page of 20 fits inside it, so no timeout is raised here.
 */
@Injectable({ providedIn: 'root' })
export class SessionAnalyticsStateService {
  private readonly rpc = inject(ClaudeRpcService);
  private readonly appState = inject(AppStateManager);
  private readonly modelState = inject(ModelStateService);

  /** Session metadata for the active load (names, dates, IDs). */
  private readonly _metadata = signal<readonly ChatSessionSummary[]>([]);
  /** `session:list` reported more sessions than the cap in this range. */
  private readonly _hasMoreSessions = signal(false);
  /** Stats keyed by workspace/range/since/until/session. */
  private readonly _statsByKey = signal<ReadonlyMap<string, SessionStatsEntry>>(
    new Map(),
  );
  /** Key prefix of the load whose stats are displayed. */
  private readonly _activeKeyPrefix = signal('');
  private readonly _dateRange = signal<SessionDateRange>('7d');
  private readonly _isLoading = signal(false);
  private readonly _isLoadingStats = signal(false);
  private readonly _statsProgress = signal<SessionStatsProgress>({
    loaded: 0,
    total: 0,
  });
  private readonly _loadError = signal<string | null>(null);

  private generation = 0;
  private activeLoad: AnalyticsLoad | null = null;
  private activeLoadDone: Promise<void> | null = null;

  /** True while `session:list` for the active load is in flight. */
  readonly isLoading = this._isLoading.asReadonly();
  /** True while stats pages for the active load are still being read. */
  readonly isLoadingStats = this._isLoadingStats.asReadonly();
  readonly statsProgress = this._statsProgress.asReadonly();
  readonly loadError = this._loadError.asReadonly();
  readonly dateRange = this._dateRange.asReadonly();
  readonly hasMoreSessions = this._hasMoreSessions.asReadonly();
  readonly sessionCap = SESSION_ANALYTICS_SESSION_CAP;

  /** The workspace the analytics are read for (`''` when none is open). */
  readonly workspacePath = computed(
    () => this.appState.workspaceInfo()?.path || '',
  );

  /** Number of sessions returned for the active range (capped by load limit). */
  readonly totalSessionCount = computed(() => this._metadata().length);

  /**
   * Sessions for the active load, merged with whatever stats pages have
   * arrived, most-recent first. The range is bounded server-side by
   * `session:list`, so no client-side date filtering is needed here.
   */
  readonly displayedSessions = computed<DashboardSessionEntry[]>(() => {
    const stats = this._statsByKey();
    const prefix = this._activeKeyPrefix();
    return this._metadata().map((session) =>
      this.mergeEntry(session, stats.get(prefix + session.id)),
    );
  });

  /**
   * Aggregate totals across the sessions currently in range. Pending sessions
   * contribute nothing yet; the counts say how much is still missing.
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
    let pendingSessionCount = 0,
      errorSessionCount = 0,
      partialSessionCount = 0,
      untimestampedCount = 0,
      unknownCostSessionCount = 0,
      partiallyPricedSessionCount = 0;

    for (const s of sessions) {
      if (s.status === 'pending') {
        pendingSessionCount++;
        continue;
      }
      if (s.status === 'error') {
        errorSessionCount++;
        continue;
      }
      if (s.coverage === 'partial' || s.untimestampedCount > 0) {
        partialSessionCount++;
      }
      untimestampedCount += s.untimestampedCount;
      if (s.totalCost !== null) {
        totalCost += s.totalCost;
        costContributorCount++;
      } else if (s.status === 'ok') {
        unknownCostSessionCount++;
      }
      if (s.status === 'ok' && s.pricingCoverage === 'partial') {
        partiallyPricedSessionCount++;
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
      pendingSessionCount,
      errorSessionCount,
      partialSessionCount,
      untimestampedCount,
      unknownCostSessionCount,
      partiallyPricedSessionCount,
    };
  });

  constructor() {
    // A workspace switch invalidates the load in flight at once, whether or
    // not the card is mounted to start the next one. No I/O happens here.
    effect(() => {
      const workspacePath = this.workspacePath();
      untracked(() => {
        const load = this.activeLoad;
        if (load && load.workspacePath !== workspacePath) {
          this.cancelLoad();
          this.clearLoadedData();
        }
      });
    });
  }

  /**
   * Change the active date range and reload. The previous load is aborted
   * and can no longer write.
   */
  async setDateRange(range: SessionDateRange): Promise<void> {
    if (range === this._dateRange()) return;
    this._dateRange.set(range);
    await this.loadDashboardData();
  }

  /**
   * Load the active workspace and range. A call while a load for the SAME
   * workspace and range is in flight joins it; any other call aborts it.
   * Never rejects: failures land in `loadError` or as per-session `'error'`.
   */
  loadDashboardData(): Promise<void> {
    const workspacePath = this.workspacePath();
    const range = this._dateRange();
    const inFlight = this.activeLoad;
    if (
      inFlight &&
      this.activeLoadDone &&
      inFlight.workspacePath === workspacePath &&
      inFlight.range === range
    ) {
      return this.activeLoadDone;
    }

    this.cancelLoad();
    this.clearLoadedData();

    if (!workspacePath) {
      this._loadError.set(
        'No workspace detected. Open a folder to view analytics.',
      );
      return Promise.resolve();
    }

    const until = Date.now();
    const since = until - RANGE_DAYS[range] * DAY_MS;
    this.generation++;
    const load: AnalyticsLoad = {
      generation: this.generation,
      workspacePath,
      range,
      since,
      until,
      keyPrefix: statsKeyPrefix(workspacePath, range, since, until),
      controller: new AbortController(),
    };
    this.activeLoad = load;
    this._activeKeyPrefix.set(load.keyPrefix);

    const done = this.runLoad(load).finally(() => {
      if (this.activeLoad === load) {
        this.activeLoad = null;
        this.activeLoadDone = null;
        this._isLoading.set(false);
        this._isLoadingStats.set(false);
      }
    });
    this.activeLoadDone = done;
    return done;
  }

  /**
   * Abort the load in flight, if any. Already painted pages stay; sessions
   * whose page never arrived stay pending until the next load.
   */
  cancelLoad(): void {
    const load = this.activeLoad;
    this.generation++;
    this.activeLoad = null;
    this.activeLoadDone = null;
    this._isLoading.set(false);
    this._isLoadingStats.set(false);
    load?.controller.abort();
  }

  private async runLoad(load: AnalyticsLoad): Promise<void> {
    this._isLoading.set(true);
    try {
      const listResult = await this.rpc.call(
        'session:list',
        {
          workspacePath: load.workspacePath,
          limit: SESSION_ANALYTICS_SESSION_CAP,
          offset: 0,
          since: load.since,
        },
        { signal: load.controller.signal },
      );
      if (!this.isCurrent(load)) return;
      if (!listResult.isSuccess()) {
        throw new Error(listResult.error || 'Failed to load session list');
      }

      const sessions = listResult.data.sessions;
      this._metadata.set(sessions);
      this._hasMoreSessions.set(listResult.data.hasMore === true);
      this._isLoading.set(false);

      await this.loadStatsPages(
        load,
        sessions.map((s) => s.id),
      );
    } catch (error: unknown) {
      if (!this.isCurrent(load)) return;
      this._loadError.set(
        error instanceof Error ? error.message : 'Failed to load dashboard data',
      );
    }
  }

  /** Read stats one page at a time, painting each page as it lands. */
  private async loadStatsPages(
    load: AnalyticsLoad,
    sessionIds: readonly string[],
  ): Promise<void> {
    this._statsProgress.set({ loaded: 0, total: sessionIds.length });
    this._isLoadingStats.set(sessionIds.length > 0);

    for (
      let start = 0;
      start < sessionIds.length;
      start += SESSION_STATS_BATCH_MAX_IDS
    ) {
      if (!this.isCurrent(load)) return;
      const page = sessionIds.slice(start, start + SESSION_STATS_BATCH_MAX_IDS);
      const result = await this.rpc.call(
        'session:stats-batch',
        {
          sessionIds: page,
          workspacePath: load.workspacePath,
          scope: 'range',
          since: load.since,
          until: load.until,
        },
        { signal: load.controller.signal },
      );
      if (!this.isCurrent(load)) return;
      this.mergePage(load, page, result);
    }

    this._isLoadingStats.set(false);
  }

  /**
   * Write one page. Only ids that were asked for are accepted, a page whose
   * echoed window is not this load's is rejected, and every requested id the
   * page did not answer becomes `'error'` so it stops reading as pending.
   */
  private mergePage(
    load: AnalyticsLoad,
    page: readonly string[],
    result: RpcResult<SessionStatsBatchResult>,
  ): void {
    const answered = new Map<string, SessionStatsEntry>();
    if (result.isSuccess() && pageMatchesLoad(result.data, load)) {
      const requested = new Set(page);
      for (const stat of result.data.sessionStats) {
        if (requested.has(stat.sessionId)) answered.set(stat.sessionId, stat);
      }
    }

    const next = new Map(this._statsByKey());
    for (const sessionId of page) {
      next.set(
        load.keyPrefix + sessionId,
        answered.get(sessionId) ?? unreadableStats(sessionId),
      );
    }
    this._statsByKey.set(next);
    this._statsProgress.update((progress) => ({
      loaded: progress.loaded + page.length,
      total: progress.total,
    }));
  }

  /** A load may write only while it is the live generation for the live scope. */
  private isCurrent(load: AnalyticsLoad): boolean {
    return (
      load.generation === this.generation &&
      !load.controller.signal.aborted &&
      load.workspacePath === this.workspacePath() &&
      load.range === this._dateRange()
    );
  }

  private clearLoadedData(): void {
    this._metadata.set([]);
    this._hasMoreSessions.set(false);
    this._statsByKey.set(new Map());
    this._activeKeyPrefix.set('');
    this._statsProgress.set({ loaded: 0, total: 0 });
    this._loadError.set(null);
  }

  /** Merge trusted metadata with transcript-derived stats into a display entry. */
  private mergeEntry(
    session: ChatSessionSummary,
    stats: SessionStatsEntry | undefined,
  ): DashboardSessionEntry {
    const models = this.modelState.availableModels();
    return {
      sessionId: session.id,
      name: session.name,
      createdAt: session.createdAt,
      lastActivityAt: session.lastActivityAt,
      model: stats?.model ?? null,
      modelDisplayName: stats?.model
        ? resolveModelDisplayName(stats.model, models)
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
        modelDisplayName: resolveModelDisplayName(m.model, models),
        inputTokens: m.inputTokens,
        outputTokens: m.outputTokens,
        costUSD: m.costUSD,
      })),
      status: stats?.status ?? 'pending',
      coverage: stats ? (stats.coverage ?? 'complete') : null,
      untimestampedCount: stats?.untimestampedCount ?? 0,
      pricingCoverage: stats?.pricingCoverage ?? null,
    };
  }
}

function statsKeyPrefix(
  workspacePath: string,
  range: SessionDateRange,
  since: number,
  until: number,
): string {
  return [workspacePath, range, since, until, ''].join(KEY_SEPARATOR);
}

/** A page answers this load only if its echoed scope and window match. */
function pageMatchesLoad(
  data: SessionStatsBatchResult,
  load: AnalyticsLoad,
): boolean {
  return (
    (data.scope === undefined || data.scope === 'range') &&
    (data.since === undefined || data.since === load.since) &&
    (data.until === undefined || data.until === load.until)
  );
}

/** Stand-in for a session its page failed to answer. Cost stays unknown. */
function unreadableStats(sessionId: string): SessionStatsEntry {
  return {
    sessionId,
    model: null,
    totalCost: null,
    tokens: { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 },
    messageCount: 0,
    status: 'error',
    coverage: 'partial',
    untimestampedCount: 0,
    pricingCoverage: 'none',
  };
}
