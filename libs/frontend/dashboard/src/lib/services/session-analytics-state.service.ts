import { Injectable, signal, computed, inject } from '@angular/core';
import { ClaudeRpcService, AppStateManager } from '@ptah-extension/core';
import {
  SessionStatsEntry,
  formatModelDisplayName,
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
  readonly totalCost: number;
  readonly tokens: {
    readonly input: number;
    readonly output: number;
    readonly cacheRead: number;
    readonly cacheCreation: number;
  };
  readonly messageCount: number;
  /** Number of agent/subagent sessions (from agent-*.jsonl files). */
  readonly agentSessionCount: number;
  /** Whether stats were successfully read from JSONL ('ok' | 'error' | 'empty'). */
  readonly status: 'ok' | 'error' | 'empty';
}

/**
 * Aggregate totals computed from displayed sessions.
 * Single-pass computation for efficiency.
 */
export interface AggregateTotals {
  readonly totalCost: number;
  readonly totalTokens: number;
  readonly totalInput: number;
  readonly totalOutput: number;
  readonly totalCacheRead: number;
  readonly totalCacheCreation: number;
  readonly totalMessages: number;
  readonly sessionCount: number;
}

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
 * 4. Exposes computed signals for displayed sessions, aggregates, and display toggle
 *
 * TASK_2025_206 v2: Replaces v1 service that depended on broken ChatStore metadata pipeline.
 */
@Injectable({ providedIn: 'root' })
export class SessionAnalyticsStateService {
  private readonly rpc = inject(ClaudeRpcService);
  private readonly appState = inject(AppStateManager);

  // -- Private writable signals --
  private readonly _allSessions = signal<DashboardSessionEntry[]>([]);
  private readonly _displayCount = signal<5 | 10>(5);
  private readonly _isLoading = signal(false);
  private readonly _loadError = signal<string | null>(null);

  // -- Public readonly signals --
  readonly isLoading = this._isLoading.asReadonly();
  readonly loadError = this._loadError.asReadonly();
  readonly displayCount = this._displayCount.asReadonly();

  /** All sessions with merged metadata and stats. */
  readonly allSessions = this._allSessions.asReadonly();

  /** Sessions to display, sliced by the current displayCount (5 or 10). */
  readonly displayedSessions = computed(() => {
    return this._allSessions().slice(0, this._displayCount());
  });

  /** Whether there are more sessions available than currently displayed. */
  readonly hasMoreToShow = computed(() => {
    return this._allSessions().length > this._displayCount();
  });

  /**
   * Aggregate totals across ALL sessions (not just the displayed subset).
   * This ensures "Total Cost" and other aggregates remain stable when
   * toggling the display count between 5 and 10.
   * Single-pass loop for efficiency -- avoids multiple array iterations.
   */
  readonly aggregates = computed<AggregateTotals>(() => {
    const sessions = this._allSessions();
    let totalCost = 0,
      totalInput = 0,
      totalOutput = 0;
    let totalCacheRead = 0,
      totalCacheCreation = 0,
      totalMessages = 0;

    for (const s of sessions) {
      totalCost += s.totalCost;
      totalInput += s.tokens.input;
      totalOutput += s.tokens.output;
      totalCacheRead += s.tokens.cacheRead;
      totalCacheCreation += s.tokens.cacheCreation;
      totalMessages += s.messageCount;
    }

    return {
      totalCost,
      totalTokens:
        totalInput + totalOutput + totalCacheRead + totalCacheCreation,
      totalInput,
      totalOutput,
      totalCacheRead,
      totalCacheCreation,
      totalMessages,
      sessionCount: sessions.length,
    };
  });

  // -- Actions --

  /** Toggle between showing 5 and 10 sessions. */
  setDisplayCount(count: 5 | 10): void {
    this._displayCount.set(count);
  }

  /**
   * Load dashboard data: session list + batch stats from JSONL files.
   *
   * Two-step process:
   * 1. `session:list` for metadata (names, dates, IDs) -- trusted source
   * 2. `session:stats-batch` for real stats (cost, tokens, model) -- from JSONL files
   *
   * Called on dashboard mount via ngOnInit.
   */
  async loadDashboardData(): Promise<void> {
    if (this._isLoading()) return;

    this._isLoading.set(true);
    this._loadError.set(null);

    try {
      const workspacePath = this.appState.workspaceInfo()?.path || '';

      if (!workspacePath) {
        this._loadError.set(
          'No workspace detected. Open a folder to view analytics.'
        );
        return;
      }

      // Step 1: Get session list (metadata: ids, names, dates)
      const listResult = await this.rpc.call('session:list', {
        workspacePath,
        limit: 30,
        offset: 0,
      });

      if (!listResult.isSuccess() || !listResult.data) {
        throw new Error(listResult.error || 'Failed to load session list');
      }

      const sessionList = listResult.data.sessions;
      if (sessionList.length === 0) {
        this._allSessions.set([]);
        return;
      }

      // Step 2: Get real stats for all sessions from JSONL files
      const sessionIds = sessionList.map((s) => s.id);
      const statsResult = await this.rpc.call('session:stats-batch', {
        sessionIds,
        workspacePath,
      });

      if (!statsResult.isSuccess() || !statsResult.data) {
        throw new Error(statsResult.error || 'Failed to load session stats');
      }

      // Step 3: Merge metadata + stats using Map for O(1) lookups
      const statsMap = new Map<string, SessionStatsEntry>();
      for (const stat of statsResult.data.sessionStats) {
        statsMap.set(stat.sessionId, stat);
      }

      const merged: DashboardSessionEntry[] = sessionList.map((session) => {
        const stats = statsMap.get(session.id);
        return {
          sessionId: session.id,
          name: session.name,
          createdAt: session.createdAt,
          lastActivityAt: session.lastActivityAt,
          model: stats?.model ?? null,
          modelDisplayName: stats?.model
            ? formatModelDisplayName(stats.model)
            : 'Unknown',
          totalCost: stats?.totalCost ?? 0,
          tokens: stats?.tokens ?? {
            input: 0,
            output: 0,
            cacheRead: 0,
            cacheCreation: 0,
          },
          messageCount: stats?.messageCount ?? 0,
          agentSessionCount: stats?.agentSessionCount ?? 0,
          status: stats?.status ?? 'empty',
        };
      });

      this._allSessions.set(merged);
    } catch (err) {
      this._loadError.set(
        err instanceof Error ? err.message : 'Failed to load dashboard data'
      );
    } finally {
      this._isLoading.set(false);
    }
  }
}
