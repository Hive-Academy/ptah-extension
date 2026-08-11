/**
 * Workspace scan exclusions — the single source of truth for "which
 * directories does Ptah skip when walking or watching a workspace".
 *
 * There are two named sets, not one, and they are deliberately different
 * sizes. The **mechanism** is unified (one module, one predicate); the
 * **policy** is not, because the two consumers answer different questions:
 *
 * - The file-tree builder asks "should the user SEE this directory?".
 *   Changing that answer changes what the file explorer renders, which is a
 *   user-visible change. `TREE_HIDDEN_DIRS` therefore encodes exactly the
 *   directories the tree hides today — no more, no less.
 * - The workspace watcher asks "should a write here schedule a `git status`?".
 *   That answer is invisible to the user, so it can afford to be slightly
 *   broader. `WATCH_IGNORED_DIRS` is a strict superset.
 *
 * The subset relation `TREE_HIDDEN_DIRS ⊆ WATCH_IGNORED_DIRS` is expressed in
 * code below (the watch set is *derived* from the tree set), not asserted in a
 * comment, so the two cannot drift apart.
 *
 * **Conservatism is a correctness requirement, not a style preference.** An
 * over-broad exclusion set makes Ptah miss a real source change — a
 * correctness defect — whereas an under-broad one merely causes redundant
 * `git status` invocations, an annoyance. `out`, `build`, `coverage`, `.next`
 * and `.turbo` are all plausible *source* directories in real projects and are
 * deliberately NOT excluded. Do not add a name here without evidence that it
 * can never hold source.
 *
 * ## Reachability: navigation is filtered, explicit access is not
 *
 * Both sets answer "which directories does a WALK skip". Neither is an access
 * control, and the difference between those two things is observable today:
 *
 * - **Navigation from the workspace root is filtered.** `editor:getFileTree`
 *   walks from the root and tests every entry it enumerates against
 *   `TREE_HIDDEN_DIRS`, at every depth. Clicking down the tree can therefore
 *   never arrive inside `node_modules`, `dist`, `.git` or any other member.
 * - **Explicit access is not filtered at all.** `buildFileTree` filters the
 *   entries it reads OUT of a directory — never the directory it was pointed
 *   AT. So `editor:getFileTree { rootPath: '<workspace>/node_modules' }`
 *   enumerates it happily, `editor:getDirectoryChildren { dirPath: … }` does
 *   the same, and `file:open` / `editor:openFile` apply no exclusion test
 *   whatsoever. The only gate on those three is `validatePathInWorkspace`.
 *
 * **This asymmetry is intentional and stays.** These sets exist to keep noise
 * out of a tree someone is browsing, not to make files unreadable. A caller
 * that passes an exact path has stated an intent that a default-hiding rule
 * should not override — the same way a file manager omits dotfiles from a
 * listing but still opens the one you name. Making it symmetric would break,
 * among other things, opening a file from a stack frame that points into
 * `node_modules`. So changing it is a PRODUCT decision, not a bug fix.
 *
 * Two consequences, stated out loud because they had been written down
 * nowhere at all before TASK_2026_208:
 *
 * 1. Adding a name here hides more from NAVIGATION. It denies nothing. Do not
 *    add one expecting it to protect anything — the containment boundary is
 *    the workspace check, and that is the only thing holding it.
 * 2. An agent, or any RPC caller, can read inside an excluded directory by
 *    naming it. Intended; see above.
 *
 * Both halves are pinned by executable tests in
 * `apps/ptah-electron/src/services/rpc/handlers/editor-rpc.handlers.spec.ts`,
 * so a change to either one lands as a red test rather than as silent drift
 * away from this comment.
 *
 * Zero-dependency by construction: no `path`, no `fs`, no Node built-ins. This
 * module is compiled into the VS Code extension host, the Electron main
 * process and the headless CLI alike.
 */

/**
 * Directory (and file) names the file-tree builder hides.
 *
 * This is the union of the two lists that previously lived, hand-maintained
 * and drifting, inside `editor-rpc.handlers.ts`: the nine-name `HIDDEN_SKIP`
 * set and the separate `node_modules`/`dist` check. Membership here is
 * equivalent to what the tree rendered before those two checks were merged.
 */
export const TREE_HIDDEN_DIRS: ReadonlySet<string> = new Set([
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
  // Dependency and output trees
  'node_modules',
  'dist',
]);

/**
 * Directory names the workspace watcher ignores when deciding whether a
 * file-system event should schedule a `git status` refresh.
 *
 * Strict superset of {@link TREE_HIDDEN_DIRS}, derived from it so the subset
 * relation holds structurally. The single addition is `.angular`, the Angular
 * CLI's build cache — a high-frequency churn source during any webview build
 * that git never reports on (it is `.gitignore`d), so excluding it can never
 * cause a real change to be missed.
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
 *
 * The residual exposure is therefore not "nesting" but "a consumer whose
 * `.gitignore` anchors the entry (`/.angular`) or omits it entirely", which
 * would require deviating from the Angular CLI's own generator default. If
 * that assumption is ever revisited, re-run the `check-ignore` probe above
 * before widening this set further.
 */
export const WATCH_IGNORED_DIRS: ReadonlySet<string> = new Set([
  ...TREE_HIDDEN_DIRS,
  '.angular',
]);

/** Splits on both POSIX and Windows separators. Windows is the primary dev platform here. */
const PATH_SEPARATOR = /[\\/]/;

/**
 * True when any segment of `relativePath` names an excluded directory.
 *
 * Segment-level rather than prefix-level on purpose: in a monorepo the churn
 * lives at `packages/foo/node_modules/…` and `libs/bar/dist/…` just as much as
 * at the root, and the tree builder already hides those nested directories at
 * every depth. Testing every segment is what makes the watcher and the tree
 * agree.
 *
 * Both call shapes are supported and both are correct:
 * - a multi-segment workspace-relative path, as delivered by `fs.watch`
 * - a bare single directory name, as produced by a directory listing
 *
 * @param relativePath - Workspace-relative path, or a single path segment.
 *   Absolute paths work too, but the caller is then asserting that no segment
 *   of the workspace's own location collides with an excluded name.
 * @param dirs - Which policy to apply: {@link TREE_HIDDEN_DIRS} or
 *   {@link WATCH_IGNORED_DIRS}.
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
