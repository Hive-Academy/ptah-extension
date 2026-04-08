/**
 * CLI Save Dialog Provider Implementation (TASK_2025_263)
 *
 * Implements ISaveDialogProvider for the CLI/TUI environment:
 * - showSaveAndWrite: Writes content to the specified default filename
 *   in the current working directory (no interactive dialog in CLI).
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import type { ISaveDialogProvider } from '@ptah-extension/rpc-handlers';

export class CliSaveDialog implements ISaveDialogProvider {
  async showSaveAndWrite(options: {
    defaultFilename: string;
    filters: Record<string, string[]>;
    title: string;
    content: Buffer;
  }): Promise<string | null> {
    try {
      const filePath = path.join(process.cwd(), options.defaultFilename);

      // Ensure the parent directory exists
      const dir = path.dirname(filePath);
      await fs.mkdir(dir, { recursive: true });

      await fs.writeFile(filePath, options.content);

      return filePath;
    } catch {
      return null;
    }
  }
}
