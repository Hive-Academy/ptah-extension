import { Injectable, computed, inject, signal } from '@angular/core';
import { VSCodeService, rpcCall } from '@ptah-extension/core';
import type { MessageHandler } from '@ptah-extension/core';
import { MESSAGE_TYPES } from '@ptah-extension/shared';
import type {
  FileContentChangedPayload,
  GitApplyHunksParams,
  GitApplyHunksResult,
  GitDiffFileParams,
  GitDiffFileResult,
  GitStatusUpdatePayload,
} from '@ptah-extension/shared';
import { GitStatusService } from './git-status.service';
import type {
  DiffComparison,
  DiffTabState,
  EditorTab,
  HunkApplyFn,
  HunkApplyRequest,
  OpenDiffRequest,
} from '../types/diff-tab.types';
import {
  diffComparisonLabel,
  diffTabKey,
  diffTabLabel,
  normalizeDiffPath,
} from '../types/diff-tab.types';
import {
  describeGitReadError,
  firstReadError,
  GIT_READ_TRANSPORT_MESSAGE,
  readSideText,
} from './git-read-error-messages';

export type { OpenDiffRequest };

/**
 * Copy for the one apply refusal this service decides for itself (D2 AC6).
 *
 * Deliberately phrased as an instruction rather than an apology: the user's
 * selection is gone and re-selecting is the only way forward.
 */
const SELECTION_SUPERSEDED_MESSAGE =
  'This diff changed while the hunk was selected. Nothing was applied — re-select the hunk and try again.';

/** Copy for an apply whose RPC never reached the backend at all. */
const APPLY_TRANSPORT_MESSAGE =
  'Could not reach git to apply this hunk. Nothing was applied.';

/** Final path segment of an absolute or relative path. */
function extractFileName(filePath: string): string {
  const parts = filePath.replace(/\\/g, '/').split('/');
  return parts[parts.length - 1] || filePath;
}

/**
 * DiffTabsService — the open set of git diff tabs and everything that keeps
 * them truthful.
 *
 * Diff tabs are revalidated from `git:status-update` rather than held as a
 * frozen snapshot: a tab opened before a commit used to keep showing the
 * pre-commit diff forever (A1).
 *
 * The direction of the one dependency here is fixed: `DiffTabsService` reads
 * {@link GitStatusService} for the active workspace path, never the reverse.
 */
@Injectable({ providedIn: 'root' })
export class DiffTabsService implements MessageHandler {
  private readonly vscodeService = inject(VSCodeService);
  private readonly gitStatus = inject(GitStatusService);

  /**
   * Coalescing window for `git:status-update`-driven revalidation. A single
   * git operation fans out several watcher events; one refresh per workspace
   * per window is enough and keeps the RPC count bounded (NFR-7).
   */
  private static readonly DIFF_REFRESH_DEBOUNCE_MS = 250;

  /**
   * Diff tab keys with a `git:diffFile` call in flight. Without it a burst of
   * git operations stacks refreshes faster than the backend can service them.
   */
  private readonly inFlightDiffRefreshes = new Set<string>();

  /** Debounce timers for diff revalidation, keyed by workspace root. */
  private readonly refreshDebounceTimers = new Map<
    string,
    ReturnType<typeof setTimeout>
  >();

  private readonly _diffTabs = signal<EditorTab[]>([]);
  private readonly _activeDiffKey = signal<string | null>(null);
  private readonly _isLoading = signal(false);
  private readonly _errorMessage = signal<string | null>(null);

  /** Every open diff tab, in the order the user opened them. */
  readonly diffTabs = this._diffTabs.asReadonly();

  /** The diff tab key the dock is currently showing, or `null`. */
  readonly activeDiffKey = this._activeDiffKey.asReadonly();

  /** True while a FIRST read for a newly-opened diff is in flight. */
  readonly isLoading = this._isLoading.asReadonly();

