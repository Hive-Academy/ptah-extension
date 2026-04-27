// Wire runtime: Phases 4 through 4.9 of Electron activation.
// Split from main.ts per TASK_2025_291 Wave C1 / design section B.3.2.

import type { DependencyContainer } from 'tsyringe';
import type { BrowserWindow } from 'electron';
import {
  PLATFORM_TOKENS,
  ContentDownloadService,
} from '@ptah-extension/platform-core';
import type { IStateStorage } from '@ptah-extension/platform-core';
import { TOKENS } from '@ptah-extension/vscode-core';
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

export interface WireRuntimeOptions {
  container: DependencyContainer;
  getMainWindow: () => BrowserWindow | null;
  startupWorkspaceRoot: string | undefined;
  startupLicenseTier: string | undefined;
}

export interface WireRuntimeResult {
  resolvedStateStorage: IStateStorage | undefined;
  skillJunctionRef: { deactivateSync: () => void } | null;
  gitWatcher: { stop: () => void; switchWorkspace: (p: string) => void } | null;
}

export async function wireRuntime(
  options: WireRuntimeOptions,
): Promise<WireRuntimeResult> {
  const { container, getMainWindow, startupWorkspaceRoot, startupLicenseTier } =
    options;

  let skillJunctionRef: WireRuntimeResult['skillJunctionRef'] = null;
  let gitWatcher: WireRuntimeResult['gitWatcher'] = null;
  let resolvedStateStorage: IStateStorage | undefined;
  // PHASE 4: Setup IPC Bridge + WebviewManager
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
  // PHASE 4.5: Register All RPC Methods (TASK_2025_203 Batch 5)
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
  // PHASE 4.54: Ensure plugin/template content from GitHub (TASK_2025_248)
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
  // PHASE 4.55: Plugin Loader Initialization (TASK_2025_214)
  // Must run AFTER Phase 4.5 (RPC registration) and BEFORE Phase 4.6 (session discovery).
  initPluginLoader(container, contentDownload.getPluginsPath());
  // PHASE 4.56: Skill Junction Activation (TASK_2025_214)
  // Always call activate() even with zero plugins so the workspace change
  // subscription is registered for future plugin enablement.
  skillJunctionRef = activateSkillJunctions(
    container,
    contentDownload.getPluginsPath(),
  );
  // PHASE 4.565: CLI Skill Sync (TASK_2025_243)
  // Sync Ptah plugin skills to installed CLI agent directories (Copilot, Gemini).
  // Premium-only, non-blocking, fire-and-forget.
  // Mirrors VS Code extension Step 7.1.6 (main.ts:680-740).
  if (startupLicenseTier === 'pro' || startupLicenseTier === 'trial_pro') {
    syncCliSkillsOnActivation(container, contentDownload.getPluginsPath());
  } else {
    console.log(
      `[Ptah Electron] CLI skill sync skipped (tier: ${startupLicenseTier ?? 'unknown'})`,
    );
  }
  // PHASE 4.566: CLI Agent Sync on Activation (TASK_2025_268)
  // Pro-gated fire-and-forget; implementation extracted to ./cli-agent-sync.
  if (startupLicenseTier === 'pro' || startupLicenseTier === 'trial_pro') {
    if (startupWorkspaceRoot) {
      syncCliAgentsOnActivation(container, startupWorkspaceRoot);
    }
  } else {
    console.log(
      `[Ptah Electron] CLI agent sync skipped (tier: ${startupLicenseTier ?? 'unknown'})`,
    );
  }
  // PHASE 4.57: Model Pricing Pre-fetch (TASK_2025_240)
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
  // PHASE 4.58: Proactive CLI Detection (TASK_2025_240)
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
  // PHASE 4.59: MCP Server Startup (TASK_2025_243)
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
  // PHASE 4.6: Session Auto-Discovery (TASK_2025_210)
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
  }
  // PHASE 4.7: Application Menu
  createApplicationMenu(container, getMainWindow);
  // PHASE 4.8: Git File System Watcher (TASK_2025_240)
  // Watch .git directory and workspace files for changes, push git status
  // updates to the renderer. Replaces frontend polling with event-driven push.
  // Only runs `git status` when something actually changes — zero wasted calls.
  if (startupWorkspaceRoot) {
    try {
      const { GitWatcherService } =
        await import('../services/git-watcher.service');
      // TASK_2026_104 Sub-batch B5b: GitInfoService now lives in
      // `@ptah-extension/vscode-core` and is registered under TOKENS.GIT_INFO_SERVICE.
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
      watcher.start(startupWorkspaceRoot, (type, payload) => {
        webviewManager.broadcastMessage(type, payload);
      });
      gitWatcher = watcher;
      console.log('[Ptah Electron] Git file system watcher started');
    } catch (error) {
      console.warn(
        '[Ptah Electron] Git watcher setup failed (non-fatal):',
        error instanceof Error ? error.message : String(error),
      );
    }
  }
  // PHASE 4.9: Resolve State Storage for Window Persistence
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

  return {
    resolvedStateStorage,
    skillJunctionRef,
    gitWatcher,
  };
}
