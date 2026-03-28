/**
 * Editor Library - Main Entry Point
 *
 * ARCHITECTURE: Monaco-based code editor with file tree explorer, git integration,
 * integrated terminal panel (xterm.js + node-pty via binary IPC), and worktree management
 *
 * COMPONENTS:
 * - EditorPanelComponent: Main container (file tree + code editor + git status bar + terminal)
 * - FileTreeComponent: File explorer sidebar
 * - FileTreeNodeComponent: Recursive tree node with git status badges
 * - CodeEditorComponent: Monaco editor wrapper
 * - GitStatusBarComponent: Branch info, ahead/behind counts, changed file count, worktree indicator
 * - TerminalComponent: xterm.js wrapper with WebGL/canvas rendering
 * - TerminalTabBarComponent: Terminal tab bar with new/close/switch actions
 * - TerminalPanelComponent: Container for multi-tab terminal panel
 * - AddWorktreeDialogComponent: Modal dialog for creating new git worktrees
 *
 * SERVICES:
 * - EditorService: File state management and backend RPC communication
 * - GitStatusService: Git status polling and workspace-partitioned git state
 * - TerminalService: Terminal tab lifecycle, binary IPC, workspace-partitioned state
 * - WorktreeService: Git worktree CRUD operations and workspace folder registration
 *
 * MODELS:
 * - FileTreeNode: File/directory tree structure interface
 *
 * TYPES:
 * - TerminalTab: Terminal tab state for multi-tab UI
 * - PtahTerminalApi: Window extension for terminal binary IPC
 */

// Models
export type { FileTreeNode } from './lib/models/file-tree.model';

// Components
export { FileTreeComponent } from './lib/file-tree/file-tree.component';
export { FileTreeNodeComponent } from './lib/file-tree/file-tree-node.component';
export { CodeEditorComponent } from './lib/code-editor/code-editor.component';
export { EditorPanelComponent } from './lib/editor-panel/editor-panel.component';
export { GitStatusBarComponent } from './lib/git-status-bar/git-status-bar.component';
export { TerminalComponent } from './lib/terminal/terminal.component';
export { TerminalTabBarComponent } from './lib/terminal/terminal-tab-bar.component';
export { TerminalPanelComponent } from './lib/terminal/terminal-panel.component';
export { AddWorktreeDialogComponent } from './lib/worktree/add-worktree-dialog.component';

// Services
export { EditorService } from './lib/services/editor.service';
export type { EditorTab } from './lib/services/editor.service';
export { GitStatusService } from './lib/services/git-status.service';
export { TerminalService } from './lib/services/terminal.service';
export { WorktreeService } from './lib/services/worktree.service';

// Utilities
export { rpcCall } from './lib/services/rpc-call.util';
export type { RpcCallResult } from './lib/services/rpc-call.util';

// Types
export type { TerminalTab, PtahTerminalApi } from './lib/types/terminal.types';
