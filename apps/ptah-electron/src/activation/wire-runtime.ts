import type { DependencyContainer } from 'tsyringe';
import type { BrowserWindow } from 'electron';
import {
  PLATFORM_TOKENS,
  ContentDownloadService,
} from '@ptah-extension/platform-core';
import type { IStateStorage } from '@ptah-extension/platform-core';
import { TOKENS, bindLicenseReactivity } from '@ptah-extension/vscode-core';
import type { Logger, WebviewManager } from '@ptah-extension/vscode-core';
import { MESSAGE_TYPES } from '@ptah-extension/shared';
import { SDK_TOKENS, setPtahMcpPort } from '@ptah-extension/agent-sdk';
import { AUTH_PROVIDERS_TOKENS } from '@ptah-extension/auth-providers';
import {
  AGENT_GENERATION_TOKENS,
  EnhancedPromptsService,
} from '@ptah-extension/agent-generation';
import type { IMultiPhaseAnalysisReader } from '@ptah-extension/agent-generation';
import { ElectronRpcMethodRegistrationService } from '../services/rpc/rpc-method-registration.service';
import { createApplicationMenu } from '../menu/application-menu';
import { syncCliAgentsOnActivation } from './cli-agent-sync';
import { syncCliSkillsOnActivation } from './cli-skill-sync';
import { activateSkillJunctions, initPluginLoader } from './plugin-activation';
import {
  PERSISTENCE_TOKENS,
  type SqliteConnectionService,
} from '@ptah-extension/persistence-sqlite';
import type { EmbedderWorkerClient } from '@ptah-extension/memory-curator';
import {
  CODE_SYMBOL_INDEXER,
  type CodeSymbolIndexer,
} from '@ptah-extension/workspace-intelligence';
import {
  MEMORY_TOKENS,
  type MemoryCuratorService,
  type MemoryTriggerService,
  type IndexingControlService,
  type IndexingRunDeps,
  type ObservationQueueStore,
  type CorpusStore,
} from '@ptah-extension/memory-curator';
import { IndexingRpcHandlers } from '@ptah-extension/rpc-handlers';
import {
  SKILL_SYNTHESIS_TOKENS,
  type SkillSynthesisService,
  type SkillTriggerService,
} from '@ptah-extension/skill-synthesis';
import {
  CRON_TOKENS,
  type CronScheduler,
  type IJobStore,
  type IHandlerRegistry,
} from '@ptah-extension/cron-scheduler';
import type { IBackupService } from '@ptah-extension/persistence-sqlite';
import type { IWorkspaceProvider } from '@ptah-extension/platform-core';
import type { GatewayService } from '@ptah-extension/messaging-gateway';

export interface WireRuntimeOptions {
  container: DependencyContainer;
  getMainWindow: () => BrowserWindow | null;
  startupWorkspaceRoot: string | undefined;
}

