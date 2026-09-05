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
 * PUBLIC SURFACE IS EXACTLY `isDue(now?)` AND `dispatchIfDue()`. Nothing else
 * is exported from the class, because every other question — when to call,
 * from which host, on what cadence — belongs to the caller.
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
  IntegrityWorkerOutbound,
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
   * immediately when nothing is due, when one is already in flight, or when
   * this host has no worker factory. Never throws, never rejects.
   */
  async dispatchIfDue(): Promise<void> {
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
      const response = await this.runWorker(factory);
      this.record(response);
    } catch (error: unknown) {
      this.logger.warn('[persistence-sqlite] integrity check dispatch failed', {
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      this.dispatching = false;
    }
  }

  /**
   * Spawn, ask, and settle exactly once — on the reply, on an early exit, or
   * on the budget expiring. The worker is killed on every one of those three
   * paths, so it cannot outlive the host.
   */
  private runWorker(
    factory: IIntegrityWorkerProcessFactory,
  ): Promise<IntegrityWorkerOutbound | null> {
    return new Promise<IntegrityWorkerOutbound | null>((resolve) => {
      let settled = false;
      let worker: IIntegrityWorkerProcess | null = null;
      let budgetTimer: ReturnType<typeof setTimeout> | null = null;

      const settle = (result: IntegrityWorkerOutbound | null): void => {
        if (settled) return;
        settled = true;
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
        resolve(result);
      };

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
  private asResponse(msg: unknown): IntegrityWorkerOutbound | null {
    if (typeof msg !== 'object' || msg === null) return null;
    const candidate = msg as Partial<IntegrityWorkerOutbound>;
    if (typeof candidate.id !== 'number') return null;
    if (candidate.ok === false) return candidate as IntegrityWorkerOutbound;
    if (candidate.ok !== true) return null;
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
  private record(response: IntegrityWorkerOutbound | null): void {
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
