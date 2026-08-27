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
 * bounded by the number of distinct compilers used inside any one idle window.
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
}

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
  readonly tsModulePath: string;
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

  /**
   * Run one type-check off-thread.
   *
   * Rejects — it never resolves a partial answer — when the worker dies, when
   * the compiler throws, or when the run exceeds `RUN_TIMEOUT_MS`. The caller
   * turns that into an `unavailable` result; reporting zero diagnostics from a
   * failed run would be the false clean this provider exists to avoid.
   */
  run(request: TsDiagnosticsRunRequest): Promise<TsDiagnosticsRunOutcome> {
    let entry: WorkerEntry;
    try {
      entry = this.ensureWorker(request.tsModulePath);
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
      });
    });
  }

  /**
   * Terminate every worker and reject anything outstanding. Idempotent.
   *
   * Resolves only once all threads are actually gone — including any that a
   * timeout or a worker `error` event started terminating earlier.
   */
  async dispose(): Promise<void> {
    const disposed = new Error('TypeScript diagnostics worker was disposed.');
    await Promise.all(
      [...this.workers.values()].map((entry) =>
        this.failWorker(entry, disposed),
      ),
    );
    await Promise.all([...this.terminations]);
  }

  private ensureWorker(tsModulePath: string): WorkerEntry {
    const existing = this.workers.get(tsModulePath);
    if (existing) return existing;

    const worker = new Worker(TS_DIAGNOSTICS_WORKER_SOURCE, {
      eval: true,
      workerData: { tsModulePath },
    });
    worker.unref();

    const entry: WorkerEntry = {
      tsModulePath,
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

    this.workers.set(tsModulePath, entry);
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
   * reused. Workers bound to OTHER compilers are untouched.
   */
  private failWorker(entry: WorkerEntry, error: Error): Promise<void> {
    this.forget(entry);
    this.rejectPending(entry, error);
    return this.trackTermination(entry.worker.terminate());
  }

  /** Drop an entry's registration and its idle timer. Safe to repeat. */
  private forget(entry: WorkerEntry): void {
    if (this.workers.get(entry.tsModulePath) === entry) {
      this.workers.delete(entry.tsModulePath);
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
    if (this.workers.get(entry.tsModulePath) !== entry) return;

    entry.worker.unref();
    this.cancelIdleTimer(entry);
    entry.idleTimer = setTimeout(() => {
      entry.idleTimer = null;
      if (entry.pending.size > 0) return;
      if (this.workers.get(entry.tsModulePath) !== entry) return;
      this.workers.delete(entry.tsModulePath);
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

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

/**
 * Process-wide worker pool. Shared so a burst of agent calls reuses one warm
 * compiler thread instead of spawning one per provider instance.
 */
export const tsDiagnosticsWorker = new TsDiagnosticsWorker();
