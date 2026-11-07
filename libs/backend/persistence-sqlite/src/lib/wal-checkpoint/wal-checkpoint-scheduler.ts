/**
 * WalCheckpointScheduler — moves WAL checkpoints off the Electron main thread
 * (main-loop-sync-blocks fix 11).
 *
 * With SQLite's default `wal_autocheckpoint = 1000`, the COMMIT that pushes
 * the WAL past ~4 MB also copies WAL frames into the 1.27 GB database file and
 * fsyncs it, synchronously, on the main thread. The perf run measured one such
 * `<transaction anonymous>` at 1150 ms. This service runs those checkpoints in
 * a utility process instead, then sets `wal_autocheckpoint = 0` on the main
 * connection so its commits only append to the WAL.
 *
 * Order of trust (review-11 finding 2): auto-checkpoint counts as off only
 * when SQLite read back 0, and that is attempted only after the worker has
 * completed a checkpoint. After `maxConsecutiveFailures` failed checkpoints
 * the scheduler restores SQLite's default and stops only once SQLite read
 * back 1000; until then it keeps polling, retrying the restore and the
 * worker, so SQLite is never at 0 with no checkpointer. `dispose()` restores
 * it too; the TRUNCATE checkpoint in `SqliteConnectionService.close()` still
 * runs at quit.
 *
 * Trigger, polled every `pollMs` with an async `stat` of the `-wal` file:
 * `intervalMs` since the last checkpoint, or the file grew `sizeTriggerBytes`
 * since then. A WAL whose last checkpoint caught up and whose size, mtime and
 * path are unchanged is idle and skipped, up to `maxIdleSkipMs` (finding 3).
 * Polls never overlap. A checkpoint that cannot catch up for `stallWarnMs`
 * (a reader holds old frames) logs one WARN per episode.
 *
 * `pauseForExclusiveAccess()` (finding 1) stops new checkpoints and waits up
 * to `pauseWaitMs` for the running one, then kills the worker, so `db:reset`
 * can close and rename the file with no other process holding it open.
 *
 * Only a host that binds `WAL_CHECKPOINT_WORKER_FACTORY` gets any of this;
 * elsewhere `start()` returns false, the pause resolves at once, and SQLite's
 * own auto-checkpoint stays.
 */
import * as fs from 'node:fs';
import { inject, injectable } from 'tsyringe';
import { TOKENS, type Logger } from '@ptah-extension/vscode-core';
import { PERSISTENCE_TOKENS } from '../di/tokens';
import type { SqliteConnectionService } from '../sqlite-connection.service';
import type { IWalCheckpointWorkerProcessFactory } from './wal-checkpoint-worker.port';
import type { WalCheckpointResult } from './wal-checkpoint-worker-protocol';
import { WalCheckpointWorkerClient } from './wal-checkpoint-worker-client';
import type {
  ISqliteExclusiveAccess,
  SqliteExclusiveAccessLease,
} from './sqlite-exclusive-access.port';

/** Size and modification time of the `-wal` file; zeros when it is absent. */
export interface WalFileStat {
  readonly bytes: number;
  readonly mtimeMs: number;
}

export interface WalCheckpointSchedulerOptions {
  /** How often the `-wal` file is measured. */
  readonly pollMs: number;
  /** Longest gap between two checkpoints while the WAL has new work. */
  readonly intervalMs: number;
  /** WAL growth since the last checkpoint that triggers one early. */
  readonly sizeTriggerBytes: number;
  /** Longest an unchanged, caught-up WAL is skipped before a recheck. */
  readonly maxIdleSkipMs: number;
  /** How long a checkpoint may fail to catch up before one WARN. */
  readonly stallWarnMs: number;
  /** How long one worker checkpoint may take before the worker is killed. */
  readonly requestTimeoutMs: number;
  /** How long an exclusive-access pause waits before killing the worker. */
  readonly pauseWaitMs: number;
  /** Failed checkpoints in a row before falling back to auto-checkpoint. */
  readonly maxConsecutiveFailures: number;
  /** Measure the `-wal` file. */
  readonly statWal: (walPath: string) => Promise<WalFileStat>;
  /** Wall clock, ms. */
  readonly now: () => number;
}

/** Above this a single off-main checkpoint is logged at info. */
const SLOW_CHECKPOINT_INFO_MS = 500;

const ABSENT_WAL: WalFileStat = { bytes: 0, mtimeMs: 0 };

