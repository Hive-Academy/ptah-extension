/**
 * VscodeEditorProvider — IEditorProvider implementation using VS Code window/workspace events.
 */

import * as vscode from 'vscode';
import type { IEditorProvider } from '@ptah-extension/platform-core';
import type { IEvent } from '@ptah-extension/platform-core';
import { createEvent } from '@ptah-extension/platform-core';

export class VscodeEditorProvider implements IEditorProvider {
  public readonly onDidChangeActiveEditor: IEvent<{
    filePath: string | undefined;
  }>;
  public readonly onDidOpenDocument: IEvent<{ filePath: string }>;

  private disposables: vscode.Disposable[] = [];

  constructor() {
    const [editorEvent, fireEditor] = createEvent<{
      filePath: string | undefined;
    }>();
    this.onDidChangeActiveEditor = editorEvent;

    const [docEvent, fireDoc] = createEvent<{ filePath: string }>();
    this.onDidOpenDocument = docEvent;

    this.disposables.push(
      vscode.window.onDidChangeActiveTextEditor((editor) => {
        fireEditor({
          filePath: editor?.document.uri.fsPath,
        });
      })
    );

    this.disposables.push(
      vscode.workspace.onDidOpenTextDocument((doc) => {
        fireDoc({ filePath: doc.uri.fsPath });
      })
    );
  }

  getActiveEditorPath(): string | undefined {
    return vscode.window.activeTextEditor?.document.uri.fsPath;
  }

  dispose(): void {
    this.disposables.forEach((d) => d.dispose());
    this.disposables = [];
  }
}
