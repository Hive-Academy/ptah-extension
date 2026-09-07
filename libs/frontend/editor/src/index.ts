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
 * - GitStatusBarComponent: Branch info, ahead/behind counts, changed file count, worktree indicator
 * - WorktreeSectionComponent: Worktree list section inside the sidebar
 *
 * SERVICES:
 * - EditorService: File state management and backend RPC communication
 * - GitStatusService: Git status (event-driven via git:status-update push) and workspace-partitioned git state
 * - GitBranchesService: Branch list, stash count, last commit, recent-branch persistence (event-driven)
 * - WorktreeService: Git worktree CRUD operations and workspace folder registration
 *
 * MODELS:
 * - FileTreeNode: File/directory tree structure interface
 */
export type { FileTreeNode } from './lib/models/file-tree.model';
export { FileTreeComponent } from './lib/file-tree/file-tree.component';
export { FileTreeNodeComponent } from './lib/file-tree/file-tree-node.component';
export { FileTreeContextMenuComponent } from './lib/file-tree/file-tree-context-menu.component';
export { FileTreeInlineInputComponent } from './lib/file-tree/file-tree-inline-input.component';
export { CodeEditorComponent } from './lib/code-editor/code-editor.component';
export { EditorPanelComponent } from './lib/editor-panel/editor-panel.component';
export { GitStatusBarComponent } from './lib/git-status-bar/git-status-bar.component';
export { SidebarComponent } from './lib/sidebar/sidebar.component';
export { BranchPickerDropdownComponent } from './lib/branch-picker/branch-picker-dropdown.component';
export { BranchDetailsPopoverComponent } from './lib/branch-picker/branch-details-popover.component';
export { EditorService } from './lib/services/editor.service';
export {
  EDITOR_INTERNAL_STATE,
  type EditorInternalState,
} from './lib/services/editor/editor-internal-state';
export { provideEditorInternalState } from './lib/services/editor-internal-state.provider';
