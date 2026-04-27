/**
 * Platform-Electron Registration Helper
 *
 * Registers all Electron platform implementations against PLATFORM_TOKENS.
 * Called from apps/ptah-electron/src/di/container.ts BEFORE
 * any library registration functions.
 *
 * MUST be called after app.whenReady() (safeStorage requires it).
 * MUST be called before any library registerXxxServices() functions.
 *
 * Mirrors: libs/backend/platform-vscode/src/registration.ts
 */

import * as path from 'path';
import type { DependencyContainer } from 'tsyringe';
import {
  PLATFORM_TOKENS,
  ContentDownloadService,
} from '@ptah-extension/platform-core';
import type { IPlatformInfo } from '@ptah-extension/platform-core';
import { PlatformType } from '@ptah-extension/platform-core';

import { ElectronFileSystemProvider } from './implementations/electron-file-system-provider';
import { ElectronStateStorage } from './implementations/electron-state-storage';
import {
  ElectronSecretStorage,
  type SafeStorageApi,
} from './implementations/electron-secret-storage';
import { ElectronWorkspaceProvider } from './implementations/electron-workspace-provider';
import {
  ElectronUserInteraction,
  type ElectronDialogApi,
  type ElectronBrowserWindowApi,
  type ElectronShellApi,
} from './implementations/electron-user-interaction';
import { ElectronOutputChannel } from './implementations/electron-output-channel';
import { ElectronCommandRegistry } from './implementations/electron-command-registry';
import { ElectronEditorProvider } from './implementations/electron-editor-provider';
import { ElectronTokenCounter } from './implementations/electron-token-counter';
import { ElectronDiagnosticsProvider } from './implementations/electron-diagnostics-provider';

/**
 * Options for Electron platform registration.
 * All Electron-specific APIs are passed in to avoid top-level
 * import of 'electron' (enables testing without Electron runtime).
 */
export interface ElectronPlatformOptions {
  /** app.getAppPath() */
  appPath: string;
  /** app.getPath('userData') */
  userDataPath: string;
  /** app.getPath('logs') */
  logsPath: string;
  /** Electron's safeStorage module */
  safeStorage: SafeStorageApi;
  /** Electron's dialog module */
  dialog: ElectronDialogApi;
  /** Function to get the current BrowserWindow */
  getWindow: () => ElectronBrowserWindowApi | null;
  /** Electron's ipcMain module (for QuickPick/InputBox renderer delegation) */
  ipcMain?: {
    once(
      channel: string,
      listener: (event: unknown, ...args: unknown[]) => void,
    ): void;
  } | null;
  /** Shell and clipboard APIs for opening URLs and copying text */
  shell?: ElectronShellApi | null;
  /** Initial workspace folders (from command line or recent) */
  initialFolders?: string[];
}

/**
 * Register all Electron platform implementations in the DI container.
 *
 * @param container - tsyringe DI container
 * @param options - Electron-specific APIs and paths
 */
export function registerPlatformElectronServices(
  container: DependencyContainer,
  options: ElectronPlatformOptions,
): void {
  // Compute workspace-scoped storage path from the first workspace folder
  const workspaceStoragePath = options.initialFolders?.[0]
    ? path.join(
        options.userDataPath,
        'workspace-storage',
        encodeWorkspacePath(options.initialFolders[0]),
      )
    : path.join(options.userDataPath, 'workspace-storage', 'default');

  // Platform Info
  const platformInfo: IPlatformInfo = {
    type: PlatformType.Electron,
    extensionPath: options.appPath,
    globalStoragePath: options.userDataPath,
    workspaceStoragePath,
  };
  container.register(PLATFORM_TOKENS.PLATFORM_INFO, {
    useValue: platformInfo,
  });

  // File System
  container.register(PLATFORM_TOKENS.FILE_SYSTEM_PROVIDER, {
    useValue: new ElectronFileSystemProvider(),
  });

  // State Storage (global)
  container.register(PLATFORM_TOKENS.STATE_STORAGE, {
    useValue: new ElectronStateStorage(
      options.userDataPath,
      'global-state.json',
    ),
  });

  // State Storage (workspace-scoped)
  container.register(PLATFORM_TOKENS.WORKSPACE_STATE_STORAGE, {
    useValue: new ElectronStateStorage(
      workspaceStoragePath,
      'workspace-state.json',
    ),
  });

  // Secret Storage (uses safeStorage for encryption)
  container.register(PLATFORM_TOKENS.SECRET_STORAGE, {
    useValue: new ElectronSecretStorage(
      options.userDataPath,
      options.safeStorage,
    ),
  });

  // Workspace Provider — same instance dual-registered under both
  // WORKSPACE_PROVIDER (read-only) and WORKSPACE_LIFECYCLE_PROVIDER (mutations)
  // so the lifted WorkspaceRpcHandlers can request lifecycle methods via a
  // typed second injection rather than casting to a concrete class.
  const electronWorkspaceProvider = new ElectronWorkspaceProvider(
    options.userDataPath,
    options.initialFolders,
  );
  container.register(PLATFORM_TOKENS.WORKSPACE_PROVIDER, {
    useValue: electronWorkspaceProvider,
  });
  container.register(PLATFORM_TOKENS.WORKSPACE_LIFECYCLE_PROVIDER, {
    useValue: electronWorkspaceProvider,
  });

  // User Interaction
  container.register(PLATFORM_TOKENS.USER_INTERACTION, {
    useValue: new ElectronUserInteraction(
      options.dialog,
      options.getWindow,
      options.ipcMain,
      options.shell,
    ),
  });

  // Output Channel
  container.register(PLATFORM_TOKENS.OUTPUT_CHANNEL, {
    useValue: new ElectronOutputChannel('Ptah Electron', options.logsPath),
  });

  // Command Registry
  container.register(PLATFORM_TOKENS.COMMAND_REGISTRY, {
    useValue: new ElectronCommandRegistry(),
  });

  // Editor Provider
  container.register(PLATFORM_TOKENS.EDITOR_PROVIDER, {
    useValue: new ElectronEditorProvider(),
  });

  // Token Counter (uses gpt-tokenizer BPE tokenization)
  container.register(PLATFORM_TOKENS.TOKEN_COUNTER, {
    useValue: new ElectronTokenCounter(),
  });

  // Diagnostics Provider (returns empty — no live language server in Electron)
  container.register(PLATFORM_TOKENS.DIAGNOSTICS_PROVIDER, {
    useValue: new ElectronDiagnosticsProvider(),
  });

  // Content Download — downloads plugins/templates from GitHub to ~/.ptah/ (TASK_2025_248)
  container.register(PLATFORM_TOKENS.CONTENT_DOWNLOAD, {
    useValue: new ContentDownloadService(),
  });
}

/**
 * Create a filesystem-safe workspace identifier from a folder path.
 * Uses base64url encoding to avoid special characters in directory names.
 */
function encodeWorkspacePath(folderPath: string): string {
  return Buffer.from(folderPath).toString('base64url');
}
