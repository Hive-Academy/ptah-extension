/**
 * resolveGoBinary — find the user's installed `go` command without trusting
 * the workspace, the host's current directory or `PATHEXT` (TASK_2026_559
 * Batch 37a, O2 §4.1).
 *
 * `which` is not used: on win32 it searches `process.cwd()` first and honours
 * the inherited `PATHEXT`, so a `go.cmd` in whatever directory the host
 * happens to run in could win. This resolver instead:
 *
 * 1. reads the parent `PATH` (win32: the key case-insensitively), splits it on
 *    the platform delimiter and strips one pair of surrounding quotes;
 * 2. keeps absolute entries only — on win32 UNC and device paths (`\\server`,
 *    `\\?\`, `\\.\`) and drive-relative entries (`C:foo`, `\foo`) are dropped;
 * 3. canonicalises each directory and drops one that fails, that equals or
 *    lies inside the checked root, or inside the host user-data directory,
 *    then de-duplicates;
 * 4. looks for exactly `go.exe` (win32) or `go` (elsewhere) — no other name,
 *    no `PATHEXT`, no current directory;
 * 5. accepts a candidate only when it is a regular file (POSIX: executable)
 *    whose canonical path is outside the root and, on win32, ends in `.exe`
 *    (a `go.exe` link to a `.cmd` wrapper is refused);
 * 6. keeps searching past a rejected candidate, so a hostile early entry
 *    cannot hide a valid installed toolchain.
 *
 * The directories kept in step 3 are the child's whole `PATH`.
 */

import * as fs from 'fs';
import * as path from 'path';
import { isPathWithinRoots } from '@ptah-extension/platform-core';

/** What a consent grant records about the binary it was given for. */
export interface GoBinaryIdentity {
  /** Canonical absolute path of the accepted binary. */
  readonly path: string;
  readonly size: number;
  readonly mtimeMs: number;
}

/** An accepted binary and the sanitised directories the child may search. */
export interface ResolvedGoBinary extends GoBinaryIdentity {
  /** The step-3 directories, canonical, in PATH order: the child's `PATH`. */
  readonly pathDirs: readonly string[];
}

/** The file-system calls the resolver makes; injectable for the specs. */
export interface GoBinaryFileSystem {
  /** Canonical path (symlinks and junctions resolved); throws when absent. */
  realpath(target: string): string;
  /** `stat` (follows links); throws when absent. */
  stat(target: string): {
    isFile(): boolean;
    readonly size: number;
    readonly mtimeMs: number;
  };
  /** POSIX execute permission for the current user. */
  isExecutable(target: string): boolean;
}

export interface ResolveGoBinaryOptions {
  /** The workspace being checked; nothing inside it is ever run. */
  readonly workspaceRoot: string;
  /** The parent environment. Only its PATH is read. */
  readonly env: Readonly<Record<string, string | undefined>>;
  /** The host user-data directory; nothing inside it is ever run. */
  readonly userDataPath?: string;
  readonly platform?: NodeJS.Platform;
  readonly fileSystem?: GoBinaryFileSystem;
}

const NODE_FILE_SYSTEM: GoBinaryFileSystem = {
  realpath: (target) => fs.realpathSync.native(target),
  stat: (target) => fs.statSync(target),
  isExecutable: (target) => {
    try {
      fs.accessSync(target, fs.constants.X_OK);
      return true;
    } catch (error: unknown) {
      // degradation-audit: optional-capability - a missing execute bit is the
      // answer this probe exists to give; the candidate is skipped, not run.
      void error;
      return false;
    }
  },
};

/**
 * Read an environment variable; on win32 the key is matched without case,
 * because a Windows environment block names it `Path` as often as `PATH`.
 */
export function readEnvVariable(
  env: Readonly<Record<string, string | undefined>>,
  name: string,
  platform: NodeJS.Platform,
): string | undefined {
  const exact = env[name];
  if (exact !== undefined || platform !== 'win32') return exact;
  const wanted = name.toLowerCase();
  for (const key of Object.keys(env)) {
    if (key.toLowerCase() === wanted) return env[key];
  }
  return undefined;
}

