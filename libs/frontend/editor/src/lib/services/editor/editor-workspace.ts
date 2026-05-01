import { rpcCall } from '@ptah-extension/core';
import type { FileTreeNode } from '../../models/file-tree.model';
import type {
  EditorInternalState,
  EditorWorkspaceState,
} from './editor-internal-state';
import { extractFileName, IMAGE_EXTENSIONS } from './editor-internal-state';

/**
 * EditorWorkspaceHelper — workspace state partitioning, file-tree loading,
 * and file-tree push-event watching.
 *
 * Owns no signals of its own; mutates the coordinator's signals through
 * {@link EditorInternalState}. Tab cache sync is delegated back to the
 * coordinator via the provided callbacks to keep cache consistency
 * concerns co-located with whoever last changed tabs / active file.
 */
export class EditorWorkspaceHelper {
  /** Counter for stale-response protection in loadFileTree(). */
  private loadFileTreeRequestId = 0;

  /** Handler for backend file:tree-changed push events. */
  private treeMessageHandler: ((event: MessageEvent) => void) | null = null;

  /** Debounce timer for frontend-side tree refresh coalescing. */
  private treeRefreshDebounceTimer: ReturnType<typeof setTimeout> | null = null;

  public constructor(
    private readonly state: EditorInternalState,
    private readonly callbacks: {
      /** Re-open a file after a file:content-changed push for non-dirty tabs. */
      handleFileContentChanged(filePath: string): Promise<void>;
      /** Close the split pane (used when the removed workspace was active). */
      closeSplit(): void;
    },
  ) {}

  /**
   * Switch the active workspace, saving current editor state and
   * restoring the target workspace's state.
   */
  public switchWorkspace(workspacePath: string): void {
    const currentActive = this.state.getActiveWorkspacePath();
    if (currentActive === workspacePath) return;

    // Step 1: save current workspace signals into map
    this.saveCurrentWorkspaceState();

    // Step 2: update active workspace pointer
    this.state.setActiveWorkspacePath(workspacePath);

    // Step 3: restore from cache or fetch fresh
    const cachedState = this.state.workspaceEditorState.get(workspacePath);
    if (cachedState) {
      this.state.fileTree.set(cachedState.fileTree);
      this.state.activeFilePath.set(cachedState.activeFilePath);
      this.state.activeFileContent.set(cachedState.activeFileContent);
      this.state.openTabs.set(cachedState.openTabs);

      this.state.splitActive.set(cachedState.splitActive ?? false);
      this.state.splitFilePath.set(cachedState.splitFilePath);
      this.state.splitFileContent.set(cachedState.splitFileContent ?? '');
      if (!cachedState.splitActive) {
        this.state.focusedPane.set('left');
      }
    } else {
      this.state.fileTree.set([]);
      this.state.activeFilePath.set(undefined);
      this.state.activeFileContent.set('');
      this.state.openTabs.set([]);
      this.state.splitActive.set(false);
      this.state.splitFilePath.set(undefined);
      this.state.splitFileContent.set('');
      this.state.focusedPane.set('left');

      this.state.workspaceEditorState.set(workspacePath, {
        fileTree: [],
        activeFilePath: undefined,
        activeFileContent: '',
        openTabs: [],
      });

      void this.loadFileTree(workspacePath);
    }
  }

  /** Remove cached state for a workspace (e.g., workspace folder removed). */
  public removeWorkspaceState(workspacePath: string): void {
    this.state.workspaceEditorState.delete(workspacePath);

    if (this.state.getActiveWorkspacePath() === workspacePath) {
      this.state.setActiveWorkspacePath(null);
      this.state.fileTree.set([]);
      this.state.activeFilePath.set(undefined);
      this.state.activeFileContent.set('');
      this.state.openTabs.set([]);
      this.callbacks.closeSplit();
    }
  }

  /** Save current workspace's signals into its cache entry. */
  public saveCurrentWorkspaceState(): void {
    const activePath = this.state.getActiveWorkspacePath();
    if (!activePath) return;

    const existing = this.state.workspaceEditorState.get(activePath);
    this.state.workspaceEditorState.set(activePath, {
      fileTree: this.state.fileTree(),
      activeFilePath: this.state.activeFilePath(),
      activeFileContent: this.state.activeFileContent(),
      openTabs: this.state.openTabs(),
      scrollPosition: existing?.scrollPosition,
      cursorPosition: existing?.cursorPosition,
      splitActive: this.state.splitActive(),
      splitFilePath: this.state.splitFilePath(),
      splitFileContent: this.state.splitFileContent(),
    });
  }

  /**
   * Load the file tree for the given workspace (or the active workspace if
   * no path is supplied). Implements stale-response protection via a
   * monotonically-increasing request id.
   */
  public async loadFileTree(rootPath?: string): Promise<void> {
    const targetWorkspace = rootPath || this.state.getActiveWorkspacePath();
    if (!targetWorkspace) return;

    const requestId = ++this.loadFileTreeRequestId;

    this.state.isLoading.set(true);
    this.state.clearError();

    try {
      const result = await rpcCall<{ tree: FileTreeNode[] }>(
        this.state.vscodeService,
        'editor:getFileTree',
        { rootPath: targetWorkspace },
      );

      if (
        this.loadFileTreeRequestId !== requestId ||
        this.state.getActiveWorkspacePath() !== targetWorkspace
      ) {
        return;
      }

      if (result.success && result.data) {
        const tree = result.data.tree ?? [];
        const previousTree = this.state.fileTree();
        const merged = this.mergeLoadedSubtrees(tree, previousTree);
        this.state.fileTree.set(merged);
        const cached = this.state.workspaceEditorState.get(targetWorkspace);
        if (cached) {
          cached.fileTree = merged;
        }
      } else {
        this.state.showError(result.error ?? 'Failed to load file tree');
      }
    } finally {
      if (this.loadFileTreeRequestId === requestId) {
        this.state.isLoading.set(false);
      }
    }
  }

