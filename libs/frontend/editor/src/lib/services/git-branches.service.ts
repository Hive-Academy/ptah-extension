import {
  Injectable,
  inject,
  signal,
  computed,
  DestroyRef,
} from '@angular/core';
import { VSCodeService, rpcCall } from '@ptah-extension/core';
import type {
  BranchRef,
  GitBranchesResult,
  GitChangeKind,
  GitCheckoutParams,
  GitCheckoutResult,
  GitLastCommitResult,
  GitPushResult,
  GitRemotesResult,
  GitStashListResult,
  GitStatusUpdatePayload,
  GitTagsResult,
  RemoteInfo,
  TagRef,
} from '@ptah-extension/shared';

/**
 * Webview state key used by VSCodeService.{getState,setState} to persist
 * recently-visited branch names. The stored value is a workspace-keyed map
 * so each repository keeps its own most-recent list.
 */
const RECENT_BRANCHES_STATE_KEY = 'gitBranches.recentBranchesByWorkspace';

/** How many recent branches to remember per workspace. */
const MAX_RECENT_BRANCHES = 5;

type RecentBranchesByWorkspace = Record<string, string[]>;

/**
 * How long a refresh request waits for company before it dispatches (ms).
 *
 * A workspace switch produces three independent, uncoordinated refresh
 * requests within ~50 ms of each other (TASK_2026_343): `switchWorkspace()`,
 * the `GitStatusBarComponent` constructor, and the backend git watcher's
 * initial `git:status-update` push, whose own delay is
 * `GitWatcherService.INITIAL_FETCH_DELAY_MS = 50`. Before this window they
 * were not merged but SERIALISED by the re-entrancy guard, so the renderer
 * paid for three full backend round trips in sequence — measured at
 * 6.9 + 6.1 + 11.7 s on a 15k-file repository.
 *
 * 200 ms clears the watcher's 50 ms comfortably while staying below the
 * threshold at which a branch label reads as lagging.
 */
const REFRESH_COALESCE_MS = 200;

/** The three independently refreshable slices of this store. */
interface RefreshSlices {
  branches: boolean;
  stash: boolean;
  lastCommit: boolean;
}

const EMPTY_BRANCHES: GitBranchesResult = {
  current: '',
  local: [],
  remote: [],
};

/**
 * GitBranchesService — webview-side store for the branch picker, branch
 * details popover, and stash/last-commit chips in the git status bar.
 *
 * Pattern mirrors {@link GitStatusService}:
 * - Signal-based state (private writable + public readonly).
 * - Event-driven refresh: subscribes to `git:status-update` push events
 *   posted by the backend git watcher. There is NO polling.
 * - On-demand refresh via `refreshBranches()`, `refreshTags()`,
 *   `refreshRemotes()`. Tags and remotes are split out so they can be
 *   lazily fetched (the branch picker doesn't need them on first paint).
 * - Refresh requests are COALESCED, not serialised: everything asked for
 *   within {@link REFRESH_COALESCE_MS}, or while a pass is running, merges
 *   into one round of RPCs covering the union of the requested slices. This
 *   is what makes a workspace switch cost one `git:branches` call rather
 *   than three (TASK_2026_343).
 *
 * Recent-branches persistence uses VSCodeService webview state keyed by
 * workspace root so each repo gets its own most-recent list.
 */
@Injectable({ providedIn: 'root' })
export class GitBranchesService {
  private readonly vscodeService = inject(VSCodeService);
  private readonly destroyRef = inject(DestroyRef);

  private readonly _branches = signal<GitBranchesResult>(EMPTY_BRANCHES);
  private readonly _stashCount = signal<number>(0);
  private readonly _lastCommit = signal<GitLastCommitResult | null>(null);
  private readonly _remotes = signal<RemoteInfo[]>([]);
  private readonly _tags = signal<TagRef[]>([]);
  private readonly _isLoading = signal<boolean>(false);
  private readonly _recentBranches = signal<string[]>([]);

