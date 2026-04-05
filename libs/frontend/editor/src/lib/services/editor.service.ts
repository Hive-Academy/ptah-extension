import { Injectable, inject, signal, computed } from '@angular/core';
import { VSCodeService } from '@ptah-extension/core';
import { FileTreeNode } from '../models/file-tree.model';
import { rpcCall } from './rpc-call.util';

/** Represents an open editor tab */
export interface EditorTab {
  filePath: string;
  fileName: string;
  content: string;
  isDirty: boolean;
}

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
  /** All open tabs */
  openTabs: EditorTab[];
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

  /** Counter for stale-response protection in loadFileTree(). */
  private _loadFileTreeRequestId = 0;

  // ============================================================================
  // SIGNAL STATE
  // ============================================================================

  private readonly _fileTree = signal<FileTreeNode[]>([]);
  private readonly _activeFilePath = signal<string | undefined>(undefined);
  private readonly _activeFileContent = signal<string>('');
  private readonly _openTabs = signal<EditorTab[]>([]);
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

  /** All currently open editor tabs */
  readonly openTabs = this._openTabs.asReadonly();

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
      this._openTabs.set(cachedState.openTabs);
    } else {
      // No cached state -- reset to empty defaults and trigger file tree load
      this._fileTree.set([]);
      this._activeFilePath.set(undefined);
      this._activeFileContent.set('');
      this._openTabs.set([]);

      // Initialize empty state in map
      this._workspaceEditorState.set(workspacePath, {
        fileTree: [],
        activeFilePath: undefined,
        activeFileContent: '',
        openTabs: [],
      });

      // Fetch file tree for the new workspace via RPC
      this.loadFileTree(workspacePath);
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
      this._openTabs.set([]);
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
   * @param rootPath - Optional explicit root path. If omitted, uses the active workspace path.
   */
  async loadFileTree(rootPath?: string): Promise<void> {
    const requestId = ++this._loadFileTreeRequestId;
    const targetWorkspace = rootPath || this._activeWorkspacePath;

    // No workspace path available — nothing to load
    if (!targetWorkspace) return;

    this._isLoading.set(true);
    this.clearError();

    try {
      const result = await rpcCall<{ tree: FileTreeNode[] }>(
        this.vscodeService,
        'editor:getFileTree',
        { rootPath: targetWorkspace },
      );

      // Stale-response guard: discard if a newer request was issued
      // or if the active workspace changed since this request was fired
      if (
        this._loadFileTreeRequestId !== requestId ||
        this._activeWorkspacePath !== targetWorkspace
      ) {
        return;
      }

      if (result.success && result.data) {
        const tree = result.data.tree ?? [];
        this._fileTree.set(tree);

        // Update cached state for the target workspace
        const cached = this._workspaceEditorState.get(targetWorkspace);
        if (cached) {
          cached.fileTree = tree;
        }
      } else {
        this.showError(result.error ?? 'Failed to load file tree');
      }
    } finally {
      // Only reset loading if this is still the active request
      if (this._loadFileTreeRequestId === requestId) {
        this._isLoading.set(false);
      }
    }
  }

  /**
   * Open a file by path. Sends an RPC message to load file content.
   * Adds the file as a tab if not already open, and sets it as active.
   */
  async openFile(filePath: string): Promise<void> {
    // Check if the file is already open in a tab
    const existingTab = this._openTabs().find((t) => t.filePath === filePath);
    if (existingTab) {
      // Tab already open -- just switch to it without RPC
      this._activeFilePath.set(filePath);
      this._activeFileContent.set(existingTab.content);
      this._updateCachedActiveFile(filePath, existingTab.content);
      return;
    }

    this._activeFilePath.set(filePath);
    this._isLoading.set(true);
    this.clearError();

    const result = await rpcCall<{ content: string; filePath: string }>(
      this.vscodeService,
      'editor:openFile',
      { filePath },
    );

    if (result.success && result.data) {
      const content = result.data.content ?? '';
      this._activeFileContent.set(content);

      // Add new tab
      const fileName = this._extractFileName(filePath);
      this._openTabs.update((tabs) => [
        ...tabs,
        { filePath, fileName, content, isDirty: false },
      ]);

      // Update cached state if workspace is active
      this._updateCachedActiveFile(filePath, content);
      this._syncTabsToCache();
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

    const result = await rpcCall<{ success: boolean }>(
      this.vscodeService,
      'editor:saveFile',
      { filePath, content },
    );

    if (!result.success) {
      this.showError(result.error ?? 'Failed to save file');
    }
    this._isLoading.set(false);
  }

  /**
   * Lazy-load children for a directory that was at the initial depth boundary.
   * Updates the tree in place by replacing the directory's children and clearing needsLoad.
   */
  async loadDirectoryChildren(dirPath: string): Promise<void> {
    const result = await rpcCall<{ children: FileTreeNode[] }>(
      this.vscodeService,
      'editor:getDirectoryChildren',
      { dirPath },
    );

    if (result.success && result.data) {
      const children = result.data.children ?? [];
      // Update the tree in place: find the node and replace its children
      const currentTree = this._fileTree();
      const updatedTree = this.updateNodeChildren(
        currentTree,
        dirPath,
        children,
      );
      this._fileTree.set(updatedTree);

      // Update cached workspace state
      if (this._activeWorkspacePath) {
        const cached = this._workspaceEditorState.get(
          this._activeWorkspacePath,
        );
        if (cached) {
          cached.fileTree = updatedTree;
        }
      }
    } else {
      this.showError(result.error ?? 'Failed to load directory');
    }
  }

  /**
   * Recursively find a node by path and replace its children.
   * Returns a new tree (immutable update) so signals detect the change.
   */
  private updateNodeChildren(
    nodes: FileTreeNode[],
    targetPath: string,
    children: FileTreeNode[],
  ): FileTreeNode[] {
    return nodes.map((node) => {
      if (node.path === targetPath) {
        return { ...node, children, needsLoad: false };
      }
      if (node.children && node.children.length > 0) {
        return {
          ...node,
          children: this.updateNodeChildren(
            node.children,
            targetPath,
            children,
          ),
        };
      }
      return node;
    });
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

  // ============================================================================
  // TAB OPERATIONS
  // ============================================================================

  /**
   * Close a tab by file path. If the closed tab was active, switch to the
   * last remaining tab or clear the editor if no tabs remain.
   */
  closeTab(filePath: string): void {
    const currentTabs = this._openTabs();
    const tabIndex = currentTabs.findIndex((t) => t.filePath === filePath);
    if (tabIndex === -1) return;

    const updatedTabs = currentTabs.filter((t) => t.filePath !== filePath);
    this._openTabs.set(updatedTabs);

    // If the closed tab was active, switch to another tab
    if (this._activeFilePath() === filePath) {
      if (updatedTabs.length > 0) {
        // Switch to the tab that was adjacent (prefer the one before, or the last one)
        const newIndex = Math.min(tabIndex, updatedTabs.length - 1);
        const newActive = updatedTabs[newIndex];
        this._activeFilePath.set(newActive.filePath);
        this._activeFileContent.set(newActive.content);
        this._updateCachedActiveFile(newActive.filePath, newActive.content);
      } else {
        this.clearActiveFile();
      }
    }

    this._syncTabsToCache();
  }

  /**
   * Switch to an already-open tab by file path.
   * Updates the active file path and content from cached tab data.
   */
  switchTab(filePath: string): void {
    const tab = this._openTabs().find((t) => t.filePath === filePath);
    if (!tab) return;

    this._activeFilePath.set(tab.filePath);
    this._activeFileContent.set(tab.content);
    this._updateCachedActiveFile(tab.filePath, tab.content);
  }

  /**
   * Update a tab's content and mark it as dirty.
   * Called when the user edits content in the Monaco editor.
   */
  updateTabContent(filePath: string, content: string): void {
    this._openTabs.update((tabs) =>
      tabs.map((tab) =>
        tab.filePath === filePath ? { ...tab, content, isDirty: true } : tab,
      ),
    );
    this._syncTabsToCache();
  }

  /**
   * Mark a tab as clean (not dirty) after a successful save.
   */
  markTabClean(filePath: string): void {
    this._openTabs.update((tabs) =>
      tabs.map((tab) =>
        tab.filePath === filePath ? { ...tab, isDirty: false } : tab,
      ),
    );
    this._syncTabsToCache();
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
      openTabs: this._openTabs(),
      scrollPosition: existing?.scrollPosition,
      cursorPosition: existing?.cursorPosition,
    });
  }

  // ============================================================================
  // TAB & CACHE HELPERS
  // ============================================================================

  /**
   * Extract file name from a full file path.
   */
  private _extractFileName(filePath: string): string {
    const parts = filePath.replace(/\\/g, '/').split('/');
    return parts[parts.length - 1] || filePath;
  }

  /**
   * Update the cached active file path and content for the current workspace.
   */
  private _updateCachedActiveFile(filePath: string, content: string): void {
    if (this._activeWorkspacePath) {
      const cached = this._workspaceEditorState.get(this._activeWorkspacePath);
      if (cached) {
        cached.activeFilePath = filePath;
        cached.activeFileContent = content;
      }
    }
  }

  /**
   * Sync the current openTabs signal into the workspace state cache.
   */
  private _syncTabsToCache(): void {
    if (this._activeWorkspacePath) {
      const cached = this._workspaceEditorState.get(this._activeWorkspacePath);
      if (cached) {
        cached.openTabs = this._openTabs();
      }
    }
  }
}