function stripQuotes(entry: string): string {
  const trimmed = entry.trim();
  if (trimmed.length >= 2 && trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

/** Step 2: is this PATH entry an absolute, local directory name? */
function isAcceptableEntry(entry: string, platform: NodeJS.Platform): boolean {
  if (entry.length === 0) return false;
  if (platform === 'win32') {
    // UNC (`\\server\share`), device (`\\?\`, `\\.\`) and their slash forms.
    if (/^[\\/]{2}/.test(entry)) return false;
    // Drive-relative: `C:foo` resolves against that drive's current directory.
    if (/^[A-Za-z]:(?![\\/])/.test(entry)) return false;
  }
  // Rooted without a drive (`\foo`) is relative to the current drive on a
  // Windows host, whatever platform the caller names.
  if (process.platform === 'win32' && /^[\\/](?![\\/])/.test(entry)) {
    return false;
  }
  return path.isAbsolute(entry);
}

function canonicalOrNull(
  fileSystem: GoBinaryFileSystem,
  target: string,
): string | null {
  try {
    return fileSystem.realpath(target);
  } catch (error: unknown) {
    // degradation-audit: optional-capability - a PATH entry or candidate that
    // does not resolve is dropped from the search; the next one is tried.
    void error;
    return null;
  }
}

/** Both spellings of a directory: as given and canonical (when it resolves). */
function spellingsOf(
  fileSystem: GoBinaryFileSystem,
  directory: string | undefined,
): string[] {
  if (directory === undefined || directory.length === 0) return [];
  const resolved = path.resolve(directory);
  const canonical = canonicalOrNull(fileSystem, resolved);
  return canonical === null || canonical === resolved
    ? [resolved]
    : [resolved, canonical];
}

/**
 * Step 1-3: the parent PATH reduced to canonical, absolute directories that
 * are neither inside the workspace nor inside the host user-data directory.
 */
export function sanitisedPathDirectories(
  options: ResolveGoBinaryOptions,
): string[] {
  const platform = options.platform ?? process.platform;
  const fileSystem = options.fileSystem ?? NODE_FILE_SYSTEM;
  const rawPath = readEnvVariable(options.env, 'PATH', platform) ?? '';
  const delimiter = platform === 'win32' ? ';' : ':';
  const forbidden = [
    ...spellingsOf(fileSystem, options.workspaceRoot),
    ...spellingsOf(fileSystem, options.userDataPath),
  ];
  const kept: string[] = [];
  const seen = new Set<string>();
  for (const rawEntry of rawPath.split(delimiter)) {
    const entry = stripQuotes(rawEntry);
    if (!isAcceptableEntry(entry, platform)) continue;
    const canonical = canonicalOrNull(fileSystem, entry);
    if (canonical === null) continue;
    if (
      forbidden.length > 0 &&
      (isPathWithinRoots(canonical, forbidden, platform) ||
        isPathWithinRoots(path.resolve(entry), forbidden, platform))
    ) {
      continue;
    }
    const identity = platform === 'win32' ? canonical.toLowerCase() : canonical;
    if (seen.has(identity)) continue;
    seen.add(identity);
    kept.push(canonical);
  }
  return kept;
}

/** Steps 4-5 for one directory: the accepted binary, or `null`. */
function acceptCandidate(
  directory: string,
  platform: NodeJS.Platform,
  fileSystem: GoBinaryFileSystem,
  forbidden: readonly string[],
): GoBinaryIdentity | null {
  const candidate = path.join(
    directory,
    platform === 'win32' ? 'go.exe' : 'go',
  );
  const canonical = canonicalOrNull(fileSystem, candidate);
  if (canonical === null) return null;
  if (
    forbidden.length > 0 &&
    isPathWithinRoots(canonical, forbidden, platform)
  ) {
    return null;
  }
  if (platform === 'win32' && !canonical.toLowerCase().endsWith('.exe')) {
    return null;
  }
  let stats: ReturnType<GoBinaryFileSystem['stat']>;
  try {
    stats = fileSystem.stat(canonical);
  } catch (error: unknown) {
    // degradation-audit: optional-capability - a candidate that cannot be
    // stat'ed is skipped and the search continues (step 6).
    void error;
    return null;
  }
  if (!stats.isFile()) return null;
  if (platform !== 'win32' && !fileSystem.isExecutable(canonical)) {
    return null;
  }
  return { path: canonical, size: stats.size, mtimeMs: stats.mtimeMs };
}

/**
 * The installed `go` binary the checker may run for `workspaceRoot`, or
 * `null` when no PATH directory holds an acceptable one.
 */
export function resolveGoBinary(
  options: ResolveGoBinaryOptions,
): ResolvedGoBinary | null {
  const platform = options.platform ?? process.platform;
  const fileSystem = options.fileSystem ?? NODE_FILE_SYSTEM;
  const pathDirs = sanitisedPathDirectories(options);
  const forbidden = [
    ...spellingsOf(fileSystem, options.workspaceRoot),
    ...spellingsOf(fileSystem, options.userDataPath),
  ];
  for (const directory of pathDirs) {
    const accepted = acceptCandidate(
      directory,
      platform,
      fileSystem,
      forbidden,
    );
    if (accepted !== null) return { ...accepted, pathDirs };
  }
  return null;
}

/** Same binary, compared the way the platform compares paths. */
export function isSameGoBinary(
  a: GoBinaryIdentity,
  b: GoBinaryIdentity,
  platform: NodeJS.Platform = process.platform,
): boolean {
  const samePath =
    platform === 'win32'
      ? a.path.toLowerCase() === b.path.toLowerCase()
      : a.path === b.path;
  return samePath && a.size === b.size && a.mtimeMs === b.mtimeMs;
}
