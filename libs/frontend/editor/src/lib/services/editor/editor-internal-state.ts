import type { WritableSignal } from '@angular/core';
import type { VSCodeService } from '@ptah-extension/core';
import type { FileTreeNode } from '../../models/file-tree.model';
import type { EditorTab } from '../editor.service';

/**
 * Internal per-workspace editor state cache.
 * Stores editor state that should be isolated between workspaces
 * (TASK_2025_208 — instant workspace switching).
 */
export interface EditorWorkspaceState {
  fileTree: FileTreeNode[];
  activeFilePath: string | undefined;
  activeFileContent: string;
  openTabs: EditorTab[];
  scrollPosition?: number;
  cursorPosition?: { line: number; column: number };
  splitActive?: boolean;
  splitFilePath?: string;
  splitFileContent?: string;
}

/**
 * Shared state context passed to all editor helpers.
 *
 * Signals live on the coordinator (EditorService) so their identity is
 * preserved across the refactor; helpers mutate them through this handle.
 */
export interface EditorInternalState {
  readonly vscodeService: VSCodeService;

  // Signal bag — all signals live on the coordinator. Helpers mutate via setters.
  readonly fileTree: WritableSignal<FileTreeNode[]>;
  readonly activeFilePath: WritableSignal<string | undefined>;
  readonly activeFileContent: WritableSignal<string>;
  readonly openTabs: WritableSignal<EditorTab[]>;
  readonly isLoading: WritableSignal<boolean>;
  readonly targetLine: WritableSignal<number | undefined>;
  readonly splitActive: WritableSignal<boolean>;
  readonly splitFilePath: WritableSignal<string | undefined>;
  readonly splitFileContent: WritableSignal<string>;
  readonly focusedPane: WritableSignal<'left' | 'right'>;

  // Per-workspace cache (owned by coordinator, mutated by helpers).
  readonly workspaceEditorState: Map<string, EditorWorkspaceState>;

  // Active workspace path accessors (coordinator-owned).
  getActiveWorkspacePath(): string | null;
  setActiveWorkspacePath(path: string | null): void;

  // Error plumbing — helpers call these without owning the error signal itself.
  showError(message: string): void;
  clearError(): void;
}

/** Recognised image extensions — image files render via file:// URLs, no RPC content load needed. */
export const IMAGE_EXTENSIONS: ReadonlySet<string> = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.bmp',
  '.svg',
  '.webp',
  '.ico',
  '.avif',
]);

/** Extract the file name (final path segment) from an absolute or relative path. */
export function extractFileName(filePath: string): string {
  const parts = filePath.replace(/\\/g, '/').split('/');
  return parts[parts.length - 1] || filePath;
}
