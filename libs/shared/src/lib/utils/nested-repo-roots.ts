/**
 * `NestedRepoRoots` — the DYNAMIC half of the workspace exclusion policy.
 *
 * `NESTED_WORKSPACE_PATH_RULES` (workspace-scan.constants) excludes the agent
 * worktree directories by name. A nested repository or a worktree registered
 * somewhere else under the workspace has no fixed name, so it is excluded by
 * ROOT instead: this set holds workspace-relative directory roots, and any path
 * at or below one of them is excluded (TASK_2026_437, user decision: nested
 * repositories and worktrees are excluded from every consumer).
 *
 * Roots come from two sources:
 * - `git worktree list` output ({@link NestedRepoRoots.fromWorktreeList}),
 *   filtered to worktrees that live under the workspace; and
 * - runtime discovery ({@link NestedRepoRoots.add}), typically the parent of a
 *   `.git` entry seen below the workspace root ({@link nestedRepoRootOf}). A
 *   worktree has a `.git` FILE and a repository a `.git` DIRECTORY; both are
 *   the same segment name and both mark their parent as a root.
 *
 * Keys are separator-normalized (`/`) and, for a Windows workspace, case-folded:
 * Windows file systems are case-insensitive and git reports a worktree's drive
 * letter and folders in whatever case it was created with.
 *
 * Pure and zero-dependency (no `path`, no `fs`) — compiled into every host.
 */

import type { GitWorktreeInfo } from '../types/rpc/rpc-git.types';

const PATH_SEPARATOR = /[\\/]/;

/** `C:\…`, `C:/…`, or a UNC `\\server\share` path. */
const WINDOWS_ABSOLUTE_PATH = /^(?:[A-Za-z]:(?:[\\/]|$)|\\\\|\/\/)/;

/** The name that marks a directory as a repository (dir) or worktree (file). */
const GIT_MARKER = '.git';

export class NestedRepoRoots {
  private readonly keys = new Set<string>();
  private readonly caseInsensitive: boolean;
  /** `undefined` when no usable root was given: {@link addAbsolute} then adds nothing. */
  private readonly rootKey: string | undefined;

  /**
   * @param workspaceRoot - Absolute workspace root. Decides case folding (a
   *   Windows path folds case) and is the base {@link addAbsolute} relativizes
   *   against.
   */
  constructor(workspaceRoot: string) {
    this.caseInsensitive = WINDOWS_ABSOLUTE_PATH.test(workspaceRoot);
    this.rootKey =
      workspaceRoot.trim().length === 0
        ? undefined
        : this.absoluteKey(workspaceRoot);
  }

  /**
   * Builds the set from `parseWorktreeList` output. The main worktree (the
   * workspace itself) and worktrees outside the workspace are skipped.
   */
  static fromWorktreeList(
    worktrees: readonly Pick<GitWorktreeInfo, 'path'>[],
    workspaceRoot: string,
  ): NestedRepoRoots {
    const roots = new NestedRepoRoots(workspaceRoot);
    for (const worktree of worktrees) {
      roots.addAbsolute(worktree.path);
    }
    return roots;
  }

  /** Number of distinct roots held. */
  get size(): number {
    return this.keys.size;
  }

  /**
   * Adds a workspace-relative root (e.g. `pkg/vendor-repo`). Returns false —
   * and adds nothing — for the workspace root itself (an empty path), or for a
   * path that climbs out with `..`: neither may exclude the workspace.
   */
  add(relativeRoot: string): boolean {
    const key = this.relativeKey(relativeRoot);
    if (key === undefined) return false;
    this.keys.add(key);
    return true;
  }

  /**
   * Adds an absolute root when it lies strictly below the workspace root.
   * Returns false for the workspace root itself and for any path outside it.
   */
  addAbsolute(absoluteRoot: string): boolean {
    if (this.rootKey === undefined) return false;
    const key = this.absoluteKey(absoluteRoot);
    // A POSIX filesystem root normalizes to '' and yields the prefix '/'.
    const prefix = `${this.rootKey}/`;
    if (!key.startsWith(prefix)) return false;
    return this.add(key.slice(prefix.length));
  }

  /**
   * True when `relativePath` is a held root or lies below one. O(depth): one
   * set lookup per path prefix.
   */
  contains(relativePath: string): boolean {
    return this.findRoot(relativePath) !== undefined;
  }

  /**
   * The held root that `relativePath` lies at or below (shallowest first), as
   * its normalized key, or `undefined` when it lies under none.
   */
  findRoot(relativePath: string): string | undefined {
    if (this.keys.size === 0 || !relativePath) return undefined;

    let prefix = '';
    for (const rawSegment of relativePath.split(PATH_SEPARATOR)) {
      if (rawSegment.length === 0 || rawSegment === '.') continue;
      const segment = this.caseInsensitive
        ? rawSegment.toLowerCase()
        : rawSegment;
      prefix = prefix.length === 0 ? segment : `${prefix}/${segment}`;
      if (this.keys.has(prefix)) return prefix;
    }
    return undefined;
  }

  /** The held roots as normalized workspace-relative keys, in insertion order. */
  roots(): string[] {
    return [...this.keys];
  }

  private relativeKey(relativePath: string): string | undefined {
    const segments: string[] = [];
    for (const rawSegment of relativePath.split(PATH_SEPARATOR)) {
      if (rawSegment.length === 0 || rawSegment === '.') continue;
      if (rawSegment === '..') return undefined;
      segments.push(
        this.caseInsensitive ? rawSegment.toLowerCase() : rawSegment,
      );
    }
    return segments.length === 0 ? undefined : segments.join('/');
  }

  private absoluteKey(absolutePath: string): string {
    // Separators to '/', doubled separators collapsed (a UNC path keeps its
    // leading '//'), trailing separators dropped.
    const normalized = absolutePath
      .replace(/\\/g, '/')
      .replace(/(?<!^)\/{2,}/g, '/')
      .replace(/\/+$/, '');
    return this.caseInsensitive ? normalized.toLowerCase() : normalized;
  }
}

/**
 * The nested repository root a workspace-relative path reveals, if any: the
 * parent of the first `.git` segment below the workspace root.
 *
 * - `pkg/sub/.git` (a worktree's `.git` FILE or a repo's `.git` DIR) → `pkg/sub`
 * - `pkg/sub/.git/index` (an event inside a nested repo's metadata) → `pkg/sub`
 * - `.git/index` (the workspace's own repository) → `undefined`
 * - `src/a.ts` → `undefined`
 *
 * The returned root keeps the caller's spelling with `/` separators; pass it to
 * {@link NestedRepoRoots.add}, which normalizes case.
 */
export function nestedRepoRootOf(relativePath: string): string | undefined {
  if (!relativePath) return undefined;

  const parents: string[] = [];
  for (const segment of relativePath.split(PATH_SEPARATOR)) {
    if (segment.length === 0 || segment === '.') continue;
    if (segment === GIT_MARKER) {
      return parents.length === 0 ? undefined : parents.join('/');
    }
    parents.push(segment);
  }
  return undefined;
}
