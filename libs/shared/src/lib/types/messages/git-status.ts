import type { GitInfoResult } from '../rpc/rpc-git.types';

/**
 * Discrete kinds of git/workspace mutations the backend watcher can detect.
 *
 * Frontend consumers filter on these to skip redundant RPC re-fetches. The
 * mapping mirrors the watched paths in `GitWatcherService`:
 *
 *   'head'      → .git/HEAD, .git/ORIG_HEAD          (branch switch / new commit)
 *   'index'     → .git/index                         (stage / unstage)
 *   'refs'      → .git/refs/, .git/packed-refs,
 *                 .git/FETCH_HEAD                    (branch / tag / remote moves)
 *   'refs-stash'→ .git/refs/stash                    (stash push / pop)
 *   'workspace' → any non-.git file in the workspace (working-tree edit)
 *   'initial'   → first push after watcher start, or
 *                 any push where the cause is unknown
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
}
