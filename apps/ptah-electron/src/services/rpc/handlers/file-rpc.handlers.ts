/**
 * Electron File RPC Handlers
 *
 * Handles file operation methods specific to Electron:
 * - file:read - Read file content using IFileSystemProvider
 * - file:exists - Check file existence using IFileSystemProvider
 * - file:save-dialog - Open native OS save dialog and write content
 * - file:pick - Open native file picker for attaching workspace files
 * - file:pick-images - Open native file picker for images, returns base64 data
 */

import { injectable, inject } from 'tsyringe';
import { TOKENS } from '@ptah-extension/vscode-core';
import type { Logger, RpcHandler } from '@ptah-extension/vscode-core';
import { PLATFORM_TOKENS } from '@ptah-extension/platform-core';
import type { IFileSystemProvider } from '@ptah-extension/platform-core';
import {
  MAX_IMAGE_SIZE_BYTES,
  resolveImageMediaType,
} from '@ptah-extension/shared';

@injectable()
export class FileRpcHandlers {
  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(TOKENS.RPC_HANDLER) private readonly rpcHandler: RpcHandler,
    @inject(PLATFORM_TOKENS.FILE_SYSTEM_PROVIDER)
    private readonly fileSystem: IFileSystemProvider,
  ) {}

  register(): void {
    this.registerRead();
    this.registerExists();
    this.registerSaveDialog();
    this.registerPick();
    this.registerPickImages();

    this.logger.debug('Electron File RPC handlers registered', {
      methods: [
        'file:read',
        'file:exists',
        'file:save-dialog',
        'file:pick',
        'file:pick-images',
      ],
    } as unknown as Error);
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
      },
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
      },
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
          | undefined,
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
            error instanceof Error ? error : new Error(String(error)),
          );
          return {
            saved: false,
            error: error instanceof Error ? error.message : String(error),
          };
        }
      },
    );
  }

  /**
   * file:pick - Open native file picker for attaching workspace files
   * Returns selected file paths without reading content.
   */
  private registerPick(): void {
    this.rpcHandler.registerMethod(
      'file:pick',
      async (params: { multiple?: boolean } | undefined) => {
        try {
          this.logger.debug('RPC: file:pick called', {
            multiple: params?.multiple,
          } as unknown as Error);

          const { dialog: electronDialog } = await import('electron');
          const fsModule = await import('node:fs/promises');

          const properties: Array<'openFile' | 'multiSelections'> = [
            'openFile' as const,
          ];
          if (params?.multiple !== false) {
            properties.push('multiSelections' as const);
          }

          const result = await electronDialog.showOpenDialog({
            properties,
            title: 'Attach Files',
          });

          if (result.canceled || result.filePaths.length === 0) {
            return { files: [] };
          }

          const files: Array<{ path: string; size: number }> = [];
          for (const filePath of result.filePaths) {
            const stat = await fsModule.stat(filePath).catch(() => null);
            files.push({
              path: filePath,
              size: stat?.size ?? 0,
            });
          }

          return { files };
        } catch (error) {
          this.logger.error(
            '[Electron RPC] file:pick failed',
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
          } as unknown as Error);

          const { dialog: electronDialog } = await import('electron');
          const fsModule = await import('node:fs/promises');
          const pathModule = await import('node:path');

          const properties: Array<'openFile' | 'multiSelections'> = [
            'openFile' as const,
          ];
          if (params?.multiple !== false) {
            properties.push('multiSelections' as const);
          }

          // Only offer extensions that map to Anthropic-allowed media types.
          // Magic-byte sniffing (below) is the source of truth.
          const result = await electronDialog.showOpenDialog({
            properties,
            title: 'Attach Images',
            filters: [
              {
                name: 'Images',
                extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp'],
              },
            ],
          });

          if (result.canceled || result.filePaths.length === 0) {
            return { images: [] };
          }

          const MAX_IMAGE_COUNT = 10;
          if (result.filePaths.length > MAX_IMAGE_COUNT) {
            return {
              images: [],
              error: `Too many images selected (${result.filePaths.length}). Maximum is ${MAX_IMAGE_COUNT}.`,
            };
          }

          const images: Array<{
            data: string;
            mediaType: string;
            name: string;
          }> = [];

          for (const filePath of result.filePaths) {
            const stat = await fsModule.stat(filePath);
            if (stat.size > MAX_IMAGE_SIZE_BYTES) {
              this.logger.warn(
                'RPC: file:pick-images skipping oversized file',
                {
                  path: filePath,
                  size: stat.size,
                } as unknown as Error,
              );
              continue;
            }

            const data = await fsModule.readFile(filePath);
            const base64 = data.toString('base64');
            // Sniff the bytes — extension is unreliable, magic bytes are
            // the only thing the Anthropic API will accept.
            const mediaType = resolveImageMediaType(undefined, base64);
            if (mediaType === null) {
              this.logger.warn(
                'RPC: file:pick-images skipping unsupported image (no matching magic bytes)',
                {
                  path: filePath,
                } as unknown as Error,
              );
              continue;
            }

            images.push({
              data: base64,
              mediaType,
              name: pathModule.basename(filePath),
            });
          }

          return { images };
        } catch (error) {
          this.logger.error(
            '[Electron RPC] file:pick-images failed',
            error instanceof Error ? error : new Error(String(error)),
          );
          return { images: [] };
        }
      },
    );
  }
}
