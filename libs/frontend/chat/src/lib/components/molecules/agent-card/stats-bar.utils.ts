import type { CliOutputSegment } from '@ptah-extension/shared';

export type CliAgentStats = NonNullable<CliOutputSegment['usage']>;

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

/**
 * Format a duration in milliseconds for display.
 * Returns "250ms", "2.3s", or "1m 5s" depending on magnitude.
 */
export function formatDuration(ms: number): string {
  if (ms < 1000) {
    return `${ms}ms`;
  }
  const seconds = ms / 1000;
  if (seconds < 60) {
    return `${seconds.toFixed(1)}s`;
  }
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.round(seconds % 60);
  return `${minutes}m ${remainingSeconds}s`;
}

export function isUsageSegment(segment: CliOutputSegment): boolean {
  return segment.type === 'info' && segment.usage !== undefined;
}

/** Sum per-turn tokens; keep the latest reported model, cost and duration. */
export function extractCliAgentStats(
  segments: readonly CliOutputSegment[],
): CliAgentStats | null {
  let stats: CliAgentStats = {};
  let found = false;
  for (const { usage } of segments) {
    if (!usage || !Object.values(usage).some((value) => value !== undefined))
      continue;
    found = true;
    stats = {
      model: usage.model ?? stats.model,
      inputTokens:
        usage.inputTokens === undefined
          ? stats.inputTokens
          : (stats.inputTokens ?? 0) + usage.inputTokens,
      outputTokens:
        usage.outputTokens === undefined
          ? stats.outputTokens
          : (stats.outputTokens ?? 0) + usage.outputTokens,
      totalTokens:
        usage.totalTokens === undefined
          ? stats.totalTokens
          : (stats.totalTokens ?? 0) + usage.totalTokens,
      costUsd: usage.costUsd ?? stats.costUsd,
      durationMs: usage.durationMs ?? stats.durationMs,
    };
  }
  return found ? stats : null;
}
