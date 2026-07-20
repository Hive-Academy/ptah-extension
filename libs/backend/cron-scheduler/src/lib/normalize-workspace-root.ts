import * as path from 'node:path';

/**
 * Canonical workspace-root key for the cron pipeline.
 *
 * A job's `workspace_root` is stamped raw from the renderer at create/update
 * time, but the same logical workspace can arrive as different strings across
 * sessions (trailing separator, `/` vs `\`, drive-letter case). Filtering the
 * "This workspace" view on a byte-exact comparison silently hides jobs whose
 * stored form differs from the list-time form. Normalizing both the stored
 * value (on write) and the filter value + each candidate row (on read) makes
 * the comparison operate on a single canonical key regardless of arrival form.
 *
 * This mirrors `@ptah-extension/task-specs`'s `normalizeWorkspaceRoot` exactly.
 * It is duplicated here on purpose: cron-scheduler is a generic, low-level lib
 * and must not depend on the task-management feature lib just to borrow a pure
 * path helper (that would invert the dependency direction). Keep the two in
 * lockstep if either changes.
 *
 * Steps:
 *  1. `path.resolve` — absolutize + normalize separators for the host OS.
 *  2. strip a trailing separator (defensive; `resolve` already does for
 *     non-root paths, but callers may pass pre-joined strings).
 *  3. lower-case a Windows drive letter (`D:\` and `d:\` are the same root).
 *     Note: only the drive letter is lower-cased — path segment case is
 *     preserved, so `D:\Foo` and `d:/Foo` match but `d:\foo` does not.
 */
export function normalizeWorkspaceRoot(root: string): string {
  let resolved = path.resolve(root);
  resolved = resolved.replace(/[\\/]+$/, '');
  resolved = resolved.replace(/^([a-zA-Z]):/, (_m, drive: string) => {
    return `${drive.toLowerCase()}:`;
  });
  return resolved;
}
