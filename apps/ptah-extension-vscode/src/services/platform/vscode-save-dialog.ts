/**
 * VS Code Save Dialog Provider Implementation.
 *
 * Implements ISaveDialogProvider using VS Code APIs:
 * - showSaveAndWrite: vscode.window.showSaveDialog() + vscode.workspace.fs.writeFile()
 */

import { injectable } from 'tsyringe';
import * as vscode from 'vscode';
import type { ISaveDialogProvider } from '@ptah-extension/rpc-handlers';

@injectable()
export class VsCodeSaveDialog implements ISaveDialogProvider {
  async showSaveAndWrite(options: {
    defaultFilename: string;
    filters: Record<string, string[]>;
    title: string;
    content: Buffer;
  }): Promise<string | null> {
    const defaultUri = vscode.Uri.file(options.defaultFilename);
    const saveUri = await vscode.window.showSaveDialog({
      defaultUri,
      filters: options.filters,
      title: options.title,
    });

    if (!saveUri) {
      return null;
    }

    await vscode.workspace.fs.writeFile(saveUri, options.content);
    return saveUri.fsPath;
  }
}
