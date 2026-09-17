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

/** Opens workspace resources in an installed external editor. */
export interface IEditorLauncher {
  detect(): Promise<EditorTarget[]>;
  openFile(
    target: EditorTarget,
    filePath: string,
    line?: number,
  ): Promise<void>;
  openWorkspace(target: EditorTarget, workspaceRoot: string): Promise<void>;
}
