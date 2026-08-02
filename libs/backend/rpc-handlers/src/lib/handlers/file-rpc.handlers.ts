/**
 * File RPC Handlers — the parts of the `file:` namespace about *choosing* and
 * *reading* files. (`file:open` means "reveal this in the host's editor" and
 * belongs to the editor surface, not here.)
 *
 * Unified from the VS Code and Electron copies, whose bodies were identical
 * apart from which dialog API they called. That call is now the IFileDialog
 * port, so the size / magic-byte / count rules for image attachment live in
 * one place instead of two that could drift.
 *
 * Split into three classes rather than one, because the three capabilities
 * are not co-extensive: the TUI can put a selection list in front of the user
 * (`filePicker`) but cannot attach image bytes (`filePickerImages`) and has no
 * business serving raw filesystem RPC (`fileSystemAccess`). A single class
 * would register all five methods for any host that wanted one of them,
 * silently breaking the manifest's exclusion guarantee.
 */

import { injectable, inject } from 'tsyringe';
import * as fs from 'fs/promises';
import * as path from 'path';
import { TOKENS } from '@ptah-extension/vscode-core';
import type { Logger, RpcHandler } from '@ptah-extension/vscode-core';
import { PLATFORM_TOKENS } from '@ptah-extension/platform-core';
import type {
  IFileDialog,
  IFileSystemProvider,
  ISaveDialogProvider,
} from '@ptah-extension/platform-core';
import type { RpcMethodName } from '@ptah-extension/shared';
import {
  MAX_IMAGE_SIZE_BYTES,
  resolveImageMediaType,
} from '@ptah-extension/shared';

/** Attaching more than this at once is a mis-click, not an intent. */
const MAX_IMAGE_COUNT = 10;

const DEFAULT_SAVE_FILTERS: Record<string, string[]> = {
  Markdown: ['md'],
  JSON: ['json'],
  CSV: ['csv'],
  Text: ['txt'],
  'All Files': ['*'],
};

/**
 * Raw filesystem access over RPC. Desktop-class hosts only — an editor-hosted
 * or headless host has no reason to expose this to a webview.
 */
@injectable()
export class FileSystemRpcHandlers {
  static readonly METHODS = [
    'file:read',
    'file:exists',
    'file:save-dialog',
  ] as const satisfies readonly RpcMethodName[];

  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(TOKENS.RPC_HANDLER) private readonly rpcHandler: RpcHandler,
    @inject(PLATFORM_TOKENS.FILE_SYSTEM_PROVIDER)
    private readonly fileSystem: IFileSystemProvider,
    @inject(TOKENS.SAVE_DIALOG_PROVIDER)
    private readonly saveDialog: ISaveDialogProvider,
  ) {}

  register(): void {
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

    this.registerSaveDialog();
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
          const filters = params.filters
            ? Object.fromEntries(
                params.filters.map((f) => [f.name, f.extensions]),
              )
            : DEFAULT_SAVE_FILTERS;

          const filePath = await this.saveDialog.showSaveAndWrite({
            defaultFilename: params.defaultFileName ?? '',
            filters,
            title: 'Save File',
            content: Buffer.from(params.content, 'utf-8'),
          });

          if (!filePath) return { saved: false };
          return { saved: true, filePath };
        } catch (error: unknown) {
          this.logger.error(
            'RPC: file:save-dialog failed',
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
}

/** Attach workspace files by path. Any host that can ask the user to choose. */
@injectable()
export class FilePickerRpcHandlers {
  static readonly METHODS = [
    'file:pick',
  ] as const satisfies readonly RpcMethodName[];

  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(TOKENS.RPC_HANDLER) private readonly rpcHandler: RpcHandler,
    @inject(PLATFORM_TOKENS.FILE_DIALOG)
    private readonly fileDialog: IFileDialog,
  ) {}

  register(): void {
    this.rpcHandler.registerMethod(
      'file:pick',
      async (params: { multiple?: boolean } | undefined) => {
        try {
          const paths = await this.fileDialog.openFiles({
            multiple: params?.multiple !== false,
            title: 'Attach Files',
          });

          const files: Array<{ path: string; size: number }> = [];
          for (const filePath of paths) {
            const stat = await fs.stat(filePath).catch(() => null);
            files.push({ path: filePath, size: stat?.size ?? 0 });
          }
          return { files };
        } catch (error: unknown) {
          this.logger.error(
            'RPC: file:pick failed',
            error instanceof Error ? error : new Error(String(error)),
          );
          return { files: [] };
        }
      },
    );
  }
}

/** Attach images as base64. Needs a host surface that can render them back. */
@injectable()
export class ImagePickerRpcHandlers {
  static readonly METHODS = [
    'file:pick-images',
  ] as const satisfies readonly RpcMethodName[];

  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(TOKENS.RPC_HANDLER) private readonly rpcHandler: RpcHandler,
    @inject(PLATFORM_TOKENS.FILE_DIALOG)
    private readonly fileDialog: IFileDialog,
  ) {}

  register(): void {
    this.rpcHandler.registerMethod(
      'file:pick-images',
      async (params: { multiple?: boolean } | undefined) => {
        try {
          const paths = await this.fileDialog.openFiles({
            multiple: params?.multiple !== false,
            title: 'Attach Images',
            filters: { Images: ['png', 'jpg', 'jpeg', 'gif', 'webp'] },
          });

          if (paths.length === 0) return { images: [] };
          if (paths.length > MAX_IMAGE_COUNT) {
            return {
              images: [],
              error: `Too many images selected (${paths.length}). Maximum is ${MAX_IMAGE_COUNT}.`,
            };
          }

          return { images: await this.readImages(paths) };
        } catch (error: unknown) {
          this.logger.error(
            'RPC: file:pick-images failed',
            error instanceof Error ? error : new Error(String(error)),
          );
          return { images: [] };
        }
      },
    );
  }

  /**
   * Read the selected images as base64, skipping anything oversized or whose
   * magic bytes do not match a supported format. A skipped file is a warning,
   * not a failure — the user still gets the images that were usable.
   */
  private async readImages(
    paths: readonly string[],
  ): Promise<Array<{ data: string; mediaType: string; name: string }>> {
    const images: Array<{ data: string; mediaType: string; name: string }> = [];

    for (const filePath of paths) {
      const stat = await fs.stat(filePath);
      if (stat.size > MAX_IMAGE_SIZE_BYTES) {
        this.logger.warn('RPC: file:pick-images skipping oversized file', {
          path: filePath,
          size: stat.size,
        });
        continue;
      }

      const base64 = (await fs.readFile(filePath)).toString('base64');
      const mediaType = resolveImageMediaType(undefined, base64);
      if (mediaType === null) {
        this.logger.warn(
          'RPC: file:pick-images skipping unsupported image (no matching magic bytes)',
          { path: filePath },
        );
        continue;
      }

      images.push({
        data: base64,
        mediaType,
        name: path.basename(filePath),
      });
    }

    return images;
  }
}
