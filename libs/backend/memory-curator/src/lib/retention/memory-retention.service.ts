/**
 * MemoryRetentionService — decides whether a retention run happens now, runs
 * it inside hard budgets, and records the result (TASK_2026_440).
 *
 * The cron job ticks HOURLY and this service decides whether the tick does
 * work: the last completed run is 24 h old, or the last run left a backlog. A
 * literal daily cron would be fired by boot catch-up at every morning launch
 * and then deferred, so it would never run for a user who is closed at the
 * slot time.
 *
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
 *
 * ## Run steps
 *
 * processed purge → stuck quarantine → ledger prune → page reclaim +
 * passive checkpoint → record. Every batch is one committed transaction; between
 * batches the service re-checks abort, battery, foreground and the wall budget,
 * then yields with `setImmediate`. A batch slower than 120 ms halves the batch
 * size for the rest of the run, and a slow reclaim step halves the step.
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
import type {
  MemoryRetentionRunDto,
  MemoryStorageHealthDto,
} from '@ptah-extension/shared';
import { MEMORY_TOKENS } from '../di/tokens';
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

/** `PRAGMA auto_vacuum` value meaning INCREMENTAL. */
const AUTO_VACUUM_INCREMENTAL = 2;

const GOVERNOR_LANE = 'memory-retention';

const RUN_OUTCOMES: ReadonlySet<string> = new Set([
  'completed',
  'partial',
  'failed',
]);

function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Strip absolute paths from text that is persisted and shown in the UI. Same
 * rule as the persistence RPC handler's `sanitiseErrorMessage`.
 */
