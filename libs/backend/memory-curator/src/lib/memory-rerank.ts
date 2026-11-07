/**
 * Optional cross-encoder pass over RRF-fused memory rows.
 *
 * Bounded by the request deadline when there is one: with too little time
 * left it is skipped, and when the search worker's host sheds it (its single
 * rerank slot is busy) the RRF order stands. Both are `partial`: answered,
 * not cached as full quality. Only a real reranker failure is `failed`.
 */
import { HostCallSkippedError } from './search-worker-host-embedder';
import { BudgetExceededError, remainingMs, withinBudget } from './search-deadline';
import type { CuratorLogger } from './sqlite-reader-deps.types';

const MAX_CANDIDATE_CHARS = 512;
/** Least time left (ms) for which a deadline-bound search still reranks. */
const RERANK_MIN_BUDGET_MS = 1_000;

export interface Reranker {
  rerank(
    query: string,
    candidates: ReadonlyArray<{ id: string; text: string }>,
    topK: number,
    deadlineMs?: number,
  ): Promise<ReadonlyArray<{ id: string; score: number }>>;
}

export type RerankOutcome = 'reranked' | 'partial' | 'failed';

interface RerankEntry {
  readonly row: { readonly rowid: number; readonly text: string };
}

export async function rerankFused<E extends RerankEntry>(
  reranker: Reranker,
  query: string,
  fused: E[],
  limit: number,
  deadlineMs: number | undefined,
  logger: CuratorLogger,
): Promise<{ readonly fused: E[]; readonly outcome: RerankOutcome }> {
  const remaining = remainingMs(deadlineMs);
  if (remaining <= RERANK_MIN_BUDGET_MS) {
    logger.debug('[memory-curator] too little time left to rerank; using RRF order', { remainingMs: remaining });
    return { fused, outcome: 'partial' };
  }
  try {
    const rerankInput = fused.slice(0, limit * 4).map((e) => ({
      id: String(e.row.rowid),
      text: e.row.text.length > MAX_CANDIDATE_CHARS ? e.row.text.slice(0, MAX_CANDIDATE_CHARS) : e.row.text,
    }));
    const ranked = await withinBudget(reranker.rerank(query, rerankInput, limit, deadlineMs), remaining - 200, 'rerank');
    const byId = new Map(fused.map((e) => [String(e.row.rowid), e]));
    const reranked = ranked.map((r) => byId.get(r.id)).filter((e): e is E => e !== undefined);
    return { fused: reranked.length > 0 ? reranked : fused, outcome: 'reranked' };
  } catch (err: unknown) {
    if (err instanceof BudgetExceededError) {
      logger.debug('[memory-curator] rerank missed deadline; using RRF order');
      return { fused, outcome: 'partial' };
    }
    if (err instanceof HostCallSkippedError) {
      // Load shedding of an optional pass, not a failure: the host runs one
      // rerank at a time, and this answer is not cached.
      logger.debug('[memory-curator] host reranker busy; using RRF order');
      return { fused, outcome: 'partial' };
    }
    logger.warn('[memory-curator] reranker failed; using RRF order', {
      error: err instanceof Error ? err.message : String(err),
    });
    return { fused, outcome: 'failed' };
  }
}
