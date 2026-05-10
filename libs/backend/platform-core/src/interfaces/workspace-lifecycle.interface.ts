/**
 * IWorkspaceLifecycleProvider — Platform-agnostic workspace lifecycle mutations.
 *
 * Companion to `IWorkspaceProvider` (read-only access). Concrete platform
 * implementations (`ElectronWorkspaceProvider`, `CliWorkspaceProvider`) are
 * expected to register the same instance under both `PLATFORM_TOKENS.WORKSPACE_PROVIDER`
 * and `PLATFORM_TOKENS.WORKSPACE_LIFECYCLE_PROVIDER` so consumers that need
 * lifecycle methods can request them via a typed second injection rather than
 * casting `IWorkspaceProvider` to a concrete class.
 *
 * TASK_2026_104 Sub-batch B5a: Introduced when lifting `WorkspaceRpcHandlers`
 * from the Electron app into the shared `rpc-handlers` library so all three
 * apps (VS Code, Electron, CLI) can serve the `workspace:*` RPC surface.
 */

export interface IWorkspaceLifecycleProvider {
  /**
   * Add a folder to the workspace.
   * Implementations should deduplicate (no duplicate paths) and fire the
   * companion provider's `onDidChangeWorkspaceFolders` event when the folder
   * was actually added.
   */
  addFolder(folderPath: string): void;

  /**
   * Remove a folder from the workspace.
   * If the removed folder was the active folder, implementations should
   * promote the first remaining folder (or `undefined` if none remain).
   * Fires `onDidChangeWorkspaceFolders` when the folder was actually removed.
   */
  removeFolder(folderPath: string): void;

  /**
   * Set the active (primary) workspace folder.
   * The path must already exist in the folders array; implementations should
   * no-op for unknown paths. Fires `onDidChangeWorkspaceFolders` on success.
   */
  setActiveFolder(folderPath: string): void;

  /**
   * Get the currently active workspace folder, or `undefined` if none is set.
   */
  getActiveFolder(): string | undefined;

  /**
   * Store a transient origin token immediately before calling setActiveFolder().
   * The token is read-and-cleared by the workspace broadcast listener so the
   * push event can echo the token back to the frontend for self-echo suppression.
   * Optional — platforms that do not broadcast push events (VS Code, CLI) leave this unimplemented.
   */
  setPendingOrigin?(origin: string | null): void;
}
