/**
 * Electron RPC host profile — the only RPC artifact in this app.
 *
 * Electron is the reference host: it serves the entire RPC registry, so every
 * capability is on and `deriveRpcSurface()` yields an empty exclusion set.
 * Adding a subsystem here means flipping one flag; the other hosts need no
 * edit because omitted capabilities default to `false`.
 */

import type { DependencyContainer } from 'tsyringe';
import { TOKENS } from '@ptah-extension/vscode-core';
import type { GitInfoService, Logger } from '@ptah-extension/vscode-core';
import { capabilities, type HostProfile } from '@ptah-extension/rpc-handlers';

import {
  CommandRpcHandlers,
  EditorRpcHandlers,
  LayoutRpcHandlers,
  TerminalRpcHandlers,
  UpdateRpcHandlers,
} from './services/rpc/handlers';

export function createElectronRpcHostProfile(
  container: DependencyContainer,
  logger: Logger,
): HostProfile {
  return {
    platform: 'electron',
    host: 'electron',
    capabilities: capabilities({
      memory: true,
      skillSynthesis: true,
      cron: true,
      gateway: true,
      voice: true,
      persistence: true,
      workspaceLifecycle: true,
      fileOpen: true,
      filePicker: true,
      filePickerImages: true,
      fileSystemAccess: true,
      editorRevert: true,
      editorHost: true,
      commandExecution: true,
      layoutPersistence: true,
      pty: true,
      appUpdater: true,
    }),
    hostHandlers: {
      'host.fileOpen': EditorRpcHandlers,
      'host.editorRevert': EditorRpcHandlers,
      'host.editorPane': EditorRpcHandlers,
      'host.command': CommandRpcHandlers,
      'host.layout': LayoutRpcHandlers,
      'host.terminal': TerminalRpcHandlers,
      'host.update': UpdateRpcHandlers,
    },
    wiring: {
      worktree: true,
      resolveWorktreePath: async (data) => {
        try {
          if (!container.isRegistered(TOKENS.GIT_INFO_SERVICE)) {
            return undefined;
          }
          const gitInfo = container.resolve<GitInfoService>(
            TOKENS.GIT_INFO_SERVICE,
          );
          const worktrees = await gitInfo.getWorktrees(data.cwd);
          return worktrees.find((w) => w.branch === data.name)?.path;
        } catch (error: unknown) {
          logger.warn(
            '[electron RPC] Failed to resolve worktree path',
            error instanceof Error ? error : new Error(String(error)),
          );
          return undefined;
        }
      },
      copilotPermission: true,
      persistCliSession: true,
      sdkSessionIdLookup: true,
      sessionMetadataEvents: false,
    },
    assertOnDrift: true,
  };
}
