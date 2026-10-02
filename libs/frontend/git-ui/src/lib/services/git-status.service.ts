import {
  Injectable,
  inject,
  signal,
  computed,
  DestroyRef,
} from '@angular/core';
import { VSCodeService, rpcCall } from '@ptah-extension/core';
import type { MessageHandler } from '@ptah-extension/core';
import { MESSAGE_TYPES } from '@ptah-extension/shared';
import type {
  GitInfoResult,
  GitBranchInfo,
  GitFileStatus,
  GitRepoOperation,
  GitStatusUnavailableReason,
  GitStatusUpdatePayload,
} from '@ptah-extension/shared';

/** The git data a workspace shows, without cache bookkeeping. */
interface GitWorkspaceSnapshot {
  branch: GitBranchInfo;
  files: GitFileStatus[];
  isGitRepo: boolean;
  /**
   * Why the latest status read failed, or null when the latest read
   * succeeded.
   */
  statusUnavailable: GitStatusUnavailableReason | null;
  /**
   * Set when the latest read failed and `branch`/`files`/`isGitRepo` are the
   * last successfully read values kept in its place (TASK_2026_576 RC3).
   * Null when they came from the latest result.
   */
  staleReason: GitStatusUnavailableReason | null;
  /**
   * The merge, rebase or cherry-pick in progress, or null when none is (or
   * the latest result did not say).
   */
  operation: GitRepoOperation | null;
}

/**
 * Per-workspace git state snapshot.
 * Cached in the workspace map so switching back is instant.
 */
interface GitWorkspaceState extends GitWorkspaceSnapshot {
  /** When this cache entry was last written (data applied or state saved). */
  lastUpdated: number;
  /**
   * When git data was last actually fetched from (or pushed by) the backend.
   * Distinct from `lastUpdated`, which also advances on plain save-on-switch.
   * Used to decide whether an eager fetch is redundant on workspace switch.
   */
  fetchedAt?: number;
}

/** Default empty branch info for reset scenarios. */
const EMPTY_BRANCH: GitBranchInfo = {
  branch: '',
  upstream: null,
  ahead: 0,
  behind: 0,
};

/** State shown for a workspace with no cached or fetched data. */
const EMPTY_SNAPSHOT: GitWorkspaceSnapshot = {
  branch: EMPTY_BRANCH,
  files: [],
  isGitRepo: false,
  statusUnavailable: null,
  staleReason: null,
  operation: null,
};

function branchEqual(a: GitBranchInfo, b: GitBranchInfo): boolean {
  return (
    a.branch === b.branch &&
    a.upstream === b.upstream &&
    a.ahead === b.ahead &&
    a.behind === b.behind
  );
}

function filesEqual(a: GitFileStatus[], b: GitFileStatus[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (
      a[i].path !== b[i].path ||
      a[i].status !== b[i].status ||
      a[i].staged !== b[i].staged ||
      a[i].isDirectory !== b[i].isDirectory ||
      a[i].origPath !== b[i].origPath ||
      a[i].additions !== b[i].additions ||
      a[i].deletions !== b[i].deletions ||
      a[i].binary !== b[i].binary
    )
      return false;
  }
  return true;
}

function operationEqual(
  a: GitRepoOperation | null,
  b: GitRepoOperation | null,
): boolean {
  if (a === null || b === null) return a === b;
  return (
    a.kind === b.kind &&
    a.conflictedPaths.length === b.conflictedPaths.length &&
    a.conflictedPaths.every((path, i) => path === b.conflictedPaths[i])
  );
}

const OPERATION_KINDS: ReadonlySet<string> = new Set([
  'merge',
  'rebase',
  'cherry-pick',
]);

/**
 * The operation a `git:info` result reports, checked at the boundary: a
 * missing or malformed field reads as no operation, and only string paths
 * are kept.
 */
function readOperation(value: unknown): GitRepoOperation | null {
  if (typeof value !== 'object' || value === null) return null;
  const { kind, conflictedPaths } = value as Record<string, unknown>;
  if (typeof kind !== 'string' || !OPERATION_KINDS.has(kind)) return null;
  const paths = Array.isArray(conflictedPaths)
    ? conflictedPaths.filter(
        (path): path is string => typeof path === 'string' && path !== '',
      )
    : [];
  return { kind: kind as GitRepoOperation['kind'], conflictedPaths: paths };
}

