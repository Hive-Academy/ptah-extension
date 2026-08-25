import { Injectable, Signal, computed, signal } from '@angular/core';
import type {
  LiveModelStatsPayload,
  PreloadedStatsPayload,
} from './tab-state.types';

/**
 * Per-model usage breakdown for one session. Structurally the same shape
 * `TabState.modelUsageList` carries, because both feed the same presentational
 * component (`SessionStatsSummaryComponent` in `chat-ui`).
 */
export interface SurfaceModelUsage {
  readonly model: string;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly costUSD: number | null;
  readonly contextWindow: number;
  readonly cacheReadInputTokens?: number;
}

/** Everything a surface needs to render the same stats a tab shows. */
export interface SurfaceSessionStats {
  /** Primary model + context fill, or null when no window could be resolved. */
  readonly live: LiveModelStatsPayload | null;
  /** Latest per-model breakdown, or null before the first turn completes. */
  readonly modelUsage: readonly SurfaceModelUsage[] | null;
  /** Running totals across every turn of the session. */
  readonly totals: PreloadedStatsPayload;
}

const EMPTY_TOTALS: PreloadedStatsPayload = {
  totalCost: null,
  tokens: { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 },
  messageCount: 0,
};

/**
 * Session stats for consumers that are NOT tabs.
 *
 * A tab keeps its stats on its own `TabState`, which is the right home when one
 * exists. Workflow surfaces — New Project, the harness builder, a wizard
 * analysis phase — have no `TabState` by design, so every `session:stats` event
 * they produced had nowhere to land and was discarded. This is that home:
 * session-keyed, because a surface's identity (`SurfaceId`) is minted fresh on
 * every reload while the session it is bound to survives.
 *
 * Deliberately NOT a second source of truth for tabs. `record` is called only
 * on the no-tab branch of `SessionStatsAggregatorService`, so a session that
 * has a tab never appears here and the two can never disagree.
 */
@Injectable({ providedIn: 'root' })
export class SurfaceSessionStatsRegistry {
  private readonly _bySession = signal<
    ReadonlyMap<string, SurfaceSessionStats>
  >(new Map());

  /** Snapshot of every recorded session. Primarily for tests and debugging. */
  readonly sessions = computed<readonly string[]>(() =>
    Array.from(this._bySession().keys()),
  );

  /** Reactive accessor for one session's stats. */
  stats(sessionId: string): Signal<SurfaceSessionStats | null> {
    return computed(() => this._bySession().get(sessionId) ?? null);
  }

  /** Non-reactive read, for callers already inside a computed of their own. */
  peek(sessionId: string): SurfaceSessionStats | null {
    return this._bySession().get(sessionId) ?? null;
  }

  /**
   * Fold one turn's stats into the session's running record.
   *
   * `live` and `modelUsage` REPLACE (they describe the session as of this
   * turn); `totals` ACCUMULATE. That split mirrors the tab path exactly —
   * `setLiveModelStatsAndUsageList` overwrites while `setPreloadedStats` adds —
   * so the two surfaces cannot drift into reporting different numbers for the
   * same turn.
   *
   * A `null` turn cost leaves the running total untouched rather than coercing
   * to 0: an unpriced model must not silently claim a turn was free.
   */
  record(
    sessionId: string,
    turn: {
      readonly live: LiveModelStatsPayload | null;
      readonly modelUsage: readonly SurfaceModelUsage[] | null;
      readonly cost: number | null;
      readonly tokens: {
        readonly input: number;
        readonly output: number;
        readonly cacheRead?: number;
        readonly cacheCreation?: number;
      };
    },
  ): void {
    if (!sessionId) return;
    this._bySession.update((prev) => {
      const existing = prev.get(sessionId);
      const totals = existing?.totals ?? EMPTY_TOTALS;
      const next = new Map(prev);
      next.set(sessionId, {
        live: turn.live ?? existing?.live ?? null,
        modelUsage: turn.modelUsage ?? existing?.modelUsage ?? null,
        totals: {
          totalCost:
            turn.cost === null
              ? totals.totalCost
              : (totals.totalCost ?? 0) + turn.cost,
          tokens: {
            input: totals.tokens.input + turn.tokens.input,
            output: totals.tokens.output + turn.tokens.output,
            cacheRead: totals.tokens.cacheRead + (turn.tokens.cacheRead ?? 0),
            cacheCreation:
              totals.tokens.cacheCreation + (turn.tokens.cacheCreation ?? 0),
          },
          messageCount: totals.messageCount + 1,
        },
      });
      return next;
    });
  }

  /** Drop a session's record. Called when its surface is torn down. */
  clear(sessionId: string): void {
    this._bySession.update((prev) => {
      if (!prev.has(sessionId)) return prev;
      const next = new Map(prev);
      next.delete(sessionId);
      return next;
    });
  }
}
