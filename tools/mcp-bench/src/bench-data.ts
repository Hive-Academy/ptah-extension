/**
 * The bench data folder: where a bench runner keeps private material that must
 * never be committed (snapshots, cassettes, scratch databases) and must never
 * touch the user's real Ptah state.
 *
 * Location: `PTAH_MCP_BENCH_DATA_DIR` when set (absolute only); otherwise
 * `%LOCALAPPDATA%\ptah-mcp-bench` on Windows and `~/.cache/ptah-mcp-bench`
 * elsewhere. A directory that is the real `~/.ptah` or lies under it, or that
 * is the repository root or lies inside it, is rejected.
 *
 * Resolve it in the runner PARENT only. The bench host child runs with `HOME`,
 * `USERPROFILE` and `LOCALAPPDATA` pointed at its temp home, so a child that
 * resolved the folder itself would land in the temp home and check the rule
 * against the wrong `.ptah`. A child receives the parent's resolved path (for
 * example as `PTAH_MCP_BENCH_DATA_DIR` in its env) and uses it as given.
 *
 * The path comparison rule (`isPathInside`, `isSamePath`) is the one the bench
 * host's isolation check uses too: resolve both sides, fold case on win32. It
 * is lexical and does no I/O. `resolveBenchDataDir` applies it twice: to the
 * paths as given, and to their real paths (`realpath`, so a junction or
 * symlink into a forbidden root is caught). A candidate that does not exist
 * yet is resolved through its nearest existing ancestor.
 */

