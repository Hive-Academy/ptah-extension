/**
 * The resolve call's candidate list: tier 1 (exact subject matches) followed by
 * a bounded, workspace-scoped tier 2 of semantic search hits (TASK_2026_563 M3).
 *
 * Constructed by {@link MemoryCuratorService} rather than injected, like
 * `CuratorWindowRunner`: no lifecycle, no alternative implementation and no
 * other consumer, so a DI token would be a registration to maintain for
 * nothing. Not exported from the lib barrel. Because the service is a
 * singleton, so is this collector, which is what makes its circuit breaker a
 * host-wide property.
 *
 * Read-only by construction: it never calls `recordUse` and never writes
 * salience, and `searchRich` has no write path, so collecting candidates cannot
 * change the ranking of the rows it looks at.
 */
import type { Logger } from '@ptah-extension/vscode-core';
import type { ExtractedMemoryDraft } from './curator-llm.interface';
import type { MemoryStore } from '../memory.store';
import type { MemorySearchService } from '../memory-search.service';
import type { MemorySearchResponse } from '../memory.types';

/** Tier-2 hits kept per draft; mirrors tier 1's 5 rows per subject. */
export const TIER2_PER_DRAFT_LIMIT = 5;
/** Tier-2 rows kept per pass; the worst-case prompt is 50 + 25 = 75 rows. */
export const TIER2_TOTAL_LIMIT = 25;
/** `searchRich` calls per pass, which bounds embed and rerank work. */
export const TIER2_MAX_QUERIES = 10;
/** Query length; equals the reranker's candidate clip in `MemorySearchService`. */
export const TIER2_QUERY_MAX_CHARS = 512;
/**
 * Wall-clock budget for all of one pass's tier-2 queries. Tier 2 runs inside a
 * pass that already spends its extract windows (24-37 s each when measured,
 * TASK_2026_374) and one resolve call on the one-at-a-time curator queue, and a
 * pass queued behind it waits at most 180 s (`CURATOR_QUEUE_WAIT_CEILING_MS`).
 * 20 s keeps tier 2 a small, fixed share of that ceiling while leaving ten warm
 * queries (each well under a second: one local embed, a KNN, two SQL reads and
 * a rerank) far more time than they need.
 */
export const TIER2_PASS_BUDGET_MS = 20_000;
/**
 * Deadline for one `searchRich` call, further capped by what remains of
 * {@link TIER2_PASS_BUDGET_MS}. 8 s absorbs a cold model load (the models are
 * normally already warm from boot) without letting one hung query take the
 * whole pass budget.
 */
export const TIER2_QUERY_TIMEOUT_MS = 8_000;
/**
 * After a query is abandoned at its deadline, tier 2 is skipped for this long.
 * An abandoned query cannot be cancelled and keeps its embed request queued in
 * the embedder; without the pause a hung embedder would gain one more abandoned
 * request every pass.
 */
export const TIER2_COOLDOWN_AFTER_TIMEOUT_MS = 5 * 60_000;

export interface MergeCandidate {
  readonly id: string;
  readonly subject: string | null;
  readonly content: string;
}

/**
 * Why tier 2 stopped short (`null` when it ran to its bounds or an abort).
 * - `'no-search'`, `'blank-workspace'`, `'tier1-empty'`, `'abandoned-pending'`
 *   and `'cooldown'`: it never ran. `'abandoned-pending'` means a query an
 *   earlier pass abandoned (deadline or abort) has not settled yet;
 *   `'cooldown'` means the breaker is open after an earlier timeout.
 * - `'error'`: a query threw.
 * - `'timeout'`: a query missed {@link TIER2_QUERY_TIMEOUT_MS}.
 * - `'budget'`: {@link TIER2_PASS_BUDGET_MS} ran out, between queries or by
 *   cutting a query short.
 *
 * In the last three, the tier-2 rows collected before the stop are returned.
 */
export type Tier2SkipReason =
  | 'no-search'
  | 'blank-workspace'
  | 'tier1-empty'
  | 'abandoned-pending'
  | 'cooldown'
  | 'error'
  | 'timeout'
  | 'budget';

type Tier2QueryOutcome =
  | { readonly kind: 'response'; readonly response: MemorySearchResponse }
  | { readonly kind: 'timeout' }
  | { readonly kind: 'aborted' };

/**
 * One tier-2 query raced against `deadlineMs` and the pass's abort signal. A
 * rejection before either still throws to the caller. The query itself cannot
 * be cancelled, so a late settlement is observed and dropped; the timer and the
 * abort listener are released on every path.
 */
