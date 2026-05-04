/**
 * Cron Scheduler RPC Handlers (TASK_2026_HERMES Track 3).
 *
 * Bridges the frontend Cron Scheduler UI to the backend `CronScheduler`
 * service. Surfaces nine `cron:*` methods:
 *   - cron:list         → list jobs (optionally enabled-only)
 *   - cron:get          → fetch one job by id
 *   - cron:create       → create + arm a new job (croner validates expr/tz)
 *   - cron:update       → patch + re-arm a job
 *   - cron:delete       → delete + disarm
 *   - cron:toggle       → enable/disable + arm/disarm
 *   - cron:runNow       → fire immediately, bypassing schedule
 *   - cron:runs         → list run history for a job
 *   - cron:nextFire     → next firing time (epoch ms)
 *
 * Croner errors (invalid expression, unknown timezone) propagate verbatim
 * — architecture §5.3 mandates surfacing croner's diagnostic messages
 * unchanged because they are the most actionable surface the user sees.
 */
import { inject, injectable } from 'tsyringe';
import { TOKENS } from '@ptah-extension/vscode-core';
import type { Logger, RpcHandler } from '@ptah-extension/vscode-core';
import {
  CRON_TOKENS,
  type CronScheduler,
  type JobRun,
  type ScheduledJob,
} from '@ptah-extension/cron-scheduler';
import type {
  CronCreateParams,
  CronCreateResult,
  CronDeleteParams,
  CronDeleteResult,
  CronGetParams,
  CronGetResult,
  CronListParams,
  CronListResult,
  CronNextFireParams,
  CronNextFireResult,
  CronRunNowParams,
  CronRunNowResult,
  CronRunsParams,
  CronRunsResult,
  CronToggleParams,
  CronToggleResult,
  CronUpdateParams,
  CronUpdateResult,
  JobRunDto,
  RpcMethodName,
  ScheduledJobDto,
} from '@ptah-extension/shared';
import { JobId } from '@ptah-extension/shared';
import * as path from 'node:path';

/**
 * SECURITY: validate user-supplied prompt + workspaceRoot before they reach
 * the scheduler.
 *
 *   - `handler:NAME` prompts dispatch to in-process handlers registered by
 *     trusted libraries (memory:decay, etc.). We reject them at the RPC
 *     surface so a UI-driven cron:create cannot invoke arbitrary internal
 *     handlers — those jobs must be created from within the host process.
 *   - `workspaceRoot` becomes the `cwd` for the SDK query when the job runs.
 *     Any non-absolute or `..`-bearing path is rejected — never trust the
 *     renderer to produce a clean path.
 */
function assertSafeCronUserInput(args: {
  prompt?: string;
  workspaceRoot?: string | null;
}): void {
  if (
    typeof args.prompt === 'string' &&
    args.prompt.trim().toLowerCase().startsWith('handler:')
  ) {
    throw new Error(
      "cron RPC: prompts starting with 'handler:' are reserved for internal jobs and cannot be created via RPC",
    );
  }
  if (args.workspaceRoot !== undefined && args.workspaceRoot !== null) {
    const wr = args.workspaceRoot;
    if (typeof wr !== 'string' || wr.length === 0) {
      throw new Error('cron RPC: workspaceRoot must be a non-empty string');
    }
    if (!path.isAbsolute(wr)) {
      throw new Error('cron RPC: workspaceRoot must be an absolute path');
    }
    const normalized = path.normalize(wr);
    if (normalized.split(path.sep).some((seg) => seg === '..')) {
      throw new Error("cron RPC: workspaceRoot must not contain '..' segments");
    }
  }
}

function toJobDto(job: ScheduledJob): ScheduledJobDto {
  return {
    id: job.id as unknown as string,
    name: job.name,
    cronExpr: job.cronExpr,
    timezone: job.timezone,
    prompt: job.prompt,
    workspaceRoot: job.workspaceRoot,
    enabled: job.enabled,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    lastRunAt: job.lastRunAt,
    nextRunAt: job.nextRunAt,
  };
}

function toRunDto(run: JobRun): JobRunDto {
  return {
    id: run.id as unknown as string,
    jobId: run.jobId as unknown as string,
    scheduledFor: run.scheduledFor,
    startedAt: run.startedAt,
    endedAt: run.endedAt,
    status: run.status,
    resultSummary: run.resultSummary,
    errorMessage: run.errorMessage,
  };
}

