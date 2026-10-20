import {
  app,
  BrowserWindow,
  safeStorage,
  dialog,
  ipcMain,
  shell,
  clipboard,
  Notification,
} from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import type { DependencyContainer } from 'tsyringe';
import type { ElectronPlatformOptions } from '@ptah-extension/platform-electron';
import { registerElectronSettings } from '@ptah-extension/platform-electron';
import { PLATFORM_TOKENS } from '@ptah-extension/platform-core';
import type {
  IWorkspaceProvider,
  IWorkspaceLifecycleProvider,
} from '@ptah-extension/platform-core';
import {
  TOKENS,
  SentryService,
  type Logger,
  type WorkspaceAwareStateStorage,
} from '@ptah-extension/vscode-core';
import {
  SETTINGS_TOKENS,
  type CustomProviderStore,
  type MigrationRunner,
  type IActiveWorkspaceSource,
} from '@ptah-extension/settings-core';
import { fixPath } from '@ptah-extension/cli-agent-runtime';
import {
  activateSessionLifecycleNotifier,
  runCursorApiKeyMigration,
} from '@ptah-extension/rpc-handlers';
import { ElectronDIContainer } from '../di/container';
import { restoreWorkspaces } from './workspace-restore';
import { resolveInitialWorkspaceArg } from './initial-workspace-arg';
import { runSessionStoreMigration } from './session-store-migration';
import { IpcBridge } from '../ipc/ipc-bridge';
import { ElectronWebviewManagerAdapter } from '../ipc/webview-manager-adapter';
import { SDK_TOKENS } from '@ptah-extension/agent-sdk';
import type { IHostAttentionIngress } from '@ptah-extension/platform-core';
import { MESSAGE_TYPES } from '@ptah-extension/shared';
import { ElectronBootReadinessProvider } from '../services/platform/electron-boot-readiness';
import type { BootCoordinator } from './boot-coordinator';
import { bootStep } from './boot-trace';

export interface BootstrapResult {
  container: DependencyContainer;
  startupWorkspaceRoot: string | undefined;
  initialFolders: string[] | undefined;
  flushWorkspacePersistence: (() => void) | null;
  /** Mutable ref box so the workspace-change subscription can pick up the
   * gitWatcher created later in wireRuntime Phase 4.8. */
  gitWatcherRef: {
    current: { stop: () => void; switchWorkspace: (p: string) => void } | null;
  };
}

/**
 * Publish user-defined providers to the shared registry cache. Runs BEFORE
 * anything resolves a provider by id — until it runs, getAnthropicProvider()
 * knows only the built-ins. Non-fatal and independent of the settings
 * migrations' outcome (TASK_2026_555 Batch 2b): a failure is logged and the
 * app continues with the built-in providers.
 */
export function loadCustomProviders(container: DependencyContainer): void {
  try {
    const customProviders = container.resolve<CustomProviderStore>(
      SETTINGS_TOKENS.CUSTOM_PROVIDER_STORE,
    );
    const { entries, dropped } = customProviders.load();
    if (dropped.length > 0) {
      console.warn(
        `[Ptah Electron] Dropped ${dropped.length} malformed custom provider entr${
          dropped.length === 1 ? 'y' : 'ies'
        }`,
      );
    }
    console.log(
      `[Ptah Electron] Custom providers published (${entries.length} custom providers)`,
    );
  } catch (loadError: unknown) {
    console.warn(
      '[Ptah Electron] Custom provider load failed (non-fatal); only built-in providers are available:',
      loadError instanceof Error ? loadError.message : String(loadError),
    );
  }
}

/**
 * Prime the membership/licence cache for the membership card.
 *
 * NETWORK, and deliberately not on the critical path (TASK_2026_331 B1.T2).
 * This is identity only — it never gates activation or the initial view, and
 * Ptah's local features are available to everyone — so awaiting it put a
 * round-trip (and, on a blocked network, a full request timeout) between the
 * user's click and the window. The renderer renders the membership card from
 * the cache whenever it lands; until then it shows the unresolved state it
 * already had to handle for an offline start.
 *
 * Never rejects: the caller starts it with `void` and has nowhere to put a
 * rejection.
 *
 * `skip` is set from `PTAH_E2E=1`: a harness boot has no licence to prime, and
 * the specs that read licence state call `license:getStatus`, which runs its
 * own `verifyLicense()` (TASK_2026_389).
 */
