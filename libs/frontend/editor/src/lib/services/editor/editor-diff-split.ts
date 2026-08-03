import { rpcCall } from '@ptah-extension/core';
import type {
  GitDiffFileParams,
  GitDiffFileResult,
} from '@ptah-extension/shared';
import type { EditorInternalState } from './editor-internal-state';
import { extractFileName } from './editor-internal-state';
import type { EditorTabsHelper } from './editor-tabs';
import type {
  DiffComparison,
  DiffTabState,
  EditorTab,
  OpenDiffRequest,
} from './editor-tab.types';
import {
  diffComparisonLabel,
  diffTabKey,
  diffTabLabel,
  normalizeDiffPath,
} from './editor-tab.types';

import {
  describeGitReadError,
  firstReadError,
  GIT_READ_TRANSPORT_MESSAGE,
  readSideText,
} from './git-read-error-messages';

export type { OpenDiffRequest };

/**
 * EditorDiffSplitHelper — diff view + side-by-side split pane.
 *
 * Mutates the coordinator's split signals and the openTabs signal when
 * creating diff tabs. Uses {@link EditorTabsHelper} for cache-sync.
 *
 * Diff tabs are revalidated from `git:status-update` rather than held as a
 * frozen snapshot: a tab opened before a commit used to keep showing the
 * pre-commit diff forever (A1).
 */
export class EditorDiffSplitHelper {
  /**
   * Coalescing window for `git:status-update`-driven revalidation. A single
   * git operation fans out several watcher events; one refresh per workspace
   * per window is enough and keeps the RPC count bounded (NFR-7).
   */
  private static readonly DIFF_REFRESH_DEBOUNCE_MS = 250;

  /**
   * Diff tab keys with a `git:diffFile` call in flight. Mirrors
   * `EditorFileOpsHelper.inFlightRereads` — without it a burst of git
   * operations stacks refreshes faster than the backend can service them.
   */
  private readonly inFlightDiffRefreshes = new Set<string>();

  /** Debounce timers for diff revalidation, keyed by workspace root. */
  private readonly refreshDebounceTimers = new Map<
    string,
    ReturnType<typeof setTimeout>
  >();

  public constructor(
    private readonly state: EditorInternalState,
    private readonly tabs: EditorTabsHelper,
  ) {}

  // -------------------------------------------------------------------------
  // Opening
  // -------------------------------------------------------------------------

  /**
   * Open a diff view for one side-pair of a file.
   *
   * Re-clicking a row does NOT early-return: it activates the existing tab and
   * revalidates it, so the diff a user re-opens is never the diff they saw ten
   * commits ago (A1 AC4).
   */
  public async openDiff(request: OpenDiffRequest): Promise<void> {
    const path = normalizeDiffPath(request.path);
    const key = diffTabKey(request.comparison, path);

    const existingTab = this.state.openTabs().find((t) => t.filePath === key);
    if (existingTab) {
      this.state.activeFilePath.set(key);
      this.state.activeFileContent.set(existingTab.content);
      await this.refreshDiffTab(key);
      return;
    }

    const originalPath = request.origPath
      ? normalizeDiffPath(request.origPath)
      : path;

    this.state.isLoading.set(true);
    this.state.clearError();
    const originWorkspace = this.state.getActiveWorkspacePath();

    let diff: DiffTabState;
    this.inFlightDiffRefreshes.add(key);
    try {
      const result = await this.requestDiff(
        path,
        request.comparison,
        originalPath,
      );
      diff = result
        ? this.toDiffState(result, 1)
        : this.transportFailureState(path, originalPath, request.comparison, 1);
    } finally {
      this.inFlightDiffRefreshes.delete(key);
      this.state.isLoading.set(false);
    }

    // The user may have switched workspace while the read was in flight; the
    // tab belongs to the workspace it was requested from, not to whatever is
    // active now.
    if (this.state.getActiveWorkspacePath() !== originWorkspace) return;
    if (this.state.openTabs().some((t) => t.filePath === key)) return;

    const tab: EditorTab = {
      filePath: key,
      fileName: this.labelFor(diff),
      content: diff.modified,
      isDirty: false,
      diff,
    };

    this.state.openTabs.update((tabs) => [...tabs, tab]);
    this.state.activeFilePath.set(key);
    this.state.activeFileContent.set(diff.modified);
    this.tabs.syncTabsToCache();
  }

  // -------------------------------------------------------------------------
  // Revalidation (A1)
  // -------------------------------------------------------------------------