/**
 * Whether a snapshot holds a successfully read repository state worth keeping
 * when a later read fails: a git repo whose files were either read by the
 * latest result or are themselves last-known-good data kept from before.
 */
function hasLastGoodData(
  snapshot: GitWorkspaceSnapshot | undefined,
): snapshot is GitWorkspaceSnapshot {
  return (
    snapshot !== undefined &&
    snapshot.isGitRepo &&
    (snapshot.statusUnavailable === null || snapshot.staleReason !== null)
  );
}

/**
 * The snapshot a workspace shows after `data` arrives. A result whose status
 * could not be read keeps the previous good branch, files and repo flag and
 * marks them stale; without previous good data the result is shown as is.
 */
function nextSnapshot(
  data: GitInfoResult,
  previous: GitWorkspaceSnapshot | undefined,
): GitWorkspaceSnapshot {
  // Every result is a full snapshot: a result without the flag clears it.
  const statusUnavailable = data.statusUnavailable ?? null;
  if (statusUnavailable !== null && hasLastGoodData(previous)) {
    return {
      branch: previous.branch,
      files: previous.files,
      isGitRepo: previous.isGitRepo,
      statusUnavailable,
      staleReason: statusUnavailable,
      operation: previous.operation,
    };
  }
  return {
    branch: data.branch,
    files: data.files,
    isGitRepo: data.isGitRepo,
    statusUnavailable,
    staleReason: null,
    operation: readOperation(data.operation),
  };
}

/**
 * `rpcCall` reports its own renderer-side timeout as a resolved
 * `{ success: false, error: 'RPC timeout: <method>' }`
 * (`libs/frontend/core/src/lib/services/rpc-call.util.ts`); that prefix is
 * the only signal it gives.
 */
export const RPC_TIMEOUT_ERROR_PREFIX = 'RPC timeout';

/** Whether an `rpcCall` failure is the renderer giving up waiting. */
export function isRpcTimeout(error: string | undefined): boolean {
  return error?.startsWith(RPC_TIMEOUT_ERROR_PREFIX) === true;
}

/**
 * Reason for a `git:info` read that produced no usable result: `timeout`
 * when the RPC itself timed out, `error` for any other transport failure or
 * a malformed payload.
 */
function readFailureReason(
  success: boolean,
  error: string | undefined,
): GitStatusUnavailableReason {
  return !success && isRpcTimeout(error) ? 'timeout' : 'error';
}

@Injectable({ providedIn: 'root' })
export class GitStatusService implements MessageHandler {
  private readonly vscodeService = inject(VSCodeService);
  private readonly destroyRef = inject(DestroyRef);

  private readonly _workspaceGitState = new Map<string, GitWorkspaceState>();

  /**
   * How long a restored cache entry is considered fresh on workspace switch.
   * Within this window the eager `git:info` fetch is skipped so rapid A↔B↔A
   * switching does not re-hit `git:info` every time.
   *
   * Trade-off (do NOT restore the old 30s value without re-reading this): the
   * Electron git watcher only watches ONE workspace at a time
   * (`git-watcher.service.ts` re-arms a single target on switch), so NO
   * `git:status-update` push is generated for a workspace while it is in the
   * background. A background change (e.g. a background agent session
   * committing in workspace A while the user views B) therefore leaves A's
   * cache stale until the next fetch. 5s bounds that staleness while still
   * collapsing the rapid-thrash fetches this optimization targets; missing or
   * older entries still fetch on switch, as does an explicit refresh.
   */
  private static readonly CACHE_TTL_MS = 5_000;

  private _isListening = false;

  private readonly _activeWorkspacePath = signal<string | null>(null);
  private readonly _branch = signal<GitBranchInfo>(EMPTY_BRANCH, {
    equal: branchEqual,
  });
  private readonly _files = signal<GitFileStatus[]>([], { equal: filesEqual });
  private readonly _isGitRepo = signal(false);
  private readonly _isLoading = signal(false);
  private readonly _statusUnavailable =
    signal<GitStatusUnavailableReason | null>(null);
  private readonly _staleReason = signal<GitStatusUnavailableReason | null>(
    null,
  );
  private readonly _operation = signal<GitRepoOperation | null>(null, {
    equal: operationEqual,
  });
  private fetchGeneration = 0;

