/**
 * File RPC Handlers — handles file:open, file:pick, file:pick-images.
 *
 * Opens files in VS Code editor with optional line navigation. Provides
 * native file picker dialogs for attaching files and images.
 */

import { injectable, inject } from 'tsyringe';
import { Logger, RpcHandler, TOKENS } from '@ptah-extension/vscode-core';
import type { SentryService } from '@ptah-extension/vscode-core';
import {
  FileOpenParams,
  FileOpenResult,
  MAX_IMAGE_SIZE_BYTES,
  resolveImageMediaType,
} from '@ptah-extension/shared';
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
    this.registerPick();
    this.registerPickImages();

    this.logger.debug('File RPC handlers registered', {
      methods: ['file:open', 'file:pick', 'file:pick-images'],
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

          // Check if path is a directory (Claude sometimes reads directories by mistake)
          const stats = await fs.promises.stat(path).catch(() => null);

          if (!stats) {
            return { success: false, error: `Path not found: ${path}` };
          }

          if (stats.isDirectory()) {
            // For directories, reveal in explorer instead of opening as file
            const uri = vscode.Uri.file(path);
            await vscode.commands.executeCommand('revealInExplorer', uri);
            return { success: true, isDirectory: true };
          }

          // Open the document and show it in editor
          const uri = vscode.Uri.file(path);
          const document = await vscode.workspace.openTextDocument(uri);
          const editor = await vscode.window.showTextDocument(document);

          // If line number specified, navigate to it
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

  /**
   * file:pick - Open native file picker for workspace files
   * Returns selected file paths with size metadata.
   */
  private registerPick(): void {
    this.rpcHandler.registerMethod(
      'file:pick',
      async (params: { multiple?: boolean } | undefined) => {
        try {
          this.logger.debug('RPC: file:pick called', {
            multiple: params?.multiple,
          });

          const fileUris = await vscode.window.showOpenDialog({
            canSelectFiles: true,
            canSelectFolders: false,
            canSelectMany: params?.multiple !== false,
            defaultUri: vscode.workspace.workspaceFolders?.[0]?.uri,
            title: 'Attach Files',
          });

          if (!fileUris || fileUris.length === 0) {
            return { files: [] };
          }

          const files: Array<{ path: string; size: number }> = [];
          for (const uri of fileUris) {
            const stat = await fs.promises.stat(uri.fsPath).catch(() => null);
            files.push({
              path: uri.fsPath,
              size: stat?.size ?? 0,
            });
          }

          return { files };
        } catch (error) {
          this.sentryService.captureException(
            error instanceof Error ? error : new Error(String(error)),
            { errorSource: 'FileRpcHandlers.registerPick' },
          );
          this.logger.error(
            'RPC: file:pick failed',
            error instanceof Error ? error : new Error(String(error)),
          );
          return { files: [] };
        }
      },
    );
  }

  /**
   * file:pick-images - Open native file picker for images, returns base64 data
   * Filters to common image formats and reads selected files as base64.
   */
  private registerPickImages(): void {
    this.rpcHandler.registerMethod(
      'file:pick-images',
      async (params: { multiple?: boolean } | undefined) => {
        try {
          this.logger.debug('RPC: file:pick-images called', {
            multiple: params?.multiple,
          });

          // Only offer extensions that map to Anthropic-allowed media types.
          // Magic-byte sniffing (below) is the source of truth — the filter
          // is just a UX hint.
          const imageUris = await vscode.window.showOpenDialog({
            canSelectFiles: true,
            canSelectFolders: false,
            canSelectMany: params?.multiple !== false,
            defaultUri: vscode.workspace.workspaceFolders?.[0]?.uri,
            title: 'Attach Images',
            filters: {
              Images: ['png', 'jpg', 'jpeg', 'gif', 'webp'],
            },
          });

          if (!imageUris || imageUris.length === 0) {
            return { images: [] };
          }

          const MAX_IMAGE_COUNT = 10;
          if (imageUris.length > MAX_IMAGE_COUNT) {
            return {
              images: [],
              error: `Too many images selected (${imageUris.length}). Maximum is ${MAX_IMAGE_COUNT}.`,
            };
          }

          const images: Array<{
            data: string;
            mediaType: string;
            name: string;
          }> = [];

          for (const uri of imageUris) {
            const stat = await fs.promises.stat(uri.fsPath);
            if (stat.size > MAX_IMAGE_SIZE_BYTES) {
              this.logger.warn(
                'RPC: file:pick-images skipping oversized file',
                {
                  path: uri.fsPath,
                  size: stat.size,
                } as unknown as Error,
              );
              continue;
            }

            const data = await fs.promises.readFile(uri.fsPath);
            const base64 = data.toString('base64');
            // Sniff the bytes — extension/MIME are unreliable, magic bytes
            // are the only thing the Anthropic API will accept.
            const mediaType = resolveImageMediaType(undefined, base64);
            if (mediaType === null) {
              this.logger.warn(
                'RPC: file:pick-images skipping unsupported image (no matching magic bytes)',
                {
                  path: uri.fsPath,
                } as unknown as Error,
              );
              continue;
            }

            images.push({
              data: base64,
              mediaType,
              name: path.basename(uri.fsPath),
            });
          }

          return { images };
        } catch (error) {
          this.sentryService.captureException(
            error instanceof Error ? error : new Error(String(error)),
            { errorSource: 'FileRpcHandlers.registerPickImages' },
          );
          this.logger.error(
            'RPC: file:pick-images failed',
            error instanceof Error ? error : new Error(String(error)),
          );
          return { images: [] };
        }
      },
    );
  }
}
