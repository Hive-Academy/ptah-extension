import type { EditorInternalState } from './editor-internal-state';

/**
 * EditorTabsHelper — open-tab management (close / switch / updateContent /
 * markClean) plus the small cache-sync utilities used across helpers.
 *
 * Owns no signals — mutates the coordinator's `openTabs`, `activeFilePath`,
 * `activeFileContent` signals through {@link EditorInternalState}.
 */
export class EditorTabsHelper {
  public constructor(
    private readonly state: EditorInternalState,
    private readonly callbacks: {
      /** Clear the active file signals + cache. */
      clearActiveFile(): void;
      /** Close the split pane (called when closed tab was the split file). */
      closeSplit(): void;
    },
  ) {}

  /**
   * Update the cached active-file path + content for the current workspace.
   * Shared helper — used by many flows that change the active file.
   */
  public updateCachedActiveFile(filePath: string, content: string): void {
    const activePath = this.state.getActiveWorkspacePath();
    if (activePath) {
      const cached = this.state.workspaceEditorState.get(activePath);
      if (cached) {
        cached.activeFilePath = filePath;
        cached.activeFileContent = content;
      }
    }
  }

  /** Sync the current openTabs signal into the workspace state cache. */
  public syncTabsToCache(): void {
    const activePath = this.state.getActiveWorkspacePath();
    if (activePath) {
      const cached = this.state.workspaceEditorState.get(activePath);
      if (cached) {
        cached.openTabs = this.state.openTabs();
      }
    }
  }

  /**
   * Close a tab by file path. Switches to an adjacent tab if the closed tab
   * was active, clears the editor if it was the last tab, and closes the
   * split pane if the closed file was the split file.
   */
  public closeTab(filePath: string): void {
    const currentTabs = this.state.openTabs();
    const tabIndex = currentTabs.findIndex((t) => t.filePath === filePath);
    if (tabIndex === -1) return;

    const updatedTabs = currentTabs.filter((t) => t.filePath !== filePath);
    this.state.openTabs.set(updatedTabs);

    if (this.state.splitActive() && this.state.splitFilePath() === filePath) {
      this.callbacks.closeSplit();
    }

    if (this.state.activeFilePath() === filePath) {
      if (updatedTabs.length > 0) {
        const newIndex = Math.min(tabIndex, updatedTabs.length - 1);
        const newActive = updatedTabs[newIndex];
        this.state.activeFilePath.set(newActive.filePath);
        this.state.activeFileContent.set(newActive.content);
        this.updateCachedActiveFile(newActive.filePath, newActive.content);
      } else {
        this.callbacks.clearActiveFile();
      }
    }

    this.syncTabsToCache();
  }

  /** Switch to an already-open tab, updating active signals from its cache. */
  public switchTab(filePath: string): void {
    const tab = this.state.openTabs().find((t) => t.filePath === filePath);
    if (!tab) return;

    this.state.activeFilePath.set(tab.filePath);
    this.state.activeFileContent.set(tab.content);
    this.updateCachedActiveFile(tab.filePath, tab.content);
  }

  /** Update a tab's content and mark it dirty. */
  public updateTabContent(filePath: string, content: string): void {
    this.state.openTabs.update((tabs) =>
      tabs.map((tab) =>
        tab.filePath === filePath ? { ...tab, content, isDirty: true } : tab,
      ),
    );
    this.syncTabsToCache();
  }

  /** Mark a tab clean (e.g., after a successful save). */
  public markTabClean(filePath: string): void {
    this.state.openTabs.update((tabs) =>
      tabs.map((tab) =>
        tab.filePath === filePath ? { ...tab, isDirty: false } : tab,
      ),
    );
    this.syncTabsToCache();
  }
}
