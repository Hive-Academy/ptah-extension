/**
 * Public barrel for `@ptah-extension/cron-scheduler`.
 *
 * Anything not re-exported here is internal to the library and may change
 * without notice.
 */
export { CronScheduler } from './lib/cron-scheduler';
export { JobRunner } from './lib/job-runner';
export { CatchupCoordinator } from './lib/catchup-coordinator';
export { JobStore, type IJobStore } from './lib/job.store';
export {
  RunStore,
  type IRunStore,
  SlotAlreadyClaimedError,
  isUniqueConstraintError,
} from './lib/run.store';
export { HandlerRegistry } from './lib/handler-registry';
export {
  CronSchedulerError,
  JobNotFoundError,
  CronConfigError,
} from './lib/errors';

export type { IPowerMonitor } from './lib/power-monitor.interface';
export { NoopPowerMonitor } from './lib/power-monitor.interface';

export { CRON_TOKENS, type CronDIToken } from './lib/di/tokens';
export { registerCronSchedulerServices } from './lib/di/register';

export type {
  ScheduledJob,
  JobRun,
  JobRunStatus,
  CreateJobInput,
  UpdateJobPatch,
  UpsertJobInput,
  CronSchedulerOptions,
  CatchupPolicy,
  IHandlerRegistry,
  JobHandler,
  JobHandlerContext,
  JobHandlerResult,
} from './lib/types';
export { CATCHUP_WINDOW_MAX_MS } from './lib/types';
