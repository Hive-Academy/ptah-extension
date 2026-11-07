/**
 * Synchronous passes of the nested-repository scan in
 * `WorkspaceIndexerService.discoverFilesOutsideNestedRepos`, each bounded by a
 * {@link WalkSlice}: on a large flat tree any one of them, run uninterrupted,
 * is a main-loop block (review-10 finding 3).
 */
import * as path from 'path';
import type { WalkSlice } from './cooperative-yield';

/**
 * Every directory holding one of `files`, and each of its ancestors, once
 * (root-relative, `/`-joined). Walking up stops at the first directory already
 * seen, so a file costs one lookup beyond its first new ancestor.
 */
export async function collectDirectories(
  workspaceFolder: string,
  files: readonly string[],
  walk: WalkSlice,
): Promise<Set<string>> {
  const directories = new Set<string>();
  for (const file of files) {
    if (walk.expired()) await walk.yield();
    const relative = path.relative(workspaceFolder, file);
    if (relative.startsWith('..') || path.isAbsolute(relative)) continue;
    const segments = relative.split(/[\\/]/).filter((s) => s.length > 0);
    let key = segments.slice(0, -1).join('/');
    while (key.length > 0 && !directories.has(key)) {
      directories.add(key);
      const slash = key.lastIndexOf('/');
      key = slash < 0 ? '' : key.slice(0, slash);
    }
  }
  return directories;
}

/** `directories` grouped by depth (index = number of `/`); sparse. */
export async function groupByDepth(
  directories: ReadonlySet<string>,
  walk: WalkSlice,
): Promise<string[][]> {
  const levels: string[][] = [];
  for (const dir of directories) {
    if (walk.expired()) await walk.yield();
    const depth = dir.split('/').length - 1;
    (levels[depth] ??= []).push(dir);
  }
  return levels;
}

/** `file` relative to `root`, split on either separator, empty segments dropped. */
export function relativeSegments(root: string, file: string): string[] {
  return path
    .relative(root, file)
    .split(/[\\/]/)
    .filter((segment) => segment.length > 0);
}

/** True when some prefix of `segments` (including all of it) is a root in `roots`. */
export function isUnderNestedRoot(
  segments: readonly string[],
  roots: ReadonlySet<string>,
): boolean {
  if (roots.size === 0) return false;
  let prefix = '';
  for (const segment of segments) {
    prefix = prefix.length === 0 ? segment : `${prefix}/${segment}`;
    if (roots.has(prefix)) return true;
  }
  return false;
}

/** The directories of one depth level not below an already-found root. */
export async function unprobedCandidates(
  level: readonly string[],
  roots: ReadonlySet<string>,
  walk: WalkSlice,
): Promise<string[]> {
  const candidates: string[] = [];
  for (const dir of level) {
    if (walk.expired()) await walk.yield();
    if (!isUnderNestedRoot(dir.split('/'), roots)) candidates.push(dir);
  }
  return candidates;
}