export async function startMembershipVerification(
  container: DependencyContainer,
  options: { skip?: boolean } = {},
): Promise<void> {
  if (options.skip === true) {
    console.log(
      '[Ptah Electron] Membership status priming skipped — e2e harness (PTAH_E2E=1)',
    );
    return;
  }
  try {
    const licenseService = container.resolve(TOKENS.LICENSE_SERVICE) as {
      verifyLicense: () => Promise<{
        valid: boolean;
        reason?: string;
        tier?: string;
      }>;
    };
    const licenseStatus = await licenseService.verifyLicense();
    console.log(
      `[Ptah Electron] Membership status resolved (valid: ${licenseStatus.valid}, tier: ${licenseStatus.tier ?? 'none'})`,
    );
  } catch (error: unknown) {
    console.warn(
      '[Ptah Electron] Membership status resolution failed (non-fatal):',
      error instanceof Error ? error.message : String(error),
    );
  }
}

/**
 * Initialize the agent adapters and, on success, preload the SDK.
 *
 * NETWORK, and deliberately not on the critical path (TASK_2026_331 B1.T2).
 * Failure was already non-fatal; the only change is that the boot no longer
 * WAITS for it. The renderer shows "not configured" until it completes, which
 * is the exact state it already showed when `initialize()` resolved `false`.
 *
 * Never rejects, for the same reason as
 * {@link startMembershipVerification}.
 */
export async function startAgentAdapterInitialization(
  container: DependencyContainer,
): Promise<void> {
  try {
    const agentAdapter = container.resolve(TOKENS.AGENT_ADAPTER) as {
      initialize: () => Promise<boolean>;
      preloadSdk: () => Promise<void>;
    };
    const authInitialized = await agentAdapter.initialize();

    if (authInitialized) {
      console.log('[Ptah Electron] Agent adapters initialized successfully');
      agentAdapter.preloadSdk().catch((err: unknown) => {
        console.warn(
          '[Ptah Electron] SDK preload failed (will retry on first use):',
          err instanceof Error ? err.message : String(err),
        );
      });
    } else {
      console.log(
        '[Ptah Electron] SDK auth not configured — users can configure in Settings',
      );
    }
  } catch (error: unknown) {
    console.warn(
      '[Ptah Electron] Agent adapter initialization failed (non-fatal):',
      error instanceof Error ? error.message : String(error),
    );
  }
}

/** Keep the bridge's renderer handle tied to the native window's lifetime. */
export function createMainWindowHandleGetter(
  getMainWindow: () =>
    | (Pick<BrowserWindow, 'isDestroyed'> & {
        webContents: Pick<BrowserWindow['webContents'], 'send' | 'isDestroyed'>;
      })
    | null,
): ConstructorParameters<typeof IpcBridge>[1] {
  return () => {
    const win = getMainWindow();
    if (!win || win.isDestroyed()) return null;
    return {
      webContents: {
        send: (channel: string, ...args: unknown[]) =>
          win.webContents.send(channel, ...args),
        isDestroyed: () => win.isDestroyed() || win.webContents.isDestroyed(),
      },
    };
  };
}

/** The chat attention handler's snapshot request proves Angular has registered its message handler. */
export function createAttentionRendererReadiness(
  currentContents: () => { on(event: 'did-start-loading', listener: () => void): void } | null,
  subscribeRpc: (listener: (sender: object, message: unknown) => void) => void,
): { isReady(): boolean; onReady(listener: () => void): boolean } {
  const ready = new WeakSet<object>();
  const tracked = new WeakSet<object>();
  const listeners = new Set<() => void>();
  const current = () => {
    const contents = currentContents();
    if (contents && !tracked.has(contents)) {
      tracked.add(contents);
      contents.on('did-start-loading', () => ready.delete(contents));
    }
    return contents;
  };
  subscribeRpc((sender, message) => {
    const contents = current();
    if (!contents || sender !== contents || !message || typeof message !== 'object') return;
    const rpc = message as { type?: unknown; payload?: unknown };
    if (rpc.type !== MESSAGE_TYPES.RPC_CALL || !rpc.payload || typeof rpc.payload !== 'object') return;
    if ((rpc.payload as { method?: unknown }).method !== 'attention:getSnapshot') return;
    ready.add(contents);
    for (const listener of listeners) listener();
    listeners.clear();
  });
  return {
    isReady: () => { const contents = current(); return !!contents && ready.has(contents); },
    onReady: (listener) => { if (!current()) return false; listeners.add(listener); return true; },
  };
}

export function attachElectronHostAttention(
  resolve: () => IHostAttentionIngress,
  attach: (observer: IHostAttentionIngress) => void,
  warn: (message: string) => void,
): void {
  try {
    attach(resolve());
  } catch (error: unknown) {
    warn(`Host attention attach failed: ${error instanceof Error ? error.name : 'UnknownError'}`);
  }
}

