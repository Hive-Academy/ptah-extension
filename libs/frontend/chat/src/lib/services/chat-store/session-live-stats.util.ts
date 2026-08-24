import {
  pickPrimaryModel,
  type ModelUsageEntry as CostRankedModelUsage,
} from '@ptah-extension/shared';
import type { LiveModelStatsPayload } from '@ptah-extension/chat-state';

/** One model's slice of a `session:stats` turn, as the backend sends it. */
export interface TurnModelUsage {
  readonly model: string;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly contextWindow: number;
  readonly costUSD: number;
  readonly cacheReadInputTokens?: number;
  readonly lastTurnContextTokens?: number;
}

export interface DerivedLiveStats {
  /** The model the header should name — sticky pick, else highest cost. */
  readonly primaryModel: TurnModelUsage;
  /**
   * Context fill for the primary model, or null when it could not be computed
   * HONESTLY (see `suppressed`). Null means "leave whatever is displayed
   * alone", never "zero".
   */
  readonly live: LiveModelStatsPayload | null;
  /**
   * True when a context-fill figure was deliberately withheld: the turn
   * reported no `lastTurnContextTokens`, so the only available number is the
   * session's CUMULATIVE token count, and that is not a context fill once the
   * conversation has compacted or once the cumulative sum has run past the
   * window. Publishing it anyway is what produced ">100% full" headers.
   */
  readonly suppressed: boolean;
}

/**
 * Derive the header's live model stats from one turn's per-model usage.
 *
 * Extracted so tabs and non-tab surfaces cannot drift. Both call this; the only
 * difference is where each gets `stickyModel` and `hasCompacted` from (a
 * `TabState` for one, the `ConversationRegistry` record for the other), which is
 * exactly the part that legitimately differs.
 *
 * Pure: no signals, no injection, no clock.
 */
export function deriveLiveModelStats(
  modelUsage: readonly TurnModelUsage[],
  opts: {
    readonly stickyModel?: string | null;
    readonly hasCompacted: boolean;
  },
): DerivedLiveStats | null {
  if (modelUsage.length === 0) return null;

  const ranked: CostRankedModelUsage[] = modelUsage.map((m) => ({
    model: m.model,
    totalCost: m.costUSD,
    tokens: {
      input: m.inputTokens,
      output: m.outputTokens,
      cacheRead: m.cacheReadInputTokens,
    },
  }));
  // A sticky pick only counts if the model actually appears in this turn —
  // otherwise the header would name a model that contributed nothing.
  const sticky =
    opts.stickyModel && modelUsage.some((m) => m.model === opts.stickyModel)
      ? opts.stickyModel
      : null;
  const primaryModelName = sticky ?? pickPrimaryModel(ranked);
  const primaryModel =
    modelUsage.find((m) => m.model === primaryModelName) ?? modelUsage[0];

  const useCumulativeFallback = primaryModel.lastTurnContextTokens == null;
  const cumulativeFallback =
    primaryModel.inputTokens +
    (primaryModel.cacheReadInputTokens ?? 0) +
    primaryModel.outputTokens;
  const cumulativeExceedsWindow =
    primaryModel.contextWindow > 0 &&
    cumulativeFallback > primaryModel.contextWindow;
  const suppressed =
    useCumulativeFallback && (opts.hasCompacted || cumulativeExceedsWindow);

  if (suppressed) {
    return { primaryModel, live: null, suppressed: true };
  }

  const contextUsed =
    primaryModel.lastTurnContextTokens != null
      ? primaryModel.lastTurnContextTokens
      : cumulativeFallback;
  const contextPercent =
    primaryModel.contextWindow > 0
      ? Math.round((contextUsed / primaryModel.contextWindow) * 1000) / 10
      : 0;

  return {
    primaryModel,
    live: {
      model: primaryModel.model,
      contextUsed,
      contextWindow: primaryModel.contextWindow,
      contextPercent,
    },
    suppressed: false,
  };
}
