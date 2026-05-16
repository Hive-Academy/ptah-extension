/**
 * pickPrimaryModel — deterministic primary-model selection.
 *
 * Centralizes the "which model is the user's primary?"
 * decision used by both the live SESSION_STATS aggregator
 * (frontend/chat/.../session-stats-aggregator.service.ts) and the
 * post-compaction history reader
 * (backend/agent-sdk/.../session-history-reader.service.ts).
 *
 * Both paths historically picked the highest-cost model but tied costs
 * resolved differently (insertion order vs. sort-stability), so the
 * displayed model name could flip between Opus / Haiku / Sonnet across a
 * compaction boundary even when the underlying usage was unchanged.
 *
 * Algorithm (strictly deterministic):
 *   1. Highest `totalCost` wins.
 *   2. Tie-break by total tokens (input + output + cacheRead + cacheCreation),
 *      descending.
 *   3. Final tie-break by model name, lexicographic ascending.
 *
 * Returns null on an empty array. Pure function — no side effects, no
 * workspace imports. Safe to consume from any layer.
 */

export interface ModelUsageEntry {
  readonly model: string;
  readonly totalCost: number;
  readonly tokens?: {
    readonly input?: number;
    readonly output?: number;
    readonly cacheRead?: number;
    readonly cacheCreation?: number;
  };
}

function totalTokens(entry: ModelUsageEntry): number {
  const t = entry.tokens;
  if (!t) return 0;
  return (
    (t.input ?? 0) +
    (t.output ?? 0) +
    (t.cacheRead ?? 0) +
    (t.cacheCreation ?? 0)
  );
}

export function pickPrimaryModel(
  usage: readonly ModelUsageEntry[],
): string | null {
  if (usage.length === 0) return null;

  let best = usage[0];
  for (let i = 1; i < usage.length; i++) {
    const candidate = usage[i];
    if (candidate.totalCost > best.totalCost) {
      best = candidate;
      continue;
    }
    if (candidate.totalCost < best.totalCost) continue;

    // Cost tie — break by total tokens (descending).
    const candidateTokens = totalTokens(candidate);
    const bestTokens = totalTokens(best);
    if (candidateTokens > bestTokens) {
      best = candidate;
      continue;
    }
    if (candidateTokens < bestTokens) continue;

    // Token tie — break by model name (lexicographic ascending) for
    // cross-path determinism.
    if (candidate.model < best.model) {
      best = candidate;
    }
  }

  return best.model;
}
