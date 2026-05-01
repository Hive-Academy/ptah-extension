/**
 * Platform-CLI Registration Helper
 *
 * Registers all CLI platform implementations against PLATFORM_TOKENS.
 * Called from the CLI app entry point BEFORE any library registration functions.
 *
 * Mirrors: libs/backend/platform-electron/src/registration.ts
 */

import * as crypto from 'crypto';
import * as path from 'path';
import { homedir } from 'os';
import type { DependencyContainer } from 'tsyringe';
import {
  PLATFORM_TOKENS,
  ContentDownloadService,
} from '@ptah-extension/platform-core';
import type { IPlatformInfo } from '@ptah-extension/platform-core';
import { PlatformType } from '@ptah-extension/platform-core';

import { CliFileSystemProvider } from './implementations/cli-file-system-provider';
import { CliStateStorage } from './implementations/cli-state-storage';
import { CliSecretStorage } from './implementations/cli-secret-storage';
import { CliWorkspaceProvider } from './implementations/cli-workspace-provider';
import { CliUserInteraction } from './implementations/cli-user-interaction';
import { CliOutputChannel } from './implementations/cli-output-channel';
import { CliCommandRegistry } from './implementations/cli-command-registry';
import { CliEditorProvider } from './implementations/cli-editor-provider';
import { CliTokenCounter } from './implementations/cli-token-counter';
import { CliDiagnosticsProvider } from './implementations/cli-diagnostics-provider';
import { CliHttpServerProvider } from './implementations/cli-http-server-provider';
import type { CliPlatformOptions } from './types';

/**
 * Register all CLI platform implementations in the DI container.
 *
 * @param container - tsyringe DI container
 * @param options - CLI-specific paths and configuration
 */
export function registerPlatformCliServices(
  container: DependencyContainer,
  options: CliPlatformOptions,
): void {
  // Resolve default paths
  const userDataPath = options.userDataPath ?? path.join(homedir(), '.ptah');
  const logsPath = options.logsPath ?? path.join(userDataPath, 'logs');
  const workspacePath = options.workspacePath
    ? path.resolve(options.workspacePath)
    : process.cwd();

  // Compute workspace-scoped storage path using a hash of the workspace path
  const workspaceHash = hashWorkspacePath(workspacePath);
  const workspaceStoragePath = path.join(
    userDataPath,
    'workspaces',
    workspaceHash,
  );

  // 1. Platform Info
  const platformInfo: IPlatformInfo = {
    type: PlatformType.CLI,
    extensionPath: options.appPath,
    globalStoragePath: userDataPath,
    workspaceStoragePath,
  };
  container.register(PLATFORM_TOKENS.PLATFORM_INFO, {
    useValue: platformInfo,
  });

  // 2. File System
  container.register(PLATFORM_TOKENS.FILE_SYSTEM_PROVIDER, {
    useValue: new CliFileSystemProvider(),
  });

  // 3. State Storage (global)
  container.register(PLATFORM_TOKENS.STATE_STORAGE, {
    useValue: new CliStateStorage(userDataPath, 'global-state.json'),
  });

  // 4. State Storage (workspace-scoped)
  container.register(PLATFORM_TOKENS.WORKSPACE_STATE_STORAGE, {
    useValue: new CliStateStorage(workspaceStoragePath, 'workspace-state.json'),
  });

  // 5. Secret Storage (uses Node.js crypto for encryption)
  container.register(PLATFORM_TOKENS.SECRET_STORAGE, {
    useValue: new CliSecretStorage(userDataPath),
  });

  // 6. Workspace Provider — same instance dual-registered under both
  // WORKSPACE_PROVIDER (read-only) and WORKSPACE_LIFECYCLE_PROVIDER (mutations)
  // so the lifted WorkspaceRpcHandlers can request lifecycle methods via a
  // typed second injection rather than casting to a concrete class.
  const cliWorkspaceProvider = new CliWorkspaceProvider(
    userDataPath,
    workspacePath,
  );
  container.register(PLATFORM_TOKENS.WORKSPACE_PROVIDER, {
    useValue: cliWorkspaceProvider,
  });
  container.register(PLATFORM_TOKENS.WORKSPACE_LIFECYCLE_PROVIDER, {
    useValue: cliWorkspaceProvider,
  });

  // 7. User Interaction
  container.register(PLATFORM_TOKENS.USER_INTERACTION, {
    useValue: new CliUserInteraction(),
  });

  // 8. Output Channel
  container.register(PLATFORM_TOKENS.OUTPUT_CHANNEL, {
    useValue: new CliOutputChannel('Ptah CLI', logsPath),
  });

  // 9. Command Registry
  container.register(PLATFORM_TOKENS.COMMAND_REGISTRY, {
    useValue: new CliCommandRegistry(),
  });

  // 10. Editor Provider
  container.register(PLATFORM_TOKENS.EDITOR_PROVIDER, {
    useValue: new CliEditorProvider(),
  });

  // 11. Token Counter (uses gpt-tokenizer BPE tokenization)
  container.register(PLATFORM_TOKENS.TOKEN_COUNTER, {
    useValue: new CliTokenCounter(),
  });

  // 12. Diagnostics Provider (returns empty — no live language server in CLI)
  container.register(PLATFORM_TOKENS.DIAGNOSTICS_PROVIDER, {
    useValue: new CliDiagnosticsProvider(),
  });

  // 13. Content Download — downloads plugins/templates from GitHub to ~/.ptah/ (TASK_2025_248)
  container.register(PLATFORM_TOKENS.CONTENT_DOWNLOAD, {
    useValue: new ContentDownloadService(),
  });

  // 14. HTTP Server Provider — platform-agnostic HTTP listener for the
  // Anthropic-compatible proxy (TASK_2026_104 P2). Wraps `node:http` so the
  // proxy service stays decoupled from Node primitives and unit-testable.
  container.register(PLATFORM_TOKENS.HTTP_SERVER_PROVIDER, {
    useValue: new CliHttpServerProvider(),
  });
}

/**
 * Create a short, filesystem-safe identifier from a workspace path.
 * Uses SHA-256 hash truncated to 16 hex characters (64 bits — sufficient
 * for local disambiguation without excessive directory name length).
 */
function hashWorkspacePath(workspacePath: string): string {
  return crypto
    .createHash('sha256')
    .update(workspacePath)
    .digest('hex')
    .substring(0, 16);
}
