import { Injectable, inject, signal, computed } from '@angular/core';
import { VSCodeService } from '@ptah-extension/core';
import { MESSAGE_TYPES } from '@ptah-extension/shared';
import { FileTreeNode } from '../models/file-tree.model';

/**
 * Internal type for per-workspace editor state.
 * Stores all editor-related state that should be isolated between workspaces.
 */
interface EditorWorkspaceState {
  /** The workspace file tree */
  fileTree: FileTreeNode[];
  /** Path of the currently active/open file */
  activeFilePath: string | undefined;
  /** Content of the currently active file */
  activeFileContent: string;
  /** Scroll position for state restoration */
  scrollPosition?: number;
  /** Cursor position for state restoration */
  cursorPosition?: { line: number; column: number };
}

/**
 * EditorService - Manages editor state and backend communication via RPC.
 *
 * Complexity Level: 2 (Medium - signal-based state, RPC communication, workspace partitioning)
 * Patterns: Injectable service, signal-based reactive state, correlationId-based RPC
 *
 * Responsibilities:
 * - File tree state management (partitioned by workspace - TASK_2025_208)
 * - Active file tracking (partitioned by workspace)
 * - File content loading via RPC (editor:openFile)
 * - File saving via RPC (editor:saveFile)
 * - File tree loading via RPC (editor:getFileTree)
 * - Workspace state save/restore on workspace switch
 *
 * Communication: Uses MESSAGE_TYPES.RPC_CALL / RPC_RESPONSE with correlationId
 * matching for reliable request-response pairing.
 */
@Injectable({
  providedIn: 'root',
})
export class EditorService {
  private readonly vscodeService = inject(VSCodeService);

  // ============================================================================
  // WORKSPACE STATE (TASK_2025_208)
  // ============================================================================

  /**
   * Map of workspace path to editor state. Contains cached editor state
   * for all workspaces (active and background) so switching back is instant.
   */
  private readonly _workspaceEditorState = new Map<
    string,
    EditorWorkspaceState
  >();

  /**
   * Currently active workspace path. Null when no workspace is active.
   */
  private _activeWorkspacePath: string | null = null;

  // ============================================================================
  // SIGNAL STATE
  // ============================================================================

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

  // ============================================================================
  // WORKSPACE OPERATIONS (TASK_2025_208)
  // ============================================================================

  /**
   * Switch the active workspace, saving current editor state and restoring target state.
   *
   * Flow:
   * 1. Save current workspace's editor state (file tree, active file, content, cursor) to map
   * 2. Load target workspace's state from map (if cached) or reset to defaults
   * 3. If target workspace has no cached file tree, trigger loadFileTree() to fetch via RPC
   *
   * @param workspacePath - The workspace folder path to switch to
   */
  switchWorkspace(workspacePath: string): void {
    // No-op if switching to already-active workspace
    if (this._activeWorkspacePath === workspacePath) return;

    // Step 1: Save current workspace state to map
    this._saveCurrentWorkspaceState();

    // Step 2: Update active workspace path
    this._activeWorkspacePath = workspacePath;

    // Step 3: Load target workspace state from cache or defaults
    const cachedState = this._workspaceEditorState.get(workspacePath);

    if (cachedState) {
      // Restore cached state into signals
      this._fileTree.set(cachedState.fileTree);
      this._activeFilePath.set(cachedState.activeFilePath);
      this._activeFileContent.set(cachedState.activeFileContent);
    } else {
      // No cached state -- reset to empty defaults and trigger file tree load
      this._fileTree.set([]);
      this._activeFilePath.set(undefined);
      this._activeFileContent.set('');

      // Initialize empty state in map
      this._workspaceEditorState.set(workspacePath, {
        fileTree: [],
        activeFilePath: undefined,
        activeFileContent: '',
      });

      // Fetch file tree for the new workspace via RPC
      this.loadFileTree();
    }
  }

