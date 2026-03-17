import { Injectable, inject, signal, computed } from '@angular/core';
import { VSCodeService } from '@ptah-extension/core';
import { MESSAGE_TYPES } from '@ptah-extension/shared';
import { FileTreeNode } from '../models/file-tree.model';

/**
 * EditorService - Manages editor state and backend communication via RPC.
 *
 * Complexity Level: 2 (Medium - signal-based state, RPC communication)
 * Patterns: Injectable service, signal-based reactive state, correlationId-based RPC
 *
 * Responsibilities:
 * - File tree state management
 * - Active file tracking
 * - File content loading via RPC (editor:openFile)
 * - File saving via RPC (editor:saveFile)
 * - File tree loading via RPC (editor:getFileTree)
 *
 * Communication: Uses MESSAGE_TYPES.RPC_CALL / RPC_RESPONSE with correlationId
 * matching for reliable request-response pairing.
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
  private errorTimeout: ReturnType<typeof setTimeout> | null = null;

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
  async loadFileTree(): Promise<void> {
    this._isLoading.set(true);
    this.clearError();

    const result = await this.rpcCall<{ tree: FileTreeNode[] }>(
      'editor:getFileTree',
      {}
    );

    if (result.success && result.data) {
      this._fileTree.set(result.data.tree ?? []);
    } else {
      this.showError(result.error ?? 'Failed to load file tree');
    }
    this._isLoading.set(false);
  }

  /**
   * Open a file by path. Sends an RPC message to load file content.
   */
  async openFile(filePath: string): Promise<void> {
    this._activeFilePath.set(filePath);
    this._isLoading.set(true);
    this.clearError();

    const result = await this.rpcCall<{ content: string; filePath: string }>(
      'editor:openFile',
      { filePath }
    );

    if (result.success && result.data) {
      this._activeFileContent.set(result.data.content ?? '');
    } else {
      this.showError(result.error ?? 'Failed to open file');
    }
    this._isLoading.set(false);
  }

  /**
   * Save the active file content. Sends an RPC message to persist changes.
   */
  async saveFile(filePath: string, content: string): Promise<void> {
    this._isLoading.set(true);
    this.clearError();

    const result = await this.rpcCall<{ success: boolean }>('editor:saveFile', {
      filePath,
      content,
    });

    if (!result.success) {
      this.showError(result.error ?? 'Failed to save file');
    }
    this._isLoading.set(false);
  }

  /**
   * Clear the active file selection.
   */
  clearActiveFile(): void {
    this._activeFilePath.set(undefined);
    this._activeFileContent.set('');
  }

  /**
   * Clear the current error state. Can be called from components
   * to dismiss error toasts manually.
   */
  clearError(): void {
    if (this.errorTimeout) {
      clearTimeout(this.errorTimeout);
      this.errorTimeout = null;
    }
    this._error.set(null);
  }

  private showError(message: string): void {
    this._error.set(message);
    this.errorTimeout = setTimeout(() => {
      this._error.set(null);
      this.errorTimeout = null;
    }, 5000);
  }

  /**
   * Send an RPC call via postMessage and wait for the correlated response.
   * Uses crypto.randomUUID() for correlation and listens for MESSAGE_TYPES.RPC_RESPONSE.
   */
  private rpcCall<T>(
    method: string,
    params: Record<string, unknown>
  ): Promise<{ success: boolean; data?: T; error?: string }> {
    const correlationId = crypto.randomUUID();

    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        cleanup();
        resolve({ success: false, error: `RPC timeout: ${method}` });
      }, 30000);

      const handler = (event: MessageEvent) => {
        const data = event.data;
        if (!data || typeof data !== 'object') return;
        if (data.type !== MESSAGE_TYPES.RPC_RESPONSE) return;
        if (data.correlationId !== correlationId) return;

        cleanup();
        const errorStr = data.error
          ? typeof data.error === 'string'
            ? data.error
            : data.error.message ?? String(data.error)
          : undefined;
        resolve({
          success: data.success,
          data: data.data as T,
          error: errorStr,
        });
      };

      const cleanup = () => {
        clearTimeout(timeout);
        window.removeEventListener('message', handler);
      };

      window.addEventListener('message', handler);

      this.vscodeService.postMessage({
        type: MESSAGE_TYPES.RPC_CALL,
        payload: { method, params, correlationId },
      });
    });
  }
}
