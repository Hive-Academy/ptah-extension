// === TRACK_3_CRON_SCHEDULER_BEGIN ===
/**
 * JobRunner — claims a slot, dispatches to a handler, and records the outcome.
 *
 * The runner owns NO scheduling logic; it is a pure executor invoked by
 * {@link CronScheduler} (for the next-fire path) and {@link CatchupCoordinator}
 * (for missed slots after resume).
 *
 * Concurrency: a global semaphore (max = `CronSchedulerOptions.maxConcurrentJobs`)
 * gates entry. Slots that can't acquire the semaphore are persisted as
 * `skipped` with reason `concurrency-limit` so the operator sees them in
 * `cron:runs` instead of vanishing silently.
 *
 * Dispatch:
 *   - `prompt` starting with `handler:NAME[:SUB]` → look up `IHandlerRegistry`.
 *     If unregistered → mark failed (this is a config bug, not a transient).
 *   - otherwise → forward the prompt to `SDK_INTERNAL_QUERY_SERVICE` and
 *     drain the stream until a `result` message lands. The result message's
 *     summary (or "ok") is stored.
 *
 * Abort: every run is wrapped in an `AbortController` linked to the optional
 * caller `signal`. Aborts are recorded as `skipped` with the reason carried
 * forward (`shutdown`, `runNow-cancelled`, …).
 */
import { inject, injectable } from 'tsyringe';
import { TOKENS, type Logger } from '@ptah-extension/vscode-core';
import { CRON_TOKENS } from './di/tokens';
import type { IJobStore } from './job.store';
import type { IRunStore } from './run.store';
import { SlotAlreadyClaimedError } from './run.store';
import type { RunId } from '@ptah-extension/shared';
import type { IHandlerRegistry, JobHandlerResult, ScheduledJob } from './types';
import { SDK_TOKENS } from '@ptah-extension/agent-sdk';
import type {
  InternalQueryConfig,
  InternalQueryHandle,
} from '@ptah-extension/agent-sdk';

/**
 * SDK_INTERNAL_QUERY_SERVICE has a single relevant method: `execute(config)`.
 * Importing the concrete class would couple us to the SDK module's heavy
 * graph, so we declare just the slice we use.
 */
interface IInternalQueryService {
  execute(config: InternalQueryConfig): Promise<InternalQueryHandle>;
}

const HANDLER_PREFIX = 'handler:';

export interface JobRunnerRunOptions {
  /** Caller-provided abort signal (e.g. from `runNow` or shutdown). */
  signal?: AbortSignal;
  /**
   * Reserved for catchup: when true, the runner will *not* update
   * `lastRunAt`/`nextRunAt` on the job (the coordinator drives those for
   * batched replays). Default false.
   */
  suppressJobTimestamps?: boolean;
}

@injectable()
export class JobRunner {
  /** In-flight count — guarded by `maxConcurrent`. */
  private inFlight = 0;
  /** Resolved at construction; the scheduler can call `setMaxConcurrent`. */
  private maxConcurrent = 3;

  constructor(
    @inject(CRON_TOKENS.CRON_RUN_STORE)
    private readonly runs: IRunStore,
    @inject(CRON_TOKENS.CRON_JOB_STORE)
    private readonly jobs: IJobStore,
    @inject(SDK_TOKENS.SDK_INTERNAL_QUERY_SERVICE)
    private readonly internalQuery: IInternalQueryService,
    @inject(CRON_TOKENS.CRON_HANDLER_REGISTRY)
    private readonly handlers: IHandlerRegistry,
    @inject(TOKENS.LOGGER)
    private readonly logger: Logger,
  ) {}

  /**
   * Set the global concurrency cap. Called by `CronScheduler` after it reads
   * `cron.maxConcurrentJobs` from settings; defaults to 3 if never called.
   */
  setMaxConcurrent(n: number): void {
    if (!Number.isFinite(n) || n < 1) {
      throw new Error(
        `JobRunner.setMaxConcurrent: expected positive integer, got ${n}`,
      );
    }
    this.maxConcurrent = Math.floor(n);
  }

  /** Read-only view for tests / metrics. */
  get currentInFlight(): number {
    return this.inFlight;
  }

