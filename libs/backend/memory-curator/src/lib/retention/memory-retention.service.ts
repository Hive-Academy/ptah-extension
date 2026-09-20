/**
 * MemoryRetentionService — decides whether a retention run happens now, runs
 * it inside hard budgets, and records the result (TASK_2026_440).
 *
 * The cron job ticks HOURLY and this service decides whether the tick does
 * work: the last completed run is 24 h old, or the last run left a backlog. A
 * literal daily cron would be fired by boot catch-up at every morning launch
 * and then deferred, so it would never run for a user who is closed at the
 * slot time.
 * ## Gates, in order
 *
 * 1. `memory.retention.enabled === false` → `disabled`
 * 2. a run already in flight → `already-running` (flag set before any `await`)
 * 3. constructed less than 10 min ago → `boot-deferred`
 * 4. on battery → `on-battery`
 * 5. foreground chat activity in the last 5 min → `foreground-active`
 * 6. the run's signal aborted → `aborted`
 * 7. the connection is closed → `persistence-unavailable` (writes nothing)
 * 8. nothing due → `not-due` (writes nothing — an hourly tick costs one state read)
 *
 * The connection check sits before the due check because the due check is a
 * database read: a closed connection cannot answer it.
 * ## Run steps
 *
 * Processed purge → stuck quarantine → ledger prune → page reclaim +
 * passive checkpoint → record. Between committed batches the service checks
 * every hard stop and yields; slow batches and reclaim steps halve their size.
 *
 * `run` never rejects and always clears the single-flight flag. Nothing here
 * writes `processed_at`.
 */
import { inject, injectable } from 'tsyringe';
import {
  TOKENS,
  type BackgroundWorkAdmission,
  type Logger,
} from '@ptah-extension/vscode-core';
import {
  PLATFORM_TOKENS,
  type IWorkspaceProvider,
} from '@ptah-extension/platform-core';
import {
  PERSISTENCE_TOKENS,
  SqliteConnectionService,
  SqlitePageReclaimer,
  type SqlitePageStats,
} from '@ptah-extension/persistence-sqlite';
import type { MemoryStorageHealthDto } from '@ptah-extension/shared';
import { MEMORY_TOKENS } from '../di/tokens';
import {
  MemoryLifecycleService,
  type MemoryLifecycleStepResult,
} from './memory-lifecycle.service';
import {
  DAY_MS,
  MEMORY_RETENTION_DEFAULTS,
  type MemoryRetentionLimits,
  type MemoryRetentionSettings,
  readMemoryRetentionSettings,
} from './memory-retention-config';
import type {
  MemoryRetentionReport,
  MemoryRetentionRunOptions,
  MemoryRetentionRunReport,
  RetentionSkipReason,
  RetentionStopReason,
} from './memory-retention.types';
import {
  ObservationRetentionStore,
  RetentionStepError,
  type RetentionState,
} from './observation-retention.store';
import { RetentionRunBudget } from './retention-run-budget';
import { readMemoryStorageHealth } from './memory-storage-health';

/** `PRAGMA auto_vacuum` value meaning INCREMENTAL. */
const AUTO_VACUUM_INCREMENTAL = 2;

