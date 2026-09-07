import type { DependencyContainer } from 'tsyringe';

import { PLATFORM_TOKENS } from '@ptah-extension/platform-core';
import type { IWorkspaceProvider } from '@ptah-extension/platform-core';
import {
  PERSISTENCE_TOKENS,
  type IBackupService,
  type SqliteIntegrityService,
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
  type SkillDrainService,
} from '@ptah-extension/skill-synthesis';

import { SKILL_DRAIN_JOBS } from './skill-drain-jobs';
import {
  DEFAULT_THOTH_LOG_PREFIX,
  type StartThothCronOptions,
  type ThothRuntimeRefs,
} from './types';
import {
  createActivityEmitter,
  withActivityEmit,
  type ActivityEmitter,
} from './activity-emitter';

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
  emit: ActivityEmitter,
): void {
  if (!container.isRegistered(SKILL_SYNTHESIS_TOKENS.SKILL_DRAIN_SERVICE)) {
    return;
  }
  for (const job of SKILL_DRAIN_JOBS) {
    if (!handlerRegistry.has(job.handlerName)) {
      const drainHandler = withActivityEmit(
        emit,
        job.handlerName,
        async (ctx) => {
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
            ? {
                outcome: 'skipped' as const,
                reason: summary.reason ?? 'unknown',
              }
            : {
                summary: `claimed ${summary.claimed}, done ${summary.done}, failed ${summary.failed}`,
              };
        },
      );
      handlerRegistry.register(job.handlerName, drainHandler);
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

/** Cron handler name for the out-of-process database integrity check. */
const INTEGRITY_HANDLER_NAME = 'db:integrity';

/**
 * 03:30 UTC daily. Deliberately NOT `0 3` (the daily backup above) and not
 * `0 4` (the weekly skills drain): the integrity check reads the whole database
 * file, and on a gigabyte database that read must not contend with the backup's
 * full-file WRITE on the same tick.
 */
const INTEGRITY_CRON_EXPR = '30 3 * * *';

/**
 * How long after `startThothCron` the one boot dispatch fires.
 *
 * Sixty seconds, so the dispatch cannot land inside the window the deferred
 * boot work is clearing — the whole point of TASK_2026_380 is that nothing
 * expensive runs while the user is waiting for a usable window. This is a
 * constant, not a setting: there is no user question here.
 */
const INTEGRITY_BOOT_DISPATCH_DELAY_MS = 60_000;

/**
 * Register the integrity-check handler, upsert its nightly job, and arm the one
 * delayed boot dispatch.
 *
 * This block is the SECOND SEAM in this file, for the same reason as the drain
 * block above: `persistence-sqlite` must never import `cron-scheduler`, so
 * `thoth-runtime` is the only place where "a check is due" and "something runs
 * on a schedule" are allowed to meet. `SqliteIntegrityService` owns the
 * due-decision, the single-flight guard and the worker budget; this function
 * owns nothing but *when to ask*.
 *
 * THE DISPATCH IS NEVER AWAITED. Neither here nor in the handler: the check
 * costs 20-26 s cold on a gigabyte file, and holding a cron job slot (or the
 * boot timer's tick) open for it would reintroduce the blocking this task
 * removed. `dispatchIfDue()` never throws and never rejects, so a bare `void`
 * is safe — there is nothing to catch.
 *
 * Non-fatal by construction: a host that registers no
 * `SQLITE_INTEGRITY_SERVICE` gets no job and no timer.
 */
function registerIntegrityCheckJob(
  container: DependencyContainer,
  jobStore: IJobStore,
  handlerRegistry: IHandlerRegistry,
  logPrefix: string,
  emit: ActivityEmitter,
  signal: AbortSignal | undefined,
): void {
  if (!container.isRegistered(PERSISTENCE_TOKENS.SQLITE_INTEGRITY_SERVICE)) {
    return;
  }
  // `register` THROWS on a duplicate name and a host may call `startThothCron`
  // more than once, so both the handler AND the one-shot boot timer live behind
  // this guard — a second call must not arm a second dispatch.
  if (!handlerRegistry.has(INTEGRITY_HANDLER_NAME)) {
    handlerRegistry.register(
      INTEGRITY_HANDLER_NAME,
      withActivityEmit(emit, INTEGRITY_HANDLER_NAME, async () => {
        // Same guard shape as the boot timer three lines down: `isRegistered`
        // was true when this handler was REGISTERED, and the resolve happens
        // hours later — a container that has since been disposed throws, and a
        // cron run has nowhere to put that. A skipped run with a reason token
        // is the honest answer.
        let integrity: SqliteIntegrityService;
        try {
          integrity = container.resolve<SqliteIntegrityService>(
            PERSISTENCE_TOKENS.SQLITE_INTEGRITY_SERVICE,
          );
        } catch (resolveErr: unknown) {
          console.warn(
            `${logPrefix} Integrity check skipped (non-fatal):`,
            resolveErr instanceof Error
              ? resolveErr.message
              : String(resolveErr),
          );
          return {
            outcome: 'skipped' as const,
            reason: 'integrity-service-unavailable',
          };
        }
        if (!integrity.isDue()) {
          return { outcome: 'skipped' as const, reason: 'not-due' };
        }
        // No `signal` here on purpose: the boot signal belongs to the 60 s boot
        // window, and this run fires at 03:30. The cron runner owns this run's
        // lifetime.
        void integrity.dispatchIfDue();
        return { summary: 'integrity check dispatched (runs out of process)' };
      }),
    );

    // An already-aborted boot arms nothing. The host is quitting, so a timer
    // whose only job is to start a gigabyte read in sixty seconds has nothing
    // left to be right about.
    if (signal?.aborted !== true) {
      const bootTimer = setTimeout(() => {
        try {
          const integrity = container.resolve<SqliteIntegrityService>(
            PERSISTENCE_TOKENS.SQLITE_INTEGRITY_SERVICE,
          );
          // The boot signal reaches the CHILD PROCESS through here: a quit
          // during the check kills the worker and writes no record, rather than
          // leaving it reading the database behind a dying parent
          // (TASK_2026_380 whole-task logic review).
          void integrity.dispatchIfDue({ signal });
        } catch (bootErr: unknown) {
          console.warn(
            `${logPrefix} Integrity boot dispatch skipped (non-fatal):`,
            bootErr instanceof Error ? bootErr.message : String(bootErr),
          );
        }
      }, INTEGRITY_BOOT_DISPATCH_DELAY_MS);
      // Guarded shape because `unref` exists on Node's `Timeout` but not on the
      // DOM's numeric handle. An integrity check must never be the reason a host
      // refuses to quit.
      (bootTimer as { unref?: () => void }).unref?.();
    }
  }

  jobStore.upsert({
    id: '@ptah/db-integrity-check',
    name: 'Database Integrity Check',
    cronExpr: INTEGRITY_CRON_EXPR,
    timezone: 'UTC',
    prompt: `handler:${INTEGRITY_HANDLER_NAME}`,
    enabled: true,
  });
  console.log(
    `${logPrefix} Database integrity cron job registered (@ptah/db-integrity-check)`,
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
  // One emitter for every built-in cron job. Stateless and lazy, so building it
  // before the scheduler exists costs nothing and a host with no webview simply
  // emits nowhere. Only the jobs registered BELOW are wrapped — user-defined
  // jobs would need an event surface on `CronScheduler`, which is a change to a
  // different lib and out of scope.
  const emitActivity = createActivityEmitter(container, logPrefix);

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
            const backupHandler = withActivityEmit(
              emitActivity,
              BACKUP_HANDLER_NAME,
              async () => {
                const sqliteConn = refs.sqliteConnection;
                if (!sqliteConn) {
                  return { summary: 'skipped: no sqlite connection' };
                }
                const backupSvc = container.resolve<IBackupService>(
                  PERSISTENCE_TOKENS.BACKUP_SERVICE,
                );
                const backupPath = await backupSvc.backup(
                  sqliteConn.db,
                  'daily',
                );
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
              },
            );
            handlerRegistry.register(BACKUP_HANDLER_NAME, backupHandler);
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
            emitActivity,
          );
        } catch (drainErr: unknown) {
          console.warn(
            `${logPrefix} Skill drain cron registration failed (non-fatal):`,
            drainErr instanceof Error ? drainErr.message : String(drainErr),
          );
        }
        try {
          registerIntegrityCheckJob(
            container,
            container.resolve<IJobStore>(CRON_TOKENS.CRON_JOB_STORE),
            container.resolve<IHandlerRegistry>(
              CRON_TOKENS.CRON_HANDLER_REGISTRY,
            ),
            logPrefix,
            emitActivity,
            options.signal,
          );
        } catch (integrityErr: unknown) {
          console.warn(
            `${logPrefix} Database integrity cron registration failed (non-fatal):`,
            integrityErr instanceof Error
              ? integrityErr.message
              : String(integrityErr),
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
