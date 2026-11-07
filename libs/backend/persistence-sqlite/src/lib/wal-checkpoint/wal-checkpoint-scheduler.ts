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
 * Order of trust: auto-checkpoint is switched off only after the worker has
 * returned one successful checkpoint, and switched back on after
 * `maxConsecutiveFailures` failed ones, so the WAL is never left without a
 * checkpointer. `dispose()` also restores it; the TRUNCATE checkpoint in
 * `SqliteConnectionService.close()` still runs at quit.
 *
 * Trigger, polled every `pollMs` with an async `stat` of the `-wal` file:
 * `intervalMs` since the last checkpoint, or the file grew `sizeTriggerBytes`
 * since then. Polls never overlap. A checkpoint that cannot catch up for
 * `stallWarnMs` (a reader holds old frames) logs one WARN per episode.
 *
 * Only a host that binds `WAL_CHECKPOINT_WORKER_FACTORY` gets any of this;
 * elsewhere `start()` returns false and SQLite's own auto-checkpoint stays.
 */
import * as fs from 'node:fs';
import { inject, injectable } from 'tsyringe';
import { TOKENS, type Logger } from '@ptah-extension/vscode-core';
import { PERSISTENCE_TOKENS } from '../di/tokens';
import type { SqliteConnectionService } from '../sqlite-connection.service';
import type { IWalCheckpointWorkerProcessFactory } from './wal-checkpoint-worker.port';
import type { WalCheckpointResult } from './wal-checkpoint-worker-protocol';
import { WalCheckpointWorkerClient } from './wal-checkpoint-worker-client';

export interface WalCheckpointSchedulerOptions {
  /** How often the `-wal` size is measured. */
  readonly pollMs: number;
  /** Longest gap between two checkpoints while the WAL is not empty. */
  readonly intervalMs: number;
  /** WAL growth since the last checkpoint that triggers one early. */
  readonly sizeTriggerBytes: number;
  /** How long a checkpoint may fail to catch up before one WARN. */
  readonly stallWarnMs: number;
  /** How long one worker checkpoint may take before the worker is killed. */
  readonly requestTimeoutMs: number;
  /** Failed checkpoints in a row before falling back to auto-checkpoint. */
  readonly maxConsecutiveFailures: number;
  /** Size of the `-wal` file in bytes; 0 when it does not exist. */
  readonly statWalBytes: (walPath: string) => Promise<number>;
  /** Wall clock, ms. */
  readonly now: () => number;
}

/** Above this a single off-main checkpoint is logged at info. */
const SLOW_CHECKPOINT_INFO_MS = 500;

export async function statWalBytes(walPath: string): Promise<number> {
  try {
    return (await fs.promises.stat(walPath)).size;
  } catch (error: unknown) {
    // Structural, not `instanceof Error`: a Node fs error from another realm
    // (a Jest VM context) fails that check while still carrying `code`.
    if (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      error.code === 'ENOENT'
    ) {
      return 0;
    }
    throw error;
  }
}

export const DEFAULT_WAL_CHECKPOINT_SCHEDULER_OPTIONS: WalCheckpointSchedulerOptions =
  {
    pollMs: 5_000,
    intervalMs: 30_000,
    sizeTriggerBytes: 16 * 1024 * 1024,
    stallWarnMs: 60_000,
    requestTimeoutMs: 60_000,
    maxConsecutiveFailures: 3,
    statWalBytes,
    now: Date.now,
  };

type SchedulerState = 'idle' | 'running' | 'stopped';

interface StallEpisode {
  readonly since: number;
  warned: boolean;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

@injectable()
export class WalCheckpointScheduler {
  private state: SchedulerState = 'idle';
  private options = DEFAULT_WAL_CHECKPOINT_SCHEDULER_OPTIONS;
  private client: WalCheckpointWorkerClient | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private inFlight: Promise<void> | null = null;
  private lastCheckpointAt = Number.NEGATIVE_INFINITY;
  private walBytesAtLastCheckpoint = 0;
  private consecutiveFailures = 0;
  private autoCheckpointDisabled = false;
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
   * it rather than starting a second checkpoint.
   */
  tick(): Promise<void> {
    if (this.inFlight) return this.inFlight;
    if (this.state !== 'running') return Promise.resolve();
    this.inFlight = this.runTick().finally(() => {
      this.inFlight = null;
    });
    return this.inFlight;
  }

