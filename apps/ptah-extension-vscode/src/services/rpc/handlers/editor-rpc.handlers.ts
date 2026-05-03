/**
 * Editor RPC Handlers (M3)
 *
 * Handles VS Code-specific editor operations that need direct access to the
 * `vscode.workspace.textDocuments` / `vscode.window` namespaces and therefore
 * cannot live in the platform-agnostic `@ptah-extension/rpc-handlers` library.
 *
 * Methods registered:
 *   - `editor:revertFiles` — re-read open editor buffers from disk after a
 *     session-rewind has mutated files. Without this, users see stale
 *     unsaved content sitting on top of newly-rewound files.
 */

import { injectable, inject } from 'tsyringe';
import { Logger, RpcHandler, TOKENS } from '@ptah-extension/vscode-core';
import type { SentryService } from '@ptah-extension/vscode-core';
import type {
  EditorRevertFilesParams,
  EditorRevertFilesResult,
} from '@ptah-extension/shared';
import * as vscode from 'vscode';

/**
 * RPC handlers for VS Code text-editor operations.
 */
@injectable()
export class EditorRpcHandlers {
  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(TOKENS.RPC_HANDLER) private readonly rpcHandler: RpcHandler,
    @inject(TOKENS.SENTRY_SERVICE)
    private readonly sentryService: SentryService,
  ) {}

  /**
   * Register all editor RPC methods.
   */
  register(): void {
    this.registerRevertFiles();
    this.logger.debug('Editor RPC handlers registered', {
      methods: ['editor:revertFiles'],
    });
  }

  /**
   * `editor:revertFiles` — revert in-memory editor buffers for files whose
   * on-disk content has been changed externally (e.g. by a session rewind).
   *
   * Behaviour matches the contract:
   *   - For each file: if it's open in any text editor with unsaved changes,
   *     focus the document and run `workbench.action.files.revert`. Files
   *     not currently open (or open but clean) are silently skipped.
   *   - Returns the count of files actually reverted.
   *
   * Comparison uses `path.normalize`-style matching via VS Code's own URI
   * fsPath, which already normalises separators on Windows.
   */
  private registerRevertFiles(): void {
    this.rpcHandler.registerMethod<
      EditorRevertFilesParams,
      EditorRevertFilesResult
    >('editor:revertFiles', async (params) => {
      const requested = params?.files ?? [];
      this.logger.debug('RPC: editor:revertFiles called', {
        count: requested.length,
      });

      let revertedCount = 0;

      for (const filePath of requested) {
        try {
          const doc = vscode.workspace.textDocuments.find(
            (d) => d.uri.fsPath === filePath,
          );

          // Silently skip files that aren't open or have no pending edits.
          // Reverting a clean buffer would still trigger an editor jump
          // and is wasted work — the on-disk state is already correct.
          if (!doc || !doc.isDirty) {
            continue;
          }

          // `workbench.action.files.revert` operates on the *active* editor,
          // so we must show the document first. `preserveFocus: false` is
          // the default and ensures the revert command targets it.
          await vscode.window.showTextDocument(doc, {
            preview: false,
          });
          await vscode.commands.executeCommand('workbench.action.files.revert');

          revertedCount++;
        } catch (error) {
          // Per-file failures must not abort the whole batch — a rewind may
          // touch dozens of files and one transient editor glitch shouldn't
          // strand the rest in stale-buffer state.
          const errObj =
            error instanceof Error ? error : new Error(String(error));
          this.sentryService.captureException(errObj, {
            errorSource: 'EditorRpcHandlers.registerRevertFiles',
            extra: { filePath },
          });
          this.logger.warn(
            `RPC: editor:revertFiles failed for ${filePath}`,
            errObj,
          );
        }
      }

      this.logger.debug('RPC: editor:revertFiles completed', {
        requested: requested.length,
        revertedCount,
      });
      return { revertedCount };
    });
  }
}
