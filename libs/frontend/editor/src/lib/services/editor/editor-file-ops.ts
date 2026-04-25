import { rpcCall } from '@ptah-extension/core';
import type { EditorTab } from '../editor.service';
import type { EditorInternalState } from './editor-internal-state';
import { extractFileName, IMAGE_EXTENSIONS } from './editor-internal-state';
import type { EditorTabsHelper } from './editor-tabs';

/**
 * EditorFileOpsHelper — per-file CRUD and open-file flows.
 *
 * Handles open / save / create / rename / delete plus the small helpers for
 * clear-active-file, file:content-changed push handling, and reveal-line
 * (one-shot signal) coordination.
 *
 * Delegates tab bookkeeping to {@link EditorTabsHelper} to keep cache-sync
 * concerns co-located.
 */
export class EditorFileOpsHelper {
  public constructor(
    private readonly state: EditorInternalState,
    private readonly tabs: EditorTabsHelper,
    private readonly callbacks: {
      /** Reload the workspace file tree (used after CRUD ops). */
      loadFileTree(rootPath?: string): Promise<void>;
    },
  ) {}

  /**
   * Open a file by path. Reuses cached tab content when available;
   * image files skip the RPC load (they render via file:// URL).
   */
  public async openFile(filePath: string): Promise<void> {
    const existingTab = this.state
      .openTabs()
      .find((t) => t.filePath === filePath);
    if (existingTab) {
      this.state.activeFilePath.set(filePath);
      this.state.activeFileContent.set(existingTab.content);
      this.tabs.updateCachedActiveFile(filePath, existingTab.content);
      return;
    }

    this.state.activeFilePath.set(filePath);

    const ext = filePath.substring(filePath.lastIndexOf('.')).toLowerCase();
    if (IMAGE_EXTENSIONS.has(ext)) {
      const fileName = extractFileName(filePath);
      this.state.activeFileContent.set('');
      this.state.openTabs.update((tabs) => [
        ...tabs,
        { filePath, fileName, content: '', isDirty: false },
      ]);
      this.tabs.updateCachedActiveFile(filePath, '');
      this.tabs.syncTabsToCache();
      return;
    }

    this.state.isLoading.set(true);
    this.state.clearError();

    const result = await rpcCall<{ content: string; filePath: string }>(
      this.state.vscodeService,
      'editor:openFile',
      { filePath },
    );

    if (result.success && result.data) {
      const content = result.data.content ?? '';
      this.state.activeFileContent.set(content);

      const fileName = extractFileName(filePath);
      this.state.openTabs.update((tabs) => [
        ...tabs,
        { filePath, fileName, content, isDirty: false },
      ]);

      this.tabs.updateCachedActiveFile(filePath, content);
      this.tabs.syncTabsToCache();
    } else {
      this.state.showError(result.error ?? 'Failed to open file');
    }
    this.state.isLoading.set(false);
  }

  /** Clear active file signals + cache. */
  public clearActiveFile(): void {
    this.state.activeFilePath.set(undefined);
    this.state.activeFileContent.set('');

    const activePath = this.state.getActiveWorkspacePath();
    if (activePath) {
      const cached = this.state.workspaceEditorState.get(activePath);
      if (cached) {
        cached.activeFilePath = undefined;
        cached.activeFileContent = '';
      }
    }
  }

  /** Persist file content via RPC. */
  public async saveFile(filePath: string, content: string): Promise<void> {
    this.state.isLoading.set(true);
    this.state.clearError();

    const result = await rpcCall<{ success: boolean }>(
      this.state.vscodeService,
      'editor:saveFile',
      { filePath, content },
    );

    if (!result.success) {
      this.state.showError(result.error ?? 'Failed to save file');
    }
    this.state.isLoading.set(false);
  }

  /** Create a new file; refreshes the tree on success. */
  public async createFile(filePath: string): Promise<boolean> {
    const result = await rpcCall<{ success: boolean; error?: string }>(
      this.state.vscodeService,
      'editor:createFile',
      { filePath },
    );
    if (result.success && result.data?.success) {
      await this.callbacks.loadFileTree();
      return true;
    }
    this.state.showError(
      result.data?.error ?? result.error ?? 'Failed to create file',
    );
    return false;
  }

  /** Create a new folder; refreshes the tree on success. */
  public async createFolder(folderPath: string): Promise<boolean> {
    const result = await rpcCall<{ success: boolean; error?: string }>(
      this.state.vscodeService,
      'editor:createFolder',
      { folderPath },
    );
    if (result.success && result.data?.success) {
      await this.callbacks.loadFileTree();
      return true;
    }
    this.state.showError(
      result.data?.error ?? result.error ?? 'Failed to create folder',
    );
    return false;
  }

