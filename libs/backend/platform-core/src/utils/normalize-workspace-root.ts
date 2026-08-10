/**
 * Canonical workspace-root key — the single source of truth for "are these two
 * strings the same workspace?".
 *
 * The same logical workspace arrives as different strings across surfaces:
 * trailing separator, `/` vs `\`, drive-letter case. Comparing or map-keying on
 * the raw string silently splits one workspace into several keys. That exact
 * bug has already shipped once in this repo (cron's `workspaceRoot` filter,
 * `TASK_WORKSPACE_SCOPING_REVIEW` issue 6), which is why every root-keyed map
 * MUST route through this helper.
 *
 * Lives in `platform-core/src/utils/` alongside `path-containment.ts`,
 * `workspace-path-guards.ts` and `shell-allowlist.ts`: pure, zero-dependency
 * path/platform predicates that several libs on both sides of the hexagon need.
 * It is NOT a port — no `PLATFORM_TOKENS` entry, no adapter, no I/O, no state.
 * The canonical implementation was promoted here from
 * `@ptah-extension/task-specs` (TASK_2026_200 task 1.1) so that
 * `workspace-intelligence` and `vscode-lm-tools` can reach it without taking a
 * dependency edge on `task-specs` → `persistence-sqlite` → `better-sqlite3`.
 * `task-specs` now re-exports this function; its public API is unchanged.
 *
 * Steps:
 *  1. `path.resolve` — absolutize + normalize separators for the host OS.
 *  2. strip a trailing separator (defensive; `resolve` already does for
 *     non-root paths, but callers may pass pre-joined strings).
 *  3. lower-case a Windows drive letter (`D:\` and `d:\` are the same root).
 *     Note: ONLY the drive letter is lower-cased — path segment case is
 *     preserved, so `D:\Foo` and `d:/Foo` match but `d:\foo` does not.
 */

import * as path from 'path';

export function normalizeWorkspaceRoot(root: string): string {
  let resolved = path.resolve(root);
  resolved = resolved.replace(/[\\/]+$/, '');
  resolved = resolved.replace(/^([a-zA-Z]):/, (_m, drive: string) => {
    return `${drive.toLowerCase()}:`;
  });
  return resolved;
}
