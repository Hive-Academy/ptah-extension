/**
 * IEditorProvider — Platform-agnostic active editor and document events.
 *
 * Replaces: vscode.window.onDidChangeActiveTextEditor,
 *           vscode.workspace.onDidOpenTextDocument
 */

import type { IEvent } from '../types/platform.types';

export interface IEditorProvider {
  /**
   * Event fired when the active text editor changes.
   * Replaces: vscode.window.onDidChangeActiveTextEditor
   *
   * Provides the file path of the new active editor, or undefined if none.
   */
  readonly onDidChangeActiveEditor: IEvent<{ filePath: string | undefined }>;

  /**
   * Event fired when a text document is opened.
   * Replaces: vscode.workspace.onDidOpenTextDocument
   */
  readonly onDidOpenDocument: IEvent<{ filePath: string }>;

  /**
   * Get the currently active editor's file path.
   * Replaces: vscode.window.activeTextEditor?.document.uri.fsPath
   */
  getActiveEditorPath(): string | undefined;
}
