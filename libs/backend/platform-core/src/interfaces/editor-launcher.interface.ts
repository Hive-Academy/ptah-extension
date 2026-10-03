/** Stable identifiers understood by every editor-launcher adapter. */
export type EditorTargetId =
  | 'vscode'
  | 'cursor'
  | 'antigravity'
  | 'zed'
  | 'kiro'
  /**
   * An external terminal opened at a folder (displayName "Terminal").
   * Workspace-only: `openFile` with this target rejects, and the RPC layer
   * turns that into `{ success: false }`.
   */
  | 'terminal';

/**
 * A detected editor and the concrete executable path that proved it exists.
 * The host VS Code adapter may also use an in-process target without a path.
 */
export interface EditorTarget {
  readonly id: EditorTargetId;
  readonly displayName: string;
  readonly executablePath?: string;
}

/**
 * The four files of a three-way merge, every one an absolute path.
 *
 * `local`, `remote` and `base` are the materialized conflict stages (`:2:`,
 * `:3:`, `:1:`); `result` is the working-tree file the editor writes the
 * resolution into.
 */
export interface EditorMergeRequest {
  readonly local: string;
  readonly remote: string;
  readonly base: string;
  readonly result: string;
}

/**
 * What `openMergeTool` did. It never rejects.
 *
 * - `launched`: the editor process started with the merge argv.
 * - `unsupported`: the target's definition declares no merge argv, so nothing
 *   was spawned. The caller opens the result file instead (A11).
 * - `failed`: validation or the spawn failed. `error` is the raw cause for the
 *   host log only — it may carry an executable path and must never cross into
 *   the renderer.
 */
export type EditorMergeLaunchResult =
  | { readonly status: 'launched' }
  | { readonly status: 'unsupported' }
  | { readonly status: 'failed'; readonly error: Error };

/** Opens workspace resources in an installed external editor. */
export interface IEditorLauncher {
  detect(): Promise<EditorTarget[]>;
  openFile(
    target: EditorTarget,
    filePath: string,
    line?: number,
  ): Promise<void>;
  openWorkspace(target: EditorTarget, workspaceRoot: string): Promise<void>;
  /**
   * Open the editor's three-way merge view. Optional: an adapter that cannot
   * launch one omits it, and the caller opens the file instead.
   */
  openMergeTool?(
    target: EditorTarget,
    request: EditorMergeRequest,
  ): Promise<EditorMergeLaunchResult>;
}
