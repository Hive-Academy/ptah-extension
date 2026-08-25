import type { DependencyContainer } from 'tsyringe';

import { TOKENS, type Logger } from '@ptah-extension/vscode-core';
import { PLATFORM_TOKENS } from '@ptah-extension/platform-core';
import type { IWorkspaceProvider } from '@ptah-extension/platform-core';
import {
  PERSISTENCE_TOKENS,
  type SqliteConnectionService,
  type VecLoadDiagnostic,
  type IBackupService,
} from '@ptah-extension/persistence-sqlite';
import {
  MEMORY_TOKENS,
  type MemoryCuratorService,
  type MemoryTriggerService,
  type IndexingControlService,
} from '@ptah-extension/memory-curator';
import {
  SKILL_SYNTHESIS_TOKENS,
  type DrainTier,
  type SkillDrainService,
  type SkillSynthesisService,
  type SkillTriggerService,
} from '@ptah-extension/skill-synthesis';
import {
  CRON_TOKENS,
  type CronScheduler,
  type IJobStore,
  type IHandlerRegistry,
  type IPowerMonitor,
} from '@ptah-extension/cron-scheduler';
import {
  GATEWAY_TOKENS,
  type GatewayService,
} from '@ptah-extension/messaging-gateway';
import {
  GATEWAY_CHAT_BRIDGE_TOKENS,
  type GatewayChatBridge,
} from '@ptah-extension/gateway-chat-bridge';

import type { CliWebviewManagerAdapter } from '../transport/cli-webview-manager-adapter.js';
import { wireThothPushBridges } from './wire-thoth-push-bridges.js';

export type ThothTier = 'oneshot' | 'runtime';
export type ThothTierOption = ThothTier | 'off';

interface EmbedderDisposable {
  dispose(): void | Promise<void>;
}

export interface ThothRefs {
  sqliteConnection: SqliteConnectionService | null;
  memoryCurator: MemoryCuratorService | null;
  memoryTrigger: MemoryTriggerService | null;
  skillSynthesis: SkillSynthesisService | null;
  skillTrigger: SkillTriggerService | null;
  cronScheduler: CronScheduler | null;
  gateway: GatewayService | null;
  chatBridge: GatewayChatBridge | null;
  embedderClient: EmbedderDisposable | null;
  pushDisposables: { dispose: () => void }[];
}

const BACKUP_HANDLER_NAME = 'backup:daily';
let vecDiagnosticEmitted = false;