function isRowBudgetStop(stop: RetentionStopReason | null): boolean {
  return stop === 'row-budget' || stop === 'memory-row-budget';
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Strip absolute paths from text that is persisted and shown in the UI. Same
 * rule as the persistence RPC handler's `sanitiseErrorMessage`.
 */
export function sanitizeRetentionError(message: string): string {
  return (
    message
      .replace(/[A-Za-z]:[/\\][^\s,'"]+/g, '[path redacted]')
      .replace(/\\\\[^\s,'"]+/g, '[path redacted]')
      .replace(/(?<=^|[\s'"(=]|:\s)\/[^\s,'"/]+\/[^\s,'"]+/g, '[path redacted]')
      // Home-directory paths are redacted anywhere, even mid-token (`(file)/home/…`).
      .replace(/\/(?:home|Users|root)\/[^\s,'"]+/g, '[path redacted]')
  );
}

/**
 * Bytes the processed purge moved onto the freelist, or `null` when either
 * page-stat sample is unusable. `readPageStats` degrades a failed read to
 * zeros, and a zero "before" freelist would credit this purge with every page
 * that was already free.
 */
function purgeFreedBytes(
  before: SqlitePageStats,
  after: SqlitePageStats,
): number | null {
  const valid = (s: SqlitePageStats): boolean =>
    s.pageSize > 0 &&
    Number.isFinite(s.pageSize) &&
    Number.isFinite(s.freelistCount) &&
    s.freelistCount >= 0;
  if (!valid(before) || !valid(after) || before.pageSize !== after.pageSize) {
    return null;
  }
  return (
    Math.max(0, after.freelistCount - before.freelistCount) * after.pageSize
  );
}

/** Mutable tallies of one run. */
interface RunTally {
  processedPurged: number;
  stuckQuarantined: number;
  ledgerPruned: number;
  freedBytes: number;
  /** Both purge page-stat samples were valid, so `freedBytes` is a measurement. */
  freedBytesMeasured: boolean;
  pagesReclaimed: number;
}

@injectable()
export class MemoryRetentionService {
  /** Captured at construction: the boot-deferral gate measures from here. */
  private readonly startedAt = Date.now();

  /** Set synchronously before the first `await`; cleared in `finally`. */
  private running = false;

  /** Advisory read failures from the latest lifecycle step in this process. */
  private lifecycleReadErrors: readonly string[] = [];

  /** Consecutive eligible ticks held only by foreground activity. */
  private consecutiveForegroundSkips = 0;

  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(PLATFORM_TOKENS.WORKSPACE_PROVIDER)
    private readonly workspace: IWorkspaceProvider,
    @inject(PERSISTENCE_TOKENS.SQLITE_CONNECTION)
    private readonly sqlite: SqliteConnectionService,
    @inject(PERSISTENCE_TOKENS.SQLITE_PAGE_RECLAIMER)
    private readonly reclaimer: SqlitePageReclaimer,
    @inject(MEMORY_TOKENS.OBSERVATION_RETENTION_STORE)
    private readonly store: ObservationRetentionStore,
    @inject(MEMORY_TOKENS.MEMORY_RETENTION_LIMITS)
    private readonly limits: MemoryRetentionLimits,
    @inject(MEMORY_TOKENS.MEMORY_LIFECYCLE_SERVICE)
    private readonly lifecycle: MemoryLifecycleService,
    /**
     * Optional and LAST: specs construct this service positionally, and a host
     * without a governor runs ungoverned.
     */
    @inject(TOKENS.BACKGROUND_WORK_GOVERNOR, { isOptional: true })
    private readonly governor: BackgroundWorkAdmission | null = null,
  ) {}

  /** Run retention if every gate is open and a run is due. Never rejects. */
  async run(
    options: MemoryRetentionRunOptions,
  ): Promise<MemoryRetentionReport> {
    const now = options.now ?? Date.now;
    const settings = this.readSettings();
    if (!settings.enabled) return this.skip('disabled', now());
    if (this.running) return this.skip('already-running', now());

    this.running = true;
    const startedAt = now();
    try {
      return await this.gateAndExecute(options, settings, now, startedAt);
    } catch (error: unknown) {
      // Only reachable from a gate input that threw (for example a power
      // monitor) — every step failure is handled inside `execute`.
      const message = sanitizeRetentionError(errorText(error));
      this.logger.warn('[memory-curator] memory retention failed', {
        error: message,
      });
      return {
        status: 'failed',
        reason: 'unexpected-error',
        processedPurged: 0,
        stuckQuarantined: 0,
        ledgerPruned: 0,
        freedBytes: 0,
        pagesReclaimed: 0,
        memoriesArchived: 0,
        memoriesDeleted: 0,
        memoriesEvicted: 0,
        lifecycleNote: null,
        backlogRemaining: true,
        durationMs: Math.max(0, now() - startedAt),
        error: message,
      };
    } finally {
      this.running = false;
    }
  }

  /**
   * Storage numbers and the last run for the diagnostics panel. Index-bounded
   * reads only: processed rows and bytes come from the last run's record, never
   * from a live count. Never throws.
   */
  storageHealth(): MemoryStorageHealthDto {
    const settings = this.readSettings();
    return readMemoryStorageHealth({
      workspace: this.workspace,
      reclaimer: this.reclaimer,
      store: this.store,
      logger: this.logger,
      settings,
      intervalMs: this.limits.intervalMs,
      lifecycleReadErrors: this.lifecycleReadErrors,
      sanitizeError: sanitizeRetentionError,
    });
  }

  private async gateAndExecute(
    options: MemoryRetentionRunOptions,
    settings: MemoryRetentionSettings,
    now: () => number,
    startedAt: number,
  ): Promise<MemoryRetentionReport> {
    if (startedAt - this.startedAt < this.limits.bootDeferralMs) {
      return this.skip('boot-deferred', startedAt);
    }
    if (options.isOnBattery()) return this.skip('on-battery', startedAt);
    const foregroundActive =
      options.msSinceForegroundActivity() < this.limits.foregroundBackoffMs;
    let allowForegroundWork = false;
    if (foregroundActive) {
      if (
        this.consecutiveForegroundSkips <
        this.limits.foregroundMaxConsecutiveSkips
      ) {
        this.consecutiveForegroundSkips++;
        return this.skip('foreground-active', startedAt);
      }
      allowForegroundWork = true;
    } else {
      this.consecutiveForegroundSkips = 0;
    }
    if (options.signal.aborted) return this.skip('aborted', startedAt);

    try {
      if (!this.sqlite.db) {
        return { status: 'skipped', reason: 'persistence-unavailable' };
      }
    } catch {
      // The `db` getter throws `RpcUserError` while the connection is closed.
      return { status: 'skipped', reason: 'persistence-unavailable' };
    }

    const state = this.store.readState();
    if (
      state !== null &&
      !state.backlogRemaining &&
      state.lastCompletedAt !== null &&
      startedAt - state.lastCompletedAt < this.limits.intervalMs
    ) {
      return { status: 'skipped', reason: 'not-due' };
    }

    if (allowForegroundWork) {
      this.consecutiveForegroundSkips = 0;
      this.logger.info(
        '[memory-curator] forcing retention after sustained foreground activity',
        { skippedAttempts: this.limits.foregroundMaxConsecutiveSkips },
      );
    }

    return this.execute(
      options,
      settings,
      now,
      startedAt,
      state,
      allowForegroundWork,
    );
  }

  private async execute(
    options: MemoryRetentionRunOptions,
    settings: MemoryRetentionSettings,
    now: () => number,
    startedAt: number,
    previous: RetentionState | null,
    allowForegroundWork: boolean,
  ): Promise<MemoryRetentionRunReport> {
    const limits = this.limits;
    const tally: RunTally = {
      processedPurged: 0,
      stuckQuarantined: 0,
      ledgerPruned: 0,
      freedBytes: 0,
      freedBytesMeasured: false,
      pagesReclaimed: 0,
    };
    const budget = new RetentionRunBudget({
      options,
      limits,
      now,
      startedAt,
      logger: this.logger,
      governor: this.governor,
      queueBatchSize: settings.batchSize,
      archiveBatchSize: settings.batchSize,
      deleteBatchSize: limits.memoryDeleteBatchSize,
      allowForegroundWork,
    });
    let stop: RetentionStopReason | null = null;
    let failure: RetentionStepError | Error | null = null;
    let reclaimNote: RetentionStopReason | null = null;
    let reclaimDone = false;
    let lifecycleResult: MemoryLifecycleStepResult = {
      archived: 0,
      deleted: 0,
      evicted: 0,
      exhausted: false,
      stop: null,
      note: null,
      preview: null,
      readErrors: [],
      error: null,
    };

    try {
      // 1. Processed purge — `processed_at` older than processedDays.
      const purgeCutoff = startedAt - settings.processedDays * DAY_MS;
      const pagesBefore = this.reclaimer.readPageStats();
      let cursor = '';
      let purgeExhausted = false;
      while (!purgeExhausted) {
        stop = budget.hardStop();
        if (stop) break;
        const rowRoom = budget.queueRowRoom();
        if (rowRoom <= 0) {
          stop = 'row-budget';
          break;
        }
        stop = await budget.waitForGovernor('queue');
        if (stop) break;
        const t0 = now();
        const batch = this.store.purgeProcessedBatch(
          purgeCutoff,
          Math.min(budget.batchSize('queue'), rowRoom),
          cursor,
        );
        const durationMs = now() - t0;
        tally.processedPurged += batch.deleted;
        budget.consumeQueueRows(batch.deleted);
        cursor = batch.nextCursor;
        purgeExhausted = batch.exhausted;
        this.logger.debug('[memory-curator] retention purge batch', {
          deleted: batch.deleted,
          durationMs,
        });
        budget.observe('queue', durationMs);
        if (!purgeExhausted) await budget.yieldToEventLoop();
      }
      const pagesAfterPurge = this.reclaimer.readPageStats();
      const freed = purgeFreedBytes(pagesBefore, pagesAfterPurge);
      tally.freedBytes = freed ?? 0;
      tally.freedBytesMeasured = freed !== null;

      // 2. Stuck quarantine — unprocessed and captured before stuckDays.
      if (!stop) {
        const stuckCutoff = startedAt - settings.stuckDays * DAY_MS;
        for (;;) {
          stop = budget.hardStop();
          if (stop) break;
          const rowRoom = budget.queueRowRoom();
          if (rowRoom <= 0) {
            stop = 'row-budget';
            break;
          }
          stop = await budget.waitForGovernor('queue');
          if (stop) break;
          const t0 = now();
          const batch = this.store.quarantineStuckBatch(
            stuckCutoff,
            Math.min(budget.batchSize('queue'), rowRoom),
            startedAt,
          );
          const durationMs = now() - t0;
          tally.stuckQuarantined += batch.quarantined;
          budget.consumeQueueRows(batch.quarantined);
          this.logger.debug('[memory-curator] retention quarantine batch', {
            quarantined: batch.quarantined,
            payloadBytes: batch.payloadBytes,
            durationMs,
          });
          budget.observe('queue', durationMs);
          if (batch.quarantined === 0) break;
          await budget.yieldToEventLoop();
        }
      }

      if (stop === null || stop === 'row-budget') {
        this.lifecycleReadErrors = [];
        lifecycleResult = await this.lifecycle.runStep(budget, startedAt);
        this.lifecycleReadErrors = lifecycleResult.readErrors;
        if (lifecycleResult.error) throw lifecycleResult.error;
        if (lifecycleResult.stop !== null && stop === null) {
          stop = lifecycleResult.stop;
        }
      }

      // A row-budget stop ends only the row steps: the ledger prune and the
      // page reclaim are bounded on their own and return space sooner.
      const continueAfterRows = stop === null || isRowBudgetStop(stop);

      // 3. Ledger prune — once per run.
      if (continueAfterRows && budget.hardStop() === null) {
        const pruneStop = await budget.waitForGovernor();
        if (pruneStop) {
          stop = pruneStop;
        } else {
          tally.ledgerPruned = this.store.pruneLedger(
            startedAt - limits.ledgerMaxAgeMs,
            limits.ledgerMaxRows,
          ).pruned;
        }
      }

      // 4. Page reclaim.
      if (continueAfterRows && (stop === null || isRowBudgetStop(stop))) {
        const reclaim = await this.reclaimPages(budget, tally);
        reclaimDone = reclaim.done;
        reclaimNote = reclaim.note;
        if (reclaim.stop && stop === null) {
          stop = reclaim.stop;
        }
      }
    } catch (error: unknown) {
      if (
        error instanceof RetentionStepError &&
        error.reason === 'database-busy'
      ) {
        stop = 'database-busy';
      } else {
        failure = error instanceof Error ? error : new Error(String(error));
      }
    }

    return this.finish({
      startedAt,
      now,
      settings,
      tally,
      stop,
      failure,
      reclaimDone,
      reclaimNote,
      previous,
      lifecycleResult,
    });
  }

  /** Bounded `incremental_vacuum` steps, then a passive WAL checkpoint. */
  private async reclaimPages(
    budget: RetentionRunBudget,
    tally: RunTally,
  ): Promise<{
    done: boolean;
    note: RetentionStopReason | null;
    stop: RetentionStopReason | null;
  }> {
    const limits = this.limits;
    const stats = this.reclaimer.readPageStats();
    if (stats.autoVacuumMode !== AUTO_VACUUM_INCREMENTAL) {
      return { done: true, note: 'auto-vacuum-not-incremental', stop: null };
    }
    let freelist = stats.freelistCount;
    let step = limits.reclaimPagesPerStep;
    let stop: RetentionStopReason | null = null;
    let steps = 0;
    while (freelist > 0) {
      stop = budget.hardStop();
      if (stop) break;
      const room = limits.maxReclaimPagesPerRun - tally.pagesReclaimed;
      if (room <= 0) {
        stop = 'reclaim-budget';
        break;
      }
      stop = await budget.waitForGovernor();
      if (stop) break;
      const result = this.reclaimer.reclaimStep(Math.min(step, room, freelist));
      steps++;
      tally.pagesReclaimed += result.pagesReclaimed;
      this.logger.debug('[memory-curator] retention reclaim step', {
        pagesReclaimed: result.pagesReclaimed,
        durationMs: result.durationMs,
      });
      if (result.pagesReclaimed === 0) {
        stop = 'reclaim-stalled';
        break;
      }
      freelist -= result.pagesReclaimed;
      if (
        result.durationMs > limits.slowCallMs &&
        step > limits.minReclaimPagesPerStep
      ) {
        step = Math.max(limits.minReclaimPagesPerStep, Math.floor(step / 2));
      }
      if (freelist > 0) await budget.yieldToEventLoop();
    }
    if (steps > 0) this.reclaimer.checkpointPassive();
    return { done: freelist <= 0, note: null, stop };
  }

  /** Map the run to an outcome, record it, and log once. */
  private finish(input: {
    startedAt: number;
    now: () => number;
    settings: MemoryRetentionSettings;
    tally: RunTally;
    stop: RetentionStopReason | null;
    failure: Error | null;
    reclaimDone: boolean;
    reclaimNote: RetentionStopReason | null;
    previous: RetentionState | null;
    lifecycleResult: MemoryLifecycleStepResult;
  }): MemoryRetentionRunReport {
    const { startedAt, now, settings, tally, stop, failure } = input;
    let status: MemoryRetentionRunReport['status'];
    let reason: string | null;
    let error: string | null = null;
    if (failure) {
      status = 'failed';
      reason =
        failure instanceof RetentionStepError
          ? failure.reason
          : 'unexpected-error';
      error = sanitizeRetentionError(failure.message);
    } else if (stop !== null) {
      status = 'partial';
      reason = stop;
    } else if (!input.lifecycleResult.exhausted) {
      status = 'partial';
      reason = input.lifecycleResult.stop ?? 'memory-row-budget';
    } else if (!input.reclaimDone) {
      status = 'partial';
      reason = 'reclaim-budget';
    } else {
      status = 'completed';
      reason = input.reclaimNote;
    }

    const finishedAt = now();
    const durationMs = Math.max(0, finishedAt - startedAt);
    const report: MemoryRetentionRunReport = {
      status,
      reason,
      processedPurged: tally.processedPurged,
      stuckQuarantined: tally.stuckQuarantined,
      ledgerPruned: tally.ledgerPruned,
      freedBytes: tally.freedBytes,
      pagesReclaimed: tally.pagesReclaimed,
      memoriesArchived: input.lifecycleResult.archived,
      memoriesDeleted: input.lifecycleResult.deleted,
      memoriesEvicted: input.lifecycleResult.evicted,
      lifecycleNote: input.lifecycleResult.note,
      backlogRemaining: status !== 'completed',
      durationMs,
      error,
    };

    this.record(
      report,
      startedAt,
      finishedAt,
      settings,
      tally.freedBytesMeasured,
      input.lifecycleResult,
    );

    if (status === 'failed') {
      this.logger.warn('[memory-curator] memory retention failed', {
        reason,
        error,
        processedPurged: report.processedPurged,
        stuckQuarantined: report.stuckQuarantined,
      });
    } else {
      this.logger.info('[memory-curator] memory retention run finished', {
        status,
        reason,
        processedPurged: report.processedPurged,
        stuckQuarantined: report.stuckQuarantined,
        ledgerPruned: report.ledgerPruned,
        freedBytes: report.freedBytes,
        pagesReclaimed: report.pagesReclaimed,
        memoriesArchived: report.memoriesArchived,
        memoriesDeleted: report.memoriesDeleted,
        memoriesEvicted: report.memoriesEvicted,
        lifecycleNote: report.lifecycleNote,
        preview: input.lifecycleResult.preview,
        durationMs,
      });
    }
    return report;
  }

  /** Persist the run. A failure to record is logged, never thrown. */
  private record(
    report: MemoryRetentionRunReport,
    startedAt: number,
    finishedAt: number,
    settings: MemoryRetentionSettings,
    freedBytesMeasured: boolean,
    lifecycleResult: MemoryLifecycleStepResult,
  ): void {
    let processedRowsAfter: number | null = null;
    try {
      const pending = this.store.readLiveStorage(
        startedAt - settings.stuckDays * DAY_MS,
      ).pendingRows;
      if (pending !== null) {
        processedRowsAfter = Math.max(0, this.store.countTotalRows() - pending);
      }
    } catch (error: unknown) {
      this.logger.debug('[memory-curator] retention row count failed', {
        error: errorText(error),
      });
    }
    try {
      this.store.writeRun({
        startedAt,
        finishedAt,
        outcome: report.status,
        reason: report.reason,
        error: report.error,
        durationMs: report.durationMs,
        processedPurged: report.processedPurged,
        stuckQuarantined: report.stuckQuarantined,
        ledgerPruned: report.ledgerPruned,
        freedBytes: report.freedBytes,
        pagesReclaimed: report.pagesReclaimed,
        backlogRemaining: report.backlogRemaining,
        completedAt: report.status === 'completed' ? finishedAt : null,
        processedRowsAfter,
        // `null` keeps the previous average: an unmeasured run must not
        // replace it with one derived from an invalid page-stat sample.
        avgProcessedRowBytes:
          freedBytesMeasured && report.processedPurged > 0
            ? Math.round(report.freedBytes / report.processedPurged)
            : null,
        memoriesArchived: report.memoriesArchived,
        memoriesDeleted: report.memoriesDeleted,
        memoriesEvicted: report.memoriesEvicted,
        lifecycleNote: report.lifecycleNote,
        preview: lifecycleResult.preview,
      });
    } catch (error: unknown) {
      this.logger.warn('[memory-curator] retention run record not written', {
        error: sanitizeRetentionError(errorText(error)),
      });
    }
  }

  private skip(
    reason: RetentionSkipReason,
    atMs: number,
  ): MemoryRetentionReport {
    try {
      this.store.writeSkip(atMs, reason);
    } catch (error: unknown) {
      this.logger.debug('[memory-curator] retention skip not recorded', {
        reason,
        error: errorText(error),
      });
    }
    return { status: 'skipped', reason };
  }

  private readSettings(): MemoryRetentionSettings {
    try {
      return readMemoryRetentionSettings(this.workspace);
    } catch (error: unknown) {
      this.logger.warn('[memory-curator] retention settings unreadable', {
        error: errorText(error),
      });
      return MEMORY_RETENTION_DEFAULTS;
    }
  }
}