export interface WireRuntimeResult {
  resolvedStateStorage: IStateStorage | undefined;
  /**
   * Call this AFTER the main BrowserWindow fires `did-finish-load` to trigger
   * the 3-second idle warmup of the embedder + cross-encoder models.
   * The delay is intentionally anchored to window-ready so warmup I/O does not
   * overlap with the renderer's first render burst.
   * No-op when memory-curator was not started (null workspace or start failure).
   */
  scheduleWarmup: () => void;
  refs: {
    skillJunctionRef: { deactivateSync: () => void } | null;
    gitWatcher: {
      stop: () => void;
      switchWorkspace: (p: string) => void;
    } | null;
    /**
     * SQLite connection service handle for orderly shutdown. Null when
     * persistence-sqlite registration failed â€” caller's LIFO will-quit chain
     * must tolerate null.
     */
    sqliteConnection: SqliteConnectionService | null;
    /**
     * Memory curator service handle for orderly shutdown. Null when
     * memory-curator registration or `start()` failed.
     */
    memoryCurator: MemoryCuratorService | null;
    /**
     * Memory trigger service handle for orderly shutdown. Null when the
     * parent memory curator did not start or `start()` failed. Must be
     * stopped BEFORE the memory curator in the LIFO will-quit chain.
     */
    memoryTrigger: MemoryTriggerService | null;
    /**
     * Skill synthesis service handle for orderly shutdown. Null when
     * persistence-sqlite is unavailable or `start()` failed â€” caller still
     * owns the LIFO will-quit chain and must tolerate null.
     */
    skillSynthesis: SkillSynthesisService | null;
    /**
     * Skill trigger service handle for orderly shutdown. Null when the
     * parent skill synthesis did not start or `start()` failed. Must be
     * stopped BEFORE the skill synthesis in the LIFO will-quit chain.
     */
    skillTrigger: SkillTriggerService | null;
    /**
     * Cron scheduler handle for orderly shutdown. Null when
     * persistence-sqlite is unavailable, croner is missing, or `start()`
     * failed â€” caller's LIFO will-quit chain must tolerate null.
     */
    cronScheduler: CronScheduler | null;
    /**
     * Messaging gateway service handle for orderly shutdown. Null when
     * persistence-sqlite is unavailable or `gateway.enabled` is `false` â€”
     * caller's LIFO will-quit chain must tolerate null.
     */
    messagingGateway: GatewayService | null;
    /**
     * Chokidar file-system watcher for incremental code symbol re-indexing.
     * Null when SQLite is unavailable or CodeSymbolIndexer is not registered.
     * Must be closed on will-quit to avoid keeping the process alive.
     */
    symbolWatcher: import('chokidar').FSWatcher | null;
    /**
     * License reactivity binder disposable. Detaches license:verified and
     * license:expired listeners. Must be disposed in will-quit LIFO chain.
     */
    licenseReactivityDisposable: { dispose: () => void } | null;
  };
}

