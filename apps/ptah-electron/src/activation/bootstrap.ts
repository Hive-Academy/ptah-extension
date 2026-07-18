import {
  app,
  BrowserWindow,
  safeStorage,
  dialog,
  ipcMain,
  shell,
  clipboard,
} from 'electron';
import * as path from 'path';
import type { DependencyContainer } from 'tsyringe';
import type { ElectronPlatformOptions } from '@ptah-extension/platform-electron';
import { registerElectronSettings } from '@ptah-extension/platform-electron';
import { PLATFORM_TOKENS } from '@ptah-extension/platform-core';
import type {
  IWorkspaceProvider,
  IWorkspaceLifecycleProvider,
} from '@ptah-extension/platform-core';
import { TOKENS, SentryService } from '@ptah-extension/vscode-core';
import {
  SETTINGS_TOKENS,
  type MigrationRunner,
  type IActiveWorkspaceSource,
} from '@ptah-extension/settings-core';
import { fixPath } from '@ptah-extension/cli-agent-runtime';
import { activateSessionLifecycleNotifier } from '@ptah-extension/rpc-handlers';
import { ElectronDIContainer } from '../di/container';
import { restoreWorkspaces } from './workspace-restore';
import { IpcBridge } from '../ipc/ipc-bridge';
import { ElectronWebviewManagerAdapter } from '../ipc/webview-manager-adapter';
import { ELECTRON_TOKENS } from '../di/electron-tokens';
import type { PtyManagerService } from '../services/pty-manager.service';

export interface BootstrapResult {
  container: DependencyContainer;
  startupWorkspaceRoot: string | undefined;
  startupIsLicensed: boolean;
  startupInitialView: string | null;
  initialFolders: string[] | undefined;
  flushWorkspacePersistence: (() => void) | null;
  /** Mutable ref box so the workspace-change subscription can pick up the
   * gitWatcher created later in wireRuntime Phase 4.8. */
  gitWatcherRef: {
    current: { stop: () => void; switchWorkspace: (p: string) => void } | null;
  };
}

export async function bootstrapElectron(
  getMainWindow: () => BrowserWindow | null,
): Promise<BootstrapResult> {
  fixPath();
  const workspacePath = process.argv.find(
    (arg) =>
      !arg.startsWith('-') &&
      arg !== process.argv[0] &&
      arg !== process.argv[1],
  );
  const initialFolders = workspacePath
    ? [path.resolve(workspacePath)]
    : undefined;

  if (initialFolders) {
    console.log(`[Ptah Electron] Workspace path: ${initialFolders[0]}`);
  }
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
  const startupIsLicensed = true;
  const startupInitialView: string | null = null;

  // Resolve membership status once at startup to prime the license cache for
  // the membership card. This is identity only — it never gates activation or
  // the initial view; Ptah's local features are available to everyone.
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
  } catch (error) {
    console.warn(
      '[Ptah Electron] Membership status resolution failed (non-fatal):',
      error instanceof Error ? error.message : String(error),
    );
  }
  let ptyManager: PtyManagerService | undefined;
  try {
    ptyManager = container.resolve<PtyManagerService>(
      ELECTRON_TOKENS.PTY_MANAGER_SERVICE,
    );
  } catch (error: unknown) {
    console.warn(
      '[Ptah Electron] PtyManagerService resolve failed (continuing without pty):',
      error instanceof Error ? error.message : String(error),
    );
  }

  const ipcBridge = new IpcBridge(
    container,
    () => {
      const win = getMainWindow();
      if (!win) return null;
      return {
        webContents: {
          send: (channel: string, ...args: unknown[]) =>
            win.webContents.send(channel, ...args),
        },
      };
    },
    ptyManager,
  );

  try {
    ipcBridge.initialize();
  } catch (error: unknown) {
    console.warn(
      '[Ptah Electron] IpcBridge initialize failed (continuing):',
      error instanceof Error ? error.message : String(error),
    );
  }

  const webviewManagerAdapter = new ElectronWebviewManagerAdapter(ipcBridge);
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
  try {
    activateSessionLifecycleNotifier(container);
  } catch (error: unknown) {
    console.error(
      '[Ptah Electron] Failed to activate SessionLifecycleNotifier:',
      error instanceof Error ? error.message : String(error),
    );
    throw error;
  }
  try {
    const agentAdapter = container.resolve(TOKENS.AGENT_ADAPTER) as {
      initialize: () => Promise<boolean>;
      preloadSdk: () => Promise<void>;
    };
    const authInitialized = await agentAdapter.initialize();

    if (authInitialized) {
      console.log('[Ptah Electron] Agent adapters initialized successfully');
      agentAdapter.preloadSdk().catch((err) => {
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
  } catch (error) {
    console.warn(
      '[Ptah Electron] Agent adapter initialization failed (non-fatal):',
      error instanceof Error ? error.message : String(error),
    );
  }

  return {
    container,
    startupWorkspaceRoot,
    startupIsLicensed,
    startupInitialView,
    initialFolders,
    flushWorkspacePersistence,
    gitWatcherRef,
  };
}
