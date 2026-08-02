/**
 * VscodeFileDialog — IFileDialog via `vscode.window.showOpenDialog`.
 *
 * Opens at the first workspace folder so the user starts where their code is
 * rather than wherever the editor was last pointed.
 */

import { injectable } from 'tsyringe';
import * as vscode from 'vscode';
import type { IFileDialog } from '@ptah-extension/platform-core';

@injectable()
export class VscodeFileDialog implements IFileDialog {
  async openFiles(options: {
    multiple: boolean;
    title: string;
    filters?: Record<string, string[]>;
  }): Promise<readonly string[]> {
    const uris = await vscode.window.showOpenDialog({
      canSelectFiles: true,
      canSelectFolders: false,
      canSelectMany: options.multiple,
      defaultUri: vscode.workspace.workspaceFolders?.[0]?.uri,
      title: options.title,
      ...(options.filters ? { filters: options.filters } : {}),
    });

    if (!uris) return [];
    return uris.map((uri) => uri.fsPath);
  }
}