export async function wireRuntime(
  options: WireRuntimeOptions,
): Promise<WireRuntimeResult> {
  const { container, getMainWindow, startupWorkspaceRoot } = options;

  const refs: WireRuntimeResult['refs'] = {
    skillJunctionRef: null,
    gitWatcher: null,
    sqliteConnection: null,
    memoryCurator: null,
    memoryTrigger: null,
    skillSynthesis: null,
    skillTrigger: null,
    cronScheduler: null,
    messagingGateway: null,
    symbolWatcher: null,
    licenseReactivityDisposable: null,
  };

  let resolvedStateStorage: IStateStorage | undefined;
  try {
    const enhancedPrompts = container.resolve<EnhancedPromptsService>(
      AGENT_GENERATION_TOKENS.ENHANCED_PROMPTS_SERVICE,
    );
    const analysisStorage = container.resolve<IMultiPhaseAnalysisReader>(
      AGENT_GENERATION_TOKENS.ANALYSIS_STORAGE_SERVICE,
    );
    enhancedPrompts.setAnalysisReader(analysisStorage);
  } catch (error) {
    console.warn(
      '[Ptah Electron] Failed to wire multi-phase analysis reader:',
      error instanceof Error ? error.message : String(error),
    );
  }
  const rpcRegistration = container.resolve(
    ElectronRpcMethodRegistrationService,
  );
  rpcRegistration.registerAll();

  console.log(
    '[Ptah Electron] IPC bridge, WebviewManager, and RPC methods initialized',
  );
  try {
    resolvedStateStorage = container.resolve<IStateStorage>(
      PLATFORM_TOKENS.STATE_STORAGE,
    );
  } catch (error) {
    console.warn(
      '[Ptah Electron] Could not resolve STATE_STORAGE for window persistence:',
      error instanceof Error ? error.message : String(error),
    );
  }

  let hasBootedHeavyServices = false;

  const bootHeavyServices = async (workspaceRoot: string | undefined) => {
    if (hasBootedHeavyServices) return;
    hasBootedHeavyServices = true;
    console.log(
      '[Ptah Electron] Booting deferred backend services for workspace...',
    );
    try {
      if (container.isRegistered(PERSISTENCE_TOKENS.SQLITE_CONNECTION)) {
        console.log('[Ptah Electron] Resolving SQLite connection service...');
        refs.sqliteConnection = container.resolve<SqliteConnectionService>(
          PERSISTENCE_TOKENS.SQLITE_CONNECTION,
        );
        console.log(
          '[Ptah Electron] SQLite connection service resolved, calling openAndMigrate()...',
        );
        await refs.sqliteConnection.openAndMigrate();
        console.log(
          '[Ptah Electron] SQLite connection opened + migrated successfully',
        );
      } else {
        console.warn(
          '[Ptah Electron] PERSISTENCE_TOKENS.SQLITE_CONNECTION not registered, skipping',
        );
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      const isAbiMismatch =
        /NODE_MODULE_VERSION|compiled against a different Node\.js version/i.test(
          errorMessage,
        );
      console.error(
        '\n' +
          'â•”â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•—\n' +
          'â•‘  [Ptah] PERSISTENCE OFFLINE â€” Memory / Skills / Cron / Gateway   â•‘\n' +
          'â•‘  features will report PERSISTENCE_UNAVAILABLE until this is      â•‘\n' +
          'â•‘  resolved. The rest of the app will continue to boot.            â•‘\n' +
          (isAbiMismatch
            ? 'â•‘                                                                   â•‘\n' +
              'â•‘  CAUSE:  better-sqlite3 native module ABI mismatch.              â•‘\n' +
              'â•‘  FIX:    npm run electron:rebuild   (then restart Ptah)          â•‘\n'
            : 'â•‘                                                                   â•‘\n' +
              `â•‘  CAUSE:  ${errorMessage.slice(0, 56).padEnd(56)}     â•‘\n`) +
          'â•šâ•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•\n',
      );
      refs.sqliteConnection = null;
    }
    let indexingControl: IndexingControlService | null = null;
    try {
      if (
        refs.sqliteConnection !== null &&
        container.isRegistered(MEMORY_TOKENS.MEMORY_CURATOR)
      ) {
        refs.memoryCurator = container.resolve<MemoryCuratorService>(
          MEMORY_TOKENS.MEMORY_CURATOR,
        );
        if (container.isRegistered(MEMORY_TOKENS.INDEXING_CONTROL)) {
          indexingControl = container.resolve<IndexingControlService>(
            MEMORY_TOKENS.INDEXING_CONTROL,
          );
        }
        let memoryEnabled = true;
        if (indexingControl && workspaceRoot) {
          const status = await indexingControl.getStatus(workspaceRoot);
          memoryEnabled = status.memoryEnabled;
        }

        if (memoryEnabled) {
          refs.memoryCurator.start();
          console.log('[Ptah Electron] Memory curator started');
        } else {
          console.log(
            '[Ptah Electron] Memory curator not started (memoryEnabled = false)',
          );
        }
      }
    } catch (error) {
      console.warn(
        '[Ptah Electron] Memory curator start skipped (non-fatal):',
        error instanceof Error ? error.message : String(error),
      );
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
        console.log('[Ptah Electron] Memory trigger service started');
      }
    } catch (error) {
      console.warn(
        '[Ptah Electron] Memory trigger start skipped (non-fatal):',
        error instanceof Error ? error.message : String(error),
      );
      refs.memoryTrigger = null;
    }
    try {
      if (refs.memoryCurator !== null) {
        const webviewManager = container.resolve<WebviewManager>(
          TOKENS.WEBVIEW_MANAGER,
        );
        refs.memoryCurator.onEvent((ev) => {
          if (
            ev.kind === 'curator-run' &&
            ev.stats &&
            typeof ev.stats['created'] === 'number' &&
            (ev.stats['created'] as number) > 0
          ) {
            const extracted = Number(ev.stats['extracted'] ?? 0);
            const created = Number(ev.stats['created'] ?? 0);
            const merged = Number(ev.stats['merged'] ?? 0);
            void webviewManager.broadcastMessage(
              MESSAGE_TYPES.MEMORY_EXTRACTED,
              {
                sessionId: ev.sessionId ?? '',
                workspaceRoot: null,
                extracted,
                created,
                merged,
                timestamp: ev.timestamp,
              },
            );
          }
        });
        if (container.isRegistered(MEMORY_TOKENS.OBSERVATION_QUEUE_STORE)) {
          const queueStore = container.resolve<ObservationQueueStore>(
            MEMORY_TOKENS.OBSERVATION_QUEUE_STORE,
          );
          queueStore.onCapture((evt) => {
            void webviewManager.broadcastMessage(
              MESSAGE_TYPES.MEMORY_OBSERVATION_CAPTURED,
              evt,
            );
          });
        }
        if (container.isRegistered(MEMORY_TOKENS.CORPUS_STORE)) {
          const corpusStore = container.resolve<CorpusStore>(
            MEMORY_TOKENS.CORPUS_STORE,
          );
          corpusStore.onChange((evt) => {
            void webviewManager.broadcastMessage(
              MESSAGE_TYPES.MEMORY_CORPUS_CHANGED,
              evt,
            );
          });
        }
        console.log('[Ptah Electron] Memory push-event bridges wired');
      }
    } catch (error) {
      console.warn(
        '[Ptah Electron] Memory push-event bridges skipped (non-fatal):',
        error instanceof Error ? error.message : String(error),
      );
    }
    try {
      refs.skillSynthesis = container.resolve<SkillSynthesisService>(
        SKILL_SYNTHESIS_TOKENS.SKILL_SYNTHESIS_SERVICE,
      );
      await refs.skillSynthesis.start();
      console.log('[Ptah Electron] Skill synthesis started');
    } catch (error) {
      console.warn(
        '[Ptah Electron] Skill synthesis start skipped (non-fatal):',
        error instanceof Error ? error.message : String(error),
      );
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
        console.log('[Ptah Electron] Skill trigger service started');
      }
    } catch (error) {
      console.warn(
        '[Ptah Electron] Skill trigger start skipped (non-fatal):',
        error instanceof Error ? error.message : String(error),
      );
      refs.skillTrigger = null;
    }

    try {
      if (
        refs.sqliteConnection !== null &&
        refs.sqliteConnection.isOpen &&
        container.isRegistered(CODE_SYMBOL_INDEXER) &&
        workspaceRoot
      ) {
        const symbolIndexer =
          container.resolve<CodeSymbolIndexer>(CODE_SYMBOL_INDEXER);

        const runDeps: IndexingRunDeps = {
          runSymbols: async (
            wsRoot: string,
            options?: { signal?: AbortSignal },
          ): Promise<void> => {
            try {
              const startedAt = Date.now();
              await symbolIndexer.indexWorkspace(wsRoot, {
                ...(options?.signal ? { signal: options.signal } : {}),
                onProgress: (p) => {
                  const percent =
                    p.totalFiles > 0
                      ? Math.min(
                          100,
                          Math.round((p.filesScanned / p.totalFiles) * 100),
                        )
                      : 0;
                  const webviewManager = container.resolve<WebviewManager>(
                    TOKENS.WEBVIEW_MANAGER,
                  );
                  void webviewManager.broadcastMessage(
                    MESSAGE_TYPES.INDEXING_PROGRESS,
                    {
                      pipeline: 'symbols',
                      percent,
                      currentLabel: `${p.filesScanned}/${p.totalFiles} files`,
                      elapsedMs: Date.now() - startedAt,
                      totalKnown: true,
                    },
                  );
                },
              });
            } catch (err: unknown) {
              if (
                err instanceof DOMException ||
                (err instanceof Error && err.name === 'AbortError')
              ) {
                return;
              }
              throw err;
            }
          },
        };

        if (container.isRegistered(IndexingRpcHandlers)) {
          const indexingRpcHandlers =
            container.resolve<IndexingRpcHandlers>(IndexingRpcHandlers);
          indexingRpcHandlers.setRunDeps(runDeps);
        }
      }
    } catch (error) {
      console.warn(
        '[Ptah Electron] Code symbol indexer wiring skipped (non-fatal):',
        error instanceof Error ? error.message : String(error),
      );
    }
    const contentDownload = container.resolve<ContentDownloadService>(
      PLATFORM_TOKENS.CONTENT_DOWNLOAD,
    );
    contentDownload.ensureContent().then((result) => {
      if (!result.success) {
        console.warn(
          '[Ptah Electron] Content download failed (non-blocking):',
          result.error ?? 'Unknown error',
        );
      }
    });
    initPluginLoader(container, contentDownload.getPluginsPath());
    refs.skillJunctionRef = activateSkillJunctions(
      container,
      contentDownload.getPluginsPath(),
    );
    try {
      const providerModels = container.resolve(
        AUTH_PROVIDERS_TOKENS.SDK_PROVIDER_MODELS,
      ) as { prefetchPricing: () => Promise<number> };
      providerModels.prefetchPricing().catch((err) => {
        console.warn(
          '[Ptah Electron] Pricing pre-fetch failed (using bundled defaults):',
          err instanceof Error ? err.message : String(err),
        );
      });
      console.log('[Ptah Electron] Pricing pre-fetch initiated (background)');
    } catch (error) {
      console.warn(
        '[Ptah Electron] Pricing pre-fetch setup failed (non-fatal):',
        error instanceof Error ? error.message : String(error),
      );
    }
    try {
      const cliDetection = container.resolve(TOKENS.CLI_DETECTION_SERVICE) as {
        detectAll: () => Promise<
          Array<{ cli: string; installed: boolean; version?: string }>
        >;
        refreshCliTokens: () => Promise<void>;
      };

      cliDetection
        .detectAll()
        .then(async (results) => {
          const installed = results.filter((r) => r.installed);
          console.log(
            `[Ptah Electron] CLI detection complete: ${installed.length}/${results.length} CLIs found`,
          );
          if (installed.some((r) => r.cli === 'codex')) {
            try {
              await cliDetection.refreshCliTokens();
            } catch (refreshErr) {
              console.warn(
                '[Ptah Electron] CLI token refresh failed (non-blocking):',
                refreshErr instanceof Error
                  ? refreshErr.message
                  : String(refreshErr),
              );
            }
          }
        })
        .catch((err) => {
          console.warn(
            '[Ptah Electron] CLI detection failed (non-blocking):',
            err instanceof Error ? err.message : String(err),
          );
        });
    } catch (cliDetectError) {
      console.warn(
        '[Ptah Electron] CLI detection setup failed (non-blocking):',
        cliDetectError instanceof Error
          ? cliDetectError.message
          : String(cliDetectError),
      );
    }
    if (workspaceRoot) {
      try {
        const sessionImporter = container.resolve(
          SDK_TOKENS.SDK_SESSION_IMPORTER,
        ) as {
          scanAndImport: (path: string, limit?: number) => Promise<number>;
        };
        const imported = await sessionImporter.scanAndImport(workspaceRoot, 50);
        if (imported > 0) {
          console.log(
            `[Ptah Electron] Imported ${imported} existing Claude session(s)`,
          );
        }
      } catch (importError) {
        console.warn(
          '[Ptah Electron] Session import skipped (non-fatal):',
          importError instanceof Error
            ? importError.message
            : String(importError),
        );
      }
    }
    if (workspaceRoot) {
      try {
        const { GitWatcherService } =
          await import('../services/git-watcher.service');
        const gitInfoSvc = container.resolve(
          TOKENS.GIT_INFO_SERVICE,
        ) as InstanceType<
          typeof import('@ptah-extension/vscode-core').GitInfoService
        >;
        const webviewManager = container.resolve(TOKENS.WEBVIEW_MANAGER) as {
          broadcastMessage: (type: string, payload: unknown) => Promise<void>;
        };

        const logger = container.resolve<
          import('@ptah-extension/vscode-core').Logger
        >(TOKENS.LOGGER);
        const watcher = new GitWatcherService(gitInfoSvc, logger);
        watcher.start(workspaceRoot, (type, payload) => {
          webviewManager.broadcastMessage(type, payload);
        });
        refs.gitWatcher = watcher;
        console.log('[Ptah Electron] Git file system watcher started');
      } catch (error) {
        console.warn(
          '[Ptah Electron] Git watcher setup failed (non-fatal):',
          error instanceof Error ? error.message : String(error),
        );
      }
    }
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
                const backupPath = await backupSvc.backup(
                  sqliteConn.db,
                  'daily',
                );
                try {
                  backupSvc.rotate('daily', 7);
                } catch (rotateErr: unknown) {
                  console.warn(
                    '[Ptah Electron] Daily backup rotation failed (non-fatal):',
                    rotateErr instanceof Error
                      ? rotateErr.message
                      : String(rotateErr),
                  );
                }
                try {
                  sqliteConn.db.pragma('incremental_vacuum(100)');
                } catch (vacuumErr: unknown) {
                  console.warn(
                    '[Ptah Electron] Post-backup incremental_vacuum failed (non-fatal):',
                    vacuumErr instanceof Error
                      ? vacuumErr.message
                      : String(vacuumErr),
                  );
                }
                try {
                  sqliteConn.db.pragma('optimize');
                } catch (optimizeErr: unknown) {
                  console.warn(
                    '[Ptah Electron] Post-backup optimize failed (non-fatal):',
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
              '[Ptah Electron] Daily backup cron job registered (@ptah/daily-backup)',
            );
          } catch (registerErr: unknown) {
            console.warn(
              '[Ptah Electron] Daily backup cron registration failed (non-fatal):',
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
        console.log('[Ptah Electron] Cron scheduler started', {
          enabled,
          maxConcurrentJobs,
          catchupWindowMs,
        });
      }
    } catch (error) {
      console.warn(
        '[Ptah Electron] Cron scheduler start skipped (non-fatal):',
        error instanceof Error ? error.message : String(error),
      );
      refs.cronScheduler = null;
    }
  }; // end of bootHeavyServices
  createApplicationMenu(container, getMainWindow);
  const workspaceProvider = container.resolve<IWorkspaceProvider>(
    PLATFORM_TOKENS.WORKSPACE_PROVIDER,
  );
  workspaceProvider.onDidChangeWorkspaceFolders(() => {
    const active = workspaceProvider.getWorkspaceRoot();
    if (active) {
      bootHeavyServices(active).catch((err) => {
        console.error(
          '[Ptah Electron] Failed to boot heavy services lazily:',
          err,
        );
      });
    }
  });

  if (startupWorkspaceRoot) {
    await bootHeavyServices(startupWorkspaceRoot);
  }
  try {
    const logger = container.resolve<Logger>(TOKENS.LOGGER);
    let pluginsPathForSync: string;
    try {
      const contentDownloadForSync = container.resolve<ContentDownloadService>(
        PLATFORM_TOKENS.CONTENT_DOWNLOAD,
      );
      pluginsPathForSync = contentDownloadForSync.getPluginsPath();
    } catch {
      const os = await import('os');
      const path = await import('path');
      pluginsPathForSync = path.join(os.homedir(), '.ptah', 'plugins');
    }

    const currentWorkspaceRoot = startupWorkspaceRoot;

    refs.licenseReactivityDisposable = bindLicenseReactivity({
      container,
      logger,
      onMcpPortChange: (port) => {
        setPtahMcpPort(port ?? 0);
      },
      notify: (kind) => {
        if (kind === 'verified') {
          console.log('[Ptah Electron] Ptah premium features activated.');
        } else {
          console.log(
            '[Ptah Electron] Ptah premium features deactivated (license expired).',
          );
        }
      },
      syncCliSkills: () => {
        syncCliSkillsOnActivation(container, pluginsPathForSync);
      },
      syncCliAgents: () => {
        if (currentWorkspaceRoot) {
          syncCliAgentsOnActivation(container, currentWorkspaceRoot);
        }
      },
    });
    console.log('[Ptah Electron] License reactivity binder initialized');
  } catch (binderError: unknown) {
    console.warn(
      '[Ptah Electron] License reactivity binder setup failed (non-fatal):',
      binderError instanceof Error ? binderError.message : String(binderError),
    );
  }

  /**
   * PHASE 4.96: Pre-warm embedder + reranker.
   *
   * Called by post-window.ts AFTER mainWindow fires `did-finish-load` so
   * warmup I/O does not overlap with the renderer's first render burst.
   * Fire-and-forget, non-fatal. Logs heap usage to detect budget overruns.
   */
  function scheduleWarmup(): void {
    if (refs.memoryCurator === null) return;
    setTimeout(() => {
      void (async () => {
        try {
          const embedderClient = container.resolve<EmbedderWorkerClient>(
            PERSISTENCE_TOKENS.EMBEDDER,
          );
          await embedderClient.warmup();
          const heapMb = process.memoryUsage().heapUsed / (1024 * 1024);
          if (heapMb > 200) {
            console.warn(
              `[Ptah Electron] Worker heap after warmup: ${heapMb.toFixed(1)} MB (budget: 200 MB)`,
            );
          } else {
            console.log(
              `[Ptah Electron] Embedder warmup complete (heap: ${heapMb.toFixed(1)} MB)`,
            );
          }
        } catch (err: unknown) {
          console.warn(
            '[Ptah Electron] Embedder warmup failed (non-fatal):',
            err instanceof Error ? err.message : String(err),
          );
        }
      })();
    }, 3000);
  }

  return {
    resolvedStateStorage,
    scheduleWarmup,
    refs,
  };
}
