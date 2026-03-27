/**
 * Editor Library - Main Entry Point
 *
 * ARCHITECTURE: Monaco-based code editor with file tree explorer and git integration
 *
 * COMPONENTS:
 * - EditorPanelComponent: Main container (file tree + code editor + git status bar)
 * - FileTreeComponent: File explorer sidebar
 * - FileTreeNodeComponent: Recursive tree node with git status badges
 * - CodeEditorComponent: Monaco editor wrapper
 * - GitStatusBarComponent: Branch info, ahead/behind counts, changed file count
 *
 * SERVICES:
 * - EditorService: File state management and backend RPC communication
 * - GitStatusService: Git status polling and workspace-partitioned git state
 *
 * MODELS:
 * - FileTreeNode: File/directory tree structure interface
 */

// Models
export type { FileTreeNode } from './lib/models/file-tree.model';

// Components
export { FileTreeComponent } from './lib/file-tree/file-tree.component';
export { FileTreeNodeComponent } from './lib/file-tree/file-tree-node.component';
export { CodeEditorComponent } from './lib/code-editor/code-editor.component';
export { EditorPanelComponent } from './lib/editor-panel/editor-panel.component';
export { GitStatusBarComponent } from './lib/git-status-bar/git-status-bar.component';

// Services
export { EditorService } from './lib/services/editor.service';
export type { EditorTab } from './lib/services/editor.service';
export { GitStatusService } from './lib/services/git-status.service';
