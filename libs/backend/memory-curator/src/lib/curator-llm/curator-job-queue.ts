/**
 * One curation pass at a time — TASK_2026_376 F4.
 *
 * ## The defect
 *
 * A transcript becomes up to eight windows, and each window is a SEPARATE
 * one-shot query on the `memory-curator` internal-query lane. The lane admits
 * one query at a time, and `CuratorWindowRunner` spends the windows
 * sequentially, so a pass releases its slot between window N and window N+1.
 *
 * That gap is the fault. When a SECOND curation pass is waiting in the lane —
 * a boot scan session while a PreCompact runs, two triggers on two sessions —
 * the gate's FIFO scan admits the waiter the instant window N releases, and
 * window N+1 goes to the back of the queue behind a whole competing query. Wait
 * longer than `ptah.internalQuery.queueTimeoutMs` (60 s) and the waiter is
 * rejected with `InternalQueryQueueTimeoutError`. Observed on 2026-09-03: one
 * session split into three windows, and two OTHER sessions
 * (`ff10bd1d-…`, `83aca9e8-…`) reported `extracted: 0` with their observation
 * rows already marked processed.
 *
 * ## Why serialising here costs nothing
 *
 * `lane: 'memory-curator'` has exactly one call site in the repository
 * (`SdkInternalQueryCuratorLlm.runQuery`) and a per-lane ceiling of one, so two
 * curation passes were ALREADY serialised — by the gate, one query at a time,
 * with a destructive 60 s ceiling on each wait. This queue moves that same
 * waiting one level up, where it is ordered and loses nothing. Throughput is
 * identical. What changes is that a pass now holds its position across all of
 * its queries instead of re-entering the lottery between each pair. The wait
 * itself is bounded by {@link CURATOR_QUEUE_WAIT_CEILING_MS}, and a pass that
 * exceeds it is DEFERRED rather than dropped.
 *
 * ## What this is not
 *
 * It is not a second semaphore over the internal-query gate. It admits nothing
 * and counts no slots; it is a promise chain over the curator's OWN jobs, and
 * every query it lets through still faces the one gate with the one admission
 * predicate. Raising `maxConcurrentPerLane` was the forbidden fix here
 * (TASK_2026_352): it would let the curator claim both global slots and starve
 * skill-synthesis, which is the coupling the lanes exist to remove.
 */

/**
 * How long a submitted pass may wait for its turn before it gives up —
 * TASK_2026_376 R1, logic finding 3.
 *
 * The chain above has no depth limit, and `curate()` is called by the
 * `memory:runNow` RPC with no `AbortSignal`, so a user-triggered pass could sit
 * behind an arbitrary number of background passes with no ceiling and nothing
 * to cancel it. The user sees a spinner that the code cannot end.
 *
 * Three minutes is chosen against the measured cost of ONE pass ahead. A
 * 372-event session split into the full eight windows measured 24-37 s per
 * window (TASK_2026_374), so the ordinary one-or-two-window pass clears in well
 * under a minute and a waiter behind it is never rejected. A waiter behind the
 * eight-window worst case, or behind two passes, does time out — and that is
 * the intended answer, not a regression: a timed-out waiter reports the same
 * `stalled` outcome the concurrency gate does, so its observations are left
 * untouched and the next drain curates them.
 */
export const CURATOR_QUEUE_WAIT_CEILING_MS = 180_000;

/**
 * A pass gave up waiting for its turn in {@link CuratorJobQueue}.
 *
 * Its own class rather than a bare `Error` so `MemoryCuratorService.curate` can
 * tell it from a job that ran and threw. The two mean opposite things about the
 * caller's input: this one never dispatched.
 */
export class CuratorQueueWaitTimeoutError extends Error {
  constructor(readonly waitedMs: number) {
    super(
      `A curation pass waited longer than ${waitedMs}ms for its turn in the curator job queue.`,
    );
    this.name = 'CuratorQueueWaitTimeoutError';
  }
}

/**
 * Serialises curation passes in submission order.
 *
 * A rejected job must not break the chain — `MemoryTriggerService` drains
 * several sessions and one failure may never take the others down — so the tail
 * settles either way, while the caller gets the real value or the real rejection
 * on a promise of its own.
 */
export class CuratorJobQueue {
  private tail: Promise<unknown> = Promise.resolve();
  private depth = 0;

  constructor(
    private readonly waitCeilingMs: number = CURATOR_QUEUE_WAIT_CEILING_MS,
  ) {}

  /**
   * Passes submitted and not yet settled, including the running one.
   *
   * A pass that gave up on the wait ceiling is settled — its caller has its
   * answer — even though the chain still holds its position until its turn
   * comes and is skipped.
   */
  get pending(): number {
    return this.depth;
  }

  /**
   * Run `job` once every pass submitted before it has settled, or reject with
   * {@link CuratorQueueWaitTimeoutError} when its turn does not arrive within
   * the wait ceiling.
   *
   * The ceiling rejects the CALLER without breaking the chain, and that split is
   * the whole of the implementation. The chain still waits for its predecessor,
   * so the next pass starts only after this one's position is free — answering
   * a caller early must not let two passes run at once. What a timeout changes
   * is that the job is never invoked when its turn finally comes: a pass nobody
   * is waiting for any more is not worth a provider call.
   */
  run<T>(job: () => Promise<T>): Promise<T> {
    this.depth++;
    let resolveCaller!: (value: T | PromiseLike<T>) => void;
    let rejectCaller!: (error: unknown) => void;
    const caller = new Promise<T>((resolve, reject) => {
      resolveCaller = resolve;
      rejectCaller = reject;
    });
    const release = (): void => {
      this.depth--;
    };
    void caller.then(release, release);

    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      rejectCaller(new CuratorQueueWaitTimeoutError(this.waitCeilingMs));
    }, this.waitCeilingMs);
    // Never hold a host open on a queue that is only waiting.
    (timer as { unref?: () => void }).unref?.();

    // The chain always waits for its predecessor, whatever the caller was told.
    // A queue that let the next pass start because THIS one's caller gave up
    // would run two passes at once, which is the property the queue exists to
    // hold. It also never rejects — a failing job is reported to its own caller
    // — so one bad pass cannot take the queue down with it.
    this.tail = this.tail.then(() => {
      clearTimeout(timer);
      if (timedOut) return undefined;
      try {
        const running = job();
        resolveCaller(running);
        return running.then(
          () => undefined,
          () => undefined,
        );
      } catch (error: unknown) {
        rejectCaller(error);
        return undefined;
      }
    });
    return caller;
  }
}
