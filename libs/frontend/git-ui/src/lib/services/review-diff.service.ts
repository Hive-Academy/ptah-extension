import { Injectable, inject, signal } from '@angular/core';
import { VSCodeService, rpcCall } from '@ptah-extension/core';
import type { MessageHandler, RpcCallResult } from '@ptah-extension/core';
import { MESSAGE_TYPES, normalizeWorkspaceRoot } from '@ptah-extension/shared';
import type {
  FileContentChangedPayload,
  GitApplyHunksParams,
  GitBlobRead,
  GitApplyHunksResult,
  GitChangeKind,
  GitDiffFileParams,
  GitDiffFileResult,
  GitFileStatus,
  GitResolvedReviewRef,
  GitReviewFileParams,
  GitReviewFileResult,
  GitStatusUnavailableReason,
  GitStatusUpdatePayload,
} from '@ptah-extension/shared';
import { GitStatusService } from './git-status.service';
import type {
  DiffTabState,
  DiffUnrenderable,
  HunkApplyFn,
  HunkApplyRequest,
} from '../types/review-diff.types';
import { normalizeDiffPath } from '../types/review-diff.types';
import {
  describeGitReadError,
  firstReadError,
  GIT_READ_TRANSPORT_MESSAGE,
  readSideText,
} from './git-read-error-messages';
import { toFileContentChange } from './file-content-change';

/**
 * Which two sides a review-canvas diff compares.
 *
 * `worktree` and `staged` are mutable — read through `git:diffFile` and
 * revalidated on every push that can have moved them. `historical` names two
 * resolved commits (branch review, a past commit, a stash entry against its
 * parent); it is read through `git:reviewFile` and never revalidated, because
 * neither side can change.
 */
export type ReviewDiffComparison =
  | { kind: 'worktree' }
  | { kind: 'staged' }
  | {
      kind: 'historical';
      base: GitResolvedReviewRef;
      head: GitResolvedReviewRef;
    };

/** One file of the canvas, as a mounted file section asks for it. */
export interface ReviewDiffRequest {
  comparison: ReviewDiffComparison;
  /** Workspace-relative path, modified side. */
  path: string;
  /** Pre-rename path; omitted (or equal to `path`) when the file was not renamed. */
  origPath?: string;
}

/**
 * The cached diff for one `(comparison, path, origPath)`.
 *
 * `diff === null` means the first read has not landed yet. Once a read lands
 * the record is replaced, never cleared: a refresh keeps the previous content
 * on screen and only moves `diff.status` (parity §7).
 */
export interface ReviewDiffEntry {
  readonly key: string;
  readonly comparison: ReviewDiffComparison;
  /** Normalized workspace-relative path, modified side. */
  readonly path: string;
  /** Normalized pre-rename path; equals {@link path} when not renamed. */
  readonly originalPath: string;
  readonly diff: DiffTabState | null;
  /**
   * A push touched this file while no section had it mounted. The read is
   * deferred to the next {@link ReviewDiffService.mount} rather than issued
   * for a file nobody is looking at.
   */
  readonly invalidated: boolean;
}

/**
 * Copy for the one apply refusal this service decides for itself (D2 AC6).
 * Phrased as an instruction: the selection is gone and re-selecting is the
 * only way forward.
 */
const SELECTION_SUPERSEDED_MESSAGE =
  'This diff changed while the hunk was selected. Nothing was applied — re-select the hunk and try again.';

/** Copy for an apply whose RPC never reached the backend at all. */
const APPLY_TRANSPORT_MESSAGE =
  'Could not reach git to apply this hunk. Nothing was applied.';

/** Copy for an apply asked of a read-only (historical) comparison. */
const READ_ONLY_COMPARISON_MESSAGE =
  'This comparison is read-only. Nothing was applied.';

/**
 * Coalescing window for push-driven revalidation. A single git operation fans
 * out several watcher events; one pass per window keeps the RPC count bounded
 * (NFR-7).
 */
const REFRESH_DEBOUNCE_MS = 250;

