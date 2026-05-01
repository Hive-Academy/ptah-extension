// CRITICAL: reflect-metadata MUST be imported first for TSyringe to work
import 'reflect-metadata';

import { app, BrowserWindow } from 'electron';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { createMainWindow } from './windows/main-window';
import { ElectronDIContainer } from './di/container';
import { SDK_TOKENS } from '@ptah-extension/agent-sdk';
import type { IStateStorage } from '@ptah-extension/platform-core';
import { bootstrapElectron } from './activation/bootstrap';
import { wireRuntime } from './activation/wire-runtime';
import { registerPostWindow } from './activation/post-window';

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
  let gitWatcher: {
    stop: () => void;
    switchWorkspace: (p: string) => void;
  } | null = null;
  let flushWorkspacePersistence: (() => void) | null = null;

  app.whenReady().then(async () => {
    const boot = await bootstrapElectron(() => mainWindow);
    flushWorkspacePersistence = boot.flushWorkspacePersistence;

    const wired = await wireRuntime({
      container: boot.container,
      getMainWindow: () => mainWindow,
      startupWorkspaceRoot: boot.startupWorkspaceRoot,
      startupLicenseTier: boot.startupLicenseTier,
    });
    resolvedStateStorage = wired.resolvedStateStorage;
    skillJunctionRef = wired.skillJunctionRef;
    gitWatcher = wired.gitWatcher;
    // Back-fill the mutable ref so bootstrap's onDidChangeWorkspaceFolders
    // subscription can call gitWatcher.switchWorkspace on folder changes.
    boot.gitWatcherRef.current = gitWatcher;

    const post = await registerPostWindow({
      container: boot.container,
      resolvedStateStorage,
      startupIsLicensed: boot.startupIsLicensed,
      startupInitialView: boot.startupInitialView,
      startupWorkspaceRoot: boot.startupWorkspaceRoot,
      setMainWindow: (w) => {
        mainWindow = w;
      },
      getMainWindow: () => mainWindow,
    });
    revalidationInterval = post.revalidationInterval;
  });

  // Handle second instance (focus existing window).
  // Registered at top level so the handler is bound synchronously from
  // app start — safe because mainWindow is null until Phase 5 and the
  // body is null-guarded.
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
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

  // Clean up skill junctions and license revalidation on app quit (TASK_2025_214, TASK_2025_240).
  // deactivateSync() removes all managed junctions/symlinks and unsubscribes
  // from workspace folder changes. Must be synchronous (will-quit is sync).
  // Disposal order preserved LIFO per design section E.5.
  app.on('will-quit', () => {
    // 1. Flush any pending debounced workspace persistence synchronously.
    // Without this, removing a folder and quitting within the 500ms debounce
    // window would lose the change — the removed folder reappears on restart.
    flushWorkspacePersistence?.();

    // 2. Clear license revalidation interval (TASK_2025_240)
    if (revalidationInterval !== null) {
      clearInterval(revalidationInterval);
      revalidationInterval = null;
    }

    // 3. Stop git file system watcher (TASK_2025_240)
    gitWatcher?.stop();

    // 4. Deactivate skill junctions
    try {
      skillJunctionRef?.deactivateSync();
    } catch (error) {
      console.warn(
        '[Ptah Electron] Skill junction cleanup failed (non-fatal):',
        error instanceof Error ? error.message : String(error),
      );
    }

    // 5. Dispose PtahCliRegistry CLI adapters (TASK_2025_243)
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
