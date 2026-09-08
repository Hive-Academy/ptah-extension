/**
 * Workspace scan exclusions — the single source of truth for "should a
 * filesystem write under this name schedule a `git status` refresh".
 *
 * There used to be two named sets answering two different questions:
 * `TREE_HIDDEN_DIRS` gated what the file-explorer tree walk rendered (a
 * user-visible decision), and `WATCH_IGNORED_DIRS` — a strict superset —
 * gated the workspace watcher (an invisible one). The explorer is gone
 * (`libs/frontend/editor` and its RPC surface, `EditorRpcHandlers`, deleted in
 * TASK_2026_385 Phase 4), so there is only one question left, and one set.
 *
 * **Conservatism was a correctness requirement while the explorer used this
 * set: an over-broad name hid a directory the user wanted to see.** That cost
 * is gone. With no tree rendering off this set, the only remaining cost of an
 * over-broad name is a missed `git status` refresh — invisible, and never
 * data loss. `coverage` and `tmp` are included on that basis: both are
 * conventionally git-ignored build/test output, so the corresponding risk —
 * failing to notice a change under one — is low, and worth taking for one
 * fewer noisy refresh per test run or coverage pass.
 *
 * `out`, `build`, `.next` and `.turbo` remain deliberately excluded from this
 * set: each is a plausible *source* directory in a real project (a Next.js
 * `out` export, a hand-rolled `build/`), so the evidence bar for adding one is
 * still "it can never hold source", not "it is usually generated". Do not add
 * a name here without that evidence.
 *
 * Zero-dependency by construction: no `path`, no `fs`, no Node built-ins. This
 * module is compiled into the VS Code extension host, the Electron main
 * process and the headless CLI alike.
 */

/**
 * Directory names the workspace watcher ignores when deciding whether a
 * file-system event should schedule a `git status` refresh.
 *
 * The set below is the historical `TREE_HIDDEN_DIRS ∪ WATCH_IGNORED_DIRS`
 * union — nothing either set covered before this collapse is missing — plus
 * `coverage` and `tmp`, the two genuinely new names (see the module doc for
 * why). `.angular`, the Angular CLI's build cache, was the original watch-only
 * addition: a high-frequency churn source during any webview build that git
 * never reports on (it is `.gitignore`d), so excluding it can never cause a
 * real change to be missed.
 *
 * **That last clause is verified, not inferred.** Because the predicate below
 * matches at every path segment rather than only at the root, the safety
 * argument has to hold for a nested `.angular/` too — otherwise a tracked
 * change under one would silently never reach `git status`, which is exactly
 * the R-9 defect class this module exists to avoid. Checked directly against
 * this repo: the root `.gitignore` entry (line 51) is the bare token
 * `.angular` — no leading slash and no internal slash — which git treats as
 * *unanchored*, matching a directory of that name at any depth. Confirmed with
 * `git check-ignore -v`, which resolves `.angular/x`,
 * `libs/frontend/editor/.angular/cache/y`, `apps/ptah-electron/.angular/z` and
 * `some/deep/nested/pkg/.angular/w` all to the same `.gitignore:51` rule. This
 * repo also contains exactly one `.angular` directory today, at the root.
 */
export const WATCH_IGNORED_DIRS: ReadonlySet<string> = new Set([
  // VCS metadata
  '.git',
  '.hg',
  '.svn',
  // OS / platform noise
  '.DS_Store',
  '.Trash',
  // Generic caches and scratch space
  '.cache',
  '.tmp',
  '.temp',
  // Tooling caches
  '.nx',
  '.angular',
  // Dependency and output trees
  'node_modules',
  'dist',
  // Test/coverage output — newly added by the Phase 4 collapse
  'coverage',
  'tmp',
]);

/** Splits on both POSIX and Windows separators. Windows is the primary dev platform here. */
const PATH_SEPARATOR = /[\\/]/;

/**
 * True when any segment of `relativePath` names an excluded directory.
 *
 * Segment-level rather than prefix-level on purpose: in a monorepo the churn
 * lives at `packages/foo/node_modules/…` and `libs/bar/dist/…` just as much as
 * at the root, so testing every segment catches nested occurrences too.
 *
 * Both call shapes are supported and both are correct:
 * - a multi-segment workspace-relative path, as delivered by `fs.watch`
 * - a bare single directory name, as produced by a directory listing
 *
 * @param relativePath - Workspace-relative path, or a single path segment.
 *   Absolute paths work too, but the caller is then asserting that no segment
 *   of the workspace's own location collides with an excluded name.
 * @param dirs - Which exclusion set to apply, normally {@link WATCH_IGNORED_DIRS}.
 * @returns True when the path should be skipped.
 */
export function isExcludedWorkspacePath(
  relativePath: string,
  dirs: ReadonlySet<string>,
): boolean {
  if (!relativePath) return false;

  for (const segment of relativePath.split(PATH_SEPARATOR)) {
    if (segment.length > 0 && dirs.has(segment)) return true;
  }

  return false;
}
