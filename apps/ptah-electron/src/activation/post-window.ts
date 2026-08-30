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
import { UpdateManager } from '../services/update/update-manager';
import { UPDATE_MANAGER_TOKEN } from '../services/update/update-tokens';
import type { BootCoordinator } from './boot-coordinator';
import { startMessagingGateway } from './start-messaging-gateway';
const __dirname = path.dirname(fileURLToPath(import.meta.url));

export interface PostWindowOptions {
  container: DependencyContainer;
  resolvedStateStorage: IStateStorage | undefined;
  /** Mutates caller's mainWindow slot; returned window is for ergonomic chaining. */
  setMainWindow: (win: BrowserWindow) => void;
  getMainWindow: () => BrowserWindow | null;
  /**
   * Owns the stable refs object and the embedder warmup barrier.
   *
   * Every long-lived handle created below is written into `coordinator.refs`
   * so `will-quit` disposes it even though this phase now finishes BEFORE the
   * heavy boot rather than after it (TASK_2026_331 B1.T6).
   */
  coordinator: BootCoordinator;
}

export interface PostWindowResult {
  revalidationInterval: ReturnType<typeof setInterval> | null;
  /**
   * Periodic 4-hour update check interval handle. Cleared in main.ts will-quit
   * LIFO handler (position 2.5, after revalidationInterval, before git watcher).
   * Null when UpdateManager.start() bails early (dev mode or already started).
   */
  updateCheckInterval: ReturnType<typeof setInterval> | null;
}

export async function registerPostWindow(
  options: PostWindowOptions,
): Promise<PostWindowResult> {
  const { container, resolvedStateStorage, setMainWindow, coordinator } =
    options;
  const refs = coordinator.refs;

  let revalidationInterval: PostWindowResult['revalidationInterval'] = null;
  let updateCheckInterval: PostWindowResult['updateCheckInterval'] = null;
  let updateManager: UpdateManager | null = null;
  let messagingGateway: GatewayService | null = null;
  let chatBridge: GatewayChatBridge | null = null;

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
      initialView: null,
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

  console.log('[Ptah Electron] Startup config registered');
  const mainWindow = createMainWindow(resolvedStateStorage);
  setMainWindow(mainWindow);

  const rendererPath = path.join(__dirname, 'renderer', 'index.html');
  mainWindow.loadFile(rendererPath);
  // One half of the warmup barrier. The other half — the memory curator — is
  // created inside the post-window boot, which has not even started yet, so
  // this is a NOTIFICATION rather than a trigger. The coordinator waits for
  // both before it starts the 3-second idle timer (TASK_2026_331 B1.T7).
  mainWindow.webContents.once('did-finish-load', () => {
    coordinator.notifyWindowLoaded();
  });
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
  refs.messagingGateway = messagingGateway;
  refs.chatBridge = chatBridge;
  // Started non-blocking — gateway I/O must not delay the updater or window —
  // and DEFERRED behind the persistence gate: `GatewayService.start()` runs
  // voice GC against `gateway_messages` and the bridge claims interrupted
  // turns, both SQLite writes. This phase runs BEFORE the heavy boot opens the
  // database, so without the gate both landed on a closed or mid-migration
  // connection (TASK_2026_347).
  if (messagingGateway) {
    const gateway = messagingGateway;
    const bridge = chatBridge;
    void startMessagingGateway({
      gateway,
      bridge,
      coordinator,
      // Resolved lazily, as it was inside the old IIFE: this phase must not
      // fail activation because the webview manager is not registered yet.
      broadcast: (type, payload) =>
        (
          container.resolve(TOKENS.WEBVIEW_MANAGER) as {
            broadcastMessage(type: string, payload: unknown): Promise<void>;
          }
        ).broadcastMessage(type, payload),
    }).catch((error: unknown) => {
      console.warn(
        '[Ptah Electron] Messaging gateway start failed (non-fatal):',
        error instanceof Error ? error.message : String(error),
      );
    });
  }
  try {
    updateManager = container.resolve<UpdateManager>(UPDATE_MANAGER_TOKEN);
    await updateManager.start();
    updateCheckInterval = updateManager.getCheckInterval();
    refs.updateManager = updateManager;
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
  };
}
