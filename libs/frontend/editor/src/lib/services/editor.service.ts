import { Injectable, inject, signal, computed } from '@angular/core';
import { VSCodeService } from '@ptah-extension/core';
import { FileTreeNode } from '../models/file-tree.model';

/**
 * EditorService - Manages editor state and backend communication via RPC.
 *
 * Complexity Level: 2 (Medium - signal-based state, RPC communication)
 * Patterns: Injectable service, signal-based reactive state
 *
 * Responsibilities:
 * - File tree state management
 * - Active file tracking
 * - File content loading via RPC (editor:openFile)
 * - File saving via RPC (editor:saveFile)
 * - File tree loading via RPC (editor:getFileTree)
 */
@Injectable({
  providedIn: 'root',
})
export class EditorService {
  private readonly vscodeService = inject(VSCodeService);

  private readonly _fileTree = signal<FileTreeNode[]>([]);
  private readonly _activeFilePath = signal<string | undefined>(undefined);
  private readonly _activeFileContent = signal<string>('');
  private readonly _isLoading = signal(false);
  private readonly _error = signal<string | null>(null);

  /** The workspace file tree */
  readonly fileTree = this._fileTree.asReadonly();

  /** Path of the currently active/open file */
  readonly activeFilePath = this._activeFilePath.asReadonly();

  /** Content of the currently active file */
  readonly activeFileContent = this._activeFileContent.asReadonly();

  /** Whether a file operation is in progress */
  readonly isLoading = this._isLoading.asReadonly();

  /** Last error message, or null if no error */
  readonly error = this._error.asReadonly();

  /** Whether a file is currently open */
  readonly hasActiveFile = computed(() => this._activeFilePath() !== undefined);

  /**
   * Load the file tree from the backend.
   * Sends an RPC message to the main process to scan the workspace directory.
   */
  loadFileTree(): void {
    this._isLoading.set(true);
    this._error.set(null);

    this.vscodeService.postMessage({
      type: 'rpc_request',
      method: 'editor:getFileTree',
      params: {},
    });
  }

  /**
   * Open a file by path. Sends an RPC message to load file content.
   */
  openFile(filePath: string): void {
    this._activeFilePath.set(filePath);
    this._isLoading.set(true);
    this._error.set(null);

    this.vscodeService.postMessage({
      type: 'rpc_request',
      method: 'editor:openFile',
      params: { filePath },
    });
  }

  /**
   * Save the active file content. Sends an RPC message to persist changes.
   */
  saveFile(filePath: string, content: string): void {
    this._isLoading.set(true);
    this._error.set(null);

    this.vscodeService.postMessage({
      type: 'rpc_request',
      method: 'editor:saveFile',
      params: { filePath, content },
    });
  }

  /**
   * Update file tree from an RPC response.
   * Called by the EditorPanelComponent when it receives a file tree response.
   */
  setFileTree(tree: FileTreeNode[]): void {
    this._fileTree.set(tree);
    this._isLoading.set(false);
  }

  /**
   * Update active file content from an RPC response.
   * Called by the EditorPanelComponent when it receives file content.
   */
  setFileContent(filePath: string, content: string): void {
    if (this._activeFilePath() === filePath) {
      this._activeFileContent.set(content);
    }
    this._isLoading.set(false);
  }

  /**
   * Handle a save confirmation from the backend.
   */
  confirmSave(): void {
    this._isLoading.set(false);
  }

  /**
   * Set an error state.
   */
  setError(message: string): void {
    this._error.set(message);
    this._isLoading.set(false);
  }

  /**
   * Clear the active file selection.
   */
  clearActiveFile(): void {
    this._activeFilePath.set(undefined);
    this._activeFileContent.set('');
  }
}
