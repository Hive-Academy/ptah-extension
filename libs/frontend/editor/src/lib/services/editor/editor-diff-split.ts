import { rpcCall } from '../rpc-call.util';
import type { EditorInternalState } from './editor-internal-state';
import { extractFileName } from './editor-internal-state';
import type { EditorTabsHelper } from './editor-tabs';

/**
 * EditorDiffSplitHelper — diff view + side-by-side split pane.
 *
 * Mutates the coordinator's split signals and the openTabs signal when
 * creating diff tabs. Uses {@link EditorTabsHelper} for cache-sync.
 */
export class EditorDiffSplitHelper {
  public constructor(
    private readonly state: EditorInternalState,
    private readonly tabs: EditorTabsHelper,
  ) {}

  /**
   * Open a diff view for a file, showing HEAD version alongside working-tree
   * version. Creates a special tab with `diff:` prefixed key to distinguish
   * from regular file tabs.
   */
  public async openDiff(
    relativePath: string,
    absolutePath: string,
  ): Promise<void> {
    const diffKey = `diff:${relativePath}`;

    const existingTab = this.state
      .openTabs()
      .find((t) => t.filePath === diffKey);
    if (existingTab) {
      this.state.activeFilePath.set(diffKey);
      this.state.activeFileContent.set(existingTab.content);
      return;
    }

    this.state.isLoading.set(true);
    this.state.clearError();

    const [originalResult, currentResult] = await Promise.all([
      rpcCall<{ content: string }>(this.state.vscodeService, 'git:showFile', {
        path: relativePath,
      }),
      rpcCall<{ content: string; filePath: string }>(
        this.state.vscodeService,
        'editor:openFile',
        { filePath: absolutePath },
      ),
    ]);

    const originalContent = originalResult.success
      ? (originalResult.data?.content ?? '')
      : '';
    const currentContent = currentResult.success
      ? (currentResult.data?.content ?? '')
      : '';

    const fileName = extractFileName(relativePath);

    this.state.openTabs.update((tabs) => [
      ...tabs,
      {
        filePath: diffKey,
        fileName: `${fileName} (diff)`,
        content: currentContent,
        isDirty: false,
        isDiff: true,
        originalContent,
        diffRelativePath: relativePath,
      },
    ]);

    this.state.activeFilePath.set(diffKey);
    this.state.activeFileContent.set(currentContent);
    this.state.isLoading.set(false);
    this.tabs.syncTabsToCache();
  }

  /** Open a file in the split (right) pane, reusing cached tab content when available. */
  public async openFileInSplit(filePath: string): Promise<void> {
    this.state.splitFilePath.set(filePath);
    this.state.splitActive.set(true);

    const existingTab = this.state
      .openTabs()
      .find((t) => t.filePath === filePath);
    if (existingTab) {
      this.state.splitFileContent.set(existingTab.content);
      return;
    }

    const result = await rpcCall<{ content: string; filePath: string }>(
      this.state.vscodeService,
      'editor:openFile',
      { filePath },
    );

    if (result.success && result.data) {
      this.state.splitFileContent.set(result.data.content ?? '');
    } else {
      this.state.showError(result.error ?? 'Failed to open file in split pane');
      this.closeSplit();
    }
  }

  /** Close the split pane and return focus to the left pane. */
  public closeSplit(): void {
    this.state.splitActive.set(false);
    this.state.splitFilePath.set(undefined);
    this.state.splitFileContent.set('');
    this.state.focusedPane.set('left');
  }

  /** Set which pane has focus. */
  public setFocusedPane(pane: 'left' | 'right'): void {
    this.state.focusedPane.set(pane);
  }

  /** Update the content of the split (right) pane. */
  public updateSplitContent(content: string): void {
    this.state.splitFileContent.set(content);
  }
}
