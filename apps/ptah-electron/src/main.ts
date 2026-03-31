// CRITICAL: reflect-metadata MUST be imported first for TSyringe to work
import 'reflect-metadata';

import { app, BrowserWindow, safeStorage, dialog, ipcMain } from 'electron';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { createMainWindow } from './windows/main-window';
import { ElectronDIContainer } from './di/container';
import { ElectronRpcMethodRegistrationService } from './services/rpc/rpc-method-registration.service';
import { IpcBridge } from './ipc/ipc-bridge';
import { ElectronWebviewManagerAdapter } from './ipc/webview-manager-adapter';
import { createApplicationMenu } from './menu/application-menu';
import * as fs from 'fs';
import type { ElectronPlatformOptions } from '@ptah-extension/platform-electron';
import { ElectronWorkspaceProvider } from '@ptah-extension/platform-electron';
import {
  PLATFORM_TOKENS,
  ContentDownloadService,
} from '@ptah-extension/platform-core';
import type {
  ISecretStorage,
  IStateStorage,
} from '@ptah-extension/platform-core';
import { TOKENS } from '@ptah-extension/vscode-core';
import {
  SDK_TOKENS,
  EnhancedPromptsService,
  setPtahMcpPort,
} from '@ptah-extension/agent-sdk';
import type {
  IMultiPhaseAnalysisReader,
  PluginLoaderService,
  SkillJunctionService,
} from '@ptah-extension/agent-sdk';
import { AGENT_GENERATION_TOKENS } from '@ptah-extension/agent-generation';
import type { WorkspaceContextManager } from './services/workspace-context-manager';
import type { PtyManagerService } from './services/pty-manager.service';
import { ELECTRON_TOKENS } from './di/electron-tokens';

