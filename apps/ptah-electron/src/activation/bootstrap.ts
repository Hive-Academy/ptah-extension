// Bootstrap: Phases 1 through 3.6 of Electron activation.
// Parses CLI args, builds the DI container, verifies critical tokens,
// restores persisted workspaces, performs license verification, and
// initializes SDK auth.
//
// Split from main.ts per TASK_2025_291 Wave C1 / design section B.3.1.

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
import { PLATFORM_TOKENS } from '@ptah-extension/platform-core';
import { TOKENS, SentryService } from '@ptah-extension/vscode-core';
import { fixPath } from '@ptah-extension/agent-sdk';
import { ElectronDIContainer } from '../di/container';
import { restoreWorkspaces } from './workspace-restore';

export interface BootstrapResult {
  container: DependencyContainer;
  startupWorkspaceRoot: string | undefined;
  startupIsLicensed: boolean;
  startupInitialView: string | null;
  startupLicenseTier: string | undefined;
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
  // PHASE 0: Repair process.env.PATH on Linux/macOS when launched from a
  // GUI launcher (Activities, dock, Finder). Without this, npm-installed
  // CLIs (Gemini, Codex, Copilot, Cursor) are not discoverable because
  // ~/.bashrc / ~/.zshrc are not sourced for GUI-launched processes.
  // Must run BEFORE DI container creation so CliDetectionService sees the
  // repaired PATH on its first detect() call. No-op on Windows.
  fixPath();

  // PHASE 1: Parse command-line args
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
  // PHASE 2: Initialize DI Container
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
      // TASK_2025_261: Electron's dialog.showMessageBox checks `instanceof BrowserWindow`.
      // Duck-typed objects from getWindow() fail this check and are re-interpreted
      // as options, silently dropping the actual message/buttons.
      // Use the passed window if it's a real BrowserWindow, otherwise fall back to mainWindow.
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

  // Initialize Sentry — DSN injected at build time via esbuild define.
  // Production builds contain the real DSN; development gets empty string (no-op).
  const sentryDsn = typeof __SENTRY_DSN__ !== 'undefined' ? __SENTRY_DSN__ : '';
  if (sentryDsn) {
    const sentryService = container.resolve<SentryService>(
      TOKENS.SENTRY_SERVICE,
    );
    sentryService.initialize({
      dsn: sentryDsn,
      environment: 'production',
      release: app.getVersion(),
      platform: 'electron',
      extensionVersion: app.getVersion(),
    });
  }
  // PHASE 2.1: Verify Critical DI Tokens
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
          err instanceof Error ? err.message : String(err),
        );
      }
    }

    console.log(
      `[Ptah Electron] DI verification: ${resolved}/${tokensToVerify.length} tokens resolved`,
    );
  }

  // Mutable ref box — consumed by the onDidChangeWorkspaceFolders subscription
  // registered below. Assigned by the orchestrator after wireRuntime Phase 4.8.
  const gitWatcherRef: BootstrapResult['gitWatcherRef'] = { current: null };
  // PHASE 2.5: Workspace Restoration (TASK_2025_208 Batch 2, Tasks 2.2 & 2.3)
  // Restore persisted workspace list from global state storage, apply CLI arg
  // priority, and wire the onDidChangeWorkspaceFolders subscription (debounced
  // persistence + git-watcher switching via the mutable gitWatcherRef).
  // Implementation extracted to ./workspace-restore.
  const { startupWorkspaceRoot: restoredRoot, flushWorkspacePersistence } =
    await restoreWorkspaces(
      container,
      initialFolders,
      gitWatcherRef,
      getMainWindow,
    );
  let startupWorkspaceRoot = restoredRoot;
  // PHASE 2.6: (Deferred) RPC handlers registered after WebviewManager in Phase 4.5
  // Fallback: if workspace restoration failed but CLI arg was provided
  if (!startupWorkspaceRoot && initialFolders?.[0]) {
    startupWorkspaceRoot = initialFolders[0];
  }
  // PHASE 3.5: License Verification
  // Check license status before creating the window. If the license is invalid
  // (revoked or payment failed), the renderer will start on the welcome view
  // with isLicensed=false, blocking access to premium features.
  // Mirrors the VS Code extension's handleLicenseBlocking() pattern (main.ts:85-306).
  //
  // LicenseService is registered in container.ts Phase 1.1 and depends on
  // EXTENSION_CONTEXT (shimmed), LOGGER, and CONFIG_MANAGER — all available.
  // Network timeout is 5s; offline grace period (7 days) prevents blocking
  // if the license server is unreachable.
  let startupIsLicensed = true;
  let startupInitialView: string | null = null;
  let startupLicenseTier: string | undefined;

  try {
    const licenseService = container.resolve(TOKENS.LICENSE_SERVICE) as {
      verifyLicense: () => Promise<{
        valid: boolean;
        reason?: string;
        tier?: string;
      }>;
    };
    const licenseStatus = await licenseService.verifyLicense();

    startupLicenseTier = licenseStatus.tier;

    if (!licenseStatus.valid) {
      startupIsLicensed = false;
      startupInitialView = 'welcome';
      console.log(
        `[Ptah Electron] License invalid (reason: ${
          licenseStatus.reason ?? 'unknown'
        }, tier: ${licenseStatus.tier ?? 'unknown'}), showing welcome screen`,
      );
    } else {
      console.log(
        `[Ptah Electron] License verified (tier: ${licenseStatus.tier})`,
      );
    }
  } catch (error) {
    // Non-fatal: default to licensed so users aren't blocked by verification errors
    console.warn(
      '[Ptah Electron] License verification failed (non-fatal, defaulting to licensed):',
      error instanceof Error ? error.message : String(error),
    );
  }
  // PHASE 3.6: SDK Authentication Initialization (TASK_2025_240)
  // Initialize the SDK agent adapter so chat:start works.
  // Mirrors VS Code extension Step 7 (main.ts:568-589).
  // Must happen AFTER Phase 3.5 (license check) and BEFORE Phase 4.5 (RPC registration).
  // AuthManager.configureAuthentication() reads API keys from AuthSecretsService.
  try {
    const agentAdapter = container.resolve(TOKENS.AGENT_ADAPTER) as {
      initialize: () => Promise<boolean>;
      preloadSdk: () => Promise<void>;
      prewarm: () => Promise<void>;
    };
    const authInitialized = await agentAdapter.initialize();

    if (authInitialized) {
      console.log('[Ptah Electron] Agent adapters initialized successfully');

      // Pre-load SDKs in background (non-blocking) to speed up first chat.
      // Shifts ~100-200ms import cost from first user interaction to activation.
      agentAdapter.preloadSdk().catch((err) => {
        console.warn(
          '[Ptah Electron] SDK preload failed (will retry on first use):',
          err instanceof Error ? err.message : String(err),
        );
      });

      // Pre-warm the SDK CLI subprocess via SDK startup() (Claude Agent SDK
      // ≥ 0.2.111). Fire-and-forget — failure is benign. Do NOT await:
      // window must appear within 2s of ready (see CLAUDE.md guidelines).
      agentAdapter.prewarm().catch((err) => {
        console.warn(
          '[Ptah Electron] SDK prewarm failed (will resolve on first query):',
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
    startupLicenseTier,
    initialFolders,
    flushWorkspacePersistence,
    gitWatcherRef,
  };
}