/**
 * Cached entries no section has mounted that are kept for a quick scroll back.
 * Each one may hold two full file bodies, so the set is bounded: the oldest
 * unmounted entry is evicted first. Mounted entries are never evicted.
 */
const MAX_UNMOUNTED_ENTRIES = 64;

/** Cache key for a request. The one place the scheme is defined. */
export function reviewDiffKey(request: ReviewDiffRequest): string {
  const path = normalizeDiffPath(request.path);
  const originalPath = request.origPath
    ? normalizeDiffPath(request.origPath)
    : path;
  return `review:${comparisonId(request.comparison)}\0${originalPath}\0${path}`;
}

function comparisonId(comparison: ReviewDiffComparison): string {
  return comparison.kind === 'historical'
    ? `${comparison.base.sha}..${comparison.head.sha}`
    : comparison.kind;
}

/**
 * Causes that can move ANY open diff, so every entry must be re-read (RC11).
 * `workspace` and `refs-stash` alone only touch listed paths.
 */
function causesRefreshEverything(causes: readonly GitChangeKind[]): boolean {
  return causes.some(
    (cause) =>
      cause === 'head' ||
      cause === 'index' ||
      cause === 'refs' ||
      cause === 'initial',
  );
}

/**
 * The first side whose content was read but not shipped (`too-large`,
 * `lfs-pointer`), or `null`. Such a side's text is empty, so without this the
 * file would render as an empty or all-deleted diff (Requirement 6.10).
 */
function unrenderableSide(
  original: GitBlobRead,
  modified: GitBlobRead,
): DiffUnrenderable | null {
  const sides = [
    ['original', original],
    ['modified', modified],
  ] as const;
  for (const [side, read] of sides) {
    if (read.outcome === 'too-large') {
      return { side, reason: 'too-large', size: read.byteLength };
    }
    if (read.outcome === 'lfs-pointer') {
      return { side, reason: 'lfs-pointer', size: read.size };
    }
  }
  return null;
}

type MutableComparison = Exclude<ReviewDiffComparison, { kind: 'historical' }>;
type HistoricalComparison = Extract<
  ReviewDiffComparison,
  { kind: 'historical' }
>;

function isMutable(
  comparison: ReviewDiffComparison,
): comparison is MutableComparison {
  return comparison.kind !== 'historical';
}

/**
 * ReviewDiffService — the review canvas's diff cache and everything that keeps
 * it truthful. The successor to `DiffTabsService`: the same revalidation rules
 * (RC11 cause scoping, one trailing run per key, failed reads never shown as
 * content), keyed by `(comparison, path, origPath)` instead of by dock tab.
 *
 * Reads are lazy: only a file section that is mounted (near the viewport)
 * causes a `git:diffFile` / `git:reviewFile` call. A push that touches an
 * unmounted entry marks it invalidated and the read happens on remount.
 *
 * The cache belongs to the active workspace ({@link GitStatusService} owns that
 * value); a workspace change drops it.
 */
@Injectable({ providedIn: 'root' })
export class ReviewDiffService implements MessageHandler {
  private readonly vscodeService = inject(VSCodeService);
  private readonly gitStatus = inject(GitStatusService);

  private readonly _entries = signal<ReadonlyMap<string, ReviewDiffEntry>>(
    new Map(),
  );

  /** Every cached diff, by {@link reviewDiffKey}. */
  readonly entries = this._entries.asReadonly();

  /** How many file sections currently mount each key. */
  private readonly mountCounts = new Map<string, number>();

  /** Unmounted keys, oldest first — the eviction order. */
  private readonly unmountedOrder = new Set<string>();

  /**
   * Per-key id of the latest read. Kept outside the entry because the first
   * read starts before any `DiffTabState` exists to carry a `requestId`.
   */
  private readonly requestIds = new Map<string, number>();

  /**
   * Source of every `requestId`. Service-wide and never reset, so a read that
   * outlives a cache reset or an eviction can never match the id of a read
   * issued for the same key afterwards.
   */
  private lastRequestId = 0;

