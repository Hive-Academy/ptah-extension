/**
 * The canonical "are these two strings the same open folder" key.
 *
 * Moved here from `apps/ptah-electron/src/activation/workspace-root-key.ts`
 * (TASK_2026_364) because a THIRD consumer now needs it: the Electron boot
 * latch, the user-layer job coalescer, and the agent-surface workspace scoping
 * in `cli-agent-runtime` (`AgentProcessManager.getStatus`) must all agree on
 * what "the same workspace" means — or two spellings of one directory count as
 * two workspaces.
 *
 * This is deliberately NOT `normalizeWorkspaceRoot` from `platform-core` /
 * `task-specs`: those answer "what is the real root of this path" (they resolve
 * and keep case), while this answers "are these two strings the same open
 * folder" and must therefore fold case and separators. Same words, different
 * question.
 */

/**
 * Key for "no folder open".
 *
 * Cannot collide with any real key: {@link normalizeWorkspaceRoot} only ever
 * returns this constant or a lowercased ABSOLUTE path, and no absolute path
 * begins with `::` on either platform.
 *
 * This was a literal NUL byte until TASK_2026_331 B7. It worked, but a raw
 * `\0` makes git classify the whole file as binary — no diffs, no merges, and
 * the format hook skips it — and the byte was invisible in every editor view,
 * so nothing surfaced it. A control character is still a legitimate choice here
 * — write it as a unicode escape in the source, never as the raw byte.
 */
export const NO_WORKSPACE_KEY = '::no-workspace';

/**
 * Normalized key for a workspace root.
 *
 * Callers key per-root work by this rather than by the raw string, because the
 * same directory arrives spelled differently — separator and case differ on
 * Windows between a startup root, a renderer echo, and an agent's recorded
 * working directory. Two spellings of one directory must land on one key.
 *
 * `undefined` (no folder open) is its own key: it is a real, distinct state,
 * not a missing value.
 */
export function normalizeWorkspaceRoot(root: string | undefined): string {
  if (root === undefined) return NO_WORKSPACE_KEY;
  return root
    .replace(/[\\/]+$/, '')
    .replace(/\\/g, '/')
    .toLowerCase();
}
