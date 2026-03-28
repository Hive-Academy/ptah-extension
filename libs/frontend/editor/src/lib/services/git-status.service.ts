import {
  Injectable,
  inject,
  signal,
  computed,
  DestroyRef,
  NgZone,
} from '@angular/core';
import { VSCodeService } from '@ptah-extension/core';
import type {
  GitInfoResult,
  GitBranchInfo,
  GitFileStatus,
} from '@ptah-extension/shared';
import { rpcCall } from './rpc-call.util';

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

/**
 * GitStatusService - Polls git:info RPC and exposes reactive signals for git state.
 *
 * Complexity Level: 2 (Medium - signal-based state, RPC communication, workspace partitioning, polling)
 * Patterns: Injectable service, workspace-partitioned Map (matching EditorService), correlationId RPC
 *
 * Responsibilities:
 * - Poll git:info RPC at 5s intervals (paused when window loses focus)
 * - Expose branch info, file statuses, and derived computed signals
 * - Maintain per-workspace state cache for instant workspace switching
 * - Provide fileStatusMap (Map<relativePath, GitFileStatus>) for O(1) lookups by FileTreeNodeComponent
 *
 * Communication: Uses MESSAGE_TYPES.RPC_CALL / RPC_RESPONSE with correlationId matching.
 */
@Injectable({ providedIn: 'root' })
export class GitStatusService {
  private readonly vscodeService = inject(VSCodeService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly ngZone = inject(NgZone);

  // ============================================================================
  // WORKSPACE STATE
  // ============================================================================

  /**
   * Map of workspace path to git state. Contains cached git state
   * for all workspaces (active and background) so switching back is instant.
   */
  private readonly _workspaceGitState = new Map<string, GitWorkspaceState>();

  /** Currently active workspace path. Null when no workspace is active. */
  private _activeWorkspacePath: string | null = null;

  // ============================================================================
  // POLLING STATE
  // ============================================================================

  private _pollIntervalId: ReturnType<typeof setInterval> | null = null;
  private _isFocused = true;

  // ============================================================================
  // SIGNAL STATE
  // ============================================================================

  private readonly _branch = signal<GitBranchInfo>(EMPTY_BRANCH);
  private readonly _files = signal<GitFileStatus[]>([]);
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
  get activeWorkspacePath(): string | null {
    return this._activeWorkspacePath;
  }

  constructor() {
    this.setupFocusListeners();
    this.destroyRef.onDestroy(() => this.stopPolling());
  }

  // ============================================================================
  // WORKSPACE OPERATIONS
  // ============================================================================

  /**
   * Switch git state to a different workspace.
   * Saves current state, restores target from cache or resets to defaults.
   * Triggers an immediate git:info fetch for the new workspace.
   *
   * Called by WorkspaceCoordinatorService when the active workspace changes.
   */
  switchWorkspace(workspacePath: string): void {
    if (this._activeWorkspacePath === workspacePath) return;

    // Save current workspace state to map
    this.saveCurrentState();
    this._activeWorkspacePath = workspacePath;

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
    if (this._activeWorkspacePath === workspacePath) {
      this._activeWorkspacePath = null;
      this._branch.set(EMPTY_BRANCH);
      this._files.set([]);
      this._isGitRepo.set(false);
    }
  }

  // ============================================================================
  // POLLING
  // ============================================================================

  /**
   * Start polling git:info at 5s intervals.
   * Called when the editor panel becomes visible.
   * Skips poll ticks when window is blurred or no active workspace.
   */
  startPolling(): void {
    if (this._pollIntervalId !== null) return;

    // Immediate first fetch
    this.fetchGitInfo();

    this.ngZone.runOutsideAngular(() => {
      this._pollIntervalId = setInterval(() => {
        if (this._isFocused && this._activeWorkspacePath) {
          this.ngZone.run(() => this.fetchGitInfo());
        }
      }, 5000);
    });
  }

  /**
   * Stop polling. Called when editor panel is hidden or service is destroyed.
   */
  stopPolling(): void {
    if (this._pollIntervalId !== null) {
      clearInterval(this._pollIntervalId);
      this._pollIntervalId = null;
    }
  }

  // ============================================================================
  // PRIVATE: RPC + STATE
  // ============================================================================

  /**
   * Fetch git info via RPC for the active workspace.
   * Updates signals and saves to workspace state map on success.
   */
  private async fetchGitInfo(): Promise<void> {
    if (!this._activeWorkspacePath) return;

    // Capture the workspace path BEFORE the async RPC call.
    // If the user switches workspaces while the RPC is in flight,
    // we must discard the stale response to avoid corrupting the new workspace's state.
    const workspaceAtFetchTime = this._activeWorkspacePath;

    this._isLoading.set(true);

    const result = await rpcCall<GitInfoResult>(
      this.vscodeService,
      'git:info',
      {},
    );

    // Discard stale response: workspace changed during the RPC call
    if (this._activeWorkspacePath !== workspaceAtFetchTime) {
      return;
    }

    if (result.success && result.data) {
      this._branch.set(result.data.branch);
      this._files.set(result.data.files);
      this._isGitRepo.set(result.data.isGitRepo);
      this.saveCurrentState();
    }

    this._isLoading.set(false);
  }

  /**
   * Save current signal values into the workspace state map.
   */
  private saveCurrentState(): void {
    if (!this._activeWorkspacePath) return;

    this._workspaceGitState.set(this._activeWorkspacePath, {
      branch: this._branch(),
      files: this._files(),
      isGitRepo: this._isGitRepo(),
      lastUpdated: Date.now(),
    });
  }

  /**
   * Set up focus/blur listeners to pause polling when the window loses focus.
   * Registered with DestroyRef for automatic cleanup.
   */
  private setupFocusListeners(): void {
    const onFocus = () => {
      this._isFocused = true;
    };
    const onBlur = () => {
      this._isFocused = false;
    };

    window.addEventListener('focus', onFocus);
    window.addEventListener('blur', onBlur);

    this.destroyRef.onDestroy(() => {
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('blur', onBlur);
    });
  }
}
