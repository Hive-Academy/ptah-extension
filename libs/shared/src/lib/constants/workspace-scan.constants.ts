/**
 * Workspace scan exclusions — the single source of truth for "should a
 * filesystem write under this name schedule a `git status` refresh", and for
 * which nested-checkout subtrees (agent worktrees) no consumer ever watches or
 * indexes ({@link NESTED_WORKSPACE_PATH_RULES}).
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

/**
 * The directory Ptah (and the SDK worktree hook) creates agent worktrees in,
 * directly under the repository's main worktree. The single literal: every
 * producer (`resolveWorktreePath`, the SDK `WorktreeCreate` hook) and every
 * exclusion below derive from it.
 */
export const AGENT_WORKTREE_DIR = '.claude-worktrees';

/**
 * One exclusion rule: a sequence of directory names that must appear as
 * CONSECUTIVE path segments, at any depth. A one-element rule behaves like a
 * {@link WATCH_IGNORED_DIRS} name; a longer rule lets a parent stay watched
 * while one of its children is not.
 */
export type WorkspacePathRule = readonly string[];

/**
 * Subtrees that hold a nested repository checkout — agent worktrees — and are
 * therefore never watched, indexed or offered in the `@` picker
 * (TASK_2026_437: removing ten worktrees of ~7,400 files each froze the
 * Electron main thread on per-event watcher work).
 *
 * - `['.claude-worktrees']` — Ptah's own worktree directory
 *   ({@link AGENT_WORKTREE_DIR}).
 * - `['.claude', 'worktrees']` — Claude Code's worktree directory. `.claude`
 *   ALONE is deliberately not excluded: `.claude/commands`, `.claude/skills`,
 *   `.claude/agents` hold tracked source that must keep refreshing.
 *
 * **Why excluding these can never hide a real change from `git status`.** A
 * worktree is a separate checkout with its own `.git` file; the outer
 * repository's `git status` never descends into a directory holding a `.git`
 * entry, so no tracked change of the outer repo can live under one. Checked
 * against this repo with `git check-ignore -v` as well: `.claude-worktrees/x`
 * and `pkg/.claude-worktrees/y` both resolve to the unanchored `.gitignore`
 * rule `.claude-worktrees`, and `.claude/worktrees/x` to `.claude/*`, while
 * `.claude/commands/x.md` resolves to the negation `!.claude/commands/**` —
 * the negated sibling that must stay watched.
 *
 * **Rules match ASCII case-insensitively on every platform, in both channels.**
 * NTFS (and the default APFS) is case-insensitive, so `.Claude-Worktrees` is
 * the same directory as `.claude-worktrees` there — and the 2026-09-14 incident
 * happened on win32. A case variant produced by a sync tool or a manual rename
 * must not reopen the trigger. The segment predicate folds case without
 * allocating; {@link toWorkspaceExcludeGlobs} emits per-letter bracket classes
 * so every glob consumer (picomatch, VS Code `findFiles`, TypeScript
 * diagnostics, the MCP builders) matches the same way with no `nocase` option.
 * On a case-sensitive POSIX filesystem the cost is excluding a directory that
 * differs from these names only in case — far below the evidence bar's risk.
 * {@link WATCH_IGNORED_DIRS} name matching stays case-sensitive (unchanged).
 */
export const NESTED_WORKSPACE_PATH_RULES: readonly WorkspacePathRule[] = [
  [AGENT_WORKTREE_DIR],
  ['.claude', 'worktrees'],
];

/** Splits on both POSIX and Windows separators. Windows is the primary dev platform here. */
const PATH_SEPARATOR = /[\\/]/;

