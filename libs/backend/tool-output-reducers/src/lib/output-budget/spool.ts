/**
 * The spool (TASK_2026_559, moved here by TASK_2026_597 D8): where the full
 * text of an over-budget tool result is saved, so a reduced answer can name a
 * file that holds what it withheld.
 *
 * Files go to `<spoolRoot>/.ptah/tmp/mcp-out/<id>-<epoch ms>-<4 hex>.txt`, or
 * under `os.tmpdir()` when the root is relative or empty. A file is created
 * exclusively (never overwritten), and writing one prunes this module's own
 * files older than 24 hours from its directory, at most every ten minutes.
 * Nothing here throws: a failure comes back as an errno code or a built-in
 * error name, never as an error message (a message can carry paths or
 * content).
 */
import { randomBytes } from 'node:crypto';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

/** The JSON-RPC id (or any call id) a spool file name is derived from. */
export type SpoolRequestId = string | number | null | undefined;

/** Where {@link spoolToolText} saved the text, or why it could not (an errno code or error name). */
export type SpoolOutcome =
  | {
      readonly path: string;
      /** Errno code or error name when the `.gitignore` could not be written (EEXIST is not one); the file was still spooled. */
      readonly gitignoreFailure?: string;
    }
  | { readonly failure: string };

/** Where spool files go, and how a relative locator names the root. */
export interface SpoolLocation {
  readonly dir: string;
  readonly rootLabel: 'workspace root' | 'system temp directory';
}

/** Relative location of the spool directory under the spool root. */
const SPOOL_SUBDIR = path.join('.ptah', 'tmp', 'mcp-out');
/** Spool files older than this are deleted when a new one is written. */
const SPOOL_MAX_AGE_MS = 24 * 60 * 60 * 1000;
/** A directory is pruned at most this often (a day of spools can be many files). */
const SPOOL_PRUNE_INTERVAL_MS = 10 * 60 * 1000;
/** Spool directories whose last prune time is remembered; the map is cleared past this. */
const MAX_PRUNE_ENTRIES = 64;
/** Fresh names tried when one already exists. */
const SPOOL_NAME_ATTEMPTS = 8;
/** Longest id part of a spool file name. */
const MAX_ID_CHARS = 64;
/** Names this module writes; pruning never touches anything else. */
const SPOOL_FILE_NAME = /^[A-Za-z0-9_-]{1,64}-\d{1,16}-[0-9a-f]{4}\.txt$/;

/**
 * Error names a trailer or log line may print. A custom `name` is arbitrary
 * text (a path, content), so anything else prints as `Error`.
 */
const REPORTED_ERROR_NAMES: ReadonlySet<string> = new Set([
  'Error',
  'TypeError',
  'RangeError',
  'SyntaxError',
  'ReferenceError',
  'EvalError',
  'URIError',
  'AggregateError',
]);

/** Last prune time per spool directory, for {@link SPOOL_PRUNE_INTERVAL_MS}. */
const lastPruneByDir = new Map<string, number>();

/**
 * Spool directories whose `.gitignore` failure was already reported, so a
 * directory that can never take the file is reported once, not per call. A
 * success is not cached: a directory deleted and recreated is retried.
 */
const reportedGitignoreFailureDirs = new Set<string>();

/**
 * The spool directory under an absolute `spoolRoot`, else under
 * `os.tmpdir()`, and which of the two a relative locator names.
 */
export function spoolLocation(spoolRoot: string): SpoolLocation {
  const usable =
    typeof spoolRoot === 'string' &&
    spoolRoot.trim() !== '' &&
    path.isAbsolute(spoolRoot);
  const tmp = path.resolve(os.tmpdir());
  const root = usable ? path.resolve(spoolRoot) : tmp;
  return {
    dir: path.join(root, SPOOL_SUBDIR),
    rootLabel: root === tmp ? 'system temp directory' : 'workspace root',
  };
}

/**
 * `<sanitised id>-<epoch ms>-<4 hex>.txt`; the id keeps only
 * `[A-Za-z0-9_-]`, so a name never leaves the spool directory.
 */
export function spoolFileName(
  requestId: SpoolRequestId,
  hex = randomBytes(2).toString('hex'),
): string {
  const id =
    String(requestId ?? '')
      .replace(/[^A-Za-z0-9_-]/g, '_')
      .slice(0, MAX_ID_CHARS) || 'call';
  return `${id}-${Date.now()}-${hex}.txt`;
}

/** `spoolPath` named relative to its root: `.ptah/tmp/mcp-out/<name> under the <root label>`. */
export function relativeLocator(
  spoolPath: string,
  location: SpoolLocation,
): string {
  const relative = path.join(SPOOL_SUBDIR, path.basename(spoolPath));
  return `${relative} under the ${location.rootLabel}`;
}

/**
 * A spool file written by {@link spoolToolText} under `spoolRoot`, named
 * relative to that root (`.ptah/tmp/mcp-out/<name> under the workspace
 * root`). Its length is bounded (the file name's id part is at most 64
 * chars), whatever the length of the root itself.
 */
export function relativeSpoolLocator(
  spoolPath: string,
  spoolRoot: string,
): string {
  return relativeLocator(spoolPath, spoolLocation(spoolRoot));
}

/**
 * Saves `text` to a fresh spool file, in the same directory, with the same
 * naming and pruning as the full output of an over-budget result. For a
 * formatter that keeps its result within the budget itself and names the
 * saved text inside that result. Never throws.
 */