  /**
   * Lazy-load a directory's children (used when tree depth boundary hit).
   */
  public async loadDirectoryChildren(dirPath: string): Promise<void> {
    const result = await rpcCall<{ children: FileTreeNode[] }>(
      this.state.vscodeService,
      'editor:getDirectoryChildren',
      { dirPath },
    );

    if (result.success && result.data) {
      const children = result.data.children ?? [];
      const updatedTree = this.updateNodeChildren(
        this.state.fileTree(),
        dirPath,
        children,
      );
      this.state.fileTree.set(updatedTree);

      const active = this.state.getActiveWorkspacePath();
      if (active) {
        const cached = this.state.workspaceEditorState.get(active);
        if (cached) {
          cached.fileTree = updatedTree;
        }
      }
    } else {
      this.state.showError(result.error ?? 'Failed to load directory');
    }
  }

  /** Recursively replace a node's children (immutable update for signals). */
  public updateNodeChildren(
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
   * Preserve lazy-loaded subtrees across a tree refresh.
   *
   * The backend `editor:getFileTree` RPC builds the tree to a fixed depth
   * (currently 6) from the workspace root. Directories deeper than that
   * boundary come back as `{ needsLoad: true, children: [] }`. When the
   * user has previously expanded such a directory (triggering
   * `loadDirectoryChildren` to populate it), a subsequent full-tree
   * refresh — for example from a file watcher tick or a local CRUD
   * operation — would WIPE those loaded children, collapsing the user's
   * expanded view and forcing them to re-expand each deep directory.
   *
   * This helper walks the freshly-fetched tree and, for every node that
   * still reports `needsLoad: true` with no children, looks up the matching
   * path in the previous tree. If the previous node was already loaded
   * (had children, or `needsLoad === false`), its children are carried
   * over into the new node and the flag is cleared. Recursion continues
   * into the carried-over children so nested expanded subtrees are also
   * preserved.
   *
   * Paths are normalized to forward slashes for matching (consistent with
   * the rest of the editor code that calls `.replace(/\\/g, '/')`).
   */
  public mergeLoadedSubtrees(
    newTree: FileTreeNode[],
    previousTree: FileTreeNode[],
  ): FileTreeNode[] {
    if (!previousTree || previousTree.length === 0) return newTree;

    // Build a path → node index of the previous tree for O(1) lookup.
    const prevIndex = new Map<string, FileTreeNode>();
    const indexNodes = (nodes: FileTreeNode[]): void => {
      for (const node of nodes) {
        const key = node.path.replace(/\\/g, '/');
        prevIndex.set(key, node);
        if (node.children && node.children.length > 0) {
          indexNodes(node.children);
        }
      }
    };
    indexNodes(previousTree);

    const mergeNode = (newNode: FileTreeNode): FileTreeNode => {
      const key = newNode.path.replace(/\\/g, '/');
      const prevNode = prevIndex.get(key);

      // Type changed (file ↔ directory) — drop previous, take new as-is.
      if (prevNode && prevNode.type !== newNode.type) {
        if (newNode.children && newNode.children.length > 0) {
          return {
            ...newNode,
            children: newNode.children.map(mergeNode),
          };
        }
        return newNode;
      }

      // Boundary case: backend says needsLoad but we already loaded it before.
      if (
        newNode.type === 'directory' &&
        newNode.needsLoad === true &&
        (!newNode.children || newNode.children.length === 0) &&
        prevNode &&
        prevNode.type === 'directory' &&
        (prevNode.needsLoad === false ||
          (prevNode.children && prevNode.children.length > 0))
      ) {
        const carriedChildren = (prevNode.children ?? []).map(mergeNode);
        return {
          ...newNode,
          needsLoad: false,
          children: carriedChildren,
        };
      }

      // Default: recurse into any children present on the new node.
      if (newNode.children && newNode.children.length > 0) {
        return {
          ...newNode,
          children: newNode.children.map(mergeNode),
        };
      }

      return newNode;
    };

    return newTree.map(mergeNode);
  }

  /** Start listening for file:tree-changed and file:content-changed pushes. */
  public startFileTreeWatcher(): void {
    if (this.treeMessageHandler) return;

    this.treeMessageHandler = (event: MessageEvent) => {
      const data = event.data;
      if (data?.type === 'file:tree-changed') {
        if (this.treeRefreshDebounceTimer) {
          clearTimeout(this.treeRefreshDebounceTimer);
        }
        this.treeRefreshDebounceTimer = setTimeout(() => {
          this.treeRefreshDebounceTimer = null;
          void this.loadFileTree();
        }, 500);
      }

      if (data?.type === 'file:content-changed' && data?.payload?.filePath) {
        void this.callbacks.handleFileContentChanged(data.payload.filePath);
      }
    };
    window.addEventListener('message', this.treeMessageHandler);
  }

  /** Stop listening and clean up the debounce timer. */
  public stopFileTreeWatcher(): void {
    if (this.treeMessageHandler) {
      window.removeEventListener('message', this.treeMessageHandler);
      this.treeMessageHandler = null;
    }
    if (this.treeRefreshDebounceTimer) {
      clearTimeout(this.treeRefreshDebounceTimer);
      this.treeRefreshDebounceTimer = null;
    }
  }
}

// Re-export for coordinator typing convenience
export type { EditorWorkspaceState };
export { extractFileName, IMAGE_EXTENSIONS };