/**
 * The three skill-synthesis drain tiers, as cron jobs. Same table, same seam
 * and same reasoning as `thoth-runtime/src/lib/start-thoth-cron.ts`: this file
 * is the CLI tier's copy of the boundary where `cron-scheduler` and
 * `skill-synthesis` are allowed to meet, which is why `drain()` takes
 * `onBattery` as a parameter instead of injecting `IPowerMonitor`.
 *
 * The two hosts are deliberately not merged — `cli-engine` runs its own
 * `activateThoth`/`disposeThoth` tier model, and converging them is a separate
 * task. Keep the two tables in step by hand until then.
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

export function resetVecDiagnosticForTest(): void {
  vecDiagnosticEmitted = false;
}

function emptyRefs(): ThothRefs {
  return {
    sqliteConnection: null,
    memoryCurator: null,
    memoryTrigger: null,
    skillSynthesis: null,
    skillTrigger: null,
    cronScheduler: null,
    gateway: null,
    chatBridge: null,
    embedderClient: null,
    pushDisposables: [],
  };
}

export async function activateThoth(
  container: DependencyContainer,
  tier: ThothTier,
  logger: Logger,
): Promise<ThothRefs> {
  const refs = emptyRefs();

  try {
    if (container.isRegistered(PERSISTENCE_TOKENS.SQLITE_CONNECTION)) {
      const connection = container.resolve<SqliteConnectionService>(
        PERSISTENCE_TOKENS.SQLITE_CONNECTION,
      );
      await connection.openAndMigrate();
      refs.sqliteConnection = connection;
      emitVecLoadDiagnostic(connection.vecLoadDiagnostic, logger);
    }
  } catch (error: unknown) {
    logger.warn('[CLI Thoth] SQLite open/migrate failed (non-fatal)', {
      error: error instanceof Error ? error.message : String(error),
    });
    refs.sqliteConnection = null;
  }

  try {
    if (container.isRegistered(PERSISTENCE_TOKENS.EMBEDDER)) {
      refs.embedderClient = container.resolve<EmbedderDisposable>(
        PERSISTENCE_TOKENS.EMBEDDER,
      );
    }
  } catch (error: unknown) {
    logger.warn('[CLI Thoth] Embedder client resolve skipped (non-fatal)', {
      error: error instanceof Error ? error.message : String(error),
    });
    refs.embedderClient = null;
  }

  if (tier === 'oneshot') {
    return refs;
  }

  const workspaceRoot = resolveWorkspaceRoot(container);

  await startMemory(container, refs, workspaceRoot, logger);
  await startSkillSynthesis(container, refs, logger);
  await startCron(container, refs, logger);
  await startGateway(container, refs, logger);

  try {
    const pushAdapter = container.resolve<CliWebviewManagerAdapter>(
      TOKENS.WEBVIEW_MANAGER,
    );
    refs.pushDisposables = wireThothPushBridges(container, pushAdapter, logger);
  } catch (error: unknown) {
    logger.warn('[CLI Thoth] Push-event bridge wiring skipped (non-fatal)', {
      error: error instanceof Error ? error.message : String(error),
    });
  }

  return refs;
}

export async function disposeThoth(
  refs: ThothRefs | undefined,
  logger: Logger,
): Promise<void> {
  if (!refs) return;

  for (const disposable of refs.pushDisposables) {
    await guard('pushBridge.dispose', logger, async () => {
      disposable.dispose();
    });
  }
  await guard('chatBridge.stop', logger, async () => {
    refs.chatBridge?.stop();
  });
  await guard('gateway.stop', logger, async () => {
    await refs.gateway?.stop();
  });
  await guard('cronScheduler.stop', logger, async () => {
    refs.cronScheduler?.stop();
  });
  await guard('skillTrigger.stop', logger, async () => {
    refs.skillTrigger?.stop();
  });
  await guard('skillSynthesis.stop', logger, async () => {
    refs.skillSynthesis?.stop();
  });
  await guard('memoryTrigger.stop', logger, async () => {
    refs.memoryTrigger?.stop();
  });
  await guard('memoryCurator.stop', logger, async () => {
    refs.memoryCurator?.stop();
  });
  await guard('embedderClient.dispose', logger, async () => {
    await refs.embedderClient?.dispose();
  });
  await guard('sqliteConnection.close', logger, async () => {
    refs.sqliteConnection?.close();
  });
}

async function guard(
  label: string,
  logger: Logger,
  fn: () => Promise<void>,
): Promise<void> {
  try {
    await fn();
  } catch (error: unknown) {
    logger.warn(`[CLI Thoth] dispose step ${label} failed (non-fatal)`, {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

function resolveWorkspaceRoot(
  container: DependencyContainer,
): string | undefined {
  try {
    const workspaceProvider = container.resolve<IWorkspaceProvider>(
      PLATFORM_TOKENS.WORKSPACE_PROVIDER,
    );
    return workspaceProvider.getWorkspaceRoot();
  } catch {
    return undefined;
  }
}

async function startMemory(
  container: DependencyContainer,
  refs: ThothRefs,
  workspaceRoot: string | undefined,
  logger: Logger,
): Promise<void> {
  try {
    if (
      refs.sqliteConnection !== null &&
      container.isRegistered(MEMORY_TOKENS.MEMORY_CURATOR)
    ) {
      const memoryCurator = container.resolve<MemoryCuratorService>(
        MEMORY_TOKENS.MEMORY_CURATOR,
      );
      let memoryEnabled = true;
      if (
        container.isRegistered(MEMORY_TOKENS.INDEXING_CONTROL) &&
        workspaceRoot
      ) {
        const indexingControl = container.resolve<IndexingControlService>(
          MEMORY_TOKENS.INDEXING_CONTROL,
        );
        const status = await indexingControl.getStatus(workspaceRoot);
        memoryEnabled = status.memoryEnabled;
      }
      if (memoryEnabled) {
        memoryCurator.start();
        refs.memoryCurator = memoryCurator;
      }
    }
  } catch (error: unknown) {
    logger.warn('[CLI Thoth] Memory curator start skipped (non-fatal)', {
      error: error instanceof Error ? error.message : String(error),
    });
    refs.memoryCurator = null;
  }

  try {
    if (
      refs.memoryCurator !== null &&
      container.isRegistered(MEMORY_TOKENS.MEMORY_TRIGGER_SERVICE)
    ) {
      const memoryTrigger = container.resolve<MemoryTriggerService>(
        MEMORY_TOKENS.MEMORY_TRIGGER_SERVICE,
      );
      memoryTrigger.start();
      refs.memoryTrigger = memoryTrigger;
    }
  } catch (error: unknown) {
    logger.warn('[CLI Thoth] Memory trigger start skipped (non-fatal)', {
      error: error instanceof Error ? error.message : String(error),
    });
    refs.memoryTrigger = null;
  }
}

async function startSkillSynthesis(
  container: DependencyContainer,
  refs: ThothRefs,
  logger: Logger,
): Promise<void> {
  try {
    if (
      container.isRegistered(SKILL_SYNTHESIS_TOKENS.SKILL_SYNTHESIS_SERVICE)
    ) {
      const skillSynthesis = container.resolve<SkillSynthesisService>(
        SKILL_SYNTHESIS_TOKENS.SKILL_SYNTHESIS_SERVICE,
      );
      await skillSynthesis.start();
      refs.skillSynthesis = skillSynthesis;
    }
  } catch (error: unknown) {
    logger.warn('[CLI Thoth] Skill synthesis start skipped (non-fatal)', {
      error: error instanceof Error ? error.message : String(error),
    });
    refs.skillSynthesis = null;
  }

  try {
    if (
      refs.skillSynthesis !== null &&
      container.isRegistered(SKILL_SYNTHESIS_TOKENS.SKILL_TRIGGER_SERVICE)
    ) {
      const skillTrigger = container.resolve<SkillTriggerService>(
        SKILL_SYNTHESIS_TOKENS.SKILL_TRIGGER_SERVICE,
      );
      skillTrigger.start();
      refs.skillTrigger = skillTrigger;
    }
  } catch (error: unknown) {
    logger.warn('[CLI Thoth] Skill trigger start skipped (non-fatal)', {
      error: error instanceof Error ? error.message : String(error),
    });
    refs.skillTrigger = null;
  }
}

async function startCron(
  container: DependencyContainer,
  refs: ThothRefs,
  logger: Logger,
): Promise<void> {
  try {
    if (
      refs.sqliteConnection === null ||
      !container.isRegistered(CRON_TOKENS.CRON_SCHEDULER)
    ) {
      return;
    }
    registerBackupJob(container, refs, logger);
    registerSkillDrainJobs(container, logger);

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

    const cronScheduler = container.resolve<CronScheduler>(
      CRON_TOKENS.CRON_SCHEDULER,
    );
    await cronScheduler.start({
      enabled: enabled ?? true,
      maxConcurrentJobs: maxConcurrentJobs ?? 3,
      catchupWindowMs: catchupWindowMs ?? 86_400_000,
    });
    refs.cronScheduler = cronScheduler;
  } catch (error: unknown) {
    logger.warn('[CLI Thoth] Cron scheduler start skipped (non-fatal)', {
      error: error instanceof Error ? error.message : String(error),
    });
    refs.cronScheduler = null;
  }
}

function registerBackupJob(
  container: DependencyContainer,
  refs: ThothRefs,
  logger: Logger,
): void {
  try {
    if (
      !container.isRegistered(CRON_TOKENS.CRON_JOB_STORE) ||
      !container.isRegistered(CRON_TOKENS.CRON_HANDLER_REGISTRY)
    ) {
      return;
    }
    const jobStore = container.resolve<IJobStore>(CRON_TOKENS.CRON_JOB_STORE);
    const handlerRegistry = container.resolve<IHandlerRegistry>(
      CRON_TOKENS.CRON_HANDLER_REGISTRY,
    );
    if (!handlerRegistry.has(BACKUP_HANDLER_NAME)) {
      handlerRegistry.register(BACKUP_HANDLER_NAME, async () => {
        const connection = refs.sqliteConnection;
        if (!connection) {
          return { summary: 'skipped: no sqlite connection' };
        }
        const backupService = container.resolve<IBackupService>(
          PERSISTENCE_TOKENS.BACKUP_SERVICE,
        );
        const backupPath = await backupService.backup(connection.db, 'daily');
        try {
          backupService.rotate('daily', 7);
        } catch (rotateError: unknown) {
          logger.warn('[CLI Thoth] Daily backup rotation failed (non-fatal)', {
            error:
              rotateError instanceof Error
                ? rotateError.message
                : String(rotateError),
          });
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
      cronExpr: '0 3 * * *',
      timezone: 'UTC',
      prompt: `handler:${BACKUP_HANDLER_NAME}`,
      enabled: true,
    });
  } catch (error: unknown) {
    logger.warn(
      '[CLI Thoth] Daily backup cron registration failed (non-fatal)',
      {
        error: error instanceof Error ? error.message : String(error),
      },
    );
  }
}

/**
 * Register the three drain handlers and upsert their jobs for the CLI tier.
 *
 * `has()` guards registration because `HandlerRegistry.register` THROWS on a
 * duplicate name and `activateThoth` can run more than once in a long-lived
 * CLI process. `upsert` is idempotent, so it is not guarded. Non-fatal by
 * construction: a CLI host without skill-synthesis simply gets no drain jobs.
 */
