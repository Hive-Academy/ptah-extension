import type { GitFileStatus } from '@ptah-extension/shared';
import type { Logger } from '../../logging';
import type { GitWriteRunner } from './git-write-lock';

/** Line counts of one path against HEAD; `null` counts mean unknown. */
export type ChangeSetLineCounts = Pick<
  GitFileStatus,
  'additions' | 'deletions' | 'binary'
>;

/**
 * git's empty tree (`git hash-object -t tree /dev/null`). git resolves it in
 * every SHA-1 repository whether or not it is stored, so it stands in for HEAD
 * on an unborn branch: every file then counts as added.
 */
export const EMPTY_TREE_SHA = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';

/**
 * Characters of pathspec argv per git run. Windows refuses a command line
 * past 32,767 characters, and a turn's change set can name 2,000 paths.
 */
const PATHSPEC_CHUNK_CHARS = 16 * 1024;

/**
 * Pathspec magic: `top` makes the path repository-root relative (status and
 * numstat report root-relative paths even when the workspace is a
 * subdirectory); `literal` keeps `*`, `[` and a leading `:` from being read as
 * glob or magic.
 */
const LITERAL_FROM_TOP = ':(top,literal)';

export interface GitChangeSetNumstatReaderDeps {
  /** The service's read runner. */
  readonly exec: GitWriteRunner;
  readonly logger: Logger;
  /** The service's `git diff --numstat -z` parser, keyed by new path. */
  readonly parseNumstat: (stdout: string) => Map<string, ChangeSetLineCounts>;
  /** The service's `git rev-parse --show-toplevel`; null when git failed. */
  readonly resolveRepositoryRoot: (
    workspacePath: string,
  ) => Promise<string | null>;
  /**
   * The service's untracked-file line counter (bounded per file size);
   * `relativePath` is relative to `repositoryRoot`.
   */
  readonly countUntracked: (
    repositoryRoot: string,
    relativePath: string,
  ) => Promise<ChangeSetLineCounts>;
  /** Untracked files counted per read; the rest report unknown counts. */
  readonly maxUntrackedFiles: number;
}

/**
 * Line counts against HEAD for the paths one agent turn changed
 * (TASK_2026_576 Component 19).
 *
 * ```
 * git rev-parse --verify --quiet HEAD        exit 1 -> empty tree (unborn)
 * git diff --numstat -z --find-renames --end-of-options <base> -- <paths>
 * git ls-files -z --others --exclude-standard --full-name -- <not in diff>
 *   untracked -> git rev-parse --show-toplevel, then the service's
 *                untracked counter on <top level>/<path>
 *   otherwise -> 0 / 0 (no difference from HEAD)
 * ```
 *
 * Every requested path gets an entry. A count git could not produce is
 * `null` with `binary` unset (a binary file is `null` with `binary: true`), so
 * a caller can tell "unavailable" from "binary".
 */
export class GitChangeSetNumstatReader {
  constructor(private readonly deps: GitChangeSetNumstatReaderDeps) {}

  async read(
    workspacePath: string,
    paths: readonly string[],
  ): Promise<Map<string, ChangeSetLineCounts>> {
    const requested = [...new Set(paths)];
    const result = new Map<string, ChangeSetLineCounts>(
      requested.map((p) => [p, unknownCounts()]),
    );
    const safe = requested.filter(isSafeRelativePath);
    if (safe.length === 0) return result;

    try {
      const base = await this.resolveBase(workspacePath);
      if (base === null) {
        this.warn(workspacePath, 'HEAD could not be resolved');
        return result;
      }

      const counted = await this.readDiffNumstat(workspacePath, base, safe);
      if (counted === null) {
        this.warn(workspacePath, 'git diff --numstat failed');
        return result;
      }
      const notInDiff: string[] = [];
      for (const p of safe) {
        const counts = counted.get(p);
        if (counts) result.set(p, counts);
        else notInDiff.push(p);
      }
      if (notInDiff.length === 0) return result;

      const untracked = await this.listUntracked(workspacePath, notInDiff);
      if (untracked === null) {
        this.warn(workspacePath, 'git ls-files --others failed');
        return result;
      }
      // `--full-name` paths are root-relative: read the files from the top
      // level, which is not the workspace when it is a subdirectory.
      const repositoryRoot =
        untracked.size > 0
          ? await this.deps.resolveRepositoryRoot(workspacePath)
          : null;
      if (untracked.size > 0 && repositoryRoot === null) {
        this.warn(workspacePath, 'the repository top level is unknown');
      }
      let untrackedRead = 0;
      for (const p of notInDiff) {
        if (!untracked.has(p)) {
          // Neither in the diff nor untracked: it matches HEAD (or is gone
          // and never was in HEAD).
          result.set(p, { additions: 0, deletions: 0, binary: false });
        } else if (
          repositoryRoot !== null &&
          untrackedRead++ < this.deps.maxUntrackedFiles
        ) {
          result.set(p, await this.deps.countUntracked(repositoryRoot, p));
        }
      }
      return result;
    } catch (error: unknown) {
      // degradation-audit: reported - logged here; the paths not yet counted
      // keep null counts, which the change-set card shows as unavailable.
      this.warn(
        workspacePath,
        error instanceof Error ? error.message : String(error),
      );
      return result;
    }
  }