import { existsSync, mkdirSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { posix, win32 } from 'node:path';

export const BENCH_DATA_DIR_ENV = 'PTAH_MCP_BENCH_DATA_DIR';
const BENCH_DATA_DIR_NAME = 'ptah-mcp-bench';

/** A bench data folder that breaks one of the location rules. */
export class BenchDataDirError extends Error {
  constructor(
    message: string,
    readonly path: string,
  ) {
    super(message);
    this.name = 'BenchDataDirError';
  }
}

export interface ResolveBenchDataDirOptions {
  /** Environment to read `PTAH_MCP_BENCH_DATA_DIR` and `LOCALAPPDATA` from. Default `process.env`. */
  readonly env?: NodeJS.ProcessEnv;
  /** The user's real home, whose `.ptah` is off limits. Default `os.homedir()`. */
  readonly realHome?: string;
  /**
   * Repository root the folder must stay outside. Default: the outermost
   * ancestor of `process.cwd()` holding an `nx.json`, which is the main
   * checkout when running from a git worktree under it.
   */
  readonly repoRoot?: string;
  /** Path semantics and case folding. Default `process.platform`. */
  readonly platform?: NodeJS.Platform;
  /** Create the folder (recursive mkdir) before returning. Default `false`. */
  readonly create?: boolean;
  /**
   * Resolves links in an existing path; throws `ENOENT` for a missing one.
   * Default `fs.realpathSync.native` when `platform` is this process's
   * platform; with a simulated foreign `platform` and no resolver, only the
   * lexical rule applies (the local file system cannot answer for it).
   */
  readonly realpath?: (path: string) => string;
}

function pathApi(platform: NodeJS.Platform): typeof posix {
  return platform === 'win32' ? win32 : posix;
}

function normalise(value: string, platform: NodeJS.Platform): string {
  const resolved = pathApi(platform).resolve(value);
  return platform === 'win32' ? resolved.toLowerCase() : resolved;
}

/** `path` lies strictly below `root` (resolved; case-folded on win32). */
export function isPathInside(
  path: string,
  root: string,
  platform: NodeJS.Platform = process.platform,
): boolean {
  const api = pathApi(platform);
  const rel = api.relative(
    normalise(root, platform),
    normalise(path, platform),
  );
  return rel !== '' && !rel.startsWith('..') && !api.isAbsolute(rel);
}

/** Both paths name the same location (resolved; case-folded on win32). */
export function isSamePath(
  left: string,
  right: string,
  platform: NodeJS.Platform = process.platform,
): boolean {
  return normalise(left, platform) === normalise(right, platform);
}

/**
 * The outermost ancestor of `start` (inclusive) that holds an `nx.json`, or
 * `null` when there is none. Outermost, not nearest: a git worktree under the
 * main checkout has its own `nx.json`, and the main checkout must be covered.
 */
export function findRepositoryRoot(
  start: string = process.cwd(),
  platform: NodeJS.Platform = process.platform,
): string | null {
  const api = pathApi(platform);
  let found: string | null = null;
  let current = api.resolve(start);
  for (;;) {
    if (existsSync(api.join(current, 'nx.json'))) found = current;
    const parent = api.dirname(current);
    if (parent === current) return found;
    current = parent;
  }
}

function defaultDataDir(
  env: NodeJS.ProcessEnv,
  realHome: string,
  platform: NodeJS.Platform,
): string {
  const api = pathApi(platform);
  if (platform === 'win32') {
    const localAppData =
      env['LOCALAPPDATA'] || api.join(realHome, 'AppData', 'Local');
    return api.join(localAppData, BENCH_DATA_DIR_NAME);
  }
  return api.join(realHome, '.cache', BENCH_DATA_DIR_NAME);
}

/**
 * The bench data folder for this run. Throws {@link BenchDataDirError} when the
 * override is relative, or when the folder is the real `~/.ptah` or under it,
 * or is the repository root or inside it. Creates it only with `create: true`.
 */
export function resolveBenchDataDir(
  options: ResolveBenchDataDirOptions = {},
): string {
  const env = options.env ?? process.env;
  const platform = options.platform ?? process.platform;
  const api = pathApi(platform);
  const realHome = options.realHome ?? homedir();

  const override = env[BENCH_DATA_DIR_ENV];
  let dir: string;
  if (override) {
    if (!api.isAbsolute(override)) {
      throw new BenchDataDirError(
        `${BENCH_DATA_DIR_ENV} must be an absolute path, got ${override}`,
        override,
      );
    }
    dir = api.resolve(override);
  } else {
    dir = defaultDataDir(env, realHome, platform);
    if (!api.isAbsolute(dir)) {
      throw new BenchDataDirError(
        `the default bench data folder ${dir} is not absolute (check LOCALAPPDATA and the home directory)`,
        dir,
      );
    }
  }

  const realpath =
    options.realpath ??
    (platform === process.platform ? realpathSync.native : null);
  const realDir =
    realpath === null ? null : realPathOf(dir, platform, realpath);

  const realPtah = api.join(realHome, '.ptah');
  assertOutside(dir, realDir, realPtah, platform, realpath, {
    lexical: `bench data folder ${dir} is the real Ptah state directory ${realPtah} or lies under it; the bench must never write there`,
    real: (realRoot) =>
      `is the real Ptah state directory ${realPtah} (real path ${realRoot}) or lies under it; the bench must never write there`,
  });

  const repoRoot =
    options.repoRoot ?? findRepositoryRoot(process.cwd(), platform);
  if (repoRoot === null) {
    throw new BenchDataDirError(
      `cannot check bench data folder ${dir}: no nx.json above ${process.cwd()}, so the repository root is unknown (pass repoRoot)`,
      dir,
    );
  }
  assertOutside(dir, realDir, repoRoot, platform, realpath, {
    lexical: `bench data folder ${dir} is the repository root ${repoRoot} or lies inside it; private bench data must stay out of the repository`,
    real: (realRoot) =>
      `is the repository root ${repoRoot} (real path ${realRoot}) or lies inside it; private bench data must stay out of the repository`,
  });

  if (options.create === true) mkdirSync(dir, { recursive: true });
  return dir;
}

function isAtOrUnder(
  path: string,
  root: string,
  platform: NodeJS.Platform,
): boolean {
  return isSamePath(path, root, platform) || isPathInside(path, root, platform);
}

/**
 * Reject `dir` when it is at or under `root`, compared lexically and, when a
 * resolver exists, by real path (the real candidate against both the given
 * and the real root).
 */
function assertOutside(
  dir: string,
  realDir: string | null,
  root: string,
  platform: NodeJS.Platform,
  realpath: ((path: string) => string) | null,
  messages: { lexical: string; real: (realRoot: string) => string },
): void {
  if (isAtOrUnder(dir, root, platform)) {
    throw new BenchDataDirError(messages.lexical, dir);
  }
  if (realDir === null || realpath === null) return;
  const realRoot = realPathOf(root, platform, realpath);
  if (
    isAtOrUnder(realDir, realRoot, platform) ||
    isAtOrUnder(realDir, root, platform)
  ) {
    throw new BenchDataDirError(
      `bench data folder ${dir} (real path ${realDir}) ${messages.real(realRoot)}`,
      dir,
    );
  }
}

function errorCode(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null && 'code' in error
    ? String((error as { code: unknown }).code)
    : undefined;
}

/**
 * `path` with every link resolved. A path that does not exist yet resolves
 * through its nearest existing ancestor, with the missing tail re-appended.
 * Any failure other than `ENOENT` fails closed with a {@link BenchDataDirError}.
 */
function realPathOf(
  path: string,
  platform: NodeJS.Platform,
  realpath: (path: string) => string,
): string {
  const api = pathApi(platform);
  const missing: string[] = [];
  let current = api.resolve(path);
  for (;;) {
    try {
      const real = realpath(current);
      return missing.length === 0 ? real : api.join(real, ...missing.reverse());
    } catch (error: unknown) {
      if (errorCode(error) !== 'ENOENT') {
        throw new BenchDataDirError(
          `cannot resolve the real path of ${path} (at ${current}): ${
            error instanceof Error ? error.message : String(error)
          }; refusing the bench data folder rather than skipping the link check`,
          path,
        );
      }
      const parent = api.dirname(current);
      if (parent === current) return api.resolve(path);
      missing.push(api.basename(current));
      current = parent;
    }
  }
}