export function spoolToolText(
  text: string,
  spoolRoot: string,
  requestId: SpoolRequestId,
): Promise<SpoolOutcome> {
  return writeSpoolFile(text, spoolLocation(spoolRoot).dir, requestId);
}

/**
 * Writes `raw` to a fresh file in `dir`. The exclusive-create flag means an
 * existing file (two sessions with the same JSON-RPC id in the same
 * millisecond and the same random suffix) is never overwritten: another name
 * is tried. A partial file left by a failed write is removed. Never throws.
 */
export async function writeSpoolFile(
  raw: string,
  dir: string,
  requestId: SpoolRequestId,
): Promise<SpoolOutcome> {
  try {
    await fs.mkdir(dir, { recursive: true });
    const gitignoreFailure = await ensureSpoolGitignore(dir);
    for (let attempt = 0; attempt < SPOOL_NAME_ATTEMPTS; attempt++) {
      const file = path.join(dir, spoolFileName(requestId));
      try {
        await fs.writeFile(file, raw, { encoding: 'utf8', flag: 'wx' });
      } catch (error) {
        if (errorCode(error) === 'EEXIST') {
          continue;
        }
        // degradation-audit: reported — best-effort removal of the partial
        // file; the write failure itself is rethrown on the next line.
        await fs.rm(file, { force: true }).catch(() => undefined);
        throw error;
      }
      await pruneSpoolDirectory(dir);
      return gitignoreFailure === undefined
        ? { path: file }
        : { path: file, gitignoreFailure };
    }
    return { failure: 'no free spool file name' };
  } catch (error) {
    return { failure: errorCode(error) ?? errorName(error) };
  }
}

/**
 * Writes `<dir>/.gitignore` containing `*` when none exists, so spooled raw
 * tool output (which may hold secrets) is never committed from a user repo.
 * The exclusive-create flag leaves an existing file alone (`EEXIST`, the
 * normal case, is not a failure). Fail-open: any other failure is returned as
 * its errno code or error name, so the caller can report it, and the spool
 * proceeds. The failure is returned once per directory; later calls for the
 * same directory return `undefined` so it is logged once.
 */
async function ensureSpoolGitignore(dir: string): Promise<string | undefined> {
  try {
    await fs.writeFile(path.join(dir, '.gitignore'), '*\n', {
      encoding: 'utf8',
      flag: 'wx',
    });
    return undefined;
  } catch (error) {
    const code = errorCode(error);
    return code === 'EEXIST' || !markGitignoreFailureReported(dir)
      ? undefined
      : (code ?? errorName(error));
  }
}

/** True the first time a directory's `.gitignore` failure is seen, false after. */
function markGitignoreFailureReported(dir: string): boolean {
  if (reportedGitignoreFailureDirs.has(dir)) {
    return false;
  }
  if (reportedGitignoreFailureDirs.size >= MAX_PRUNE_ENTRIES) {
    // Forgetting only costs one repeated report for some directory.
    reportedGitignoreFailureDirs.clear();
  }
  reportedGitignoreFailureDirs.add(dir);
  return true;
}

/**
 * Best effort: deletes this module's spool files older than 24 hours, at
 * most once per {@link SPOOL_PRUNE_INTERVAL_MS} per directory. Every failure
 * (a file removed concurrently, a permission error) is ignored.
 */
async function pruneSpoolDirectory(dir: string): Promise<void> {
  const now = Date.now();
  const last = lastPruneByDir.get(dir);
  if (last !== undefined && now - last < SPOOL_PRUNE_INTERVAL_MS) {
    return;
  }
  if (lastPruneByDir.size >= MAX_PRUNE_ENTRIES) {
    // Forgetting only costs an early prune of some directory.
    lastPruneByDir.clear();
  }
  lastPruneByDir.set(dir, now);
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile() || !SPOOL_FILE_NAME.test(entry.name)) {
        continue;
      }
      const file = path.join(dir, entry.name);
      try {
        const stat = await fs.stat(file);
        if (now - stat.mtimeMs > SPOOL_MAX_AGE_MS) {
          await fs.unlink(file);
        }
      } catch {
        // Removed or locked by someone else: skip it.
      }
    }
  } catch {
    // The directory could not be listed; pruning is best effort.
  }
}

/** The errno code of `error` when it is one (`EACCES`, `EROFS`…), else `undefined`. */
function errorCode(error: unknown): string | undefined {
  try {
    const code = (error as { code?: unknown } | null)?.code;
    return typeof code === 'string' && /^E[A-Z0-9]{1,30}$/.test(code)
      ? code
      : undefined;
  } catch {
    // degradation-audit: reported — a throwing `code` getter only loses the
    // errno; the caller still reports the failure, by `errorName` instead.
    return undefined;
  }
}

/** A fixed classification of `error`: a built-in error name, `Error`, or the `typeof`. */
export function errorName(error: unknown): string {
  try {
    if (!(error instanceof Error)) {
      return typeof error;
    }
    const name: unknown = error.name;
    return typeof name === 'string' && REPORTED_ERROR_NAMES.has(name)
      ? name
      : 'Error';
  } catch {
    // degradation-audit: reported — a throwing `name` getter is classified
    // as `Error`; the failure is still reported under that name.
    return 'Error';
  }
}
