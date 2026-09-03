/**
 * Recognising the one internal-query failure that means "this pass never
 * reached the model" — TASK_2026_376 F4.
 *
 * `InternalQueryService` gates every one-shot query behind a FIFO concurrency
 * gate with a global ceiling of 2 and a per-lane ceiling of 1. A waiter that
 * does not reach the front within `ptah.internalQuery.queueTimeoutMs` (60 s) is
 * removed from the queue and rejected with `InternalQueryQueueTimeoutError`.
 * That rejection is NOT a failed curation: no prompt was sent, no quota was
 * spent, and the transcript is exactly where it was. It is congestion.
 *
 * ## Why the name, and not `instanceof`
 *
 * The error class lives in `@ptah-extension/agent-sdk`, which depends on this
 * lib through the curator port. Importing it here would close the cycle. The
 * adapter that raises it already matches `ProviderAuthError` and
 * `ProviderQuotaError` by `name` for the same reason, and states the rule: the
 * constant is kept in sync with the class it mirrors. This file follows that
 * convention rather than inventing a second one.
 *
 * ## Why the chain is walked
 *
 * `SdkInternalQueryCuratorLlm.runQuery` catches everything and re-throws
 * `CuratorLlmQueryError('The memory curator could not complete its
 * language-model query.', { cause: error })`. The queue timeout is therefore
 * never the outer error on the curator's path — it is always one `cause` down.
 * The walk is depth-bounded because an error chain is caller-supplied data and
 * a cycle in it must not hang the curator.
 */

/** Mirrors `InternalQueryQueueTimeoutError.name` in `@ptah-extension/agent-sdk`. */
export const QUEUE_SLOT_TIMEOUT_ERROR_NAME = 'InternalQueryQueueTimeoutError';

/** How far down a `cause` chain the name is looked for. */
const MAX_CAUSE_DEPTH = 8;

/** Whether `error`, or anything it wraps, is an internal-query queue timeout. */
export function isQueueSlotTimeout(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < MAX_CAUSE_DEPTH; depth++) {
    if (!(current instanceof Error)) return false;
    if (current.name === QUEUE_SLOT_TIMEOUT_ERROR_NAME) return true;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

/**
 * How many queue-slot timeouts ONE curation pass may absorb before it defers.
 *
 * Two. A retry costs nothing upstream — the query never dispatched — and the
 * gate is FIFO, so the retried call takes the next free slot in its lane rather
 * than spinning. The wait IS the backoff, which is why there is no timer here.
 *
 * The budget is per PASS, not per window, and that is the point: an eight-window
 * transcript that keeps losing its slot is a congested host, and paying eight
 * separate 60 s waits to discover that is the cost this bound exists to refuse.
 * When the budget is gone the pass defers, its input is left untouched, and the
 * next drain curates it.
 */
export const CURATOR_QUEUE_RETRY_BUDGET = 2;

/**
 * The retry allowance of one curation pass, shared by every query it makes.
 *
 * One object rather than a counter per call site so the extract windows and the
 * resolve call spend the SAME allowance. Two independent counters would let a
 * pass wait `budget × (windows + 1)` times in the worst case, which is the
 * unbounded wait wearing a bound.
 */
export class QueueSlotRetryBudget {
  private used = 0;

  constructor(private readonly limit: number = CURATOR_QUEUE_RETRY_BUDGET) {}

  /** Spend one retry. Returns false when the allowance is exhausted. */
  tryConsume(): boolean {
    if (this.used >= this.limit) return false;
    this.used++;
    return true;
  }

  /** Retries spent so far. Reported in the deferral log line. */
  get spent(): number {
    return this.used;
  }
}
