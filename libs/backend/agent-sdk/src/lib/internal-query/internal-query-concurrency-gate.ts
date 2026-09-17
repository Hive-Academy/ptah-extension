/**
 * InternalQueryConcurrencyGate — the host-wide admission gate for one-shot
 * internal queries: a global ceiling, a per-lane ceiling, a queue timeout, and
 * (TASK_2026_437 C14) background-work governor admission for background lanes.
 *
 * Extracted from `internal-query.service.ts` under the facade rule: the
 * service keeps its name, token and methods and constructs exactly one gate.
 */
import {
  DEFAULT_MAX_DEFER_MS,
  type BackgroundWorkSignal,
} from '@ptah-extension/vscode-core';
import { InternalQueryQueueTimeoutError } from '../errors/internal-query-queue-timeout.error';

/**
 * The lane a caller that names none is charged to.
 *
 * A shared bucket for the foreground callers that are not a single click (the
 * setup wizard's generation services, the harness LLM runner, the cron job
 * runner). They are rare and they have no reason to be told apart from each
 * other — only from the background pipelines that run unattended.
 */
export const DEFAULT_INTERNAL_QUERY_LANE = 'default';

/**
 * The lane for work a user just asked for from an RPC (TASK_2026_437 C14,
 * Batch 16b): manual skill promote / curator run / digest / enhance and
 * `memory:runNow`. Its own per-lane slot, so a click never queues behind a
 * wizard or harness call on {@link DEFAULT_INTERNAL_QUERY_LANE}, and it is not
 * governed. skill-synthesis mirrors this value in its local
 * `internal-query.interface.ts` (it cannot import agent-sdk).
 */
export const USER_ACTION_QUERY_LANE = 'user-action';

/** The memory curator's background lane (`SdkInternalQueryCuratorLlm`). */
export const MEMORY_CURATOR_QUERY_LANE = 'memory-curator';

/**
 * skill-synthesis's background lane. Mirrors `SKILL_SYNTHESIS_QUERY_LANE` in
 * `skill-synthesis/src/lib/lanes/lane-runner.service.ts`, which this lib cannot
 * import (skill-synthesis depends on the concrete service by token only).
 */
export const SKILL_SYNTHESIS_QUERY_LANE = 'skill-synthesis';

/**
 * The ONLY lanes the background-work governor holds and the background slot
 * cap counts (TASK_2026_437 C14, TASK_2026_463 FU-16b-c).
 *
 * An allow-list, not "everything but default": a lane that is not named here —
 * `default`, `user-action`, or a lane nobody has heard of — is admitted on
 * slots alone. Failing open is deliberate: a new foreground caller that picks
 * a fresh lane name must never discover the governor by waiting 10 minutes.
 *
 * **A NEW BACKGROUND LANE MUST BE ADDED HERE**, or it will neither yield to a
 * generating turn or event-loop lag nor be prevented from taking the reserved
 * foreground slot.
 */
export const GOVERNED_BACKGROUND_LANES: ReadonlySet<string> = new Set([
  MEMORY_CURATOR_QUERY_LANE,
  SKILL_SYNTHESIS_QUERY_LANE,
]);

/**
 * How many one-shot queries may be in flight at once, across every caller.
 *
 * THREE. It was one, and the reason it was one has been removed.
 *
 * The original argument (TASK_2026_323, blocker B6) was that each one-shot
 * spawns a real `claude` subprocess, that `child_process.spawn` runs
 * `CreateProcessW` synchronously on the calling thread, and that the calling
 * thread is the one owning every `BrowserWindow` — so N concurrent one-shots
 * meant N × ~1.6 s of frozen UI. That was true and the serialisation was the
 * right answer to it. TASK_2026_341 then moved the spawn onto a worker thread
 * (`OffThreadProcessSpawner`): eleven measured launches returned in 1-7 ms
 * against a 1576-1732 ms baseline, with no `[event-loop] lag` line following
 * any of them. The premise is gone, and with it the reason to pay for it.
 *
 * What the limit of one cost is on the record: the memory curator and
 * skill-synthesis are unrelated pipelines with unrelated budgets, and one boot
 * serialised them into each other nine times
 * (`tmp/logs/log.log:938,955,1011,1070,1104,1365,1380,1408,1424` — every one
 * reading `limit:1, inFlight:1`), turning two independent backlogs into one
 * queue that took 122 s and 156 s to drain.
 *
 * Three rather than "unbounded": a subprocess is still a subprocess. The two
 * background families may each run, while the background cap below reserves a
 * third slot that background may never take (TASK_2026_463 FU-16b-c). Without
 * it, a user-action query with a 60 s queue timeout could sit behind a 90-120 s
 * background call. The per-lane limit remains load-bearing because it stops
 * either background family from taking the whole background allowance.
 */