  /** Current branch info for the active workspace. */
  readonly branch = this._branch.asReadonly();

  /** All changed files in the active workspace. */
  readonly files = this._files.asReadonly();

  /** Whether the active workspace is inside a git repository. */
  readonly isGitRepo = this._isGitRepo.asReadonly();

  /** Whether a git:info RPC call is currently in flight. */
  readonly isLoading = this._isLoading.asReadonly();

  /**
   * Why the active workspace's latest status read failed, or null. While set,
   * `files` is either the last known list (see {@link staleReason}) or empty
   * because nothing was ever read — NOT because the tree is clean — so
   * `changedFileCount` / `hasChanges` must not be presented as "no changes".
   */
  readonly statusUnavailable = this._statusUnavailable.asReadonly();

  /** Whether the active workspace's git status could not be read. */
  readonly isStatusUnavailable = computed(
    () => this._statusUnavailable() !== null,
  );

  /**
   * Why the active workspace shows last-known data instead of the latest
   * read, or null. Set only when a read failed and an earlier successful read
   * of the same workspace exists; `branch`, `files` and `isGitRepo` then hold
   * that earlier read (TASK_2026_576 RC3).
   */
  readonly staleReason = this._staleReason.asReadonly();

  /** Whether the active workspace shows last-known data from an earlier read. */
  readonly isStale = computed(() => this._staleReason() !== null);

  /**
   * The merge, rebase or cherry-pick in progress in the active workspace,
   * with its still-conflicted paths; null when none is.
   */
  readonly operation = this._operation.asReadonly();

  /** Number of changed files. */
  readonly changedFileCount = computed(() => this._files().length);

  /** Whether there are any changed files. */
  readonly hasChanges = computed(() => this._files().length > 0);

  /** Current branch name string shortcut. */
  readonly branchName = computed(() => this._branch().branch);

  /** Files that are staged in the git index. */
  readonly stagedFiles = computed(() => this._files().filter((f) => f.staged));

  /** Files that are unstaged (working tree changes). */
  readonly unstagedFiles = computed(() =>
    this._files().filter((f) => !f.staged),
  );

  /** Count of staged files. */
  readonly stagedCount = computed(() => this.stagedFiles().length);

  /** Count of unstaged files. */
  readonly unstagedCount = computed(() => this.unstagedFiles().length);

  /** The currently active workspace path (for path normalization in components). */
  readonly activeWorkspacePath = this._activeWorkspacePath.asReadonly();

  constructor() {
    this.destroyRef.onDestroy(() => this.stopListening());
  }

  /**
   * Switch git state to a different workspace.
   * Saves current state, restores target from cache or resets to defaults.
   * Triggers an immediate git:info fetch for the new workspace.
   */
  switchWorkspace(workspacePath: string): void {
    if (this._activeWorkspacePath() === workspacePath) return;
    this.saveCurrentState();
    this._activeWorkspacePath.set(workspacePath);
    const cached = this._workspaceGitState.get(workspacePath);
    this.setSignals(cached ?? EMPTY_SNAPSHOT);

    // Skip the eager fetch when the restored cache entry is still fresh —
    // repeated A↔B switching otherwise re-hits `git:info` every time. The
    // freshness window is deliberately short (see CACHE_TTL_MS) because the
    // single-workspace Electron watcher does NOT keep background workspaces
    // current. A missing or stale entry still fetches so first-visit and
    // idle-past-the-window workspaces refresh as before.
    const fetchedAt = cached?.fetchedAt;
    const isFresh =
      fetchedAt !== undefined &&
      Date.now() - fetchedAt < GitStatusService.CACHE_TTL_MS;
    if (!isFresh) {
      this.fetchGitInfo();
      return;
    }
    // The restored cache entry is fresh, so no request is pending for THIS
    // workspace. A request still in flight for the one we left owns the
    // loading flag; disown it, or the restored dock shows "Loading…" until
    // that other workspace answers — forever if it never does.
    this.fetchGeneration++;
    this._isLoading.set(false);
  }

