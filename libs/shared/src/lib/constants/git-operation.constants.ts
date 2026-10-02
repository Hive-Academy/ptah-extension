/**
 * Git operation timing and wording shared by the backend and the renderer, so
 * the two sides never disagree about how long a git call may take or how a
 * lock failure reads (TASK_2026_576).
 */

/**
 * Backend timeout for commands that run git hooks: commit, checkout/switch,
 * stash apply/pop, merge/rebase/cherry-pick continue and abort, pull and push
 * (pre-push and post-merge hooks run on push and pull).
 */
export const GIT_HOOK_TIMEOUT_MS = 600_000;

/** Backend timeout for `git fetch`. */
export const GIT_FETCH_TIMEOUT_MS = 300_000;

/**
 * Extra time a renderer RPC call waits beyond the backend's own git timeout,
 * so the backend's timeout (and its typed result) always arrives first.
 */
export const GIT_RPC_TIMEOUT_MARGIN_MS = 15_000;

/**
 * Backoff between retries of a mutation that failed on `index.lock`:
 * five retries, 3,100 ms in total.
 */
export const GIT_INDEX_LOCK_RETRY_DELAYS_MS = [
  100, 200, 400, 800, 1600,
] as const;

/**
 * The only user-facing text for a `LOCKED` failure. Raw git stderr is never
 * shown for it.
 */
export const GIT_LOCKED_MESSAGE =
  'Another git process is using this repository.';

/**
 * Largest diff side, in bytes, the backend ships to the renderer. A bigger
 * side is reported as `too-large` with its size and no content. The same
 * 2 MiB as `FILE_VIEW_MAX_BYTES`: one rule for the largest file the renderer
 * receives.
 */
export const GIT_DIFF_MAX_SIDE_BYTES = 2 * 1024 * 1024;

/** Renderer RPC timeout for a git call whose backend timeout is `backendMs`. */
export function gitRpcTimeoutFor(backendMs: number): number {
  return backendMs + GIT_RPC_TIMEOUT_MARGIN_MS;
}