export const DEFAULT_MAX_CONCURRENT = 3;

/**
 * Maximum slots the background lane family may hold for a global `limit`.
 *
 * D2-c deliberately keeps one background slot when `limit = 1`: returning
 * zero would silently stop memory curation and skill synthesis. A configured
 * `limit = 2` therefore gives a cap of one and serialises those background
 * lanes again (accepted risk A-D2-1); limits above two reserve one slot for
 * foreground work.
 */
export function backgroundLimit(limit: number): number {
  return limit >= 2 ? limit - 1 : 1;
}

/**
 * How many one-shot queries ONE lane may hold at once.
 *
 * One. The global limit stops the host from spawning a crowd; this stops a
 * single pipeline from being that crowd. Without it, raising the global limit
 * to two would let skill-synthesis take both slots and lock the memory curator
 * out exactly as before — the same defect with a bigger number.
 *
 * It is also what keeps each pipeline's own bookkeeping honest. Neither the
 * curator (`inFlightCurates`, per session) nor skill-synthesis (its lane map,
 * per lane id) counts its calls globally, and both of their rate limiters are
 * per HOUR rather than per concurrent call. A per-lane ceiling of one is the
 * only place that question is answered for them.
 */
export const DEFAULT_MAX_CONCURRENT_PER_LANE = 1;

/**
 * How long a one-shot query may wait for a concurrency slot before
 * `execute()` rejects with `InternalQueryQueueTimeoutError`.
 *
 * The gate serializes subprocesses host-wide, so a caller queued behind a
 * long query would otherwise block indefinitely. This ceiling is the bound:
 * a waiter that does not reach the front within this window is removed from
 * the queue and rejected, leaving the gate consistent for the next waiter.
 */
export const DEFAULT_QUEUE_TIMEOUT_MS = 60_000;

/**
 * Thrown to a waiter whose `AbortSignal` fires before it reaches the front, and
 * to every governed waiter when the governor is disposed (host shutdown).
 */
function abortError(
  message = 'Internal query aborted while waiting for a slot.',
): Error {
  const error = new Error(message);
  error.name = 'AbortError';
  return error;
}

const SHUTDOWN_MESSAGE =
  'Background internal query cancelled: the host is shutting down.';

interface Waiter {
  settled: boolean;
  readonly lane: string;
  /** A background lane on a gate that has a governor. */
  readonly gated: boolean;
  /** The deferral ceiling passed: the governor no longer holds this waiter. */
  deferExpired: boolean;
  readonly resolve: (release: () => void) => void;
  readonly reject: (error: Error) => void;
  detach: () => void;
  /** Leave the queue and reject with `error`. Idempotent. */
  cancel: (error: Error) => void;
  /** Start / stop the queue-timeout clock. Both idempotent. */
  armTimeout: () => void;
  disarmTimeout: () => void;
}

/** What {@link InternalQueryConcurrencyGate} needs to govern background lanes. */
export interface GateAdmissionOptions {
  /** The background-work signal (TASK_2026_437 C14). Absent, nothing is governed. */
  readonly governor?: BackgroundWorkSignal | null;
  /** How long the governor may hold one waiter. Default `DEFAULT_MAX_DEFER_MS`. */
  readonly maxDeferMs?: number;
  /**
   * Told when a lane's waiter reaches the deferral ceiling, for the log. Once
   * per lane per deferral episode; an episode ends when the governor clears.
   */
  readonly onDeferralCeiling?: (lane: string, maxDeferMs: number) => void;
}

