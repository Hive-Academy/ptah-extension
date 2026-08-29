import { injectable, inject } from 'tsyringe';
import { TOKENS, type Logger } from '@ptah-extension/vscode-core';
import {
  PLATFORM_TOKENS,
  type IWorkspaceProvider,
} from '@ptah-extension/platform-core';
import { SDK_TOKENS } from '../di/tokens';
import { SdkQueryRunner } from '../helpers/sdk-query-runner.service';
import { InternalQueryQueueTimeoutError } from '../errors/internal-query-queue-timeout.error';
import type { SDKMessage } from '../types/sdk-types/claude-sdk.types';
import type {
  InternalQueryConfig,
  InternalQueryHandle,
} from './internal-query.types';

const SERVICE_TAG = '[InternalQueryService]';

const CONCURRENCY_SECTION = 'ptah';

/** `ptah.internalQuery.maxConcurrent` — see {@link DEFAULT_MAX_CONCURRENT}. */
export const INTERNAL_QUERY_CONCURRENCY_KEY = 'internalQuery.maxConcurrent';

/** `ptah.internalQuery.queueTimeoutMs` — see {@link DEFAULT_QUEUE_TIMEOUT_MS}. */
export const INTERNAL_QUERY_QUEUE_TIMEOUT_KEY = 'internalQuery.queueTimeoutMs';

/** `ptah.internalQuery.maxConcurrentPerLane` — see {@link DEFAULT_MAX_CONCURRENT_PER_LANE}. */
export const INTERNAL_QUERY_LANE_CONCURRENCY_KEY =
  'internalQuery.maxConcurrentPerLane';

/**
 * The lane a caller that names none is charged to.
 *
 * A shared bucket for the user-initiated callers (the setup wizard's
 * generation services, the harness LLM runner, the cron job runner). They are
 * rare, they are foreground, and they have no reason to be told apart from
 * each other — only from the two background pipelines that run unattended.
 */
export const DEFAULT_INTERNAL_QUERY_LANE = 'default';

/**
 * How many one-shot queries may be in flight at once, across every caller.
 *
 * TWO. It was one, and the reason it was one has been removed.
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
 * Two rather than "unbounded": a subprocess is still a subprocess, and the
 * per-lane limit below is what makes two enough — the two background families
 * each get a slot and neither can take both.
 */
export const DEFAULT_MAX_CONCURRENT = 2;

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
 * A caller's lane, or {@link DEFAULT_INTERNAL_QUERY_LANE}.
 *
 * Trimmed and lower-cased so `'Memory-Curator'` and `'memory-curator '` are the
 * same bucket. The lane is a caller-supplied string and a near-miss would
 * silently mint a second lane with its own ceiling — which is the failure this
 * whole mechanism exists to prevent, arriving through a typo.
 */
function resolveLane(lane: string | undefined): string {
  const trimmed = (lane ?? '').trim().toLowerCase();
  return trimmed.length > 0 ? trimmed : DEFAULT_INTERNAL_QUERY_LANE;
}

/** Thrown to a waiter whose `AbortSignal` fires before it reaches the front. */
function abortError(): Error {
  const error = new Error('Internal query aborted while waiting for a slot.');
  error.name = 'AbortError';
  return error;
}

interface Waiter {
  settled: boolean;
  readonly lane: string;
  readonly resolve: (release: () => void) => void;
  readonly reject: (error: Error) => void;
  detach: () => void;
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
 * ## One gate, two ceilings, no second lock
 *
 * A waiter is admitted when BOTH `active < limit` and
 * `activeInLane(lane) < perLaneLimit`. That is one predicate over one queue.
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
 */
export class InternalQueryConcurrencyGate {
  private active = 0;
  private limit = DEFAULT_MAX_CONCURRENT;
  private perLaneLimit = DEFAULT_MAX_CONCURRENT_PER_LANE;
  private readonly activeByLane = new Map<string, number>();
  private readonly waiters: Waiter[] = [];

  /** Callers currently queued behind a limit. */
  get queued(): number {
    return this.waiters.length;
  }

