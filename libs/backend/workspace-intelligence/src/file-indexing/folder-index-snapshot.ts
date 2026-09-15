/**
 * The data one open folder's file index holds, and the writes that fill it.
 *
 * Shared by `WorkspaceFileIndexService` (the folder lifecycle and the queries)
 * and `FolderIndexLiveSync` (the live watcher patches and the lost-event
 * rebuild). Split out of the service under the facade rule (TASK_2026_437
 * FU-11b); nothing here does I/O.
 */

import * as path from 'path';
import type { IDisposable } from '@ptah-extension/platform-core';
import type { ParsedIgnoreFile } from './ignore-pattern-resolver.service';

/** The coarse autocomplete bucket a path is classified into. */
export type IndexedFileType = 'text' | 'image' | 'binary' | 'unknown';

/**
 * Lightweight in-memory entry. Deliberately excludes size/mtime.
 */
export interface IndexEntry {
  readonly path: string;
  readonly relativePath: string;
  readonly fileName: string;
  readonly directory: string;
  readonly fileType: IndexedFileType;
  readonly isDirectory: boolean;
}

/**
 * The swappable part of a folder's index: what a build fills. An overflow
 * rebuild fills a fresh one and replaces the entry's in one step, so queries
 * never see a half-built index.
 *
 * Map keys come from {@link toIndexKey}, so the walk's spelling (fast-glob
 * reports `D:/…`) and the watcher's (`D:\…`) name one entry; each entry keeps
 * the spelling it was added with.
 */
export interface FolderSnapshot {
  /** Normalized absolute file path → entry. */
  files: Map<string, IndexEntry>;
  /** Normalized absolute directory path → entry. */
  directories: Map<string, IndexEntry>;
  /** Parsed ignore files for this folder. */
  ignoreFiles: ParsedIgnoreFile[];
  /**
   * `ignoreFiles` compiled once per build (`compileMatcher`) — the one
   * synchronous predicate every batch's new paths pass through.
   */
  isIgnored: (relativePath: string) => boolean;
  /**
   * Nested repository and worktree roots the walk skipped. They seed the
   * subscription, because a repository that already exists produces no `.git`
   * event for the watch host to detect.
   */
  nestedRepoRoots: readonly string[];
}

/**
 * Everything one open workspace folder owns.
 *
 * One record per normalized root. Nothing here is shared between folders —
 * that is the whole point: the pre-TASK_2026_344 service kept `files`,
 * `directories`, `ignoreFiles` and `watcher` as SERVICE fields, which is why a
 * switch had to clear them and why every late-landing async write had to be
 * generation-gated against contaminating the other root.
 */
export interface FolderIndex extends FolderSnapshot {
  /** `normalizeWorkspaceRoot(root)` — the cache key. */
  readonly key: string;
  /**
   * The host-native root string this snapshot was built from.
   *
   * Fixed at creation and never re-assigned: `path.relative` results depend on
   * it, so swapping in another spelling of the same normalized root (a trailing
   * separator, a different drive case) mid-life would silently change every
   * relative path the entry produces from then on.
   */
  readonly root: string;
  /** This folder's live `IWorkspaceWatcher` subscription, once armed. */
  subscription: IDisposable | undefined;
  /** In-flight or settled build. `undefined` after a FAILED build, so it retries. */
  buildPromise: Promise<void> | undefined;
  ready: boolean;
  /**
   * Bumped whenever this entry is torn down, so a build or batch handler
   * still in flight for it stops writing.
   */
  generation: number;
  /** Activation clock stamp, for LRU eviction under the overflow cap. */
  lastActiveAt: number;
  /**
   * The snapshot an overflow rebuild is filling, while one is in flight.
   * Queries keep reading the entry's own maps until the rebuild swaps it in.
   */
  rebuildStaging: FolderSnapshot | undefined;
  /** An overflow arrived while a rebuild was running; rebuild once more after it. */
  rebuildQueued: boolean;
  /**
   * Set while a requested rebuild waits for the background-work governor to
   * clear (TASK_2026_437 C14 d). Aborting it cancels that pending rebuild.
   */
  rebuildDeferral: AbortController | undefined;
  /**
   * `Date.now()` before which a folder whose `watch()` threw is not retried;
   * `undefined` while subscribed or never attempted.
   */
  subscribeRetryAt: number | undefined;
}