function raceTier2Query(
  query: Promise<MemorySearchResponse>,
  deadlineMs: number,
  signal: AbortSignal | undefined,
): Promise<Tier2QueryOutcome> {
  // degradation-audit: optional-capability - the query cannot be cancelled; a
  // rejection that lands after the deadline or the abort is observed here and
  // dropped. A rejection that wins the race still reaches the caller's catch
  // through the `then` below.
  query.catch(() => undefined);
  if (signal?.aborted) return Promise.resolve({ kind: 'aborted' });
  let timer: ReturnType<typeof setTimeout> | undefined;
  let onAbort: (() => void) | undefined;
  const stop = new Promise<Tier2QueryOutcome>((resolve) => {
    timer = setTimeout(() => resolve({ kind: 'timeout' }), deadlineMs);
    onAbort = () => resolve({ kind: 'aborted' });
    signal?.addEventListener('abort', onAbort, { once: true });
  });
  return Promise.race([
    query.then((response): Tier2QueryOutcome => ({
      kind: 'response',
      response,
    })),
    stop,
  ]).finally(() => {
    clearTimeout(timer);
    if (onAbort) signal?.removeEventListener('abort', onAbort);
  });
}

export interface MergeCandidateSet {
  readonly candidates: readonly MergeCandidate[];
  readonly tier1Count: number;
  readonly tier2Count: number;
  readonly tier2Queries: number;
  readonly bm25Only: boolean;
  readonly tier2Skipped: Tier2SkipReason | null;
}

export class MergeCandidateCollector {
  /** Epoch ms until which tier 2 is skipped; `null` while the breaker is closed. */
  private cooldownUntil: number | null = null;
  /**
   * The last query abandoned at a deadline or an abort, until it settles. It
   * cannot be cancelled, so while it is outstanding tier 2 issues nothing new:
   * a hung embedder holds at most one abandoned request from this collector.
   */
  private abandoned: Promise<MemorySearchResponse> | null = null;

  constructor(
    private readonly logger: Logger,
    private readonly store: MemoryStore,
    private readonly search: MemorySearchService | null,
    /** The clock for the pass budget and the cooldown; injectable for specs. */
    private readonly now: () => number = Date.now,
  ) {}