  /** Callers currently holding a slot, across every lane. */
  get inFlight(): number {
    return this.active;
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

    if (this.admissible(lane)) {
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
        resolve,
        reject,
        detach: () => undefined,
      };
      const timeoutId: ReturnType<typeof setTimeout> = setTimeout(
        () =>
          settleReject(new InternalQueryQueueTimeoutError(effectiveTimeoutMs)),
        effectiveTimeoutMs,
      );
      // The ceiling must not keep the host alive: a waiter queued at shutdown
      // should not pin the event loop. unref lets the timer fire only while the
      // loop is otherwise alive (the normal case), and drops it on exit.
      (timeoutId as { unref?: () => void }).unref?.();
      let removeAbort: (() => void) | undefined;

      const removeFromQueue = (): void => {
        const index = this.waiters.indexOf(waiter);
        if (index >= 0) this.waiters.splice(index, 1);
      };

      // detach clears BOTH the abort listener and the queue timeout. It is
      // called by drain() when the waiter reaches the front, and by
      // settleReject when the waiter leaves the queue via abort or timeout —
      // so a settled waiter never leaves a dangling timer or listener behind.
      waiter.detach = () => {
        if (removeAbort) removeAbort();
        clearTimeout(timeoutId);
      };

      const settleReject = (error: Error): void => {
        if (waiter.settled) return;
        waiter.settled = true;
        removeFromQueue();
        waiter.detach();
        reject(error);
      };

      if (signal) {
        const onAbort = (): void => settleReject(abortError());
        signal.addEventListener('abort', onAbort, { once: true });
        removeAbort = () => signal.removeEventListener('abort', onAbort);
      }

      this.waiters.push(waiter);
    });
  }

  private admissible(lane: string): boolean {
    return (
      this.active < this.limit && this.inFlightForLane(lane) < this.perLaneLimit
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
        (w) => !w.settled && this.admissible(w.lane),
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

@injectable()
export class InternalQueryService {
  private readonly gate = new InternalQueryConcurrencyGate();

  constructor(
    @inject(SDK_TOKENS.SDK_QUERY_RUNNER)
    private readonly runner: SdkQueryRunner,
    @inject(TOKENS.LOGGER, { isOptional: true })
    private readonly logger: Logger | null = null,
    @inject(PLATFORM_TOKENS.WORKSPACE_PROVIDER, { isOptional: true })
    private readonly workspace: IWorkspaceProvider | null = null,
  ) {}

  /**
   * Whether this host initialized the SDK at all.
   *
   * Headless callers (`skill-synthesis`'s lane runner, the memory curator) get
   * registered this service on EVERY host, including the CLI's
   * `withEngine({ requireSdk: false })` boots where `initialize()` never runs.
   * Resolving the DI token therefore does not mean an LLM is reachable, and
   * `execute` would throw `SdkError` on every call. This is the question those
   * callers actually need answered before they spend an attempt.
   */
  isInitialized(): boolean {
    return this.runner.isInitialized();
  }

  /**
   * Run a one-shot query, waiting for a concurrency slot first.
   *
   * The slot is held for the LIFETIME of the query, not just the launch: it is
   * released when the returned stream finishes, is broken out of, or throws, and
   * also by `close()` / `abort()`. Releasing at launch would gate nothing —
   * `runOneShot` returns as soon as the SDK hands back a conversation handle,
   * long before the subprocess has done any work.
   *
   * A caller that neither iterates the stream nor closes the handle holds its
   * slot indefinitely. Every caller in this repo iterates to the `result`
   * message; the guarantee is documented rather than defended because a timeout
   * here would abort real work whose only fault was being slow.
   */
  async execute(config: InternalQueryConfig): Promise<InternalQueryHandle> {
    const release = await this.acquireSlot(config);

    let handle: InternalQueryHandle;
    try {
      handle = await this.runner.runOneShot({
        mode: 'oneShot',
        cwd: config.cwd,
        model: config.model,
        prompt: config.prompt,
        systemPromptAppend: config.systemPromptAppend,
        mcpServerRunning: config.mcpServerRunning,
        mcpPort: config.mcpPort,
        maxTurns: config.maxTurns,
        outputFormat: config.outputFormat,
        abortController: config.abortController,
        auth: config.auth,
      });
    } catch (error: unknown) {
      release();
      throw error;
    }

    return this.holdSlotUntilDone(handle, release);
  }

  private async acquireSlot(config: InternalQueryConfig): Promise<() => void> {
    const limit = this.readMaxConcurrent();
    const perLaneLimit = this.readMaxConcurrentPerLane();
    const lane = resolveLane(config.lane);
    const queueTimeoutMs = this.resolveQueueTimeoutMs(config);
    const laneInFlight = this.gate.inFlightForLane(lane);
    if (this.gate.inFlight >= limit || laneInFlight >= perLaneLimit) {
      this.logger?.debug(
        `${SERVICE_TAG} one-shot query waiting for a concurrency slot`,
        {
          lane,
          limit,
          perLaneLimit,
          inFlight: this.gate.inFlight,
          laneInFlight,
          queued: this.gate.queued,
          model: config.model,
          // Which ceiling is the binding one. Without it the log says a query
          // waited but not whether the host is busy or its own pipeline is,
          // and those call for opposite fixes.
          blockedBy: this.gate.inFlight >= limit ? 'global' : 'lane',
        },
      );
    }
    return this.gate.acquire({
      limit,
      perLaneLimit,
      lane,
      signal: config.abortController?.signal,
      queueTimeoutMs,
    });
  }

  private holdSlotUntilDone(
    handle: InternalQueryHandle,
    release: () => void,
  ): InternalQueryHandle {
    const source = handle.stream;
    async function* guarded(): AsyncGenerator<SDKMessage> {
      try {
        yield* source;
      } finally {
        // Runs on normal completion, on `throw`, AND on the `return()` that
        // `for await (…) { break }` performs — which is how every consumer in
        // this repo leaves the loop once it sees the `result` message.
        release();
      }
    }

    return {
      stream: guarded(),
      abort: () => {
        try {
          handle.abort();
        } finally {
          release();
        }
      },
      close: () => {
        try {
          handle.close();
        } finally {
          release();
        }
      },
    };
  }

  private readMaxConcurrent(): number {
    return this.readLimit(
      INTERNAL_QUERY_CONCURRENCY_KEY,
      DEFAULT_MAX_CONCURRENT,
    );
  }

  private readMaxConcurrentPerLane(): number {
    return this.readLimit(
      INTERNAL_QUERY_LANE_CONCURRENCY_KEY,
      DEFAULT_MAX_CONCURRENT_PER_LANE,
    );
  }

  private readLimit(key: string, fallback: number): number {
    if (!this.workspace) return fallback;
    try {
      const value = this.workspace.getConfiguration<number>(
        CONCURRENCY_SECTION,
        key,
        fallback,
      );
      return typeof value === 'number' && Number.isFinite(value) && value >= 1
        ? Math.floor(value)
        : fallback;
    } catch (error: unknown) {
      this.logger?.warn(
        `${SERVICE_TAG} could not read ${key}; using the default`,
        {
          error: error instanceof Error ? error.message : String(error),
          fallback,
        },
      );
      return fallback;
    }
  }

  private resolveQueueTimeoutMs(config: InternalQueryConfig): number {
    if (config.queueTimeoutMs !== undefined) {
      return Number.isFinite(config.queueTimeoutMs) && config.queueTimeoutMs > 0
        ? Math.floor(config.queueTimeoutMs)
        : DEFAULT_QUEUE_TIMEOUT_MS;
    }
    if (!this.workspace) return DEFAULT_QUEUE_TIMEOUT_MS;
    try {
      const value = this.workspace.getConfiguration<number>(
        CONCURRENCY_SECTION,
        INTERNAL_QUERY_QUEUE_TIMEOUT_KEY,
        DEFAULT_QUEUE_TIMEOUT_MS,
      );
      return typeof value === 'number' && Number.isFinite(value) && value > 0
        ? Math.floor(value)
        : DEFAULT_QUEUE_TIMEOUT_MS;
    } catch (error: unknown) {
      this.logger?.warn(
        `${SERVICE_TAG} could not read ${INTERNAL_QUERY_QUEUE_TIMEOUT_KEY}; using the default`,
        {
          error: error instanceof Error ? error.message : String(error),
          fallback: DEFAULT_QUEUE_TIMEOUT_MS,
        },
      );
      return DEFAULT_QUEUE_TIMEOUT_MS;
    }
  }
}