function registerSkillDrainJobs(
  container: DependencyContainer,
  logger: Logger,
): void {
  try {
    if (
      !container.isRegistered(CRON_TOKENS.CRON_JOB_STORE) ||
      !container.isRegistered(CRON_TOKENS.CRON_HANDLER_REGISTRY) ||
      !container.isRegistered(SKILL_SYNTHESIS_TOKENS.SKILL_DRAIN_SERVICE)
    ) {
      return;
    }
    const jobStore = container.resolve<IJobStore>(CRON_TOKENS.CRON_JOB_STORE);
    const handlerRegistry = container.resolve<IHandlerRegistry>(
      CRON_TOKENS.CRON_HANDLER_REGISTRY,
    );
    const workspaceProvider = container.resolve<IWorkspaceProvider>(
      PLATFORM_TOKENS.WORKSPACE_PROVIDER,
    );
    for (const job of SKILL_DRAIN_JOBS) {
      if (!handlerRegistry.has(job.handlerName)) {
        handlerRegistry.register(job.handlerName, async (ctx) => {
          const drain = container.resolve<SkillDrainService>(
            SKILL_SYNTHESIS_TOKENS.SKILL_DRAIN_SERVICE,
          );
          // Resolved per run, not captured: a laptop can move on and off mains
          // between two ticks.
          const monitor = container.resolve<IPowerMonitor>(
            CRON_TOKENS.CRON_POWER_MONITOR,
          );
          const summary = await drain.drain({
            tier: job.tier,
            signal: ctx.signal,
            onBattery: monitor.isOnBattery(),
          });
          // Same rule as the Electron/VS Code seam in
          // `thoth-runtime/start-thoth-cron.ts`: a gated tick did no work, so
          // it records as `skipped` with the drain's own reason token, not as
          // a success (TASK_2026_315 / C2).
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
  } catch (error: unknown) {
    logger.warn(
      '[CLI Thoth] Skill drain cron registration failed (non-fatal)',
      {
        error: error instanceof Error ? error.message : String(error),
      },
    );
  }
}

async function startGateway(
  container: DependencyContainer,
  refs: ThothRefs,
  logger: Logger,
): Promise<void> {
  try {
    if (container.isRegistered(GATEWAY_TOKENS.GATEWAY_SERVICE)) {
      const gateway = container.resolve<GatewayService>(
        GATEWAY_TOKENS.GATEWAY_SERVICE,
      );
      await gateway.start();
      refs.gateway = gateway;
    }
  } catch (error: unknown) {
    logger.warn('[CLI Thoth] Messaging gateway start skipped (non-fatal)', {
      error: error instanceof Error ? error.message : String(error),
    });
    refs.gateway = null;
  }

  try {
    if (
      refs.gateway !== null &&
      container.isRegistered(GATEWAY_CHAT_BRIDGE_TOKENS.GATEWAY_CHAT_BRIDGE)
    ) {
      const chatBridge = container.resolve<GatewayChatBridge>(
        GATEWAY_CHAT_BRIDGE_TOKENS.GATEWAY_CHAT_BRIDGE,
      );
      chatBridge.start();
      refs.chatBridge = chatBridge;
    }
  } catch (error: unknown) {
    logger.warn('[CLI Thoth] Gateway chat bridge start skipped (non-fatal)', {
      error: error instanceof Error ? error.message : String(error),
    });
    refs.chatBridge = null;
  }
}

function emitVecLoadDiagnostic(
  diagnostic: VecLoadDiagnostic,
  logger: Logger,
): void {
  if (vecDiagnosticEmitted) return;
  vecDiagnosticEmitted = true;

  const summary = {
    ok: diagnostic.ok,
    reason: diagnostic.reason,
    attemptedPath: diagnostic.attemptedPath,
    packageName: diagnostic.packageName,
    fsExists: diagnostic.fsExists,
    processArch: diagnostic.processArch,
    processPlatform: diagnostic.processPlatform,
    error: diagnostic.error,
    attempts: diagnostic.errorChain?.length ?? 0,
  };

  if (diagnostic.ok) {
    logger.info('[CLI Thoth] sqlite-vec diagnostic', summary);
  } else {
    logger.warn('[CLI Thoth] sqlite-vec diagnostic (offline)', summary);
  }
}
