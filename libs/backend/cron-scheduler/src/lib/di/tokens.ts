/**
 * DI Token Registry — Cron Scheduler Tokens (TASK_2026_HERMES Track 3).
 *
 * Convention mirrors `libs/backend/agent-sdk/src/lib/di/tokens.ts` and
 * `libs/backend/persistence-sqlite/src/lib/di/tokens.ts`:
 *  - Always `Symbol.for('Name')` (globally interned) — never plain `Symbol()`
 *    or string literals.
 *  - Each description is globally unique across all token files.
 *  - Frozen `as const` so consumer types narrow on the symbol values.
 *
 * Authoritative spec: TASK_2026_HERMES architecture.md §2.4.
 */
export const CRON_TOKENS = {
  /** CronScheduler — orchestrator: register/list/update/delete/runNow + croner timers. */
  CRON_SCHEDULER: Symbol.for('PtahCronScheduler'),
  /** JobRunner — claims an at-most-once slot via UNIQUE(job_id, scheduled_for) and executes. */
  CRON_JOB_RUNNER: Symbol.for('PtahCronJobRunner'),
  /** CatchupCoordinator — replays missed slots on power resume per per-job catchup policy. */
  CRON_CATCHUP_COORD: Symbol.for('PtahCronCatchupCoordinator'),
  /** IPowerMonitor adapter — Electron impl wraps `electron.powerMonitor`; VS Code impl is a stub. */
  CRON_POWER_MONITOR: Symbol.for('PtahCronPowerMonitor'),
  /** JobStore — CRUD over `scheduled_jobs` (ULID primary key, integer epoch timestamps). */
  CRON_JOB_STORE: Symbol.for('PtahCronJobStore'),
  /** RunStore — CRUD over `job_runs` + `tryClaim()` for at-most-once semantics. */
  CRON_RUN_STORE: Symbol.for('PtahCronRunStore'),
  /**
   * IHandlerRegistry — in-memory registry of named job handlers
   * (`memory:decay`, `gateway:cleanup`, `skills:archiveStale`, …).
   * Consumers register at boot; JobRunner resolves by name when a job's
   * prompt starts with `handler:`. Defaults to an empty registry.
   */
  CRON_HANDLER_REGISTRY: Symbol.for('PtahCronHandlerRegistry'),
} as const;

export type CronDIToken = keyof typeof CRON_TOKENS;