// @ts-expect-error import.meta.url is valid in ESM bundle output; TS flags it because tsconfig targets CJS
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Prevent multiple instances
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  let mainWindow: BrowserWindow | null = null;
  let resolvedStateStorage: IStateStorage | undefined;
  let skillJunctionRef: { deactivateSync: () => void } | null = null;
  let revalidationInterval: ReturnType<typeof setInterval> | null = null;
  let gitWatcherRef: {
    stop: () => void;
    switchWorkspace: (p: string) => void;
  } | null = null;

  app.whenReady().then(async () => {
    // ========================================
    // PHASE 1: Parse command-line args
    // ========================================
    const workspacePath = process.argv.find(
      (arg) =>
        !arg.startsWith('-') &&
        arg !== process.argv[0] &&
        arg !== process.argv[1],
    );
    const initialFolders = workspacePath
      ? [path.resolve(workspacePath)]
      : undefined;

    if (initialFolders) {
      console.log(`[Ptah Electron] Workspace path: ${initialFolders[0]}`);
    }

    // ========================================
    // PHASE 2: Initialize DI Container
    // ========================================
    // Must be done BEFORE creating IPC bridge (Batch 4) so all services are available.
    // Must be done AFTER app.whenReady() because safeStorage requires it.
    const platformOptions: ElectronPlatformOptions = {
      appPath: app.getAppPath(),
      userDataPath: app.getPath('userData'),
      logsPath: app.getPath('logs'),
      safeStorage: {
        isEncryptionAvailable: () => safeStorage.isEncryptionAvailable(),
        encryptString: (plainText: string) =>
          safeStorage.encryptString(plainText),
        decryptString: (encrypted: Buffer) =>
          safeStorage.decryptString(encrypted),
      },
      dialog: {
        showMessageBox: (win: unknown, options: unknown) =>
          dialog.showMessageBox(
            win as Electron.BaseWindow,
            options as Electron.MessageBoxOptions,
          ),
      },
      getWindow: () => {
        const win = mainWindow;
        if (!win) return null;
        return {
          webContents: {
            send: (channel: string, ...args: unknown[]) =>
              win.webContents.send(channel, ...args),
          },
        };
      },
      ipcMain,
      initialFolders,
    };

    const container = ElectronDIContainer.setup(platformOptions);

    // ========================================
    // PHASE 2.1: Verify Critical DI Tokens
    // ========================================
    // Diagnostic verification: ensure critical tokens resolve after container setup.
    // Each token is resolved independently so one failure does not mask others.
    // This block must NOT throw -- it is purely informational.
    {
      const tokensToVerify: Array<{ name: string; token: unknown }> = [
        { name: 'TOKENS.RPC_HANDLER', token: TOKENS.RPC_HANDLER },
        { name: 'TOKENS.LOGGER', token: TOKENS.LOGGER },
        {
          name: 'PLATFORM_TOKENS.WORKSPACE_PROVIDER',
          token: PLATFORM_TOKENS.WORKSPACE_PROVIDER,
        },
        {
          name: 'PLATFORM_TOKENS.STATE_STORAGE',
          token: PLATFORM_TOKENS.STATE_STORAGE,
        },
        {
          name: 'PLATFORM_TOKENS.SECRET_STORAGE',
          token: PLATFORM_TOKENS.SECRET_STORAGE,
        },
      ];

      let resolved = 0;
      for (const { name, token } of tokensToVerify) {
        try {
          container.resolve(token as symbol);
          resolved++;
          console.log(`[Ptah Electron] DI verify: ${name} -- OK`);
        } catch (err) {
          console.error(
            `[Ptah Electron] DI verify: ${name} -- FAILED:`,
            err instanceof Error ? err.message : String(err),
          );
        }
      }

      console.log(
        `[Ptah Electron] DI verification: ${resolved}/${tokensToVerify.length} tokens resolved`,
      );
    }

    // ========================================
    // PHASE 2.5: Workspace Restoration (TASK_2025_208 Batch 2, Tasks 2.2 & 2.3)
    // ========================================
    // Restore persisted workspace list from global state storage.
    // If workspaces were persisted from a previous session, restore them
    // (validating each path still exists on disk). CLI arg workspace
    // takes priority and is always made active.
    //
    // Also subscribes to workspace folder changes to persist the workspace
    // list on every change (debounced at 500ms to avoid rapid writes).
    //
    // startupWorkspaceRoot: captured here for the startup config IPC handler
    // so the preload script can expose the active workspace in ptahConfig.
    let startupWorkspaceRoot: string | undefined;
    try {
      const globalStateStorage = container.resolve<IStateStorage>(
        PLATFORM_TOKENS.STATE_STORAGE,
      );
      const workspaceContextManager =
        container.resolve<WorkspaceContextManager>(
          TOKENS.WORKSPACE_CONTEXT_MANAGER,
        );
      const workspaceProviderForRestore =
        container.resolve<ElectronWorkspaceProvider>(
          PLATFORM_TOKENS.WORKSPACE_PROVIDER,
        );

      // Read persisted workspace list
      const persisted = globalStateStorage.get<{
        folders: string[];
        activeIndex: number;
      }>('ptah.workspaces');

      // Determine the CLI workspace path (already resolved above)
      const cliWorkspacePath = initialFolders?.[0];

      if (persisted && persisted.folders && persisted.folders.length > 0) {
        // Filter out stale paths that no longer exist on disk (async)
        const validFolders: string[] = [];
        for (const folder of persisted.folders) {
          try {
            await fs.promises.access(folder);
            validFolders.push(folder);
          } catch {
            console.warn(
              `[Ptah Electron] Skipping stale workspace path (no longer exists): ${folder}`,
            );
          }
        }

        if (validFolders.length > 0) {
          // Clamp activeIndex to valid range
          const activeIndex = Math.min(
            Math.max(persisted.activeIndex ?? 0, 0),
            validFolders.length - 1,
          );

          if (cliWorkspacePath) {
            // CLI arg takes priority: ensure it's in the list, make it active
            const cliResolved = path.resolve(cliWorkspacePath);
            if (!validFolders.includes(cliResolved)) {
              validFolders.push(cliResolved);
            }
            // Restore workspaces with CLI path as active
            await workspaceContextManager.restoreWorkspaces(
              validFolders,
              cliResolved,
            );
            // Sync the provider's folder list
            workspaceProviderForRestore.setWorkspaceFolders(validFolders);
            workspaceProviderForRestore.setActiveFolder(cliResolved);
          } else {
            // No CLI arg: use persisted active index
            const activePath = validFolders[activeIndex];
            await workspaceContextManager.restoreWorkspaces(
              validFolders,
              activePath,
            );
            // Sync the provider's folder list
            workspaceProviderForRestore.setWorkspaceFolders(validFolders);
            workspaceProviderForRestore.setActiveFolder(activePath);
          }

          console.log(
            `[Ptah Electron] Restored ${validFolders.length} workspace(s) from persisted state`,
          );
        }
      } else if (cliWorkspacePath) {
        // No persisted workspaces, but CLI arg provided.
        // Container setup already created the initial workspace context
        // (in container.ts Phase 1.6), so no extra restore needed.
        console.log(
          '[Ptah Electron] No persisted workspaces; using CLI workspace',
        );
      } else {
        // No persisted workspaces, no CLI arg — app opens with no workspace
        console.log(
          '[Ptah Electron] No persisted workspaces and no CLI arg — starting without workspace',
        );
      }

      // Capture the active workspace for the startup config (exposed via preload)
      startupWorkspaceRoot = workspaceProviderForRestore.getActiveFolder();

      // --- Workspace list persistence on change (Task 2.3) ---
      // Subscribe to folder change events and persist the current workspace
      // list to global state storage. Debounced at 500ms to avoid rapid
      // writes during bulk operations (e.g., restoring multiple folders).
      let persistDebounceTimer: ReturnType<typeof setTimeout> | null = null;

      const persistWorkspaceList = () => {
        const currentFolders =
          workspaceProviderForRestore.getWorkspaceFolders();
        const activeFolder = workspaceProviderForRestore.getActiveFolder();
        const activeIndex = activeFolder
          ? currentFolders.indexOf(activeFolder)
          : 0;

        globalStateStorage
          .update('ptah.workspaces', {
            folders: currentFolders,
            activeIndex: activeIndex >= 0 ? activeIndex : 0,
          })
          .catch((err: unknown) => {
            console.error(
              '[Ptah Electron] Failed to persist workspace list:',
              err instanceof Error ? err.message : String(err),
            );
          });
      };

      workspaceProviderForRestore.onDidChangeWorkspaceFolders(() => {
        // Debounce: clear any pending write, schedule a new one
        if (persistDebounceTimer !== null) {
          clearTimeout(persistDebounceTimer);
        }
        persistDebounceTimer = setTimeout(() => {
          persistDebounceTimer = null;
          persistWorkspaceList();
        }, 500);
      });
    } catch (error) {
      console.warn(
        '[Ptah Electron] Workspace restoration failed (non-fatal):',
        error instanceof Error ? error.message : String(error),
      );
    }

    // ========================================
    // PHASE 2.6: (Deferred) RPC handlers registered after WebviewManager in Phase 4.5
    // ========================================

    // Fallback: if workspace restoration failed but CLI arg was provided
    if (!startupWorkspaceRoot && initialFolders?.[0]) {
      startupWorkspaceRoot = initialFolders[0];
    }

    // ========================================
    // PHASE 3: Load API Key from Secret Storage
    // ========================================
    // Load saved Anthropic API key and set in environment for Claude Agent SDK.
    try {
      const secretStorage = container.resolve<ISecretStorage>(
        PLATFORM_TOKENS.SECRET_STORAGE,
      );
      const apiKey = await secretStorage.get('ptah.apiKey.anthropic');
      if (apiKey) {
        process.env['ANTHROPIC_API_KEY'] = apiKey;
        console.log('[Ptah Electron] API key loaded from secret storage');
      }
    } catch (error) {
      console.warn(
        '[Ptah Electron] Failed to load API key from secret storage:',
        error instanceof Error ? error.message : String(error),
      );
    }

    // ========================================
    // PHASE 3.5: License Verification
    // ========================================
    // Check license status before creating the window. If the license is invalid
    // (revoked or payment failed), the renderer will start on the welcome view
    // with isLicensed=false, blocking access to premium features.
    // Mirrors the VS Code extension's handleLicenseBlocking() pattern (main.ts:85-306).
    //
    // LicenseService is registered in container.ts Phase 1.1 and depends on
    // EXTENSION_CONTEXT (shimmed), LOGGER, and CONFIG_MANAGER — all available.
    // Network timeout is 5s; offline grace period (7 days) prevents blocking
    // if the license server is unreachable.
    let startupIsLicensed = true;
    let startupInitialView: string | null = null;
    let startupLicenseTier: string | undefined;

    try {
      const licenseService = container.resolve(TOKENS.LICENSE_SERVICE) as {
        verifyLicense: () => Promise<{
          valid: boolean;
          reason?: string;
          tier?: string;
        }>;
      };
      const licenseStatus = await licenseService.verifyLicense();

      startupLicenseTier = licenseStatus.tier;

      if (!licenseStatus.valid) {
        startupIsLicensed = false;
        startupInitialView = 'welcome';
        console.log(
          `[Ptah Electron] License invalid (reason: ${
            licenseStatus.reason ?? 'unknown'
          }, tier: ${licenseStatus.tier ?? 'unknown'}), showing welcome screen`,
        );
      } else {
        console.log(
          `[Ptah Electron] License verified (tier: ${licenseStatus.tier})`,
        );
      }
    } catch (error) {
      // Non-fatal: default to licensed so users aren't blocked by verification errors
      console.warn(
        '[Ptah Electron] License verification failed (non-fatal, defaulting to licensed):',
        error instanceof Error ? error.message : String(error),
      );
    }

    // ========================================
    // PHASE 3.6: SDK Authentication Initialization (TASK_2025_240)
    // ========================================
    // Initialize the SDK agent adapter so chat:start works.
    // Mirrors VS Code extension Step 7 (main.ts:568-589).
    // Must happen AFTER Phase 3 (API key loaded into env) and BEFORE Phase 4.5 (RPC registration).
    // The adapter reads ANTHROPIC_API_KEY from process.env (set in Phase 3).
    try {
      const sdkAdapter = container.resolve(TOKENS.SDK_AGENT_ADAPTER) as {
        initialize: () => Promise<boolean>;
        preloadSdk: () => Promise<void>;
      };
      const authInitialized = await sdkAdapter.initialize();

      if (authInitialized) {
        console.log(
          '[Ptah Electron] SDK authentication initialized successfully',
        );

        // Pre-load SDK in background (non-blocking) to speed up first chat.
        // Shifts ~100-200ms import cost from first user interaction to activation.
        sdkAdapter.preloadSdk().catch((err) => {
          console.warn(
            '[Ptah Electron] SDK preload failed (will retry on first use):',
            err instanceof Error ? err.message : String(err),
          );
        });
      } else {
        console.log(
          '[Ptah Electron] SDK auth not configured — users can configure in Settings',
        );
      }
    } catch (error) {
      console.warn(
        '[Ptah Electron] SDK initialization failed (non-fatal):',
        error instanceof Error ? error.message : String(error),
      );
    }

    // ========================================
    // PHASE 4: Setup IPC Bridge + WebviewManager
    // ========================================
    // The IPC bridge connects ipcMain to the RpcHandler for renderer <-> main communication.
    // It must be initialized BEFORE loading the renderer so that IPC listeners are ready
    // when the Angular app boots and starts sending RPC calls.
    // Resolve PtyManagerService for terminal binary IPC (TASK_2025_227)
    const ptyManager = container.resolve<PtyManagerService>(
      ELECTRON_TOKENS.PTY_MANAGER_SERVICE,
    );

    const ipcBridge = new IpcBridge(
      container,
      () => {
        const win = mainWindow;
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

    // ========================================
    // PHASE 4.45: Wire multi-phase analysis reader into EnhancedPromptsService
    // ========================================
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

    // ========================================
    // PHASE 4.5: Register All RPC Methods (TASK_2025_203 Batch 5)
    // ========================================
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

    // ========================================
    // PHASE 4.54: Ensure plugin/template content from GitHub (TASK_2025_248)
    // ========================================
    // Plugins and templates are no longer bundled in the app package.
    // ContentDownloadService downloads them to ~/.ptah/ on first launch and
    // keeps them up-to-date by comparing the manifest contentHash.
    // Non-blocking fire-and-forget: activation continues immediately.
    const contentDownload = container.resolve<ContentDownloadService>(
      PLATFORM_TOKENS.CONTENT_DOWNLOAD,
    );
    contentDownload.ensureContent().catch((err) => {
      console.warn(
        '[Ptah Electron] Content download failed (non-blocking):',
        err instanceof Error ? err.message : String(err),
      );
    });

    // ========================================
    // PHASE 4.55: Plugin Loader Initialization (TASK_2025_214)
    // ========================================
    // Initialize PluginLoaderService with app path and workspace state storage.
    // This enables plugin path resolution for the SDK and slash command autocomplete.
    // Must run AFTER Phase 4.5 (RPC registration) and BEFORE Phase 4.6 (session discovery).
    // Failure is non-fatal: the app works without plugins, just logs a warning.
    try {
      const pluginLoader = container.resolve<PluginLoaderService>(
        SDK_TOKENS.SDK_PLUGIN_LOADER,
      );
      const workspaceStateStorage = container.resolve<IStateStorage>(
        PLATFORM_TOKENS.WORKSPACE_STATE_STORAGE,
      );
      pluginLoader.initialize(
        contentDownload.getPluginsPath(),
        workspaceStateStorage,
      );

      const pluginConfig = pluginLoader.getWorkspacePluginConfig();
      const pluginPaths = pluginLoader.resolvePluginPaths(
        pluginConfig.enabledPluginIds,
      );

      // Wire into command discovery for slash command autocomplete.
      // COMMAND_DISCOVERY_SERVICE is NOT registered in Electron container,
      // so we guard with isRegistered() to avoid resolution failure.
      if (container.isRegistered(TOKENS.COMMAND_DISCOVERY_SERVICE)) {
        const cmdDiscovery = container.resolve(
          TOKENS.COMMAND_DISCOVERY_SERVICE,
        ) as { setPluginPaths: (paths: string[]) => void };
        cmdDiscovery.setPluginPaths(pluginPaths);
      } else {
        console.log(
          '[Ptah Electron] COMMAND_DISCOVERY_SERVICE not registered, skipping plugin path wiring',
        );
      }

      console.log(
        `[Ptah Electron] Plugin loader initialized (${pluginPaths.length} plugin paths)`,
      );
    } catch (error) {
      console.warn(
        '[Ptah Electron] Plugin loader initialization failed (non-fatal):',
        error instanceof Error ? error.message : String(error),
      );
    }

    // ========================================
    // PHASE 4.56: Skill Junction Activation (TASK_2025_214)
    // ========================================
    // Initialize SkillJunctionService and create junctions in workspace .ptah/skills/
    // for enabled plugins. This makes plugin skills discoverable by third-party AI
    // providers (Copilot, Codex) via MCP workspace search.
    // Always call activate() even with zero plugins so the workspace change subscription
    // is registered for future plugin enablement.
    // Failure is non-fatal: the app works without junctions, just logs a warning.
    try {
      const skillJunction = container.resolve<SkillJunctionService>(
        SDK_TOKENS.SDK_SKILL_JUNCTION,
      );
      skillJunction.initialize(contentDownload.getPluginsPath());

      // Re-resolve plugin loader (singleton) and get current paths
      const pluginLoader = container.resolve<PluginLoaderService>(
        SDK_TOKENS.SDK_PLUGIN_LOADER,
      );
      const config = pluginLoader.getWorkspacePluginConfig();
      const paths = pluginLoader.resolvePluginPaths(config.enabledPluginIds);

      const junctionResult = skillJunction.activate(paths, () => {
        const c = pluginLoader.getWorkspacePluginConfig();
        return pluginLoader.resolvePluginPaths(c.enabledPluginIds);
      });

      // Store reference for cleanup in will-quit handler
      skillJunctionRef = skillJunction;

      if (junctionResult.created > 0 || junctionResult.errors.length > 0) {
        console.log(
          `[Ptah Electron] Skill junctions: ${junctionResult.created} created, ${junctionResult.skipped} skipped, ${junctionResult.removed} removed, ${junctionResult.errors.length} errors`,
        );
      } else {
        console.log('[Ptah Electron] Skill junctions activated');
      }
    } catch (error) {
      console.warn(
        '[Ptah Electron] Skill junction activation failed (non-fatal):',
        error instanceof Error ? error.message : String(error),
      );
    }

    // ========================================
    // PHASE 4.565: CLI Skill Sync (TASK_2025_243)
    // ========================================
    // Sync Ptah plugin skills to installed CLI agent directories (Copilot, Gemini).
    // Premium-only, non-blocking, fire-and-forget.
    // Mirrors VS Code extension Step 7.1.6 (main.ts:680-740).
    if (startupLicenseTier === 'pro' || startupLicenseTier === 'trial_pro') {
      try {
        const cliPluginSync = container.resolve(
          TOKENS.CLI_PLUGIN_SYNC_SERVICE,
        ) as {
          initialize: (
            globalState: IStateStorage,
            extensionPath: string,
            pluginPathResolver?: (ids: string[]) => string[],
          ) => void;
          syncOnActivation: (enabledPluginIds: string[]) => Promise<unknown[]>;
        };

        const pluginLoaderForSync = container.resolve<PluginLoaderService>(
          SDK_TOKENS.SDK_PLUGIN_LOADER,
        );

        const globalStateForSync = container.resolve<IStateStorage>(
          PLATFORM_TOKENS.STATE_STORAGE,
        );
        cliPluginSync.initialize(
          globalStateForSync,
          contentDownload.getPluginsPath(),
          (ids: string[]) => pluginLoaderForSync.resolvePluginPaths(ids),
        );

        const syncPluginConfig = pluginLoaderForSync.getWorkspacePluginConfig();
        const enabledPluginIds = syncPluginConfig.enabledPluginIds || [];

        if (enabledPluginIds.length > 0) {
          // Fire-and-forget: sync skills in background
          cliPluginSync
            .syncOnActivation(enabledPluginIds)
            .then((results) => {
              console.log(
                `[Ptah Electron] CLI skill sync complete (${results.length} results)`,
              );
            })
            .catch((syncError) => {
              console.warn(
                '[Ptah Electron] CLI skill sync failed (non-blocking):',
                syncError instanceof Error
                  ? syncError.message
                  : String(syncError),
              );
            });
        } else {
          console.log(
            '[Ptah Electron] CLI skill sync skipped (no enabled plugins)',
          );
        }
      } catch (cliSyncError) {
        console.warn(
          '[Ptah Electron] CLI skill sync setup failed (non-fatal):',
          cliSyncError instanceof Error
            ? cliSyncError.message
            : String(cliSyncError),
        );
      }
    } else {
      console.log(
        `[Ptah Electron] CLI skill sync skipped (tier: ${startupLicenseTier ?? 'unknown'})`,
      );
    }

    // ========================================
    // PHASE 4.57: Model Pricing Pre-fetch (TASK_2025_240)
    // ========================================
    // Pre-fetch model pricing from OpenRouter so cost calculations use live data.
    // Mirrors VS Code extension Step 7.2 (main.ts:754-768).
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

    // ========================================
    // PHASE 4.58: Proactive CLI Detection (TASK_2025_240)
    // ========================================
    // Detect installed CLI agents (Gemini, Codex) early so settings UI is instant.
    // Mirrors VS Code extension Step 7.3 (main.ts:773-824).
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

    // ========================================
    // PHASE 4.59: MCP Server Startup (TASK_2025_243)
    // ========================================
    // Start the Code Execution MCP server for Pro tier users.
    // Mirrors VS Code extension Step 12 (main.ts:905-944).
    // Non-fatal: MCP server failure should NOT crash the app.
    if (startupLicenseTier === 'pro' || startupLicenseTier === 'trial_pro') {
      if (container.isRegistered(TOKENS.CODE_EXECUTION_MCP)) {
        try {
          console.log('[Ptah Electron] Starting MCP server (Pro tier user)...');
          const codeExecutionMCP = container.resolve(TOKENS.CODE_EXECUTION_MCP);
          const mcpPort = await (
            codeExecutionMCP as { start: () => Promise<number> }
          ).start();
          // Update the runtime port so SDK query builders use the actual port
          // (may differ from default 51820 if fallback to OS-assigned port)
          setPtahMcpPort(mcpPort);
          console.log(`[Ptah Electron] MCP Server started on port ${mcpPort}`);
        } catch (mcpError) {
          console.warn(
            '[Ptah Electron] MCP server failed to start (non-fatal):',
            mcpError instanceof Error ? mcpError.message : String(mcpError),
          );
        }
      } else {
        console.log(
          '[Ptah Electron] CODE_EXECUTION_MCP not registered, skipping MCP server startup',
        );
      }
    } else {
      console.log(
        `[Ptah Electron] MCP server skipped (tier: ${startupLicenseTier ?? 'unknown'})`,
      );
    }

    // ========================================
    // PHASE 4.6: Session Auto-Discovery (TASK_2025_210)
    // ========================================
    // Import existing Claude sessions from ~/.claude/projects/ for the active
    // workspace. Uses startupWorkspaceRoot (resolved in Phase 2.5) which covers
    // both CLI arg AND persisted workspace restoration — not just initialFolders.
    // Non-fatal: failures are logged as warnings but do not block startup.
    {
      const workspaceRoot = startupWorkspaceRoot;
      if (workspaceRoot) {
        try {
          const sessionImporter = container.resolve(
            SDK_TOKENS.SDK_SESSION_IMPORTER,
          ) as {
            scanAndImport: (path: string, limit?: number) => Promise<number>;
          };
          const imported = await sessionImporter.scanAndImport(
            workspaceRoot,
            50,
          );
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
    }

    // ========================================
    // PHASE 4.7: Application Menu
    // ========================================
    createApplicationMenu(container, () => mainWindow);

    // ========================================
    // PHASE 4.8: Git File System Watcher (TASK_2025_240)
    // ========================================
    // Watch .git directory and workspace files for changes, push git status
    // updates to the renderer. Replaces frontend polling with event-driven push.
    // Only runs `git status` when something actually changes — zero wasted calls.
    if (startupWorkspaceRoot) {
      try {
        const { GitWatcherService } =
          await import('./services/git-watcher.service');
        const gitInfoSvc = container.resolve(
          ELECTRON_TOKENS.GIT_INFO_SERVICE,
        ) as InstanceType<
          typeof import('./services/git-info.service').GitInfoService
        >;
        const webviewManager = container.resolve(TOKENS.WEBVIEW_MANAGER) as {
          broadcastMessage: (type: string, payload: unknown) => Promise<void>;
        };

        const logger = container.resolve<
          import('@ptah-extension/vscode-core').Logger
        >(TOKENS.LOGGER);
        const gitWatcher = new GitWatcherService(gitInfoSvc, logger);
        gitWatcher.start(startupWorkspaceRoot, (type, payload) => {
          webviewManager.broadcastMessage(type, payload);
        });
        gitWatcherRef = gitWatcher;
        console.log('[Ptah Electron] Git file system watcher started');
      } catch (error) {
        console.warn(
          '[Ptah Electron] Git watcher setup failed (non-fatal):',
          error instanceof Error ? error.message : String(error),
        );
      }
    }

    // ========================================
    // PHASE 4.9: Resolve State Storage for Window Persistence
    // ========================================
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

    // ========================================
    // PHASE 4.95: Startup Config IPC Handler
    // ========================================
    // Register a synchronous IPC handler that the preload script queries
    // (via ipcRenderer.sendSync) to get license status and workspace info
    // BEFORE exposing ptahConfig to the Angular renderer.
    // Must be registered BEFORE Phase 5 (window creation + loadFile).
    // Base config from initial verification. On first load these are used directly.
    // On webContents.reload() the handler dynamically queries LicenseService
    // to pick up any license changes that happened since startup.
    const baseStartupConfig = {
      initialView: startupInitialView,
      isLicensed: startupIsLicensed,
      workspaceRoot: startupWorkspaceRoot || '',
      workspaceName: startupWorkspaceRoot
        ? path.basename(startupWorkspaceRoot)
        : '',
    };

    ipcMain.on('get-startup-config', (event: Electron.IpcMainEvent) => {
      // Dynamically resolve license status so webContents.reload() gets fresh
      // state after license key set/clear or settings import.
      let isLicensed = baseStartupConfig.isLicensed;
      let initialView = baseStartupConfig.initialView;
      try {
        const licenseService = container.resolve(TOKENS.LICENSE_SERVICE) as {
          getCachedStatus: () => {
            valid: boolean;
            tier?: string;
          } | null;
        };
        const cached = licenseService.getCachedStatus();
        if (cached) {
          isLicensed = cached.valid;
          initialView = cached.valid ? null : 'welcome';
        }
      } catch {
        // Fallback to base startup values if service unavailable
      }

      event.returnValue = {
        ...baseStartupConfig,
        isLicensed,
        initialView,
      };
    });

    console.log(
      `[Ptah Electron] Startup config registered: initialView=${
        baseStartupConfig.initialView
      }, isLicensed=${baseStartupConfig.isLicensed}, workspace=${
        baseStartupConfig.workspaceName || '(none)'
      }`,
    );

    // ========================================
    // PHASE 5: Create BrowserWindow + Load Renderer
    // ========================================
    mainWindow = createMainWindow(resolvedStateStorage);

    // Handle second instance (focus existing window)
    app.on('second-instance', () => {
      if (mainWindow) {
        if (mainWindow.isMinimized()) mainWindow.restore();
        mainWindow.focus();
      }
    });

    const rendererPath = path.join(__dirname, 'renderer', 'index.html');
    mainWindow.loadFile(rendererPath);

    // Open DevTools in development
    if (process.env['NODE_ENV'] === 'development') {
      mainWindow.webContents.openDevTools();
    }

    // ========================================
    // PHASE 6: Auto-Updater (production only)
    // ========================================
    // Check for updates after the window is loaded. Failures must NOT crash the app.
    if (process.env['NODE_ENV'] !== 'development') {
      try {
        const { autoUpdater } = await import('electron-updater');
        await autoUpdater.checkForUpdatesAndNotify();
        console.log('[Ptah Electron] Auto-updater check completed');
      } catch (error) {
        console.error(
          '[Ptah Electron] Auto-updater failed (non-fatal):',
          error instanceof Error ? error.message : String(error),
        );
      }
    }

    // ========================================
    // PHASE 7: License Status Watcher (TASK_2025_240)
    // ========================================
    // Handle dynamic license changes (upgrade/expire) at runtime.
    // Mirrors VS Code extension Step 13 (main.ts:954-1004).
    // In Electron, we notify via dialog.showMessageBox instead of VS Code's
    // showInformationMessage, and offer app relaunch instead of window reload.
    try {
      const licenseService = container.resolve(TOKENS.LICENSE_SERVICE) as {
        on: (event: string, handler: (...args: unknown[]) => void) => void;
        revalidate: () => Promise<void>;
      };

      licenseService.on('license:verified', () => {
        console.log('[Ptah Electron] License status changed: verified');
        const win = mainWindow;
        if (win) {
          dialog
            .showMessageBox(win, {
              type: 'info',
              title: 'License Updated',
              message:
                'License status updated! Restart the app to apply changes.',
              buttons: ['Restart Now', 'Later'],
            })
            .then((result) => {
              if (result.response === 0) {
                app.relaunch();
                app.exit(0);
              }
            });
        }
      });

      licenseService.on('license:expired', () => {
        console.warn(
          '[Ptah Electron] License expired — app will be restricted on restart',
        );
        const win = mainWindow;
        if (win) {
          dialog.showMessageBox(win, {
            type: 'warning',
            title: 'License Expired',
            message:
              'Your Ptah license has expired. Please renew your subscription to continue using premium features.',
            buttons: ['OK'],
          });
        }

        // Clean up CLI skills and agents on premium expiry
        // Mirrors VS Code extension Step 13 license:expired handler
        try {
          if (container.isRegistered(TOKENS.CLI_PLUGIN_SYNC_SERVICE)) {
            const cliPluginSync = container.resolve(
              TOKENS.CLI_PLUGIN_SYNC_SERVICE,
            ) as { cleanupAll: () => Promise<void> };
            cliPluginSync.cleanupAll().catch((err: unknown) => {
              console.warn(
                '[Ptah Electron] CLI plugin cleanup on expiry failed (non-fatal):',
                err instanceof Error ? err.message : String(err),
              );
            });
          }
        } catch {
          // Service not initialized — nothing to clean up
        }
      });

      // Background revalidation every 24 hours.
      // The interval reference is stored in the outer scope so the
      // will-quit handler can clear it during app shutdown.
      revalidationInterval = setInterval(
        () => {
          licenseService.revalidate().catch((err) => {
            console.warn(
              '[Ptah Electron] Background license revalidation failed:',
              err instanceof Error ? err.message : String(err),
            );
          });
        },
        24 * 60 * 60 * 1000,
      );

      console.log('[Ptah Electron] License status watcher initialized');
    } catch (error) {
      console.warn(
        '[Ptah Electron] License status watcher setup failed (non-fatal):',
        error instanceof Error ? error.message : String(error),
      );
    }
  });

  // macOS: re-create window when dock icon is clicked.
  // DI container + IPC bridge persist across window close on macOS,
  // so we only need to recreate the BrowserWindow and load the renderer.
  // The IPC bridge's getWindow callback already references `mainWindow`,
  // so it will pick up the new window automatically.
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = createMainWindow(resolvedStateStorage);
      const rendererPath = path.join(__dirname, 'renderer', 'index.html');
      mainWindow.loadFile(rendererPath);
    }
  });

  // Quit when all windows are closed (except on macOS)
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit();
    }
  });

  // Clean up skill junctions and license revalidation on app quit (TASK_2025_214, TASK_2025_240)
  // deactivateSync() removes all managed junctions/symlinks and unsubscribes
  // from workspace folder changes. Must be synchronous (will-quit is sync).
  app.on('will-quit', () => {
    // Clear license revalidation interval (TASK_2025_240)
    if (revalidationInterval !== null) {
      clearInterval(revalidationInterval);
      revalidationInterval = null;
    }

    // Stop git file system watcher (TASK_2025_240)
    gitWatcherRef?.stop();

    try {
      skillJunctionRef?.deactivateSync();
    } catch (error) {
      console.warn(
        '[Ptah Electron] Skill junction cleanup failed (non-fatal):',
        error instanceof Error ? error.message : String(error),
      );
    }

    // Dispose PtahCliRegistry CLI adapters (TASK_2025_243)
    try {
      const diContainer = ElectronDIContainer.getContainer();
      if (diContainer.isRegistered(SDK_TOKENS.SDK_PTAH_CLI_REGISTRY)) {
        const cliRegistry = diContainer.resolve<{ disposeAll(): void }>(
          SDK_TOKENS.SDK_PTAH_CLI_REGISTRY,
        );
        cliRegistry.disposeAll();
      }
    } catch {
      // Non-fatal: registry may not have been initialized
    }
  });
} // end of gotLock guard
