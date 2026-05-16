/**
 * CronScheduler — top-level orchestrator.
 *
 * Responsibilities:
 *   - Lazy-require `croner` and validate every job's expression + IANA tz
 *     before insertion. croner errors are passed through verbatim — we do
 *     NOT remap them, because croner's messages are the most actionable
 *     surface the user sees.
 *   - Maintain one `Cron` instance per enabled job in memory. Disabled jobs
 *     are not armed. Updates tear down the old timer and rebuild.
 *   - On each scheduled tick, invoke {@link JobRunner.run} with the
 *     croner-reported `scheduledFor` timestamp. The runner owns claim/dispatch.
 *   - Drive cold-start catchup via {@link CatchupCoordinator.replayMissed}
 *     and resume-time catchup via `IPowerMonitor`.
 *   - Public API for the RPC layer: `list / get / create / update / delete /
 *     toggle / runNow / runs / nextFire`.
 *
 * Lifecycle is tied to the Electron main process (cron is not run in the
 * VS Code extension host — see architecture §8.2). `stop()` is idempotent
 * and is wired into the LIFO cleanup chain in `apps/ptah-electron/src/main.ts`.
 *
 * The scheduler reads three settings from `IWorkspaceProvider`:
 *   - `cron.enabled`           (boolean, default true)
 *   - `cron.maxConcurrentJobs` (number, default 3)
 *   - `cron.catchupWindowMs`   (number, default 86_400_000, capped at 24h)
 *
 * Catchup policy is **not** in settings or the schema — it is per-job, but
 * v1 hard-codes a single global default ('last'). When per-job policy is
 * needed, add a forward-only migration to extend `scheduled_jobs`.
 */
import { inject, injectable } from 'tsyringe';
import { TOKENS, type Logger } from '@ptah-extension/vscode-core';
import type { JobId } from '@ptah-extension/shared';
import { CRON_TOKENS } from './di/tokens';
import type { CatchupCoordinator } from './catchup-coordinator';
import { JobNotFoundError } from './errors';
import type { IJobStore } from './job.store';
import type { IRunStore } from './run.store';
import { JobRunner } from './job-runner';
import { loadCron, type CronInstance } from './croner-loader';
import {
  CATCHUP_WINDOW_MAX_MS,
  type CatchupPolicy,
  type CreateJobInput,
  type CronSchedulerOptions,
  type JobRun,
  type ScheduledJob,
  type UpdateJobPatch,
} from './types';

/**
 * Default catchup policy when no per-job override is configured.
 * 'last' is the safest sane default — operators see a missed slot but we
 * don't replay an entire window.
 */
const DEFAULT_CATCHUP_POLICY: CatchupPolicy = 'last';

@injectable()
export class CronScheduler {
  /** Map jobId → live croner instance. Empty when stopped. */
  private readonly timers = new Map<string, CronInstance>();
  /** Resolved at start; mutated by `stop()`. */
  private started = false;

  constructor(
    @inject(CRON_TOKENS.CRON_JOB_STORE)
    private readonly jobs: IJobStore,
    @inject(CRON_TOKENS.CRON_RUN_STORE)
    private readonly runs: IRunStore,
    @inject(CRON_TOKENS.CRON_JOB_RUNNER)
    private readonly runner: JobRunner,
    @inject(CRON_TOKENS.CRON_CATCHUP_COORD)
    private readonly catchup: CatchupCoordinator,
    @inject(TOKENS.LOGGER)
    private readonly logger: Logger,
  ) {}

  // ────────────────────────────────────────────────────────────────────────
  // Lifecycle
  // ────────────────────────────────────────────────────────────────────────

  /**
   * Boot the scheduler with the given options. Idempotent.
   *
   * Order matters:
   *   1. Apply concurrency cap to the runner.
   *   2. Run cold-start catchup BEFORE arming new timers so missed slots
   *      from the previous boot don't race the next-fire scheduling.
   *   3. Arm timers for all enabled jobs.
   *   4. Subscribe the catchup coordinator to power events.
   */
  async start(options: CronSchedulerOptions): Promise<void> {
    if (this.started) return;
    if (!options.enabled) {
      this.logger.info('[cron-scheduler] disabled by settings; not starting');
      this.started = true;
      return;
    }
    this.runner.setMaxConcurrent(options.maxConcurrentJobs);

    try {
      await this.catchup.replayMissed(options, () => DEFAULT_CATCHUP_POLICY);
    } catch (err) {
      this.logger.error('[cron-scheduler] cold-start catchup failed', {
        err: (err as Error).message,
      });
    }

    const enabled = this.jobs.list({ enabledOnly: true });
    for (const job of enabled) this.armTimer(job);
    this.catchup.attach(
      () => options,
      () => DEFAULT_CATCHUP_POLICY,
    );
    this.started = true;
    this.logger.info('[cron-scheduler] started', {
      armed: this.timers.size,
      maxConcurrent: options.maxConcurrentJobs,
      catchupWindowMs: Math.min(options.catchupWindowMs, CATCHUP_WINDOW_MAX_MS),
    });
  }

