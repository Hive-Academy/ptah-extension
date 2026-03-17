/**
 * Electron File RPC Handlers
 *
 * Handles file operation methods specific to Electron:
 * - file:read - Read file content using IFileSystemProvider
 * - file:exists - Check file existence using IFileSystemProvider
 * - file:save-dialog - Open native OS save dialog and write content
 *
 * TASK_2025_203 Batch 5: Extracted from inline registrations
 */

import { injectable, inject } from 'tsyringe';
import { TOKENS } from '@ptah-extension/vscode-core';
import type { Logger, RpcHandler } from '@ptah-extension/vscode-core';
import { PLATFORM_TOKENS } from '@ptah-extension/platform-core';
import type { IFileSystemProvider } from '@ptah-extension/platform-core';

@injectable()
export class ElectronFileRpcHandlers {
  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(TOKENS.RPC_HANDLER) private readonly rpcHandler: RpcHandler,
    @inject(PLATFORM_TOKENS.FILE_SYSTEM_PROVIDER)
    private readonly fileSystem: IFileSystemProvider
  ) {}

  register(): void {
    this.registerRead();
    this.registerExists();
    this.registerSaveDialog();
  }

  private registerRead(): void {
    this.rpcHandler.registerMethod(
      'file:read',
      async (params: { path: string } | undefined) => {
        if (!params?.path) {
          throw new Error('path is required');
        }
        const content = await this.fileSystem.readFile(params.path);
        return { content };
      }
    );
  }

  private registerExists(): void {
    this.rpcHandler.registerMethod(
      'file:exists',
      async (params: { path: string } | undefined) => {
        if (!params?.path) {
          return { exists: false };
        }
        const exists = await this.fileSystem.exists(params.path);
        return { exists };
      }
    );
  }

  private registerSaveDialog(): void {
    this.rpcHandler.registerMethod(
      'file:save-dialog',
      async (
        params:
          | {
              content: string;
              defaultFileName?: string;
              filters?: Array<{ name: string; extensions: string[] }>;
            }
          | undefined
      ) => {
        if (!params?.content) {
          return { saved: false, error: 'No content provided' };
        }

        try {
          const { dialog: electronDialog } = await import('electron');
          const fs = await import('node:fs/promises');

          const defaultFilters: Array<{
            name: string;
            extensions: string[];
          }> = [
            { name: 'Markdown', extensions: ['md'] },
            { name: 'JSON', extensions: ['json'] },
            { name: 'CSV', extensions: ['csv'] },
            { name: 'Text', extensions: ['txt'] },
            { name: 'All Files', extensions: ['*'] },
          ];

          const result = await electronDialog.showSaveDialog({
            defaultPath: params.defaultFileName,
            filters: params.filters ?? defaultFilters,
          });

          if (result.canceled || !result.filePath) {
            return { saved: false };
          }

          await fs.writeFile(result.filePath, params.content, 'utf-8');
          this.logger.info('[Electron RPC] file:save-dialog wrote file', {
            filePath: result.filePath,
          } as unknown as Error);

          return { saved: true, filePath: result.filePath };
        } catch (error) {
          this.logger.error(
            '[Electron RPC] file:save-dialog failed',
            error instanceof Error ? error : new Error(String(error))
          );
          return {
            saved: false,
            error: error instanceof Error ? error.message : String(error),
          };
        }
      }
    );
  }
}
