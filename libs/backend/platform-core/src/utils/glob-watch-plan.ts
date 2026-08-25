/**
 * Glob → watchable-directory planner for the chokidar-backed adapters.
 *
 * ## Why this exists
 *
 * `IFileSystemProvider.createFileWatcher` takes a GLOB, because the VS Code
 * adapter hands it straight to `vscode.workspace.createFileSystemWatcher`,
 * which globs natively. The Electron and CLI adapters passed the same string to
 * `chokidar.watch` — and chokidar REMOVED glob support in v4:
 *
 * > **v4 (Sep 2024):** remove glob support and bundled fsevents.
 *
 * A glob therefore reached chokidar as a LITERAL PATH: a recursive pattern
 * watched a directory named `**`, which does not exist, so `getWatched()` came
 * back `{}` and no event ever fired. Every watcher on those two hosts was dead,
 * silently: no throw, no warning, just a subscription that never emits. That is
 * what took out the `.ptah/specs` index watcher (`tasks:changed` never pushed
 * outside VS Code) and the workspace file index's recursive watch.
 *
 * The fix is to do on our side what chokidar stopped doing: watch a real
 * DIRECTORY, and filter its events against the glob.
 *
 * ## What the plan decides
 *
 * 1. {@link GlobWatchPlan.watchRoot} — the directory to hand chokidar. It is
 *    the glob's static prefix (`picomatch.scan().base`) resolved against `cwd`,
 *    walked UP to the nearest ancestor that exists. The walk matters: chokidar
 *    does not pick up a watch path created after `watch()` returns, and
 *    `.ptah/specs/` legitimately does not exist in a workspace that has never
 *    used tasks — without the walk that watcher would be dead for the session,
 *    which is the exact failure this file exists to end.
 * 2. {@link GlobWatchPlan.ignores} — what chokidar must not descend into. This
 *    is a PRUNE, not a filter: it is consulted for directories, so returning
 *    true for `node_modules` keeps the whole subtree unwatched. It covers both
 *    the caller's excludes and, when the walk above widened the root, every
 *    branch that cannot lead to the target directory.
 * 3. {@link GlobWatchPlan.matches} — which absolute paths are actually the
 *    caller's, i.e. what may be emitted.
 *
 * Pure and injectable (`exists`) so the walk is testable without a filesystem.
 * Not a port: no `PLATFORM_TOKENS` entry, no adapter — a shared mechanism the
 * two Node adapters both call, exactly like `path-containment.ts`.
 */

import * as fs from 'fs';
import * as path from 'path';
import picomatch from 'picomatch';

export interface GlobWatchPlanOptions {
  /** Globs whose matches must never be watched or emitted. */
  readonly exclude?: readonly string[];
  /** Directory the pattern is relative to. Defaults to `process.cwd()`. */
  readonly cwd?: string;
  /** Existence probe, injectable for tests. Defaults to `fs.existsSync`. */
  readonly exists?: (candidate: string) => boolean;
}

export interface GlobWatchPlan {
  /** Absolute directory to hand `chokidar.watch`. */
  readonly watchRoot: string;
  /** Whether an absolute path is one the caller asked for. */
  matches(absolutePath: string): boolean;
  /** Whether chokidar must skip (and not descend into) an absolute path. */
  ignores(absolutePath: string): boolean;
}

/** Absolute path → forward-slashed, for picomatch and for prefix compares. */
function toPosix(absolutePath: string): string {
  return path.resolve(absolutePath).replace(/\\/g, '/');
}

/** Whether `candidate` is `base` or sits underneath it. Lexical, like `path-containment.ts`. */
function isAtOrUnder(candidate: string, base: string): boolean {
  return candidate === base || candidate.startsWith(`${base}/`);
}

/**
 * Walk up from `target` until a directory that exists is found, never going
 * above `ceiling`. Returns `ceiling` when nothing below it exists yet.
 */
function nearestExisting(
  target: string,
  ceiling: string,
  exists: (candidate: string) => boolean,
): string {
  let current = target;
  while (isAtOrUnder(current, ceiling) && current !== ceiling) {
    if (exists(current)) return current;
    const parent = toPosix(path.dirname(current));
    if (parent === current) break;
    current = parent;
  }
  return ceiling;
}

export function planGlobWatch(
  pattern: string,
  options?: GlobWatchPlanOptions,
): GlobWatchPlan {
  const exists = options?.exists ?? fs.existsSync;
  const cwd = toPosix(options?.cwd ?? process.cwd());

  // The glob's static prefix — `.ptah/specs/**` yields `.ptah/specs`, so we
  // watch that subtree rather than the whole workspace. A pattern that opens
  // with a wildcard yields '', which correctly falls back to `cwd`.
  const base = toPosix(path.resolve(cwd, picomatch.scan(pattern).base));
  const target = isAtOrUnder(base, cwd) ? base : cwd;
  const watchRoot = nearestExisting(target, cwd, exists);

  const includes = picomatch(pattern, { dot: true });
  const excludeGlobs = options?.exclude ?? [];
  const excludes =
    excludeGlobs.length > 0
      ? picomatch([...excludeGlobs], { dot: true })
      : (): boolean => false;

  /**
   * Path relative to `cwd`, forward-slashed — the form both glob sets are
   * written against. `null` means the path escaped `cwd` entirely.
   */
  const relativize = (absolutePath: string): string | null => {
    const abs = toPosix(absolutePath);
    if (!isAtOrUnder(abs, cwd)) return null;
    return abs === cwd ? '' : abs.slice(cwd.length + 1);
  };

  return {
    watchRoot,
    matches(absolutePath: string): boolean {
      const rel = relativize(absolutePath);
      if (rel === null || rel === '') return false;
      return includes(rel) && !excludes(rel);
    },
    ignores(absolutePath: string): boolean {
      const abs = toPosix(absolutePath);
      const rel = relativize(abs);
      if (rel === null) return true;
      if (rel !== '' && excludes(rel)) return true;
      // Only reachable when `nearestExisting` widened the root above the
      // target: prune every branch that is neither inside the target nor on
      // the way down to it, so a missing `.ptah/specs/` never costs a
      // recursive watch of the entire workspace.
      if (watchRoot === target) return false;
      return !isAtOrUnder(abs, target) && !isAtOrUnder(target, abs);
    },
  };
}