export async function statWalFile(walPath: string): Promise<WalFileStat> {
  try {
    const stat = await fs.promises.stat(walPath);
    return { bytes: stat.size, mtimeMs: stat.mtimeMs };
  } catch (error: unknown) {
    // Structural, not `instanceof Error`: a Node fs error from another realm
    // (a Jest VM context) fails that check while still carrying `code`.
    if (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      error.code === 'ENOENT'
    ) {
      return ABSENT_WAL;
    }
    throw error;
  }
}

export const DEFAULT_WAL_CHECKPOINT_SCHEDULER_OPTIONS: WalCheckpointSchedulerOptions =
  {
    pollMs: 5_000,
    intervalMs: 30_000,
    sizeTriggerBytes: 16 * 1024 * 1024,
    maxIdleSkipMs: 5 * 60_000,
    stallWarnMs: 60_000,
    requestTimeoutMs: 60_000,
    pauseWaitMs: 2_000,
    maxConsecutiveFailures: 3,
    statWal: statWalFile,
    now: Date.now,
  };

type SchedulerState = 'idle' | 'running' | 'stopped';

interface StallEpisode {
  readonly since: number;
  warned: boolean;
}

/** What the WAL looked like when the last checkpoint ran, and its result. */
interface LastCheckpoint {
  readonly at: number;
  readonly dbPath: string;
  /** `null` when the size could not be read. */
  readonly wal: WalFileStat | null;
  caughtUp: boolean;
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

/** Resolves true when `work` settles within `ms`, false otherwise. */
function settlesWithin(work: Promise<void>, ms: number): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const timer = setTimeout(() => resolve(false), ms);
    timer.unref?.();
    void work.then(() => {
      clearTimeout(timer);
      resolve(true);
    });
  });
}

