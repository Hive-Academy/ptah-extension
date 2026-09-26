/**
 * `TsDiagnosticsWorker` — the host-thread half of the type-check worker.
 *
 * `ts.createProgram` + `ts.getPreEmitDiagnostics` is one monolithic synchronous
 * call. There is no chunk size to tune and no yield point to insert: on this
 * monorepo (~1,936 TS files) it holds whichever event loop it runs on for tens
 * of seconds. In Electron that loop is the MAIN process — the same one driving
 * `BrowserWindow` and every Claude SDK subprocess pipe — so a single
 * `ptah_get_diagnostics` call freezes the app and back-pressures every agent
 * (TASK_2026_323 blocker B3). The only fix available is a different thread.
 *
 * **One worker per `tsModulePath`, shared process-wide** (`tsDiagnosticsWorker`).
 * The `typescript` module load is the expensive part of a cold worker and there
 * is no benefit to paying it twice for the same compiler, so runs against one
 * compiler share a thread. But the thread cannot be shared ACROSS compilers: a
 * worker binds its `typescript` at construction via `workerData`. The previous
 * single-slot design handled a second compiler by tearing the running worker
 * down — which rejected an unrelated in-flight compile belonging to another
 * workspace (TASK_2026_325 finding 4). Keyed by path, two workspaces on two
 * compilers both resolve. The map stays small on its own: each entry
 * self-terminates after `IDLE_TERMINATE_MS` and removes itself, so its size is
 * bounded by twice the number of distinct compilers used inside any one idle
 * window.
 *
 * **Two lanes per compiler** (TASK_2026_559 Batch 19): the key is
 * `(tsModulePath, lane)`, with a `scoped` and an `unscoped` thread. A scoped
 * check must not queue behind a whole-workspace one, and the provider keeps an
 * unscoped compile running after answering its caller (so a retry can share
 * it) — on one shared thread that kept compile made every later scoped check
 * wait for all of it. Runs of the same lane still share their thread. The cost
 * is memory: one compiler can now hold two `typescript` module loads and two
 * in-flight programs at once, never more, and each lane gives its share back
 * after its own idle window.
 *
 * Requests need no queue — the compile is synchronous inside the worker, so a
 * second message simply waits in that worker's own message queue. Ids correlate
 * replies and are unique across every worker.
 *
 * Lifecycle: spawned on first use for its compiler, `unref`'d whenever nothing
 * is in flight on it so it can never hold the host process open, `ref`'d while
 * a run is outstanding so the host cannot exit mid-check, and terminated after
 * `IDLE_TERMINATE_MS` of silence to give the compiler's retained ASTs back.
 *
 * **Every `terminate()` is awaited.** `Worker.terminate()` is asynchronous, so
 * a fire-and-forget call lets the caller finish while the thread is still
 * winding down — which is what Jest reports as a worker that "failed to exit
 * gracefully". Terminations started from a place with no caller to await them
 * (a run timeout, a worker `error` event) are registered in `terminations`, and
 * `dispose()` joins that set: `dispose()` resolving means no thread is left.
 */

import { Worker } from 'node:worker_threads';
import type { DiagnosticSeverity } from '@ptah-extension/platform-core';
import { TS_DIAGNOSTICS_WORKER_SOURCE } from './ts-diagnostics-worker-source';

/** A single diagnostic as the worker reports it, before grouping by file. */
export interface CollectedDiagnostic {
  file: string;
  line: number;
  severity: DiagnosticSeverity;
  code: number;
  message: string;
}

/**
 * One discovered `tsconfig*.json` that could not be type-checked.
 *
 * Structured rather than prose because the host renders each failure as an
 * error diagnostic bound to `config` — a caller that is told "some project
 * failed" without being told WHICH cannot act on it (TASK_2026_325 finding 1).
 */
