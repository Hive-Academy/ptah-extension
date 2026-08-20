/**
 * File RPC Handlers — `file:open` only.
 *
 * Reveals a path in the VS Code editor, with optional line navigation.
 * Picking and reading files moved to `@ptah-extension/rpc-handlers`; this
 * remainder follows in the editor-family migration.
 */

import { injectable, inject } from 'tsyringe';
import { Logger, RpcHandler, TOKENS } from '@ptah-extension/vscode-core';
import type { SentryService } from '@ptah-extension/vscode-core';
import { FileOpenParams, FileOpenResult } from '@ptah-extension/shared';
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

/**
 * RPC handlers for file operations
 */
@injectable()
export class FileRpcHandlers {
  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(TOKENS.RPC_HANDLER) private readonly rpcHandler: RpcHandler,
    @inject(TOKENS.SENTRY_SERVICE)
    private readonly sentryService: SentryService,
  ) {}

  /**
   * Register all file RPC methods
   */
  register(): void {
    this.registerFileOpen();

    this.logger.debug('File RPC handlers registered', {
      methods: ['file:open'],
    });
  }

  /**
   * file:open - Open file in VS Code editor
   */
  private registerFileOpen(): void {
    this.rpcHandler.registerMethod<FileOpenParams, FileOpenResult>(
      'file:open',
      async (params) => {
        try {
          const { path, line } = params;
          this.logger.debug('RPC: file:open called', { path, line });
          const stats = await fs.promises.stat(path).catch(() => null);

          if (!stats) {
            return { success: false, error: `Path not found: ${path}` };
          }

          if (stats.isDirectory()) {
            const uri = vscode.Uri.file(path);
            await vscode.commands.executeCommand('revealInExplorer', uri);
            return { success: true, isDirectory: true };
          }
          const uri = vscode.Uri.file(path);
          const document = await vscode.workspace.openTextDocument(uri);
          const editor = await vscode.window.showTextDocument(document);
          if (typeof line === 'number' && line > 0) {
            const position = new vscode.Position(line - 1, 0);
            editor.selection = new vscode.Selection(position, position);
            editor.revealRange(
              new vscode.Range(position, position),
              vscode.TextEditorRevealType.InCenter,
            );
          }

          return { success: true };
        } catch (error) {
          this.sentryService.captureException(
            error instanceof Error ? error : new Error(String(error)),
            { errorSource: 'FileRpcHandlers.registerFileOpen' },
          );
          this.logger.error(
            'RPC: file:open failed',
            error instanceof Error ? error : new Error(String(error)),
          );
          return {
            success: false,
            error: error instanceof Error ? error.message : String(error),
          };
        }
      },
    );
  }
}