  /**
   * Rename a file or folder. Updates open tabs (including children on
   * directory rename) and active-file pointer, then refreshes the tree.
   */
  public async renameItem(oldPath: string, newPath: string): Promise<boolean> {
    const result = await rpcCall<{ success: boolean; error?: string }>(
      this.state.vscodeService,
      'editor:renameItem',
      { oldPath, newPath },
    );
    if (result.success && result.data?.success) {
      const normalizedOld = oldPath.replace(/\\/g, '/');
      const normalizedNew = newPath.replace(/\\/g, '/');
      const newFileName = extractFileName(normalizedNew);

      this.state.openTabs.update((tabs) =>
        tabs.map((tab) => {
          const normalizedTab = tab.filePath.replace(/\\/g, '/');
          if (normalizedTab === normalizedOld) {
            return { ...tab, filePath: normalizedNew, fileName: newFileName };
          }
          const oldPrefix = normalizedOld + '/';
          if (normalizedTab.startsWith(oldPrefix)) {
            const newTabPath =
              normalizedNew + '/' + normalizedTab.slice(oldPrefix.length);
            return {
              ...tab,
              filePath: newTabPath,
              fileName: extractFileName(newTabPath),
            };
          }
          return tab;
        }),
      );

      const currentActive = this.state.activeFilePath()?.replace(/\\/g, '/');
      if (currentActive === normalizedOld) {
        this.state.activeFilePath.set(normalizedNew);
      } else if (currentActive?.startsWith(normalizedOld + '/')) {
        this.state.activeFilePath.set(
          normalizedNew + '/' + currentActive.slice(normalizedOld.length + 1),
        );
      }

      this.tabs.syncTabsToCache();
      await this.callbacks.loadFileTree();
      return true;
    }
    this.state.showError(
      result.data?.error ?? result.error ?? 'Failed to rename',
    );
    return false;
  }

  /**
   * Delete a file or folder. Closes tabs for deleted paths (including all
   * tabs under a deleted directory), then refreshes the tree.
   */
  public async deleteItem(
    itemPath: string,
    isDirectory: boolean,
  ): Promise<boolean> {
    const result = await rpcCall<{ success: boolean; error?: string }>(
      this.state.vscodeService,
      'editor:deleteItem',
      { itemPath, isDirectory },
    );
    if (result.success && result.data?.success) {
      const normalizedPath = itemPath.replace(/\\/g, '/');

      if (isDirectory) {
        const prefix = normalizedPath + '/';
        const tabsToClose = this.state
          .openTabs()
          .filter((t) => t.filePath.replace(/\\/g, '/').startsWith(prefix))
          .map((t) => t.filePath);
        for (const tabPath of tabsToClose) {
          this.tabs.closeTab(tabPath);
        }
      } else {
        const tab = this.state
          .openTabs()
          .find((t) => t.filePath.replace(/\\/g, '/') === normalizedPath);
        if (tab) {
          this.tabs.closeTab(tab.filePath);
        }
      }

      await this.callbacks.loadFileTree();
      return true;
    }
    this.state.showError(
      result.data?.error ?? result.error ?? 'Failed to delete',
    );
    return false;
  }

  /**
   * Respond to a `file:content-changed` push from the backend. Re-reads
   * content for non-dirty open tabs (backend file was modified outside
   * our knowledge).
   */
  public async handleFileContentChanged(filePath: string): Promise<void> {
    const tabs = this.state.openTabs();
    const tab = tabs.find((t) => t.filePath === filePath);
    if (!tab || tab.isDirty) return;

    const result = await rpcCall<{ content: string; filePath: string }>(
      this.state.vscodeService,
      'editor:openFile',
      { filePath },
    );

    if (!result.success || !result.data) return;

    const newContent = result.data.content ?? '';
    if (newContent === tab.content) return;

    this.state.openTabs.update((currentTabs: EditorTab[]) =>
      currentTabs.map((t) =>
        t.filePath === filePath ? { ...t, content: newContent } : t,
      ),
    );

    if (this.state.activeFilePath() === filePath) {
      this.state.activeFileContent.set(newContent);
    }

    const activePath = this.state.activeFilePath();
    if (activePath) {
      this.tabs.updateCachedActiveFile(
        activePath,
        this.state.activeFilePath() === filePath
          ? newContent
          : this.state.activeFileContent(),
      );
    }
    this.tabs.syncTabsToCache();
  }
}