  /**
   * Handle a `git:status-update` push: revalidate every diff tab belonging to
   * the pushed workspace, coalesced over a short window.
   *
   * `workspaceRoot` is absent only on payloads from older backends, which the
   * shared payload contract says to treat as "the active workspace".
   */
  public onGitStatusUpdate(workspaceRoot?: string): void {
    const active = this.state.getActiveWorkspacePath();
    const target = workspaceRoot ?? active ?? '';
    // openTabs only ever holds the ACTIVE workspace's tabs, so a push for a
    // background workspace has nothing here to refresh.
    if (active !== null && target !== active) return;

    const existing = this.refreshDebounceTimers.get(target);
    if (existing) clearTimeout(existing);
    this.refreshDebounceTimers.set(
      target,
      setTimeout(() => {
        this.refreshDebounceTimers.delete(target);
        void this.refreshAllDiffTabs();
      }, EditorDiffSplitHelper.DIFF_REFRESH_DEBOUNCE_MS),
    );
  }

  /**
   * Handle a `file:content-changed` push for an ABSOLUTE path: only working-tree
   * diffs read the file on disk, so only those need revalidating.
   */
  public onFileContentChanged(absolutePath: string): void {
    const relative = this.toWorkspaceRelative(absolutePath);
    if (!relative) return;

    for (const tab of this.state.openTabs()) {
      if (tab.diff?.comparison !== 'worktree') continue;
      if (tab.diff.path !== relative) continue;
      void this.refreshDiffTab(tab.filePath);
    }
  }

  /** Revalidate every open diff tab in the active workspace. */
  public async refreshAllDiffTabs(): Promise<void> {
    const keys = this.state
      .openTabs()
      .filter((t) => t.diff)
      .map((t) => t.filePath);
    await Promise.all(keys.map((key) => this.refreshDiffTab(key)));
  }

  /**
   * Re-read one diff tab from git.
   *
   * Content is never cleared while the read is in flight — the previous diff
   * stays on screen and only the status indicator moves (A1 AC6). A failed read
   * likewise retains the previous content and surfaces a persistent error
   * rather than pretending the file is empty (A1 AC7, A3).
   */
  public async refreshDiffTab(key: string): Promise<void> {
    const tab = this.state.openTabs().find((t) => t.filePath === key);
    if (!tab?.diff) return;
    if (this.inFlightDiffRefreshes.has(key)) return;

    const originWorkspace = this.state.getActiveWorkspacePath();
    const requestId = tab.diff.requestId + 1;
    const { comparison, path, originalPath } = tab.diff;

    this.patchDiff(key, (diff) => ({
      ...diff,
      requestId,
      status: 'refreshing',
    }));

    this.inFlightDiffRefreshes.add(key);
    let result: GitDiffFileResult | null;
    try {
      result = await this.requestDiff(path, comparison, originalPath);
    } finally {
      this.inFlightDiffRefreshes.delete(key);
    }

    // Drop the response if the world moved on: newer request, workspace
    // switched, or the tab was closed while we waited.
    if (this.state.getActiveWorkspacePath() !== originWorkspace) return;
    const liveTab = this.state.openTabs().find((t) => t.filePath === key);
    if (!liveTab?.diff || liveTab.diff.requestId !== requestId) return;

    if (!result) {
      this.patchDiff(key, (diff) => ({
        ...diff,
        status: 'stale',
        errorMessage: GIT_READ_TRANSPORT_MESSAGE,
        errorDetail: undefined,
      }));
      return;
    }

    const next = this.toDiffState(result, requestId);
    if (next.status !== 'fresh') {
      // Retain the content the user is looking at; only the status changes.
      this.patchDiff(key, (diff) => ({
        ...diff,
        status: next.status,
        errorMessage: next.errorMessage,
        errorDetail: next.errorDetail,
      }));
      return;
    }

    this.applyFreshDiff(key, next);
  }

  /** Clear every pending revalidation timer (teardown; mirrors C1 AC3). */
  public dispose(): void {
    for (const timer of this.refreshDebounceTimers.values()) {
      clearTimeout(timer);
    }
    this.refreshDebounceTimers.clear();
  }

  // -------------------------------------------------------------------------
  // Split pane
  // -------------------------------------------------------------------------

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

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  /**
   * One RPC per diff tab. Returns `null` only for a TRANSPORT failure — the
   * handler itself always answers with a well-formed result, including for
   * invalid params and rejected paths.
   */
  private async requestDiff(
    path: string,
    comparison: DiffComparison,
    originalPath: string,
  ): Promise<GitDiffFileResult | null> {
    const workspaceRoot = this.state.getActiveWorkspacePath();
    const result = await rpcCall<GitDiffFileResult>(
      this.state.vscodeService,
      'git:diffFile',
      {
        path,
        comparison,
        ...(originalPath !== path ? { originalPath } : {}),
        ...(workspaceRoot ? { workspaceRoot } : {}),
      } satisfies GitDiffFileParams,
    );
    return result.success && result.data ? result.data : null;
  }

