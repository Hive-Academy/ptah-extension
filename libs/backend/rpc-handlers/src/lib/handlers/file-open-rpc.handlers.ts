/**
 * Electron `file:open` RPC handler.
 *
 * Deliberately minimal: launches the user's external editor and does nothing
 * else. No editor detection, no target list, no remembered choice, no deep
 * links — `IEditorLauncher` and `EditorTarget[]` are TASK_2026_386.
 *
 * Lives in `@ptah-extension/rpc-handlers` (not `apps/ptah-electron`) even
 * though the capability it serves is Electron-only, the same reasoning that
 * places `FileSystemRpcHandlers` / `FilePickerRpcHandlers` here: a host binds
 * to it via `rpc-host-profile.ts`'s `hostHandlers`, but the class itself is
 * ordinary library code with no `vscode`/`electron` import.
 *
 * This replaces `EditorRpcHandlers` as the `host.fileOpen` binding
 * (`apps/ptah-electron/src/rpc-host-profile.ts`), which used to read file
 * bytes for a Monaco tab. `EditorRpcHandlers` keeps serving `editor:openFile`
 * and the rest of its namespace unchanged; only the `file:open` binding moved.
 */

import { injectable, inject } from 'tsyringe';
import { TOKENS } from '@ptah-extension/vscode-core';
import type { Logger, RpcHandler } from '@ptah-extension/vscode-core';
import {
  PLATFORM_TOKENS,
  isPathWithinRoots,
} from '@ptah-extension/platform-core';
import type {
  IWorkspaceProvider,
  IProcessSpawner,
  SpawnedProcessHandle,
} from '@ptah-extension/platform-core';
import { SDK_TOKENS } from '@ptah-extension/agent-sdk';
import type { FileOpenParams, FileOpenResult } from '@ptah-extension/shared';

import { parseFileOpenParams } from './file-open-rpc.schema';

interface EditorOpenedNotifier {
  notifyFileOpened(filePath: string): void;
}

/**
 * How long to wait for the worker-backed spawner to confirm the child
 * actually started before answering the RPC. Local process spawn, not a
 * network call — kept short so a genuinely hung spawn does not hold the
 * response open.
 */
const SPAWN_CONFIRMATION_TIMEOUT_MS = 3000;

@injectable()
export class ElectronFileOpenRpcHandlers {
  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(TOKENS.RPC_HANDLER) private readonly rpcHandler: RpcHandler,
    @inject(PLATFORM_TOKENS.WORKSPACE_PROVIDER)
    private readonly workspace: IWorkspaceProvider,
    @inject(PLATFORM_TOKENS.EDITOR_PROVIDER)
    private readonly editorProvider: EditorOpenedNotifier,
    @inject(SDK_TOKENS.SDK_PROCESS_SPAWNER)
    private readonly spawner: IProcessSpawner,
  ) {}

  register(): void {
    this.rpcHandler.registerMethod<FileOpenParams, FileOpenResult>(
      'file:open',
      (params) => this.handleFileOpen(params),
    );
  }

  private async handleFileOpen(
    params: FileOpenParams | undefined,
  ): Promise<FileOpenResult> {
    const parsed = parseFileOpenParams(params);
    if (!parsed.success) {
      return { success: false, error: parsed.error };
    }

    const roots = this.workspace.getWorkspaceFolders();
    if (!isPathWithinRoots(parsed.data.path, roots)) {
      return { success: false, error: 'Path is outside the workspace' };
    }

    const { path, line } = parsed.data;
    const target = line ? `${path}:${line}` : path;

    let handle: SpawnedProcessHandle;
    try {
      handle = this.spawner.spawnProcess({
        command: 'code',
        args: ['-g', target],
        cwd: this.workspace.getWorkspaceRoot(),
        env: process.env,
        detached: process.platform !== 'win32',
        needsConsole: false,
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        '[file:open] failed to launch the external editor',
        error instanceof Error ? error : new Error(message),
      );
      return { success: false, error: message };
    }

    let spawnError: Error | undefined;
    handle.on('error', (error: Error) => {
      spawnError = error;
      this.logger.warn('[file:open] spawn error', error);
    });

    // `spawnProcess` returns a handle synchronously; the worker-backed
    // implementation confirms the child actually started (or reports it
    // never did) asynchronously via `whenSpawned`. Answering right after
    // `spawnProcess` returns — without this wait — reports success for a
    // spawn that has not been confirmed and can still fail (e.g. `code` not
    // on PATH), which is the most likely failure for this exact feature.
    const pid = await this.waitForSpawnConfirmation(handle);
    if (pid === null) {
      return {
        success: false,
        error: spawnError?.message ?? 'Failed to launch the external editor',
      };
    }

    this.editorProvider.notifyFileOpened(path);
    return { success: true };
  }

  /**
   * Bound-await `handle.whenSpawned`. Resolves with the confirmed pid, or
   * `null` on failure to start OR on timeout — never rejects, so a caller
   * never has to distinguish "it failed" from "it never told us." This only
   * confirms the child STARTED; it does not wait for the child to exit (the
   * batch text's "do not await the child" is about not waiting for exit).
   */
  private waitForSpawnConfirmation(
    handle: SpawnedProcessHandle,
  ): Promise<number | null> {
    return new Promise((resolve) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        resolve(null);
      }, SPAWN_CONFIRMATION_TIMEOUT_MS);

      handle.whenSpawned
        .then((pid) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          resolve(pid);
        })
        .catch(() => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          resolve(null);
        });
    });
  }
}