  /** Full branches result — { current, local, remote, recent }. */
  readonly branches = this._branches.asReadonly();
  /** Number of stash entries (cheap badge value). */
  readonly stashCount = this._stashCount.asReadonly();
  /** Last commit on HEAD, or null when not yet fetched / no repo. */
  readonly lastCommit = this._lastCommit.asReadonly();
  /** Configured remotes (lazy — populated by `refreshRemotes()`). */
  readonly remotes = this._remotes.asReadonly();
  /** Recent tags (lazy — populated by `refreshTags()`). */
  readonly tags = this._tags.asReadonly();
  /** Whether a refresh RPC is currently in flight. */
  readonly isLoading = this._isLoading.asReadonly();
  /** Recently visited branch names (most-recent first, max 5). */
  readonly recentBranches = this._recentBranches.asReadonly();

  /** Current branch short name (empty string when not in a repo). */
  readonly currentBranch = computed(() => this._branches().current);
  /** Local branches (always present, may be empty). */
  readonly localBranches = computed<BranchRef[]>(() => this._branches().local);
  /** Remote-tracking branches (only populated when `includeRemote=true`). */
  readonly remoteBranches = computed<BranchRef[]>(
    () => this._branches().remote,
  );

  private _isListening = false;
  private _messageHandler: ((event: MessageEvent) => void) | null = null;

  /**
   * Re-entrancy guard for the refresh pass. Prevents overlapping RPC bursts
   * when multiple `git:status-update` events arrive in quick succession
   * (e.g. branch switch followed by post-checkout refresh).
   * Non-signal field — does not trigger OnPush change detection.
   */
  private _isRefreshing = false;

  /**
   * Slices requested but not yet dispatched — the union of every request
   * that arrived during the coalescing window, or while the pass was running.
   *
   * A SET of slices, not a boolean. The predecessor was a `_refreshQueued`
   * flag whose trailing rerun refreshed all three slices unconditionally, so
   * a queued request that only wanted the stash count re-ran the expensive
   * branch listing with it.
   */
  private _pending: RefreshSlices | null = null;

  /** Armed while a coalescing window is open. */
  private _coalesceTimer: ReturnType<typeof setTimeout> | null = null;

  /**
   * Promise handed to every caller whose request is still undispatched or
   * in flight, resolved once the pass that will satisfy them all drains.
   */
  private _passPromise: Promise<void> | null = null;
  private _resolvePass: (() => void) | null = null;

  /**
   * Active workspace folder as told by the WorkspaceCoordinator. Takes
   * precedence over `config().workspaceRoot`, which only updates after
   * coordination completes. Used to drop `git:status-update` pushes that
   * belong to a different workspace folder.
   */
  private _activeWorkspacePath: string | null = null;

  constructor() {
    this.restoreRecentBranches();
    this.destroyRef.onDestroy(() => this.stopListening());
  }

  /**
   * Start listening for `git:status-update` push events from the backend
   * git watcher. On each event, refreshes branches + stash + last commit.
   *
   * Idempotent — calling twice is a no-op.
   */
  startListening(): void {
    if (this._isListening) return;
    this._isListening = true;

    this._messageHandler = (event: MessageEvent): void => {
      const data = event.data;
      if (data?.type === 'git:status-update') {
        const payload = data.payload as GitStatusUpdatePayload | undefined;
        if (
          payload?.workspaceRoot &&
          payload.workspaceRoot !== this.workspaceKey()
        ) {
          return;
        }
        void this.refreshForCauses(payload?.causes);
      }
    };
    window.addEventListener('message', this._messageHandler);
  }

  /**
   * Switch branch state to a different workspace folder. Resets all
   * signals (branches are cheap to refetch — no per-workspace cache),
   * reloads the recent-branches list for the new folder, and refetches.
   */
  switchWorkspace(workspacePath: string): void {
    if (this._activeWorkspacePath === workspacePath) return;
    this._activeWorkspacePath = workspacePath;
    this.resetState();
    this.restoreRecentBranches();
    void this.refreshBranches();
  }

  /** Reset state when the active workspace folder is removed. */
  removeWorkspaceState(workspacePath: string): void {
    if (this._activeWorkspacePath !== workspacePath) return;
    this._activeWorkspacePath = null;
    this.resetState();
  }

