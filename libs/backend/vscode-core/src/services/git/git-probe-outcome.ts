import type { GitWorktreeInfo } from '@ptah-extension/shared';

/**
 * One `git worktree list` read. `failed` is a timeout, queue deadline, spawn
 * error or a non-zero exit that is not "not a repository". An empty `listed`
 * result is a confirmed answer (this folder has no worktrees).
 */
export type WorktreeListRead =
  | { readonly kind: 'listed'; readonly worktrees: readonly GitWorktreeInfo[] }
  | { readonly kind: 'not-a-repo' }
  | { readonly kind: 'failed'; readonly cause: Error };

/**
 * One `rev-parse --git-common-dir` read. `not-a-repo` is git's own answer.
 * `failed` is a timeout or other probe error and must not be stored as
 * "not a worktree".
 */
export type CommonDirRead =
  | { readonly kind: 'dir'; readonly path: string }
  | { readonly kind: 'not-a-repo' }
  | { readonly kind: 'failed'; readonly cause: Error };

export function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

/** git's C-locale "not a repository" failure (`LC_ALL=C` is pinned on exec). */
export function isNotAGitRepository(exitCode: number, stderr: string): boolean {
  return exitCode === 128 && /not a git repository/i.test(stderr);
}