@injectable()
export class WalCheckpointScheduler implements ISqliteExclusiveAccess {
  private state: SchedulerState = 'idle';
  private options = DEFAULT_WAL_CHECKPOINT_SCHEDULER_OPTIONS;
  private client: WalCheckpointWorkerClient | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private inFlight: Promise<void> | null = null;
  private last: LastCheckpoint | null = null;
  private consecutiveFailures = 0;
  /** Set once auto-checkpoint was verified off; dispose restores it. */
  private disabledOnce = false;
  /** Fallback requested; stop only after SQLite confirms the restore. */
  private restorePending = false;
  private pauseDepth = 0;
  private stall: StallEpisode | null = null;

  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(PERSISTENCE_TOKENS.SQLITE_CONNECTION)
    private readonly connection: SqliteConnectionService,
    @inject(PERSISTENCE_TOKENS.WAL_CHECKPOINT_WORKER_FACTORY, {
      isOptional: true,
    })
    private readonly factory: IWalCheckpointWorkerProcessFactory | null = null,
  ) {}

  /** True while checkpoints run in the worker. */
  get running(): boolean {
    return this.state === 'running';
  }

  /**
   * Start polling. Returns false, and changes nothing, on a host without a
   * worker factory. A second call is a no-op.
   */
  start(overrides: Partial<WalCheckpointSchedulerOptions> = {}): boolean {
    if (this.state !== 'idle') return this.state === 'running';
    if (this.factory === null) {
      this.state = 'stopped';
      this.logger.info(
        '[persistence-sqlite] no WAL checkpoint worker on this host; SQLite auto-checkpoint stays on',
      );
      return false;
    }
    this.options = { ...DEFAULT_WAL_CHECKPOINT_SCHEDULER_OPTIONS, ...overrides };
    this.client = new WalCheckpointWorkerClient(
      this.factory,
      this.options.requestTimeoutMs,
      this.logger,
    );
    this.state = 'running';
    this.timer = setInterval(() => {
      void this.tick();
    }, this.options.pollMs);
    this.timer.unref?.();
    this.logger.info('[persistence-sqlite] WAL checkpoint scheduler started', {
      pollMs: this.options.pollMs,
      intervalMs: this.options.intervalMs,
      sizeTriggerBytes: this.options.sizeTriggerBytes,
    });
    return true;
  }

  /**
   * One poll. Never rejects. A poll that arrives while one is running joins
   * it rather than starting a second checkpoint; none starts while paused.
   */
  tick(): Promise<void> {
    if (this.inFlight) return this.inFlight;
    if (this.state !== 'running' || this.pauseDepth > 0) {
      return Promise.resolve();
    }
    this.inFlight = this.runTick().finally(() => {
      this.inFlight = null;
    });
    return this.inFlight;
  }

  /**
   * Stop new checkpoints, then wait up to `pauseWaitMs` for the running one
   * and kill the worker if it is still busy. Resolves when no worker holds
   * the database open. Never rejects. Pauses nest; each lease releases once.
   */
  async pauseForExclusiveAccess(): Promise<SqliteExclusiveAccessLease> {
    this.pauseDepth++;
    let released = false;
    const lease: SqliteExclusiveAccessLease = {
      release: () => {
        if (released) return;
        released = true;
        this.pauseDepth--;
        this.logger.debug(
          '[persistence-sqlite] WAL checkpoint exclusive-access pause released',
        );
      },
    };
    const active = this.inFlight;
    if (active) {
      const finished = await settlesWithin(active, this.options.pauseWaitMs);
      if (!finished) {
        this.logger.warn(
          '[persistence-sqlite] WAL checkpoint still running after the exclusive-access wait; killing the worker',
          { waitMs: this.options.pauseWaitMs },
        );
        this.client?.terminate('terminated for exclusive database access');
        await active;
      }
    }
    return lease;
  }

  /**
   * Stop polling, kill the worker and give commits their auto-checkpoint
   * back. Idempotent; never throws.
   */
  dispose(): void {
    if (this.state === 'stopped') return;
    this.stop();
    if (this.disabledOnce) this.restoreAutoCheckpoint();
  }

  private async runTick(): Promise<void> {
    try {
      if (this.restorePending && this.restoreAutoCheckpoint()) {
        this.stop();
        this.logger.warn(
          '[persistence-sqlite] WAL checkpoint worker keeps failing; SQLite auto-checkpoint is back on the main thread',
          { consecutiveFailures: this.consecutiveFailures },
        );
        return;
      }
      if (!this.connection.isOpen) return;
      const dbPath = this.connection.dbPath;
      const wal = await this.measureWal(`${dbPath}-wal`);
      // A pause or dispose that arrived during the stat wins.
      if (this.state !== 'running' || this.pauseDepth > 0) return;
      if (!this.isDue(dbPath, wal)) return;
      await this.checkpoint(dbPath, wal);
    } catch (error: unknown) {
      this.logger.warn('[persistence-sqlite] WAL checkpoint poll failed', {
        error: toError(error),
      });
    }
  }

  /** `null` when the file could not be measured; the interval still applies. */
  private async measureWal(walPath: string): Promise<WalFileStat | null> {
    try {
      const wal = await this.options.statWal(walPath);
      this.connection.noteWalBytes(wal.bytes);
      return wal;
    } catch (error: unknown) {
      this.logger.debug('[persistence-sqlite] WAL size read failed', {
        error: toError(error).message,
      });
      return null;
    }
  }

  private isDue(dbPath: string, wal: WalFileStat | null): boolean {
    if (wal !== null && wal.bytes === 0) return false;
    const last = this.last;
    // A first checkpoint, or another database file: new work either way.
    if (last === null || last.dbPath !== dbPath) return true;
    const sinceLast = this.options.now() - last.at;
    if (
      this.isIdle(last, dbPath, wal) &&
      sinceLast < this.options.maxIdleSkipMs
    ) {
      return false;
    }
    if (sinceLast >= this.options.intervalMs) return true;
    return (
      wal !== null &&
      last.wal !== null &&
      wal.bytes - last.wal.bytes >= this.options.sizeTriggerBytes
    );
  }

  /** Caught up last time, same file, and not written since. */
  private isIdle(
    last: LastCheckpoint,
    dbPath: string,
    wal: WalFileStat | null,
  ): boolean {
    return (
      last.caughtUp &&
      last.dbPath === dbPath &&
      wal !== null &&
      last.wal !== null &&
      wal.bytes === last.wal.bytes &&
      wal.mtimeMs === last.wal.mtimeMs
    );
  }

  private async checkpoint(
    dbPath: string,
    wal: WalFileStat | null,
  ): Promise<void> {
    const client = this.client;
    if (client === null) return;
    const record: LastCheckpoint = {
      at: this.options.now(),
      dbPath,
      wal,
      caughtUp: false,
    };
    this.last = record;
    let result: WalCheckpointResult;
    try {
      result = await client.checkpoint(dbPath);
    } catch (error: unknown) {
      this.onFailure(error);
      return;
    }
    if (this.state !== 'running') return;
    this.consecutiveFailures = 0;
    // The worker recovered while a restore was pending: it checkpoints again,
    // so worker mode stands and the restore is no longer needed.
    this.restorePending = false;
    if (!this.connection.walCheckpointsOffMainThread) {
      this.disableAutoCheckpoint();
    }
    record.caughtUp = isCaughtUp(result);
    this.logResult(result, wal);
    this.trackProgress(result, wal);
  }

  /** Off only when SQLite read back 0; a failure is retried next time. */
  private disableAutoCheckpoint(): void {
    const outcome = this.connection.setWalAutoCheckpoint(0);
    if (outcome.status === 'applied') {
      this.disabledOnce = true;
      this.logger.info(
        '[persistence-sqlite] WAL checkpoints now run off the main thread (wal_autocheckpoint = 0)',
      );
    } else if (outcome.status === 'failed') {
      this.logger.warn(
        '[persistence-sqlite] could not turn SQLite auto-checkpoint off; commits keep checkpointing',
        { error: outcome.error },
      );
    }
  }

  private logResult(result: WalCheckpointResult, wal: WalFileStat | null): void {
    const fields = {
      durationMs: result.durationMs,
      walBytes: wal?.bytes ?? null,
      walFrames: result.walFrames,
      checkpointedFrames: result.checkpointedFrames,
      busy: result.busy,
    };
    if (result.durationMs >= SLOW_CHECKPOINT_INFO_MS) {
      this.logger.info('[persistence-sqlite] slow off-main WAL checkpoint', fields);
    } else {
      this.logger.debug('[persistence-sqlite] WAL checkpoint', fields);
    }
  }

  /** One WARN per episode in which the checkpoint cannot catch up. */
  private trackProgress(
    result: WalCheckpointResult,
    wal: WalFileStat | null,
  ): void {
    const now = this.options.now();
    const walBytes = wal?.bytes ?? null;
    if (isCaughtUp(result)) {
      if (this.stall?.warned) {
        this.logger.info('[persistence-sqlite] WAL checkpoint caught up', {
          stalledForMs: now - this.stall.since,
          walBytes,
        });
      }
      this.stall = null;
      return;
    }
    this.stall ??= { since: now, warned: false };
    if (!this.stall.warned && now - this.stall.since >= this.options.stallWarnMs) {
      this.stall.warned = true;
      this.logger.warn(
        '[persistence-sqlite] WAL checkpoint cannot catch up; the WAL keeps growing (a reader or another checkpointer holds old frames)',
        {
          stalledForMs: now - this.stall.since,
          walBytes,
          walFrames: result.walFrames,
          checkpointedFrames: result.checkpointedFrames,
          busy: result.busy,
        },
      );
    }
  }

  private onFailure(error: unknown): void {
    // A dispose, or a pause that killed the worker, is not a failure.
    if (this.state !== 'running' || this.pauseDepth > 0) {
      this.logger.debug('[persistence-sqlite] WAL checkpoint interrupted', {
        error: toError(error).message,
      });
      return;
    }
    this.consecutiveFailures++;
    this.logger.warn('[persistence-sqlite] off-main WAL checkpoint failed', {
      error: toError(error).message,
      consecutiveFailures: this.consecutiveFailures,
    });
    if (this.consecutiveFailures < this.options.maxConsecutiveFailures) return;
    if (this.restoreAutoCheckpoint()) {
      this.stop();
      this.logger.warn(
        '[persistence-sqlite] WAL checkpoint worker keeps failing; SQLite auto-checkpoint is back on the main thread',
        { consecutiveFailures: this.consecutiveFailures },
      );
      return;
    }
    // SQLite may still be at 0: keep polling so the worker keeps trying and
    // the restore is retried on every tick.
    this.restorePending = true;
  }

  private stop(): void {
    this.state = 'stopped';
    this.restorePending = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.client?.dispose();
    this.client = null;
  }

  /** True when SQLite confirmed its default (or no connection is open). */
  private restoreAutoCheckpoint(): boolean {
    const outcome = this.connection.setWalAutoCheckpoint(null);
    if (outcome.status === 'failed') {
      this.logger.warn(
        '[persistence-sqlite] restoring SQLite auto-checkpoint failed; will retry',
        { error: outcome.error },
      );
      return false;
    }
    this.disabledOnce = false;
    return true;
  }
}

function isCaughtUp(result: WalCheckpointResult): boolean {
  return !result.busy && result.checkpointedFrames >= result.walFrames;
}
