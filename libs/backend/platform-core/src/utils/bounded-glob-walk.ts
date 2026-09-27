/**
 * A glob walk that holds bounded state, for `IFileSystemProvider.findFiles`
 * calls that carry `maxResults` in the Electron and CLI adapters.
 *
 * fast-glob reads each directory whole (`readdir`) and pushes every match of
 * it into its stream without backpressure, so stopping at a result limit
 * still leaves one directory's matches buffered: a flat directory of 2,000
 * matches emitted 2,000 for a limit of 5 (TASK_2026_559 Batch 23b review r2
 * M1). This walk instead:
 * - reads each directory through `fs.promises.opendir`, a buffer at a time;
 * - goes depth first, so it holds one open directory per level, never a queue
 *   of pending directories;
 * - prunes a directory an exclude glob matches instead of walking it, and
 *   never descends deeper than a pattern without `**` can match;
 * - yields one match at a time, so a consumer that stops (see
 *   `collectBounded`) closes every open directory through the generator's
 *   `return()`.
 *
 * It returns the same files as the adapters' unlimited fast-glob call
 * (review r3 S1, pinned by table-driven parity specs):
 * - patterns and excludes are matched with picomatch (the matcher fast-glob's
 *   micromatch is built on) against paths relative to `cwd`, with the same
 *   `dot` for both, as fast-glob's ignore filter uses; an absolute pattern is
 *   matched against absolute paths; a leading `./` is dropped;
 * - a pattern without glob syntax is a literal path, answered with one
 *   `stat` (a file that exists, not excluded), as fast-glob's static reader
 *   does, whatever `dot` is;
 * - files only, absolute forward-slashed results; symbolic links followed (a
 *   link back into a directory being walked is a cycle and is not entered).
 *
 * A pattern's static prefix is decoded before it reaches the file system
 * (`src/\[id\]` is the directory `src/[id]`), while matching keeps the
 * escaped pattern, as fast-glob does (review r4 S1).
 *
 * I/O failures are never silent (reviews r3 B1, r4 B1). The search root
 * (`cwd`) must be a readable directory: any failure there, ENOENT and
 * ENOTDIR included, is reported and nothing is walked. That holds for the
 * whole walk, not only its first `stat` (Batch 25a, review r5 M1): opening
 * `cwd` itself failing with ENOENT is a root failure, and any other ENOENT
 * re-checks `cwd` ({@link searchRootFailure}), so a root renamed or removed
 * after the first check is reported, never read as an empty tree. Below a
 * root that is still there, ENOENT is a benign race (the entry vanished
 * between listing and reading; fast-glob suppresses it too); every other
 * failure (EIO, EACCES, EPERM, ELOOP, ...) is reported to `onFailure` with
 * its code, and the walk continues with the remaining entries. The adapters
 * turn any reported failure into an {@link IncompleteFileSearchError}, so a
 * caller can never read an unread directory as "no files".
 *
 * State held: one open directory handle, one real path and one read buffer
 * per level of depth.
 */
import * as fs from 'fs';
import * as path from 'path';
import picomatch from 'picomatch';

export interface BoundedGlobWalkOptions {
  /** Globs (relative to `cwd`) whose matches are skipped, directories pruned. */
  readonly exclude?: readonly string[];
  /** Directory the pattern is relative to. Defaults to `process.cwd()`. */
  readonly cwd?: string;
  /** Whether `*` and `**` match names starting with a dot. */
  readonly dot: boolean;
  /**
   * Called once per path that could not be read, with the error code (or
   * `UNKNOWN`). A missing, non-directory or unreadable `cwd` is always
   * reported (ENOENT and ENOTDIR included); below it, ENOENT (an entry that
   * vanished during the walk) is not.
   */
  readonly onFailure: (code: string) => void;
}

/** What a search could not read: how many paths, by error code. */
export interface FileSearchFailures {
  readonly total: number;
  readonly byCode: Readonly<Record<string, number>>;
}

/**
 * A `findFiles` result that is known to be incomplete: some directories or
 * links could not be read. `matches` holds what was found; `failures` says
 * how much was not read and why. The message carries counts only, never a
 * path.
 */
export class IncompleteFileSearchError extends Error {
  constructor(
    readonly matches: readonly string[],
    readonly failures: FileSearchFailures,
  ) {
    super(
      `File search incomplete: ${failures.total} path(s) could not be read (${Object.entries(
        failures.byCode,
      )
        .map(([code, count]) => `${code} ${count}`)
        .join(', ')}).`,
    );
    this.name = 'IncompleteFileSearchError';
  }
}