export interface ConfigFailure {
  /** Forward-slashed absolute path of the config that failed. */
  readonly config: string;
  /** Why it failed, phrased for the agent reading the tool result. */
  readonly message: string;
  /** TypeScript's own diagnostic code, when the compiler produced the failure. */
  readonly code?: number;
}

export interface TsDiagnosticsRunRequest {
  /** Absolute path to the `typescript` module the worker should load. */
  readonly tsModulePath: string;
  /** Discovered `tsconfig*.json` paths, in discovery order. */
  readonly configPaths: readonly string[];
  /** Workspace root, already resolved and forward-slashed. */
  readonly normRoot: string;
  /**
   * Platform whose path-casing rules apply to the compile-scope check inside
   * the worker (win32 folds case, everything else does not).
   *
   * The worker cannot import `isPathWithinRoots` — it has no module resolution
   * — so this is how the host keeps that check in step with the real predicate
   * it applies to the returned diagnostics, and how a spec drives the win32
   * rule from a Linux CI runner.
   */
  readonly platform: NodeJS.Platform;
  /**
   * Which thread of this compiler the run queues on: `scoped` for a check
   * narrowed to the projects owning named files, `unscoped` for a
   * whole-workspace check. See {@link TsDiagnosticsLane}.
   */
  readonly lane: TsDiagnosticsLane;
}

/**
 * A class of run that gets its own thread per compiler.
 *
 * A scoped check costs seconds; an unscoped one on a monorepo costs minutes,
 * and it outlives its caller — the provider's budget answers at 45 s but keeps
 * the compile so a retry can share it. On one shared thread every later scoped
 * check queued behind that abandoned compile: measured at 86 s for a ~21 s
 * scoped run (TASK_2026_559 Task 1.2, case e). Two lanes per compiler, one per
 * class, remove that wait without cancelling the run the budget promised to
 * keep.
 */
export type TsDiagnosticsLane = 'scoped' | 'unscoped';

export interface TsDiagnosticsRunOutcome {
  readonly collected: readonly CollectedDiagnostic[];
  readonly errors: readonly ConfigFailure[];
  /** How many configs produced an actual program. Zero means nothing was checked. */
  readonly programCount: number;
}

interface WorkerSuccess {
  id: number;
  ok: true;
  collected: CollectedDiagnostic[];
  errors: ConfigFailure[];
  programCount: number;
}

interface WorkerFailure {
  id: number;
  ok: false;
  error: string;
}

type WorkerResponse = WorkerSuccess | WorkerFailure;

interface PendingRun {
  resolve(outcome: TsDiagnosticsRunOutcome): void;
  reject(error: Error): void;
  timer: NodeJS.Timeout;
}

/** One live thread plus everything outstanding on it. */
interface WorkerEntry {
  /** Registration key in `workers`: the compiler and the lane together. */
  readonly key: string;
  readonly worker: Worker;
  readonly pending: Map<number, PendingRun>;
  idleTimer: NodeJS.Timeout | null;
}

/**
 * Terminate an idle worker after this long. Long enough that a burst of agent
 * calls reuses a warm compiler, short enough that a finished session does not
 * keep a parsed monorepo resident.
 */
const IDLE_TERMINATE_MS = 60_000;

/**
 * Hard ceiling on one run. A legitimate full-monorepo check takes tens of
 * seconds, so this is generous — its job is only to stop a wedged compile from
 * poisoning the single-flight slot forever. A synchronous compile cannot be
 * interrupted cooperatively, so the timeout kills the thread.
 */
const RUN_TIMEOUT_MS = 300_000;

export class TsDiagnosticsWorker {
  private readonly workers = new Map<string, WorkerEntry>();
  private readonly terminations = new Set<Promise<void>>();
  private nextId = 1;
  /** Bumped when a disposal starts; see {@link admissionToken}. */
  private disposals = 0;
  /** Disposals started and not yet finished. Admission is closed while > 0. */
  private disposing = 0;

