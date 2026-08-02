import type { DependencyContainer } from 'tsyringe';
import type { BrowserWindow } from 'electron';
import {
  PLATFORM_TOKENS,
  ContentDownloadService,
} from '@ptah-extension/platform-core';
import type { IStateStorage } from '@ptah-extension/platform-core';
import { TOKENS, bringUpSubsystems } from '@ptah-extension/vscode-core';
import type { Logger } from '@ptah-extension/vscode-core';
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
import {
  activateSkillJunctions,
  initPluginLoader,
  mirrorUserLayer,
  reconcileUserLayer,
  syncSkillRegistryCatalog,
} from './plugin-activation';
import { PERSISTENCE_TOKENS } from '@ptah-extension/persistence-sqlite';
import type { EmbedderWorkerClient } from '@ptah-extension/memory-curator';
import type { DependencyGraphService } from '@ptah-extension/workspace-intelligence';
import type { IWorkspaceProvider } from '@ptah-extension/platform-core';
import type { GatewayService } from '@ptah-extension/messaging-gateway';
import { CLI_AGENT_RUNTIME_TOKENS } from '@ptah-extension/cli-agent-runtime';
import {
  bootThothRuntime,
  startThothCron,
  type ThothRuntimeRefs,
} from '@ptah-extension/thoth-runtime';

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
  /**
   * Thoth handles (SQLite / memory / skills / cron / status bridges) come
   * straight from `@ptah-extension/thoth-runtime` — see {@link ThothRuntimeRefs}
   * for their null semantics. The extra fields below are host-owned.
   */
  refs: ThothRuntimeRefs & {
    skillJunctionRef: { deactivateSync: () => void } | null;
    gitWatcher: {
      stop: () => void;
      switchWorkspace: (p: string) => void;
    } | null;
    /**
     * Messaging gateway service handle for orderly shutdown. Null when
     * persistence-sqlite is unavailable or `gateway.enabled` is `false` —
     * caller's LIFO will-quit chain must tolerate null.
     */
    messagingGateway: GatewayService | null;
    /**
     * Ptah CLI registry handle for orderly shutdown. Resolved eagerly here
     * (while the container is healthy) so `will-quit` can dispose the captured
     * instance instead of resolving it from the container mid-teardown — a
     * first-time lazy construction during shutdown races with DI teardown and
     * can hang or throw. Null when the CLI agent runtime is not registered.
     */
    cliRegistry: { disposeAll: () => void } | null;
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
    statusBridgeDisposables: null,
    cliRegistry: null,
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
    const thoth = await bootThothRuntime(container, {
      workspaceRoot,
      logPrefix: '[Ptah Electron]',
    });
    refs.sqliteConnection = thoth.sqliteConnection;
    refs.memoryCurator = thoth.memoryCurator;
    refs.memoryTrigger = thoth.memoryTrigger;
    refs.skillSynthesis = thoth.skillSynthesis;
    refs.skillTrigger = thoth.skillTrigger;
    refs.symbolWatcher = thoth.symbolWatcher;
    refs.statusBridgeDisposables = thoth.statusBridgeDisposables;

    const contentDownload = container.resolve<ContentDownloadService>(
      PLATFORM_TOKENS.CONTENT_DOWNLOAD,
    );
    initPluginLoader(container, contentDownload.getPluginsPath());
    const userLayerRoots = await mirrorUserLayer(container, workspaceRoot);
    const sqliteOpen =
      refs.sqliteConnection !== null && refs.sqliteConnection.isOpen;
    if (sqliteOpen) {
      void syncSkillRegistryCatalog(container);
    }
    contentDownload
      .ensureContent()
      .then(async (result) => {
        if (!result.success) {
          console.warn(
            '[Ptah Electron] Content download failed (non-blocking):',
            result.error ?? 'Unknown error',
          );
        }
        await mirrorUserLayer(container, workspaceRoot);
        if (!result.fromCache) {
          await reconcileUserLayer(container, workspaceRoot, sqliteOpen);
        }
      })
      .catch((err: unknown) => {
        console.warn(
          '[Ptah Electron] Post-download reconcile failed (non-fatal):',
          err instanceof Error ? err.message : String(err),
        );
      });
    refs.skillJunctionRef = activateSkillJunctions(
      container,
      contentDownload.getPluginsPath(),
      userLayerRoots
        ? { skills: userLayerRoots.skills, commands: userLayerRoots.commands }
        : undefined,
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
    await startThothCron(container, thoth, {
      logPrefix: '[Ptah Electron]',
    });
    refs.cronScheduler = thoth.cronScheduler;
  }; // end of bootHeavyServices
  createApplicationMenu(container, getMainWindow);
  const workspaceProvider = container.resolve<IWorkspaceProvider>(
    PLATFORM_TOKENS.WORKSPACE_PROVIDER,
  );
  workspaceProvider.onDidChangeWorkspaceFolders(() => {
    // Drop cached dependency graphs for workspaces that are no longer open so
    // their nodes/edges don't linger in memory after a folder is closed. The
    // event carries no removed path, so retaining the currently-open set is the
    // race-free way to evict closed workspaces. Non-fatal.
    try {
      const depGraph = container.resolve<DependencyGraphService>(
        TOKENS.DEPENDENCY_GRAPH_SERVICE,
      );
      depGraph.retainOnly(workspaceProvider.getWorkspaceFolders());
    } catch (err) {
      console.warn(
        '[Ptah Electron] Dependency graph eviction skipped (non-fatal):',
        err,
      );
    }

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
    const currentWorkspaceRoot = startupWorkspaceRoot;

    await bringUpSubsystems({
      container,
      logger,
      onMcpPortChange: (port) => {
        setPtahMcpPort(port ?? 0);
      },
      syncCliSkills: () => {
        syncCliSkillsOnActivation(container, currentWorkspaceRoot);
      },
      syncCliAgents: () => {
        if (currentWorkspaceRoot) {
          syncCliAgentsOnActivation(container, currentWorkspaceRoot);
        }
      },
    });
    console.log('[Ptah Electron] Subsystems brought up');
  } catch (bringUpError: unknown) {
    console.warn(
      '[Ptah Electron] Subsystem bring-up failed (non-fatal):',
      bringUpError instanceof Error
        ? bringUpError.message
        : String(bringUpError),
    );
  }

  // Eagerly construct the Ptah CLI registry now that all subsystems (including
  // the SDK singletons it injects) are wired, and capture it for orderly
  // shutdown. Deferring this to will-quit forces a first-time lazy build of its
  // dependency graph mid-teardown, which races with DI shutdown and can hang or
  // throw (blocked-network production case). Non-fatal: a null ref simply means
  // will-quit has nothing to dispose.
  try {
    refs.cliRegistry = container.resolve<{ disposeAll: () => void }>(
      CLI_AGENT_RUNTIME_TOKENS.SDK_PTAH_CLI_REGISTRY,
    );
  } catch (cliRegistryError) {
    console.warn(
      '[Ptah Electron] CLI registry eager resolve failed (non-fatal):',
      cliRegistryError instanceof Error
        ? cliRegistryError.message
        : String(cliRegistryError),
    );
    refs.cliRegistry = null;
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