/** Tallies walk failures for {@link IncompleteFileSearchError}. */
export function createFailureTally(): {
  readonly onFailure: (code: string) => void;
  /** The failures so far, or `undefined` when there were none. */
  failures(): FileSearchFailures | undefined;
} {
  const byCode: Record<string, number> = {};
  let total = 0;
  return {
    onFailure: (code) => {
      total++;
      byCode[code] = (byCode[code] ?? 0) + 1;
    },
    failures: () =>
      total === 0 ? undefined : { total, byCode: { ...byCode } },
  };
}

/** Entries `opendir` reads ahead per directory. */
const DIRECTORY_BUFFER_SIZE = 128;

function toPosix(absolutePath: string): string {
  return absolutePath.replace(/\\/g, '/');
}

function errorCode(error: unknown): string {
  return typeof error === 'object' && error !== null && 'code' in error
    ? String((error as { code: unknown }).code)
    : 'UNKNOWN';
}

/**
 * Why `cwd` cannot be searched, as an error code, or `undefined` when it is a
 * directory that `stat` can read. The one root rule every `findFiles` path
 * shares, bounded or not (Batch 25a, review r5 B1): a missing (`ENOENT`),
 * non-directory (`ENOTDIR`) or unreadable root is a failed search, never an
 * empty one.
 */
export async function searchRootFailure(
  cwd: string,
): Promise<string | undefined> {
  try {
    const rootStat = await fs.promises.stat(cwd);
    return rootStat.isDirectory() ? undefined : 'ENOTDIR';
  } catch (error: unknown) {
    // degradation-audit: reported — the code is returned to the caller,
    // which reports it as a failed search (`onFailure` or
    // `IncompleteFileSearchError`); nothing is swallowed.
    return errorCode(error);
  }
}

/**
 * The {@link IncompleteFileSearchError} for a search whose root `cwd` cannot
 * be searched, carrying `matches` (what was found before the root was lost),
 * or `undefined` when the root is a readable directory. For the adapters'
 * unlimited (fast-glob) path, checked before the search and again after it:
 * fast-glob reports a missing `cwd`, or one removed while it runs, as no
 * files (review r5 B1).
 */
export async function searchRootError(
  cwd: string,
  matches: readonly string[],
): Promise<IncompleteFileSearchError | undefined> {
  const code = await searchRootFailure(path.resolve(cwd));
  return code === undefined
    ? undefined
    : new IncompleteFileSearchError(matches, {
        total: 1,
        byCode: { [code]: 1 },
      });
}

/**
 * Every file under `cwd` that `pattern` matches and no exclude glob does, as
 * an absolute forward-slashed path, one at a time.
 */
