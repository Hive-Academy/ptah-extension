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
      // Sanitize filename to prevent path traversal — strip directory components
      const safeName = path.basename(options.defaultFilename);
      if (!safeName) return null;

      const cwd = process.cwd();
      const filePath = path.resolve(cwd, safeName);

      // Verify the resolved path is still under cwd
      if (!filePath.startsWith(cwd + path.sep) && filePath !== cwd) {
        return null;
      }

      await fs.writeFile(filePath, options.content);

      return filePath;
    } catch {
      return null;
    }
  }
}