  /**
   * Remove cached git state for a workspace.
   * Called when a workspace folder is removed from the layout.
   */
  removeWorkspaceState(workspacePath: string): void {
    this._workspaceGitState.delete(workspacePath);
    if (this._activeWorkspacePath() === workspacePath) {
      this._activeWorkspacePath.set(null);
      this.setSignals(EMPTY_SNAPSHOT);
    }
  }

  /**
   * Message types dispatched to {@link handleMessage} by
   * `MessageRouterService`. Registered via the `MESSAGE_HANDLERS`
   * multi-provider in the composition root — this service holds no raw
   * `window` listener of its own (C1 AC1).
   */
  readonly handledMessageTypes = [MESSAGE_TYPES.GIT_STATUS_UPDATE] as const;

  /**
   * Apply a `git:status-update` push routed by `MessageRouterService`.
   *
   * Gated on {@link startListening} / {@link stopListening} so the
   * observable behaviour is identical to the raw listener this replaced:
   * pushes arriving before the editor panel starts listening, or after it
   * stops, are ignored (C1 AC2).
   */
  handleMessage(message: { type: string; payload?: unknown }): void {
    if (!this._isListening) return;
    if (message.type !== MESSAGE_TYPES.GIT_STATUS_UPDATE) return;
    if (!message.payload) return;

    const payload = message.payload as GitStatusUpdatePayload;
    this.applyGitInfo(payload, payload.workspaceRoot ?? null);
  }

  /**
   * Begin accepting `git:status-update` pushes and perform an initial RPC
   * fetch to populate state immediately.
   *
   * No longer registers a listener — dispatch is owned by
   * `MessageRouterService`. This flips the gate {@link handleMessage}
   * reads and keeps the eager fetch, which is the only side effect callers
   * ever depended on.
   */
  startListening(): void {
    if (this._isListening) return;
    this._isListening = true;
    this.fetchGitInfo();
  }

  /**
   * Stop accepting push events.
   * Called when the editor panel is hidden or the service is destroyed.
   *
   * There is no listener to tear down and no timer to clear; closing the
   * gate is the whole of it (C1 AC3).
   */
  stopListening(): void {
    this._isListening = false;
  }

  /**
   * Re-read `git:info` for the active workspace now. For callers that just
   * ran a git operation (pull, push, stash pop) and cannot rely on a watcher
   * push — VS Code and the CLI have no `.git` watcher.
   */
  refresh(): Promise<void> {
    return this.fetchGitInfo();
  }

  /**
   * Apply a git info result to the workspace it belongs to.
   * Used by both push events and on-demand RPC responses.
   *
   * `workspaceRoot` identifies the workspace folder the result was computed
   * for. When it matches the active workspace (or is null — payloads from
   * older backends), the live signals update; otherwise only that
   * workspace's cache entry is written. This is what keeps two open
   * workspace folders from contaminating each other: backend pushes for a
   * newly-activated folder can arrive while this service still displays the
   * previous one.
   *
   * A result whose status could not be read keeps the target workspace's
   * previous good data, marked stale (see {@link nextSnapshot}). The previous
   * data is always the target's own — the live signals for the active
   * workspace, its cache entry otherwise — never another workspace's.
   */
  private applyGitInfo(
    data: GitInfoResult,
    workspaceRoot: string | null,
  ): void {
    const active = this._activeWorkspacePath();
    const target = workspaceRoot ?? active;
    if (!target) return;

    if (target === active) {
      this.setSignals(nextSnapshot(data, this.currentSnapshot()));
      // Fresh data just arrived for the active workspace — stamp fetchedAt.
      this.saveCurrentState(Date.now());
    } else {
      const now = Date.now();
      this._workspaceGitState.set(target, {
        ...nextSnapshot(data, this._workspaceGitState.get(target)),
        lastUpdated: now,
        fetchedAt: now,
      });
    }
  }

