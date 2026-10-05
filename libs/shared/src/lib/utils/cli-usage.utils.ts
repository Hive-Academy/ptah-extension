/**
 * CLI lane usage fold (TASK_2026_596, Decision 8).
 *
 * The one definition of "sum lane usage", shared by the agent card, the lane
 * stats tiles and the agent monitor store. Folding is incremental so a store
 * can fold each segment as it arrives and later drop old segments without
 * losing totals.
 */
import type { CliOutputSegment } from '../types/agent-process.types';

/** Accumulated usage of one CLI lane run. */
export type CliUsageTotals = NonNullable<CliOutputSegment['usage']>;

/**
 * Fold one usage report into the running totals.
 *
 * Token counts are summed; the latest reported model, cost and duration are
 * kept. A field no report has carried stays absent — never 0. A report with no
 * defined field is ignored, so the result stays `null` until any usage is
 * seen.
 */
export function addCliUsage(
  total: CliUsageTotals | null,
  usage: CliOutputSegment['usage'],
): CliUsageTotals | null {
  if (!usage || !Object.values(usage).some((value) => value !== undefined)) {
    return total;
  }
  const base: CliUsageTotals = total ?? {};
  return {
    model: usage.model ?? base.model,
    inputTokens: sumDefined(base.inputTokens, usage.inputTokens),
    outputTokens: sumDefined(base.outputTokens, usage.outputTokens),
    totalTokens: sumDefined(base.totalTokens, usage.totalTokens),
    costUsd: usage.costUsd ?? base.costUsd,
    durationMs: usage.durationMs ?? base.durationMs,
  };
}

function sumDefined(
  total: number | undefined,
  added: number | undefined,
): number | undefined {
  return added === undefined ? total : (total ?? 0) + added;
}
