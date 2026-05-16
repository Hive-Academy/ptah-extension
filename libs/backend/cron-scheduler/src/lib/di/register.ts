/**
 * cron-scheduler DI registration helper.
 *
 * Pre-conditions (caller responsibility):
 *  - `TOKENS.LOGGER` is registered (vscode-core).
 *  - `PERSISTENCE_TOKENS.SQLITE_CONNECTION` is registered + opened+migrated.
 *  - `SDK_TOKENS.SDK_INTERNAL_QUERY_SERVICE` is registered (agent-sdk).
 *  - `CRON_TOKENS.CRON_POWER_MONITOR` is registered as `useValue` or
 *    `useClass` by the host app — Electron registers `ElectronPowerMonitor`,
 *    VS Code registers `NoopPowerMonitor`. The cron-scheduler library does
 *    NOT supply a default because the right impl is host-specific.
 *
 * Post-conditions: every other CRON_TOKENS.* binding resolves to a singleton.
 */
import type { DependencyContainer } from 'tsyringe';
import type { Logger } from '@ptah-extension/vscode-core';
import { CRON_TOKENS } from './tokens';
import { CatchupCoordinator } from '../catchup-coordinator';
import { CronScheduler } from '../cron-scheduler';
import { HandlerRegistry } from '../handler-registry';
import { JobRunner } from '../job-runner';
import { JobStore } from '../job.store';
import { RunStore } from '../run.store';

export function registerCronSchedulerServices(
  container: DependencyContainer,
  logger: Logger,
): void {
  logger.info('[cron-scheduler] registering services');

  // Stores first — they only depend on persistence + logger.
  container.registerSingleton(CRON_TOKENS.CRON_JOB_STORE, JobStore);
  container.registerSingleton(CRON_TOKENS.CRON_RUN_STORE, RunStore);

  // Handler registry has no deps — register before runner.
  container.registerSingleton(
    CRON_TOKENS.CRON_HANDLER_REGISTRY,
    HandlerRegistry,
  );

  // Runner depends on stores + SDK + handler registry.
  container.registerSingleton(CRON_TOKENS.CRON_JOB_RUNNER, JobRunner);

  // Catchup depends on store + runner + power monitor.
  container.registerSingleton(
    CRON_TOKENS.CRON_CATCHUP_COORD,
    CatchupCoordinator,
  );

  // Scheduler — top-level, depends on everything above.
  container.registerSingleton(CRON_TOKENS.CRON_SCHEDULER, CronScheduler);

  logger.info('[cron-scheduler] services registered', {
    tokens: Object.keys(CRON_TOKENS),
  });
}
