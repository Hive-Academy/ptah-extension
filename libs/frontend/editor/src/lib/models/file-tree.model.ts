/**
 * FileTreeNode - Represents a file or directory in the workspace file tree.
 *
 * Used by FileTreeComponent and FileTreeNodeComponent to render
 * a hierarchical file explorer sidebar.
 */
export interface FileTreeNode {
  /** Display name of the file or directory */
  name: string;
  /** Full path to the file or directory */
  path: string;
  /** Whether this node is a file or directory */
  type: 'file' | 'directory';
  /** Child nodes (only for directories) */
  children?: FileTreeNode[];
  /** Whether a directory is expanded in the tree view */
  expanded?: boolean;
}
