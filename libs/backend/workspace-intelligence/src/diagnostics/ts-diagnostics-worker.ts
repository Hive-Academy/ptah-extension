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
 * One worker is shared process-wide (`tsDiagnosticsWorker`) rather than one per
 * provider instance: the `typescript` module load is the expensive part of a
 * cold worker, and there is no benefit to paying it twice. Requests need no
 * queue — the compile is synchronous inside the worker, so a second message
 * simply waits in the worker's own message queue. Ids correlate replies.
 *
 * Lifecycle: spawned on first use, `unref`'d whenever nothing is in flight so
 * it can never hold the host process open, `ref`'d while a run is outstanding
 * so the host cannot exit mid-check, and terminated after
 * `IDLE_TERMINATE_MS` of silence to give the compiler's retained ASTs back.
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
  readonly errors: readonly string[];
  /** How many configs produced an actual program. Zero means nothing was checked. */
  readonly programCount: number;
}

interface WorkerSuccess {
  id: number;
  ok: true;
  collected: CollectedDiagnostic[];
  errors: string[];
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
  private worker: Worker | null = null;
  private workerTsModulePath: string | null = null;
  private nextId = 1;
  private readonly pending = new Map<number, PendingRun>();
  private idleTimer: NodeJS.Timeout | null = null;

  /**
   * Run one type-check off-thread.
   *
   * Rejects — it never resolves a partial answer — when the worker dies, when
   * the compiler throws, or when the run exceeds `RUN_TIMEOUT_MS`. The caller
   * turns that into an `unavailable` result; reporting zero diagnostics from a
   * failed run would be the false clean this provider exists to avoid.
   */
  run(request: TsDiagnosticsRunRequest): Promise<TsDiagnosticsRunOutcome> {
    let worker: Worker;
    try {
      worker = this.ensureWorker(request.tsModulePath);
    } catch (error: unknown) {
      return Promise.reject(toError(error));
    }

    const id = this.nextId++;

    return new Promise<TsDiagnosticsRunOutcome>((resolve, reject) => {
      const timer = setTimeout(() => {
        const timedOut = new Error(
          `TypeScript diagnostics run exceeded ${RUN_TIMEOUT_MS}ms and the worker was terminated.`,
        );
        this.pending.delete(id);
        this.failAll(timedOut);
        reject(timedOut);
      }, RUN_TIMEOUT_MS);
      timer.unref?.();

      this.pending.set(id, { resolve, reject, timer });
      this.cancelIdleTimer();
      worker.ref();
      worker.postMessage({
        id,
        configPaths: [...request.configPaths],
        normRoot: request.normRoot,
      });
    });
  }

  /**
   * Terminate the worker and reject anything outstanding. Idempotent.
   *
   * Resolves only once the thread is actually gone. `Worker.terminate()` is
   * asynchronous, so a caller that fires and forgets can finish while the
   * thread is still winding down — which is what makes Jest report a worker
   * that "failed to exit gracefully".
   */
  async dispose(): Promise<void> {
    this.cancelIdleTimer();
    const worker = this.worker;
    this.failAll(new Error('TypeScript diagnostics worker was disposed.'));
    if (worker) {
      await worker.terminate();
    }
  }

  private ensureWorker(tsModulePath: string): Worker {
    if (this.worker && this.workerTsModulePath === tsModulePath) {
      return this.worker;
    }

    // A different workspace resolved a different compiler — the running worker
    // has the wrong `typescript` bound and must be replaced.
    if (this.worker) {
      this.failAll(
        new Error(
          'TypeScript diagnostics worker was replaced for a different compiler.',
        ),
      );
    }

    const worker = new Worker(TS_DIAGNOSTICS_WORKER_SOURCE, {
      eval: true,
      workerData: { tsModulePath },
    });
    worker.unref();

    worker.on('message', (raw: unknown) => {
      this.onMessage(raw as WorkerResponse);
    });
    worker.on('error', (error: Error) => {
      this.failAll(error);
    });
    worker.on('exit', (code: number) => {
      if (this.worker === worker) {
        this.worker = null;
        this.workerTsModulePath = null;
      }
      if (this.pending.size > 0) {
        this.failAll(
          new Error(`TypeScript diagnostics worker exited with code ${code}.`),
        );
      }
    });

    this.worker = worker;
    this.workerTsModulePath = tsModulePath;
    return worker;
  }

  private onMessage(message: WorkerResponse): void {
    const entry = this.pending.get(message.id);
    if (!entry) return;
    clearTimeout(entry.timer);
    this.pending.delete(message.id);

    if (message.ok) {
      entry.resolve({
        collected: message.collected,
        errors: message.errors,
        programCount: message.programCount,
      });
    } else {
      entry.reject(new Error(message.error));
    }

    this.settleIdle();
  }

  /**
   * Reject every outstanding run and drop the worker. Used for worker death,
   * timeout and disposal alike — in all three cases the thread's state is no
   * longer trustworthy, so it is replaced rather than reused.
   */
  private failAll(error: Error): void {
    const worker = this.worker;
    this.worker = null;
    this.workerTsModulePath = null;

    for (const [, entry] of this.pending) {
      clearTimeout(entry.timer);
      entry.reject(error);
    }
    this.pending.clear();

    if (worker) {
      void worker.terminate();
    }
    this.cancelIdleTimer();
  }

  private settleIdle(): void {
    if (this.pending.size > 0) return;
    const worker = this.worker;
    if (!worker) return;

    worker.unref();
    this.cancelIdleTimer();
    this.idleTimer = setTimeout(() => {
      this.idleTimer = null;
      if (this.pending.size === 0 && this.worker === worker) {
        this.worker = null;
        this.workerTsModulePath = null;
        void worker.terminate();
      }
    }, IDLE_TERMINATE_MS);
    this.idleTimer.unref?.();
  }

  private cancelIdleTimer(): void {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
  }
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

/**
 * Process-wide worker. Shared so a burst of agent calls reuses one warm
 * compiler thread instead of spawning one per provider instance.
 */
export const tsDiagnosticsWorker = new TsDiagnosticsWorker();
