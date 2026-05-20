/**
 * Platform Abstraction Interfaces (L0.5)
 *
 * These interfaces abstract platform-specific APIs (VS Code, Electron, CLI)
 * that higher-layer code (rpc-handlers, agent-sdk, app-level services) needs.
 * Each platform (VS Code, Electron, CLI) provides its own implementation.
 *
 * Defined in platform-core (L0.5) per the monorepo layer rule:
 * platform abstraction interfaces live at the same layer as PLATFORM_TOKENS.
 *
 * The rpc-handlers public barrel re-exports from here for backwards-compatible
 * consumption; new code should import from @ptah-extension/platform-core.
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
  /**
   * Bring the chat view to the front / focus it.
   *
   * VS Code: focuses the `ptah.main` view via
   *   `vscode.commands.executeCommand('ptah.main.focus')`.
   * Electron: broadcasts `MESSAGE_TYPES.SWITCH_VIEW` with `view: 'chat'`
   *   so the renderer routes to the chat surface.
   * CLI: no-op (no UI to focus).
   */
  focusChat(): Promise<void>;
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
