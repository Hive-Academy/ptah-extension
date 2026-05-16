// Wire runtime: Phases 4 through 4.9 of Electron activation.

import type { DependencyContainer } from 'tsyringe';
import type { BrowserWindow } from 'electron';
import {
  PLATFORM_TOKENS,
  ContentDownloadService,
} from '@ptah-extension/platform-core';
import type { IStateStorage } from '@ptah-extension/platform-core';
import { TOKENS, bindLicenseReactivity } from '@ptah-extension/vscode-core';
import type { Logger } from '@ptah-extension/vscode-core';
import {
  SDK_TOKENS,
  EnhancedPromptsService,
  setPtahMcpPort,
} from '@ptah-extension/agent-sdk';
import type { IMultiPhaseAnalysisReader } from '@ptah-extension/agent-sdk';
import { AGENT_GENERATION_TOKENS } from '@ptah-extension/agent-generation';
import { IpcBridge } from '../ipc/ipc-bridge';
import { ElectronWebviewManagerAdapter } from '../ipc/webview-manager-adapter';
import { ElectronRpcMethodRegistrationService } from '../services/rpc/rpc-method-registration.service';
import { createApplicationMenu } from '../menu/application-menu';
import { ELECTRON_TOKENS } from '../di/electron-tokens';
import type { PtyManagerService } from '../services/pty-manager.service';
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
  type IndexingControlService,
  type IndexingRunDeps,
} from '@ptah-extension/memory-curator';
import { IndexingRpcHandlers } from '@ptah-extension/rpc-handlers';
import {
  SKILL_SYNTHESIS_TOKENS,
  type SkillSynthesisService,
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
import type { BootStrategy } from '@ptah-extension/shared';

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
     * persistence-sqlite registration failed — caller's LIFO will-quit chain
     * must tolerate null.
     */
    sqliteConnection: SqliteConnectionService | null;
    /**
     * Memory curator service handle for orderly shutdown. Null when
     * memory-curator registration or `start()` failed.
     */
    memoryCurator: MemoryCuratorService | null;
    /**
     * Skill synthesis service handle for orderly shutdown. Null when
     * persistence-sqlite is unavailable or `start()` failed — caller still
     * owns the LIFO will-quit chain and must tolerate null.
     */
    skillSynthesis: SkillSynthesisService | null;
    /**
     * Cron scheduler handle for orderly shutdown. Null when
     * persistence-sqlite is unavailable, croner is missing, or `start()`
     * failed — caller's LIFO will-quit chain must tolerate null.
     */
    cronScheduler: CronScheduler | null;
    /**
     * Messaging gateway service handle for orderly shutdown. Null when
     * persistence-sqlite is unavailable or `gateway.enabled` is `false` —
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
    skillSynthesis: null,
    cronScheduler: null,
    messagingGateway: null,
    symbolWatcher: null,
    licenseReactivityDisposable: null,
  };

  let resolvedStateStorage: IStateStorage | undefined;
  // PHASE 4: Setup IPC Bridge + WebviewManager
  // The IPC bridge connects ipcMain to the RpcHandler for renderer <-> main communication.
  // It must be initialized BEFORE loading the renderer so that IPC listeners are ready
  // when the Angular app boots and starts sending RPC calls.
  // Resolve PtyManagerService for terminal binary IPC
  const ptyManager = container.resolve<PtyManagerService>(
    ELECTRON_TOKENS.PTY_MANAGER_SERVICE,
  );

  const ipcBridge = new IpcBridge(
    container,
    () => {
      const win = getMainWindow();
      if (!win) return null;
      return {
        webContents: {
          send: (channel: string, ...args: unknown[]) =>
            win.webContents.send(channel, ...args),
        },
      };
    },
    ptyManager,
  );
  ipcBridge.initialize();

  // Register WebviewManager adapter so that backend services (AgentSessionWatcherService,
  // RpcMethodRegistrationService, etc.) can push events to the renderer via IPC.
  const webviewManagerAdapter = new ElectronWebviewManagerAdapter(ipcBridge);
  container.register(TOKENS.WEBVIEW_MANAGER, {
    useValue: webviewManagerAdapter,
  });
  // PHASE 4.45: Wire multi-phase analysis reader into EnhancedPromptsService
  // Deferred from container.ts Phase 2.4 because the dependency chain
  // (EnhancedPromptsService → SdkPermissionHandler → WebviewManager)
  // requires TOKENS.WEBVIEW_MANAGER which was just registered above.
  try {
    const enhancedPrompts = container.resolve<EnhancedPromptsService>(
      SDK_TOKENS.SDK_ENHANCED_PROMPTS_SERVICE,
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
  // PHASE 4.5: Register All RPC Methods
  // Now that WebviewManager is registered, register ALL RPC methods via the
  // class-based orchestrator. This replaces both setupRpcHandlers() and
  // registerExtendedRpcMethods() with a single unified registration.
  const rpcRegistration = container.resolve(
    ElectronRpcMethodRegistrationService,
  );
  rpcRegistration.registerAll();

  console.log(
    '[Ptah Electron] IPC bridge, WebviewManager, and RPC methods initialized',
  );

  // PHASE 4.9: Resolve State Storage for Window Persistence
  // Moved up so it resolves synchronously before deferred services.
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

    // PHASE 4.51: Open SQLite + run migrations.
    // The connection is registered in Phase 2.55 but lazy-opened here so
    // `openAndMigrate()` failures (missing better-sqlite3 native build,
    // disk full, etc.) are non-fatal — memory curator simply stays disabled.
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
      // ONE prominent, actionable line — not a buried stack trace. The
      // detailed failure reason now lives on `sqliteConnection.unavailable`,
      // and every persistence-backed RPC will return a structured
      // `PERSISTENCE_UNAVAILABLE` errorCode the UI can render as a single
      // notice instead of N raw stack traces.
      console.error(
        '\n' +
          '╔═══════════════════════════════════════════════════════════════════╗\n' +
          '║  [Ptah] PERSISTENCE OFFLINE — Memory / Skills / Cron / Gateway   ║\n' +
          '║  features will report PERSISTENCE_UNAVAILABLE until this is      ║\n' +
          '║  resolved. The rest of the app will continue to boot.            ║\n' +
          (isAbiMismatch
            ? '║                                                                   ║\n' +
              '║  CAUSE:  better-sqlite3 native module ABI mismatch.              ║\n' +
              '║  FIX:    npm run electron:rebuild   (then restart Ptah)          ║\n'
            : '║                                                                   ║\n' +
              `║  CAUSE:  ${errorMessage.slice(0, 56).padEnd(56)}     ║\n`) +
          '╚═══════════════════════════════════════════════════════════════════╝\n',
      );
      // The DI-registered SqliteConnectionService is still in the
      // container — the typed `db` getter throws
      // RpcUserError(PERSISTENCE_UNAVAILABLE) on access, which the RPC
      // layer auto-converts to a structured response. We null this local
      // ref only so the next phases (memory curator / skill synthesis /
      // code symbol indexer) skip their start() calls — they'd just fail
      // again at the same point.
      refs.sqliteConnection = null;
    }

    // PHASE 4.52: Memory curator cold-start.
    // The PreCompact subscription (memory extraction) starts when memoryEnabled = true,
    // regardless of boot strategy. IndexingControlService now gates the symbol walk.
    // Failure is non-fatal — search/list still work against whatever is in the store.
    let indexingControl: IndexingControlService | null = null;
    try {
      if (
        refs.sqliteConnection !== null &&
        container.isRegistered(MEMORY_TOKENS.MEMORY_CURATOR)
      ) {
        refs.memoryCurator = container.resolve<MemoryCuratorService>(
          MEMORY_TOKENS.MEMORY_CURATOR,
        );

        // Resolve IndexingControlService early so we can gate memory curator start
        // on the memoryEnabled flag and evaluate boot strategy before firing indexers.
        if (container.isRegistered(MEMORY_TOKENS.INDEXING_CONTROL)) {
          indexingControl = container.resolve<IndexingControlService>(
            MEMORY_TOKENS.INDEXING_CONTROL,
          );
        }

        // Start memory curator only when the memory pipeline is enabled.
        // When no indexing_state row exists yet (first launch), default to enabled.
        let memoryEnabled = true;
        if (indexingControl && workspaceRoot) {
          try {
            const status = await indexingControl.getStatus(workspaceRoot);
            memoryEnabled = status.memoryEnabled;
          } catch {
            // Non-fatal — default to enabled on status-read failure
          }
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

    // PHASE 4.53: Skill Synthesis cold-start.
    // Resolve and start the skill synthesis service so the candidate store +
    // sqlite migrations are ready before the first chat session ends.
    // Failure is non-fatal — persistence-sqlite may not be available yet on
    // every branch and we never want skill synthesis to block boot.
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

    // PHASE 4.53b: Code Symbol Indexer cold-start.
    // Boot strategy evaluation gates whether the full workspace walk fires:
    //   'auto-index-first-time' → run workspace walk + register chokidar watcher
    //   'skip'                  → silent — only register chokidar watcher if symbolsEnabled
    //   'mark-stale-and-skip'   → call markStale, do NOT auto-run — frontend shows banner
    //
    // AbortError (DOMException name 'AbortError') from CodeSymbolIndexer is treated as
    // a clean pause, NOT an error. Any other error propagates to IndexingControlService
    // which sets state to 'error'.
    //
    // LOGGING CONSTRAINT: zero console.log / logger.info about indexing on 'skip' strategy.
    try {
      if (
        refs.sqliteConnection !== null &&
        refs.sqliteConnection.isOpen &&
        container.isRegistered(CODE_SYMBOL_INDEXER) &&
        workspaceRoot
      ) {
        const symbolIndexer =
          container.resolve<CodeSymbolIndexer>(CODE_SYMBOL_INDEXER);

        // Build the callable deps object that IndexingControlService uses to
        // invoke CodeSymbolIndexer without a direct import (avoids circular dep).
        const runDeps: IndexingRunDeps = {
          runSymbols: async (
            wsRoot: string,
            options?: { signal?: AbortSignal },
          ): Promise<void> => {
            try {
              await symbolIndexer.indexWorkspace(wsRoot, options);
            } catch (err: unknown) {
              // AbortError is cooperative cancellation — treat as clean pause.
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

        // Wire runDeps into the IndexingRpcHandlers so RPC calls (start/resume)
        // get the same symbolIndexer reference.
        if (container.isRegistered(IndexingRpcHandlers)) {
          const indexingRpcHandlers =
            container.resolve<IndexingRpcHandlers>(IndexingRpcHandlers);
          indexingRpcHandlers.setRunDeps(runDeps);
        }

        // Evaluate boot strategy and branch accordingly.
        if (indexingControl) {
          let bootStrategy: BootStrategy = 'skip';
          try {
            bootStrategy =
              await indexingControl.evaluateBootStrategy(workspaceRoot);
          } catch (strategyErr: unknown) {
            console.warn(
              '[Ptah Electron] evaluateBootStrategy failed (defaulting to skip):',
              strategyErr instanceof Error
                ? strategyErr.message
                : String(strategyErr),
            );
          }

          if (bootStrategy === 'auto-index-first-time') {
            // === FIRST LAUNCH: Run full workspace walk + register watcher ===
            // Defer workspace index 5 s to avoid competing with plugin load,
            // MCP start, and window paint during the critical activation window.

            // Check per-pipeline toggles even on first launch
            let symbolsEnabled = true;
            try {
              const status = await indexingControl.getStatus(workspaceRoot);
              symbolsEnabled = status.symbolsEnabled;
            } catch {
              // Non-fatal — default to enabled
            }

            if (symbolsEnabled) {
              setTimeout(() => {
                void indexingControl
                  .startAutoIndex(workspaceRoot, runDeps)
                  .catch((err: unknown) => {
                    console.warn(
                      '[Ptah Electron] startAutoIndex failed (non-fatal):',
                      err instanceof Error ? err.message : String(err),
                    );
                  });
              }, 5000);

              // Incremental re-index on file change — registers immediately.
              const chokidar = await import('chokidar');
              const allowedExts = ['.ts', '.tsx', '.js', '.jsx'];
              const reindexDebounce = new Map<
                string,
                ReturnType<typeof setTimeout>
              >();
              const symbolWatcher = chokidar.watch(
                allowedExts.map((ext) => `${workspaceRoot}/**/*${ext}`),
                { ignoreInitial: true, persistent: true },
              );
              symbolWatcher.on('change', (filePath: string) => {
                const existingTimer = reindexDebounce.get(filePath);
                if (existingTimer) clearTimeout(existingTimer);
                reindexDebounce.set(
                  filePath,
                  setTimeout(() => {
                    reindexDebounce.delete(filePath);
                    void symbolIndexer
                      .reindexFile(filePath, workspaceRoot)
                      .catch((err: unknown) => {
                        console.warn(
                          '[Ptah Electron] reindexFile failed (non-fatal):',
                          err instanceof Error ? err.message : String(err),
                        );
                      });
                  }, 500),
                );
              });
              symbolWatcher.on('error', (err: unknown) => {
                console.warn(
                  '[Ptah Electron] symbolWatcher error (non-fatal):',
                  err instanceof Error ? err.message : String(err),
                );
              });
              refs.symbolWatcher = symbolWatcher;
              indexingControl.setSymbolWatcher(symbolWatcher);

              // This log line intentionally lives INSIDE the auto-index-first-time
              // branch only — keystone metric (AC #1) requires it never fires on skip.
              console.log('[Ptah Electron] Code symbol indexer started');
            }
          } else if (bootStrategy === 'mark-stale-and-skip') {
            // === STALE WORKSPACE: Record stale state, do NOT auto-run ===
            // Frontend Settings panel will show the stale banner.
            try {
              await indexingControl.markStale(workspaceRoot);
            } catch (markErr: unknown) {
              console.warn(
                '[Ptah Electron] markStale failed (non-fatal):',
                markErr instanceof Error ? markErr.message : String(markErr),
              );
            }
            // Register chokidar watcher for incremental re-indexing even in stale
            // state so file saves are tracked while user decides to re-index.
            let symbolsEnabled = true;
            try {
              const status = await indexingControl.getStatus(workspaceRoot);
              symbolsEnabled = status.symbolsEnabled;
            } catch {
              // Non-fatal — default to enabled
            }
            if (symbolsEnabled) {
              const chokidar = await import('chokidar');
              const allowedExts = ['.ts', '.tsx', '.js', '.jsx'];
              const reindexDebounce = new Map<
                string,
                ReturnType<typeof setTimeout>
              >();
              const symbolWatcher = chokidar.watch(
                allowedExts.map((ext) => `${workspaceRoot}/**/*${ext}`),
                { ignoreInitial: true, persistent: true },
              );
              symbolWatcher.on('change', (filePath: string) => {
                const existingTimer = reindexDebounce.get(filePath);
                if (existingTimer) clearTimeout(existingTimer);
                reindexDebounce.set(
                  filePath,
                  setTimeout(() => {
                    reindexDebounce.delete(filePath);
                    void symbolIndexer
                      .reindexFile(filePath, workspaceRoot)
                      .catch((err: unknown) => {
                        console.warn(
                          '[Ptah Electron] reindexFile failed (non-fatal):',
                          err instanceof Error ? err.message : String(err),
                        );
                      });
                  }, 500),
                );
              });
              symbolWatcher.on('error', (err: unknown) => {
                console.warn(
                  '[Ptah Electron] symbolWatcher error (non-fatal):',
                  err instanceof Error ? err.message : String(err),
                );
              });
              refs.symbolWatcher = symbolWatcher;
              indexingControl.setSymbolWatcher(symbolWatcher);
            }
            // === 'skip' strategy: zero console.log / logger.info — AC #1 keystone ===
          } else {
            // bootStrategy === 'skip'
            // Workspace is unchanged — do NOT run indexers. Only register the
            // chokidar watcher for incremental file-save re-indexing if symbolsEnabled.
            let symbolsEnabled = true;
            try {
              const status = await indexingControl.getStatus(workspaceRoot);
              symbolsEnabled = status.symbolsEnabled;
            } catch {
              // Non-fatal — default to enabled
            }
            if (symbolsEnabled) {
              const chokidar = await import('chokidar');
              const allowedExts = ['.ts', '.tsx', '.js', '.jsx'];
              const reindexDebounce = new Map<
                string,
                ReturnType<typeof setTimeout>
              >();
              const symbolWatcher = chokidar.watch(
                allowedExts.map((ext) => `${workspaceRoot}/**/*${ext}`),
                { ignoreInitial: true, persistent: true },
              );
              symbolWatcher.on('change', (filePath: string) => {
                const existingTimer = reindexDebounce.get(filePath);
                if (existingTimer) clearTimeout(existingTimer);
                reindexDebounce.set(
                  filePath,
                  setTimeout(() => {
                    reindexDebounce.delete(filePath);
                    void symbolIndexer
                      .reindexFile(filePath, workspaceRoot)
                      .catch((err: unknown) => {
                        console.warn(
                          '[Ptah Electron] reindexFile failed (non-fatal):',
                          err instanceof Error ? err.message : String(err),
                        );
                      });
                  }, 500),
                );
              });
              symbolWatcher.on('error', (err: unknown) => {
                console.warn(
                  '[Ptah Electron] symbolWatcher error (non-fatal):',
                  err instanceof Error ? err.message : String(err),
                );
              });
              refs.symbolWatcher = symbolWatcher;
              indexingControl.setSymbolWatcher(symbolWatcher);
            }
          }
        } else {
          // IndexingControlService not available — fall back to legacy unconditional
          // workspace walk for backwards compatibility (e.g. DI not yet fully migrated).
          setTimeout(() => {
            void symbolIndexer
              .indexWorkspace(workspaceRoot)
              .catch((err: unknown) => {
                console.warn(
                  '[Ptah Electron] CodeSymbolIndexer.indexWorkspace failed (non-fatal):',
                  err instanceof Error ? err.message : String(err),
                );
              });
          }, 5000);

          const chokidar = await import('chokidar');
          const allowedExts = ['.ts', '.tsx', '.js', '.jsx'];
          const reindexDebounce = new Map<
            string,
            ReturnType<typeof setTimeout>
          >();
          const symbolWatcher = chokidar.watch(
            allowedExts.map((ext) => `${workspaceRoot}/**/*${ext}`),
            { ignoreInitial: true, persistent: true },
          );
          symbolWatcher.on('change', (filePath: string) => {
            const existingTimer = reindexDebounce.get(filePath);
            if (existingTimer) clearTimeout(existingTimer);
            reindexDebounce.set(
              filePath,
              setTimeout(() => {
                reindexDebounce.delete(filePath);
                void symbolIndexer
                  .reindexFile(filePath, workspaceRoot)
                  .catch((err: unknown) => {
                    console.warn(
                      '[Ptah Electron] reindexFile failed (non-fatal):',
                      err instanceof Error ? err.message : String(err),
                    );
                  });
              }, 500),
            );
          });
          symbolWatcher.on('error', (err: unknown) => {
            console.warn(
              '[Ptah Electron] symbolWatcher error (non-fatal):',
              err instanceof Error ? err.message : String(err),
            );
          });
          refs.symbolWatcher = symbolWatcher;
          console.log('[Ptah Electron] Code symbol indexer started');
        }
      }
    } catch (error) {
      console.warn(
        '[Ptah Electron] Code symbol indexer start skipped (non-fatal):',
        error instanceof Error ? error.message : String(error),
      );
    }

    // PHASE 4.54: Ensure plugin/template content from GitHub
    // Plugins and templates are no longer bundled in the app package.
    // ContentDownloadService downloads them to ~/.ptah/ on first launch and
    // keeps them up-to-date by comparing the manifest contentHash.
    // Non-blocking fire-and-forget: activation continues immediately.
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

    // PHASE 4.55: Plugin Loader Initialization.
    // Must run AFTER Phase 4.5 (RPC registration) and BEFORE Phase 4.6 (session discovery).
    initPluginLoader(container, contentDownload.getPluginsPath());

    // PHASE 4.56: Skill Junction Activation
    // Always call activate() even with zero plugins so the workspace change
    // subscription is registered for future plugin enablement.
    refs.skillJunctionRef = activateSkillJunctions(
      container,
      contentDownload.getPluginsPath(),
    );

    // PHASE 4.565 + 4.566: CLI Skill Sync and CLI Agent Sync are now driven
    // reactively by the license:verified / license:expired events wired via
    // bindLicenseReactivity() below — no tier snapshot needed here.
    // PHASE 4.57: Model Pricing Pre-fetch.
    // Pre-fetch model pricing from OpenRouter so cost calculations use live data.
    // Non-blocking, fire-and-forget. Falls back to bundled defaults if offline.
    try {
      const providerModels = container.resolve(
        SDK_TOKENS.SDK_PROVIDER_MODELS,
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

    // PHASE 4.58: Proactive CLI Detection.
    // Detect installed CLI agents (Gemini, Codex) early so settings UI is instant.
    // Non-blocking, fire-and-forget.
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

          // Background token refresh for CLIs that use OAuth (Codex)
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

    // PHASE 4.59: MCP Server Startup is now driven reactively by the
    // license:verified / license:expired events wired via bindLicenseReactivity()
    // below — no tier snapshot needed here.

    // PHASE 4.6: Session Auto-Discovery
    // Import existing Claude sessions from ~/.claude/projects/ for the active
    // workspace. Uses workspaceRoot which covers both CLI arg AND persisted workspace restoration.
    // Non-fatal: failures are logged as warnings but do not block startup.
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

    // PHASE 4.8: Git File System Watcher
    // Watch .git directory and workspace files for changes, push git status
    // updates to the renderer. Replaces frontend polling with event-driven push.
    // Only runs `git status` when something actually changes — zero wasted calls.
    if (workspaceRoot) {
      try {
        const { GitWatcherService } =
          await import('../services/git-watcher.service');
        // GitInfoService lives in `@ptah-extension/vscode-core` and is
        // registered under TOKENS.GIT_INFO_SERVICE.
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
    // PHASE 4.94: Cron scheduler cold-start.
    // Resolve and start the scheduler so persisted jobs re-arm and the
    // CatchupCoordinator runs its missed-run pass against `cron.catchupWindowMs`.
    // Settings are read from IWorkspaceProvider — defaults come from
    // FILE_BASED_SETTINGS_DEFAULTS (cron.enabled=true, maxConcurrentJobs=3,
    // catchupWindowMs=86_400_000). Failure is non-fatal: croner is lazy-required
    // and persistence-sqlite may be unavailable on some branches.
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

    // PHASE 4.95: Daily backup cron job registration.
    // Registers the @ptah/daily-backup system job idempotently on every boot.
    // Uses JobStore.upsert so repeated boots update the schedule without
    // creating duplicate rows. The handler is wired into IHandlerRegistry so
    // the JobRunner can dispatch it by name when the cron fires.
    // Entire phase is non-fatal — failure does not prevent the app from running.
    try {
      if (
        refs.cronScheduler !== null &&
        refs.sqliteConnection !== null &&
        container.isRegistered(CRON_TOKENS.CRON_JOB_STORE) &&
        container.isRegistered(CRON_TOKENS.CRON_HANDLER_REGISTRY)
      ) {
        const jobStore = container.resolve<IJobStore>(
          CRON_TOKENS.CRON_JOB_STORE,
        );
        const handlerRegistry = container.resolve<IHandlerRegistry>(
          CRON_TOKENS.CRON_HANDLER_REGISTRY,
        );

        // Register the backup handler into the in-process registry.
        // Use unregister+register to be idempotent across restarts in dev
        // mode where bootHeavyServices may be called more than once.
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

        // Upsert the job definition — idempotent across every boot.
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
      }
    } catch (err: unknown) {
      console.warn(
        '[Ptah Electron] Daily backup cron registration failed (non-fatal):',
        err instanceof Error ? err.message : String(err),
      );
    }

    // PHASE 4.96 warmup is intentionally NOT fired here.
    // It is anchored to the window's `did-finish-load` event so that
    // ONNX model loading I/O does not race with the renderer's first paint.
    // The `scheduleWarmup()` return value on WireRuntimeResult is the entry
    // point; post-window.ts calls it inside `mainWindow.webContents.once(
    //   'did-finish-load', ...)`.
  }; // end of bootHeavyServices

  // PHASE 4.7: Application Menu
  createApplicationMenu(container, getMainWindow);

  // Subscribe to workspace changes to boot services lazily if they haven't been yet.
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

  // PHASE 4.60: License Reactivity Binder
  // Replaces the three stale startupLicenseTier snapshot gates that prevented
  // MCP server, CLI skill sync, and CLI agent sync from starting when the user
  // activates a license mid-session. The binder subscribes to license:verified
  // and license:expired, performs an initial dispatch based on current state,
  // and brings up / tears down premium subsystems reactively.
  try {
    const logger = container.resolve<Logger>(TOKENS.LOGGER);

    // Resolve plugins path for skill sync callback (ContentDownloadService
    // is a singleton — safe to resolve separately from bootHeavyServices).
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
