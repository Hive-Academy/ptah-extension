/**
 * DbWorkerRunner — one worker round-trip, settled exactly once (TASK_2026_383
 * Batch 7).
 *
 * THIS IS THE `runWorker` LOOP THAT USED TO LIVE INSIDE `SqliteIntegrityService`,
 * lifted out unchanged in behaviour so `SqliteBackupService` can drive the same
 * worker without a second copy of it. Two implementations of "spawn, ask,
 * settle once, always kill" is exactly the duplication the repo rule forbids,
 * and the second copy is the one that would quietly stop killing its child.
 *
 * WHAT IT OWNS, precisely: spawn the worker from the caller's factory; post one
 * request; settle on the FIRST of reply / early exit / budget expiry / abort;
 * kill the worker on every one of those four paths. Nothing else. It does not
 * decide whether a run should happen, it does not persist anything, and it does
 * not interpret the reply — the caller supplies `narrow`, because only the
 * caller knows which command it sent and therefore which reply is legal.
 *
 * IT HOLDS NO PER-RUN STATE. Every mutable thing a run needs lives in the
 * closure `run()` opens, which is what makes one shared instance safe for both
 * services: `SqliteIntegrityService`'s single-flight flag stays its own, and a
 * backup in flight cannot settle an integrity check or be settled by one. The
 * caller keeps the returned {@link DbWorkerRun} and is the only thing that can
 * abort that run.
 *
 * THE BUDGET IS THE CALLER'S, not this class's. A `quick_check` and a
 * gigabyte-scale file copy are not the same amount of work, so a shared
 * constant here would have to be wrong for one of them. See
 * `INTEGRITY_WORKER_BUDGET_MS` and `BACKUP_WORKER_BUDGET_MS`.
 */
import { inject, injectable } from 'tsyringe';
import { TOKENS, type Logger } from '@ptah-extension/vscode-core';
import type {
  IIntegrityWorkerProcess,
  IIntegrityWorkerProcessFactory,
} from './worker-process.port';
import type { IntegrityWorkerInbound } from './integrity-worker-protocol';

/**
 * How a run ended.
 *
 * `aborted` separates "the host asked us to stop" from "we asked and got no
 * answer". Only the latter is worth a warning: an abort is a decision, not a
 * failure. Both produce a `null` response, because an interrupted run is
 * inconclusive exactly like a worker that exited before replying.
 */
export interface DbWorkerOutcome<TResponse> {
  readonly aborted: boolean;
  readonly response: TResponse | null;
}

/** A run in flight, plus the one thing a caller may do to it. */
export interface DbWorkerRun<TResponse> {
  /** Settles once, never rejects. */
  readonly settled: Promise<DbWorkerOutcome<TResponse>>;
  /**
   * Kill the worker and settle as aborted. Synchronous, idempotent, and never
   * throws — it is called from teardown chains that have nowhere to put an
   * error, and calling it after the run has settled is a no-op.
   */
  abort(): void;
}

export interface DbWorkerRunOptions<TResponse> {
  /**
   * Names the command in this run's log lines, e.g. `'integrity'` or
   * `'backup'`. A literal at the call site; never interpolated from data.
   */
  readonly label: string;
  /** The single message posted to the worker. */
  readonly request: IntegrityWorkerInbound;
  /** How long the worker may run before it is killed and the attempt abandoned. */
  readonly budgetMs: number;
  /**
   * Narrow the worker's reply. Returning `null` means "unrecognised", which
   * settles the run as inconclusive rather than fabricating a verdict.
   */
  readonly narrow: (msg: unknown) => TResponse | null;
  /**
   * The caller's lifetime, not a deadline. An abort kills the child rather than
   * leaving it reading a gigabyte file behind a dying parent.
   */
  readonly signal?: AbortSignal;
}

@injectable()
export class DbWorkerRunner {
  constructor(@inject(TOKENS.LOGGER) private readonly logger: Logger) {}

  /**
   * Spawn, ask, and settle exactly once — on the reply, on an early exit, on
   * the budget expiring, or on an abort. The worker is killed on every one of
   * those four paths, so it cannot outlive the host.
   *
   * Never rejects. A factory that throws on `spawn`, a `postMessage` that
   * throws, and a worker that says nothing all resolve to a `null` response.
   */
  run<TResponse>(
    factory: IIntegrityWorkerProcessFactory,
    options: DbWorkerRunOptions<TResponse>,
  ): DbWorkerRun<TResponse> {
    const { label, request, budgetMs, narrow, signal } = options;

    // Assigned synchronously inside the executor below — the Promise
    // constructor runs it before `new Promise` returns — so the handle this
    // method hands back can never carry a no-op abort.
    let abortRun: () => void = () => undefined;

    const settled = new Promise<DbWorkerOutcome<TResponse>>((resolve) => {
      let isSettled = false;
      let worker: IIntegrityWorkerProcess | null = null;
      let budgetTimer: ReturnType<typeof setTimeout> | null = null;

      const settle = (response: TResponse | null, aborted = false): void => {
        if (isSettled) return;
        isSettled = true;
        signal?.removeEventListener('abort', onAbort);
        if (budgetTimer) {
          clearTimeout(budgetTimer);
          budgetTimer = null;
        }
        try {
          worker?.kill();
        } catch (error: unknown) {
          this.logger.debug(
            `[persistence-sqlite] ${label} worker kill failed`,
            {
              error: error instanceof Error ? error.message : String(error),
            },
          );
        }
        resolve({ aborted, response });
      };

      // Named rather than inline so `removeEventListener` above can name the
      // same function; an anonymous listener would outlive every settled run.
      function onAbort(): void {
        settle(null, true);
      }

      abortRun = onAbort;
      signal?.addEventListener('abort', onAbort, { once: true });

      try {
        worker = factory.spawn();
      } catch (error: unknown) {
        this.logger.warn(`[persistence-sqlite] ${label} worker spawn failed`, {
          error: error instanceof Error ? error.message : String(error),
        });
        settle(null);
        return;
      }

      worker.on('message', (msg: unknown) => {
        settle(narrow(msg));
      });
      worker.on('exit', () => {
        // An exit before a reply is inconclusive, not clean. `settle(null)`
        // after a reply has landed is a no-op.
        settle(null);
      });

      budgetTimer = setTimeout(() => {
        this.logger.warn(
          `[persistence-sqlite] ${label} worker exceeded its budget; killing`,
          { budgetMs },
        );
        settle(null);
      }, budgetMs);
      // A pending run must never hold the process open at quit.
      budgetTimer.unref?.();

      try {
        worker.postMessage(request);
      } catch (error: unknown) {
        this.logger.warn(`[persistence-sqlite] ${label} request post failed`, {
          error: error instanceof Error ? error.message : String(error),
        });
        settle(null);
      }
    });

    return {
      settled,
      abort: (): void => {
        abortRun();
      },
    };
  }
}