  /**
   * Dock-level failure copy — the replacement for the editor coordinator's
   * `showError`, which no longer exists on this side of the split.
   */
  readonly errorMessage = this._errorMessage.asReadonly();

  /** The tab `DiffViewComponent.diffTab` is bound to. */
  readonly activeDiffTab = computed<EditorTab | null>(() => {
    const key = this._activeDiffKey();
    if (!key) return null;
    return this._diffTabs().find((t) => t.filePath === key) ?? null;
  });

  /** The keys `DiffViewComponent.openDiffKeys` is bound to. */
  readonly openDiffKeys = computed<readonly string[]>(() =>
    this._diffTabs().map((t) => t.filePath),
  );

  /**
   * `DiffViewComponent.applyHunks` takes a function rather than injecting this
   * service, so the Skills library can reuse the Monaco diff surface for two
   * in-memory bodies and get no git actions at all. Bound here once so the
   * binding is referentially stable across change detection.
   */
  readonly applyHunksFn: HunkApplyFn = (request) => this.applyHunks(request);

  // -------------------------------------------------------------------------
  // Inbound pushes
  // -------------------------------------------------------------------------

  /**
   * Message types dispatched to {@link handleMessage} by
   * `MessageRouterService`. Registered via the `MESSAGE_HANDLERS`
   * multi-provider in the composition root — this service holds no raw
   * `window` listener of its own.
   */
  readonly handledMessageTypes = [
    MESSAGE_TYPES.GIT_STATUS_UPDATE,
    MESSAGE_TYPES.FILE_CONTENT_CHANGED,
  ] as const;

  handleMessage(message: { type: string; payload?: unknown }): void {
    switch (message.type) {
      case MESSAGE_TYPES.GIT_STATUS_UPDATE: {
        // The authoritative "git state changed" push — it already fires on
        // every commit / stage / checkout / discard, which is exactly when an
        // open diff tab stops being true (A1).
        const payload = message.payload as
          | Partial<GitStatusUpdatePayload>
          | undefined;
        this.onGitStatusUpdate(payload?.workspaceRoot);
        return;
      }
      case MESSAGE_TYPES.FILE_CONTENT_CHANGED: {
        const payload = message.payload as
          | Partial<FileContentChangedPayload>
          | undefined;
        if (payload?.filePath) this.onFileContentChanged(payload.filePath);
        return;
      }
      default:
        return;
    }
  }

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

    const existingTab = this._diffTabs().find((t) => t.filePath === key);
    if (existingTab) {
      this._activeDiffKey.set(key);
      await this.refreshDiffTab(key);
      return;
    }

    const originalPath = request.origPath
      ? normalizeDiffPath(request.origPath)
      : path;