  private resetState(): void {
    this._branches.set(EMPTY_BRANCHES);
    this._stashCount.set(0);
    this._lastCommit.set(null);
    this._remotes.set([]);
    this._tags.set([]);
    this._recentBranches.set([]);
  }

  /**
   * Refresh only the slices whose triggers fired during the watcher debounce
   * window. Three independent slices map to three independent backend RPCs:
   *
   *   branches    ← 'head', 'refs', 'initial'
   *   stash       ← 'refs', 'refs-stash', 'initial'
   *   lastCommit  ← 'head', 'initial'
   *
   * Pure 'workspace' / 'index' events (working-tree edits, staging) bypass
   * every slice — those don't move branches, stashes, or HEAD. An undefined
   * `causes` list is treated as 'initial' so older backends that don't yet
   * emit causes keep the prior "refresh everything" behavior.
   */
  async refreshForCauses(causes?: readonly GitChangeKind[]): Promise<void> {
    const effective: readonly GitChangeKind[] =
      causes && causes.length > 0 ? causes : ['initial'];

    return this.requestRefresh({
      branches: effective.some(
        (c) => c === 'head' || c === 'refs' || c === 'initial',
      ),
      stash: effective.some(
        (c) => c === 'refs' || c === 'refs-stash' || c === 'initial',
      ),
      lastCommit: effective.some((c) => c === 'head' || c === 'initial'),
    });
  }

  /**
   * Fold a refresh request into the pending set and make sure a pass will run.
   *
   * Requests arriving inside {@link REFRESH_COALESCE_MS}, or while a pass is
   * already running, are merged rather than queued behind each other — which
   * is what collapses a workspace switch's three independent requests into one
   * `git:branches` round trip. Every caller gets the same promise, resolved
   * when the pass that covers their slices has drained.
   */
  private requestRefresh(slices: RefreshSlices): Promise<void> {
    if (!slices.branches && !slices.stash && !slices.lastCommit) {
      return Promise.resolve();
    }

    this._pending = {
      branches: (this._pending?.branches ?? false) || slices.branches,
      stash: (this._pending?.stash ?? false) || slices.stash,
      lastCommit: (this._pending?.lastCommit ?? false) || slices.lastCommit,
    };
    this._isLoading.set(true);

    if (!this._passPromise) {
      this._passPromise = new Promise<void>((resolve) => {
        this._resolvePass = resolve;
      });
    }

    // A running pass re-reads `_pending` after each round, so it will pick
    // this request up without a second timer.
    if (!this._isRefreshing && this._coalesceTimer === null) {
      this._coalesceTimer = setTimeout(() => {
        this._coalesceTimer = null;
        void this.runRefreshPass();
      }, REFRESH_COALESCE_MS);
    }

    return this._passPromise;
  }

  /**
   * Drain {@link _pending} until nothing is left, then release every waiter.
   *
   * The active workspace is captured per round and handed to each slice
   * refresher, so a response for the folder the user just navigated away from
   * is dropped instead of being written over the new folder's state.
   */
  private async runRefreshPass(): Promise<void> {
    this._isRefreshing = true;
    try {
      for (;;) {
        const slices = this._pending;
        this._pending = null;
        if (!slices) break;

        const workspaceAtRequest = this.workspaceKey();
        const tasks: Promise<unknown>[] = [];
        if (slices.branches)
          tasks.push(this.refreshBranchList(workspaceAtRequest));
        if (slices.stash)
          tasks.push(this.refreshStashCount(workspaceAtRequest));
        if (slices.lastCommit)
          tasks.push(this.refreshLastCommit(workspaceAtRequest));
        await Promise.all(tasks);
      }
    } finally {
      this._isRefreshing = false;
      this._isLoading.set(false);
      const resolve = this._resolvePass;
      this._passPromise = null;
      this._resolvePass = null;
      resolve?.();
    }
  }

