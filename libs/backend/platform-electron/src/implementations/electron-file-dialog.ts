/**
 * ElectronFileDialog — IFileDialog via the OS-native open dialog.
 */

import { injectable } from 'tsyringe';
import type { IFileDialog } from '@ptah-extension/platform-core';

@injectable()
export class ElectronFileDialog implements IFileDialog {
  async openFiles(options: {
    multiple: boolean;
    title: string;
    filters?: Record<string, string[]>;
  }): Promise<readonly string[]> {
    const { dialog } = await import('electron');

    const properties: Array<'openFile' | 'multiSelections'> = ['openFile'];
    if (options.multiple) {
      properties.push('multiSelections');
    }

    const result = await dialog.showOpenDialog({
      properties,
      title: options.title,
      ...(options.filters
        ? {
            filters: Object.entries(options.filters).map(
              ([name, extensions]) => ({ name, extensions }),
            ),
          }
        : {}),
    });

    if (result.canceled) return [];
    return result.filePaths;
  }
}