  /**
   * Remove cached editor state for a workspace.
   * Called when a workspace folder is removed from the layout.
   *
   * @param workspacePath - The workspace folder path to clean up
   */
  removeWorkspaceState(workspacePath: string): void {
    this._workspaceEditorState.delete(workspacePath);

    // If the removed workspace was active, clear signals
    if (this._activeWorkspacePath === workspacePath) {
      this._activeWorkspacePath = null;
      this._fileTree.set([]);
      this._activeFilePath.set(undefined);
      this._activeFileContent.set('');
    }
  }

  /**
   * Get the currently active workspace path.
   */
  get activeWorkspacePath(): string | null {
    return this._activeWorkspacePath;
  }

  // ============================================================================
  // FILE OPERATIONS
  // ============================================================================

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
      const tree = result.data.tree ?? [];
      this._fileTree.set(tree);

      // Update cached state if workspace is active
      if (this._activeWorkspacePath) {
        const cached = this._workspaceEditorState.get(
          this._activeWorkspacePath
        );
        if (cached) {
          cached.fileTree = tree;
        }
      }
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
      const content = result.data.content ?? '';
      this._activeFileContent.set(content);

      // Update cached state if workspace is active
      if (this._activeWorkspacePath) {
        const cached = this._workspaceEditorState.get(
          this._activeWorkspacePath
        );
        if (cached) {
          cached.activeFilePath = filePath;
          cached.activeFileContent = content;
        }
      }
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

    // Update cached state
    if (this._activeWorkspacePath) {
      const cached = this._workspaceEditorState.get(this._activeWorkspacePath);
      if (cached) {
        cached.activeFilePath = undefined;
        cached.activeFileContent = '';
      }
    }
  }

  /**
   * Update the scroll position for the current workspace.
   * Called by editor components when scroll position changes.
   */
  updateScrollPosition(scrollPosition: number): void {
    if (this._activeWorkspacePath) {
      const cached = this._workspaceEditorState.get(this._activeWorkspacePath);
      if (cached) {
        cached.scrollPosition = scrollPosition;
      }
    }
  }

  /**
   * Update the cursor position for the current workspace.
   * Called by editor components when cursor position changes.
   */
  updateCursorPosition(line: number, column: number): void {
    if (this._activeWorkspacePath) {
      const cached = this._workspaceEditorState.get(this._activeWorkspacePath);
      if (cached) {
        cached.cursorPosition = { line, column };
      }
    }
  }

  /**
   * Get the cached scroll position for the active workspace.
   */
  getScrollPosition(): number | undefined {
    if (!this._activeWorkspacePath) return undefined;
    return this._workspaceEditorState.get(this._activeWorkspacePath)
      ?.scrollPosition;
  }

  /**
   * Get the cached cursor position for the active workspace.
   */
  getCursorPosition(): { line: number; column: number } | undefined {
    if (!this._activeWorkspacePath) return undefined;
    return this._workspaceEditorState.get(this._activeWorkspacePath)
      ?.cursorPosition;
  }

  // ============================================================================
  // ERROR HANDLING
  // ============================================================================

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

  // ============================================================================
  // WORKSPACE STATE HELPERS (TASK_2025_208)
  // ============================================================================

  /**
   * Save current workspace's editor state from signals into the workspace map.
   * Called before switching away from the current workspace.
   */
  private _saveCurrentWorkspaceState(): void {
    if (!this._activeWorkspacePath) return;

    const existing = this._workspaceEditorState.get(this._activeWorkspacePath);

    this._workspaceEditorState.set(this._activeWorkspacePath, {
      fileTree: this._fileTree(),
      activeFilePath: this._activeFilePath(),
      activeFileContent: this._activeFileContent(),
      scrollPosition: existing?.scrollPosition,
      cursorPosition: existing?.cursorPosition,
    });
  }

  // ============================================================================
  // RPC COMMUNICATION
  // ============================================================================

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