  /**
   * Stop listening for push events. Safe to call when not listening.
   * Wired to {@link DestroyRef.onDestroy} in the constructor as a backstop.
   */
  stopListening(): void {
    this._isListening = false;
    if (this._messageHandler) {
      window.removeEventListener('message', this._messageHandler);
      this._messageHandler = null;
    }
    // An armed coalescing window would otherwise fire its RPCs after the
    // surface that wanted them is gone.
    if (this._coalesceTimer !== null) {
      clearTimeout(this._coalesceTimer);
      this._coalesceTimer = null;
      this._pending = null;
      this._isLoading.set(false);
      const resolve = this._resolvePass;
      this._passPromise = null;
      this._resolvePass = null;
      resolve?.();
    }
  }

  /**
   * Fetch branches + stash count + last commit in parallel and update
   * the corresponding signals. Used for the initial bootstrap (component
   * constructor) and any caller that explicitly wants a full refresh.
   * Per-event refreshes go through {@link refreshForCauses} instead,
   * which skips slices whose triggers never fired.
   */
  async refreshBranches(): Promise<void> {
    await this.refreshForCauses(['initial']);
  }

  /**
   * Has the active workspace moved on since a request was dispatched?
   *
   * A `git:branches` round trip on a large repository outlives a workspace
   * switch easily, and without this the previous folder's branch list is
   * written straight over the new folder's. Mirrors the `workspaceAtFetchTime`
   * guard in `GitStatusService.fetchGitInfo`.
   */
  private isStale(workspaceAtRequest: string | null): boolean {
    return this.workspaceKey() !== workspaceAtRequest;
  }

  /** Refresh the local + remote branch list signal. */
  private async refreshBranchList(
    workspaceAtRequest: string | null = this.workspaceKey(),
  ): Promise<void> {
    const result = await this.safeRpc<GitBranchesResult>('git:branches', {
      includeRemote: true,
      ...this.scopeParams(),
    });
    if (result && !this.isStale(workspaceAtRequest)) this._branches.set(result);
  }

  /** Refresh the stash count badge signal. */
  private async refreshStashCount(
    workspaceAtRequest: string | null = this.workspaceKey(),
  ): Promise<void> {
    const result = await this.safeRpc<GitStashListResult>(
      'git:stashList',
      this.scopeParams(),
    );
    if (result && !this.isStale(workspaceAtRequest))
      this._stashCount.set(result.count);
  }

  /** Refresh the last-commit-on-HEAD signal. */
  private async refreshLastCommit(
    workspaceAtRequest: string | null = this.workspaceKey(),
  ): Promise<void> {
    const result = await this.safeRpc<GitLastCommitResult>(
      'git:lastCommit',
      this.scopeParams(),
    );
    if (result && !this.isStale(workspaceAtRequest))
      this._lastCommit.set(result);
  }

  /** Lazy fetch of recent tags — call when the branch details popover opens. */
  async refreshTags(limit = 20): Promise<void> {
    const result = await this.safeRpc<GitTagsResult>('git:tags', {
      limit,
      ...this.scopeParams(),
    });
    if (result) this._tags.set(result.tags);
  }

  /** Lazy fetch of configured remotes — call when the popover opens. */
  async refreshRemotes(): Promise<void> {
    const result = await this.safeRpc<GitRemotesResult>(
      'git:remotes',
      this.scopeParams(),
    );
    if (result) this._remotes.set(result.remotes);
  }

  /**
   * Workspace-scoping params for git RPCs so results always come from the
   * workspace this service displays, independent of backend switch timing.
   * Empty when no workspace is known (backend falls back to its active one).
   */
  private scopeParams(): { workspaceRoot?: string } {
    const wsKey = this.workspaceKey();
    return wsKey ? { workspaceRoot: wsKey } : {};
  }

  /**
   * Record a branch as recently visited. Prepends to the list, deduplicates
   * (case-sensitive), and caps at {@link MAX_RECENT_BRANCHES} entries.
   * Persists the per-workspace map to webview state so the list survives
   * webview reloads.
   */
  recordVisitedBranch(branchName: string): void {
    if (!branchName) return;

    const current = this._recentBranches();
    const updated = [
      branchName,
      ...current.filter((b) => b !== branchName),
    ].slice(0, MAX_RECENT_BRANCHES);

    this._recentBranches.set(updated);
    this.persistRecentBranches(updated);
  }