  /**
   * Tier 1 first, in its own order and never displaced; tier-2 hits after it,
   * deduplicated by id. Tier-2 failures never fail the pass: the result is
   * tier 1 plus whatever tier 2 collected before the failure.
   */
  async collect(
    drafts: readonly ExtractedMemoryDraft[],
    workspaceRoot: string | null | undefined,
    signal?: AbortSignal,
  ): Promise<MergeCandidateSet> {
    const scope = workspaceRoot ?? null;
    const subjects = new Set(
      drafts.map((d) => d.subject).filter((s): s is string => !!s),
    );
    const tier1 =
      subjects.size > 0
        ? this.store.findMergeCandidates([...subjects], scope)
        : [];
    const tier1Only = (
      tier2Skipped: Tier2SkipReason | null,
    ): MergeCandidateSet => ({
      candidates: tier1,
      tier1Count: tier1.length,
      tier2Count: 0,
      tier2Queries: 0,
      bm25Only: false,
      tier2Skipped,
    });

    if (this.search === null) return tier1Only('no-search');
    // A blank root names no exact scope; tier 2 must never widen to every
    // workspace, which is what `searchRich` does with `''`.
    if (workspaceRoot === '') return tier1Only('blank-workspace');
    // Gate 2 decision D4 = B: no exact-subject match means the resolver sees
    // an empty list and short-circuits exactly as before tier 2 existed.
    if (tier1.length === 0) return tier1Only('tier1-empty');
    // Checked before the cooldown clock, so the breaker can only close once
    // the abandoned query has settled as well.
    if (this.abandoned !== null) return tier1Only('abandoned-pending');
    if (this.inCooldown()) return tier1Only('cooldown');

    const seen = new Set(tier1.map((c) => c.id));
    const tier2: MergeCandidate[] = [];
    const startedAt = this.now();
    let queries = 0;
    let bm25Only = false;
    let tier2Skipped: Tier2SkipReason | null = null;

    for (const draft of drafts) {
      if (queries >= TIER2_MAX_QUERIES) break;
      if (tier2.length >= TIER2_TOTAL_LIMIT) break;
      if (signal?.aborted) break;
      const query = `${draft.subject ?? ''} ${draft.content}`
        .trim()
        .slice(0, TIER2_QUERY_MAX_CHARS);
      if (query.length === 0) continue;
      const remaining = TIER2_PASS_BUDGET_MS - (this.now() - startedAt);
      if (remaining <= 0) {
        this.logger.info(
          '[memory-curator] tier-2 pass budget spent; continuing with the candidates collected so far',
          { queries, collected: tier2.length, budgetMs: TIER2_PASS_BUDGET_MS },
        );
        tier2Skipped = 'budget';
        break;
      }
      const deadlineMs = Math.min(TIER2_QUERY_TIMEOUT_MS, remaining);
      queries++;
      try {
        const pending = this.search.searchRich(
          query,
          TIER2_PER_DRAFT_LIMIT,
          scope,
        );
        const outcome = await raceTier2Query(pending, deadlineMs, signal);
        if (outcome.kind !== 'response') this.trackAbandoned(pending);
        if (outcome.kind === 'aborted') break;
        if (outcome.kind === 'timeout') {
          tier2Skipped =
            deadlineMs < TIER2_QUERY_TIMEOUT_MS ? 'budget' : 'timeout';
          this.openBreaker(tier2Skipped, deadlineMs, queries, tier2.length);
          break;
        }
        const res = outcome.response;
        bm25Only ||= res.bm25Only;
        let takenForDraft = 0;
        for (const hit of res.hits) {
          if (takenForDraft >= TIER2_PER_DRAFT_LIMIT) break;
          if (tier2.length >= TIER2_TOTAL_LIMIT) break;
          const memory = hit.memory;
          if (seen.has(memory.id)) continue;
          // Defence in depth: the search is already scoped, but a row from
          // another workspace must never become a merge candidate.
          if (memory.workspaceRoot !== scope) continue;
          seen.add(memory.id);
          tier2.push({
            id: memory.id,
            subject: memory.subject,
            content: memory.content,
          });
          takenForDraft++;
        }
      } catch (error: unknown) {
        // degradation-audit: optional-capability - tier 2 only widens the
        // resolve candidate list; on failure the pass keeps tier 1 plus the
        // rows already collected and stops issuing queries.
        this.logger.warn(
          '[memory-curator] tier-2 merge candidate search failed; continuing with the candidates collected so far',
          {
            queries,
            collected: tier2.length,
            error: error instanceof Error ? error.message : String(error),
          },
        );
        tier2Skipped = 'error';
        break;
      }
    }

    return {
      candidates: [...tier1, ...tier2],
      tier1Count: tier1.length,
      tier2Count: tier2.length,
      tier2Queries: queries,
      bm25Only,
      tier2Skipped,
    };
  }

  /**
   * Hold `query` as the outstanding abandoned request until it settles either
   * way. Its rejection is already observed in `raceTier2Query`; the identity
   * check keeps an older settlement from clearing a newer entry.
   */
  private trackAbandoned(query: Promise<MemorySearchResponse>): void {
    this.abandoned = query;
    const clear = (): void => {
      if (this.abandoned === query) this.abandoned = null;
    };
    query.then(clear, clear);
  }

  /**
   * `true` while the breaker is open; closes (and logs once) when it expires.
   * Only reached when no abandoned query is pending, so closing needs both.
   */
  private inCooldown(): boolean {
    if (this.cooldownUntil === null) return false;
    if (this.now() < this.cooldownUntil) return true;
    this.cooldownUntil = null;
    this.logger.info(
      '[memory-curator] tier-2 merge candidate cooldown over; semantic candidates resume',
    );
    return false;
  }

  /**
   * A query was abandoned at its deadline and is still running somewhere, so
   * tier 2 pauses for {@link TIER2_COOLDOWN_AFTER_TIMEOUT_MS}. Logged once
   * here, once again when {@link inCooldown} closes it.
   */
  private openBreaker(
    cause: 'timeout' | 'budget',
    deadlineMs: number,
    queries: number,
    collected: number,
  ): void {
    this.cooldownUntil = this.now() + TIER2_COOLDOWN_AFTER_TIMEOUT_MS;
    this.logger.warn(
      '[memory-curator] tier-2 merge candidate search timed out; skipping tier 2 until the cooldown ends',
      {
        cause,
        deadlineMs,
        queries,
        collected,
        cooldownMs: TIER2_COOLDOWN_AFTER_TIMEOUT_MS,
      },
    );
  }
}
