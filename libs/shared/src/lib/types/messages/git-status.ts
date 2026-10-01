import type { GitInfoResult } from '../rpc/rpc-git.types';

/**
 * Discrete kinds of git/workspace mutations the backend watcher can detect.
 *
 * Frontend consumers filter on these to skip redundant RPC re-fetches. The
 * git-directory kinds are assigned by `classifyGitDirChange`
 * (`apps/ptah-electron/src/services/git-dir-change-classifier.ts`), which is
 * the source of truth; it is worktree-aware, so "own gitdir" is
 * `<common>/worktrees/<name>` in a linked worktree and `.git` otherwise:
 *
 *   'head'      → own gitdir HEAD, ORIG_HEAD and the in-progress-operation
 *                 pseudo-refs (MERGE_HEAD, CHERRY_PICK_HEAD, REVERT_HEAD,
 *                 REBASE_HEAD, AUTO_MERGE, rebase-merge/, rebase-apply/)
 *                 (branch switch / new commit / merge, rebase, cherry-pick)
 *   'index'     → own gitdir index                    (stage / unstage)
 *   'refs'      → own FETCH_HEAD and per-worktree refs/, common refs/
 *                 and packed-refs                     (branch / tag / remote moves)
 *   'refs-stash'→ common refs/stash                   (stash push / pop)
 *   'workspace' → any file outside the git directory  (working-tree edit)
 *   'initial'   → first push after watcher start, or
 *                 any push where the cause is unknown
 *
 * Changes under another worktree's admin directory are not a kind here: the
 * watcher handles them separately and never reports them as a status cause.
 */
export type GitChangeKind =
  | 'head'
  | 'index'
  | 'refs'
  | 'refs-stash'
  | 'workspace'
  | 'initial';

/**
 * Payload for the 'git:status-update' broadcast message.
 *
 * Extends `GitInfoResult` (which carries the porcelain branch + file status
 * the GitStatusService consumes on every event) with a `causes` set so
 * downstream consumers — GitBranchesService in particular — can decide
 * which of their N RPCs to re-issue rather than always re-fetching all
 * branches, the stash list, and the last commit.
 *
 * `causes` is optional and absence MUST be treated as "unknown — refresh
 * everything" so consumers stay correct against older backends.
 */
export interface GitStatusUpdatePayload extends GitInfoResult {
  /** Distinct change kinds coalesced during the watcher debounce window. */
  causes?: readonly GitChangeKind[];
  /**
   * Absolute path of the workspace folder this status was computed for.
   * Consumers MUST route the payload by this field instead of attributing
   * it to whatever workspace is currently active — with multiple workspace
   * folders open, pushes for a newly-activated folder can arrive while the
   * frontend still displays the previous one. Absent only on payloads from
   * older backends; treat absence as "active workspace".
   */
  workspaceRoot?: string;
}
