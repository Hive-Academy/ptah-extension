/**
 * Read-path guard for the memory-skills runner parent (619 answer 6, batches
 * R10). Offline suites run in the parent inside the launcher window, and the
 * parent checks its own reads: it may read only
 *   - committed repository files: tracked in `HEAD` and unchanged in the
 *     working tree, so a scored number never comes from an uncommitted edit;
 *   - files in the bench data folder (`resolveBenchDataDir()`).
 * Anything in the real `~/.ptah` is refused first, whatever else applies.
 *
 * The rule is checked twice: on the path as given (resolved; case-folded on
 * win32, 619's `isPathInside` / `isSamePath`) and on its real path, so a
 * junction or symlink cannot lead a permitted path into a forbidden place. A
 * path that does not exist yet resolves through its nearest existing ancestor.
 */

import { readFileSync, realpathSync } from 'node:fs';
import { posix, win32 } from 'node:path';

import { isPathInside, isSamePath } from '../../bench-data';

/** Runs `git <args>` in the repository root and returns stdout. */
export type GitRunner = (args: readonly string[]) => string;

/** A read the parent must not make. */
export class ReadPathRefusedError extends Error {
  constructor(
    readonly path: string,
    readonly reason: string,
  ) {
    super(`read refused: ${path}: ${reason}`);
    this.name = 'ReadPathRefusedError';
  }
}

export interface ReadPathGuardOptions {
  /** Git top level of the checkout the runner runs from. */
  readonly repoRoot: string;
  /** The parent's `resolveBenchDataDir()` result. */
  readonly benchDataDir: string;
  /** The user's real home; its `.ptah` is never readable. */
  readonly realHome: string;
  /** Repo-relative `/` paths that are committed (see {@link listCommittedFiles}). */
  readonly committedFiles: ReadonlySet<string>;
  /** Default `process.platform`. */
  readonly platform?: NodeJS.Platform;
  /** Default `fs.realpathSync.native`; throws `ENOENT` for a missing path. */
  readonly realpath?: (path: string) => string;
}

export interface ReadPathGuard {
  /** The resolved path when the read is allowed; throws {@link ReadPathRefusedError}. */
  assertReadable(path: string): string;
  readText(path: string): string;
  readBytes(path: string): Buffer;
}

/**
 * Committed repository files: every path in the `HEAD` tree minus the tracked
 * paths with staged or unstaged changes. Paths are repo-relative with `/`.
 */
export function listCommittedFiles(git: GitRunner): Set<string> {
  const tracked = splitNul(git(['ls-tree', '-r', '-z', '--name-only', 'HEAD']));
  const changed = new Set<string>();
  // Porcelain v1 with -z: "XY path\0", and a rename adds "orig\0" after it.
  const entries = splitNul(
    git(['status', '--porcelain=v1', '-z', '--untracked-files=no']),
  );
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    const status = entry.slice(0, 2);
    changed.add(entry.slice(3));
    if (status.includes('R') || status.includes('C')) {
      index += 1;
      if (index < entries.length) changed.add(entries[index]);
    }
  }
  return new Set(tracked.filter((path) => !changed.has(path)));
}

function splitNul(output: string): string[] {
  return output.split('\0').filter((part) => part.length > 0);
}

function errorCode(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null && 'code' in error
    ? String((error as { code: unknown }).code)
    : undefined;
}

export function createReadPathGuard(
  options: ReadPathGuardOptions,
): ReadPathGuard {
  const platform = options.platform ?? process.platform;
  const api = platform === 'win32' ? win32 : posix;
  const realpath =
    options.realpath ??
    (platform === process.platform ? realpathSync.native : null);
  const fold = (value: string): string =>
    platform === 'win32' ? value.toLowerCase() : value;
  const committed = new Set([...options.committedFiles].map(fold));

  const atOrUnder = (path: string, root: string): boolean =>
    isSamePath(path, root, platform) || isPathInside(path, root, platform);

  /** `path` with links resolved; a missing tail is re-appended. */
  const realPathOf = (path: string): string => {
    if (realpath === null) return api.resolve(path);
    const missing: string[] = [];
    let current = api.resolve(path);
    for (;;) {
      try {
        const real = realpath(current);
        return missing.length === 0
          ? real
          : api.join(real, ...[...missing].reverse());
      } catch (error: unknown) {
        if (errorCode(error) !== 'ENOENT') {
          throw new ReadPathRefusedError(
            path,
            `cannot resolve its real path (${error instanceof Error ? error.message : String(error)})`,
          );
        }
        const parent = api.dirname(current);
        if (parent === current) return api.resolve(path);
        missing.push(api.basename(current));
        current = parent;
      }
    }
  };

  const realPtah = api.join(options.realHome, '.ptah');
  const realPtahReal = realPathOf(realPtah);
  const benchReal = realPathOf(options.benchDataDir);
  const repoReal = realPathOf(options.repoRoot);

  const assertReadable = (path: string): string => {
    if (!api.isAbsolute(path)) {
      throw new ReadPathRefusedError(path, 'not an absolute path');
    }
    const resolved = api.resolve(path);
    const real = realPathOf(resolved);
    if (
      atOrUnder(resolved, realPtah) ||
      atOrUnder(real, realPtah) ||
      atOrUnder(real, realPtahReal)
    ) {
      throw new ReadPathRefusedError(
        path,
        `lies in the real Ptah state directory ${realPtah}`,
      );
    }
    if (isPathInside(resolved, options.benchDataDir, platform)) {
      if (!isPathInside(real, benchReal, platform)) {
        throw new ReadPathRefusedError(
          path,
          `its real path ${real} leaves the bench data folder`,
        );
      }
      return resolved;
    }
    if (isPathInside(resolved, options.repoRoot, platform)) {
      const relative = api
        .relative(options.repoRoot, resolved)
        .split(api.sep)
        .join('/');
      if (!committed.has(fold(relative))) {
        throw new ReadPathRefusedError(
          path,
          'not a committed repository file (untracked, or changed since HEAD)',
        );
      }
      if (!isPathInside(real, repoReal, platform)) {
        throw new ReadPathRefusedError(
          path,
          `its real path ${real} leaves the repository`,
        );
      }
      return resolved;
    }
    throw new ReadPathRefusedError(
      path,
      'outside the committed repository files and the bench data folder',
    );
  };

  return {
    assertReadable,
    readText: (path) => readFileSync(assertReadable(path), 'utf8'),
    readBytes: (path) => readFileSync(assertReadable(path)),
  };
}
