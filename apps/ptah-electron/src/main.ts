// CRITICAL: reflect-metadata MUST be imported first for TSyringe to work
import 'reflect-metadata';

import { app, BrowserWindow } from 'electron';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { createMainWindow } from './windows/main-window';
import { ElectronDIContainer } from './di/container';
import { SDK_TOKENS } from '@ptah-extension/agent-sdk';
import type { IStateStorage } from '@ptah-extension/platform-core';
import { PLATFORM_TOKENS } from '@ptah-extension/platform-core';
import type { ElectronWorkspaceProvider } from '@ptah-extension/platform-electron';
import { bootstrapElectron } from './activation/bootstrap';
import { wireRuntime } from './activation/wire-runtime';
import { registerPostWindow } from './activation/post-window';
import type { UpdateManager } from './services/update/update-manager';
import { UPDATE_MANAGER_TOKEN } from './services/update/update-tokens';

// @ts-expect-error import.meta.url is valid in ESM bundle output; TS flags it because tsconfig targets CJS
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Force userData path to be stable across dev and packaged builds
app.setName('Ptah');

// Prevent multiple instances
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  let mainWindow: BrowserWindow | null = null;
  let resolvedStateStorage: IStateStorage | undefined;
  let skillJunctionRef: { deactivateSync: () => void } | null = null;
  let revalidationInterval: ReturnType<typeof setInterval> | null = null;
  let updateCheckInterval: ReturnType<typeof setInterval> | null = null;
  let gitWatcher: {
    stop: () => void;
    switchWorkspace: (p: string) => void;
  } | null = null;
  let flushWorkspacePersistence: (() => void) | null = null;
  let sqliteConnection: { close: () => void } | null = null;
  let memoryCurator: { stop: () => void } | null = null;
  let skillSynthesis: { stop: () => void } | null = null;
  let cronScheduler: { stop: () => void } | null = null;
  let messagingGateway: { stop: () => Promise<void> } | null = null;
  let symbolWatcher: { close: () => void } | null = null;

  app.whenReady().then(async () => {
    const boot = await bootstrapElectron(() => mainWindow);
    flushWorkspacePersistence = boot.flushWorkspacePersistence;

    app.on('before-quit', () => {
      try {
        const workspaceProvider =
          boot.container.resolve<ElectronWorkspaceProvider>(
            PLATFORM_TOKENS.WORKSPACE_PROVIDER,
          );
        workspaceProvider.fileSettings.flushSync();
      } catch (error) {
        console.warn(
          '[Ptah Electron] before-quit fileSettings flush failed (non-fatal):',
          error instanceof Error ? error.message : String(error),
        );
      }
    });

    const wired = await wireRuntime({
      container: boot.container,
      getMainWindow: () => mainWindow,
      startupWorkspaceRoot: boot.startupWorkspaceRoot,
      startupLicenseTier: boot.startupLicenseTier,
    });
    resolvedStateStorage = wired.resolvedStateStorage;
    skillJunctionRef = wired.refs.skillJunctionRef;
    gitWatcher = wired.refs.gitWatcher;
    sqliteConnection = wired.refs.sqliteConnection;
    memoryCurator = wired.refs.memoryCurator;
    skillSynthesis = wired.refs.skillSynthesis;
    cronScheduler = wired.refs.cronScheduler;
    symbolWatcher = wired.refs.symbolWatcher;
    // Back-fill the mutable ref so bootstrap's onDidChangeWorkspaceFolders
    // subscription can call gitWatcher.switchWorkspace on folder changes.
    boot.gitWatcherRef.current = gitWatcher;

    const post = await registerPostWindow({
      container: boot.container,
      resolvedStateStorage,
      startupIsLicensed: boot.startupIsLicensed,
      startupInitialView: boot.startupInitialView,
      setMainWindow: (w) => {
        mainWindow = w;
      },
      getMainWindow: () => mainWindow,
      scheduleWarmup: wired.scheduleWarmup,
    });
    revalidationInterval = post.revalidationInterval;
    updateCheckInterval = post.updateCheckInterval;
    messagingGateway = post.messagingGateway;
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

    // 2.5. Clear update check interval + dispose UpdateManager (TASK_2026_117)
    if (updateCheckInterval !== null) {
      clearInterval(updateCheckInterval);
      updateCheckInterval = null;
    }
    try {
      const diContainer = ElectronDIContainer.getContainer();
      if (diContainer.isRegistered(UPDATE_MANAGER_TOKEN)) {
        const updateManager =
          diContainer.resolve<UpdateManager>(UPDATE_MANAGER_TOKEN);
        updateManager.dispose();
      }
    } catch (error) {
      console.warn(
        '[Ptah Electron] UpdateManager dispose failed:',
        error instanceof Error ? error.message : String(error),
      );
    }

    // 3. Stop git file system watcher (TASK_2025_240)
    gitWatcher?.stop();

    // 3.1. Close code symbol chokidar watcher (TASK_2026_THOTH_CODE_INDEX)
    try {
      symbolWatcher?.close();
    } catch (error) {
      console.warn(
        '[Ptah Electron] Symbol watcher close failed (non-fatal):',
        error instanceof Error ? error.message : String(error),
      );
    }

    // 4. Deactivate skill junctions
    try {
      skillJunctionRef?.deactivateSync();
    } catch (error) {
      console.warn(
        '[Ptah Electron] Skill junction cleanup failed (non-fatal):',
        error instanceof Error ? error.message : String(error),
      );
    }

    // 4.5. Stop skill synthesis service (TASK_2026_HERMES Track 2).
    // Currently a no-op (the synthesis service holds no long-lived
    // resources of its own — the SQLite handle is owned by
    // persistence-sqlite and disposed by its own lifecycle), but we
    // call stop() to honour the start()/stop() contract and reserve a
    // hook for future flushing.
    try {
      skillSynthesis?.stop();
    } catch (error) {
      console.warn(
        '[Ptah Electron] Skill synthesis stop failed (non-fatal):',
        error instanceof Error ? error.message : String(error),
      );
    }

    // 4.53. Stop cron scheduler (TASK_2026_HERMES Track 3).
    // Stops croner timers and disposes the IPowerMonitor listener. Must run
    // BEFORE sqliteConnection.close() because in-flight job runs write to
    // SQLite (cron_runs table). Synchronous — croner.stop() is sync, and
    // any active runner promises will resolve against an already-closed
    // connection harmlessly.
    try {
      cronScheduler?.stop();
    } catch (error) {
      console.warn(
        '[Ptah Electron] Cron scheduler stop failed (non-fatal):',
        error instanceof Error ? error.message : String(error),
      );
    }

    // 4.55. Stop memory curator + close SQLite (TASK_2026_HERMES Track 1).
    // Order: stop curator first (unsubscribes from PreCompact registry),
    // THEN close SQLite (so any in-flight write started by stop() finishes
    // before the connection goes away). Both are synchronous to fit in
    // will-quit; the embedder worker is reaped by node:worker_threads on
    // process exit (its IEmbedder.dispose is async and we cannot await).
    try {
      memoryCurator?.stop();
    } catch (error) {
      console.warn(
        '[Ptah Electron] Memory curator stop failed (non-fatal):',
        error instanceof Error ? error.message : String(error),
      );
    }
    try {
      sqliteConnection?.close();
    } catch (error) {
      console.warn(
        '[Ptah Electron] SQLite close failed (non-fatal):',
        error instanceof Error ? error.message : String(error),
      );
    }

    // 4.6. Stop messaging gateway adapters (TASK_2026_HERMES Track 4).
    // Fire-and-forget: each adapter's stop() may await a graceful
    // disconnect (Telegram bot polling, Discord WebSocket close, Slack
    // Socket Mode close). will-quit is synchronous so we cannot await,
    // but the OS will reap any in-flight network sockets when the
    // process exits.
    try {
      messagingGateway?.stop().catch((error) => {
        console.warn(
          '[Ptah Electron] Messaging gateway stop failed (non-fatal):',
          error instanceof Error ? error.message : String(error),
        );
      });
    } catch (error) {
      console.warn(
        '[Ptah Electron] Messaging gateway stop threw synchronously (non-fatal):',
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