  /** HEAD's SHA, the empty tree on an unborn branch, null when git failed. */
  private async resolveBase(workspacePath: string): Promise<string | null> {
    const { stdout, exitCode } = await this.deps.exec(
      ['rev-parse', '--verify', '--quiet', 'HEAD'],
      workspacePath,
    );
    if (exitCode === 1) return EMPTY_TREE_SHA;
    const sha = stdout.trim();
    return exitCode === 0 && sha.length > 0 ? sha : null;
  }

  private async readDiffNumstat(
    workspacePath: string,
    base: string,
    paths: readonly string[],
  ): Promise<Map<string, ChangeSetLineCounts> | null> {
    const counted = new Map<string, ChangeSetLineCounts>();
    for (const chunk of chunkPathspecs(paths)) {
      const { stdout, exitCode } = await this.deps.exec(
        [
          'diff',
          '--numstat',
          '-z',
          '--find-renames',
          '--end-of-options',
          base,
          '--',
          ...chunk,
        ],
        workspacePath,
      );
      if (exitCode !== 0) return null;
      for (const [p, counts] of this.deps.parseNumstat(stdout)) {
        counted.set(p, counts);
      }
    }
    return counted;
  }

  private async listUntracked(
    workspacePath: string,
    paths: readonly string[],
  ): Promise<Set<string> | null> {
    const untracked = new Set<string>();
    for (const chunk of chunkPathspecs(paths)) {
      const { stdout, exitCode } = await this.deps.exec(
        [
          'ls-files',
          '-z',
          '--others',
          '--exclude-standard',
          '--full-name',
          '--',
          ...chunk,
        ],
        workspacePath,
      );
      if (exitCode !== 0) return null;
      for (const p of stdout.split('\0')) if (p) untracked.add(p);
    }
    return untracked;
  }

  private warn(workspacePath: string, reason: string): void {
    this.deps.logger.warn(
      `[GitChangeSetNumstatReader] line counts unavailable for ${workspacePath}: ${reason}`,
    );
  }
}

function unknownCounts(): ChangeSetLineCounts {
  return { additions: null, deletions: null };
}

/**
 * A repository-relative path git may receive as a pathspec: non-empty, not
 * absolute, no `..` segment, no NUL.
 */
function isSafeRelativePath(p: string): boolean {
  if (typeof p !== 'string' || p.trim().length === 0) return false;
  if (p.includes('\0')) return false;
  const normalized = p.replaceAll('\\', '/');
  if (normalized.startsWith('/') || /^[A-Za-z]:/.test(normalized)) {
    return false;
  }
  return !normalized.split('/').some((segment) => segment === '..');
}

/** Literal, root-relative pathspecs, split so no argv passes the budget. */
function chunkPathspecs(paths: readonly string[]): string[][] {
  const chunks: string[][] = [];
  let current: string[] = [];
  let size = 0;
  for (const p of paths) {
    const spec = `${LITERAL_FROM_TOP}${p}`;
    if (current.length > 0 && size + spec.length + 1 > PATHSPEC_CHUNK_CHARS) {
      chunks.push(current);
      current = [];
      size = 0;
    }
    current.push(spec);
    size += spec.length + 1;
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}
