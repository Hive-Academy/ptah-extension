/**
 * SqliteIntegrityService — the single owner of "is an integrity check due, and
 * if so, run one out of band" (TASK_2026_380 B1).
 *
 * WHAT IT REPLACES. `SqliteConnectionService.runBootChecks` ran `quick_check`
 * and `foreign_key_check` inside `openAndMigrate`, after `this.database = db`
 * and before the migration runner — so `isOpen` was already true while the
 * pragma blocked, and every renderer IPC reply queued behind the one `await`
 * the post-window boot makes. Measured 2026-09-06 against a real 1 000.7 MB
 * `~/.ptah/state/ptah.sqlite`: `quick_check` 1868 ms WARM, 20-26 s cold at
 * launch; `foreign_key_check` 27 ms. That method is DELETED, not disabled —
 * it was wrapped in try/catch and never marked the connection unavailable, so
 * it gated nothing and moving it out of band is behaviour-preserving.
 *
 * PUBLIC SURFACE IS EXACTLY `isDue(now?)`, `dispatchIfDue(options?)` AND
 * `dispose()`. Nothing else is exported from the class, because every other
 * question — when to call, from which host, on what cadence — belongs to the
 * caller.
 *
 * THE WORKER IS A HOST-LIFETIME RESOURCE, so it is cancellable two ways: an
 * `AbortSignal` handed to `dispatchIfDue` (the boot signal, so a quit during the
 * 60 s boot window kills the child), and the synchronous `dispose()` the host's
 * teardown chain calls. Both do the same thing — kill the worker, write NO
 * record, release the single-flight flag — because an interrupted check is
 * inconclusive, exactly like a worker that exited before replying.
 *
 * `dispatchIfDue()` NEVER THROWS AND NEVER REJECTS. It is called from a boot
 * timer and from a cron handler, neither of which has anywhere to put an error,
 * and an integrity check failing to run is not a reason for anything else to
 * fail. Every failure path resolves.
 *
 * AN INCONCLUSIVE CHECK WRITES NO RECORD. A worker `error` response, an exit
 * before a result, or an `'unavailable'` verdict all warn and persist nothing,
 * so the next window retries rather than remembering an unasked question as a
 * clean answer. This is `backup.service.ts:44-53`'s rule.
 */
import { inject, injectable } from 'tsyringe';
import { TOKENS, type Logger } from '@ptah-extension/vscode-core';
import { PERSISTENCE_TOKENS } from '../di/tokens';
import { IntegrityCheckStateStore } from './integrity-check-state.store';
import type {
  IIntegrityWorkerProcess,
  IIntegrityWorkerProcessFactory,
} from './worker-process.port';
import type {
  IntegrityCheckRequest,
  IntegrityCheckResponse,
  IntegrityCheckOutbound,
} from './integrity-worker-protocol';

/**
 * How stale a clean record may get before another check is due.
 *
 * Seven days, not twenty-four hours: this is a corruption canary over a file
 * that is only ever written by one process family, and the check costs a cold
 * gigabyte read. `SKILL_MD_MIGRATION_RESCAN_INTERVAL_MS`'s 24 h ceiling is the
 * counter-example — a user who launches roughly once a day trips it on roughly
 * every launch, which is the exact fault this task exists to stop repeating.
 */
export const DB_INTEGRITY_CHECK_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * How long the worker may run before it is killed and the attempt abandoned.
 *
 * Generous on purpose: the measured cold cost on a 1 GB file is 20-26 s, and a
 * larger file on a slower disk is legitimately slower still. The budget exists
 * so the worker cannot OUTLIVE THE HOST, not to police its speed — a kill is
 * recorded as inconclusive and writes no record, so a budget set too tight
 * would silently mean "never checked" forever.
 */
export const INTEGRITY_WORKER_BUDGET_MS = 5 * 60 * 1000;

