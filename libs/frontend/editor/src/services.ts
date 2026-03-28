/**
 * Editor Library - Services-only entry point
 *
 * Lightweight barrel that exports only services (no components with heavy deps
 * like xterm.js or Monaco). Use this import path when you need editor services
 * without pulling xterm/monaco into the bundle:
 *
 *   import { EditorService } from '@ptah-extension/editor/services';
 *
 * For components, use the main entry point:
 *
 *   import { EditorPanelComponent } from '@ptah-extension/editor';
 */

export { EditorService } from './lib/services/editor.service';
export type { EditorTab } from './lib/services/editor.service';
export { GitStatusService } from './lib/services/git-status.service';
export { TerminalService } from './lib/services/terminal.service';
export { WorktreeService } from './lib/services/worktree.service';
export { rpcCall } from './lib/services/rpc-call.util';
export type { RpcCallResult } from './lib/services/rpc-call.util';
export type { TerminalTab, PtahTerminalApi } from './lib/types/terminal.types';
export type { FileTreeNode } from './lib/models/file-tree.model';