  /** The active workspace's live signal values. */
  private currentSnapshot(): GitWorkspaceSnapshot {
    return {
      branch: this._branch(),
      files: this._files(),
      isGitRepo: this._isGitRepo(),
      statusUnavailable: this._statusUnavailable(),
      staleReason: this._staleReason(),
      operation: this._operation(),
    };
  }

  /** Publish a snapshot to the live signals. */
  private setSignals(snapshot: GitWorkspaceSnapshot): void {
    this._branch.set(snapshot.branch);
    this._files.set(snapshot.files);
    this._isGitRepo.set(snapshot.isGitRepo);
    this._statusUnavailable.set(snapshot.statusUnavailable);
    this._staleReason.set(snapshot.staleReason);
    this._operation.set(snapshot.operation);
  }

  /**
   * Fetch git info via RPC for the active workspace (on-demand).
   * Used for initial load and workspace switches only — not periodic polling.
   */
  private async fetchGitInfo(): Promise<void> {
    const workspaceAtFetchTime = this._activeWorkspacePath();
    if (!workspaceAtFetchTime) return;

    const generation = ++this.fetchGeneration;
    // A response may only publish while it is BOTH the newest fetch and for
    // the active workspace: two same-workspace refreshes can resolve out of
    // order, and the older one would otherwise overwrite newer data.
    const isCurrent = (): boolean =>
      this._activeWorkspacePath() === workspaceAtFetchTime &&
      generation === this.fetchGeneration;

    this._isLoading.set(true);
    try {
      const result = await rpcCall<GitInfoResult>(
        this.vscodeService,
        'git:info',
        { workspaceRoot: workspaceAtFetchTime },
      );
      if (!isCurrent()) return;

      // Explicit null checks, not truthiness: the payload shape is what gates
      // the update, never the value of a field inside it.
      if (
        result.success &&
        result.data !== undefined &&
        result.data !== null &&
        result.data.branch !== undefined &&
        result.data.branch !== null &&
        result.data.files !== undefined &&
        result.data.files !== null
      ) {
        this.applyGitInfo(result.data, workspaceAtFetchTime);
      } else {
        this.markReadFailed(readFailureReason(result.success, result.error));
      }
    } catch {
      // degradation-audit: reported - a thrown transport failure is published
      // through `staleReason` when last good data exists; without it the
      // service stays in its "no data" state rather than inventing a repo.
      if (isCurrent()) this.markReadFailed('error');
    } finally {
      if (generation === this.fetchGeneration) {
        this._isLoading.set(false);
      }
    }
  }

  /**
   * The active workspace's `git:info` read failed before any git result
   * arrived (transport failure, renderer timeout or malformed payload). Keep
   * its last good data and mark it stale with `reason`; with no last good
   * data, leave the current state alone — a failed read proves nothing about
   * the repository, so it must not be shown as "not a Git repository" nor as
   * a repository with a clean tree (TASK_2026_576 RC3).
   *
   * The cache entry's `fetchedAt` is cleared: the kept data is known to be
   * out of date, so a switch back must read again instead of skipping the
   * fetch as fresh.
   */
  private markReadFailed(reason: GitStatusUnavailableReason): void {
    const active = this._activeWorkspacePath();
    const previous = this.currentSnapshot();
    if (!active || !hasLastGoodData(previous)) return;
    const stale: GitWorkspaceSnapshot = {
      ...previous,
      statusUnavailable: reason,
      staleReason: reason,
    };
    this.setSignals(stale);
    this._workspaceGitState.set(active, { ...stale, lastUpdated: Date.now() });
  }

  /**
   * Save current signal values into the workspace state map.
   *
   * @param fetchedAt When supplied, stamps the entry's data-freshness marker
   *   (fresh backend data just arrived). When omitted, the previous
   *   `fetchedAt` is preserved so a plain save-on-switch does not make stale
   *   data look freshly fetched.
   */
  private saveCurrentState(fetchedAt?: number): void {
    const activePath = this._activeWorkspacePath();
    if (!activePath) return;

    const existing = this._workspaceGitState.get(activePath);
    this._workspaceGitState.set(activePath, {
      ...this.currentSnapshot(),
      lastUpdated: Date.now(),
      fetchedAt: fetchedAt ?? existing?.fetchedAt,
    });
  }
}
