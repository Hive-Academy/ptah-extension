/**
 * Platform Abstraction Interfaces (TASK_2025_203)
 *
 * These interfaces abstract VS Code-specific APIs that Tier 2 handlers need.
 * Each platform (VS Code, Electron) provides its own implementation.
 *
 * Defined in the rpc-handlers library (not vscode-core) because:
 * - They are consumed by handler classes in this library
 * - Placing them here avoids circular dependencies
 * - Both apps import from @ptah-extension/rpc-handlers
 */

/**
 * IPlatformCommands - Platform-specific command execution.
 *
 * Replaces:
 * - vscode.commands.executeCommand('workbench.action.reloadWindow')
 * - vscode.window.createTerminal()
 */
export interface IPlatformCommands {
  /** Reload the application window */
  reloadWindow(): Promise<void>;
  /** Open a terminal with a command (for auth flows). No-op on Electron. */
  openTerminal(name: string, command: string): void;
}

/**
 * IPlatformAuthProvider - Platform-specific authentication.
 *
 * Replaces:
 * - vscode.authentication.getSession('github', ...)
 */
export interface IPlatformAuthProvider {
  /** Get GitHub username from platform auth session. Returns undefined if unavailable. */
  getGitHubUsername(): Promise<string | undefined>;
}

/**
 * ISaveDialogProvider - Platform-specific save dialog + file write.
 *
 * Replaces:
 * - vscode.window.showSaveDialog() + vscode.workspace.fs.writeFile()
 */
export interface ISaveDialogProvider {
  /**
   * Show a save dialog and write content to the selected path.
   * Returns the file path or null if cancelled.
   */
  showSaveAndWrite(options: {
    defaultFilename: string;
    filters: Record<string, string[]>;
    title: string;
    content: Buffer;
  }): Promise<string | null>;
}

/**
 * IModelDiscovery - Platform-specific LM model discovery.
 *
 * Replaces:
 * - vscode.lm.selectChatModels({ vendor: 'copilot' })
 */
export interface IModelDiscovery {
  /** Fetch available Copilot models from the platform's LM API. Returns empty array if unavailable. */
  getCopilotModels(): Promise<
    Array<{ id: string; name: string; contextLength: number }>
  >;
  /** Fetch available Codex models from the platform's LM API. Returns empty array if unavailable. */
  getCodexModels(): Promise<
    Array<{ id: string; name: string; contextLength: number }>
  >;
}
