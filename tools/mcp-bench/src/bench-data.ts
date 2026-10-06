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
 * host's isolation check uses too: resolve both sides, fold case on win32.
 */

import { existsSync, mkdirSync } from 'node:fs';
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

  const realPtah = api.join(realHome, '.ptah');
  if (
    isSamePath(dir, realPtah, platform) ||
    isPathInside(dir, realPtah, platform)
  ) {
    throw new BenchDataDirError(
      `bench data folder ${dir} is the real Ptah state directory ${realPtah} or lies under it; the bench must never write there`,
      dir,
    );
  }

  const repoRoot =
    options.repoRoot ?? findRepositoryRoot(process.cwd(), platform);
  if (repoRoot === null) {
    throw new BenchDataDirError(
      `cannot check bench data folder ${dir}: no nx.json above ${process.cwd()}, so the repository root is unknown (pass repoRoot)`,
      dir,
    );
  }
  if (
    isSamePath(dir, repoRoot, platform) ||
    isPathInside(dir, repoRoot, platform)
  ) {
    throw new BenchDataDirError(
      `bench data folder ${dir} is the repository root ${repoRoot} or lies inside it; private bench data must stay out of the repository`,
      dir,
    );
  }

  if (options.create === true) mkdirSync(dir, { recursive: true });
  return dir;
}
