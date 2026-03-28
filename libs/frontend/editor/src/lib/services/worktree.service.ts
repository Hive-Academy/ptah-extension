import { Injectable, inject, signal, computed } from '@angular/core';
import { VSCodeService, ElectronLayoutService } from '@ptah-extension/core';
import type {
  GitWorktreeInfo,
  GitWorktreesResult,
  GitAddWorktreeResult,
  GitRemoveWorktreeResult,
} from '@ptah-extension/shared';
import { rpcCall } from './rpc-call.util';

/**
 * WorktreeService - Manages git worktree operations and workspace folder registration.
 *
 * Complexity Level: 2 (Medium - signal-based state, RPC communication, layout integration)
 * Patterns: Injectable service, signal-based state, correlationId RPC
 *
 * Responsibilities:
 * - List worktrees via git:worktrees RPC
 * - Add new worktrees via git:addWorktree RPC and auto-register as workspace folders
 * - Remove worktrees via git:removeWorktree RPC and unregister workspace folders
 *
 * Communication: Uses MESSAGE_TYPES.RPC_CALL / RPC_RESPONSE with correlationId matching.
 */
@Injectable({ providedIn: 'root' })
export class WorktreeService {
  private readonly vscodeService = inject(VSCodeService);
  private readonly layoutService = inject(ElectronLayoutService);

  // ============================================================================
  // SIGNAL STATE
  // ============================================================================

  private readonly _worktrees = signal<GitWorktreeInfo[]>([]);
  private readonly _isLoading = signal(false);

  /** All worktrees for the current repository. */
  readonly worktrees = this._worktrees.asReadonly();

  /** Whether a worktree RPC call is in flight. */
  readonly isLoading = this._isLoading.asReadonly();

  /** Number of active worktrees. */
  readonly worktreeCount = computed(() => this._worktrees().length);

  // ============================================================================
  // PUBLIC API
  // ============================================================================

  /**
   * Fetch the list of worktrees via git:worktrees RPC and update the signal.
   * Called by GitStatusBarComponent on init to populate the worktree indicator.
   */
  async loadWorktrees(): Promise<void> {
    this._isLoading.set(true);

    const result = await rpcCall<GitWorktreesResult>(
      this.vscodeService,
      'git:worktrees',
      {},
    );

    if (result.success && result.data) {
      this._worktrees.set(result.data.worktrees);
    }

    this._isLoading.set(false);
  }

  /**
   * Add a new worktree via git:addWorktree RPC.
   * On success, auto-registers the new worktree directory as a workspace folder
   * via ElectronLayoutService so the user can immediately work in it.
   *
   * @param branch - Branch name to checkout in the new worktree
   * @param options - Optional path override and create-new-branch flag
   * @returns Success/failure result with optional error message
   */
  async addWorktree(
    branch: string,
    options?: { path?: string; createBranch?: boolean },
  ): Promise<{ success: boolean; error?: string }> {
    this._isLoading.set(true);

    const result = await rpcCall<GitAddWorktreeResult>(
      this.vscodeService,
      'git:addWorktree',
      {
        branch,
        path: options?.path,
        createBranch: options?.createBranch,
      },
    );

    if (result.success && result.data?.success && result.data.worktreePath) {
      // Auto-register the new worktree as a workspace folder
      this.layoutService.addFolderByPath(result.data.worktreePath);

      // Refresh the worktree list to include the new entry
      await this.loadWorktrees();
      this._isLoading.set(false);

      return { success: true };
    }

    const error =
      result.data?.error || result.error || 'Failed to add worktree';
    this._isLoading.set(false);

    return { success: false, error };
  }

  /**
   * Remove a worktree via git:removeWorktree RPC.
   * On success, removes the worktree from the local list. The workspace folder
   * removal is handled separately by the user or layout service.
   *
   * @param path - Absolute path of the worktree to remove
   * @param force - Whether to force removal (--force flag)
   * @returns Success/failure result with optional error message
   */
  async removeWorktree(
    path: string,
    force?: boolean,
  ): Promise<{ success: boolean; error?: string }> {
    this._isLoading.set(true);

    const result = await rpcCall<GitRemoveWorktreeResult>(
      this.vscodeService,
      'git:removeWorktree',
      { path, force },
    );

    if (result.success && result.data?.success) {
      // Remove from local list immediately for responsive UI
      this._worktrees.update((worktrees) =>
        worktrees.filter((w) => w.path !== path),
      );
      this._isLoading.set(false);

      return { success: true };
    }

    const error =
      result.data?.error || result.error || 'Failed to remove worktree';
    this._isLoading.set(false);

    return { success: false, error };
  }
}
