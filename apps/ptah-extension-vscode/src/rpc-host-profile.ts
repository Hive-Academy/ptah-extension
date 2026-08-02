/**
 * VS Code RPC host profile — the only RPC artifact in this app.
 *
 * VS Code is the editor-embedded host: the IDE already owns the file tree,
 * settings, search, terminal and updates, so those surfaces stay off and Ptah
 * only adds what the webview needs. The SQLite/native-backed subsystems
 * (memory, skills, cron, gateway, voice, persistence) are Electron-only by
 * design — better-sqlite3 and the embedder worker are not available here.
 *
 * Everything omitted below is `false`, which is why an Electron-only subsystem
 * can be added without touching this file.
 */

import type { Logger } from '@ptah-extension/vscode-core';
import { capabilities, type HostProfile } from '@ptah-extension/rpc-handlers';
import { parseWorktreeList } from '@ptah-extension/shared';

import {
  AgentRpcHandlers,
  CommandRpcHandlers,
  EditorRpcHandlers,
  FileRpcHandlers,
} from './services/rpc/handlers';

export function createVscodeRpcHostProfile(logger: Logger): HostProfile {
  return {
    platform: 'vscode',
    host: 'vscode',
    capabilities: capabilities({
      fileOpen: true,
      filePicker: true,
      editorRevert: true,
      commandExecution: true,
    }),
    hostHandlers: {
      'host.agent': AgentRpcHandlers,
      'host.fileOpen': FileRpcHandlers,
      'host.filePicker': FileRpcHandlers,
      'host.editorRevert': EditorRpcHandlers,
      'host.command': CommandRpcHandlers,
    },
    wiring: {
      worktree: true,
      resolveWorktreePath: async (data) => {
        try {
          const crossSpawn = await import('cross-spawn');
          const child = crossSpawn.default(
            'git',
            ['worktree', 'list', '--porcelain'],
            { cwd: data.cwd, stdio: ['pipe', 'pipe', 'pipe'] },
          );
          const chunks: Buffer[] = [];
          child.stdout?.on('data', (chunk: Buffer) => chunks.push(chunk));
          await new Promise<void>((resolve) =>
            child.on('close', () => resolve()),
          );
          const worktrees = parseWorktreeList(Buffer.concat(chunks).toString());
          return worktrees.find((w) => w.branch === data.name)?.path;
        } catch (error: unknown) {
          logger.warn(
            '[vscode RPC] Failed to resolve worktree path',
            error instanceof Error ? error : new Error(String(error)),
          );
          return undefined;
        }
      },
      copilotPermission: true,
      persistCliSession: true,
      sdkSessionIdLookup: true,
      sessionMetadataEvents: true,
    },
    assertOnDrift: true,
  };
}
