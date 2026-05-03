/**
 * CatchupCoordinator — replays missed cron slots after a process resume.
 *
 * Trigger sources:
 *   1. `IPowerMonitor.onResume` — laptop wake / sleep cycle (Electron host).
 *   2. Explicit call from `CronScheduler.start()` — handles cold-start replay
 *      after the process was offline. The scheduler computes "now" and
 *      passes the previous-known `lastRunAt` for each enabled job.
 *
 * Per-job catchup policy is materialized from settings/options:
 *   - `none` — emit nothing; schedule continues from now.
 *   - `last` — emit at most one slot (the most recent missed occurrence).
 *   - `all`  — emit every missed slot inside the catchup window.
 *
 * Window cap: `CronSchedulerOptions.catchupWindowMs` is hard-clamped to
 * {@link CATCHUP_WINDOW_MAX_MS} (24h, architecture §4.3). A job that has been
 * silent for longer is treated as starting fresh — replaying a week of cron
 * slots is *never* desirable.
 *
 * The coordinator does **not** schedule timers. It enumerates missed slots
 * (using a croner instance per job) and forwards them synchronously to
 * {@link JobRunner.run}, which handles the at-most-once UNIQUE-claim. Slots
 * already persisted in `job_runs` from a prior boot are silently no-ops —
 * the database is the source of truth.
 */
import { inject, injectable } from 'tsyringe';
import { TOKENS, type Logger } from '@ptah-extension/vscode-core';
import { CRON_TOKENS } from './di/tokens';
import type { IJobStore } from './job.store';
import type { JobRunner } from './job-runner';
import type { IPowerMonitor } from './power-monitor.interface';
import { loadCron, type CronInstance } from './croner-loader';
import {
  CATCHUP_WINDOW_MAX_MS,
  type CatchupPolicy,
  type CronSchedulerOptions,
  type ScheduledJob,
} from './types';

@injectable()
export class CatchupCoordinator {
  private disposeResume: (() => void) | null = null;

  constructor(
    @inject(CRON_TOKENS.CRON_JOB_STORE)
    private readonly jobs: IJobStore,
    @inject(CRON_TOKENS.CRON_JOB_RUNNER)
    private readonly runner: JobRunner,
    @inject(CRON_TOKENS.CRON_POWER_MONITOR)
    private readonly power: IPowerMonitor,
    @inject(TOKENS.LOGGER)
    private readonly logger: Logger,
  ) {}

  /** Subscribe to power events. Called once by CronScheduler.start(). */
  attach(
    getOptions: () => CronSchedulerOptions,
    getPolicy: (job: ScheduledJob) => CatchupPolicy,
  ): void {
    if (this.disposeResume) return;
    this.disposeResume = this.power.onResume(() => {
      void this.replayMissed(getOptions(), getPolicy).catch((err) => {
        this.logger.error('[cron-scheduler] catchup on resume failed', {
          err: (err as Error).message,
        });
      });
    });
  }

  detach(): void {
    if (this.disposeResume) {
      try {
        this.disposeResume();
      } catch {
        /* swallow */
      }
      this.disposeResume = null;
    }
  }

  /**
   * Walk every enabled job and dispatch any missed slots inside the window.
   * Public so `CronScheduler.start()` can call it directly on cold start.
   */
  async replayMissed(
    options: CronSchedulerOptions,
    policyFor: (job: ScheduledJob) => CatchupPolicy,
    now: number = Date.now(),
  ): Promise<void> {
    if (!options.enabled) return;
    const window = Math.min(
      Math.max(0, options.catchupWindowMs),
      CATCHUP_WINDOW_MAX_MS,
    );
    if (window <= 0) return;

    const cutoff = now - window;
    const enabled = this.jobs.list({ enabledOnly: true });

    for (const job of enabled) {
      const policy = policyFor(job);
      if (policy === 'none') continue;
      const since = Math.max(cutoff, job.lastRunAt ?? cutoff);
      const slots = this.computeMissedSlots(job, since, now);
      if (slots.length === 0) continue;
      const toFire = policy === 'last' ? [slots[slots.length - 1]] : slots;
      for (const slot of toFire) {
        try {
          await this.runner.run(job, slot, { suppressJobTimestamps: true });
        } catch (err) {
          // JobRunner.run never throws under normal conditions — but defend
          // against a future regression so one job's failure doesn't stall
          // catchup for the rest.
          this.logger.error('[cron-scheduler] catchup runner threw', {
            jobId: job.id,
            slot,
            err: (err as Error).message,
          });
        }
      }
    }
  }

  /**
   * Enumerate every croner-emitted occurrence in the half-open interval
   * `(since, now]`. Slots equal to `since` are excluded — that boundary
   * was either already-run (stored in `lastRunAt`) or is the cutoff itself.
   */
  private computeMissedSlots(
    job: ScheduledJob,
    since: number,
    now: number,
  ): number[] {
    const Cron = loadCron();
    let cron: CronInstance;
    try {
      cron = new Cron(job.cronExpr, {
        timezone: job.timezone,
        protect: false,
        paused: true,
      });
    } catch (err) {
      this.logger.error('[cron-scheduler] catchup: invalid cron/timezone', {
        jobId: job.id,
        cronExpr: job.cronExpr,
        timezone: job.timezone,
        err: (err as Error).message,
      });
      return [];
    }

    const slots: number[] = [];
    let cursor = new Date(since);
    // Hard cap iterations defensively — 24h / 1min = 1440 max.
    const MAX_ITER = 2000;
    for (let i = 0; i < MAX_ITER; i += 1) {
      const next = cron.nextRun(cursor);
      if (!next) break;
      const t = next.getTime();
      if (t > now) break;
      slots.push(t);
      cursor = new Date(t);
    }
    return slots;
  }
}
