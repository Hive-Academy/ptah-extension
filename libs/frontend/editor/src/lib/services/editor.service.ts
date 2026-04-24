import { Injectable, inject, signal, computed } from '@angular/core';
import { VSCodeService } from '@ptah-extension/core';
import { FileTreeNode } from '../models/file-tree.model';
import {
  EditorInternalState,
  EditorWorkspaceState,
  IMAGE_EXTENSIONS,
} from './editor/editor-internal-state';
import { EditorWorkspaceHelper } from './editor/editor-workspace';
import { EditorTabsHelper } from './editor/editor-tabs';
import { EditorFileOpsHelper } from './editor/editor-file-ops';
import { EditorDiffSplitHelper } from './editor/editor-diff-split';

/** Represents an open editor tab */
export interface EditorTab {
  filePath: string;
  fileName: string;
  content: string;
  isDirty: boolean;
  /** Whether this tab shows a diff view instead of a regular editor */
  isDiff?: boolean;
  /** Original (HEAD) content for diff tabs */
  originalContent?: string;
  /** Relative path within the workspace for diff tabs */
  diffRelativePath?: string;
}

/**
 * EditorService — coordinator that owns editor signals and delegates to
 * four helper classes split by concern:
 *   - EditorWorkspaceHelper: workspace partitioning, file-tree load & watch
 *   - EditorFileOpsHelper:   open / save / create / rename / delete / reveal
 *   - EditorDiffSplitHelper: diff view + side-by-side split pane
 *   - EditorTabsHelper:      tab open/close/switch/updateContent
 *
 * The public API is identical to the pre-split service — component
 * consumers need no changes. Signals live on the coordinator so their
 * reference identity is preserved across the refactor.
 *
 * Complexity Level: 2 (Medium - signal-based state, RPC communication,
 * workspace partitioning). Wave C7b (TASK_2025_291) split.
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

  /** Currently active workspace path. Null when no workspace is active. */
  private _activeWorkspacePath: string | null = null;

  // ============================================================================
  // SIGNAL STATE — owned by the coordinator (identity preserved across helpers)
  // ============================================================================

  private readonly _fileTree = signal<FileTreeNode[]>([]);
  private readonly _activeFilePath = signal<string | undefined>(undefined);
  private readonly _activeFileContent = signal<string>('');
  private readonly _openTabs = signal<EditorTab[]>([]);
  private readonly _isLoading = signal(false);
  private readonly _error = signal<string | null>(null);
  private readonly _targetLine = signal<number | undefined>(undefined);
  private readonly _splitActive = signal(false);
  private readonly _splitFilePath = signal<string | undefined>(undefined);
  private readonly _splitFileContent = signal('');
  private readonly _focusedPane = signal<'left' | 'right'>('left');
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
  /** Target line to reveal (one-shot: cleared after revealing) */
  readonly targetLine = this._targetLine.asReadonly();
  /** All currently open editor tabs */
  readonly openTabs = this._openTabs.asReadonly();
  /** Whether the split editor pane is active. */
  readonly splitActive = this._splitActive.asReadonly();
  /** File path open in the split (right) pane. */
  readonly splitFilePath = this._splitFilePath.asReadonly();
  /** Content of the file in the split (right) pane. */
  readonly splitFileContent = this._splitFileContent.asReadonly();
  /** Which pane has focus: 'left' (primary) or 'right' (split). */
  readonly focusedPane = this._focusedPane.asReadonly();
  /** Whether a file is currently open */
  readonly hasActiveFile = computed(() => this._activeFilePath() !== undefined);

  readonly isActiveFileImage = computed(() => {
    const path = this._activeFilePath();
    if (!path) return false;
    const ext = path.substring(path.lastIndexOf('.')).toLowerCase();
    return IMAGE_EXTENSIONS.has(ext);
  });

  /** The active diff tab, or null if the active tab is not a diff view. */
  readonly activeDiffTab = computed(() => {
    const tabs = this._openTabs();
    const activePath = this._activeFilePath();
    const tab = tabs.find((t) => t.filePath === activePath);
    return tab?.isDiff ? tab : null;
  });

  // ============================================================================
  // HELPER COMPOSITION — constructed in constructor (forward refs resolve)
  // ============================================================================

  private readonly internalState: EditorInternalState;
  private readonly tabsHelper: EditorTabsHelper;
  private readonly diffSplitHelper: EditorDiffSplitHelper;
  private readonly fileOpsHelper: EditorFileOpsHelper;
  private readonly workspaceHelper: EditorWorkspaceHelper;

  public constructor() {
    this.internalState = {
      vscodeService: this.vscodeService,
      fileTree: this._fileTree,
      activeFilePath: this._activeFilePath,
      activeFileContent: this._activeFileContent,
      openTabs: this._openTabs,
      isLoading: this._isLoading,
      targetLine: this._targetLine,
      splitActive: this._splitActive,
      splitFilePath: this._splitFilePath,
      splitFileContent: this._splitFileContent,
      focusedPane: this._focusedPane,
      workspaceEditorState: this._workspaceEditorState,
      getActiveWorkspacePath: (): string | null => this._activeWorkspacePath,
      setActiveWorkspacePath: (path: string | null): void => {
        this._activeWorkspacePath = path;
      },
      showError: (message: string): void => this.showError(message),
      clearError: (): void => this.clearError(),
    };

    // Order matters: tabs first, then diffSplit (needs tabs), then fileOps
    // (needs tabs), then workspace (needs fileOps + diffSplit). Callbacks
    // referencing later helpers are arrow functions, so the reference is
    // resolved lazily when the callback fires.
    this.tabsHelper = new EditorTabsHelper(this.internalState, {
      clearActiveFile: (): void => this.fileOpsHelper.clearActiveFile(),
      closeSplit: (): void => this.diffSplitHelper.closeSplit(),
    });

    this.diffSplitHelper = new EditorDiffSplitHelper(
      this.internalState,
      this.tabsHelper,
    );

    this.fileOpsHelper = new EditorFileOpsHelper(
      this.internalState,
      this.tabsHelper,
      {
        loadFileTree: (rootPath?: string): Promise<void> =>
          this.workspaceHelper.loadFileTree(rootPath),
      },
    );

    this.workspaceHelper = new EditorWorkspaceHelper(this.internalState, {
      handleFileContentChanged: (filePath: string): Promise<void> =>
        this.fileOpsHelper.handleFileContentChanged(filePath),
      closeSplit: (): void => this.diffSplitHelper.closeSplit(),
    });
  }

  // ============================================================================
  // WORKSPACE OPERATIONS (TASK_2025_208) — delegated to EditorWorkspaceHelper
  // ============================================================================

  /**
   * Switch the active workspace, saving current editor state and restoring target state.
   */
  switchWorkspace(workspacePath: string): void {
    this.workspaceHelper.switchWorkspace(workspacePath);
  }

  /** Remove cached editor state for a workspace. */
  removeWorkspaceState(workspacePath: string): void {
    this.workspaceHelper.removeWorkspaceState(workspacePath);
  }

  /** Get the currently active workspace path. */
  get activeWorkspacePath(): string | null {
    return this._activeWorkspacePath;
  }

  // ============================================================================
  // FILE TREE WATCHING — delegated to EditorWorkspaceHelper
  // ============================================================================

  /** Start listening for file:tree-changed push events from the backend. */
  startFileTreeWatcher(): void {
    this.workspaceHelper.startFileTreeWatcher();
  }

  /** Stop listening for file:tree-changed push events. */
  stopFileTreeWatcher(): void {
    this.workspaceHelper.stopFileTreeWatcher();
  }

  // ============================================================================
  // FILE OPERATIONS — delegated to EditorFileOpsHelper / EditorWorkspaceHelper
  // ============================================================================

  /** Load the file tree from the backend. */
  async loadFileTree(rootPath?: string): Promise<void> {
    return this.workspaceHelper.loadFileTree(rootPath);
  }

  /** Open a file by path. */
  async openFile(filePath: string): Promise<void> {
    return this.fileOpsHelper.openFile(filePath);
  }

  /** Open a file and scroll to a specific line. */
  async openFileAtLine(filePath: string, line: number): Promise<void> {
    await this.openFile(filePath);
    this.revealLine(line);
  }

  /** Set a target line for the editor to reveal (one-shot signal). */
  revealLine(line: number): void {
    this._targetLine.set(line);
  }

  /** Clear the target line after it has been revealed by the editor. */
  clearTargetLine(): void {
    this._targetLine.set(undefined);
  }

  /** Open a diff view for a file. */
  async openDiff(relativePath: string, absolutePath: string): Promise<void> {
    return this.diffSplitHelper.openDiff(relativePath, absolutePath);
  }

  /** Save the active file content. */
  async saveFile(filePath: string, content: string): Promise<void> {
    return this.fileOpsHelper.saveFile(filePath, content);
  }

  /** Lazy-load children for a directory at the initial depth boundary. */
  async loadDirectoryChildren(dirPath: string): Promise<void> {
    return this.workspaceHelper.loadDirectoryChildren(dirPath);
  }

  /** Clear the active file selection. */
  clearActiveFile(): void {
    this.fileOpsHelper.clearActiveFile();
  }

  // ============================================================================
  // FILE CRUD OPERATIONS — delegated to EditorFileOpsHelper
  // ============================================================================

  /** Create a new file at the given path. Refreshes the file tree on success. */
  async createFile(filePath: string): Promise<boolean> {
    return this.fileOpsHelper.createFile(filePath);
  }

  /** Create a new folder at the given path. Refreshes the file tree on success. */
  async createFolder(folderPath: string): Promise<boolean> {
    return this.fileOpsHelper.createFolder(folderPath);
  }

  /** Rename a file or folder. Updates open tabs if affected. */
  async renameItem(oldPath: string, newPath: string): Promise<boolean> {
    return this.fileOpsHelper.renameItem(oldPath, newPath);
  }

  /** Delete a file or folder. Closes affected tabs. */
  async deleteItem(itemPath: string, isDirectory: boolean): Promise<boolean> {
    return this.fileOpsHelper.deleteItem(itemPath, isDirectory);
  }

  // ============================================================================
  // SPLIT PANE OPERATIONS — delegated to EditorDiffSplitHelper
  // ============================================================================

  /** Open a file in the split (right) pane. */
  async openFileInSplit(filePath: string): Promise<void> {
    return this.diffSplitHelper.openFileInSplit(filePath);
  }

  /** Close the split pane and reset all split-related state. */
  closeSplit(): void {
    this.diffSplitHelper.closeSplit();
  }

  /** Set which pane currently has focus. */
  setFocusedPane(pane: 'left' | 'right'): void {
    this.diffSplitHelper.setFocusedPane(pane);
  }

  /** Update the content of the file in the split (right) pane. */
  updateSplitContent(content: string): void {
    this.diffSplitHelper.updateSplitContent(content);
  }

  // ============================================================================
  // TAB OPERATIONS — delegated to EditorTabsHelper
  // ============================================================================

  /** Close a tab by file path. */
  closeTab(filePath: string): void {
    this.tabsHelper.closeTab(filePath);
  }

  /** Switch to an already-open tab by file path. */
  switchTab(filePath: string): void {
    this.tabsHelper.switchTab(filePath);
  }

  /** Update a tab's content and mark it as dirty. */
  updateTabContent(filePath: string, content: string): void {
    this.tabsHelper.updateTabContent(filePath, content);
  }

  /** Mark a tab as clean (not dirty) after a successful save. */
  markTabClean(filePath: string): void {
    this.tabsHelper.markTabClean(filePath);
  }

  /** Update the cached scroll position for the current workspace. */
  updateScrollPosition(scrollPosition: number): void {
    if (this._activeWorkspacePath) {
      const cached = this._workspaceEditorState.get(this._activeWorkspacePath);
      if (cached) {
        cached.scrollPosition = scrollPosition;
      }
    }
  }

  /** Update the cached cursor position for the current workspace. */
  updateCursorPosition(line: number, column: number): void {
    if (this._activeWorkspacePath) {
      const cached = this._workspaceEditorState.get(this._activeWorkspacePath);
      if (cached) {
        cached.cursorPosition = { line, column };
      }
    }
  }

  /** Get the cached scroll position for the active workspace. */
  getScrollPosition(): number | undefined {
    if (!this._activeWorkspacePath) return undefined;
    return this._workspaceEditorState.get(this._activeWorkspacePath)
      ?.scrollPosition;
  }

  /** Get the cached cursor position for the active workspace. */
  getCursorPosition(): { line: number; column: number } | undefined {
    if (!this._activeWorkspacePath) return undefined;
    return this._workspaceEditorState.get(this._activeWorkspacePath)
      ?.cursorPosition;
  }

  // ============================================================================
  // ERROR HANDLING — coordinator-owned (helpers delegate back here)
  // ============================================================================

  /** Clear the current error state. */
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
}
