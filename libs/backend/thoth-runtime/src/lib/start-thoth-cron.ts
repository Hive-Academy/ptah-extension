import type { DependencyContainer } from 'tsyringe';

import { PLATFORM_TOKENS } from '@ptah-extension/platform-core';
import type { IWorkspaceProvider } from '@ptah-extension/platform-core';
import {
  PERSISTENCE_TOKENS,
  type IBackupService,
} from '@ptah-extension/persistence-sqlite';
import {
  CRON_TOKENS,
  type CronScheduler,
  type IHandlerRegistry,
  type IJobStore,
} from '@ptah-extension/cron-scheduler';

import {
  DEFAULT_THOTH_LOG_PREFIX,
  type StartThothCronOptions,
  type ThothRuntimeRefs,
} from './types';

/**
 * Start the Thoth cron scheduler and register the built-in daily SQLite
 * backup job. Mutates `refs.cronScheduler` in place so the host keeps a
 * single refs object for its LIFO teardown chain.
 *
 * Split from {@link bootThothRuntime} because hosts run their own activation
 * work (content download, plugin loader, CLI detection, session import)
 * between the Thoth boot and the cron start; folding cron into the boot would
 * let scheduled jobs fire during that window.
 */
export async function startThothCron(
  container: DependencyContainer,
  refs: ThothRuntimeRefs,
  options: StartThothCronOptions = {},
): Promise<void> {
  const logPrefix = options.logPrefix ?? DEFAULT_THOTH_LOG_PREFIX;

  try {
    if (
      refs.sqliteConnection !== null &&
      container.isRegistered(CRON_TOKENS.CRON_SCHEDULER)
    ) {
      const workspaceProvider = container.resolve<IWorkspaceProvider>(
        PLATFORM_TOKENS.WORKSPACE_PROVIDER,
      );
      const enabled = workspaceProvider.getConfiguration<boolean>(
        'ptah',
        'cron.enabled',
        true,
      );
      const maxConcurrentJobs = workspaceProvider.getConfiguration<number>(
        'ptah',
        'cron.maxConcurrentJobs',
        3,
      );
      const catchupWindowMs = workspaceProvider.getConfiguration<number>(
        'ptah',
        'cron.catchupWindowMs',
        86_400_000,
      );
      refs.cronScheduler = container.resolve<CronScheduler>(
        CRON_TOKENS.CRON_SCHEDULER,
      );
      if (
        container.isRegistered(CRON_TOKENS.CRON_JOB_STORE) &&
        container.isRegistered(CRON_TOKENS.CRON_HANDLER_REGISTRY)
      ) {
        try {
          const jobStore = container.resolve<IJobStore>(
            CRON_TOKENS.CRON_JOB_STORE,
          );
          const handlerRegistry = container.resolve<IHandlerRegistry>(
            CRON_TOKENS.CRON_HANDLER_REGISTRY,
          );
          const BACKUP_HANDLER_NAME = 'backup:daily';
          if (!handlerRegistry.has(BACKUP_HANDLER_NAME)) {
            handlerRegistry.register(BACKUP_HANDLER_NAME, async () => {
              const sqliteConn = refs.sqliteConnection;
              if (!sqliteConn) {
                return { summary: 'skipped: no sqlite connection' };
              }
              const backupSvc = container.resolve<IBackupService>(
                PERSISTENCE_TOKENS.BACKUP_SERVICE,
              );
              const backupPath = await backupSvc.backup(sqliteConn.db, 'daily');
              try {
                backupSvc.rotate('daily', 7);
              } catch (rotateErr: unknown) {
                console.warn(
                  `${logPrefix} Daily backup rotation failed (non-fatal):`,
                  rotateErr instanceof Error
                    ? rotateErr.message
                    : String(rotateErr),
                );
              }
              try {
                sqliteConn.db.pragma('incremental_vacuum(100)');
              } catch (vacuumErr: unknown) {
                console.warn(
                  `${logPrefix} Post-backup incremental_vacuum failed (non-fatal):`,
                  vacuumErr instanceof Error
                    ? vacuumErr.message
                    : String(vacuumErr),
                );
              }
              try {
                sqliteConn.db.pragma('optimize');
              } catch (optimizeErr: unknown) {
                console.warn(
                  `${logPrefix} Post-backup optimize failed (non-fatal):`,
                  optimizeErr instanceof Error
                    ? optimizeErr.message
                    : String(optimizeErr),
                );
              }
              return {
                summary: backupPath
                  ? `backup written to ${backupPath}`
                  : 'backup skipped (db.backup unavailable)',
              };
            });
          }
          jobStore.upsert({
            id: '@ptah/daily-backup',
            name: 'Daily SQLite Backup',
            cronExpr: '0 3 * * *', // 03:00 UTC daily
            timezone: 'UTC',
            prompt: `handler:${BACKUP_HANDLER_NAME}`,
            enabled: true,
          });
          console.log(
            `${logPrefix} Daily backup cron job registered (@ptah/daily-backup)`,
          );
        } catch (registerErr: unknown) {
          console.warn(
            `${logPrefix} Daily backup cron registration failed (non-fatal):`,
            registerErr instanceof Error
              ? registerErr.message
              : String(registerErr),
          );
        }
      }
      await refs.cronScheduler.start({
        enabled: enabled ?? true,
        maxConcurrentJobs: maxConcurrentJobs ?? 3,
        catchupWindowMs: catchupWindowMs ?? 86_400_000,
      });
      console.log(`${logPrefix} Cron scheduler started`, {
        enabled,
        maxConcurrentJobs,
        catchupWindowMs,
      });
    }
  } catch (error) {
    console.warn(
      `${logPrefix} Cron scheduler start skipped (non-fatal):`,
      error instanceof Error ? error.message : String(error),
    );
    refs.cronScheduler = null;
  }
}