/** What one {@link InternalQueryConcurrencyGate.acquire} call asks for. */
export interface AcquireRequest {
  /**
   * Global ceiling. Read fresh on every call, so a settings change takes
   * effect without a restart.
   */
  readonly limit: number;
  /** Ceiling for {@link lane} alone. Also read fresh. */
  readonly perLaneLimit: number;
  /** Caller identity. See {@link DEFAULT_INTERNAL_QUERY_LANE}. */
  readonly lane: string;
  readonly signal?: AbortSignal;
  readonly queueTimeoutMs?: number;
}

/**
 * FIFO concurrency gate with per-lane ceilings.
 *
 * Separate from {@link InternalQueryService} so the queueing can be exercised
 * without an SDK, and so the "one gate for the whole host" property is a
 * property of ONE object rather than of a scattering of counters. The service
 * holds exactly one instance and is registered `Lifecycle.Singleton`
 * (`di/register.ts`), which is what makes the limits host-wide.
 *
 * ## One gate, three admission terms, no second lock
 *
 * A waiter is admitted when `active < limit`,
 * `activeInLane(lane) < perLaneLimit`, and a background lane is below the
 * shared background cap. That is one predicate over one queue.
 * The obvious alternative — a lane semaphore acquired before a global one —
 * would be two locks and would need an ordering argument to stay
 * deadlock-free; there is nothing to argue about here because there is nothing
 * to hold while waiting for something else.
 *
 * ## Why {@link drain} scans instead of taking the head
 *
 * With a single ceiling, the head of a FIFO queue is always the right waiter to
 * wake. With a per-lane ceiling it may not be: a queued skill-synthesis call
 * behind a running one is not admissible, and waking only the head would let it
 * block a memory-curator call sitting behind it — reintroducing the exact
 * cross-pipeline coupling the lanes exist to remove. `drain` therefore walks
 * the queue in order and admits the first waiter whose lane has room. Order is
 * still FIFO WITHIN a lane, which is the fairness property that matters: no
 * call can be overtaken by a later call from the same caller.
 *
 * ## Background never takes the last slot (TASK_2026_463 FU-16b-c)
 *
 * The lanes in {@link GOVERNED_BACKGROUND_LANES} may together hold at most
 * `backgroundLimit(limit)` slots. At the default, two background calls can run
 * while one slot remains available to foreground work. That reserved slot is
 * shared by `default` and `user-action`; if a wizard or harness call already
 * holds it, a user action can still wait for one of the three holders.
 *
 * ## Background lanes yield to the governor (TASK_2026_437 C14, INV-7)
 *
 * With a governor, each lane in {@link GOVERNED_BACKGROUND_LANES} has a third
 * admission term: `governor.isClear()`, or the waiter has been held for
 * `maxDeferMs`. It is re-read on every drain, not latched, so a waiter still
 * blocked on a slot when a foreground turn starts is held again. Every other
 * lane — `default`, `user-action`, an unknown one — is never governed.
 *
 * The queue timeout measures SLOT contention only. Its clock runs while the
 * governor admits the waiter and stops while the governor holds it; otherwise a
 * 60 s timeout would reject every background call a 10-min deferral is meant to
 * delay. A background waiter is therefore rejected at the latest
 * `maxDeferMs + queueTimeoutMs` after it queued.
 *
 * The gate subscribes to `governor.onChange` once and never unsubscribes: it is
 * owned by the process-singleton `InternalQueryService`, as the governor is.
 * A `'disposed'` notification is host shutdown: every governed waiter is
 * rejected with an `AbortError` and a later governed `acquire` rejects at once,
 * so no background query starts during quit. `default` is unaffected.
 */
export class InternalQueryConcurrencyGate {
  private active = 0;
  private limit = DEFAULT_MAX_CONCURRENT;
  private perLaneLimit = DEFAULT_MAX_CONCURRENT_PER_LANE;
  private readonly activeByLane = new Map<string, number>();
  private readonly waiters: Waiter[] = [];
  private readonly governor: BackgroundWorkSignal | null;
  private readonly maxDeferMs: number;
  private readonly onDeferralCeiling:
    | ((lane: string, maxDeferMs: number) => void)
    | undefined;
  /** Lanes whose ceiling was reported in the current deferral episode. */
  private readonly ceilingReportedLanes = new Set<string>();
  private governorDisposed = false;

