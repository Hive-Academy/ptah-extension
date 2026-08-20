import { computed, signal, type Signal } from '@angular/core';
import { rpcCall } from '@ptah-extension/core';
import type {
  GitApplyHunksParams,
  GitApplyHunksResult,
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
  HunkApplyRequest,
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
 * Copy for the one apply refusal this helper decides for itself (D2 AC6).
 *
 * Deliberately phrased as an instruction rather than an apology: the user's
 * selection is gone and re-selecting is the only way forward.
 */
const SELECTION_SUPERSEDED_MESSAGE =
  'This diff changed while the hunk was selected. Nothing was applied — re-select the hunk and try again.';

/** Copy for an apply whose RPC never reached the backend at all. */
const APPLY_TRANSPORT_MESSAGE =
  'Could not reach git to apply this hunk. Nothing was applied.';

/**
 * EditorDiffSplitHelper — diff view + side-by-side split pane.
 *
 * Mutates the coordinator's split signals and the openTabs signal when
 * creating diff tabs. Uses {@link EditorTabsHelper} for cache-sync.
 *
 * Diff tabs are revalidated from `git:status-update` rather than held as a
 * frozen snapshot: a tab opened before a commit used to keep showing the
 * pre-commit diff forever (A1).
 *
 * Split-pane content ownership (C2): when both panes hold the same file, the
 * TAB RECORD owns its content. Both panes write through to it, and the pane
 * that does not have focus is mirrored from it. `splitFileContent` and
 * `activeFileContent` are pane-local read surfaces, not stores.
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

  /**
   * Coalescing window for cross-pane content mirroring (C2).
   *
   * Short enough that the unfocused pane never visibly lags, long enough that a
   * burst of keystrokes costs one full-model replacement in the other pane
   * rather than one per character. A focus change does not wait for it — see
   * {@link setFocusedPane}.
   */
  private static readonly MIRROR_DEBOUNCE_MS = 150;

  /** Pending cross-pane mirror, or `null` when none is scheduled. */
  private mirrorTimer: ReturnType<typeof setTimeout> | null = null;

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
    const tab = this.state.openTabs().find((t) => t.filePath === request.key);
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

    const workspaceRoot = this.state.getActiveWorkspacePath();
    const call = await rpcCall<GitApplyHunksResult>(
      this.state.vscodeService,
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
    this.cancelPendingMirror();
  }

  // -------------------------------------------------------------------------
  // Split pane
  // -------------------------------------------------------------------------

  /**
   * Open a file in the split (right) pane, reusing cached tab content when
   * available.
   *
   * The second branch deliberately does NOT create a tab. A split pane holding
   * a file with no tab record is the only editing surface for that file, so
   * there is no second view for it to diverge from and C2's ownership rule has
   * nothing to arbitrate. Creating a tab here would put a new entry in the tab
   * strip that the user never asked for.
   */
  public async openFileInSplit(filePath: string): Promise<void> {
    // A fresh split cannot be carrying an older split's disagreement. Both
    // branches below give the right pane either the tab record's own content or
    // a straight read from disk, so the two panes agree on the first frame —
    // and a latch that outlived the split it described would light the chip on
    // that frame (TASK_2026_214).
    this.clearSplitDiverged();
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
    this.cancelPendingMirror();
    // The absorb below IS the reconciliation: the surviving pane ends up on the
    // tab record and the pane that held the other version is gone. Nothing is
    // left to disagree (TASK_2026_214). This route also carries the tab-close
    // and workspace-switch callbacks, which never reach the panel component.
    this.clearSplitDiverged();
    // Absorb any split-pane edit the left pane has not seen yet BEFORE the
    // split state is torn down: once `splitFilePath` is gone the shared-file
    // gate can no longer route it anywhere, and the left pane would be left
    // holding — and, on the next save, persisting — pre-edit text (C2 AC1/AC2).
    const shared = this.sharedSplitTab();
    if (shared) this.setLeftPaneContent(shared.filePath, shared.content);

    this.state.splitActive.set(false);
    this.state.splitFilePath.set(undefined);
    this.state.splitFileContent.set('');
    this.state.focusedPane.set('left');
  }

  /**
   * Set which pane has focus.
   *
   * A focus change also reconciles BOTH panes against the tab record without
   * waiting for the mirror debounce. The pane the user just moved into has to
   * already show the other pane's edits before it can be typed in or saved;
   * leaving it up to one debounce window behind is precisely the silent
   * divergence C2 exists to remove (AC1).
   *
   * This is the one place C2 writes into the pane that HAS focus. It is safe
   * where a per-keystroke mirror would not be: it fires on a focus transition,
   * before the user can have typed into the newly focused pane, and it writes
   * the other pane's text — never an echo of this pane's own edits.
   */
  public setFocusedPane(pane: 'left' | 'right'): void {
    this.state.focusedPane.set(pane);
    this.cancelPendingMirror();
    this.reconcilePanesToTabRecord();
  }

  /**
   * Update the content of the split (right) pane.
   *
   * The tab record — not `splitFileContent` — OWNS a file's content (C2).
   * Writing only the pane signal is what let a split-pane edit vanish when the
   * same file was later activated in the left pane, and let a save from the
   * other pane overwrite it with no indication at all.
   *
   * This no longer echoes the edit back into `splitFileContent` when a tab owns
   * the file (TASK_2026_213). `splitFileContent` feeds the right pane's own
   * `[content]` input, so writing this pane's keystrokes into it was a
   * self-referential loop: the pane's own text arriving back at the pane. It
   * was inert only because `code-editor.component.ts` skips a full-model
   * replacement when the incoming content already equals the model — see the
   * comment at its `syncFile` external-update branch, which states the
   * invariant this restores in as many words: *nothing writes this pane's own
   * edits back into its `content` input*. Any transformation ever landing
   * between the two would have pushed a full-model replacement into the pane
   * being typed in, moving the cursor to the end of the buffer and flattening
   * the undo stack.
   *
   * The right pane is now deliberately stale in exactly the way the primary
   * pane already was: it is written only by the debounced mirror and the
   * focus-change reconcile, which carry the OTHER pane's text. Nothing else
   * needed re-pointing — the workspace cache prefers the tab record when one
   * exists (`EditorWorkspaceHelper`), a save carries the editor's own emitted
   * text, and `closeSplit` absorbs through the tab record.
   */
  public updateSplitContent(content: string): void {
    const path = this.state.splitFilePath();
    if (!path) return;

    // §1.4 — `openFileInSplit`'s no-tab branch leaves the split pane as the
    // ONLY editing surface for the file. There is no second view to own content
    // on its behalf, so the pane signal has to, and the echo stays: it is what
    // `EditorWorkspaceHelper` caches across a workspace switch, and dropping it
    // here would restore pre-edit text on the way back. That case is
    // deliberately left exactly as it was.
    if (!this.state.openTabs().some((t) => t.filePath === path)) {
      this.state.splitFileContent.set(content);
      return;
    }

    this.tabs.updateTabContent(path, content);
    this.scheduleSplitMirror(path);
  }

  /**
   * Schedule a mirror of the tab record into whichever pane is NOT focused,
   * after an edit to `filePath`. A no-op unless both panes hold that same file.
   *
   * Only the unfocused pane is ever written. The focused pane is the one being
   * typed into, and pushing content into it would replace the buffer under the
   * user's cursor — the flush therefore re-reads focus rather than trusting the
   * focus that was current when the edit happened.
   */
  public scheduleSplitMirror(filePath: string): void {
    if (this.sharedSplitTab()?.filePath !== filePath) return;
    if (this.mirrorTimer) clearTimeout(this.mirrorTimer);
    this.mirrorTimer = setTimeout(() => {
      this.mirrorTimer = null;
      this.mirrorToUnfocusedPane();
    }, EditorDiffSplitHelper.MIRROR_DEBOUNCE_MS);
  }

  /**
   * Whether the tab record carries an edit from the OTHER pane that the pane
   * about to save has not absorbed (C2 AC2/AC3).
   *
   * Deliberately narrow. After the write-through above, a focused pane's own
   * text always equals the tab record, so an ordinary split-pane save answers
   * `false` and completes silently (R-10). It answers `true` only inside the
   * reconciliation window — an edit in one pane followed by a save from the
   * other before that pane has absorbed it.
   */
  public hasUnabsorbedPeerEdit(filePath: string, content: string): boolean {
    const shared = this.sharedSplitTab();
    if (!shared || shared.filePath !== filePath) return false;
    // A clean tab record holds the persisted text, so a difference against it
    // is this pane's own unsaved work, not the other pane's.
    if (!shared.isDirty) return false;
    return shared.content !== content;
  }

  // -------------------------------------------------------------------------
  // Knowingly-diverged panes (TASK_2026_214)
  // -------------------------------------------------------------------------

  /**
   * The file a save-conflict Cancel left the two panes knowingly disagreeing
   * about, or `null`.
   *
   * A LATCH, and deliberately nothing more than a file path. It was originally
   * a `{ filePath, content }` pair held by the panel component, where `content`
   * was the declined text frozen at the moment of Cancel and the predicate was
   * `hasUnabsorbedPeerEdit(filePath, frozenContent)`. That string is never
   * invalidated by anything that actually RESOLVES the divergence — a focus
   * change reconciles both panes onto the tab record without touching either
   * operand — so the chip stayed lit after the panes had agreed again, and lit
   * up on the first frame of a re-opened split where the two panes were
   * byte-identical by construction. It degenerated into a second dirty dot,
   * which is the exact ambiguity the chip was added to remove.
   *
   * It lives here rather than in the panel because reconciliation is decided
   * here. Three of the routes that resolve a divergence — a tab close and a
   * workspace switch, both of which reach {@link closeSplit} through
   * `EditorTabsHelper` / `EditorWorkspaceHelper` callbacks — never pass through
   * the panel component at all, so a latch cleared from the panel would have
   * survived them.
   */
  private readonly divergedFile = signal<string | null>(null);

  /**
   * Whether the split panes are knowingly holding different text.
   *
   * Latch AND live predicate, both required. The latch alone would never clear;
   * the live half alone is true for the whole mirror-debounce window after any
   * keystroke in the other pane, so a chip on it would blink on every
   * character. Together they say the narrow, useful thing: you were asked, you
   * chose to keep both versions, and nothing has reconciled them since.
   *
   * The live half is `sharedSplitTab()` — so it falls false the moment the
   * split closes, either pane moves to another file, or the tab record goes
   * clean (a clean record holds the persisted text, so there is no unabsorbed
   * peer edit left to disagree about). Being a `computed` over those signals is
   * what makes that automatic rather than another thing to remember.
   */
  public readonly splitPanesDiverged: Signal<boolean> = computed(() => {
    const file = this.divergedFile();
    if (!file) return false;
    const shared = this.sharedSplitTab();
    return shared !== null && shared.filePath === file && shared.isDirty;
  });

  /** Record that a Cancel left `filePath` disagreeing across the two panes. */
  public markSplitDiverged(filePath: string): void {
    this.divergedFile.set(filePath);
  }

  /**
   * Forget a recorded divergence.
   *
   * Called from every route that reconciles the panes — and from the panel when
   * the user answers a later conflict with Overwrite, which resolves the
   * question the latch was standing for.
   */
  public clearSplitDiverged(): void {
    this.divergedFile.set(null);
  }

  /**
   * The open tab both panes are looking at, or `null`.
   *
   * Every behaviour C2 adds is gated on this. It is non-null only when the
   * split is open, both panes hold the SAME path, and that path has a tab
   * record — so when the two panes hold different files not one line of C2
   * behaviour runs (AC5), and the no-tab split file (§1.4) is likewise
   * untouched.
   */
  private sharedSplitTab(): EditorTab | null {
    if (!this.state.splitActive()) return null;
    const path = this.state.splitFilePath();
    if (!path || path !== this.state.activeFilePath()) return null;
    return this.state.openTabs().find((t) => t.filePath === path) ?? null;
  }

  /** Push the tab record's current content into the unfocused pane only. */
  private mirrorToUnfocusedPane(): void {
    const shared = this.sharedSplitTab();
    if (!shared) return;
    if (this.state.focusedPane() === 'right') {
      this.setLeftPaneContent(shared.filePath, shared.content);
    } else {
      this.setRightPaneContent(shared.content);
    }
  }

  /** Bring both panes onto the tab record's content. */
  private reconcilePanesToTabRecord(): void {
    // Unconditional, and BEFORE the shared-tab gate: this method is the whole
    // of what a focus change does about divergence, so a latch that survived it
    // would keep the chip lit over two panes that now hold identical text and
    // a save path that would no longer prompt (TASK_2026_214). The gate below
    // is about which signals to write, not about whether the panes reconciled.
    this.clearSplitDiverged();
    const shared = this.sharedSplitTab();
    if (!shared) return;
    this.setLeftPaneContent(shared.filePath, shared.content);
    this.setRightPaneContent(shared.content);
  }

  private setLeftPaneContent(filePath: string, content: string): void {
    if (this.state.activeFileContent() === content) return;
    this.state.activeFileContent.set(content);
    this.tabs.updateCachedActiveFile(filePath, content);
  }

  private setRightPaneContent(content: string): void {
    if (this.state.splitFileContent() === content) return;
    this.state.splitFileContent.set(content);
  }

  private cancelPendingMirror(): void {
    if (!this.mirrorTimer) return;
    clearTimeout(this.mirrorTimer);
    this.mirrorTimer = null;
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
