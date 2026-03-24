/**
 * Editor Library - Main Entry Point
 *
 * ARCHITECTURE: Monaco-based code editor with file tree explorer
 *
 * COMPONENTS:
 * - EditorPanelComponent: Main container (file tree + code editor)
 * - FileTreeComponent: File explorer sidebar
 * - FileTreeNodeComponent: Recursive tree node
 * - CodeEditorComponent: Monaco editor wrapper
 *
 * SERVICES:
 * - EditorService: File state management and backend RPC communication
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

// Services
export { EditorService } from './lib/services/editor.service';
export type { EditorTab } from './lib/services/editor.service';
