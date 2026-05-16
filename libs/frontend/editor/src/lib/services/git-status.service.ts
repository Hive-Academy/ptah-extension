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
} from '@ptah-extension/shared';

/**
 * Per-workspace git state snapshot.
 * Cached in the workspace map so switching back is instant.
 */
interface GitWorkspaceState {
  branch: GitBranchInfo;
  files: GitFileStatus[];
  isGitRepo: boolean;
  lastUpdated: number;
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

  // ============================================================================
  // WORKSPACE STATE
  // ============================================================================

  private readonly _workspaceGitState = new Map<string, GitWorkspaceState>();

  // ============================================================================
  // LISTENER STATE
  // ============================================================================

  private _isListening = false;
  private _messageHandler: ((event: MessageEvent) => void) | null = null;

  // ============================================================================
  // SIGNAL STATE
  // ============================================================================

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

  // ============================================================================
  // COMPUTED SIGNALS
  // ============================================================================

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

  // ============================================================================
  // WORKSPACE OPERATIONS
  // ============================================================================

  /**
   * Switch git state to a different workspace.
   * Saves current state, restores target from cache or resets to defaults.
   * Triggers an immediate git:info fetch for the new workspace.
   */
  switchWorkspace(workspacePath: string): void {
    if (this._activeWorkspacePath() === workspacePath) return;

    // Save current workspace state to map
    this.saveCurrentState();
    this._activeWorkspacePath.set(workspacePath);

    // Restore cached state or reset to defaults
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

    // Immediately fetch fresh data for the new workspace
    this.fetchGitInfo();
  }

  /**
   * Remove cached git state for a workspace.
   * Called when a workspace folder is removed from the layout.
   */
  removeWorkspaceState(workspacePath: string): void {
    this._workspaceGitState.delete(workspacePath);

    // If the removed workspace was active, clear signals
    if (this._activeWorkspacePath() === workspacePath) {
      this._activeWorkspacePath.set(null);
      this._branch.set(EMPTY_BRANCH);
      this._files.set([]);
      this._isGitRepo.set(false);
    }
  }

  // ============================================================================
  // EVENT LISTENING (replaces polling)
  // ============================================================================

  /**
   * Start listening for git:status-update push events from the backend.
   * Also performs an initial RPC fetch to populate state immediately.
   */
  startListening(): void {
    if (this._isListening) return;
    this._isListening = true;

    // Listen for push events from the backend git watcher
    this._messageHandler = (event: MessageEvent) => {
      const data = event.data;
      if (data?.type === 'git:status-update' && data.payload) {
        this.applyGitInfo(data.payload as GitInfoResult);
      }
    };
    window.addEventListener('message', this._messageHandler);

    // Initial fetch to populate state immediately (the watcher may not have
    // pushed yet, or we may be on VS Code where there's no watcher).
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

  // ============================================================================
  // PRIVATE: RPC + STATE
  // ============================================================================

  /**
   * Apply a git info result to the current signals and cache.
   * Used by both push events and on-demand RPC responses.
   */
  private applyGitInfo(data: GitInfoResult): void {
    this._branch.set(data.branch);
    this._files.set(data.files);
    this._isGitRepo.set(data.isGitRepo);
    this.saveCurrentState();
  }

  /**
   * Fetch git info via RPC for the active workspace (on-demand).
   * Used for initial load and workspace switches only — not periodic polling.
   */
  private async fetchGitInfo(): Promise<void> {
    if (!this._activeWorkspacePath()) return;

    const workspaceAtFetchTime = this._activeWorkspacePath();

    this._isLoading.set(true);

    const result = await rpcCall<GitInfoResult>(
      this.vscodeService,
      'git:info',
      {},
    );

    if (this._activeWorkspacePath() !== workspaceAtFetchTime) {
      return;
    }

    if (result.success && result.data) {
      this.applyGitInfo(result.data);
    }

    this._isLoading.set(false);
  }

  /**
   * Save current signal values into the workspace state map.
   */
  private saveCurrentState(): void {
    if (!this._activeWorkspacePath()) return;

    this._workspaceGitState.set(this._activeWorkspacePath()!, {
      branch: this._branch(),
      files: this._files(),
      isGitRepo: this._isGitRepo(),
      lastUpdated: Date.now(),
    });
  }
}