@injectable()
export class SqliteIntegrityService {
  /**
   * A dispatch is in flight. Set SYNCHRONOUSLY, before the first `await`, so
   * two `dispatchIfDue()` calls in the same tick produce one spawn.
   */
  private dispatching = false;
  /** The "no worker factory in this host" line is worth saying exactly once. */
  private noFactoryLogged = false;
  /**
   * Kills the worker of the run that is in flight, or `null` when none is.
   *
   * Set inside {@link runWorker} and cleared the moment that run settles, so
   * both {@link dispose} and an `AbortSignal` reach exactly the run they meant
   * to and never a stale one.
   */
  private abortInFlight: (() => void) | null = null;

  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(PERSISTENCE_TOKENS.SQLITE_DB_PATH)
    private readonly dbPath: string,
    @inject(IntegrityCheckStateStore)
    private readonly store: IntegrityCheckStateStore,
    @inject(PERSISTENCE_TOKENS.INTEGRITY_WORKER_PROCESS_FACTORY, {
      isOptional: true,
    })
    private readonly factory: IIntegrityWorkerProcessFactory | null = null,
  ) {}

  /**
   * Is a check due as of `now`?
   *
   * Due when there is NO record (absence means never checked); when the record
   * is at least `DB_INTEGRITY_CHECK_INTERVAL_MS` old; when it is stamped in the
   * FUTURE (clock skew — "I cannot date this", the same reasoning as
   * `skill-md-migration.ts:222-225`); or when the last verdict was not clean.
   *
   * Every uncertainty resolves towards running a check. The store already
   * returns `null` on any read failure for the same reason: the worst outcome
   * of an unnecessary check is one out-of-band worker run, and the worst
   * outcome of a skipped one is undetected corruption.
   */
  isDue(now: number = Date.now()): boolean {
    const state = this.store.read();
    if (!state) return true;
    if (!state.quickCheckOk) return true;
    if (state.foreignKeyViolations > 0) return true;
    if (state.checkedAt > now) return true;
    return now - state.checkedAt >= DB_INTEGRITY_CHECK_INTERVAL_MS;
  }

  /**
   * Run a check if one is due. Resolves when the attempt is over; resolves
   * immediately when nothing is due, when one is already in flight, when this
   * host has no worker factory, or when `signal` is ALREADY aborted. Never
   * throws, never rejects.
   *
   * `signal` is the caller's lifetime, not a deadline — the boot signal in the
   * Electron host, so a quit during the 60 s boot window kills the child instead
   * of leaving it reading a gigabyte file behind a dying parent. An abort in
   * flight writes NO record: an interrupted check is inconclusive, so the next
   * window asks again.
   */
  async dispatchIfDue(options?: { signal?: AbortSignal }): Promise<void> {
    if (options?.signal?.aborted) {
      this.logger.debug(
        '[persistence-sqlite] integrity dispatch skipped; already aborted',
      );
      return;
    }
    if (this.dispatching) return;

    const factory = this.factory;
    if (!factory) {
      if (!this.noFactoryLogged) {
        this.noFactoryLogged = true;
        this.logger.info(
          '[persistence-sqlite] no integrity worker factory registered; skipping integrity checks in this host',
        );
      }
      return;
    }

    try {
      if (!this.isDue()) return;
    } catch (error: unknown) {
      // `isDue` reads through a store that already swallows; this catch exists
      // because the contract is "never throws", not because a path is known.
      this.logger.warn('[persistence-sqlite] integrity due-check failed', {
        error: error instanceof Error ? error.message : String(error),
      });
      return;
    }

    this.dispatching = true;
    try {
      const outcome = await this.runWorker(factory, options?.signal);
      if (outcome.aborted) {
        // Not `record(null)`: that path WARNS about a worker that failed to
        // answer, and an abort is not a failure — the host asked us to stop.
        this.logger.debug(
          '[persistence-sqlite] integrity check aborted; nothing recorded',
        );
      } else {
        this.record(outcome.response);
      }
    } catch (error: unknown) {
      this.logger.warn('[persistence-sqlite] integrity check dispatch failed', {
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      this.dispatching = false;
    }
  }

  /**
   * Abort an in-flight dispatch, synchronously. Idempotent, never throws.
   *
   * The host's teardown chain calls this — it is a `nonFatal(...)` line in
   * `disposeBeforePersistence`, ahead of `SQLite close`, because a completing
   * check WRITES its verdict through {@link IntegrityCheckStateStore}. Killing
   * the worker first means there is no verdict to write, which is the point:
   * the check stays due and the next launch re-runs it.
   *
   * A no-op when nothing is in flight, and safe to call twice — the run's own
   * `settled` latch absorbs the second call.
   */
  dispose(): void {
    const abort = this.abortInFlight;
    if (!abort) return;
    try {
      abort();
    } catch (error: unknown) {
      this.logger.debug('[persistence-sqlite] integrity dispose failed', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Spawn, ask, and settle exactly once — on the reply, on an early exit, on
   * the budget expiring, or on an abort. The worker is killed on every one of
   * those four paths, so it cannot outlive the host.
   *
   * Resolves `{ aborted: true }` for the abort path so the caller can tell
   * "stopped on request" from "asked and got no answer"; only the latter is
   * worth a warning.
   */
  private runWorker(
    factory: IIntegrityWorkerProcessFactory,
    signal: AbortSignal | undefined,
  ): Promise<{
    aborted: boolean;
    response: IntegrityCheckOutbound | null;
  }> {
    return new Promise<{
      aborted: boolean;
      response: IntegrityCheckOutbound | null;
    }>((resolve) => {
      let settled = false;
      let worker: IIntegrityWorkerProcess | null = null;
      let budgetTimer: ReturnType<typeof setTimeout> | null = null;

      const settle = (
        result: IntegrityCheckOutbound | null,
        aborted = false,
      ): void => {
        if (settled) return;
        settled = true;
        this.abortInFlight = null;
        signal?.removeEventListener('abort', onAbort);
        if (budgetTimer) {
          clearTimeout(budgetTimer);
          budgetTimer = null;
        }
        try {
          worker?.kill();
        } catch (error: unknown) {
          this.logger.debug(
            '[persistence-sqlite] integrity worker kill failed',
            { error: error instanceof Error ? error.message : String(error) },
          );
        }
        resolve({ aborted, response: result });
      };

      // Named rather than inline so `removeEventListener` above can name the
      // same function; an anonymous listener would outlive every settled run.
      function onAbort(): void {
        settle(null, true);
      }

      this.abortInFlight = onAbort;
      signal?.addEventListener('abort', onAbort, { once: true });

      try {
        worker = factory.spawn();
      } catch (error: unknown) {
        this.logger.warn('[persistence-sqlite] integrity worker spawn failed', {
          error: error instanceof Error ? error.message : String(error),
        });
        settle(null);
        return;
      }

      worker.on('message', (msg: unknown) => {
        settle(this.asResponse(msg));
      });
      worker.on('exit', () => {
        // An exit before a reply is inconclusive, not clean. `settle(null)`
        // after a reply has landed is a no-op.
        settle(null);
      });

      budgetTimer = setTimeout(() => {
        this.logger.warn(
          '[persistence-sqlite] integrity worker exceeded its budget; killing',
          { budgetMs: INTEGRITY_WORKER_BUDGET_MS },
        );
        settle(null);
      }, INTEGRITY_WORKER_BUDGET_MS);
      // A pending integrity check must never hold the process open at quit.
      budgetTimer.unref?.();

      const request: IntegrityCheckRequest = {
        id: 1,
        type: 'check',
        dbPath: this.dbPath,
      };
      try {
        worker.postMessage(request);
      } catch (error: unknown) {
        this.logger.warn('[persistence-sqlite] integrity request post failed', {
          error: error instanceof Error ? error.message : String(error),
        });
        settle(null);
      }
    });
  }

  /**
   * Narrow the worker's reply. An unrecognised shape is `null` — inconclusive,
   * exactly like no reply at all — rather than a fabricated verdict.
   */
  private asResponse(msg: unknown): IntegrityCheckOutbound | null {
    if (typeof msg !== 'object' || msg === null) return null;
    const candidate = msg as Partial<IntegrityCheckOutbound>;
    if (typeof candidate.id !== 'number') return null;
    if (candidate.ok === false) return candidate as IntegrityCheckOutbound;
    if (candidate.ok !== true) return null;
    // A `BackupResponse` also carries `ok: true` and a valid `verdict`, so
    // without this it would narrow to `IntegrityCheckResponse` with
    // `foreignKeyViolations` and `pageCount` silently `undefined`. This service
    // spawns its own worker per check and never sends `type: 'backup'`, so it
    // cannot happen today — but the outbound union was widened in TASK_2026_383
    // precisely so one worker could one day serve both commands, and this is
    // the narrowing site that would be wrong on that day.
    if ((candidate as { type?: unknown }).type === 'backup') return null;
    const reply = candidate as Partial<IntegrityCheckResponse>;
    if (
      reply.verdict !== 'ok' &&
      reply.verdict !== 'corrupt' &&
      reply.verdict !== 'unavailable'
    ) {
      return null;
    }
    return reply as IntegrityCheckResponse;
  }

  /**
   * Persist a CONCLUSIVE verdict and nothing else.
   *
   * `null`, an `error` response and an `'unavailable'` verdict all write no
   * record, so the check simply re-runs in the next window. Writing one would
   * mean remembering a question we never asked as an answer.
   */
  private record(response: IntegrityCheckOutbound | null): void {
    if (!response) {
      this.logger.warn(
        '[persistence-sqlite] integrity check produced no result; not recorded',
      );
      return;
    }
    if (response.ok === false) {
      this.logger.warn('[persistence-sqlite] integrity worker reported error', {
        error: response.error,
      });
      return;
    }
    if (response.verdict === 'unavailable') {
      this.logger.warn(
        '[persistence-sqlite] integrity check inconclusive; not recorded',
        { detail: response.detail },
      );
      return;
    }

    this.store.write({
      checkedAt: Date.now(),
      quickCheckOk: response.verdict === 'ok',
      foreignKeyViolations: response.foreignKeyViolations,
      durationMs: response.durationMs,
      pageCount: response.pageCount,
      detail: response.detail,
    });

    if (response.verdict === 'corrupt') {
      this.logger.error('[persistence-sqlite] quick_check FAILED', {
        result: response.quickCheck,
        durationMs: response.durationMs,
        pageCount: response.pageCount,
      });
      return;
    }
    this.logger.info('[persistence-sqlite] integrity check passed', {
      durationMs: response.durationMs,
      pageCount: response.pageCount,
      foreignKeyViolations: response.foreignKeyViolations,
    });
  }
}