  /**
   * Claim a slot and execute the job. Returns when the run terminates
   * (succeeded / failed / skipped). Never throws — all errors are recorded
   * on the run row so the scheduler loop continues.
   */
  async run(
    job: ScheduledJob,
    scheduledFor: number,
    opts: JobRunnerRunOptions = {},
  ): Promise<void> {
    // ── 1. Try to claim the slot. UNIQUE collision = another runner has it. ──
    let runId: RunId;
    try {
      const claimed = this.runs.tryClaim(job.id, scheduledFor);
      runId = claimed.id;
    } catch (err) {
      if (err instanceof SlotAlreadyClaimedError) {
        this.logger.debug('[cron-scheduler] slot already claimed', {
          jobId: job.id,
          scheduledFor,
        });
        return;
      }
      this.logger.error('[cron-scheduler] tryClaim failed', {
        jobId: job.id,
        scheduledFor,
        err: (err as Error).message,
      });
      return;
    }

    // ── 2. Concurrency gate. Persist skipped rows for visibility. ──
    if (this.inFlight >= this.maxConcurrent) {
      this.runs.markSkipped(runId, 'concurrency-limit');
      this.logger.warn('[cron-scheduler] skipped: concurrency cap reached', {
        jobId: job.id,
        scheduledFor,
        max: this.maxConcurrent,
      });
      return;
    }

    // ── 3. Wire abort: caller signal OR our own controller. ──
    const localCtl = new AbortController();
    const onCallerAbort = (): void => localCtl.abort();
    if (opts.signal) {
      if (opts.signal.aborted) localCtl.abort();
      else opts.signal.addEventListener('abort', onCallerAbort, { once: true });
    }

    this.inFlight += 1;
    this.runs.markStarted(runId);

    try {
      const result = await this.dispatch(job, scheduledFor, localCtl);
      this.runs.markSucceeded(runId, result.summary);
      if (!opts.suppressJobTimestamps) {
        this.jobs.update(job.id, { lastRunAt: Date.now() });
      }
      this.logger.debug('[cron-scheduler] run succeeded', {
        jobId: job.id,
        runId,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (localCtl.signal.aborted) {
        this.runs.markSkipped(runId, 'aborted');
        this.logger.info('[cron-scheduler] run aborted', {
          jobId: job.id,
          runId,
        });
      } else {
        this.runs.markFailed(runId, message);
        if (!opts.suppressJobTimestamps) {
          this.jobs.update(job.id, { lastRunAt: Date.now() });
        }
        this.logger.error('[cron-scheduler] run failed', {
          jobId: job.id,
          runId,
          err: message,
        });
      }
    } finally {
      this.inFlight -= 1;
      if (opts.signal) {
        opts.signal.removeEventListener('abort', onCallerAbort);
      }
    }
  }

  // ────────────────────────────────────────────────────────────────────────
  // Dispatch
  // ────────────────────────────────────────────────────────────────────────
  private async dispatch(
    job: ScheduledJob,
    scheduledFor: number,
    ctl: AbortController,
  ): Promise<JobHandlerResult> {
    if (job.prompt.startsWith(HANDLER_PREFIX)) {
      const name = job.prompt.slice(HANDLER_PREFIX.length).trim();
      if (!name) {
        throw new Error(`Empty handler name in prompt for job ${job.id}`);
      }
      const handler = this.handlers.resolve(name);
      if (!handler) {
        throw new Error(`No handler registered under '${name}'`);
      }
      return handler({ job, scheduledFor, signal: ctl.signal });
    }

    // Prompt path: forward to SDK_INTERNAL_QUERY_SERVICE.
    const handle = await this.internalQuery.execute({
      cwd: job.workspaceRoot ?? process.cwd(),
      // The scheduler does not pin a model — InternalQueryService resolves
      // the active model via SdkModelService when given an empty string.
      model: '',
      prompt: job.prompt,
      isPremium: false,
      mcpServerRunning: false,
      abortController: ctl,
    });

    let summary: string | undefined;
    try {
      for await (const msg of handle.stream) {
        if (ctl.signal.aborted) break;
        // We don't need to interpret intermediate messages — only the final
        // `result` carries the summary we care about.
        if (
          msg &&
          typeof msg === 'object' &&
          (msg as { type?: unknown }).type === 'result'
        ) {
          const r = msg as { result?: unknown; subtype?: unknown };
          if (typeof r.result === 'string') summary = r.result.slice(0, 500);
          else if (r.subtype === 'error_max_turns')
            throw new Error('SDK reported max-turns exceeded');
          else if (r.subtype === 'error_during_execution')
            throw new Error('SDK reported execution error');
        }
      }
    } finally {
      try {
        handle.close();
      } catch {
        /* swallow close errors — abort path already recorded */
      }
    }
    return { summary: summary ?? 'ok' };
  }
}
// === TRACK_3_CRON_SCHEDULER_END ===
