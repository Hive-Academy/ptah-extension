/**
 * `classifyGitDirChange` — what one changed path inside a repository's git
 * directory means for the git status push (TASK_2026_576 RC5).
 *
 * `GitWatcherService` holds ONE recursive subscription on the common git
 * directory. In a linked worktree the worktree's own gitdir
 * (`<common>/worktrees/<name>`) lies beneath it, so one subscription sees both;
 * this function tells the two apart:
 *
 * - own gitdir `HEAD`, `ORIG_HEAD`, `MERGE_HEAD`, `CHERRY_PICK_HEAD`,
 *   `REVERT_HEAD`, `REBASE_HEAD`, `AUTO_MERGE`, `rebase-merge/**` and
 *   `rebase-apply/**` → `'head'`;
 * - own `index` → `'index'`;
 * - own `FETCH_HEAD`, own per-worktree `refs/**` (`refs/bisect`,
 *   `refs/worktree`), common `packed-refs` and common `refs/**` → `'refs'`,
 *   except `refs/stash` → `'refs-stash'`;
 * - common `worktrees/**` outside the own gitdir → `'worktree-admin'` (another
 *   worktree was added, removed or moved);
 * - anything else → `null`.
 *
 * Pure: no I/O. Paths compare separator-insensitively, and ASCII
 * case-insensitively when they are Windows drive or UNC paths, which is how
 * the watch host matches them against its root.
 */

import type { GitChangeKind } from '@ptah-extension/shared';

export type GitDirChange = GitChangeKind | 'worktree-admin';

/** Pseudo-refs whose change moves or annotates the worktree's HEAD. */
const HEAD_FILES: ReadonlySet<string> = new Set([
  'HEAD',
  'ORIG_HEAD',
  'MERGE_HEAD',
  'CHERRY_PICK_HEAD',
  'REVERT_HEAD',
  'REBASE_HEAD',
  'AUTO_MERGE',
]);

/** Directories holding an in-progress rebase's state. */
const REBASE_DIRS: ReadonlySet<string> = new Set([
  'rebase-merge',
  'rebase-apply',
]);

const WINDOWS_STYLE_PATH = /^(?:[A-Za-z]:\/|\/\/)/;

export function classifyGitDirChange(
  absPath: string,
  ownGitDir: string,
  commonDir: string,
): GitDirChange | null {
  const changed = toKey(absPath);
  const ownRoot = toKey(ownGitDir);
  const commonRoot = toKey(commonDir);
  const own = relativeSegments(changed, ownRoot);
  const common = relativeSegments(changed, commonRoot);
  const ownIsCommon = ownRoot.key === commonRoot.key;

  if (own !== undefined) {
    const kind = classifyOwn(own);
    // A linked worktree's own gitdir sits inside `<common>/worktrees`; nothing
    // in it is another worktree's administration.
    if (kind !== null || !ownIsCommon) return kind;
  }
  return common === undefined ? null : classifyCommon(common);
}

function classifyOwn(segments: readonly string[]): GitDirChange | null {
  if (segments.length === 0) return null;
  const [top] = segments;
  if (REBASE_DIRS.has(top)) return 'head';
  if (segments.length === 1) {
    if (HEAD_FILES.has(top)) return 'head';
    if (top === 'index') return 'index';
    if (top === 'FETCH_HEAD') return 'refs';
    return null;
  }
  return top === 'refs' ? classifyRefs(segments) : null;
}

function classifyCommon(segments: readonly string[]): GitDirChange | null {
  if (segments.length === 0) return null;
  const [top] = segments;
  if (top === 'packed-refs' && segments.length === 1) return 'refs';
  if (top === 'refs') return classifyRefs(segments);
  if (top === 'worktrees') return 'worktree-admin';
  return null;
}

/** `refs` itself or anything below it; `refs/stash` is the stash. */
function classifyRefs(segments: readonly string[]): GitChangeKind {
  return segments.length === 2 && segments[1] === 'stash'
    ? 'refs-stash'
    : 'refs';
}

interface PathKey {
  /** Forward-slashed, trailing-separator-free, case-folded when Windows-style. */
  readonly key: string;
  /** The same path with its original case, for segment names. */
  readonly spelling: string;
}

function toKey(p: string): PathKey {
  const spelling = p
    .replace(/\\/g, '/')
    .replace(/(?<!^)\/{2,}/g, '/')
    .replace(/(?<=.)\/+$/, '');
  return {
    key: WINDOWS_STYLE_PATH.test(spelling) ? spelling.toLowerCase() : spelling,
    spelling,
  };
}

/**
 * Segments of `path` below `root` (empty when they are the same path), or
 * undefined when `path` is not at or below `root`. Segment names keep their
 * original spelling: git's own names (`HEAD`, `index`) are case-sensitive.
 */
function relativeSegments(path: PathKey, root: PathKey): string[] | undefined {
  if (path.key === root.key) return [];
  const prefix = root.key.endsWith('/') ? root.key : `${root.key}/`;
  if (!path.key.startsWith(prefix)) return undefined;
  // Offset from the root's own spelling: case folding may change a non-ASCII
  // name's length, never the length of the path it spells.
  const offset = root.spelling.endsWith('/')
    ? root.spelling.length
    : root.spelling.length + 1;
  const segments = path.spelling
    .slice(offset)
    .split('/')
    .filter((segment) => segment.length > 0 && segment !== '.');
  return segments.includes('..') ? undefined : segments;
}
