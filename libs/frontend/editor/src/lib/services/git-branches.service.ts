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
  GitCheckoutParams,
  GitCheckoutResult,
  GitLastCommitResult,
  GitRemotesResult,
  GitStashListResult,
  GitTagsResult,
  RemoteInfo,
  TagRef,
} from '@ptah-extension/shared';

// ============================================================================
// PERSISTENCE
// ============================================================================

/**
 * Webview state key used by VSCodeService.{getState,setState} to persist
 * recently-visited branch names. The stored value is a workspace-keyed map
 * so each repository keeps its own most-recent list.
 */
const RECENT_BRANCHES_STATE_KEY = 'gitBranches.recentBranchesByWorkspace';

/** How many recent branches to remember per workspace. */
const MAX_RECENT_BRANCHES = 5;

type RecentBranchesByWorkspace = Record<string, string[]>;

// ============================================================================
// EMPTY DEFAULTS
// ============================================================================

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
 *
 * Recent-branches persistence uses VSCodeService webview state keyed by
 * workspace root so each repo gets its own most-recent list.
 */
@Injectable({ providedIn: 'root' })
export class GitBranchesService {
  private readonly vscodeService = inject(VSCodeService);
  private readonly destroyRef = inject(DestroyRef);

  // ============================================================================
  // PRIVATE WRITABLE SIGNALS
  // ============================================================================

  private readonly _branches = signal<GitBranchesResult>(EMPTY_BRANCHES);
  private readonly _stashCount = signal<number>(0);
  private readonly _lastCommit = signal<GitLastCommitResult | null>(null);
  private readonly _remotes = signal<RemoteInfo[]>([]);
  private readonly _tags = signal<TagRef[]>([]);
  private readonly _isLoading = signal<boolean>(false);
  private readonly _recentBranches = signal<string[]>([]);

  // ============================================================================
  // PUBLIC READONLY SIGNALS
  // ============================================================================

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

  // ============================================================================
  // COMPUTED SIGNALS
  // ============================================================================

  /** Current branch short name (empty string when not in a repo). */
  readonly currentBranch = computed(() => this._branches().current);
  /** Local branches (always present, may be empty). */
  readonly localBranches = computed<BranchRef[]>(() => this._branches().local);
  /** Remote-tracking branches (only populated when `includeRemote=true`). */
  readonly remoteBranches = computed<BranchRef[]>(
    () => this._branches().remote,
  );

  // ============================================================================
  // LISTENER STATE
  // ============================================================================

  private _isListening = false;
  private _messageHandler: ((event: MessageEvent) => void) | null = null;

  /**
   * Re-entrancy guard for {@link refreshBranches}. Prevents overlapping
   * RPC bursts when multiple `git:status-update` events arrive in quick
   * succession (e.g. branch switch followed by post-checkout refresh).
   * Non-signal field — does not trigger OnPush change detection.
   */
  private _isRefreshing = false;

  constructor() {
    // Restore recent-branches list for the current workspace from webview state.
    this.restoreRecentBranches();

    // Cleanup: ensure the message listener is removed when the root injector
    // is torn down (HMR / test teardown), even if `stopListening()` is never
    // called explicitly by a consumer.
    this.destroyRef.onDestroy(() => this.stopListening());
  }

  // ============================================================================
  // EVENT LISTENING (event-driven — no polling)
  // ============================================================================

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
        // Branch list, stash, and last commit may all have changed if the
        // user just switched branches or made a commit.
        void this.refreshBranches();
      }
    };
    window.addEventListener('message', this._messageHandler);
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
  }

  // ============================================================================
  // REFRESH (RPC pulls)
  // ============================================================================

  /**
   * Fetch branches + stash count + last commit in parallel and update
   * the corresponding signals. Each RPC is wrapped in its own try/catch
   * so a single failure does not poison the others.
   */
  async refreshBranches(): Promise<void> {
    if (this._isRefreshing) return;
    this._isRefreshing = true;
    try {
      this._isLoading.set(true);

      // Fire all three RPCs in parallel — they're independent reads.
      const [branchesResult, stashResult, lastCommitResult] = await Promise.all(
        [
          this.safeRpc<GitBranchesResult>('git:branches', {
            includeRemote: true,
          }),
          this.safeRpc<GitStashListResult>('git:stashList', {}),
          this.safeRpc<GitLastCommitResult>('git:lastCommit', {}),
        ],
      );

      if (branchesResult) this._branches.set(branchesResult);
      if (stashResult) this._stashCount.set(stashResult.count);
      if (lastCommitResult) this._lastCommit.set(lastCommitResult);

      this._isLoading.set(false);
    } finally {
      this._isRefreshing = false;
    }
  }

  /** Lazy fetch of recent tags — call when the branch details popover opens. */
  async refreshTags(limit = 20): Promise<void> {
    const result = await this.safeRpc<GitTagsResult>('git:tags', { limit });
    if (result) this._tags.set(result.tags);
  }

  /** Lazy fetch of configured remotes — call when the popover opens. */
  async refreshRemotes(): Promise<void> {
    const result = await this.safeRpc<GitRemotesResult>('git:remotes', {});
    if (result) this._remotes.set(result.remotes);
  }

  // ============================================================================
  // RECENT BRANCHES PERSISTENCE
  // ============================================================================

  /**
   * Record a branch as recently visited. Prepends to the list, deduplicates
   * (case-sensitive), and caps at {@link MAX_RECENT_BRANCHES} entries.
   * Persists the per-workspace map to webview state so the list survives
   * webview reloads.
   */
  recordVisitedBranch(branchName: string): void {
    if (!branchName) return;

    const current = this._recentBranches();
    // Dedupe and prepend.
    const updated = [
      branchName,
      ...current.filter((b) => b !== branchName),
    ].slice(0, MAX_RECENT_BRANCHES);

    this._recentBranches.set(updated);
    this.persistRecentBranches(updated);
  }

  // ============================================================================
  // CHECKOUT (passthrough)
  // ============================================================================

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
      const response = await rpcCall(
        this.vscodeService,
        'git:checkout',
        params,
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

  // ============================================================================
  // PRIVATE HELPERS
  // ============================================================================

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
   * Workspace key used for per-repo persistence. Returns `null` when no
   * workspace is set; callers must guard before reading/writing state.
   */
  private workspaceKey(): string | null {
    return this.vscodeService.config().workspaceRoot ?? null;
  }
}