/**
 * True when any segment of `relativePath` names an excluded directory, or
 * when a run of consecutive segments spells one of `rules`.
 *
 * Segment-level rather than prefix-level on purpose: in a monorepo the churn
 * lives at `packages/foo/node_modules/…` and `libs/bar/dist/…` just as much as
 * at the root, so testing every segment catches nested occurrences too. Rules
 * match at any depth for the same reason (`pkg/.claude-worktrees/x`).
 *
 * Both call shapes are supported and both are correct:
 * - a multi-segment workspace-relative path, as delivered by `fs.watch`
 * - a bare single directory name, as produced by a directory listing
 *
 * Empty segments (leading, trailing or doubled separators) are skipped, both
 * for single names and inside a rule, so `.claude//worktrees` still matches.
 *
 * Cost: O(segments × rules) comparisons; the split is the only allocation.
 *
 * @param relativePath - Workspace-relative path, or a single path segment.
 *   Absolute paths work too, but the caller is then asserting that no segment
 *   of the workspace's own location collides with an excluded name.
 * @param dirs - Which exclusion set to apply, normally {@link WATCH_IGNORED_DIRS}.
 * @param rules - Multi-segment rules, normally {@link NESTED_WORKSPACE_PATH_RULES}.
 *   Defaults to none, which keeps the single-segment behaviour exactly.
 * @returns True when the path should be skipped.
 */
export function isExcludedWorkspacePath(
  relativePath: string,
  dirs: ReadonlySet<string>,
  rules: readonly WorkspacePathRule[] = [],
): boolean {
  if (!relativePath) return false;

  const segments = relativePath.split(PATH_SEPARATOR);
  for (let index = 0; index < segments.length; index++) {
    const segment = segments[index];
    if (segment.length === 0) continue;
    if (dirs.has(segment)) return true;
    for (const rule of rules) {
      if (ruleMatchesAt(segments, index, rule)) return true;
    }
  }

  return false;
}

/**
 * True when `rule` matches the non-empty segments starting at `start`. An
 * empty rule never matches — it would otherwise exclude every path.
 */
function ruleMatchesAt(
  segments: readonly string[],
  start: number,
  rule: WorkspacePathRule,
): boolean {
  if (rule.length === 0) return false;

  let cursor = start;
  for (const name of rule) {
    while (cursor < segments.length && segments[cursor].length === 0) {
      cursor++;
    }
    if (
      cursor >= segments.length ||
      !equalsIgnoringAsciiCase(segments[cursor], name)
    ) {
      return false;
    }
    cursor++;
  }
  return true;
}

/** ASCII case-insensitive equality without allocating (no `toLowerCase`). */
function equalsIgnoringAsciiCase(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    let x = a.charCodeAt(i);
    let y = b.charCodeAt(i);
    if (x === y) continue;
    if (x >= 65 && x <= 90) x += 32;
    if (y >= 65 && y <= 90) y += 32;
    if (x !== y) return false;
  }
  return true;
}

/**
 * Derives the glob form of `rules` for glob-based consumers
 * (`DEFAULT_WORKSPACE_EXCLUDES`, VS Code `findFiles` excludes, watcher
 * `ignore` options). Every ASCII letter becomes a two-case bracket class so
 * the glob matches case-insensitively without a `nocase` option:
 * `['.claude', 'worktrees']` → `**\/.[cC][lL][aA][uU][dD][eE]/[wW][oO]…[sS]/**`.
 *
 * Rule names are literal directory names; none of the shipped rules holds a
 * glob metacharacter, so no other escaping is applied. Empty rules and empty
 * names are skipped rather than turned into a catch-all glob.
 */
export function toWorkspaceExcludeGlobs(
  rules: readonly WorkspacePathRule[],
): string[] {
  const globs: string[] = [];
  for (const rule of rules) {
    const names = rule.filter((name) => name.length > 0);
    if (names.length === 0) continue;
    globs.push(`**/${names.map(caseInsensitiveGlobName).join('/')}/**`);
  }
  return globs;
}

/** `.claude` → `.[cC][lL][aA][uU][dD][eE]`; non-letters stay literal. */
function caseInsensitiveGlobName(name: string): string {
  let glob = '';
  for (const char of name) {
    const lower = char.toLowerCase();
    const upper = char.toUpperCase();
    glob +=
      lower !== upper && /[a-z]/.test(lower) ? `[${lower}${upper}]` : char;
  }
  return glob;
}
