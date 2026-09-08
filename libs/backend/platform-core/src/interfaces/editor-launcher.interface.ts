/** Stable identifiers understood by every editor-launcher adapter. */
export type EditorTargetId = 'vscode' | 'cursor' | 'antigravity' | 'zed';

/**
 * A detected editor and the concrete launch route that proved it exists.
 * Exactly one of `executablePath` and `deepLinkScheme` is present.
 */
export interface EditorTarget {
  readonly id: EditorTargetId;
  readonly displayName: string;
  readonly executablePath?: string;
  readonly deepLinkScheme?: 'vscode' | 'cursor';
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