export function sanitizeRetentionError(message: string): string {
  return message
    .replace(/[A-Za-z]:[/\\][^\s,'"]+/g, '[path redacted]')
    .replace(/\\\\[^\s,'"]+/g, '[path redacted]')
    .replace(/\/(?:home|Users|root)\/[^\s,'"]+/g, '[path redacted]');
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
    const readErrors: string[] = [];
    const settings = this.readSettings();
    const nowMs = Date.now();

    const stats = this.reclaimer.readPageStats();
    const statsKnown = stats.pageSize > 0;
    if (!statsKnown) readErrors.push('pageStats: unavailable');

    const live = this.store.readLiveStorage(
      nowMs - settings.stuckDays * DAY_MS,
    );
    readErrors.push(...live.readErrors);

    let state: RetentionState | null = null;
    try {
      state = this.store.readState();
    } catch (error: unknown) {
      readErrors.push(`retentionState: ${errorText(error)}`);
    }

    const processedRows = state?.processedRowsAfter ?? null;
    const avgBytes = state?.avgProcessedRowBytes ?? null;

    return {
      dbBytes: statsKnown ? stats.pageCount * stats.pageSize : null,
      reclaimableBytes: statsKnown
        ? stats.freelistCount * stats.pageSize
        : null,
      autoVacuumIncremental: statsKnown
        ? stats.autoVacuumMode === AUTO_VACUUM_INCREMENTAL
        : null,
      observations: {
        pendingRows: live.pendingRows,
        pendingBytes: live.pendingBytes,
        oldestPendingAt: live.oldestPendingAt,
        stuckEligibleRows: live.stuckEligibleRows,
        processedRows,
        processedBytesEstimate:
          processedRows !== null && avgBytes !== null
            ? processedRows * avgBytes
            : null,
        measuredAt:
          processedRows !== null ? (state?.lastFinishedAt ?? null) : null,
        quarantineLedgerRows: live.quarantineLedgerRows,
      },
      retention: {
        enabled: settings.enabled,
        processedDays: settings.processedDays,
        stuckDays: settings.stuckDays,
        lastRun: state ? this.toRunDto(state) : null,
        lastCompletedAt: state?.lastCompletedAt ?? null,
        nextDueAt: state ? this.nextDueAt(state) : null,
        lastSkippedAt: state?.lastSkippedAt ?? null,
        lastSkipReason: state?.lastSkipReason ?? null,
      },
      ...(readErrors.length > 0
        ? { readErrors: readErrors.map(sanitizeRetentionError) }
        : {}),
    };
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
    if (options.msSinceForegroundActivity() < this.limits.foregroundBackoffMs) {
      return this.skip('foreground-active', startedAt);
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

    return this.execute(options, settings, now, startedAt, state);
  }

  private async execute(
    options: MemoryRetentionRunOptions,
    settings: MemoryRetentionSettings,
    now: () => number,
    startedAt: number,
    previous: RetentionState | null,
  ): Promise<MemoryRetentionRunReport> {
    const limits = this.limits;
    const deadline = startedAt + limits.maxRunMs;
    const msLeft = (): number => deadline - now();
    const tally: RunTally = {
      processedPurged: 0,
      stuckQuarantined: 0,
      ledgerPruned: 0,
      freedBytes: 0,
      freedBytesMeasured: false,
      pagesReclaimed: 0,
    };
    let batchSize = settings.batchSize;
    let stop: RetentionStopReason | null = null;
    let failure: RetentionStepError | Error | null = null;
    let reclaimNote: RetentionStopReason | null = null;
    let reclaimDone = false;

    const rowsUsed = (): number =>
      tally.processedPurged + tally.stuckQuarantined;
    /** Abort, battery, foreground or wall budget — ends every remaining step. */
    const hardStop = (): RetentionStopReason | null => {
      if (options.signal.aborted) return 'aborted';
      if (options.isOnBattery()) return 'on-battery';
      if (options.msSinceForegroundActivity() < limits.foregroundBackoffMs) {
        return 'foreground-active';
      }
      if (now() >= deadline) return 'time-budget';
      return null;
    };
    const adaptBatch = (durationMs: number): void => {
      if (durationMs > limits.slowCallMs && batchSize > limits.minBatchSize) {
        batchSize = Math.max(limits.minBatchSize, Math.floor(batchSize / 2));
        this.logger.debug('[memory-curator] retention batch slow; halved', {
          durationMs,
          batchSize,
        });
      }
    };

    const governorWarned = { value: false };
    const yieldGovernor = async (): Promise<RetentionStopReason | null> => {
      const outcome = await this.yieldToGovernor(
        options.signal,
        governorWarned,
        msLeft,
      );
      if (outcome === 'aborted') return 'aborted';
      return hardStop();
    };

    try {
      // 1. Processed purge — `processed_at` older than processedDays.
      const purgeCutoff = startedAt - settings.processedDays * DAY_MS;
      const pagesBefore = this.reclaimer.readPageStats();
      let cursor = '';
      let purgeExhausted = false;
      while (!purgeExhausted) {
        stop = hardStop();
        if (stop) break;
        const rowRoom = limits.maxRowsPerRun - rowsUsed();
        if (rowRoom <= 0) {
          stop = 'row-budget';
          break;
        }
        stop = await yieldGovernor();
        if (stop) break;
        const t0 = now();
        const batch = this.store.purgeProcessedBatch(
          purgeCutoff,
          Math.min(batchSize, rowRoom),
          cursor,
        );
        const durationMs = now() - t0;
        tally.processedPurged += batch.deleted;
        cursor = batch.nextCursor;
        purgeExhausted = batch.exhausted;
        this.logger.debug('[memory-curator] retention purge batch', {
          deleted: batch.deleted,
          durationMs,
        });
        adaptBatch(durationMs);
        if (!purgeExhausted) await yieldToEventLoop();
      }
      const pagesAfterPurge = this.reclaimer.readPageStats();
      const freed = purgeFreedBytes(pagesBefore, pagesAfterPurge);
      tally.freedBytes = freed ?? 0;
      tally.freedBytesMeasured = freed !== null;

      // 2. Stuck quarantine — unprocessed and captured before stuckDays.
      if (!stop) {
        const stuckCutoff = startedAt - settings.stuckDays * DAY_MS;
        for (;;) {
          stop = hardStop();
          if (stop) break;
          const rowRoom = limits.maxRowsPerRun - rowsUsed();
          if (rowRoom <= 0) {
            stop = 'row-budget';
            break;
          }
          stop = await yieldGovernor();
          if (stop) break;
          const t0 = now();
          const batch = this.store.quarantineStuckBatch(
            stuckCutoff,
            Math.min(batchSize, rowRoom),
            startedAt,
          );
          const durationMs = now() - t0;
          tally.stuckQuarantined += batch.quarantined;
          this.logger.debug('[memory-curator] retention quarantine batch', {
            quarantined: batch.quarantined,
            payloadBytes: batch.payloadBytes,
            durationMs,
          });
          adaptBatch(durationMs);
          if (batch.quarantined === 0) break;
          await yieldToEventLoop();
        }
      }

      // A row-budget stop ends only the row steps: the ledger prune and the
      // page reclaim are bounded on their own and return space sooner.
      const continueAfterRows = stop === null || stop === 'row-budget';

      // 3. Ledger prune — once per run.
      if (continueAfterRows && hardStop() === null) {
        const pruneStop = await yieldGovernor();
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
      if (continueAfterRows && (stop === null || stop === 'row-budget')) {
        const reclaim = await this.reclaimPages(
          hardStop,
          tally,
          yieldGovernor,
        );
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
    });
  }

  /** Bounded `incremental_vacuum` steps, then a passive WAL checkpoint. */
  private async reclaimPages(
    hardStop: () => RetentionStopReason | null,
    tally: RunTally,
    yieldGovernor: () => Promise<RetentionStopReason | null>,
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
      stop = hardStop();
      if (stop) break;
      const room = limits.maxReclaimPagesPerRun - tally.pagesReclaimed;
      if (room <= 0) {
        stop = 'reclaim-budget';
        break;
      }
      stop = await yieldGovernor();
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
      if (freelist > 0) await yieldToEventLoop();
    }
    if (steps > 0) this.reclaimer.checkpointPassive();
    return { done: freelist <= 0, note: null, stop };
  }

  /**
   * Wait on the background-work governor before a write batch.
   *
   * Fast-paths when the governor is absent or already clear.
   * Bounded by the run's remaining wall budget (floor 1 ms). If the deadline
   * has already passed, skips the wait so hardStop() ends with 'time-budget'.
   * Resolves 'continue' on 'clear' or governor 'timeout'.
   * Resolves 'aborted' on AbortError (shutdown or signal).
   * Any other rejection fails open ('continue') with a single warning log.
   */
  private async yieldToGovernor(
    signal: AbortSignal,
    warned: { value: boolean },
    msLeft: () => number,
  ): Promise<'continue' | 'aborted'> {
    const governor = this.governor;
    if (governor === null || governor.isClear()) {
      return signal.aborted ? 'aborted' : 'continue';
    }
    const remainingMs = msLeft();
    if (remainingMs <= 0) {
      return signal.aborted ? 'aborted' : 'continue';
    }
    const maxDeferMs = Math.max(1, remainingMs);
    try {
      await governor.whenClear({
        signal,
        lane: GOVERNOR_LANE,
        maxDeferMs,
      });
      return signal.aborted ? 'aborted' : 'continue';
    } catch (error: unknown) {
      // degradation-audit: reported - a governor wait that rejects with anything
      // but AbortError is a defect in the governor; retention warns once per run
      // and fails open, as the BackgroundWorkAdmission contract requires.
      if (error instanceof Error && error.name === 'AbortError') {
        return 'aborted';
      }
      if (!warned.value) {
        warned.value = true;
        this.logger.warn(
          '[memory-curator] background-work wait failed — continuing retention anyway',
          { error: errorText(error) },
        );
      }
      return signal.aborted ? 'aborted' : 'continue';
    }
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

  private toRunDto(state: RetentionState): MemoryRetentionRunDto | null {
    if (
      state.lastOutcome === null ||
      !RUN_OUTCOMES.has(state.lastOutcome) ||
      state.lastStartedAt === null ||
      state.lastFinishedAt === null
    ) {
      return null;
    }
    return {
      startedAt: state.lastStartedAt,
      finishedAt: state.lastFinishedAt,
      outcome: state.lastOutcome as MemoryRetentionRunDto['outcome'],
      reason: state.lastReason,
      error: state.lastError,
      durationMs: state.lastDurationMs ?? 0,
      processedPurged: state.processedPurged,
      stuckQuarantined: state.stuckQuarantined,
      ledgerPruned: state.ledgerPruned,
      freedBytes: state.freedBytes,
      pagesReclaimed: state.pagesReclaimed,
      backlogRemaining: state.backlogRemaining,
    };
  }

  /**
   * `last_finished_at` when the last run left a backlog (the next idle hourly
   * tick), otherwise `last_completed_at + 24 h`; `null` when never completed.
   */
  private nextDueAt(state: RetentionState): number | null {
    if (state.backlogRemaining && state.lastFinishedAt !== null) {
      return state.lastFinishedAt;
    }
    return state.lastCompletedAt !== null
      ? state.lastCompletedAt + this.limits.intervalMs
      : null;
  }
}
