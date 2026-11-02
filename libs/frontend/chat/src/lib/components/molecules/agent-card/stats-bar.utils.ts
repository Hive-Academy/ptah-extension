import {
  addCliUsage,
  isValidTokenCount,
  type CliOutputSegment,
} from '@ptah-extension/shared';

export type CliAgentStats = NonNullable<CliOutputSegment['usage']>;
export type PartialUsageTotals = Pick<CliAgentStats, 'inputTokens' | 'outputTokens' | 'totalTokens' | 'costUsd'> & { readonly partial: true };

/**
 * Format a token count for compact display.
 * Returns "1.2k" for counts >= 1000, raw number string otherwise.
 */
export function formatTokens(count: number): string {
  if (count >= 1000) {
    return `${(count / 1000).toFixed(1)}k`;
  }
  return count.toString();
}

/** Shown in place of a value the provider did not report — never 0. */
export const NOT_REPORTED = '—';

/** {@link formatTokens}, or {@link NOT_REPORTED} when the count is missing. */
export function formatOptionalTokens(count: number | undefined): string {
  return isValidTokenCount(count) ? formatTokens(count) : NOT_REPORTED;
}

/**
 * Format an estimated USD cost as "~$x.xx est.". `null` (the model has no
 * price) and `undefined` (no usage or model reported) both render as
 * {@link NOT_REPORTED}.
 */
export function formatEstimatedCost(
  costUsd: number | null | undefined,
): string {
  if (costUsd === null || costUsd === undefined) return NOT_REPORTED;
  return `~$${costUsd.toFixed(2)} est.`;
}

export function isUsageSegment(segment: CliOutputSegment): boolean {
  return segment.type === 'info' && segment.usage !== undefined;
}

/**
 * Sum per-turn tokens; keep the latest reported model, cost and duration.
 * Delegates to the shared `addCliUsage` fold, the single definition of lane
 * usage summing.
 */
export function extractCliAgentStats(
  segments: readonly CliOutputSegment[],
): CliAgentStats | null {
  return segments.reduce<CliAgentStats | null>(
    (stats, { usage }) => addCliUsage(stats, usage),
    null,
  );
}

/**
 * Returns only token and cost totals that are safe to fold from retained segments;
 * context and cache fields are omitted on purpose and the result is partial (Req 8.4).
 */
export function usageTotalsFromSegments(
  segments: readonly CliOutputSegment[],
): PartialUsageTotals | null {
  const stats = extractCliAgentStats(segments);
  if (!stats) return null;
  const { inputTokens, outputTokens, totalTokens, costUsd } = stats;
  if ([inputTokens, outputTokens, totalTokens, costUsd].every((value) => value === undefined)) return null;
  return { inputTokens, outputTokens, totalTokens, costUsd, partial: true };
}