  /**
   * Stop polling, kill the worker and give commits their auto-checkpoint
   * back. Idempotent; never throws.
   */
  dispose(): void {
    if (this.state === 'stopped') return;
    this.stop();
    if (this.autoCheckpointDisabled) this.restoreAutoCheckpoint();
  }

  private async runTick(): Promise<void> {
    try {
      if (!this.connection.isOpen) return;
      const dbPath = this.connection.dbPath;
      const walBytes = await this.measureWal(`${dbPath}-wal`);
      if (this.state !== 'running' || !this.isDue(walBytes)) return;
      await this.checkpoint(dbPath, walBytes);
    } catch (error: unknown) {
      this.logger.warn('[persistence-sqlite] WAL checkpoint poll failed', {
        error: errorText(error),
      });
    }
  }

  /** `null` when the size could not be read; the interval still applies. */
  private async measureWal(walPath: string): Promise<number | null> {
    try {
      const bytes = await this.options.statWalBytes(walPath);
      this.connection.noteWalBytes(bytes);
      return bytes;
    } catch (error: unknown) {
      this.logger.debug('[persistence-sqlite] WAL size read failed', {
        error: errorText(error),
      });
      return null;
    }
  }

  private isDue(walBytes: number | null): boolean {
    if (walBytes === 0) return false;
    const now = this.options.now();
    if (now - this.lastCheckpointAt >= this.options.intervalMs) return true;
    return (
      walBytes !== null &&
      walBytes - this.walBytesAtLastCheckpoint >= this.options.sizeTriggerBytes
    );
  }

  private async checkpoint(
    dbPath: string,
    walBytes: number | null,
  ): Promise<void> {
    const client = this.client;
    if (client === null) return;
    const startedAt = this.options.now();
    this.lastCheckpointAt = startedAt;
    if (walBytes !== null) this.walBytesAtLastCheckpoint = walBytes;
    let result: WalCheckpointResult;
    try {
      result = await client.checkpoint(dbPath);
    } catch (error: unknown) {
      this.onFailure(error);
      return;
    }
    if (this.state !== 'running') return;
    this.consecutiveFailures = 0;
    if (!this.autoCheckpointDisabled) {
      this.connection.setWalAutoCheckpoint(0);
      this.autoCheckpointDisabled = true;
      this.logger.info(
        '[persistence-sqlite] WAL checkpoints now run off the main thread (wal_autocheckpoint = 0)',
      );
    }
    this.logResult(result, walBytes);
    this.trackProgress(result, walBytes);
  }

  private logResult(result: WalCheckpointResult, walBytes: number | null): void {
    const fields = {
      durationMs: result.durationMs,
      walBytes,
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
    walBytes: number | null,
  ): void {
    const caughtUp =
      !result.busy && result.checkpointedFrames >= result.walFrames;
    const now = this.options.now();
    if (caughtUp) {
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
    // A dispose rejects the request in flight; that is not a failure.
    if (this.state !== 'running') return;
    this.consecutiveFailures++;
    this.logger.warn('[persistence-sqlite] off-main WAL checkpoint failed', {
      error: errorText(error),
      consecutiveFailures: this.consecutiveFailures,
    });
    if (this.consecutiveFailures < this.options.maxConsecutiveFailures) return;
    this.stop();
    this.restoreAutoCheckpoint();
    this.logger.warn(
      '[persistence-sqlite] WAL checkpoint worker keeps failing; SQLite auto-checkpoint is back on the main thread',
      { consecutiveFailures: this.consecutiveFailures },
    );
  }

  private stop(): void {
    this.state = 'stopped';
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.client?.dispose();
    this.client = null;
  }

  private restoreAutoCheckpoint(): void {
    try {
      this.connection.setWalAutoCheckpoint(null);
      this.autoCheckpointDisabled = false;
    } catch (error: unknown) {
      this.logger.warn(
        '[persistence-sqlite] restoring SQLite auto-checkpoint failed',
        { error: errorText(error) },
      );
    }
  }
}