export async function* walkGlobMatches(
  rawPattern: string,
  options: BoundedGlobWalkOptions,
): AsyncGenerator<string> {
  const pattern = rawPattern.replace(/^\.\/+/, '');
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const absolutePattern = path.isAbsolute(pattern);
  const matcherOptions = { dot: options.dot };
  const excludeGlobs = options.exclude ?? [];
  const excludes =
    excludeGlobs.length > 0
      ? picomatch([...excludeGlobs], matcherOptions)
      : (): boolean => false;
  const relative = (absolute: string): string =>
    toPosix(path.relative(cwd, absolute));

  const cwdSpelling = toPosix(cwd);
  /** Set once the root is reported lost, so it is reported once. */
  let rootLost = false;

  /**
   * Report a failure unless it is the benign ENOENT race below a root that is
   * still there. `directory` is the directory whose opening or reading failed,
   * when there is one: ENOENT on `cwd` itself is the root vanishing after the
   * first check (review r5 M1), never benign. Any other ENOENT re-checks the
   * root, because a root renamed mid-walk surfaces as ENOENT on whatever the
   * walk touches next.
   */
  const failed = async (error: unknown, directory?: string): Promise<void> => {
    const code = errorCode(error);
    if (code !== 'ENOENT') {
      options.onFailure(code);
      return;
    }
    if (rootLost) return;
    const rootCode =
      directory === cwdSpelling ? 'ENOENT' : await searchRootFailure(cwd);
    if (rootCode !== undefined) {
      rootLost = true;
      options.onFailure(rootCode);
    }
  };

  // The search root itself must be a readable directory. A missing, non-
  // directory or unreadable `cwd` is a failure, never an empty answer
  // (review r4 B1): ENOENT is exempt only for entries that vanish below it.
  const rootFailure = await searchRootFailure(cwd);
  if (rootFailure !== undefined) {
    options.onFailure(rootFailure);
    return;
  }

  const scan = picomatch.scan(pattern);
  // The static part of a pattern is glob syntax, not yet a file-system
  // spelling: `src/\[id\]` names the directory `src/[id]` (review r4 S1).
  // Matching keeps the escaped pattern; only file-system calls decode it.
  const staticPath = scan.base.replace(/\\(.)/g, '$1');
  if (!scan.isGlob) {
    // A literal path: one stat, as fast-glob's static reader does.
    const absolute = path.resolve(cwd, staticPath);
    let stat: fs.Stats;
    try {
      stat = await fs.promises.stat(absolute);
    } catch (error: unknown) {
      // degradation-audit: reported — ENOENT is "no such file" (an empty
      // answer, as fast-glob gives) while the root is still there; any other
      // code, or a root gone since the first check, is reported to
      // `onFailure`, which the adapters turn into an incomplete result.
      await failed(error);
      return;
    }
    if (stat.isFile() && !excludes(relative(absolute))) {
      yield toPosix(absolute);
    }
    return;
  }

  const includes = picomatch(pattern, matcherOptions);
  const start = path.resolve(cwd, staticPath);
  // A pattern without `**` (or braces, which can hide a `/`) cannot match
  // below as many levels as it has segments: never walk deeper.
  const maxDepth =
    scan.glob.includes('**') || scan.glob.includes('{')
      ? Number.POSITIVE_INFINITY
      : scan.glob.split('/').length;
  /** Real paths of the directories being walked: a link back into one is a cycle. */
  const ancestors = new Set<string>();

  /** `dir` + `/` + `name`, without doubling a root's own trailing slash. */
  const child = (dir: string, name: string): string =>
    dir.endsWith('/') ? `${dir}${name}` : `${dir}/${name}`;

  /**
   * Walk `directory` (absolute, forward-slashed; `rel` is its path relative
   * to `cwd`, '' for `cwd` itself). Entries are handled inline — one
   * generator per directory, not per entry — and spellings are built by
   * concatenation, so a large flat directory costs little per entry.
   */
  async function* walk(
    directory: string,
    rel: string,
    depth: number,
  ): AsyncGenerator<string> {
    let real: string;
    let handle: fs.Dir;
    try {
      real = await fs.promises.realpath(directory);
      handle = await fs.promises.opendir(directory, {
        bufferSize: DIRECTORY_BUFFER_SIZE,
      });
    } catch (error: unknown) {
      // degradation-audit: reported — an unreadable directory is reported to
      // `onFailure` (ENOENT, a directory removed mid-walk below a root that
      // is still there, excepted), which the adapters turn into an incomplete
      // result; the walk goes on.
      await failed(error, directory);
      return;
    }
    if (ancestors.has(real)) {
      await handle.close();
      return; // a link cycle
    }
    ancestors.add(real);
    try {
      // `for await` closes the handle on completion, a throw and a return.
      for await (const entry of handle) {
        const entryRel = rel === '' ? entry.name : `${rel}/${entry.name}`;
        if (excludes(entryRel)) continue;
        const absolute = child(directory, entry.name);
        let isDirectory = entry.isDirectory();
        let isFile = entry.isFile();
        if (entry.isSymbolicLink()) {
          try {
            const target = await fs.promises.stat(absolute);
            isDirectory = target.isDirectory();
            isFile = target.isFile();
          } catch (error: unknown) {
            // degradation-audit: reported — a dangling link (ENOENT) is
            // neither a file nor a directory, as in fast-glob; any other
            // failure (ELOOP, EACCES) is reported to `onFailure`.
            await failed(error);
            continue;
          }
        }
        if (isDirectory) {
          if (depth + 1 < maxDepth) yield* walk(absolute, entryRel, depth + 1);
        } else if (isFile && includes(absolutePattern ? absolute : entryRel)) {
          yield absolute;
        }
      }
    } catch (error: unknown) {
      // degradation-audit: reported — a read that fails part-way through a
      // directory is reported to `onFailure`; the walk goes on with the rest
      // of the tree. Failures below it are reported by their own walk.
      await failed(error, directory);
    } finally {
      ancestors.delete(real);
    }
  }

  yield* walk(toPosix(start), relative(start), 0);
}