  /** Project a `git:diffFile` result onto the tab record. */
  private toDiffState(
    result: GitDiffFileResult,
    requestId: number,
  ): DiffTabState {
    const failure = firstReadError(result.original, result.modified);
    const isBinary =
      result.original.outcome === 'binary' ||
      result.modified.outcome === 'binary';

    // An empty snapshot token means the backend never reached a real
    // repository read (invalid params, no workspace, rejected path). Such a
    // response has never been validated against anything and is never fresh.
    const validated = result.snapshotToken !== '';

    return {
      comparison: result.comparison,
      path: result.path,
      originalPath: result.originalPath,
      original: readSideText(result.original),
      modified: readSideText(result.modified),
      originalRef: result.originalRef,
      modifiedRef: result.modifiedRef,
      snapshotToken: result.snapshotToken,
      isBinary,
      status: failure || !validated ? 'error' : 'fresh',
      errorMessage: failure
        ? describeGitReadError(failure.code)
        : validated
          ? undefined
          : describeGitReadError('unknown'),
      errorDetail: failure?.message || undefined,
      requestId,
    };
  }

  /**
   * State for a diff tab whose very FIRST read never landed.
   *
   * `error`, not `stale`: `stale` means "what you are looking at may be out of
   * date", and here there is nothing to look at. The refs are placeholders and
   * are deliberately not trusted for chrome — the view suppresses new/deleted
   * chrome whenever the status is `error`, so this cannot claim the file was
   * deleted just because nothing could be read.
   */
  private transportFailureState(
    path: string,
    originalPath: string,
    comparison: DiffComparison,
    requestId: number,
  ): DiffTabState {
    return {
      comparison,
      path,
      originalPath,
      original: '',
      modified: '',
      originalRef: { kind: 'absent' },
      modifiedRef: { kind: 'absent' },
      snapshotToken: '',
      isBinary: false,
      status: 'error',
      errorMessage: GIT_READ_TRANSPORT_MESSAGE,
      requestId,
    };
  }

  /**
   * Tab title for a diff record.
   *
   * An empty snapshot token means the backend never reached a real repository
   * read, so the refs carry no information — the label falls back to the
   * comparison alone rather than announcing "deleted" or "new" on the strength
   * of placeholder refs.
   */
  private labelFor(diff: DiffTabState): string {
    const fileName = extractFileName(diff.path);
    if (diff.snapshotToken === '') {
      return `${fileName} (${diffComparisonLabel(diff.comparison)})`;
    }
    return diffTabLabel(
      fileName,
      diff.comparison,
      diff.originalRef,
      diff.modifiedRef,
    );
  }

  /** Write a validated diff into the tab, keeping active-file state in step. */
  private applyFreshDiff(key: string, next: DiffTabState): void {
    this.state.openTabs.update((tabs) =>
      tabs.map((tab) =>
        tab.filePath === key
          ? {
              ...tab,
              fileName: this.labelFor(next),
              content: next.modified,
              diff: next,
            }
          : tab,
      ),
    );

    if (this.state.activeFilePath() === key) {
      this.state.activeFileContent.set(next.modified);
      this.tabs.updateCachedActiveFile(key, next.modified);
    }
    this.tabs.syncTabsToCache();
  }

  /** Immutably patch one diff tab's descriptor. */
  private patchDiff(
    key: string,
    patch: (diff: DiffTabState) => DiffTabState,
  ): void {
    this.state.openTabs.update((tabs) =>
      tabs.map((tab) =>
        tab.filePath === key && tab.diff
          ? { ...tab, diff: patch(tab.diff) }
          : tab,
      ),
    );
    this.tabs.syncTabsToCache();
  }

  /**
   * Convert an absolute pushed path to a workspace-relative diff path, or
   * `null` when it lies outside the active workspace.
   */
  private toWorkspaceRelative(absolutePath: string): string | null {
    const root = this.state.getActiveWorkspacePath();
    if (!root || !absolutePath) return null;
    // NOT normalizeDiffPath: the root is absolute and must keep its leading
    // separator, which the relative-path normalizer deliberately strips.
    const normalizedRoot = root.replace(/\\/g, '/').replace(/\/$/, '');
    const normalizedPath = absolutePath.replace(/\\/g, '/');
    const prefix = normalizedRoot + '/';
    if (!normalizedPath.startsWith(prefix)) return null;
    return normalizedPath.slice(prefix.length);
  }
}
