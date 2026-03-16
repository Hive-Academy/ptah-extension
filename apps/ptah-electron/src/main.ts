// CRITICAL: reflect-metadata MUST be imported first for TSyringe to work
import 'reflect-metadata';

import { app, BrowserWindow } from 'electron';
import * as path from 'path';
import { createMainWindow } from './windows/main-window';

// Prevent multiple instances
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
}

let mainWindow: BrowserWindow | null = null;

app.whenReady().then(async () => {
  // ========================================
  // PHASE 1: Create BrowserWindow
  // ========================================
  mainWindow = createMainWindow();

  // Handle second instance (focus existing window)
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  // ========================================
  // PHASE 2: Initialize DI Container
  // ========================================
  // DI container setup will be wired in Batch 3.
  // Parse command-line args for initial workspace folder
  const workspacePath = process.argv.find(
    (arg) =>
      !arg.startsWith('-') && arg !== process.argv[0] && arg !== process.argv[1]
  );
  if (workspacePath) {
    console.log(
      `[Ptah Electron] Workspace path: ${path.resolve(workspacePath)}`
    );
  }

  // ========================================
  // PHASE 3: Setup IPC Bridge
  // ========================================
  // IPC bridge will be wired in Batch 4.

  // ========================================
  // PHASE 4: Load API Key from Secret Storage
  // ========================================
  // API key loading will be wired in Batch 5.

  // ========================================
  // PHASE 5: Load Renderer
  // ========================================
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
