import { BrowserWindow, ipcMain, clipboard } from 'electron';
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
import {
  GATEWAY_CHAT_BRIDGE_TOKENS,
  type GatewayChatBridge,
} from '@ptah-extension/gateway-chat-bridge';
import { MESSAGE_TYPES } from '@ptah-extension/shared';
import { UpdateManager } from '../services/update/update-manager';
import { UPDATE_MANAGER_TOKEN } from '../services/update/update-tokens';
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
   * Warmup callback from wireRuntime. Called once after the main window
   * fires `did-finish-load` so the 3s idle timer starts from window-ready,
   * not from bootHeavyServices completion. Optional — omit in tests.
   */
  scheduleWarmup?: () => void;
}

export interface PostWindowResult {
  revalidationInterval: ReturnType<typeof setInterval> | null;
  /**
   * Periodic 4-hour update check interval handle. Cleared in main.ts will-quit
   * LIFO handler (position 2.5, after revalidationInterval, before git watcher).
   * Null when UpdateManager.start() bails early (dev mode or already started).
   */
  updateCheckInterval: ReturnType<typeof setInterval> | null;
  /**
   * The started UpdateManager instance, captured so will-quit can dispose it
   * by reference instead of re-resolving the singleton from the container
   * (a re-resolve reconstructs it and needs WEBVIEW_MANAGER, which may be
   * gone during teardown). Null when resolution failed.
   */
  updateManager: UpdateManager | null;
  /**
   * Messaging gateway service handle for orderly shutdown. Started after
   * window creation so adapters have a stable mainWindow for approval prompts.
   * Null when gateway.enabled is false or start() fails.
   */
  messagingGateway: GatewayService | null;
  /**
   * Gateway chat bridge handle for orderly shutdown. Started after the
   * gateway so inbound events have a live subscriber. Null when the gateway
   * failed to start or the bridge could not be resolved/started.
   */
  chatBridge: GatewayChatBridge | null;
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
    scheduleWarmup,
  } = options;

  let revalidationInterval: PostWindowResult['revalidationInterval'] = null;
  let updateCheckInterval: PostWindowResult['updateCheckInterval'] = null;
  let updateManager: UpdateManager | null = null;
  let messagingGateway: GatewayService | null = null;
  let chatBridge: GatewayChatBridge | null = null;
  const baseStartupConfig = {
    initialView: startupInitialView,
    isLicensed: startupIsLicensed,
  };

  ipcMain.on('get-startup-config', (event: Electron.IpcMainEvent) => {
    let workspaceRoot = '';
    let workspaceName = '';

    const workspaceProvider = container.resolve<IWorkspaceProvider>(
      PLATFORM_TOKENS.WORKSPACE_PROVIDER,
    );
    const resolvedRoot = workspaceProvider.getWorkspaceRoot();
    if (resolvedRoot) {
      workspaceRoot = resolvedRoot;
      workspaceName = path.basename(resolvedRoot);
    }

    event.returnValue = {
      ...baseStartupConfig,
      workspaceRoot,
      workspaceName,
    };
  });
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
  const mainWindow = createMainWindow(resolvedStateStorage);
  setMainWindow(mainWindow);

  const rendererPath = path.join(__dirname, 'renderer', 'index.html');
  mainWindow.loadFile(rendererPath);
  if (scheduleWarmup) {
    mainWindow.webContents.once('did-finish-load', () => {
      scheduleWarmup();
    });
  }
  if (
    process.env['NODE_ENV'] === 'development' &&
    process.env['PTAH_NO_DEVTOOLS'] !== '1'
  ) {
    mainWindow.webContents.openDevTools();
  }
  try {
    messagingGateway = container.resolve<GatewayService>(
      GATEWAY_TOKENS.GATEWAY_SERVICE,
    );
  } catch (error) {
    console.warn(
      '[Ptah Electron] Messaging gateway resolve skipped (non-fatal):',
      error instanceof Error ? error.message : String(error),
    );
    messagingGateway = null;
  }
  if (messagingGateway) {
    try {
      chatBridge = container.resolve<GatewayChatBridge>(
        GATEWAY_CHAT_BRIDGE_TOKENS.GATEWAY_CHAT_BRIDGE,
      );
    } catch (error) {
      console.warn(
        '[Ptah Electron] Gateway chat bridge resolve skipped (non-fatal):',
        error instanceof Error ? error.message : String(error),
      );
      chatBridge = null;
    }
  }
  // Started non-blocking: gateway I/O must not delay the updater or window.
  if (messagingGateway) {
    const gateway = messagingGateway;
    const bridge = chatBridge;
    void (async () => {
      try {
        await gateway.start();
        console.log('[Ptah Electron] Messaging gateway started');

        const webviewManager = container.resolve(TOKENS.WEBVIEW_MANAGER) as {
          broadcastMessage(type: string, payload: unknown): Promise<void>;
        };
        const status = gateway.status();
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
      } catch (error) {
        console.warn(
          '[Ptah Electron] Messaging gateway start skipped (non-fatal):',
          error instanceof Error ? error.message : String(error),
        );
        return;
      }

      if (bridge) {
        try {
          bridge.start();
          console.log('[Ptah Electron] Gateway chat bridge started');
        } catch (error) {
          console.warn(
            '[Ptah Electron] Gateway chat bridge start skipped (non-fatal):',
            error instanceof Error ? error.message : String(error),
          );
        }
      }
    })();
  }
  try {
    updateManager = container.resolve<UpdateManager>(UPDATE_MANAGER_TOKEN);
    await updateManager.start();
    updateCheckInterval = updateManager.getCheckInterval();
    console.log('[Ptah Electron] UpdateManager started');
  } catch (error) {
    console.error(
      '[Ptah Electron] UpdateManager failed to start (non-fatal):',
      error instanceof Error ? error.message : String(error),
    );
  }
  try {
    const licenseService = container.resolve(TOKENS.LICENSE_SERVICE) as {
      revalidate: () => Promise<void>;
    };

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

    console.log('[Ptah Electron] Membership revalidation scheduled');
  } catch (error) {
    console.warn(
      '[Ptah Electron] Membership revalidation setup failed (non-fatal):',
      error instanceof Error ? error.message : String(error),
    );
  }

  return {
    revalidationInterval,
    updateCheckInterval,
    updateManager,
    messagingGateway,
    chatBridge,
  };
}