  /**
   * Keys with a read in flight, mapped to the read's ticket. The ticket lets a
   * read that outlived a cache reset release only its OWN marker.
   */
  private readonly inFlight = new Map<string, number>();
  private nextTicket = 0;

  /**
   * Keys a caller asked to refresh while a read was in flight (RC11). Each gets
   * exactly ONE trailing run when the in-flight read settles.
   */
  private readonly rerunRequested = new Set<string>();

  /**
   * Scope of the debounced revalidation (RC11). `true` means "every mutable
   * entry"; otherwise only entries whose path or pre-rename path is in
   * {@link pendingRefreshPaths}. An unscoped push widens a pending scoped
   * one, never the reverse.
   */
  private pendingRefreshAll = false;
  private readonly pendingRefreshPaths = new Set<string>();

  /**
   * `path`/`origPath` union of the most recent `git:status-update` file set: a
   * file that just left `files` (reverted to clean, committed) still needs its
   * re-read, so a scoped refresh also matches the previous set (RC11).
   */
  private previousStatusPaths = new Set<string>();
  private previousStatusWorkspace: string | undefined;

  /** The one pending revalidation timer, or `null`. */
  private refreshTimer: ReturnType<typeof setTimeout> | null = null;

  /** The workspace {@link entries} belong to. */
  private cacheWorkspace: string | null = null;

  /** Bound once so a template binding stays referentially stable. */
  readonly applyHunksFn: HunkApplyFn = (request) => this.applyHunks(request);

  // -------------------------------------------------------------------------
  // Inbound pushes
  // -------------------------------------------------------------------------

  /** Dispatched by `MessageRouterService` through `MESSAGE_HANDLERS`. */
  readonly handledMessageTypes = [
    MESSAGE_TYPES.GIT_STATUS_UPDATE,
    MESSAGE_TYPES.FILE_CONTENT_CHANGED,
  ] as const;

  handleMessage(message: { type: string; payload?: unknown }): void {
    switch (message.type) {
      case MESSAGE_TYPES.GIT_STATUS_UPDATE: {
        const payload = message.payload as
          Partial<GitStatusUpdatePayload> | undefined;
        this.onGitStatusUpdate(
          payload?.workspaceRoot,
          payload?.causes,
          payload?.files,
          payload?.statusUnavailable,
        );
        return;
      }
      case MESSAGE_TYPES.FILE_CONTENT_CHANGED: {
        const change = toFileContentChange(message.payload);
        if (change) this.onFileContentChanged(change);
        return;
      }
      default:
        return;
    }
  }

  // -------------------------------------------------------------------------
  // Mounting
  // -------------------------------------------------------------------------

  /**
   * A file section came near the viewport. Reads the diff when nothing is
   * cached or a push invalidated it while unmounted; otherwise the cached
   * entry is shown as-is. Returns the entry's key.
   */
  mount(request: ReviewDiffRequest): string {
    this.syncWorkspace();
    const key = reviewDiffKey(request);
    this.mountCounts.set(key, (this.mountCounts.get(key) ?? 0) + 1);
    this.unmountedOrder.delete(key);

    const existing = this._entries().get(key);
    if (!existing) {
      const path = normalizeDiffPath(request.path);
      this.setEntry({
        key,
        comparison: request.comparison,
        path,
        originalPath: request.origPath
          ? normalizeDiffPath(request.origPath)
          : path,
        diff: null,
        invalidated: false,
      });
      void this.refresh(key);
    } else if (existing.invalidated) {
      void this.refresh(key);
    }
    return key;
  }

  /**
   * A file section left the viewport. The entry stays cached (bounded by
   * {@link MAX_UNMOUNTED_ENTRIES}) so scrolling back shows it instantly.
   */
  unmount(key: string): void {
    const count = this.mountCounts.get(key) ?? 0;
    if (count > 1) {
      this.mountCounts.set(key, count - 1);
      return;
    }
    if (count === 0) return;
    this.mountCounts.delete(key);
    this.unmountedOrder.add(key);
    this.evictUnmounted();
  }

