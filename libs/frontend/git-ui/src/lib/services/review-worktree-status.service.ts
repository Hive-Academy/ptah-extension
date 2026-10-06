import { Injectable, inject, signal } from '@angular/core';
import { VSCodeService, rpcCall } from '@ptah-extension/core';
import type {
  GitFileStatus,
  GitInfoParams,
  GitInfoResult,
} from '@ptah-extension/shared';
import { ReviewDiffService } from './review-diff.service';

/** One read of a worktree that is not the active workspace. */
export interface ReviewWorktreeStatus {
  /** The worktree root the read is for, as the scope names it. */
  readonly root: string;
  readonly loading: boolean;
  /** The checked-out branch, or `null` before a read lands (or detached). */
  readonly branch: string | null;
  readonly files: readonly GitFileStatus[];
  /** Why the read failed, or `null`. */
  readonly error: string | null;
}

const READ_FAILED_MESSAGE = 'Git status could not be read for this worktree.';
const NOT_AVAILABLE_MESSAGE =
  'This worktree is not available. It may have been removed, or it does not belong to an open workspace.';

/**
 * ReviewWorktreeStatusService — `git status` for the read-only worktree
 * scope: a worktree that is not the active workspace, read once per
 * {@link load} through `git:info { workspaceRoot }` (the backend accepts a
 * registered worktree of an open folder's repository for this read only).
 *
 * It is deliberately separate from `GitStatusService`, which owns the active
 * workspace, its pushes and its header: viewing a worktree never changes
 * those. No watcher covers the worktree, so nothing here refreshes on its
 * own; opening the change set again reads it again — its status here, and
 * its cached diffs through {@link ReviewDiffService.invalidateRoot}.
 */
@Injectable({ providedIn: 'root' })
export class ReviewWorktreeStatusService {
  private readonly vscode = inject(VSCodeService);
  private readonly reviewDiff = inject(ReviewDiffService);

  private readonly _status = signal<ReviewWorktreeStatus | null>(null);
  /** Bumped per load and on clear, so only the latest read lands. */
  private generation = 0;

  /** The latest read, or `null` while no worktree is viewed. */
  readonly status = this._status.asReadonly();

  /** Read `root`'s status, keeping the previous files of the same root on screen. */
  async load(root: string): Promise<void> {
    const ticket = ++this.generation;
    // Diffs cached the last time this worktree was viewed may be stale.
    this.reviewDiff.invalidateRoot(root);
    const previous = this._status();
    const same = previous?.root === root;
    this._status.set({
      root,
      loading: true,
      branch: same ? previous.branch : null,
      files: same ? previous.files : [],
      error: null,
    });

    let next: ReviewWorktreeStatus;
    try {
      const response = await rpcCall<GitInfoResult>(this.vscode, 'git:info', {
        workspaceRoot: root,
      } satisfies GitInfoParams);
      next = this.toStatus(root, response.success ? response.data : undefined);
    } catch (error: unknown) {
      console.error('[ReviewWorktreeStatusService] git:info threw', error);
      next = this.failed(root, READ_FAILED_MESSAGE);
    }
    if (ticket === this.generation) this._status.set(next);
  }

  /** No worktree is viewed any more; a read still in flight is dropped. */
  clear(): void {
    this.generation++;
    this._status.set(null);
  }

  private toStatus(
    root: string,
    data: GitInfoResult | null | undefined,
  ): ReviewWorktreeStatus {
    if (!data || !Array.isArray(data.files) || !data.branch) {
      return this.failed(root, READ_FAILED_MESSAGE);
    }
    if (data.statusUnavailable !== undefined) {
      return this.failed(root, READ_FAILED_MESSAGE);
    }
    // The backend answers a root it does not accept with the non-git default.
    if (!data.isGitRepo) return this.failed(root, NOT_AVAILABLE_MESSAGE);
    return {
      root,
      loading: false,
      branch: data.branch.branch || null,
      files: data.files,
      error: null,
    };
  }

  private failed(root: string, error: string): ReviewWorktreeStatus {
    const previous = this._status();
    return {
      root,
      loading: false,
      branch: previous?.root === root ? previous.branch : null,
      files: [],
      error,
    };
  }
}
