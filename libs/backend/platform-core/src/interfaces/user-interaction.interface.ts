/**
 * IUserInteraction — Platform-agnostic user notification and input.
 *
 * Replaces: vscode.window.showErrorMessage, showWarningMessage,
 *           showInformationMessage, showQuickPick, showInputBox, withProgress
 */

import type {
  QuickPickItem,
  QuickPickOptions,
  InputBoxOptions,
  ProgressOptions,
  IProgress,
  ICancellationToken,
} from '../types/platform.types';

export interface IUserInteraction {
  /**
   * Show an error message with optional action buttons.
   * Replaces: vscode.window.showErrorMessage()
   *
   * @returns The selected action label, or undefined if dismissed
   */
  showErrorMessage(
    message: string,
    ...actions: string[]
  ): Promise<string | undefined>;

  /**
   * Show a warning message with optional action buttons.
   * Replaces: vscode.window.showWarningMessage()
   */
  showWarningMessage(
    message: string,
    ...actions: string[]
  ): Promise<string | undefined>;

  /**
   * Show an information message with optional action buttons.
   * Replaces: vscode.window.showInformationMessage()
   */
  showInformationMessage(
    message: string,
    ...actions: string[]
  ): Promise<string | undefined>;

  /**
   * Show a quick pick selection dialog.
   * Replaces: vscode.window.showQuickPick()
   */
  showQuickPick(
    items: QuickPickItem[],
    options?: QuickPickOptions,
  ): Promise<QuickPickItem | undefined>;

  /**
   * Show an input box for text input.
   * Replaces: vscode.window.showInputBox()
   */
  showInputBox(options?: InputBoxOptions): Promise<string | undefined>;

  /**
   * Show progress with a long-running task.
   * Replaces: vscode.window.withProgress()
   */
  withProgress<T>(
    options: ProgressOptions,
    task: (progress: IProgress, token: ICancellationToken) => Promise<T>,
  ): Promise<T>;

  /**
   * Open a URL in the user's default browser.
   * Replaces: vscode.env.openExternal()
   *
   * @returns true if the URL was opened successfully
   */
  openExternal(url: string): Promise<boolean>;

  /**
   * Write text to the system clipboard.
   * Replaces: vscode.env.clipboard.writeText()
   */
  writeToClipboard(text: string): Promise<void>;
}
