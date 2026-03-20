import { Injectable, signal, computed, inject } from '@angular/core';
import {
  SESSION_DATA_PROVIDER,
  type ISessionDataProvider,
} from '@ptah-extension/core';
import {
  calculateMessageCost,
  ChatSessionSummary,
  MessageTokenUsage,
} from '@ptah-extension/shared';

/**
 * Sort fields available for session table sorting.
 */
export type SortField =
  | 'name'
  | 'createdAt'
  | 'lastActivityAt'
  | 'inputTokens'
  | 'outputTokens'
  | 'estimatedCost'
  | 'messageCount';

/**
 * Session summary enriched with an estimated cost value.
 * Cost is null when tokenUsage data is unavailable.
 */
export interface SessionWithCost extends ChatSessionSummary {
  readonly estimatedCost: number | null;
}

/**
 * Breakdown of token usage across categories with absolute counts and percentages.
 */
export interface TokenBreakdownData {
  readonly input: number;
  readonly output: number;
  readonly cacheRead: number;
  readonly cacheCreation: number;
  readonly total: number;
  readonly inputPercent: number;
  readonly outputPercent: number;
  readonly cacheReadPercent: number;
  readonly cacheCreationPercent: number;
}

/**
 * SessionAnalyticsStateService
 *
 * Signal-based state service for session analytics dashboard.
 * Consumes ChatStore sessions and computes all analytics metrics reactively.
 *
 * Responsibilities:
 * - Enrich sessions with estimated cost using default model pricing
 * - Compute aggregate token and cost metrics (single-pass)
 * - Provide sorted sessions with configurable sort field/direction
 * - Manage loading/error states for session data
 * - Delegate session loading to ChatStore
 */
@Injectable({ providedIn: 'root' })
export class SessionAnalyticsStateService {
  /** Using empty string triggers default pricing (Sonnet 4.5 rates) via findModelPricing fallback */
  private static readonly DEFAULT_MODEL_FOR_ESTIMATION = '';

  private readonly sessionProvider = inject(SESSION_DATA_PROVIDER);

  // Private writable signals for sort state
  private readonly _sortField = signal<SortField>('lastActivityAt');
  private readonly _sortDirection = signal<'asc' | 'desc'>('desc');

  // Private writable signals for loading/error state
  private readonly _isLoading = signal(false);
  private readonly _loadError = signal<string | null>(null);

  // Public readonly signals delegated from ChatStore
  readonly sessions = this.sessionProvider.sessions;
  readonly hasMoreSessions = this.sessionProvider.hasMoreSessions;
  readonly isLoadingMore = this.sessionProvider.isLoadingMoreSessions;

  // Public readonly loading/error signals
  readonly isLoading = this._isLoading.asReadonly();
  readonly loadError = this._loadError.asReadonly();

  // Public readonly sort signals
  readonly sortField = this._sortField.asReadonly();
  readonly sortDirection = this._sortDirection.asReadonly();

  /**
   * Sessions enriched with estimated cost.
   * Uses default model pricing (Sonnet 4.5 fallback via DEFAULT_MODEL_FOR_ESTIMATION).
   * Sessions without tokenUsage get estimatedCost: null.
   */
  readonly sessionsWithCost = computed<SessionWithCost[]>(() => {
    return this.sessions().map((session) => {
      if (!session.tokenUsage) {
        return { ...session, estimatedCost: null };
      }

      const tokenUsage: MessageTokenUsage = session.tokenUsage;
      const estimatedCost = calculateMessageCost(
        SessionAnalyticsStateService.DEFAULT_MODEL_FOR_ESTIMATION,
        {
          input: tokenUsage.input,
          output: tokenUsage.output,
          cacheHit: tokenUsage.cacheRead,
          cacheCreation: tokenUsage.cacheCreation,
        }
      );

      return { ...session, estimatedCost };
    });
  });

  /** Total number of sessions currently loaded. */
  readonly totalSessions = computed(() => this.sessions().length);

  /**
   * Single-pass aggregation of token data across all sessions.
   * Avoids six separate array iterations by computing all token totals in one loop.
   */
  private readonly aggregates = computed(() => {
    const sessions = this.sessions();
    let totalInput = 0;
    let totalOutput = 0;
    let totalCacheRead = 0;
    let totalCacheCreation = 0;
    let withTokenData = 0;

    for (const s of sessions) {
      if (s.tokenUsage) {
        withTokenData++;
        totalInput += s.tokenUsage.input;
        totalOutput += s.tokenUsage.output;
        totalCacheRead += s.tokenUsage.cacheRead ?? 0;
        totalCacheCreation += s.tokenUsage.cacheCreation ?? 0;
      }
    }

    return {
      totalInput,
      totalOutput,
      totalCacheRead,
      totalCacheCreation,
      withTokenData,
    };
  });