  /** The cached entry for a key, or `undefined`. */
  entry(key: string): ReviewDiffEntry | undefined {
    return this._entries().get(key);
  }

  /** Re-read one entry on demand (the error row's Retry). */
  retry(key: string): Promise<void> {
    return this.refresh(key);
  }

  // -------------------------------------------------------------------------
  // Revalidation (A1, RC11)
  // -------------------------------------------------------------------------

  /**
   * Handle a `git:status-update` push: revalidate the entries the push's
   * causes can have touched, coalesced over a short window. `workspaceRoot`
   * absent (older backends) means the active workspace.
   *
   * RC11 scope: `head`/`index`/`refs`/`initial` — or no causes at all —
   * refresh every mutable entry. A workspace-only (or stash-only) cause
   * refreshes the entries whose path or pre-rename path is in `files` or was
   * in the previous file set. A `statusUnavailable` push, or a scoped push
   * whose `files` is not an array, widens to refresh-all.
   */
  onGitStatusUpdate(
    workspaceRoot?: string,
    causes?: readonly GitChangeKind[],
    files?: readonly GitFileStatus[],
    statusUnavailable?: GitStatusUnavailableReason,
  ): void {
    this.syncWorkspace();
    const active = this.activeWorkspacePath();
    // Compared as root keys: the push and the active path can spell one folder
    // differently on Windows (separators, drive-letter case).
    const target = normalizeWorkspaceRoot(workspaceRoot ?? active ?? '');
    // The cache only ever holds the ACTIVE workspace's diffs.
    if (active !== null && target !== normalizeWorkspaceRoot(active)) return;

    if (target !== this.previousStatusWorkspace) {
      this.previousStatusPaths.clear();
      this.previousStatusWorkspace = target;
    }

    this.mergePendingRefreshScope(causes, files, statusUnavailable);

    if (this.refreshTimer !== null) clearTimeout(this.refreshTimer);
    this.refreshTimer = setTimeout(() => {
      this.refreshTimer = null;
      void this.runPendingRefresh();
    }, REFRESH_DEBOUNCE_MS);
  }

  /**
   * Handle a batched `file:content-changed` push. `truncated` means the list
   * is incomplete: one debounced refresh-all. Otherwise only working-tree
   * entries for the listed paths are re-read — only those read the file on
   * disk. An empty, untruncated batch is ignored.
   */
  onFileContentChanged(change: FileContentChangedPayload): void {
    if (change.truncated) {
      this.onGitStatusUpdate();
      return;
    }
    if (change.filePaths.length === 0) return;
    this.syncWorkspace();

    const changed = new Set<string>();
    for (const absolutePath of change.filePaths) {
      const relative = this.toWorkspaceRelative(absolutePath);
      if (relative) changed.add(relative);
    }
    for (const entry of this._entries().values()) {
      if (entry.comparison.kind === 'worktree' && changed.has(entry.path)) {
        void this.refresh(entry.key);
      }
    }
  }

  /**
   * Fold one push's causes and file set into the pending scope (RC11).
   * Moved verbatim from `DiffTabsService.mergePendingRefreshScope`.
   */
  private mergePendingRefreshScope(
    causes?: readonly GitChangeKind[],
    files?: readonly GitFileStatus[],
    statusUnavailable?: GitStatusUnavailableReason,
  ): void {
    const statusDegraded = statusUnavailable !== undefined;
    const hasFileSet = Array.isArray(files);

    const currentPaths = new Set<string>();
    if (hasFileSet) {
      for (const file of files) {
        // Entry paths are normalized; the pushed ones must match them.
        if (typeof file?.path === 'string' && file.path !== '') {
          currentPaths.add(normalizeDiffPath(file.path));
        }
        if (typeof file?.origPath === 'string' && file.origPath !== '') {
          currentPaths.add(normalizeDiffPath(file.origPath));
        }
      }
    }

    if (
      causes === undefined ||
      statusDegraded ||
      !hasFileSet ||
      causesRefreshEverything(causes)
    ) {
      this.pendingRefreshAll = true;
    } else if (!this.pendingRefreshAll) {
      for (const path of currentPaths) this.pendingRefreshPaths.add(path);
      for (const path of this.previousStatusPaths) {
        this.pendingRefreshPaths.add(path);
      }
    }

    if (hasFileSet && !statusDegraded) this.previousStatusPaths = currentPaths;
  }