    this._isLoading.set(true);
    this._errorMessage.set(null);
    const originWorkspace = this.activeWorkspacePath();

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
      this._isLoading.set(false);
    }

    // The user may have switched workspace while the read was in flight; the
    // tab belongs to the workspace it was requested from, not to whatever is
    // active now.
    if (this.activeWorkspacePath() !== originWorkspace) return;
    if (this._diffTabs().some((t) => t.filePath === key)) return;

    const tab: EditorTab = {
      filePath: key,
      fileName: this.labelFor(diff),
      content: diff.modified,
      isDirty: false,
      diff,
    };

    this._diffTabs.update((tabs) => [...tabs, tab]);
    this._activeDiffKey.set(key);
  }

  /**
   * Show an already-open diff without re-reading it from git.
   *
   * File-row re-clicks intentionally go through {@link openDiff} so they
   * revalidate. Tab-strip navigation must not: it only changes which cached
   * tab is visible.
   */
  public activateDiff(key: string): void {
    if (!this._diffTabs().some((tab) => tab.filePath === key)) return;
    this._activeDiffKey.set(key);
  }

  /**
   * Close one diff tab. The dock falls back to the last remaining tab rather
   * than to nothing, so closing one of several does not empty the surface.
   */
  public closeDiff(key: string): void {
    const remaining = this._diffTabs().filter((t) => t.filePath !== key);
    if (remaining.length === this._diffTabs().length) return;
    this._diffTabs.set(remaining);
    if (this._activeDiffKey() !== key) return;
    this._activeDiffKey.set(remaining.at(-1)?.filePath ?? null);
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
    const active = this.activeWorkspacePath();
    const target = workspaceRoot ?? active ?? '';
    // diffTabs only ever holds the ACTIVE workspace's tabs, so a push for a
    // background workspace has nothing here to refresh.
    if (active !== null && target !== active) return;

    const existing = this.refreshDebounceTimers.get(target);
    if (existing) clearTimeout(existing);
    this.refreshDebounceTimers.set(
      target,
      setTimeout(() => {
        this.refreshDebounceTimers.delete(target);
        void this.refreshAllDiffTabs();
      }, DiffTabsService.DIFF_REFRESH_DEBOUNCE_MS),
    );
  }

  /**
   * Handle a `file:content-changed` push for an ABSOLUTE path: only
   * working-tree diffs read the file on disk, so only those need revalidating.
   */
  public onFileContentChanged(absolutePath: string): void {
    const relative = this.toWorkspaceRelative(absolutePath);
    if (!relative) return;

    for (const tab of this._diffTabs()) {
      if (tab.diff?.comparison !== 'worktree') continue;
      if (tab.diff.path !== relative) continue;
      void this.refreshDiffTab(tab.filePath);
    }
  }

  /** Revalidate every open diff tab in the active workspace. */
  public async refreshAllDiffTabs(): Promise<void> {
    const keys = this._diffTabs()
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
    const tab = this._diffTabs().find((t) => t.filePath === key);
    if (!tab?.diff) return;
    if (this.inFlightDiffRefreshes.has(key)) return;

    const originWorkspace = this.activeWorkspacePath();
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
    if (this.activeWorkspacePath() !== originWorkspace) return;
    const liveTab = this._diffTabs().find((t) => t.filePath === key);
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

  // -------------------------------------------------------------------------
  // Hunk stage / unstage / revert (D2)
  // -------------------------------------------------------------------------

  /**
   * Apply the selected hunks of one diff tab to the index or the working tree.
   *
   * THE CLIENT-SIDE HALF OF AC6. The backend refuses a write whose snapshot
   * token no longer describes the repository — but that check cannot see the
   * failure mode that lives here. A revalidation landing between the user's
   * click and this call re-points the tab record at a NEW diff with a NEW,
   * perfectly fresh token and a renumbered `hunks` array. Forwarding the
   * ordinal with that fresh token would sail through the server's check and
   * apply a hunk the user never looked at. So the token the selection was made
   * against travels with the request and is compared here, and a mismatch is
   * refused WITHOUT an RPC — the write path is never entered at all.
   *
   * The result's `snapshotToken` is deliberately ignored. Writing it into the
   * tab record would leave a token certifying bytes the record does not hold,
   * which is exactly the pairing defect the backend fixed inside its own digest
   * (batch-8a-report.md D-1). The token and the content it certifies only ever
   * arrive together, from {@link refreshDiffTab}.
   */
  public async applyHunks(
    request: HunkApplyRequest,
  ): Promise<GitApplyHunksResult> {
    const tab = this._diffTabs().find((t) => t.filePath === request.key);
    const diff = tab?.diff;
    if (!diff) {
      return {
        success: false,
        code: 'STALE_SNAPSHOT',
        message: SELECTION_SUPERSEDED_MESSAGE,
      };
    }

    if (
      diff.snapshotToken === '' ||
      diff.snapshotToken !== request.snapshotToken
    ) {
      // Re-read so the user is looking at the diff their next selection will
      // act on, rather than at the one that just went out from under them.
      void this.refreshDiffTab(request.key);
      return {
        success: false,
        code: 'STALE_SNAPSHOT',
        message: SELECTION_SUPERSEDED_MESSAGE,
      };
    }

    const workspaceRoot = this.activeWorkspacePath();
    const call = await rpcCall<GitApplyHunksResult>(
      this.vscodeService,
      'git:applyHunks',
      {
        path: diff.path,
        comparison: diff.comparison,
        operation: request.operation,
        hunkIndices: request.hunkIndices,
        snapshotToken: request.snapshotToken,
        // Mirrors `requestDiff`: the pre-rename path is sent only when it
        // differs, so the backend asks git for BOTH pathspecs exactly when a
        // staged rename needs it (batch-8a-report.md §3, 8.1).
        ...(diff.originalPath !== diff.path
          ? { originalPath: diff.originalPath }
          : {}),
        ...(workspaceRoot ? { workspaceRoot } : {}),
      } satisfies GitApplyHunksParams,
    );

    // AC8: refresh on the RPC RESPONSE in every host, success or failure. Only
    // Electron has a `.git/index` watcher to push `git:status-update`; VS Code
    // and the CLI have none, and a refused apply moves no watched file in any
    // host. `refreshDiffTab` already bails on an in-flight key, so the watcher
    // push that does arrive in Electron coalesces with this one.
    void this.refreshDiffTab(request.key);

    if (!call.success || !call.data) {
      return {
        success: false,
        code: 'UNKNOWN',
        message: APPLY_TRANSPORT_MESSAGE,
      };
    }
    return call.data;
  }

  /** Clear every pending revalidation timer (teardown; mirrors C1 AC3). */
  public dispose(): void {
    for (const timer of this.refreshDebounceTimers.values()) {
      clearTimeout(timer);
    }
    this.refreshDebounceTimers.clear();
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  /**
   * The workspace every open diff tab belongs to.
   *
   * `GitStatusService` is the one owner of this value on the git side — the
   * editor coordinator's `getActiveWorkspacePath()` is not reachable from here
   * and must not become a second source of truth.
   */
  private activeWorkspacePath(): string | null {
    return this.gitStatus.activeWorkspacePath();
  }

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
    const workspaceRoot = this.activeWorkspacePath();
    const result = await rpcCall<GitDiffFileResult>(
      this.vscodeService,
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
      provenance: { kind: 'mutable', comparison: result.comparison },
      comparison: result.comparison,
      path: result.path,
      originalPath: result.originalPath,
      original: readSideText(result.original),
      modified: readSideText(result.modified),
      originalRef: result.originalRef,
      modifiedRef: result.modifiedRef,
      snapshotToken: result.snapshotToken,
      // Ordinals only, and only when this response describes a real read. An
      // unvalidated or failed answer's hunks describe nothing, so they are
      // dropped rather than offered as things to act on — the same reasoning
      // that makes the view suppress new/deleted chrome on an error.
      hunks: failure || !validated ? [] : result.hunks,
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
      provenance: { kind: 'mutable', comparison },
      comparison,
      path,
      originalPath,
      original: '',
      modified: '',
      originalRef: { kind: 'absent' },
      modifiedRef: { kind: 'absent' },
      snapshotToken: '',
      hunks: [],
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

  /** Write a validated diff into the tab. */
  private applyFreshDiff(key: string, next: DiffTabState): void {
    this._diffTabs.update((tabs) =>
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
  }

  /** Immutably patch one diff tab's descriptor. */
  private patchDiff(
    key: string,
    patch: (diff: DiffTabState) => DiffTabState,
  ): void {
    this._diffTabs.update((tabs) =>
      tabs.map((tab) =>
        tab.filePath === key && tab.diff
          ? { ...tab, diff: patch(tab.diff) }
          : tab,
      ),
    );
  }

  /**
   * Convert an absolute pushed path to a workspace-relative diff path, or
   * `null` when it lies outside the active workspace.
   */
  private toWorkspaceRelative(absolutePath: string): string | null {
    const root = this.activeWorkspacePath();
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