  /** Idempotent shutdown. Stops every timer and detaches power listener. */
  stop(): void {
    if (!this.started) return;
    for (const [, timer] of this.timers) {
      try {
        timer.stop();
      } catch {
        /* swallow */
      }
    }
    this.timers.clear();
    this.catchup.detach();
    this.started = false;
    this.logger.info('[cron-scheduler] stopped');
  }

  // ────────────────────────────────────────────────────────────────────────
  // CRUD (RPC surface)
  // ────────────────────────────────────────────────────────────────────────

  list(opts?: { enabledOnly?: boolean }): ScheduledJob[] {
    return this.jobs.list(opts);
  }

  get(id: JobId): ScheduledJob | null {
    return this.jobs.get(id);
  }

  create(input: Omit<CreateJobInput, 'nextRunAt'>): ScheduledJob {
    const tz = input.timezone ?? 'UTC';
    // Construct a paused Cron — croner throws synchronously on invalid expr
    // or unknown tz. Let the error propagate verbatim (architecture §5.3).
    const Cron = loadCron();
    const probe = new Cron(input.cronExpr, {
      timezone: tz,
      protect: false,
      paused: true,
    });
    const nextRunAt: number | null = probe.nextRun()?.getTime() ?? null;
    probe.stop();
    const job = this.jobs.create({ ...input, timezone: tz, nextRunAt });
    if (this.started && job.enabled) this.armTimer(job);
    return job;
  }

  update(id: JobId, patch: UpdateJobPatch): ScheduledJob {
    const existing = this.jobs.get(id);
    if (!existing) throw new JobNotFoundError(id);
    const merged = { ...existing, ...patch };

    // If timing fields changed, re-validate + recompute nextRunAt.
    const cronChanged =
      patch.cronExpr !== undefined && patch.cronExpr !== existing.cronExpr;
    const tzChanged =
      patch.timezone !== undefined && patch.timezone !== existing.timezone;
    let nextRunAt = existing.nextRunAt;
    if (cronChanged || tzChanged) {
      const Cron = loadCron();
      const probe = new Cron(merged.cronExpr, {
        timezone: merged.timezone,
        protect: false,
        paused: true,
      });
      nextRunAt = probe.nextRun()?.getTime() ?? null;
      probe.stop();
    }
    const updated = this.jobs.update(id, { ...patch, nextRunAt });

    // Re-arm: tear down any existing timer, then arm if still enabled+started.
    this.disarmTimer(id);
    if (this.started && updated.enabled) this.armTimer(updated);
    return updated;
  }

  delete(id: JobId): boolean {
    this.disarmTimer(id);
    return this.jobs.delete(id);
  }

  toggle(id: JobId, enabled: boolean): ScheduledJob {
    return this.update(id, { enabled });
  }

  /**
   * Fire a job NOW. Bypasses cron expression — uses the current second
   * (same rounding as `armTimer`) so the UNIQUE constraint on
   * `(job_id, scheduled_for)` prevents a simultaneous scheduled tick from
   * also claiming the same slot. Raw `Date.now()` would produce a different
   * ms value than the timer's second-rounded slot, defeating the constraint.
   */
  async runNow(id: JobId, signal?: AbortSignal): Promise<JobRun | null> {
    const job = this.jobs.get(id);
    if (!job) throw new JobNotFoundError(id);
    const slot = Math.floor(Date.now() / 1000) * 1000;
    await this.runner.run(job, slot, { signal });
    return this.runs.latestForJob(id);
  }

  listRuns(id: JobId, opts?: { limit?: number; offset?: number }): JobRun[] {
    return this.runs.list(id, opts);
  }

  /**
   * Returns the next firing time (epoch ms) for a job — or null if the job
   * is disabled or has no future occurrence (e.g. a one-shot expression
   * already in the past).
   */
  nextFire(id: JobId): number | null {
    const job = this.jobs.get(id);
    if (!job || !job.enabled) return null;
    const Cron = loadCron();
    try {
      const probe = new Cron(job.cronExpr, {
        timezone: job.timezone,
        protect: false,
        paused: true,
      });
      const next = probe.nextRun()?.getTime() ?? null;
      probe.stop();
      return next;
    } catch {
      return null;
    }
  }

  // ────────────────────────────────────────────────────────────────────────
  // Internal: arm/disarm
  // ────────────────────────────────────────────────────────────────────────

  private armTimer(job: ScheduledJob): void {
    if (this.timers.has(job.id)) return;
    const Cron = loadCron();
    const timer = new Cron(
      job.cronExpr,
      {
        timezone: job.timezone,
        // protect=false because we have our own concurrency layer (semaphore
        // in JobRunner). croner's protect would otherwise drop overlapping
        // ticks silently, making operator visibility worse.
        protect: false,
      },
      () => {
        // croner doesn't pass scheduledFor — derive from "now" rounded to
        // the previous second to make the slot deterministic for UNIQUE.
        const slot = Math.floor(Date.now() / 1000) * 1000;
        void this.runner.run(job, slot).catch((err) => {
          this.logger.error('[cron-scheduler] runner.run threw', {
            jobId: job.id,
            err: (err as Error).message,
          });
        });
      },
    );
    this.timers.set(job.id, timer);
  }

  private disarmTimer(id: string): void {
    const timer = this.timers.get(id);
    if (!timer) return;
    try {
      timer.stop();
    } catch {
      /* swallow */
    }
    this.timers.delete(id);
  }
}