  /** Consume the pending scope: refresh every mutable entry, or the matches. */
  private async runPendingRefresh(): Promise<void> {
    const refreshAll = this.pendingRefreshAll;
    const paths = new Set(this.pendingRefreshPaths);
    this.pendingRefreshAll = false;
    this.pendingRefreshPaths.clear();

    const keys = [...this._entries().values()]
      .filter(
        (entry) =>
          isMutable(entry.comparison) &&
          (refreshAll ||
            paths.has(entry.path) ||
            paths.has(entry.originalPath)),
      )
      .map((entry) => entry.key);
    await Promise.all(keys.map((key) => this.refresh(key)));
  }

  /**
   * Re-read one entry. An unmounted entry is only marked invalidated (lazy
   * reads). A request landing while the key is already reading is queued:
   * exactly one trailing run follows the in-flight one (RC11). A historical
   * entry is re-read only while it has no good content — both sides are
   * immutable commits.
   */
  private async refresh(key: string): Promise<void> {
    const entry = this._entries().get(key);
    if (!entry) return;
    if (
      entry.comparison.kind === 'historical' &&
      entry.diff?.status === 'fresh'
    ) {
      return;
    }
    if (!this.mountCounts.has(key)) {
      if (!entry.invalidated) this.patchEntry(key, { invalidated: true });
      return;
    }
    if (this.inFlight.has(key)) {
      this.rerunRequested.add(key);
      return;
    }
    await this.runRefresh(key);
  }

  /**
   * One read for one key, plus its trailing read when requests arrived while
   * it ran. Bound to the workspace active when it started: a trailing read
   * queued before a workspace switch is dropped. A throw out of the read maps
   * to the same outcome as a transport failure, and the finally still
   * services the trailing run. An entry unmounted meanwhile gets no trailing
   * read — it is marked invalidated instead.
   */
  private async runRefresh(key: string): Promise<void> {
    const originWorkspace = this.activeWorkspacePath();
    try {
      await this.readOnce(key, originWorkspace);
    } catch (error: unknown) {
      console.error('[ReviewDiffService] diff read threw', error);
      this.applyTransportFailure(key);
    } finally {
      // A trailing read queued before a workspace switch is dropped: it would
      // read this path against the new workspace's root.
      if (
        this.rerunRequested.delete(key) &&
        this.activeWorkspacePath() === originWorkspace
      ) {
        if (this.mountCounts.has(key)) await this.runRefresh(key);
        else this.patchEntry(key, { invalidated: true });
      }
    }
  }

  /** The single in-flight read behind {@link refresh}. */
  private async readOnce(
    key: string,
    originWorkspace: string | null,
  ): Promise<void> {
    const entry = this._entries().get(key);
    if (!entry) return;

    const requestId = ++this.lastRequestId;
    this.requestIds.set(key, requestId);
    if (entry.diff) {
      this.patchEntry(key, {
        invalidated: false,
        diff: { ...entry.diff, requestId, status: 'refreshing' },
      });
    } else if (entry.invalidated) {
      this.patchEntry(key, { invalidated: false });
    }

    const ticket = ++this.nextTicket;
    this.inFlight.set(key, ticket);
    let next: DiffTabState | null;
    try {
      next = await this.read(entry, requestId);
    } finally {
      if (this.inFlight.get(key) === ticket) this.inFlight.delete(key);
    }

    const live = this._entries().get(key);
    if (!live || this.requestIds.get(key) !== requestId) return;

    if (this.activeWorkspacePath() !== originWorkspace) {
      // The read was asked for because the content may have changed, so the
      // entry is stale, never parked at 'refreshing'.
      if (live.diff) {
        this.patchEntry(key, { diff: { ...live.diff, status: 'stale' } });
      } else {
        this.patchEntry(key, { invalidated: true });
      }
      return;
    }

    if (!next) {
      this.applyTransportFailure(key);
      return;
    }
    if (next.status !== 'fresh' && live.diff) {
      // Retain the content the user is looking at; only the status changes.
      this.patchEntry(key, {
        diff: {
          ...live.diff,
          status: next.status,
          errorMessage: next.errorMessage,
          errorDetail: next.errorDetail,
        },
      });
      return;
    }
    this.patchEntry(key, { diff: next });
  }

