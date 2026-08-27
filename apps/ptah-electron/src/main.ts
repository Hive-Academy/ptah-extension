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
  type DiagnosticsHandle,
} from '@ptah-extension/vscode-core';
import type { IStateStorage } from '@ptah-extension/platform-core';
import { PLATFORM_TOKENS } from '@ptah-extension/platform-core';
import type { ElectronWorkspaceProvider } from '@ptah-extension/platform-electron';
import { flushSessionMetadataStores } from '@ptah-extension/agent-sdk';
import { bootstrapElectron } from './activation/bootstrap';
import { wireRuntime } from './activation/wire-runtime';
import { registerPostWindow } from './activation/post-window';
import type { UpdateManager } from './services/update/update-manager';
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
  let mainWindow: BrowserWindow | null = null;
  let resolvedStateStorage: IStateStorage | undefined;
  let revalidationInterval: ReturnType<typeof setInterval> | null = null;
  let updateCheckInterval: ReturnType<typeof setInterval> | null = null;
  let gitWatcher: {
    stop: () => void;
    switchWorkspace: (p: string) => void;
  } | null = null;
  let flushWorkspacePersistence: (() => void) | null = null;
  let sentryFlushed = false;
  let sqliteConnection: { close: () => void } | null = null;
  let memoryCurator: { stop: () => void } | null = null;
  let memoryTrigger: { stop: () => void } | null = null;
  let skillSynthesis: { stop: () => void } | null = null;
  let skillTrigger: { stop: () => void } | null = null;
  let cronScheduler: { stop: () => void } | null = null;
  let messagingGateway: { stop: () => Promise<void> } | null = null;
  let chatBridge: { stop: () => void } | null = null;
  let updateManager: UpdateManager | null = null;
  let symbolWatcher: { close: () => void } | null = null;
  let statusBridgeDisposables: ReadonlyArray<{ dispose: () => void }> | null =
    null;
  let providerProxyPool: { disposeAll: () => Promise<void> } | null = null;
  let cliRegistry: { disposeAll: () => void } | null = null;
  let agentProcessManager: { disposeAll: () => Promise<void> } | null = null;
  let diagnostics: DiagnosticsHandle | null = null;
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
      providerProxyPool = boot.container.resolve<{
        disposeAll: () => Promise<void>;
      }>(AUTH_PROVIDERS_TOKENS.SDK_PROVIDER_PROXY_POOL);
    } catch (error: unknown) {
      console.warn(
        '[Ptah Electron] ProviderProxyPool resolve failed (non-fatal):',
        error instanceof Error ? error.message : String(error),
      );
      providerProxyPool = null;
    }

    app.on('before-quit', (event) => {
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
        } catch (error) {
          console.warn(
            '[Ptah Electron] before-quit Sentry flush failed (non-fatal):',
            error instanceof Error ? error.message : String(error),
          );
        }
      }
    });

    const wired = await wireRuntime({
      container: boot.container,
      getMainWindow: () => mainWindow,
      startupWorkspaceRoot: boot.startupWorkspaceRoot,
      logsPath: app.getPath('logs'),
    });
    resolvedStateStorage = wired.resolvedStateStorage;
    diagnostics = wired.refs.diagnostics;
    gitWatcher = wired.refs.gitWatcher;
    sqliteConnection = wired.refs.sqliteConnection;
    memoryCurator = wired.refs.memoryCurator;
    memoryTrigger = wired.refs.memoryTrigger;
    skillSynthesis = wired.refs.skillSynthesis;
    skillTrigger = wired.refs.skillTrigger;
    cronScheduler = wired.refs.cronScheduler;
    symbolWatcher = wired.refs.symbolWatcher;
    statusBridgeDisposables = wired.refs.statusBridgeDisposables;
    cliRegistry = wired.refs.cliRegistry;
    agentProcessManager = wired.refs.agentProcessManager;
    boot.gitWatcherRef.current = gitWatcher;

    const post = await registerPostWindow({
      container: boot.container,
      resolvedStateStorage,
      setMainWindow: (w) => {
        mainWindow = w;
      },
      getMainWindow: () => mainWindow,
      scheduleWarmup: wired.scheduleWarmup,
    });
    revalidationInterval = post.revalidationInterval;
    updateCheckInterval = post.updateCheckInterval;
    updateManager = post.updateManager;
    messagingGateway = post.messagingGateway;
    chatBridge = post.chatBridge;

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
      mainWindow = createMainWindow(resolvedStateStorage);
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
  app.on('will-quit', () => {
    flushWorkspacePersistence?.();
    // FIRST, and started rather than awaited: `will-quit` cannot block, and
    // the session metadata store coalesces a burst of writes into one update
    // at the end of its queue drain. Starting the flush before the disposals
    // gives the staged snapshot the whole teardown window to reach storage —
    // without it nothing ever called `flush()` and a CLI agent that exited in
    // the final seconds lost its reference (TASK_2026_324 finding 3).
    try {
      void flushSessionMetadataStores();
    } catch (error) {
      console.warn(
        '[Ptah Electron] Session metadata flush failed (non-fatal):',
        error instanceof Error ? error.message : String(error),
      );
    }
    try {
      void providerProxyPool?.disposeAll();
    } catch (error) {
      console.warn(
        '[Ptah Electron] ProviderProxyPool disposeAll failed (non-fatal):',
        error instanceof Error ? error.message : String(error),
      );
    }
    if (revalidationInterval !== null) {
      clearInterval(revalidationInterval);
      revalidationInterval = null;
    }
    if (updateCheckInterval !== null) {
      clearInterval(updateCheckInterval);
      updateCheckInterval = null;
    }
    try {
      updateManager?.dispose();
    } catch (error) {
      console.warn(
        '[Ptah Electron] UpdateManager dispose failed:',
        error instanceof Error ? error.message : String(error),
      );
    }
    gitWatcher?.stop();
    try {
      symbolWatcher?.close();
    } catch (error) {
      console.warn(
        '[Ptah Electron] Symbol watcher close failed (non-fatal):',
        error instanceof Error ? error.message : String(error),
      );
    }
    try {
      statusBridgeDisposables?.forEach((d) => d.dispose());
    } catch (error) {
      console.warn(
        '[Ptah Electron] Status bridge dispose failed (non-fatal):',
        error instanceof Error ? error.message : String(error),
      );
    }
    // No harness teardown. `{ws}/.claude/{skills,commands}` are workspace
    // artifacts, not host-process resources: `ptah tui`, the headless CLI, the
    // gateway and a plain `claude` invocation all read them without ever
    // running this app. Removing them on quit is the defect TASK_2026_278
    // exists to close.
    try {
      skillTrigger?.stop();
    } catch (error) {
      console.warn(
        '[Ptah Electron] Skill trigger stop failed (non-fatal):',
        error instanceof Error ? error.message : String(error),
      );
    }
    try {
      skillSynthesis?.stop();
    } catch (error) {
      console.warn(
        '[Ptah Electron] Skill synthesis stop failed (non-fatal):',
        error instanceof Error ? error.message : String(error),
      );
    }
    try {
      cronScheduler?.stop();
    } catch (error) {
      console.warn(
        '[Ptah Electron] Cron scheduler stop failed (non-fatal):',
        error instanceof Error ? error.message : String(error),
      );
    }
    try {
      memoryTrigger?.stop();
    } catch (error) {
      console.warn(
        '[Ptah Electron] Memory trigger stop failed (non-fatal):',
        error instanceof Error ? error.message : String(error),
      );
    }
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
    try {
      chatBridge?.stop();
    } catch (error) {
      console.warn(
        '[Ptah Electron] Gateway chat bridge stop failed (non-fatal):',
        error instanceof Error ? error.message : String(error),
      );
    }
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

    const diContainer = ElectronDIContainer.getContainer();
    // Terminate the voice utilityProcess worker (kills the child + idle timer).
    try {
      if (diContainer.isRegistered(VOICE_TOKENS.VOICE_WORKER_CLIENT)) {
        diContainer
          .resolve<{ dispose: () => void }>(VOICE_TOKENS.VOICE_WORKER_CLIENT)
          .dispose();
      }
    } catch (error) {
      console.warn(
        '[Ptah Electron] Voice worker dispose failed (non-fatal):',
        error instanceof Error ? error.message : String(error),
      );
    }
    // Agents BEFORE their translation proxies: the proxy exists to serve a live
    // agent process, so stopping it first would leave the process alive and
    // talking to a closed socket. Each release issues an abort and a tree-kill
    // synchronously and only the settle is awaited, so the fire-and-forget shape
    // (`will-quit` cannot block) still reaps — without this the desktop app left
    // every completed CLI agent's process resident, which is how 16 idle
    // `claude.exe` reached 99% of machine memory (TASK_2026_323 B11).
    try {
      void agentProcessManager?.disposeAll().catch((error) => {
        console.warn(
          '[Ptah Electron] Agent process disposal failed (non-fatal):',
          error instanceof Error ? error.message : String(error),
        );
      });
    } catch (error) {
      console.warn(
        '[Ptah Electron] Agent process disposal threw synchronously (non-fatal):',
        error instanceof Error ? error.message : String(error),
      );
    }
    // Dispose the Ptah CLI registry ONLY if it was actually instantiated during
    // the app's lifetime (captured as a ref in wireRuntime). Resolving it from
    // the container here would force first-time construction of its dependency
    // graph mid-teardown, which races with the DI/subsystem shutdown and can
    // hang or throw (see auto-updater e2e: production + blocked network). When
    // the registry was never used there are no per-agent proxies to stop.
    try {
      cliRegistry?.disposeAll();
    } catch (error) {
      console.warn(
        '[Ptah Electron] CLI registry dispose failed (non-fatal):',
        error instanceof Error ? error.message : String(error),
      );
    }
    // LAST, mirroring its position as the FIRST thing armed in wireRuntime.
    // Beyond LIFO correctness this keeps lag warnings coming during teardown —
    // a quit that hangs is a real failure mode, and the sampler is exactly the
    // instrument that would name the subsystem refusing to stop.
    try {
      diagnostics?.dispose();
    } catch (error) {
      console.warn(
        '[Ptah Electron] Diagnostics dispose failed (non-fatal):',
        error instanceof Error ? error.message : String(error),
      );
    }
  });
} // end of gotLock guard
