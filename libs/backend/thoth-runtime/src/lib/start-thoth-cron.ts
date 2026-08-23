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
  type IPowerMonitor,
} from '@ptah-extension/cron-scheduler';
import {
  SKILL_SYNTHESIS_TOKENS,
  type DrainTier,
  type SkillDrainService,
} from '@ptah-extension/skill-synthesis';

import {
  DEFAULT_THOTH_LOG_PREFIX,
  type StartThothCronOptions,
  type ThothRuntimeRefs,
} from './types';

/**
 * The three skill-synthesis drain tiers, as cron jobs.
 *
 * This block is the SEAM. `libs/backend/skill-synthesis` must never import
 * `cron-scheduler` (global invariant 8) — exactly as it already is for the
 * daily backup, `thoth-runtime` is the only place the two meet. That is why
 * `SkillDrainService.drain()` takes `onBattery` as a parameter instead of
 * injecting `IPowerMonitor`: this file reads the monitor and hands the boolean
 * across.
 *
 * Each tier is a superset of the cheaper one (`DRAIN_TIER_STAGES`), so an item
 * the frequent tick may not run is picked up nightly, and anything nightly may
 * not run is picked up weekly. Nothing is stranded by tier alone.
 *
 * The cron expressions are user-overridable settings, not constants; the
 * fallbacks below mirror `FILE_BASED_SETTINGS_DEFAULTS` in `platform-core`
 * because `getConfiguration` needs a value at the call site anyway.
 */
const SKILL_DRAIN_JOBS: ReadonlyArray<{
  readonly tier: DrainTier;
  readonly jobId: string;
  readonly name: string;
  readonly handlerName: string;
  readonly cronExprKey: string;
  readonly defaultCronExpr: string;
}> = [
  {
    tier: 'frequent',
    jobId: '@ptah/skills-drain-frequent',
    name: 'Skill Synthesis Drain (frequent)',
    handlerName: 'skills:drain:frequent',
    cronExprKey: 'skillSynthesis.drain.cronExpr',
    defaultCronExpr: '*/15 * * * *',
  },
  {
    tier: 'nightly',
    jobId: '@ptah/skills-drain-nightly',
    name: 'Skill Synthesis Drain (nightly)',
    handlerName: 'skills:drain:nightly',
    cronExprKey: 'skillSynthesis.drain.nightlyCronExpr',
    defaultCronExpr: '0 3 * * *',
  },
  {
    tier: 'weekly',
    jobId: '@ptah/skills-drain-weekly',
    name: 'Skill Synthesis Drain (weekly)',
    handlerName: 'skills:drain:weekly',
    cronExprKey: 'skillSynthesis.drain.weeklyCronExpr',
    defaultCronExpr: '0 4 * * 0',
  },
];

/**
 * Register the three drain handlers and upsert their jobs.
 *
 * `has()` guards the handler registration because `HandlerRegistry.register`
 * THROWS on a duplicate name, and a host may call `startThothCron` more than
 * once (re-activation, a second workspace). `jobStore.upsert` is idempotent by
 * definition, so it is not guarded — that is how the backup block already
 * behaves and the double-invocation spec pins both halves.
 *
 * Non-fatal by construction: a host with no skill-synthesis registration
 * simply gets no drain jobs.
 */
function registerSkillDrainJobs(
  container: DependencyContainer,
  jobStore: IJobStore,
  handlerRegistry: IHandlerRegistry,
  workspaceProvider: IWorkspaceProvider,
  logPrefix: string,
): void {
  if (!container.isRegistered(SKILL_SYNTHESIS_TOKENS.SKILL_DRAIN_SERVICE)) {
    return;
  }
  for (const job of SKILL_DRAIN_JOBS) {
    if (!handlerRegistry.has(job.handlerName)) {
      handlerRegistry.register(job.handlerName, async (ctx) => {
        const drain = container.resolve<SkillDrainService>(
          SKILL_SYNTHESIS_TOKENS.SKILL_DRAIN_SERVICE,
        );
        // Resolved per run, not captured: the monitor is a live OS view and a
        // laptop can move on and off mains between two ticks.
        const monitor = container.resolve<IPowerMonitor>(
          CRON_TOKENS.CRON_POWER_MONITOR,
        );
        const summary = await drain.drain({
          tier: job.tier,
          signal: ctx.signal,
          onBattery: monitor.isOnBattery(),
        });
        // A gated tick did no work, so it is not a success. `DrainSummary`
        // has carried `skipped` + `reason` since phase 1; before
        // TASK_2026_315 it could only reach the run row as prose inside
        // `summary`, and `cron:runs` said "succeeded". The reason token is
        // passed through verbatim (`daily-token-budget-exhausted`,
        // `on-battery`, …) rather than re-worded, so the run history shows
        // the same string the drain logs.
        return summary.skipped
          ? { outcome: 'skipped', reason: summary.reason ?? 'unknown' }
          : {
              summary: `claimed ${summary.claimed}, done ${summary.done}, failed ${summary.failed}`,
            };
      });
    }
    jobStore.upsert({
      id: job.jobId,
      name: job.name,
      cronExpr:
        workspaceProvider.getConfiguration<string>(
          'ptah',
          job.cronExprKey,
          job.defaultCronExpr,
        ) || job.defaultCronExpr,
      timezone: 'UTC',
      prompt: `handler:${job.handlerName}`,
      enabled: true,
    });
  }
  console.log(
    `${logPrefix} Skill synthesis drain cron jobs registered (frequent/nightly/weekly)`,
  );
}

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
        try {
          registerSkillDrainJobs(
            container,
            container.resolve<IJobStore>(CRON_TOKENS.CRON_JOB_STORE),
            container.resolve<IHandlerRegistry>(
              CRON_TOKENS.CRON_HANDLER_REGISTRY,
            ),
            workspaceProvider,
            logPrefix,
          );
        } catch (drainErr: unknown) {
          console.warn(
            `${logPrefix} Skill drain cron registration failed (non-fatal):`,
            drainErr instanceof Error ? drainErr.message : String(drainErr),
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
