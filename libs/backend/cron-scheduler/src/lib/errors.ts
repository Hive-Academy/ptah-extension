/**
 * Library error root for `@ptah-extension/cron-scheduler`.
 *
 * Per CONVENTIONS.md "Error handling": every backend library MUST surface a
 * single named root error so callers can `instanceof CronSchedulerError`
 * without depending on the precise leaf class.
 */
export class CronSchedulerError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'CronSchedulerError';
  }
}

/** Thrown when a CRUD/runNow request references a job id that does not exist. */
export class JobNotFoundError extends CronSchedulerError {
  constructor(public readonly jobId: string) {
    super(`Job not found: ${jobId}`);
    this.name = 'JobNotFoundError';
  }
}

/** Thrown when an invalid configuration value is supplied to the scheduler. */
export class CronConfigError extends CronSchedulerError {
  constructor(message: string) {
    super(message);
    this.name = 'CronConfigError';
  }
}
