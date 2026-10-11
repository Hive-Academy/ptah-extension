import {
  normalizeModelKey,
  type SessionStatsLiveContext,
} from '@ptah-extension/shared';
import type { LiveModelStatsPayload } from './tab-state.types';

/**
 * The prior live reading with `tokens` as its context fill, or `null` when
 * there is no prior reading for a named model or `tokens` is not a positive
 * finite count.
 *
 * The window is the prior reading's own capacity, used only when that
 * capacity names the same model and comes from a trusted source (SDK-native,
 * or a provider catalog with a provider id); otherwise the window is unknown
 * (`0`) and the percent is `0`.
 */
export function contextFillStats(
  prior: LiveModelStatsPayload | null | undefined,
  tokens: number | undefined,
): LiveModelStatsPayload | null {
  if (
    typeof tokens !== 'number' ||
    !Number.isFinite(tokens) ||
    tokens <= 0 ||
    prior == null ||
    prior.model.length === 0
  ) {
    return null;
  }
  const capacity = prior.contextCapacity;
  const contextWindow =
    capacity &&
    capacity.model === prior.model &&
    (capacity.source === 'sdk-native' ||
      (capacity.source === 'provider-catalog' &&
        typeof capacity.providerId === 'string' &&
        capacity.providerId.length > 0)) &&
    typeof capacity.tokens === 'number' &&
    Number.isFinite(capacity.tokens) &&
    capacity.tokens > 0
      ? capacity.tokens
      : 0;
  return {
    model: prior.model,
    contextKnown: true,
    contextCapacity: capacity,
    contextUsed: tokens,
    contextWindow,
    contextPercent:
      contextWindow > 0 ? Math.round((tokens / contextWindow) * 1000) / 10 : 0,
  };
}

/**
 * The live reading a `session:stats-live` estimate's `context` implies for a
 * tab (TASK_2026_626): the tab's prior reading with the estimate's fill, or
 * `null` when the tab shows no reading for the same model (compared with
 * `normalizeModelKey`) or the fill is not a positive count.
 */
export function liveContextStats(
  prior: LiveModelStatsPayload | null | undefined,
  context: SessionStatsLiveContext,
): LiveModelStatsPayload | null {
  if (
    !prior ||
    normalizeModelKey(prior.model) !== normalizeModelKey(context.model)
  ) {
    return null;
  }
  return contextFillStats(prior, context.contextTokens);
}