/** An index with no ignore rules compiled yet ignores nothing. */
export const IGNORE_NOTHING = (): boolean => false;

/**
 * THE key for a path in `files` and `directories` — every write and every
 * lookup goes through it, so the two maps share one key space.
 *
 * - `path.normalize`: separators and `.`/doubled segments (fast-glob reports
 *   `D:/…`, the watch host `D:\…`);
 * - no trailing separator (a watcher may report `dir/`);
 * - an upper-case drive letter (`d:\x` and `D:\x` are one path on Windows).
 */
export function toIndexKey(absPath: string): string {
  let key = path.normalize(absPath);
  while (
    key.length > 1 &&
    /[\\/]$/.test(key) &&
    !/^[A-Za-z]:[\\/]$/.test(key)
  ) {
    key = key.slice(0, -1);
  }
  return /^[a-z]:/.test(key) ? key[0].toUpperCase() + key.slice(1) : key;
}

/** A snapshot with nothing in it and no rules: a new folder, or a rebuild's staging area. */
export function emptySnapshot(): FolderSnapshot {
  return {
    files: new Map(),
    directories: new Map(),
    ignoreFiles: [],
    isIgnored: IGNORE_NOTHING,
    nestedRepoRoots: [],
  };
}

/** The snapshot queries read, plus the one an overflow rebuild is filling. */
export function liveSnapshots(entry: FolderIndex): FolderSnapshot[] {
  return entry.rebuildStaging ? [entry, entry.rebuildStaging] : [entry];
}

/**
 * Add a file entry plus its ancestor directory entries (derived from the
 * path, so they inherit the file's not-ignored status for free).
 */
export function addFileEntry(
  root: string,
  absPath: string,
  into: FolderSnapshot,
): void {
  const relativePath = path.relative(root, absPath);
  const fileName = path.basename(absPath);
  const directory = path.dirname(absPath);
  into.files.set(toIndexKey(absPath), {
    path: absPath,
    relativePath,
    fileName,
    directory,
    fileType: detectFileType(fileName),
    isDirectory: false,
  });
  addAncestorDirectories(root, absPath, into);
}

export function addAncestorDirectories(
  root: string,
  absPath: string,
  into: FolderSnapshot,
): void {
  // Derive ancestor dirs from the RELATIVE path so we never mix the
  // workspace root's native separators/drive with the POSIX separators
  // fast-glob emits. Each ancestor inherits the file's not-ignored status.
  const relative = path.relative(root, absPath);
  if (!relative || relative.startsWith('..')) return;
  const segments = relative.split(/[\\/]/).filter(Boolean);
  segments.pop(); // drop the file name
  const soFar: string[] = [];
  for (const segment of segments) {
    soFar.push(segment);
    const absDir = path.join(root, ...soFar);
    const key = toIndexKey(absDir);
    if (into.directories.has(key)) continue;
    into.directories.set(key, {
      path: absDir,
      relativePath: path.relative(root, absDir),
      fileName: segment,
      directory: path.dirname(absDir),
      fileType: 'unknown',
      isDirectory: true,
    });
  }
}

const IMAGE_EXTENSIONS = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.bmp',
  '.svg',
  '.webp',
  '.ico',
]);
const TEXT_EXTENSIONS = new Set([
  '.txt',
  '.md',
  '.json',
  '.js',
  '.ts',
  '.jsx',
  '.tsx',
  '.css',
  '.scss',
  '.html',
  '.xml',
  '.yaml',
  '.yml',
]);
const BINARY_EXTENSIONS = new Set([
  '.exe',
  '.dll',
  '.so',
  '.dylib',
  '.bin',
  '.zip',
  '.tar',
  '.gz',
]);

/**
 * Classify a file by extension into the coarse autocomplete buckets. Kept
 * intentionally identical to the previous `ContextService.detectFileType` so
 * downstream consumers see the same `fileType` values.
 */
function detectFileType(fileName: string): IndexedFileType {
  const ext = path.extname(fileName).toLowerCase();
  if (IMAGE_EXTENSIONS.has(ext)) return 'image';
  if (TEXT_EXTENSIONS.has(ext)) return 'text';
  if (BINARY_EXTENSIONS.has(ext)) return 'binary';
  return 'unknown';
}
