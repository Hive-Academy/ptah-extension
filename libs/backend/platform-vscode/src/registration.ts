/**
 * Platform-VSCode Registration Helper
 *
 * Registers all VS Code platform implementations against PLATFORM_TOKENS.
 * Called from apps/ptah-extension-vscode/src/di/container.ts BEFORE
 * any library registration functions.
 */

import type * as vscode from 'vscode';
import type { DependencyContainer } from 'tsyringe';
import { PLATFORM_TOKENS } from '@ptah-extension/platform-core';

import { VscodeFileSystemProvider } from './implementations/vscode-file-system-provider';
import { VscodeStateStorage } from './implementations/vscode-state-storage';
import { VscodeSecretStorage } from './implementations/vscode-secret-storage';
import { VscodeWorkspaceProvider } from './implementations/vscode-workspace-provider';
import { VscodeUserInteraction } from './implementations/vscode-user-interaction';
import { VscodeOutputChannel } from './implementations/vscode-output-channel';
import { VscodeCommandRegistry } from './implementations/vscode-command-registry';
import { VscodeEditorProvider } from './implementations/vscode-editor-provider';

import type { IPlatformInfo } from '@ptah-extension/platform-core';
import { PlatformType } from '@ptah-extension/platform-core';

/**
 * Register all platform implementations in the DI container.
 *
 * MUST be called before any library registerXxxServices() functions,
 * because those libraries inject PLATFORM_TOKENS.
 *
 * @param container - tsyringe DI container
 * @param context - VS Code ExtensionContext
 */
export function registerPlatformVscodeServices(
  container: DependencyContainer,
  context: vscode.ExtensionContext
): void {
  // Platform Info
  const platformInfo: IPlatformInfo = {
    type: PlatformType.VSCode,
    extensionPath: context.extensionPath,
    globalStoragePath: context.globalStorageUri.fsPath,
    workspaceStoragePath:
      context.storageUri?.fsPath ?? context.globalStorageUri.fsPath,
  };
  container.register(PLATFORM_TOKENS.PLATFORM_INFO, { useValue: platformInfo });

  // File System
  container.register(PLATFORM_TOKENS.FILE_SYSTEM_PROVIDER, {
    useValue: new VscodeFileSystemProvider(),
  });

  // State Storage (global = globalState, workspace = workspaceState)
  container.register(PLATFORM_TOKENS.STATE_STORAGE, {
    useValue: new VscodeStateStorage(context.globalState),
  });
  container.register(PLATFORM_TOKENS.WORKSPACE_STATE_STORAGE, {
    useValue: new VscodeStateStorage(context.workspaceState),
  });

  // Secret Storage
  container.register(PLATFORM_TOKENS.SECRET_STORAGE, {
    useValue: new VscodeSecretStorage(context.secrets),
  });

  // Workspace Provider
  container.register(PLATFORM_TOKENS.WORKSPACE_PROVIDER, {
    useValue: new VscodeWorkspaceProvider(),
  });

  // User Interaction
  container.register(PLATFORM_TOKENS.USER_INTERACTION, {
    useValue: new VscodeUserInteraction(),
  });

  // Output Channel (default channel name)
  container.register(PLATFORM_TOKENS.OUTPUT_CHANNEL, {
    useValue: new VscodeOutputChannel('Ptah Extension'),
  });

  // Command Registry
  container.register(PLATFORM_TOKENS.COMMAND_REGISTRY, {
    useValue: new VscodeCommandRegistry(),
  });

  // Editor Provider
  container.register(PLATFORM_TOKENS.EDITOR_PROVIDER, {
    useValue: new VscodeEditorProvider(),
  });
}
