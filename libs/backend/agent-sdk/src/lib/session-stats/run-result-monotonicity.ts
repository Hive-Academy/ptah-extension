/**
 * Monotonicity of one query run's cumulative SDK results: whether a newly
 * offered result repeats the run's accepted value ({@link isSameUsage}) or
 * continues its running total ({@link isGrown}). Pure predicates over
 * {@link RunUsageResult}; the owner service decides what to do with them.
 */

import type { RunUsageResult } from './session-stats-owner.service';

/**
 * Whether two results of one run agree on dollars as well as tokens.
 *
 * Only when BOTH are `'unreported'` are the dollars left out: such a run's
 * dollars are the rate card applied to its tokens, not an observation, so a
 * rate change alone is not new usage. A mixed pair keeps the stricter
 * (dollar) comparison.
 */
function dollarsAreObserved(a: RunUsageResult, b: RunUsageResult): boolean {
  return a.costSource !== 'unreported' || b.costSource !== 'unreported';
}

/**
 * `b` repeats `a`: the same models with the same token counters.
 *
 * `'reported'` run: the dollars (total and per model) must match too.
 * `'unreported'` run: tokens only, so identical tokens repriced at a new rate
 * are a `duplicate` — not published, and the snapshot keeps the run priced at
 * the rate card in force at its latest ACCEPTED result.
 */
export function isSameUsage(a: RunUsageResult, b: RunUsageResult): boolean {
  const withDollars = dollarsAreObserved(a, b);
  if (withDollars && a.totalCost !== b.totalCost) return false;
  if (a.models.length !== b.models.length) return false;
  const byModel = new Map(a.models.map((m) => [m.model, m]));
  return b.models.every((m) => {
    const prev = byModel.get(m.model);
    return (
      prev !== undefined &&
      prev.inputTokens === m.inputTokens &&
      prev.outputTokens === m.outputTokens &&
      prev.cacheRead === m.cacheRead &&
      prev.cacheCreation === m.cacheCreation &&
      (!withDollars || prev.costUSD === m.costUSD)
    );
  });
}

/**
 * `next` continues `prev`'s running total: every model `prev` reported is
 * still present and no token counter went down. Models new in `next` are
 * allowed.
 *
 * `'reported'` run: no known cost (total or per model) may go down either —
 * the SDK's dollars are authoritative and cumulative.
 *
 * `'unreported'` run: the token counters are the only authority; `totalCost`
 * and per-model `costUSD` are ignored. The dollars are the rate card applied
 * to the tokens, and the runtime rate card can change mid-run (a provider
 * catalog hydration re-registers it), so a rate drop would otherwise reject
 * every later result and freeze the snapshot. Policy: an unreported run's
 * total is priced at the rate card in force at its latest accepted result
 * (`subtractRunBase` reprices its net tokens with each row's rate), and
 * a turn whose run cost went down has an unknown cost
 * (`acceptedTurnCost`: `turnCost` null, `runCostDecreased` true).
 *
 * A mixed pair of cost sources keeps the stricter (dollar) check.
 */
export function isGrown(prev: RunUsageResult, next: RunUsageResult): boolean {
  const withDollars = dollarsAreObserved(prev, next);
  if (
    withDollars &&
    prev.totalCost !== null &&
    next.totalCost !== null &&
    next.totalCost < prev.totalCost
  ) {
    return false;
  }
  const byModel = new Map(next.models.map((m) => [m.model, m]));
  return prev.models.every((m) => {
    const grown = byModel.get(m.model);
    return (
      grown !== undefined &&
      grown.inputTokens >= m.inputTokens &&
      grown.outputTokens >= m.outputTokens &&
      grown.cacheRead >= m.cacheRead &&
      grown.cacheCreation >= m.cacheCreation &&
      (!withDollars ||
        m.costUSD === null ||
        grown.costUSD === null ||
        grown.costUSD >= m.costUSD)
    );
  });
}