  constructor(options: GateAdmissionOptions = {}) {
    this.governor = options.governor ?? null;
    this.maxDeferMs = normalizeLimit(
      options.maxDeferMs ?? DEFAULT_MAX_DEFER_MS,
      DEFAULT_MAX_DEFER_MS,
    );
    this.onDeferralCeiling = options.onDeferralCeiling;
    this.governor?.onChange((state) => {
      if (state === 'disposed') this.handleGovernorDisposed();
      else this.handleGovernorChange();
    });
  }

  /** True when `lane` waits on the governor as well as on a slot. */
  isGoverned(lane: string): boolean {
    return this.governor !== null && GOVERNED_BACKGROUND_LANES.has(lane);
  }

  /** Callers currently queued behind a limit. */
  get queued(): number {
    return this.waiters.length;
  }

  /** Callers currently holding a slot, across every lane. */
  get inFlight(): number {
    return this.active;
  }

  /** Callers currently holding slots across all governed background lanes. */
  get inFlightInBackground(): number {
    let total = 0;
    for (const lane of GOVERNED_BACKGROUND_LANES) {
      total += this.inFlightForLane(lane);
    }
    return total;
  }

  /** Callers from `lane` currently holding a slot. */
  inFlightForLane(lane: string): number {
    return this.activeByLane.get(lane) ?? 0;
  }

  /**
   * Take a slot, waiting in FIFO order when a limit is reached.
   *
   * Aborting while queued removes the waiter and rejects with an `AbortError`.
   * A waiter that already holds a slot is NOT affected — the caller's own abort
   * controller reaches the SDK query directly, and the slot is released when its
   * stream ends.
   *
   * `queueTimeoutMs` is the ceiling on how long the waiter may stay queued.
   * When it elapses the waiter is removed from the queue and rejected with
   * `InternalQueryQueueTimeoutError` — no slot leaks and the next admissible
   * waiter is woken.
   *
   * @returns an idempotent release function.
   */
  acquire(request: AcquireRequest): Promise<() => void> {
    const { lane, signal } = request;
    this.limit = normalizeLimit(request.limit, DEFAULT_MAX_CONCURRENT);
    this.perLaneLimit = normalizeLimit(
      request.perLaneLimit,
      DEFAULT_MAX_CONCURRENT_PER_LANE,
    );

    if (signal?.aborted) return Promise.reject(abortError());

    const gated = this.isGoverned(lane);
    if (gated && this.governorDisposed) {
      return Promise.reject(abortError(SHUTDOWN_MESSAGE));
    }
    if (this.admissible(lane) && (!gated || this.governorClear())) {
      this.take(lane);
      return Promise.resolve(this.makeRelease(lane));
    }

    const effectiveTimeoutMs =
      Number.isFinite(request.queueTimeoutMs) &&
      (request.queueTimeoutMs as number) > 0
        ? Math.floor(request.queueTimeoutMs as number)
        : DEFAULT_QUEUE_TIMEOUT_MS;

    return new Promise<() => void>((resolve, reject) => {
      const waiter: Waiter = {
        settled: false,
        lane,
        gated,
        deferExpired: false,
        resolve,
        reject,
        detach: () => undefined,
        cancel: () => undefined,
        armTimeout: () => undefined,
        disarmTimeout: () => undefined,
      };
      let timeoutId: ReturnType<typeof setTimeout> | undefined;
      let deferId: ReturnType<typeof setTimeout> | undefined;
      let removeAbort: (() => void) | undefined;

      waiter.armTimeout = () => {
        if (timeoutId !== undefined) return;
        timeoutId = setTimeout(
          () =>
            settleReject(
              new InternalQueryQueueTimeoutError(effectiveTimeoutMs),
            ),
          effectiveTimeoutMs,
        );
        // The ceiling must not keep the host alive: a waiter queued at shutdown
        // should not pin the event loop. unref lets the timer fire only while
        // the loop is otherwise alive (the normal case), and drops it on exit.
        (timeoutId as { unref?: () => void }).unref?.();
      };
      waiter.disarmTimeout = () => {
        if (timeoutId === undefined) return;
        clearTimeout(timeoutId);
        timeoutId = undefined;
      };

      const removeFromQueue = (): void => {
        const index = this.waiters.indexOf(waiter);
        if (index >= 0) this.waiters.splice(index, 1);
      };

      // detach clears the abort listener, the queue timeout AND the deferral
      // timer. It is called by drain() when the waiter reaches the front, and
      // by settleReject when the waiter leaves the queue via abort or timeout
      // — so a settled waiter never leaves a dangling timer or listener behind.
      waiter.detach = () => {
        if (removeAbort) removeAbort();
        waiter.disarmTimeout();
        if (deferId !== undefined) {
          clearTimeout(deferId);
          deferId = undefined;
        }
      };

      const settleReject = (error: Error): void => {
        if (waiter.settled) return;
        waiter.settled = true;
        removeFromQueue();
        waiter.detach();
        reject(error);
      };
      waiter.cancel = settleReject;

      if (signal) {
        const onAbort = (): void => settleReject(abortError());
        signal.addEventListener('abort', onAbort, { once: true });
        removeAbort = () => signal.removeEventListener('abort', onAbort);
      }

      if (gated) {
        // The starvation ceiling (R-P7), counted from the moment it queued.
        deferId = setTimeout(() => {
          deferId = undefined;
          if (waiter.settled) return;
          waiter.deferExpired = true;
          if (!this.ceilingReportedLanes.has(lane)) {
            this.ceilingReportedLanes.add(lane);
            this.onDeferralCeiling?.(lane, this.maxDeferMs);
          }
          waiter.armTimeout();
          this.drain();
        }, this.maxDeferMs);
        (deferId as { unref?: () => void }).unref?.();
      }

      this.waiters.push(waiter);
      if (this.governorAdmits(waiter)) waiter.armTimeout();
    });
  }

