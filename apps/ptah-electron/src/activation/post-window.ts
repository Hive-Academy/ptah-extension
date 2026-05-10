// Post-window activation: Phases 4.95 through 7.
// Registers the startup config + clipboard IPC handlers BEFORE creating the
// main window (preload uses sendSync during page load), then creates the
// window, kicks off the auto-updater, and wires the license status watcher.
//
// Split from main.ts per TASK_2025_291 Wave C1 / design section B.3.3.

import { app, BrowserWindow, dialog, ipcMain, clipboard } from 'electron';
import * as path from 'path';
import { fileURLToPath } from 'url';
import type { DependencyContainer } from 'tsyringe';
import type {
  IStateStorage,
  IWorkspaceProvider,
} from '@ptah-extension/platform-core';
import { PLATFORM_TOKENS } from '@ptah-extension/platform-core';
import { TOKENS } from '@ptah-extension/vscode-core';
import { createMainWindow } from '../windows/main-window';
import {
  GATEWAY_TOKENS,
  type GatewayService,
} from '@ptah-extension/messaging-gateway';
import { MESSAGE_TYPES } from '@ptah-extension/shared';

// @ts-expect-error import.meta.url is valid in ESM bundle output; TS flags it because tsconfig targets CJS
const __dirname = path.dirname(fileURLToPath(import.meta.url));

export interface PostWindowOptions {
  container: DependencyContainer;
  resolvedStateStorage: IStateStorage | undefined;
  startupIsLicensed: boolean;
  startupInitialView: string | null;
  /** Mutates caller's mainWindow slot; returned window is for ergonomic chaining. */
  setMainWindow: (win: BrowserWindow) => void;
  getMainWindow: () => BrowserWindow | null;
  /**
   * R4 warmup callback from wireRuntime. Called once after the main window
   * fires `did-finish-load` so the 3s idle timer starts from window-ready,
   * not from bootHeavyServices completion. Optional — omit in tests.
   */
  scheduleWarmup?: () => void;
}

export interface PostWindowResult {
  revalidationInterval: ReturnType<typeof setInterval> | null;
  /**
   * Messaging gateway service handle for orderly shutdown. Started after
   * window creation so adapters have a stable mainWindow for approval prompts.
   * Null when gateway.enabled is false or start() fails.
   */
  messagingGateway: GatewayService | null;
}

export async function registerPostWindow(
  options: PostWindowOptions,
): Promise<PostWindowResult> {
  const {
    container,
    resolvedStateStorage,
    startupIsLicensed,
    startupInitialView,
    setMainWindow,
    getMainWindow,
    scheduleWarmup,
  } = options;

  let revalidationInterval: PostWindowResult['revalidationInterval'] = null;
  let messagingGateway: GatewayService | null = null;
  // PHASE 4.95: Startup Config IPC Handler
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

    // Dynamically resolve workspace so webContents.reload() picks up any
    // workspace switch that happened since initial load.
    let workspaceRoot = '';
    let workspaceName = '';
    try {
      const workspaceProvider = container.resolve<IWorkspaceProvider>(
        PLATFORM_TOKENS.WORKSPACE_PROVIDER,
      );
      const resolvedRoot = workspaceProvider.getWorkspaceRoot();
      if (resolvedRoot) {
        workspaceRoot = resolvedRoot;
        workspaceName = path.basename(resolvedRoot);
      }
    } catch {
      // Workspace provider unavailable — leave empty strings
    }

    event.returnValue = {
      ...baseStartupConfig,
      isLicensed,
      initialView,
      workspaceRoot,
      workspaceName,
    };
  });
  // PHASE 4.96: Clipboard IPC Handlers
  // Provide reliable clipboard access for the sandboxed renderer.
  // navigator.clipboard.readText() can fail in sandboxed Electron;
  // these IPC handlers use the main process clipboard directly.
  ipcMain.handle('clipboard:read-text', () => clipboard.readText());
  ipcMain.on(
    'clipboard:write-text',
    (_event: Electron.IpcMainEvent, text: string) => {
      clipboard.writeText(text);
    },
  );

  console.log(
    `[Ptah Electron] Startup config registered: initialView=${
      baseStartupConfig.initialView
    }, isLicensed=${baseStartupConfig.isLicensed}`,
  );
  // PHASE 5: Create BrowserWindow + Load Renderer
  const mainWindow = createMainWindow(resolvedStateStorage);
  setMainWindow(mainWindow);

  const rendererPath = path.join(__dirname, 'renderer', 'index.html');
  mainWindow.loadFile(rendererPath);

  // PHASE 4.96: Schedule embedder warmup AFTER the renderer finishes loading (R4).
  // Anchoring to did-finish-load ensures the 3s idle timer starts from window-ready,
  // not from bootHeavyServices completion, so ONNX model I/O does not compete with
  // the renderer's first paint. Fire-and-forget — warmup failure is non-fatal.
  if (scheduleWarmup) {
    mainWindow.webContents.once('did-finish-load', () => {
      scheduleWarmup();
    });
  }

  // Open DevTools in development
  if (process.env['NODE_ENV'] === 'development') {
    mainWindow.webContents.openDevTools();
  }
  // PHASE 5.5: Messaging gateway cold-start
  // Started here (after window creation) so gateway adapters have a stable
  // mainWindow reference for approval prompt dialogs. Failure is non-fatal —
  // gateway.enabled defaults to false so most users will see start() as a no-op.
  try {
    messagingGateway = container.resolve<GatewayService>(
      GATEWAY_TOKENS.GATEWAY_SERVICE,
    );
    await messagingGateway.start();
    console.log('[Ptah Electron] Messaging gateway started');
    try {
      const webviewManager = container.resolve(TOKENS.WEBVIEW_MANAGER) as {
        broadcastMessage(type: string, payload: unknown): Promise<void>;
      };
      const status = messagingGateway.status();
      void webviewManager.broadcastMessage(
        MESSAGE_TYPES.GATEWAY_STATUS_CHANGED,
        {
          status: {
            enabled: status.enabled,
            adapters: status.adapters.map((a) => ({
              platform: a.platform,
              running: a.running,
              ...(a.lastError ? { lastError: a.lastError } : {}),
            })),
          },
          origin: null,
        },
      );
    } catch {
      // non-fatal — frontend will hydrate via initialize()'s
      // Promise.all([refreshStatus(), listBindings()]) RPC fallback
    }
  } catch (error) {
    console.warn(
      '[Ptah Electron] Messaging gateway start skipped (non-fatal):',
      error instanceof Error ? error.message : String(error),
    );
    messagingGateway = null;
  }
  // PHASE 6: Auto-Updater (production only)
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
  // PHASE 7: License Status Watcher (TASK_2025_240)
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
      const win = getMainWindow();
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
      const win = getMainWindow();
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

  return { revalidationInterval, messagingGateway };
}
