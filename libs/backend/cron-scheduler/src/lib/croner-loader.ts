/**
 * croner-loader — lazy-require singleton for the croner `Cron` constructor.
 *
 * Both `CronScheduler` and `CatchupCoordinator` need croner. Centralizing
 * the require + cache here prevents two separate module-level caches that
 * diverge if one module is tree-shaken away.
 */
import { CronSchedulerError } from './errors';

export interface CronInstance {
  nextRun(after?: Date): Date | null;
  stop(): void;
  isRunning?(): boolean;
}

export type CronCtor = new (
  expr: string,
  options: {
    timezone?: string;
    protect?: boolean;
    paused?: boolean;
  },
  fn?: () => void,
) => CronInstance;

let cachedCronCtor: CronCtor | null = null;

export function loadCron(): CronCtor {
  if (cachedCronCtor) return cachedCronCtor;
  const mod = require('croner') as { Cron: CronCtor };
  if (!mod || typeof mod.Cron !== 'function') {
    throw new CronSchedulerError(
      "croner module loaded but did not export 'Cron' constructor",
    );
  }
  cachedCronCtor = mod.Cron;
  return cachedCronCtor;
}
