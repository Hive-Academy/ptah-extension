// CRITICAL: reflect-metadata MUST be imported first for TSyringe to work
import 'reflect-metadata';

import { app, BrowserWindow, safeStorage, dialog } from 'electron';
import * as path from 'path';
import { createMainWindow } from './windows/main-window';
import { ElectronDIContainer } from './di/container';
import { setupRpcHandlers } from './services/rpc/rpc-handler-setup';
import type { ElectronPlatformOptions } from '@ptah-extension/platform-electron';
import { PLATFORM_TOKENS } from '@ptah-extension/platform-core';
import type { ISecretStorage } from '@ptah-extension/platform-core';

// Prevent multiple instances
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
}

let mainWindow: BrowserWindow | null = null;

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
        dialog.showMessageBox(win, options),
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
    initialFolders,
  };

  const container = ElectronDIContainer.setup(platformOptions);

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
  // PHASE 4: Setup IPC Bridge
  // ========================================
  // IPC bridge will be wired in Batch 4.
  // It connects ipcMain to the RpcHandler for renderer <-> main process communication.

  // ========================================
  // PHASE 5: Create BrowserWindow + Load Renderer
  // ========================================
  mainWindow = createMainWindow();

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
});

// macOS: re-create window when dock icon is clicked
app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    mainWindow = createMainWindow();
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