  /**
   * Checkout a branch. The backend handler returns `{ dirty: true }` when
   * the working tree has uncommitted changes and `force=false`; the caller
   * is responsible for surfacing a "Discard changes?" confirmation and
   * retrying with `force=true`.
   *
   * Errors are mapped into `GitCheckoutResult.error` so callers always
   * receive a typed result and never need to catch.
   */
  async checkout(params: GitCheckoutParams): Promise<GitCheckoutResult> {
    try {
      const response = await rpcCall<GitCheckoutResult>(
        this.vscodeService,
        'git:checkout',
        { ...this.scopeParams(), ...params },
      );
      if (response.success && response.data) {
        return response.data;
      }
      return {
        success: false,
        error: response.error ?? 'git:checkout RPC failed',
      };
    } catch (err) {
      console.error('[GitBranchesService] checkout failed', err);
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  /**
   * Push the current branch to its upstream remote. Refreshes branch state
   * (ahead/behind counts) on success so the push button hides itself once
   * there are no more unpushed commits.
   */
  async push(): Promise<GitPushResult> {
    try {
      const response = await rpcCall<GitPushResult>(
        this.vscodeService,
        'git:push',
        this.scopeParams(),
      );
      if (response.success && response.data) {
        if (response.data.success)
          void this.requestRefresh({
            branches: true,
            stash: false,
            lastCommit: false,
          });
        return response.data;
      }
      return {
        success: false,
        error: response.error ?? 'git:push RPC failed',
      };
    } catch (err) {
      console.error('[GitBranchesService] push failed', err);
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  /**
   * Wrapper around `rpcCall` that returns `null` on transport failure or
   * unsuccessful response. Logs but does not throw — keeping the listener
   * loop and Promise.all path resilient.
   */
  private async safeRpc<T>(
    method: Parameters<typeof rpcCall>[1],
    params: Record<string, unknown>,
  ): Promise<T | null> {
    try {
      const response = await rpcCall<T>(this.vscodeService, method, params);
      if (response.success && response.data !== undefined) {
        return response.data;
      }
      if (response.error) {
        console.warn(
          `[GitBranchesService] ${method} returned error: ${response.error}`,
        );
      }
      return null;
    } catch (err) {
      console.error(`[GitBranchesService] ${method} threw`, err);
      return null;
    }
  }

  /** Restore the recent-branches list for the current workspace, if any. */
  private restoreRecentBranches(): void {
    const wsKey = this.workspaceKey();
    if (!wsKey) return;
    const all =
      this.vscodeService.getState<RecentBranchesByWorkspace>(
        RECENT_BRANCHES_STATE_KEY,
      ) ?? {};
    const list = all[wsKey];
    if (Array.isArray(list) && list.length > 0) {
      this._recentBranches.set(list.slice(0, MAX_RECENT_BRANCHES));
    }
  }

  /**
   * Persist the recent-branches list for the current workspace, merging
   * with the existing per-workspace map so other workspaces are preserved.
   */
  private persistRecentBranches(list: string[]): void {
    const wsKey = this.workspaceKey();
    if (!wsKey) return;
    const all =
      this.vscodeService.getState<RecentBranchesByWorkspace>(
        RECENT_BRANCHES_STATE_KEY,
      ) ?? {};
    all[wsKey] = list;
    this.vscodeService.setState(RECENT_BRANCHES_STATE_KEY, all);
  }

  /**
   * Workspace key used for per-repo persistence and push filtering.
   * Prefers the coordinator-driven active path (updated synchronously on
   * switch) over `config().workspaceRoot` (updated after coordination).
   * Returns `null` when no workspace is set; callers must guard before
   * reading/writing state.
   */
  private workspaceKey(): string | null {
    return (
      this._activeWorkspacePath ??
      this.vscodeService.config().workspaceRoot ??
      null
    );
  }
}