  /**
   * @param workerSource program each thread runs. Parameterized so a spec can
   *   start real threads that hold their lane for a known time — the only way
   *   to prove one run does not queue behind another; hosts never pass it.
   */
  constructor(
    private readonly workerSource: string = TS_DIAGNOSTICS_WORKER_SOURCE,
  ) {}

  /**
   * Permission to run later, taken when a request STARTS. `null` while a
   * disposal is in progress: a request that starts then is refused outright.
   *
   * A caller that awaits anything between starting and calling {@link run}
   * (the provider's config discovery) takes a token first and compares a fresh
   * one right before `run`. Any disposal that began in between — finished or
   * not — changes the token, so a request begun before or during a disposal
   * can never start a thread after that disposal reported none left
   * (TASK_2026_559 Batch 19 r1 S1, r2 R2-S1). Disposal ends a generation, not
   * the pool: a request that starts after it completes is admitted as normal.
   */
  admissionToken(): number | null {
    return this.disposing > 0 ? null : this.disposals;
  }

  /**
   * Run one type-check off-thread.
   *
   * Rejects — it never resolves a partial answer — when the worker dies, when
   * the compiler throws, when the run exceeds `RUN_TIMEOUT_MS`, or when it is
   * posted while {@link dispose} is in progress. The caller turns that into an
   * `unavailable` result; reporting zero diagnostics from a failed run would be
   * the false clean this provider exists to avoid.
   */
  run(request: TsDiagnosticsRunRequest): Promise<TsDiagnosticsRunOutcome> {
    // Admission is closed while a disposal is running: `dispose()` joins the
    // lanes that exist when it starts, so a thread created now would outlive
    // it, alive and ref'd, after it had reported none left.
    if (this.disposing > 0) {
      return Promise.reject(disposedError());
    }

    let entry: WorkerEntry;
    try {
      entry = this.ensureWorker(request.tsModulePath, request.lane);
    } catch (error: unknown) {
      return Promise.reject(toError(error));
    }

    const id = this.nextId++;

    return new Promise<TsDiagnosticsRunOutcome>((resolve, reject) => {
      const timer = setTimeout(() => {
        const timedOut = new Error(
          `TypeScript diagnostics run exceeded ${RUN_TIMEOUT_MS}ms and the worker was terminated.`,
        );
        // Drop this run first so `failWorker` does not reject it a second
        // time, then settle it only once the thread it was wedged in is gone.
        // Anything else queued behind it on the same thread dies too, but for
        // a different reason, and is told so — a sibling that never ran long
        // enough to time out should not be handed a timeout as its cause.
        entry.pending.delete(id);
        void this.failWorker(
          entry,
          new Error(
            'TypeScript diagnostics worker was terminated because another run on it timed out.',
          ),
        ).then(() => {
          reject(timedOut);
        });
      }, RUN_TIMEOUT_MS);
      timer.unref?.();

      entry.pending.set(id, { resolve, reject, timer });
      this.cancelIdleTimer(entry);
      entry.worker.ref();
      entry.worker.postMessage({
        id,
        configPaths: [...request.configPaths],
        normRoot: request.normRoot,
        platform: request.platform,
      });
    });
  }

  /**
   * Terminate every worker and reject anything outstanding. Idempotent.
   *
   * Resolves only once all threads are actually gone — including any that a
   * timeout or a worker `error` event started terminating earlier. No run is
   * admitted until it resolves, so the set it joins is complete.
   */
  async dispose(): Promise<void> {
    this.disposals += 1;
    this.disposing += 1;
    try {
      const disposed = disposedError();
      await Promise.all(
        [...this.workers.values()].map((entry) =>
          this.failWorker(entry, disposed),
        ),
      );
      await Promise.all([...this.terminations]);
    } finally {
      this.disposing -= 1;
    }
  }