  /** Sum of all estimated costs across sessions with token data. */
  readonly totalEstimatedCost = computed(() => {
    return this.sessionsWithCost().reduce((sum, session) => {
      return sum + (session.estimatedCost ?? 0);
    }, 0);
  });

  /** Sum of input tokens across all sessions. */
  readonly totalInputTokens = computed(() => this.aggregates().totalInput);

  /** Sum of output tokens across all sessions. */
  readonly totalOutputTokens = computed(() => this.aggregates().totalOutput);

  /** Sum of cache read tokens across all sessions. */
  readonly totalCacheReadTokens = computed(
    () => this.aggregates().totalCacheRead
  );

  /** Sum of cache creation tokens across all sessions. */
  readonly totalCacheCreationTokens = computed(
    () => this.aggregates().totalCacheCreation
  );

  /** Count of sessions that have token usage data. */
  readonly sessionsWithTokenData = computed(
    () => this.aggregates().withTokenData
  );

  /** Average estimated cost per session (only sessions with token data). */
  readonly avgCostPerSession = computed(() => {
    const count = this.sessionsWithTokenData();
    if (count === 0) return 0;
    return this.totalEstimatedCost() / count;
  });

  /** Token breakdown with absolute counts and percentages. */
  readonly tokenBreakdown = computed<TokenBreakdownData>(() => {
    const input = this.totalInputTokens();
    const output = this.totalOutputTokens();
    const cacheRead = this.totalCacheReadTokens();
    const cacheCreation = this.totalCacheCreationTokens();
    const total = input + output + cacheRead + cacheCreation;

    if (total === 0) {
      return {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheCreation: 0,
        total: 0,
        inputPercent: 0,
        outputPercent: 0,
        cacheReadPercent: 0,
        cacheCreationPercent: 0,
      };
    }

    return {
      input,
      output,
      cacheRead,
      cacheCreation,
      total,
      inputPercent: (input / total) * 100,
      outputPercent: (output / total) * 100,
      cacheReadPercent: (cacheRead / total) * 100,
      cacheCreationPercent: (cacheCreation / total) * 100,
    };
  });

  /** Sessions with cost, sorted by the active sort field and direction. */
  readonly sortedSessions = computed<SessionWithCost[]>(() => {
    const sessions = [...this.sessionsWithCost()];
    const field = this._sortField();
    const direction = this._sortDirection();
    const multiplier = direction === 'asc' ? 1 : -1;

    return sessions.sort((a, b) => {
      switch (field) {
        case 'name':
          return multiplier * a.name.localeCompare(b.name);

        case 'createdAt':
          return multiplier * (a.createdAt - b.createdAt);

        case 'lastActivityAt':
          return multiplier * (a.lastActivityAt - b.lastActivityAt);

        case 'inputTokens':
          return (
            multiplier *
            ((a.tokenUsage?.input ?? 0) - (b.tokenUsage?.input ?? 0))
          );

        case 'outputTokens':
          return (
            multiplier *
            ((a.tokenUsage?.output ?? 0) - (b.tokenUsage?.output ?? 0))
          );

        case 'estimatedCost':
          return multiplier * ((a.estimatedCost ?? 0) - (b.estimatedCost ?? 0));

        case 'messageCount':
          return multiplier * (a.messageCount - b.messageCount);

        default:
          return 0;
      }
    });
  });

  /**
   * Set or toggle the sort field.
   * If the same field is clicked, toggles direction.
   * If a new field is selected, sets it with ascending direction.
   */
  setSortField(field: SortField): void {
    if (this._sortField() === field) {
      this._sortDirection.set(this._sortDirection() === 'asc' ? 'desc' : 'asc');
    } else {
      this._sortField.set(field);
      this._sortDirection.set('asc');
    }
  }

  /** Delegate to ChatStore to load the next page of sessions. */
  loadMoreSessions(): Promise<void> {
    return this.sessionProvider.loadMoreSessions();
  }

  /**
   * Load sessions if none are currently loaded.
   * Manages loading/error state so the UI can show appropriate feedback.
   */
  async ensureSessionsLoaded(): Promise<void> {
    if (this.sessions().length === 0 && !this._isLoading()) {
      this._isLoading.set(true);
      this._loadError.set(null);
      try {
        await this.sessionProvider.loadSessions();
      } catch (err) {
        this._loadError.set(
          err instanceof Error ? err.message : 'Failed to load sessions'
        );
      } finally {
        this._isLoading.set(false);
      }
    }
  }
}
