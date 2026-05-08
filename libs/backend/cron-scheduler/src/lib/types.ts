/**
 * Public types for the cron scheduler.
 *
 * Schema authority: `libs/backend/persistence-sqlite/src/lib/migrations/0004_cron.sql`.
 *  - `scheduled_jobs(id ULID, name, cron_expr, timezone DEFAULT 'UTC', prompt,
 *      workspace_root, enabled, created_at, updated_at, last_run_at, next_run_at)`
 *  - `job_runs(id ULID, job_id FK CASCADE, scheduled_for INTEGER, started_at,
 *      ended_at, status CHECK(...), result_summary, error_message,
 *      UNIQUE(job_id, scheduled_for))`
 *
 * Time format: integer epoch milliseconds (matches existing Ptah convention —
 * `session-metadata-store.ts`, `compaction-hook-handler.ts`). The 0004 schema
 * does not have a `catchup` column; we materialize the catchup policy from
 * settings/options at runtime (see `CatchupPolicy`). If a per-job catchup
 * policy needs durability later, add a forward-only migration — never edit
 * 0004_cron.sql in place.
 */
import type { JobId, RunId } from '@ptah-extension/shared';

/** Job run status. Mirrors the SQL CHECK constraint exactly. */
export type JobRunStatus =
  | 'pending'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'skipped';

/**
 * Catchup policy per job — applied when {@link CatchupCoordinator} sees
 * missed slots after a resume / process restart.
 *  - `none`: ignore missed slots; only fire next future occurrence.
 *  - `last`: fire at most once for the most-recent missed slot.
 *  - `all`: fire every missed slot up to {@link CronSchedulerOptions.catchupWindowMs}.
 */
export type CatchupPolicy = 'none' | 'last' | 'all';

/** Persisted scheduled job row (returned by {@link IJobStore}). */
export interface ScheduledJob {
  id: JobId;
  name: string;
  /** Croner-compatible expression (5- or 6-field). */
  cronExpr: string;
  /** IANA timezone name; validated against croner before insert. */
  timezone: string;
  prompt: string;
  workspaceRoot: string | null;
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
  lastRunAt: number | null;
  nextRunAt: number | null;
}

/** Persisted job-run row (returned by {@link IRunStore}). */
export interface JobRun {
  id: RunId;
  jobId: JobId;
  /** The slot this run claims (epoch ms). UNIQUE(job_id, scheduled_for). */
  scheduledFor: number;
  startedAt: number | null;
  endedAt: number | null;
  status: JobRunStatus;
  resultSummary: string | null;
  errorMessage: string | null;
}

/** Args for `IJobStore.create`. The store assigns id/timestamps/next_run_at. */
export interface CreateJobInput {
  name: string;
  cronExpr: string;
  /** Defaults to 'UTC' if omitted. */
  timezone?: string;
  prompt: string;
  workspaceRoot?: string | null;
  enabled?: boolean;
  /** Pre-computed by the scheduler before insert. */
  nextRunAt: number | null;
}

/**
 * Args for `IJobStore.upsert`. Like {@link CreateJobInput} but with a
 * caller-supplied `id` (may be any string — not required to be a ULID).
 * Used for system jobs with deterministic IDs (e.g. `@ptah/daily-backup`).
 */
export interface UpsertJobInput {
  id: string;
  name: string;
  cronExpr: string;
  /** Defaults to 'UTC' if omitted. */
  timezone?: string;
  prompt: string;
  workspaceRoot?: string | null;
  enabled?: boolean;
  /** Pre-computed next run at, or null to leave unset. */
  nextRunAt?: number | null;
}

/** Args for `IJobStore.update`. */
export interface UpdateJobPatch {
  name?: string;
  cronExpr?: string;
  timezone?: string;
  prompt?: string;
  workspaceRoot?: string | null;
  enabled?: boolean;
  nextRunAt?: number | null;
  lastRunAt?: number | null;
}

/** Options injected into `CronScheduler` from settings (see file-settings-keys.ts). */
export interface CronSchedulerOptions {
  /** Master kill-switch — when false the scheduler does not arm any timers. */
  enabled: boolean;
  /** Hard cap on simultaneous in-flight runs across all jobs. */
  maxConcurrentJobs: number;
  /** Upper bound on how far back catchup will replay (ms). Capped at 24h. */
  catchupWindowMs: number;
}

/** Hard ceiling on `catchupWindowMs` (24 hours, per architecture §4.3). */
export const CATCHUP_WINDOW_MAX_MS = 86_400_000;

/**
 * Handler registry — dispatches a job run to a named handler.
 *
 * Two execution modes are supported in v1:
 *  - **Named handler** (e.g. `memory:decay`, `gateway:cleanup`,
 *    `skills:archiveStale`): implemented by the consumer library and
 *    registered into the scheduler at boot via {@link IHandlerRegistry.register}.
 *  - **Prompt handler** (default): the prompt text is forwarded to
 *    `SDK_INTERNAL_QUERY_SERVICE` when no named handler is registered for it.
 *
 * The convention is: if {@link ScheduledJob.prompt} starts with `handler:`
 * (e.g. `handler:memory:decay`), the runner extracts the suffix and looks up
 * the registry. Otherwise the entire prompt is treated as text input for the
 * SDK.
 */
export interface IHandlerRegistry {
  register(name: string, handler: JobHandler): void;
  unregister(name: string): void;
  has(name: string): boolean;
  resolve(name: string): JobHandler | undefined;
}

/** Named job handler signature. Runs inline on the scheduler thread (v1). */
export type JobHandler = (ctx: JobHandlerContext) => Promise<JobHandlerResult>;

export interface JobHandlerContext {
  job: ScheduledJob;
  scheduledFor: number;
  /** Aborts the handler when the scheduler shuts down or a runNow is cancelled. */
  signal: AbortSignal;
}

export interface JobHandlerResult {
  /** Short human-readable summary stored in `job_runs.result_summary`. */
  summary?: string;
}