  /** Re-time every governed waiter against the new state, then drain. */
  private handleGovernorChange(): void {
    // A clear ends the deferral episode: the next hold may report again.
    if (this.governorClear()) this.ceilingReportedLanes.clear();
    for (const waiter of this.waiters) {
      if (!waiter.gated || waiter.settled) continue;
      if (this.governorAdmits(waiter)) waiter.armTimeout();
      else waiter.disarmTimeout();
    }
    this.drain();
  }

  /** Host shutdown: cancel every queued background call. */
  private handleGovernorDisposed(): void {
    this.governorDisposed = true;
    for (const waiter of [...this.waiters]) {
      if (waiter.gated) waiter.cancel(abortError(SHUTDOWN_MESSAGE));
    }
  }

  private governorClear(): boolean {
    return this.governor === null || this.governor.isClear();
  }

  private governorAdmits(waiter: Waiter): boolean {
    return !waiter.gated || waiter.deferExpired || this.governorClear();
  }

  private admissible(lane: string): boolean {
    return (
      this.active < this.limit &&
      this.inFlightForLane(lane) < this.perLaneLimit &&
      (!GOVERNED_BACKGROUND_LANES.has(lane) ||
        this.inFlightInBackground < backgroundLimit(this.limit))
    );
  }

  private take(lane: string): void {
    this.active++;
    this.activeByLane.set(lane, this.inFlightForLane(lane) + 1);
  }

  private makeRelease(lane: string): () => void {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.active--;
      const remaining = this.inFlightForLane(lane) - 1;
      // Delete rather than store a zero: the map is keyed by caller-supplied
      // strings, so an entry that outlives its last holder is an unbounded
      // leak on a host whose lanes are dynamic.
      if (remaining > 0) this.activeByLane.set(lane, remaining);
      else this.activeByLane.delete(lane);
      this.drain();
    };
  }

  /**
   * Wake every waiter that is now admissible, oldest first.
   *
   * The scan restarts from the front after each admission because taking a slot
   * changes both ceilings, so a waiter that was inadmissible earlier in the pass
   * cannot become admissible later in it — but one EARLIER in the queue can
   * still be the right next choice on the following pass. Bounded by
   * `this.limit` admissions per call, which is small.
   */
  private drain(): void {
    for (;;) {
      if (this.active >= this.limit) return;
      const index = this.waiters.findIndex(
        (w) => !w.settled && this.admissible(w.lane) && this.governorAdmits(w),
      );
      if (index < 0) return;
      const [waiter] = this.waiters.splice(index, 1);
      waiter.settled = true;
      waiter.detach();
      this.take(waiter.lane);
      waiter.resolve(this.makeRelease(waiter.lane));
    }
  }
}

function normalizeLimit(value: number, fallback: number): number {
  return Number.isFinite(value) && value >= 1 ? Math.floor(value) : fallback;
}
