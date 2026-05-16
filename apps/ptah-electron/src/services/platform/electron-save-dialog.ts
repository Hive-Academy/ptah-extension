/**
 * Electron Save Dialog Provider Implementation
 *
 * Implements ISaveDialogProvider using Electron dialog API + Node fs:
 * - showSaveAndWrite: dialog.showSaveDialog() + fs.writeFile()
 */

import { injectable, inject } from 'tsyringe';
import { TOKENS } from '@ptah-extension/vscode-core';
import type { Logger } from '@ptah-extension/vscode-core';
import type { ISaveDialogProvider } from '@ptah-extension/rpc-handlers';
import * as fs from 'fs/promises';

@injectable()
export class ElectronSaveDialog implements ISaveDialogProvider {
  constructor(@inject(TOKENS.LOGGER) private readonly logger: Logger) {}

  async showSaveAndWrite(options: {
    defaultFilename: string;
    filters: Record<string, string[]>;
    title: string;
    content: Buffer;
  }): Promise<string | null> {
    try {
      // Dynamic import to avoid bundling issues
      const { dialog } = await import('electron');

      // Convert filters to Electron format
      const electronFilters = Object.entries(options.filters).map(
        ([name, extensions]) => ({
          name,
          extensions,
        }),
      );

      const result = await dialog.showSaveDialog({
        title: options.title,
        defaultPath: options.defaultFilename,
        filters: electronFilters,
      });

      if (result.canceled || !result.filePath) {
        return null;
      }

      await fs.writeFile(result.filePath, options.content);

      this.logger.info('[ElectronSaveDialog] File saved successfully', {
        filePath: result.filePath,
      });

      return result.filePath;
    } catch (error) {
      this.logger.error('[ElectronSaveDialog] Failed to save file', {
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }
}
