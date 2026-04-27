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

  /**
   * Surface an OAuth verification URL + device code to the user / connected client.
   *
   * - VS Code & Electron: opens the URL in the system browser (delegates to openExternal),
   *   optionally shows a clipboard toast with the user code.
   * - CLI (headless): emits a JSON-RPC `oauth.url.open` request to the connected client
   *   and waits for the response. Falls back to printing the URL to stderr when no
   *   JSON-RPC peer is attached.
   *
   * Returns the optional code echoed back by the client (CLI only) and whether the URL
   * was opened. Implementations MUST NOT block longer than ~5 seconds for the round-trip.
   */
  openOAuthUrl(params: {
    provider: 'copilot' | 'codex' | 'claude' | string;
    verificationUri: string;
    userCode?: string;
  }): Promise<{ opened: boolean; code?: string }>;

  /**
   * Open a native folder/file picker. Optional — only platforms with a real
   * desktop UI (Electron, VS Code) implement this. Headless / CLI hosts should
   * leave this undefined; callers must handle the absent case.
   *
   * Returns an array of selected absolute paths (single-element when
   * `properties.openDirectory` is used without `multiSelections`), or an empty
   * array when the user cancels.
   *
   * TASK_2026_104 Sub-batch B5a: Added so the lifted `WorkspaceRpcHandlers`
   * can request a directory without `import('electron')`.
   */
  showOpenDialog?(options: {
    title?: string;
    defaultPath?: string;
    properties?: Array<
      | 'openFile'
      | 'openDirectory'
      | 'multiSelections'
      | 'showHiddenFiles'
      | 'createDirectory'
    >;
  }): Promise<string[]>;
}