  private ensureWorker(
    tsModulePath: string,
    lane: TsDiagnosticsLane,
  ): WorkerEntry {
    // NUL cannot occur in a path, so no module path can forge another's key.
    const key = `${tsModulePath}\u0000${lane}`;
    const existing = this.workers.get(key);
    if (existing) return existing;

    const worker = new Worker(this.workerSource, {
      eval: true,
      workerData: { tsModulePath },
    });
    worker.unref();

    const entry: WorkerEntry = {
      key,
      worker,
      pending: new Map<number, PendingRun>(),
      idleTimer: null,
    };

    worker.on('message', (raw: unknown) => {
      this.onMessage(entry, raw as WorkerResponse);
    });
    worker.on('error', (error: Error) => {
      void this.failWorker(entry, error);
    });
    worker.on('exit', (code: number) => {
      // The thread is already gone, so there is nothing to terminate — only
      // state to drop and outstanding runs to fail.
      this.forget(entry);
      this.rejectPending(
        entry,
        new Error(`TypeScript diagnostics worker exited with code ${code}.`),
      );
    });

    this.workers.set(key, entry);
    return entry;
  }

  private onMessage(entry: WorkerEntry, message: WorkerResponse): void {
    const pending = entry.pending.get(message.id);
    if (!pending) return;
    clearTimeout(pending.timer);
    entry.pending.delete(message.id);

    if (message.ok) {
      pending.resolve({
        collected: message.collected,
        errors: message.errors,
        programCount: message.programCount,
      });
    } else {
      pending.reject(new Error(message.error));
    }

    this.settleIdle(entry);
  }

  /**
   * Reject every run outstanding on one worker and terminate it. Used for
   * worker death, timeout and disposal alike — in all three cases that
   * thread's state is no longer trustworthy, so it is replaced rather than
   * reused. Workers bound to OTHER compilers, and the other lane of this
   * compiler, are untouched.
   */
  private failWorker(entry: WorkerEntry, error: Error): Promise<void> {
    this.forget(entry);
    this.rejectPending(entry, error);
    return this.trackTermination(entry.worker.terminate());
  }

  /** Drop an entry's registration and its idle timer. Safe to repeat. */
  private forget(entry: WorkerEntry): void {
    if (this.workers.get(entry.key) === entry) {
      this.workers.delete(entry.key);
    }
    this.cancelIdleTimer(entry);
  }

  private rejectPending(entry: WorkerEntry, error: Error): void {
    if (entry.pending.size === 0) return;
    for (const [, pending] of entry.pending) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    entry.pending.clear();
  }

  /**
   * Keep a handle on a termination nobody is in a position to await, so
   * `dispose()` can join it. Failures of `terminate()` itself are swallowed:
   * the thread is being abandoned either way, and there is no caller left to
   * report to.
   */
  private trackTermination(termination: Promise<unknown>): Promise<void> {
    const tracked = termination.then(
      () => undefined,
      () => undefined,
    );
    this.terminations.add(tracked);
    void tracked.then(() => {
      this.terminations.delete(tracked);
    });
    return tracked;
  }

  private settleIdle(entry: WorkerEntry): void {
    if (entry.pending.size > 0) return;
    if (this.workers.get(entry.key) !== entry) return;

    entry.worker.unref();
    this.cancelIdleTimer(entry);
    entry.idleTimer = setTimeout(() => {
      entry.idleTimer = null;
      if (entry.pending.size > 0) return;
      if (this.workers.get(entry.key) !== entry) return;
      this.workers.delete(entry.key);
      void this.trackTermination(entry.worker.terminate());
    }, IDLE_TERMINATE_MS);
    entry.idleTimer.unref?.();
  }

  private cancelIdleTimer(entry: WorkerEntry): void {
    if (entry.idleTimer) {
      clearTimeout(entry.idleTimer);
      entry.idleTimer = null;
    }
  }
}

function disposedError(): Error {
  return new Error('TypeScript diagnostics worker was disposed.');
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

/**
 * Process-wide worker pool. Shared so a burst of agent calls reuses one warm
 * compiler thread instead of spawning one per provider instance.
 */
export const tsDiagnosticsWorker = new TsDiagnosticsWorker();
