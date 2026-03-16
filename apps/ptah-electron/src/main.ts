// CRITICAL: reflect-metadata MUST be imported first for TSyringe to work
import 'reflect-metadata';

import { app, BrowserWindow, safeStorage, dialog, ipcMain } from 'electron';
import * as path from 'path';
import { createMainWindow } from './windows/main-window';
import { ElectronDIContainer } from './di/container';
import { setupRpcHandlers } from './services/rpc/rpc-handler-setup';
import { registerExtendedRpcMethods } from './services/rpc/rpc-method-registration.service';
import { IpcBridge } from './ipc/ipc-bridge';
import { ElectronWebviewManagerAdapter } from './ipc/webview-manager-adapter';
import { createApplicationMenu } from './menu/application-menu';
import type { ElectronPlatformOptions } from '@ptah-extension/platform-electron';
import { PLATFORM_TOKENS } from '@ptah-extension/platform-core';
import type {
  ISecretStorage,
  IStateStorage,
} from '@ptah-extension/platform-core';
import { TOKENS } from '@ptah-extension/vscode-core';

// Prevent multiple instances
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
}

let mainWindow: BrowserWindow | null = null;
let resolvedStateStorage: IStateStorage | undefined;

app.whenReady().then(async () => {
  // ========================================
  // PHASE 1: Parse command-line args
  // ========================================
  const workspacePath = process.argv.find(
    (arg) =>
      !arg.startsWith('-') && arg !== process.argv[0] && arg !== process.argv[1]
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
          options as Electron.MessageBoxOptions
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
          err instanceof Error ? err.message : String(err)
        );
      }
    }

    console.log(
      `[Ptah Electron] DI verification: ${resolved}/${tokensToVerify.length} tokens resolved`
    );
  }

  // ========================================
  // PHASE 2.5: Setup RPC Handlers
  // ========================================
  // Register core RPC methods so the Angular frontend can communicate.
  // Full handler wiring (with IPC bridge) happens in Batch 4.
  setupRpcHandlers(container);

  // ========================================
  // PHASE 3: Load API Key from Secret Storage
  // ========================================
  // Load saved Anthropic API key and set in environment for Claude Agent SDK.
  try {
    const secretStorage = container.resolve<ISecretStorage>(
      PLATFORM_TOKENS.SECRET_STORAGE
    );
    const apiKey = await secretStorage.get('ptah.apiKey.anthropic');
    if (apiKey) {
      process.env['ANTHROPIC_API_KEY'] = apiKey;
      console.log('[Ptah Electron] API key loaded from secret storage');
    }
  } catch (error) {
    console.warn(
      '[Ptah Electron] Failed to load API key from secret storage:',
      error instanceof Error ? error.message : String(error)
    );
  }

  // ========================================
  // PHASE 4: Setup IPC Bridge + WebviewManager
  // ========================================
  // The IPC bridge connects ipcMain to the RpcHandler for renderer <-> main communication.
  // It must be initialized BEFORE loading the renderer so that IPC listeners are ready
  // when the Angular app boots and starts sending RPC calls.
  const ipcBridge = new IpcBridge(container, () => {
    const win = mainWindow;
    if (!win) return null;
    return {
      webContents: {
        send: (channel: string, ...args: unknown[]) =>
          win.webContents.send(channel, ...args),
      },
    };
  });
  ipcBridge.initialize();

  // Register WebviewManager adapter so that backend services (AgentSessionWatcherService,
  // RpcMethodRegistrationService, etc.) can push events to the renderer via IPC.
  const webviewManagerAdapter = new ElectronWebviewManagerAdapter(ipcBridge);
  container.register(TOKENS.WEBVIEW_MANAGER, {
    useValue: webviewManagerAdapter,
  });

  // ========================================
  // PHASE 4.5: Register Extended RPC Methods
  // ========================================
  // Now that WebviewManager is registered, add extended RPC methods
  // (session:load, autocomplete:*, setup-status:*, llm:*, plugins:*, etc.)
  registerExtendedRpcMethods(container);

  console.log(
    '[Ptah Electron] IPC bridge, WebviewManager, and RPC methods initialized'
  );

  // ========================================
  // PHASE 4.7: Application Menu
  // ========================================
  createApplicationMenu(container, () => mainWindow);

  // ========================================
  // PHASE 4.9: Resolve State Storage for Window Persistence
  // ========================================
  try {
    resolvedStateStorage = container.resolve<IStateStorage>(
      PLATFORM_TOKENS.STATE_STORAGE
    );
  } catch (error) {
    console.warn(
      '[Ptah Electron] Could not resolve STATE_STORAGE for window persistence:',
      error instanceof Error ? error.message : String(error)
    );
  }

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
        error instanceof Error ? error.message : String(error)
      );
    }
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