export async function bootstrapElectron(
  getMainWindow: () => BrowserWindow | null,
  coordinator: Pick<BootCoordinator, 'snapshot'>,
): Promise<BootstrapResult> {
  fixPath();
  const workspacePath = resolveInitialWorkspaceArg(
    process.argv,
    (candidate) => {
      try {
        if (!fs.statSync(candidate, { throwIfNoEntry: false })?.isDirectory()) {
          return false;
        }
        fs.accessSync(candidate, fs.constants.R_OK | fs.constants.X_OK);
        return true;
      } catch {
        // degradation-audit: reported — an inaccessible path is not a usable workspace.
        return false;
      }
    },
  );
  const initialFolders = workspacePath ? [workspacePath] : undefined;

  if (initialFolders) {
    console.log(`[Ptah Electron] Workspace path: ${initialFolders[0]}`);
  }
  const attentionRendererReadiness = createAttentionRendererReadiness(
    () => {
      const win = getMainWindow();
      return win && !win.isDestroyed() ? win.webContents : null;
    },
    (listener) => ipcMain.on('rpc', (event, message: unknown) => listener(event.sender, message)),
  );
  const platformOptions: ElectronPlatformOptions = {
    attention: {
      createNotification: (options) => new Notification(options),
      notificationsSupported: () => Notification.isSupported(),
      isWindowFocused: () => getMainWindow()?.isFocused() ?? true,
      revealWindow: () => {
        const win = getMainWindow();
        if (!win || win.isDestroyed()) return;
        if (win.isMinimized()) win.restore();
        win.show();
        win.focus();
      },
      sendToRenderer: (message) => {
        const win = getMainWindow();
        if (!win || win.isDestroyed()) return;
        win.webContents.send('to-renderer', message);
      },
      isRendererReady: attentionRendererReadiness.isReady,
      onRendererReady: attentionRendererReadiness.onReady,
      hasLiveWindow: () => {
        const win = getMainWindow();
        return !!win && !win.isDestroyed();
      },
      warn: (message) => container.resolve<Logger>(TOKENS.LOGGER).warn(message),
    },
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
      showMessageBox: (win: unknown, options: unknown) => {
        const opts = options as Electron.MessageBoxOptions;
        const targetWin = win instanceof BrowserWindow ? win : getMainWindow();
        return targetWin
          ? dialog.showMessageBox(targetWin, opts)
          : dialog.showMessageBox(opts);
      },
      showOpenDialog: (win: unknown, options: unknown) => {
        const opts = options as Electron.OpenDialogOptions;
        const targetWin = win instanceof BrowserWindow ? win : getMainWindow();
        return targetWin
          ? dialog.showOpenDialog(targetWin, opts)
          : dialog.showOpenDialog(opts);
      },
    },
    getWindow: () => {
      const win = getMainWindow();
      if (!win) return null;
      return {
        webContents: {
          send: (channel: string, ...args: unknown[]) =>
            win.webContents.send(channel, ...args),
        },
      };
    },
    shell: {
      openExternal: (url: string) => shell.openExternal(url),
      writeToClipboard: (text: string) => clipboard.writeText(text),
    },
    ipcMain,
    initialFolders,
    stateStorageWorkerPath: path.join(__dirname, 'state-storage-worker.mjs'),
  };

  const container = ElectronDIContainer.setup(platformOptions);
  try {
    const wsProvider = container.resolve<IWorkspaceProvider>(
      PLATFORM_TOKENS.WORKSPACE_PROVIDER,
    );
    const lifecycle = container.resolve<IWorkspaceLifecycleProvider>(
      PLATFORM_TOKENS.WORKSPACE_LIFECYCLE_PROVIDER,
    );
    const activeWorkspaceSource: IActiveWorkspaceSource = {
      getActivePath: () =>
        lifecycle.getActiveFolder() ?? wsProvider.getWorkspaceRoot(),
      onDidChange: (cb) => wsProvider.onDidChangeWorkspaceFolders(cb),
    };
    container.register(SETTINGS_TOKENS.ACTIVE_WORKSPACE_SOURCE, {
      useValue: activeWorkspaceSource,
    });
    registerElectronSettings(container);
    const migrationRunner = container.resolve<MigrationRunner>(
      SETTINGS_TOKENS.MIGRATION_RUNNER,
    );
    await migrationRunner.runMigrations();
    console.log('[Ptah Electron] Settings registered and migrations applied');
  } catch (settingsError) {
    console.warn(
      '[Ptah Electron] Settings registration / migration failed (non-fatal):',
      settingsError instanceof Error
        ? settingsError.message
        : String(settingsError),
    );
  }
  // Outside the settings try: a failed migration must not leave user-defined
  // providers unpublished for the whole session.
  loadCustomProviders(container);
  // Run outside the settings try so settings failures cannot skip key migration.
  await runCursorApiKeyMigration(container);
  const sentryDsn = typeof __SENTRY_DSN__ !== 'undefined' ? __SENTRY_DSN__ : '';
  if (sentryDsn) {
    const sentryService = container.resolve<SentryService>(
      TOKENS.SENTRY_SERVICE,
    );
    const environment =
      process.env['NODE_ENV'] === 'development' ? 'development' : 'production';
    sentryService.initialize({
      dsn: sentryDsn,
      environment,
      release: app.getVersion(),
      platform: 'electron',
      extensionVersion: app.getVersion(),
    });
  }
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
          err instanceof Error ? err.message : String(err),
        );
      }
    }

    console.log(
      `[Ptah Electron] DI verification: ${resolved}/${tokensToVerify.length} tokens resolved`,
    );
  }
  const gitWatcherRef: BootstrapResult['gitWatcherRef'] = { current: null };
  bootStep('restoreWorkspaces');
  const { startupWorkspaceRoot: restoredRoot, flushWorkspacePersistence } =
    await restoreWorkspaces(
      container,
      initialFolders,
      gitWatcherRef,
      getMainWindow,
    );
  let startupWorkspaceRoot = restoredRoot;
  if (!startupWorkspaceRoot && initialFolders?.[0]) {
    startupWorkspaceRoot = initialFolders[0];
  }

  // The exact active delegate completes verification/migration before IPC,
  // RPC activation, session import, or the Angular renderer can observe it.
  bootStep('workspace state storage whenReady');
  const workspaceStateStorage = container.resolve<WorkspaceAwareStateStorage>(
    PLATFORM_TOKENS.WORKSPACE_STATE_STORAGE,
  );
  await workspaceStateStorage.whenReady();

  // Every registered folder now has its live store, so the copy-forward reads
  // through those and never opens a second worker on one folder. Not awaited:
  // session reads wait on the store's gate instead (PTAH-35).
  void runSessionStoreMigration(container, {
    userDataPath: platformOptions.userDataPath,
    stateStorageWorkerPath: platformOptions.stateStorageWorkerPath,
    liveStorage: workspaceStateStorage,
    logger: container.resolve<Logger>(TOKENS.LOGGER),
  });

  // Started, NOT awaited — see `startMembershipVerification`. The settings
  // migration and `restoreWorkspaces()` above stay awaited because the renderer
  // reads `workspaceRoot` out of `get-startup-config` the moment it loads; this
  // one feeds a card that has always had an unresolved state.
  void startMembershipVerification(container, {
    skip: process.env['PTAH_E2E'] === '1',
  });

  const ipcBridge = new IpcBridge(
    container,
    createMainWindowHandleGetter(getMainWindow),
  );

  try {
    ipcBridge.initialize();
  } catch (error: unknown) {
    console.warn(
      '[Ptah Electron] IpcBridge initialize failed (continuing):',
      error instanceof Error ? error.message : String(error),
    );
  }

  const webviewManagerAdapter = new ElectronWebviewManagerAdapter(ipcBridge, container.resolve<Logger>(TOKENS.LOGGER));
  try {
    container.register(TOKENS.WEBVIEW_MANAGER, {
      useValue: webviewManagerAdapter,
    });
  } catch (error: unknown) {
    console.error(
      '[Ptah Electron] Failed to register WEBVIEW_MANAGER:',
      error instanceof Error ? error.message : String(error),
    );
    throw error;
  }
  attachElectronHostAttention(
    () => container.resolve<IHostAttentionIngress>(SDK_TOKENS.HOST_ATTENTION_COORDINATOR),
    (observer) => { webviewManagerAdapter.setAttentionObserver(observer); },
    (message) => container.resolve<Logger>(TOKENS.LOGGER).warn(message),
  );
  // The boot readiness port, registered beside WEBVIEW_MANAGER because both are
  // the same kind of thing: a host-owned object the runtime-agnostic RPC
  // surface needs to reach. `useValue`, not `registerSingleton` — the
  // coordinator is constructed in `main.ts` before this container exists, and
  // this binding deliberately overrides `vscode-core`'s always-ready null
  // adapter (last registration wins in tsyringe).
  container.register(PLATFORM_TOKENS.BOOT_READINESS, {
    useValue: new ElectronBootReadinessProvider(coordinator),
  });

  try {
    activateSessionLifecycleNotifier(container);
  } catch (error: unknown) {
    console.error(
      '[Ptah Electron] Failed to activate SessionLifecycleNotifier:',
      error instanceof Error ? error.message : String(error),
    );
    throw error;
  }
  // Started, NOT awaited — see `startAgentAdapterInitialization`. This was the
  // second network round-trip sitting between `app.whenReady` and the window.
  void startAgentAdapterInitialization(container);

  return {
    container,
    startupWorkspaceRoot,
    initialFolders,
    flushWorkspacePersistence,
    gitWatcherRef,
  };
}
