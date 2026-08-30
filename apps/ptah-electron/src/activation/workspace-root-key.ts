/**
 * The canonical key for a workspace root inside the Electron activation phase.
 *
 * Extracted from `boot-heavy-services.ts` in TASK_2026_345 because a SECOND
 * per-root latch now needs it — the user-layer job coalescer in
 * `plugin-activation.ts`. The two must agree on what "the same workspace" means
 * or the coalescer would let a boot and a folder-change propagation run the
 * identical pass concurrently under two spellings of one directory, which is
 * exactly the defect this task exists to close.
 *
 * It lives in its own module rather than in either caller because
 * `boot-heavy-services.ts` imports `plugin-activation.ts`; putting the key
 * function in the former and importing it from the latter would make that a
 * cycle.
 *
 * This is deliberately NOT `normalizeWorkspaceRoot` from `platform-core` /
 * `task-specs`: those answer "what is the real root of this path" (they resolve
 * and keep case), while this answers "are these two strings the same open
 * folder" and must therefore fold case and separators. Same words, different
 * question.
 */

/**
 * Latch key for "no folder open".
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
 * Normalized latch key for a workspace root.
 *
 * The one-shot boot is keyed by this rather than by the raw string, because the
 * startup root and the root the renderer echoes back through `workspace:switch`
 * differ by separator and case on Windows. Two spellings of the same directory
 * must join one boot, not start two.
 *
 * `undefined` (no folder open) is its own key: it is a real, distinct boot
 * state, not a missing value.
 */
export function normalizeWorkspaceRoot(root: string | undefined): string {
  if (root === undefined) return NO_WORKSPACE_KEY;
  return root
    .replace(/[\\/]+$/, '')
    .replace(/\\/g, '/')
    .toLowerCase();
}
