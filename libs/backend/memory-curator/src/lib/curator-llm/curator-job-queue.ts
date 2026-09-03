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
 * waiting one level up, where it is ordered, unbounded in time, and loses
 * nothing. Throughput is identical. What changes is that a pass now holds its
 * position across all of its queries instead of re-entering the lottery between
 * each pair.
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
 * Serialises curation passes in submission order.
 *
 * A rejected job must not break the chain — `MemoryTriggerService` drains
 * several sessions and one failure may never take the others down — so the tail
 * is always the settled-either-way continuation, while the caller receives the
 * real promise and sees the real rejection.
 */
export class CuratorJobQueue {
  private tail: Promise<unknown> = Promise.resolve();
  private depth = 0;

  /** Passes submitted and not yet settled, including the running one. */
  get pending(): number {
    return this.depth;
  }

  /** Run `job` once every pass submitted before it has settled. */
  run<T>(job: () => Promise<T>): Promise<T> {
    this.depth++;
    const started = this.tail.then(job);
    this.tail = started.then(
      () => undefined,
      () => undefined,
    );
    const settle = (): void => {
      this.depth--;
    };
    void started.then(settle, settle);
    return started;
  }
}
