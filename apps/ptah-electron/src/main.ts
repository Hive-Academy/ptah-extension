import 'reflect-metadata';

import { app, BrowserWindow } from 'electron';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { createMainWindow } from './windows/main-window';
import { ElectronDIContainer } from './di/container';
import { VOICE_TOKENS } from '@ptah-extension/voice-providers';
import { AUTH_PROVIDERS_TOKENS } from '@ptah-extension/auth-providers';
import {
  TOKENS,
  type Logger,
  type SentryService,
} from '@ptah-extension/vscode-core';
import { PLATFORM_TOKENS } from '@ptah-extension/platform-core';
import type { ElectronWorkspaceProvider } from '@ptah-extension/platform-electron';
import { flushSessionMetadataStores } from '@ptah-extension/agent-sdk';
import { bootstrapElectron } from './activation/bootstrap';
import { BootCoordinator } from './activation/boot-coordinator';
import { wireRuntimePreWindow } from './activation/wire-runtime';
import { registerPostWindow } from './activation/post-window';
import { handleWillQuit } from './activation/shutdown';
import {
  PtahTrayService,
  handleWindowAllClosed,
  PTAH_CONFIG_SECTION,
  TRAY_KEEPALIVE_KEY,
} from './services/tray/tray.service';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isDev = process.env['NODE_ENV'] === 'development';
app.setName(isDev ? 'Ptah Dev' : 'Ptah');
if (isDev) {
  app.setPath('userData', path.join(app.getPath('appData'), 'Ptah Dev'));
}
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  /**
   * ONE reference for every long-lived boot handle (TASK_2026_331 B1.T6).
   *
   * This used to be fifteen nullable variables, each copied once out of
   * `wireRuntime`'s refs or `registerPostWindow`'s result. That shape was only
   * correct while every service existed before this callback returned. The
   * heavy boot now runs behind the window, so services arrive AFTER the copies
   * would have been taken — `coordinator.refs` is a stable object the boot
   * writes into and `will-quit` reads from, which is what makes a late arrival
   * still disposable.
   */
  const coordinator = new BootCoordinator();

  // Not boot refs: the window itself, the tray, and the two intervals whose
  // handles `registerPostWindow` returns rather than storing.
  let mainWindow: BrowserWindow | null = null;
  let revalidationInterval: ReturnType<typeof setInterval> | null = null;
  let updateCheckInterval: ReturnType<typeof setInterval> | null = null;
  let flushWorkspacePersistence: (() => void) | null = null;
  let sentryFlushed = false;
  let quitSequenceStarted = false;
  // C5 (TASK_2026_180) — stays `null` unless `skillSynthesis.trayKeepalive` is
  // explicitly on AND the tray actually constructed. Nothing else may suppress
  // the quit (R10).
  let trayService: PtahTrayService | null = null;

  app.whenReady().then(async () => {
    const boot = await bootstrapElectron(() => mainWindow);
    flushWorkspacePersistence = boot.flushWorkspacePersistence;

    // Phase 3: capture the per-workspace isolated provider-proxy pool so its
    // proxy servers are torn down on app quit (per-workspace teardown runs on
    // workspace:removeFolder; this is the shutdown-wide backstop).
    try {
      coordinator.refs.providerProxyPool = boot.container.resolve<{
        disposeAll: () => Promise<void>;
      }>(AUTH_PROVIDERS_TOKENS.SDK_PROVIDER_PROXY_POOL);
    } catch (error: unknown) {
      console.warn(
        '[Ptah Electron] ProviderProxyPool resolve failed (non-fatal):',
        error instanceof Error ? error.message : String(error),
      );
      coordinator.refs.providerProxyPool = null;
    }

    app.on('before-quit', (event) => {
      try {
        const workspaceProvider =
          boot.container.resolve<ElectronWorkspaceProvider>(
            PLATFORM_TOKENS.WORKSPACE_PROVIDER,
          );
        workspaceProvider.fileSettings.flushSync();
      } catch (error: unknown) {
        console.warn(
          '[Ptah Electron] before-quit fileSettings flush failed (non-fatal):',
          error instanceof Error ? error.message : String(error),
        );
      }

      // Flush buffered Sentry events before the process exits, otherwise crash
      // reports captured moments before quit are lost. flush() no-ops when
      // Sentry was never initialized (dev / no DSN), and we only delay quit
      // when it is actually initialized — so dev quit behaviour is unchanged.
      // The guard prevents re-delaying the quit re-emitted by app.quit() below.
      if (!sentryFlushed) {
        sentryFlushed = true;
        try {
          const sentryService = boot.container.resolve<SentryService>(
            TOKENS.SENTRY_SERVICE,
          );
          if (sentryService.isInitialized()) {
            event.preventDefault();
            void sentryService
              .flush(2000)
              .catch(() => undefined)
              .finally(() => app.quit());
          }
        } catch (error: unknown) {
          console.warn(
            '[Ptah Electron] before-quit Sentry flush failed (non-fatal):',
            error instanceof Error ? error.message : String(error),
          );
        }
      }
    });

    // PRE-WINDOW: diagnostics, the RPC surface and MCP bring-up. Everything the
    // renderer needs to exist the moment it loads, and nothing else.
    const wired = await wireRuntimePreWindow({
      container: boot.container,
      getMainWindow: () => mainWindow,
      startupWorkspaceRoot: boot.startupWorkspaceRoot,
      coordinator,
      logsPath: app.getPath('logs'),
    });

    // THE WINDOW. Everything above this line is on the critical path; nothing
    // below it is.
    const post = await registerPostWindow({
      container: boot.container,
      resolvedStateStorage: wired.resolvedStateStorage,
      setMainWindow: (w) => {
        mainWindow = w;
      },
      getMainWindow: () => mainWindow,
      coordinator,
    });
    revalidationInterval = post.revalidationInterval;
    updateCheckInterval = post.updateCheckInterval;

    // POST-WINDOW: SQLite, memory, skills, harness reconcile, session import.
    // Started rather than awaited — the coordinator owns the promise, catches
    // every rejection and lets `will-quit` abort it.
    coordinator.startPostWindow(async () => {
      await wired.postWindow();
      boot.gitWatcherRef.current = coordinator.refs.gitWatcher;
    });

    // C5 (TASK_2026_180) — tray keep-alive, purely additive. The tray is built
    // ONLY when `skillSynthesis.trayKeepalive` is explicitly on; it ships
    // `false`, so by default no tray exists and `window-all-closed` behaves
    // exactly as it did before this commit. Every failure path leaves
    // `trayService` null, which means "no keep-alive" — never "keep-alive with
    // no way to quit" (R10).
    try {
      const workspaceProvider =
        boot.container.resolve<ElectronWorkspaceProvider>(
          PLATFORM_TOKENS.WORKSPACE_PROVIDER,
        );
      const keepAlive = workspaceProvider.getConfiguration<boolean>(
        PTAH_CONFIG_SECTION,
        TRAY_KEEPALIVE_KEY,
        false,
      );
      if (keepAlive === true) {
        trayService = PtahTrayService.create({
          workspace: workspaceProvider,
          iconPath: path.join(__dirname, 'assets', 'icons', 'png', '32x32.png'),
          quit: () => app.quit(),
          logger: boot.container.resolve<Logger>(TOKENS.LOGGER),
        });
      }
    } catch (error: unknown) {
      console.warn(
        '[Ptah Electron] Tray keep-alive setup failed (non-fatal):',
        error instanceof Error ? error.message : String(error),
      );
      trayService = null;
    }
  });
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = createMainWindow(
        coordinator.refs.resolvedStateStorage ?? undefined,
      );
      const rendererPath = path.join(__dirname, 'renderer', 'index.html');
      mainWindow.loadFile(rendererPath);
    }
  });
  // Branch-free delegation: the decision lives in `handleWindowAllClosed` so it
  // can be asserted (this file uses `import.meta` and is not importable under
  // ts-jest). With no live tray — the shipped default — it is `if
  // (process.platform !== 'darwin') app.quit();` and nothing else. Pinned by
  // `main.quit-path.spec.ts`.
  app.on('window-all-closed', () => {
    handleWindowAllClosed({
      platform: process.platform,
      quit: () => app.quit(),
      hasLiveTray: () => trayService?.isLive() ?? false,
    });
  });
  // Branch-free delegation, for the same reason: the LIFO disposal order is a
  // real contract and lives in `handleWillQuit` where a spec can assert it.
  // The guard exists because a DEFERRED quit calls `app.quit()` again once the
  // aborted boot has drained, which re-emits this event.
  app.on('will-quit', (event) => {
    if (quitSequenceStarted) return;
    quitSequenceStarted = true;
    handleWillQuit({
      refs: coordinator.refs,
      abortBoot: () => coordinator.abort(),
      isBootRunning: () => coordinator.isRunning,
      awaitBootCompletion: (timeoutMs) =>
        coordinator.awaitCompletion(timeoutMs),
      flushWorkspacePersistence: () => flushWorkspacePersistence?.(),
      flushSessionMetadataStores: () => {
        void flushSessionMetadataStores();
      },
      clearTimers: () => {
        if (revalidationInterval !== null) {
          clearInterval(revalidationInterval);
          revalidationInterval = null;
        }
        if (updateCheckInterval !== null) {
          clearInterval(updateCheckInterval);
          updateCheckInterval = null;
        }
      },
      disposeVoiceWorker: () => {
        const diContainer = ElectronDIContainer.getContainer();
        if (diContainer.isRegistered(VOICE_TOKENS.VOICE_WORKER_CLIENT)) {
          diContainer
            .resolve<{ dispose: () => void }>(VOICE_TOKENS.VOICE_WORKER_CLIENT)
            .dispose();
        }
      },
      deferQuit: () => event.preventDefault(),
      quit: () => app.quit(),
    });
  });
} // end of gotLock guard
