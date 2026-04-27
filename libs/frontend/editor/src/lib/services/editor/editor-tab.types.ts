/** Represents an open editor tab */
export interface EditorTab {
  filePath: string;
  fileName: string;
  content: string;
  isDirty: boolean;
  /** Whether this tab shows a diff view instead of a regular editor */
  isDiff?: boolean;
  /** Original (HEAD) content for diff tabs */
  originalContent?: string;
  /** Relative path within the workspace for diff tabs */
  diffRelativePath?: string;
}
