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
import { VscodeDiskStateStorage } from './implementations/vscode-disk-state-storage';
import { VscodeSecretStorage } from './implementations/vscode-secret-storage';
import { VscodeWorkspaceProvider } from './implementations/vscode-workspace-provider';
import { VscodeWorkspaceLifecycleProvider } from './implementations/vscode-workspace-lifecycle-provider';
import { VscodeUserInteraction } from './implementations/vscode-user-interaction';
import { VscodeOutputChannel } from './implementations/vscode-output-channel';
import { VscodeCommandRegistry } from './implementations/vscode-command-registry';
import { VscodeEditorProvider } from './implementations/vscode-editor-provider';
import { VscodeTokenCounter } from './implementations/vscode-token-counter';
import { VscodeDiagnosticsProvider } from './implementations/vscode-diagnostics-provider';

import type { IPlatformInfo } from '@ptah-extension/platform-core';
import {
  PlatformType,
  ContentDownloadService,
} from '@ptah-extension/platform-core';

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
  context: vscode.ExtensionContext,
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

  // State Storage (global = in-memory Memento, workspace = disk-based JSON)
  container.register(PLATFORM_TOKENS.STATE_STORAGE, {
    useValue: new VscodeStateStorage(context.globalState),
  });
  container.register(PLATFORM_TOKENS.WORKSPACE_STATE_STORAGE, {
    useValue: new VscodeDiskStateStorage(
      context.storageUri?.fsPath ?? context.globalStorageUri.fsPath,
      'workspace-state.json',
    ),
  });

  // Secret Storage (holds event subscriptions — register for disposal)
  const secretStorage = new VscodeSecretStorage(context.secrets);
  container.register(PLATFORM_TOKENS.SECRET_STORAGE, {
    useValue: secretStorage,
  });
  context.subscriptions.push(secretStorage);

  // Workspace Provider (holds event subscriptions — register for disposal)
  const workspaceProvider = new VscodeWorkspaceProvider();
  container.register(PLATFORM_TOKENS.WORKSPACE_PROVIDER, {
    useValue: workspaceProvider,
  });
  context.subscriptions.push(workspaceProvider);

  // Workspace Lifecycle Provider (holds VS Code event subscriptions — register
  // for disposal). VS Code's workspace folder mutations go through
  // vscode.workspace.updateWorkspaceFolders; this adapter wraps that API.
  const workspaceLifecycleProvider = new VscodeWorkspaceLifecycleProvider();
  container.register(PLATFORM_TOKENS.WORKSPACE_LIFECYCLE_PROVIDER, {
    useValue: workspaceLifecycleProvider,
  });
  context.subscriptions.push(workspaceLifecycleProvider);

  // User Interaction
  container.register(PLATFORM_TOKENS.USER_INTERACTION, {
    useValue: new VscodeUserInteraction(),
  });

  // Output Channel (holds VS Code OutputChannel — register for disposal)
  const outputChannel = new VscodeOutputChannel('Ptah Extension');
  container.register(PLATFORM_TOKENS.OUTPUT_CHANNEL, {
    useValue: outputChannel,
  });
  context.subscriptions.push(outputChannel);

  // Command Registry
  container.register(PLATFORM_TOKENS.COMMAND_REGISTRY, {
    useValue: new VscodeCommandRegistry(),
  });

  // Editor Provider (holds event subscriptions — register for disposal)
  const editorProvider = new VscodeEditorProvider();
  container.register(PLATFORM_TOKENS.EDITOR_PROVIDER, {
    useValue: editorProvider,
  });
  context.subscriptions.push(editorProvider);

  // Token Counter (uses VS Code LM API with gpt-tokenizer fallback)
  container.register(PLATFORM_TOKENS.TOKEN_COUNTER, {
    useValue: new VscodeTokenCounter(),
  });

  // Diagnostics Provider (wraps vscode.languages.getDiagnostics())
  container.register(PLATFORM_TOKENS.DIAGNOSTICS_PROVIDER, {
    useValue: new VscodeDiagnosticsProvider(),
  });

  // Content Download — downloads plugins/templates from GitHub to ~/.ptah/
  container.register(PLATFORM_TOKENS.CONTENT_DOWNLOAD, {
    useValue: new ContentDownloadService(),
  });
}