  /**
   * Transport failure: `stale` with the previous content kept, or — when no
   * read ever landed — `error`, because there is nothing to keep.
   */
  private applyTransportFailure(key: string): void {
    const entry = this._entries().get(key);
    if (!entry) return;
    const requestId = this.requestIds.get(key) ?? 0;
    this.patchEntry(key, {
      diff: entry.diff
        ? {
            ...entry.diff,
            status: 'stale',
            errorMessage: GIT_READ_TRANSPORT_MESSAGE,
            errorDetail: undefined,
          }
        : this.transportFailureState(entry, requestId),
    });
  }

  // -------------------------------------------------------------------------
  // Hunk stage / unstage / revert (D2)
  // -------------------------------------------------------------------------

  /**
   * Apply hunks of one entry to the index or the working tree, then re-read.
   *
   * The token the selection was made against travels with the request and is
   * compared here: a revalidation landing between the click and this call
   * re-points the entry at a NEW diff with a fresh token and renumbered hunks,
   * so a mismatch is refused WITHOUT an RPC (`STALE_SNAPSHOT` rules, D2 AC6).
   * The result's own token is ignored — a token only ever arrives together
   * with the content it certifies, from a read.
   */
  async applyHunks(request: HunkApplyRequest): Promise<GitApplyHunksResult> {
    const entry = this._entries().get(request.key);
    const diff = entry?.diff;
    if (!entry || !diff) {
      return {
        success: false,
        code: 'STALE_SNAPSHOT',
        message: SELECTION_SUPERSEDED_MESSAGE,
      };
    }
    if (!isMutable(entry.comparison)) {
      return {
        success: false,
        code: 'INVALID_OPERATION',
        message: READ_ONLY_COMPARISON_MESSAGE,
      };
    }
    if (
      diff.snapshotToken === '' ||
      diff.snapshotToken !== request.snapshotToken
    ) {
      void this.refresh(request.key);
      return {
        success: false,
        code: 'STALE_SNAPSHOT',
        message: SELECTION_SUPERSEDED_MESSAGE,
      };
    }

    const workspaceRoot = this.activeWorkspacePath();
    let call: RpcCallResult<GitApplyHunksResult> | null;
    try {
      call = await rpcCall<GitApplyHunksResult>(
        this.vscodeService,
        'git:applyHunks',
        {
          path: entry.path,
          comparison: entry.comparison.kind,
          operation: request.operation,
          hunkIndices: request.hunkIndices,
          snapshotToken: request.snapshotToken,
          ...(entry.originalPath !== entry.path
            ? { originalPath: entry.originalPath }
            : {}),
          ...(workspaceRoot ? { workspaceRoot } : {}),
        } satisfies GitApplyHunksParams,
      );
    } catch (error: unknown) {
      console.error('[ReviewDiffService] git:applyHunks threw', error);
      call = null;
    }

    // AC8: re-read on the response in every host, success or failure. Only
    // Electron has an index watcher; a concurrent push collapses into the
    // one trailing run (RC11).
    void this.refresh(request.key);

    if (!call?.success || !call.data) {
      return {
        success: false,
        code: 'UNKNOWN',
        message: APPLY_TRANSPORT_MESSAGE,
      };
    }
    return call.data;
  }