@injectable()
export class CronRpcHandlers {
  static readonly METHODS = [
    'cron:list',
    'cron:get',
    'cron:create',
    'cron:update',
    'cron:delete',
    'cron:toggle',
    'cron:runNow',
    'cron:runs',
    'cron:nextFire',
  ] as const satisfies readonly RpcMethodName[];

  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(TOKENS.RPC_HANDLER) private readonly rpcHandler: RpcHandler,
    @inject(CRON_TOKENS.CRON_SCHEDULER)
    private readonly scheduler: CronScheduler,
  ) {}

  register(): void {
    this.rpcHandler.registerMethod<CronListParams, CronListResult>(
      'cron:list',
      async (params) => {
        const jobs = this.scheduler.list({
          enabledOnly: params?.enabledOnly,
        });
        return { jobs: jobs.map(toJobDto) };
      },
    );

    this.rpcHandler.registerMethod<CronGetParams, CronGetResult>(
      'cron:get',
      async (params) => {
        if (!params?.id) return { job: null };
        const id = JobId.safeParse(params.id);
        if (!id) return { job: null };
        const job = this.scheduler.get(id);
        return { job: job ? toJobDto(job) : null };
      },
    );

    this.rpcHandler.registerMethod<CronCreateParams, CronCreateResult>(
      'cron:create',
      async (params) => {
        if (!params) {
          throw new Error('cron:create requires params');
        }
        assertSafeCronUserInput({
          prompt: params.prompt,
          workspaceRoot: params.workspaceRoot ?? null,
        });
        const job = this.scheduler.create({
          name: params.name,
          cronExpr: params.cronExpr,
          timezone: params.timezone,
          prompt: params.prompt,
          workspaceRoot: params.workspaceRoot ?? null,
          enabled: params.enabled,
        });
        return { job: toJobDto(job) };
      },
    );

    this.rpcHandler.registerMethod<CronUpdateParams, CronUpdateResult>(
      'cron:update',
      async (params) => {
        if (!params?.id) {
          throw new Error('cron:update requires id');
        }
        const id = JobId.from(params.id);
        const patch = params.patch ?? {};
        assertSafeCronUserInput({
          prompt: patch.prompt,
          workspaceRoot: patch.workspaceRoot ?? null,
        });
        const job = this.scheduler.update(id, patch);
        return { job: toJobDto(job) };
      },
    );

    this.rpcHandler.registerMethod<CronDeleteParams, CronDeleteResult>(
      'cron:delete',
      async (params) => {
        if (!params?.id) return { ok: false };
        const id = JobId.safeParse(params.id);
        if (!id) return { ok: false };
        const ok = this.scheduler.delete(id);
        return { ok };
      },
    );

    this.rpcHandler.registerMethod<CronToggleParams, CronToggleResult>(
      'cron:toggle',
      async (params) => {
        if (!params?.id) {
          throw new Error('cron:toggle requires id');
        }
        const id = JobId.from(params.id);
        const job = this.scheduler.toggle(id, params.enabled);
        return { job: toJobDto(job) };
      },
    );

    this.rpcHandler.registerMethod<CronRunNowParams, CronRunNowResult>(
      'cron:runNow',
      async (params) => {
        if (!params?.id) return { run: null };
        const id = JobId.safeParse(params.id);
        if (!id) return { run: null };
        const run = await this.scheduler.runNow(id);
        return { run: run ? toRunDto(run) : null };
      },
    );

    this.rpcHandler.registerMethod<CronRunsParams, CronRunsResult>(
      'cron:runs',
      async (params) => {
        if (!params?.id) return { runs: [] };
        const id = JobId.safeParse(params.id);
        if (!id) return { runs: [] };
        const runs = this.scheduler.listRuns(id, {
          limit: params.limit,
          offset: params.offset,
        });
        return { runs: runs.map(toRunDto) };
      },
    );

    this.rpcHandler.registerMethod<CronNextFireParams, CronNextFireResult>(
      'cron:nextFire',
      async (params) => {
        if (!params?.id) return { nextRunAt: null };
        const id = JobId.safeParse(params.id);
        if (!id) return { nextRunAt: null };
        const nextRunAt = this.scheduler.nextFire(id);
        return { nextRunAt };
      },
    );

    this.logger.info('[cron] RPC handlers registered');
  }
}
