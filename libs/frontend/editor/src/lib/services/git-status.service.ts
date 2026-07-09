import {
  Injectable,
  inject,
  signal,
  computed,
  DestroyRef,
} from '@angular/core';
import { VSCodeService, rpcCall } from '@ptah-extension/core';
import type {
  GitInfoResult,
  GitBranchInfo,
  GitFileStatus,
  GitStatusUpdatePayload,
} from '@ptah-extension/shared';

/**
 * Per-workspace git state snapshot.
 * Cached in the workspace map so switching back is instant.
 */
interface GitWorkspaceState {
  branch: GitBranchInfo;
  files: GitFileStatus[];
  isGitRepo: boolean;
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
      a[i].isDirectory !== b[i].isDirectory
    )
      return false;
  }
  return true;
}

@Injectable({ providedIn: 'root' })
export class GitStatusService {
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
  private _messageHandler: ((event: MessageEvent) => void) | null = null;

  private readonly _activeWorkspacePath = signal<string | null>(null);
  private readonly _branch = signal<GitBranchInfo>(EMPTY_BRANCH, {
    equal: branchEqual,
  });
  private readonly _files = signal<GitFileStatus[]>([], { equal: filesEqual });
  private readonly _isGitRepo = signal(false);
  private readonly _isLoading = signal(false);

  /** Current branch info for the active workspace. */
  readonly branch = this._branch.asReadonly();

  /** All changed files in the active workspace. */
  readonly files = this._files.asReadonly();

  /** Whether the active workspace is inside a git repository. */
  readonly isGitRepo = this._isGitRepo.asReadonly();

  /** Whether a git:info RPC call is currently in flight. */
  readonly isLoading = this._isLoading.asReadonly();

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

  /**
   * Map<relativePath, GitFileStatus[]> for O(1) lookup by FileTreeNodeComponent.
   * Keys are relative paths from workspace root (as reported by git status --porcelain=v2).
   * Values are arrays because a file can have both staged and unstaged changes
   * (e.g., staged 'M' and unstaged 'M' for a partially staged file).
   */
  readonly fileStatusMap = computed(() => {
    const map = new Map<string, GitFileStatus[]>();
    for (const file of this._files()) {
      const existing = map.get(file.path);
      if (existing) {
        existing.push(file);
      } else {
        map.set(file.path, [file]);
      }
    }
    return map;
  });

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
    if (cached) {
      this._branch.set(cached.branch);
      this._files.set(cached.files);
      this._isGitRepo.set(cached.isGitRepo);
    } else {
      this._branch.set(EMPTY_BRANCH);
      this._files.set([]);
      this._isGitRepo.set(false);
    }

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
    }
  }

  /**
   * Remove cached git state for a workspace.
   * Called when a workspace folder is removed from the layout.
   */
  removeWorkspaceState(workspacePath: string): void {
    this._workspaceGitState.delete(workspacePath);
    if (this._activeWorkspacePath() === workspacePath) {
      this._activeWorkspacePath.set(null);
      this._branch.set(EMPTY_BRANCH);
      this._files.set([]);
      this._isGitRepo.set(false);
    }
  }

  /**
   * Start listening for git:status-update push events from the backend.
   * Also performs an initial RPC fetch to populate state immediately.
   */
  startListening(): void {
    if (this._isListening) return;
    this._isListening = true;
    this._messageHandler = (event: MessageEvent) => {
      const data = event.data;
      if (data?.type === 'git:status-update' && data.payload) {
        const payload = data.payload as GitStatusUpdatePayload;
        this.applyGitInfo(payload, payload.workspaceRoot ?? null);
      }
    };
    window.addEventListener('message', this._messageHandler);
    this.fetchGitInfo();
  }

  /**
   * Stop listening for push events.
   * Called when editor panel is hidden or service is destroyed.
   */
  stopListening(): void {
    this._isListening = false;

    if (this._messageHandler) {
      window.removeEventListener('message', this._messageHandler);
      this._messageHandler = null;
    }
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
   */
  private applyGitInfo(
    data: GitInfoResult,
    workspaceRoot: string | null,
  ): void {
    const active = this._activeWorkspacePath();
    const target = workspaceRoot ?? active;
    if (!target) return;

    if (target === active) {
      this._branch.set(data.branch);
      this._files.set(data.files);
      this._isGitRepo.set(data.isGitRepo);
      // Fresh data just arrived for the active workspace — stamp fetchedAt.
      this.saveCurrentState(Date.now());
    } else {
      this._workspaceGitState.set(target, {
        branch: data.branch,
        files: data.files,
        isGitRepo: data.isGitRepo,
        lastUpdated: Date.now(),
        fetchedAt: Date.now(),
      });
    }
  }

  /**
   * Fetch git info via RPC for the active workspace (on-demand).
   * Used for initial load and workspace switches only — not periodic polling.
   */
  private async fetchGitInfo(): Promise<void> {
    const workspaceAtFetchTime = this._activeWorkspacePath();
    if (!workspaceAtFetchTime) return;

    this._isLoading.set(true);

    const result = await rpcCall<GitInfoResult>(
      this.vscodeService,
      'git:info',
      { workspaceRoot: workspaceAtFetchTime },
    );

    if (this._activeWorkspacePath() !== workspaceAtFetchTime) {
      return;
    }

    if (result.success && result.data?.branch && result.data.files) {
      this.applyGitInfo(result.data, workspaceAtFetchTime);
    }

    this._isLoading.set(false);
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
      branch: this._branch(),
      files: this._files(),
      isGitRepo: this._isGitRepo(),
      lastUpdated: Date.now(),
      fetchedAt: fetchedAt ?? existing?.fetchedAt,
    });
  }
}