  // -------------------------------------------------------------------------
  // Workspace lifecycle (`WorkspaceCoordinatorService` contract)
  // -------------------------------------------------------------------------

  /** The cache belongs to one workspace; a switch drops it. */
  switchWorkspace(workspacePath: string): void {
    if (workspacePath === this.cacheWorkspace) return;
    this.resetCache(workspacePath);
  }

  removeWorkspaceState(workspacePath: string): void {
    if (workspacePath === this.cacheWorkspace) this.resetCache(null);
  }

  /** Clear the pending timer and every queue (teardown). */
  dispose(): void {
    if (this.refreshTimer !== null) clearTimeout(this.refreshTimer);
    this.refreshTimer = null;
    this.pendingRefreshAll = false;
    this.pendingRefreshPaths.clear();
    this.rerunRequested.clear();
    this.previousStatusPaths.clear();
    this.previousStatusWorkspace = undefined;
    this.inFlight.clear();
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  private activeWorkspacePath(): string | null {
    return this.gitStatus.activeWorkspacePath();
  }

  /**
   * Drop the cache when the active workspace moved under it — covers the
   * window before the workspace coordinator calls {@link switchWorkspace}.
   */
  private syncWorkspace(): void {
    const active = this.activeWorkspacePath();
    if (active !== this.cacheWorkspace) this.resetCache(active);
  }

  private resetCache(workspace: string | null): void {
    this.dispose();
    this.cacheWorkspace = workspace;
    this._entries.set(new Map());
    this.mountCounts.clear();
    this.unmountedOrder.clear();
    this.requestIds.clear();
  }

  /** Evict the oldest unmounted entries beyond the bound. */
  private evictUnmounted(): void {
    if (this.unmountedOrder.size <= MAX_UNMOUNTED_ENTRIES) return;
    const next = new Map(this._entries());
    for (const key of this.unmountedOrder) {
      if (this.unmountedOrder.size <= MAX_UNMOUNTED_ENTRIES) break;
      this.unmountedOrder.delete(key);
      this.rerunRequested.delete(key);
      this.requestIds.delete(key);
      next.delete(key);
    }
    this._entries.set(next);
  }

  /**
   * One read. Returns `null` only for a transport failure — the handlers
   * always answer with a well-formed result otherwise.
   */
  private async read(
    entry: ReviewDiffEntry,
    requestId: number,
  ): Promise<DiffTabState | null> {
    const workspaceRoot = this.activeWorkspacePath();
    const { comparison, path, originalPath } = entry;
    if (comparison.kind === 'historical') {
      const response = await rpcCall<GitReviewFileResult>(
        this.vscodeService,
        'git:reviewFile',
        {
          baseSha: comparison.base.sha,
          headSha: comparison.head.sha,
          path,
          ...(originalPath !== path ? { originalPath } : {}),
          ...(workspaceRoot ? { workspaceRoot } : {}),
        } satisfies GitReviewFileParams,
      );
      return response.success && response.data
        ? this.toHistoricalState(entry, response.data, requestId)
        : null;
    }
    const response = await rpcCall<GitDiffFileResult>(
      this.vscodeService,
      'git:diffFile',
      {
        path,
        comparison: comparison.kind,
        ...(originalPath !== path ? { originalPath } : {}),
        ...(workspaceRoot ? { workspaceRoot } : {}),
      } satisfies GitDiffFileParams,
    );
    return response.success && response.data
      ? this.toDiffState(response.data, requestId)
      : null;
  }

  /** Project a `git:diffFile` result onto the diff record. */
  private toDiffState(
    result: GitDiffFileResult,
    requestId: number,
  ): DiffTabState {
    const failure = firstReadError(result.original, result.modified);
    // An empty token means the backend never reached a real repository read;
    // such a response is never fresh and its hunks describe nothing.
    const validated = result.snapshotToken !== '';
    const unrenderable = unrenderableSide(result.original, result.modified);
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
      // An unshipped side has no text to place a hunk against.
      hunks: failure || !validated || unrenderable ? [] : result.hunks,
      isBinary:
        result.original.outcome === 'binary' ||
        result.modified.outcome === 'binary',
      ...(unrenderable ? { unrenderable } : {}),
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
   * Project a `git:reviewFile` result onto the diff record. Read-only: no
   * token and no hunk ordinals, so no hunk action can be offered.
   */
  private toHistoricalState(
    entry: ReviewDiffEntry,
    result: GitReviewFileResult,
    requestId: number,
  ): DiffTabState {
    const comparison = entry.comparison as HistoricalComparison;
    const failure = result.success
      ? firstReadError(result.original, result.modified)
      : { code: 'unknown' as const, message: result.error ?? '' };
    const unrenderable = result.success
      ? unrenderableSide(result.original, result.modified)
      : null;
    return {
      provenance: {
        kind: 'historical',
        base: comparison.base,
        head: comparison.head,
      },
      // `DiffTabState.comparison` is the mutable wire union; historical
      // provenance is what marks the record read-only (same as stash tabs).
      comparison: 'staged',
      path: entry.path,
      originalPath: entry.originalPath,
      original: result.success ? readSideText(result.original) : '',
      modified: result.success ? readSideText(result.modified) : '',
      originalRef:
        !result.success || result.original.outcome === 'absent'
          ? { kind: 'absent' }
          : { kind: 'commit', sha: result.baseSha },
      modifiedRef:
        !result.success || result.modified.outcome === 'absent'
          ? { kind: 'absent' }
          : { kind: 'commit', sha: result.headSha },
      snapshotToken: '',
      hunks: [],
      isBinary:
        result.success &&
        (result.original.outcome === 'binary' ||
          result.modified.outcome === 'binary'),
      ...(unrenderable ? { unrenderable } : {}),
      status: failure ? 'error' : 'fresh',
      ...(failure
        ? {
            errorMessage: describeGitReadError(failure.code),
            errorDetail: failure.message || undefined,
          }
        : {}),
      requestId,
    };
  }

  /** State for an entry whose very first read never landed. */
  private transportFailureState(
    entry: ReviewDiffEntry,
    requestId: number,
  ): DiffTabState {
    const { comparison } = entry;
    return {
      provenance:
        comparison.kind === 'historical'
          ? { kind: 'historical', base: comparison.base, head: comparison.head }
          : { kind: 'mutable', comparison: comparison.kind },
      comparison: comparison.kind === 'historical' ? 'staged' : comparison.kind,
      path: entry.path,
      originalPath: entry.originalPath,
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

  private setEntry(entry: ReviewDiffEntry): void {
    this._entries.update((entries) => new Map(entries).set(entry.key, entry));
  }

  private patchEntry(
    key: string,
    patch: Partial<Pick<ReviewDiffEntry, 'diff' | 'invalidated'>>,
  ): void {
    const entry = this._entries().get(key);
    if (!entry) return;
    this.setEntry({ ...entry, ...patch });
  }

  /**
   * Convert an absolute pushed path to a workspace-relative diff path, or
   * `null` when it lies outside the active workspace.
   */
  private toWorkspaceRelative(absolutePath: string): string | null {
    const root = this.activeWorkspacePath();
    if (!root || !absolutePath) return null;
    let rootLength = root.length;
    while (rootLength > 0 && '\\/'.includes(root.charAt(rootLength - 1))) {
      rootLength--;
    }
    const normalizedPath = absolutePath.replaceAll('\\', '/');
    // The root part is compared as a root key (separator- and case-folded, so
    // a `d:\` push matches a `D:/` workspace); the relative part keeps its case.
    if (
      normalizedPath.charAt(rootLength) !== '/' ||
      normalizeWorkspaceRoot(normalizedPath.slice(0, rootLength)) !==
        normalizeWorkspaceRoot(root)
    ) {
      return null;
    }
    const relative = normalizedPath.slice(rootLength + 1);
    return relative === '' ? null : relative;
  }
}
