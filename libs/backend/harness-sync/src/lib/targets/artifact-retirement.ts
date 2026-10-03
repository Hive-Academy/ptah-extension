/**
 * Retire one manifest-owned rival-CLI copy without losing a byte the user put
 * there (TASK_2026_609, code-logic-review findings 1 and 2).
 *
 * The manifest proves Ptah WROTE a path, not that what sits there now is still
 * Ptah's. Two earlier shapes of this rule lost data:
 *
 * - **Hash, then delete.** `hashDir` is a content identity, not an inventory: it
 *   skips `.history`, `_candidates`, `.ptah-origin.json` and the quarantine
 *   store, symlinks, unusual nodes, unreadable subdirectories and anything below
 *   `MAX_DEPTH`. A skill whose `SKILL.md` was untouched but which held the only
 *   copy of `.history/notes.md` hashed "unchanged" and was deleted whole.
 * - **Copy, verify the copy, delete the original.** The verification read the
 *   snapshot, never the object then deleted, so an editor save landing between
 *   the two was deleted with only the older bytes archived.
 *
 * So the order is reversed: DETACH first, DECIDE second. The original is moved
 * with one `rename` into a fresh `{ws}/.ptah/harness/.history/<slug>/<ts>/
 * <relPath>` (same filesystem: both live under the workspace). From then on the
 * decision is made on bytes no other writer can reach, and the original path is
 * never touched again — whatever appears there after the rename is a new object
 * (a save) and stays. A staged copy is discarded only when it is PROVABLY what
 * Ptah wrote: its hash equals the recorded one AND, for a directory, an
 * exhaustive walk finds nothing the hash cannot see. Anything else stays as the
 * snapshot. When the rename cannot happen (EXDEV, a locked file, an unwritable
 * history store) nothing is removed and the caller retries next pass; there is
 * deliberately no copy+delete fallback, because that is the racy shape above.
 */

import type { Dirent, Stats } from 'fs';
import { cp, lstat, mkdir, readdir, rename, rm, rmdir } from 'fs/promises';
import { basename, dirname, join } from 'path';
import {
  hashDir,
  hashFile,
  isIgnoredEntry,
  MAX_DEPTH,
} from '../hash/content-hash';
import { errorCode } from '../fs/windows-retry';
import { HARNESS_STATE_DIR } from '../manifest-store/managed-manifest';
import { describeError, removeManaged, withWindowsRetry } from './copy-engine';

/** Directory under `.ptah/harness` holding copies saved before retirement. */
const LOCAL_EDIT_HISTORY_DIR = '.history';

/** Upper bound on `<ts>-N` suffixes tried when one millisecond is already taken. */
const MAX_SNAPSHOT_SUFFIX = 100;

export interface RetireOwnedArtifactRequest {
  workspaceRoot: string;
  /** Workspace-relative POSIX path of the owned copy. */
  relPath: string;
  /** The kind the manifest recorded: a skill directory, or a single file. */
  isDirectory: boolean;
  /** The hash the manifest recorded for this path. */
  ownedHash: string | undefined;
}

/**
 * - `removed`: the path no longer holds Ptah's copy and nothing was kept, either
 *   because it was already gone or because the detached copy was provably
 *   Ptah's own bytes.
 * - `removed-local-edit`: detached and kept at `snapshotPath`, because it
 *   differed from (or could not be proven equal to) what Ptah wrote.
 * - `failed`: nothing was removed; the copy is still at its original path.
 */
export type RetirementOutcome =
  | { kind: 'removed' }
  | { kind: 'removed-local-edit'; snapshotPath: string }
  | { kind: 'failed'; reason: string };

/**
 * Test seams for interleavings that real filesystems cannot be made to produce
 * on demand. Production passes nothing.
 */
export interface RetirementHooks {
  /** Replaces the detaching `rename`. */
  rename?: (from: string, to: string) => Promise<void>;
  /** Runs right after a successful detach, before the decision. */
  afterDetach?: () => Promise<void>;
}

/**
 * Detach the owned copy into the history store, then decide on the detached
 * object. See the file comment for why the order matters. Rules, in order:
 *
 * 1. Absent: `removed`. A symlink is unlinked, never followed or snapshotted.
 * 2. Not the kind the manifest recorded: `failed` — unknown is not unchanged.
 * 3. The history `<ts>` directory cannot be created: `failed`, original intact.
 * 4. The rename fails: `failed` with its code, original intact, empty `<ts>`
 *    removed. Vanished since step 1: `removed`.
 * 5. Provably unchanged: the staged copy is deleted, empty history pruned.
 * 6. Otherwise: the staged copy is the snapshot, `removed-local-edit`.
 */
export async function retireOwnedArtifact(
  request: RetireOwnedArtifactRequest,
  hooks: RetirementHooks = {},
): Promise<RetirementOutcome> {
  const { workspaceRoot, relPath, isDirectory, ownedHash } = request;
  const original = toAbsolute(workspaceRoot, relPath);

  const stat = await lstatOrNull(original);
  if (stat === null || stat.isSymbolicLink()) {
    try {
      // A link is unlinked as a file would be: never followed, never
      // snapshotted. `removeManaged` tolerates a path that is already gone.
      const removeAsDirectory = stat === null && isDirectory;
      await removeManaged(original, removeAsDirectory);
      return { kind: 'removed' };
    } catch (error: unknown) {
      return {
        kind: 'failed',
        reason: `failed to remove: ${describeError(error)}`,
      };
    }
  }

  const kindMatches = isDirectory ? stat.isDirectory() : stat.isFile();
  if (!kindMatches) {
    return {
      kind: 'failed',
      reason: `cannot read to check for local edits: ${relPath} is not a readable ${
        isDirectory ? 'directory' : 'file'
      }`,
    };
  }

  let historyRoot: string;
  let stampDir: string;
  let staged: string;
  try {
    historyRoot = join(
      workspaceRoot,
      HARNESS_STATE_DIR,
      LOCAL_EDIT_HISTORY_DIR,
    );
    const slugRoot = join(historyRoot, historySlug(relPath));
    await withWindowsRetry(() => mkdir(slugRoot, { recursive: true }));
    stampDir = await createUniqueDir(slugRoot, timestampName());
    staged = join(stampDir, ...relPath.split('/'));
    await withWindowsRetry(() => mkdir(dirname(staged), { recursive: true }));
  } catch (error: unknown) {
    return {
      kind: 'failed',
      reason: `could not save local edit before removal: ${describeError(error)}`,
    };
  }

  const detach = hooks.rename ?? rename;
  try {
    await withWindowsRetry(() => detach(original, staged));
  } catch (error: unknown) {
    // A failed rename moved nothing, so `<ts>` holds only the empty parents
    // created above; removing it leaves no trace of the attempt.
    await removeEmptyDirs(stampDir);
    await pruneEmptyAncestors(dirname(stampDir), historyRoot);
    if (errorCode(error) === 'ENOENT') return { kind: 'removed' };
    return {
      kind: 'failed',
      reason: `could not detach for removal: ${describeError(error)}`,
    };
  }

  // The original path is never touched again from here on.
  if (hooks.afterDetach !== undefined) await hooks.afterDetach();

  if (!(await isProvablyUnchanged(staged, isDirectory, ownedHash))) {
    return { kind: 'removed-local-edit', snapshotPath: staged };
  }

  try {
    await withWindowsRetry(() =>
      rm(stampDir, { recursive: true, force: true }),
    );
  } catch {
    // degradation-audit: optional-capability - the artifact is already gone
    // from the target directory; a leftover copy of Ptah's own bytes in the
    // history store is harmless and must not turn a done retirement into a retry.
    return { kind: 'removed' };
  }
  // An unchanged retirement leaves no history behind.
  await pruneEmptyAncestors(dirname(stampDir), historyRoot);
  return { kind: 'removed' };
}

/**
 * True only when the detached object is byte-for-byte what Ptah recorded and
 * nothing in it is invisible to the hash. Every doubt answers `false`.
 */
async function isProvablyUnchanged(
  staged: string,
  isDirectory: boolean,
  ownedHash: string | undefined,
): Promise<boolean> {
  if (ownedHash === undefined) return false;
  const stat = await lstatOrNull(staged);
  if (stat === null) return false;
  if (!isDirectory) {
    return stat.isFile() && (await hashFile(staged)) === ownedHash;
  }
  if (!stat.isDirectory()) return false;
  if ((await hashDir(staged)) !== ownedHash) return false;
  return isFullyHashable(staged, 0);
}

/**
 * Walk the tree exhaustively and answer whether `hashDir` saw all of it.
 *
 * Mirrors `listContentFiles` (`hash/content-hash.ts`) without its filtering:
 * where that walk SKIPS an ignored name, a symlink, an unusual node, an
 * unreadable directory or a level below `MAX_DEPTH`, this one answers `false`,
 * because those bytes are exactly the ones a matching hash says nothing about.
 */
async function isFullyHashable(dir: string, depth: number): Promise<boolean> {
  if (depth > MAX_DEPTH) return false;
  let entries: Dirent[];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    // degradation-audit: optional-capability - an unreadable directory is
    // exactly what the hash skipped, so it is reported as not covered.
    return false;
  }
  for (const entry of entries) {
    if (isIgnoredEntry(entry.name)) return false;
    const absolute = join(dir, entry.name);
    const kind = await entryKind(entry, absolute);
    if (kind === 'other') return false;
    if (kind === 'directory' && !(await isFullyHashable(absolute, depth + 1))) {
      return false;
    }
  }
  return true;
}

async function entryKind(
  entry: Dirent,
  absolute: string,
): Promise<'file' | 'directory' | 'other'> {
  if (entry.isSymbolicLink()) return 'other';
  if (entry.isDirectory()) return 'directory';
  if (entry.isFile()) return 'file';
  const stat = await lstatOrNull(absolute);
  if (stat === null || stat.isSymbolicLink()) return 'other';
  if (stat.isDirectory()) return 'directory';
  return stat.isFile() ? 'file' : 'other';
}

/**
 * Remove `start` and its ancestors up to and including `historyRoot`, each only
 * while EMPTY, stopping at the first that is not. A non-recursive `rmdir`
 * cannot delete a byte, so this is safe to aim at a store other snapshots share.
 */
async function pruneEmptyAncestors(
  start: string,
  historyRoot: string,
): Promise<void> {
  let current = start;
  while (current.startsWith(historyRoot)) {
    if (!(await rmdirIfEmpty(current))) return;
    if (current === historyRoot) return;
    current = dirname(current);
  }
}

/**
 * Depth-first removal of a tree made only of empty directories. Aimed only at
 * a `<ts>` directory this retirement created, never at a shared parent.
 */
async function removeEmptyDirs(dir: string): Promise<void> {
  let entries: Dirent[];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    // degradation-audit: optional-capability - pruning is cosmetic; a directory
    // that cannot be listed is left as it is.
    return;
  }
  for (const entry of entries) {
    if (entry.isDirectory()) await removeEmptyDirs(join(dir, entry.name));
  }
  await rmdirIfEmpty(dir);
}

async function rmdirIfEmpty(dir: string): Promise<boolean> {
  try {
    await rmdir(dir);
    return true;
  } catch (error: unknown) {
    // degradation-audit: optional-capability - ENOTEMPTY means another
    // snapshot lives here; any other failure leaves an empty directory behind.
    return errorCode(error) === 'ENOENT';
  }
}

/** Hash an artifact as the kind the manifest recorded; `null` when unreadable as that kind. */
export function hashArtifact(
  absolute: string,
  isDirectory: boolean,
): Promise<string | null> {
  return isDirectory ? hashDir(absolute) : hashFile(absolute);
}

/**
 * Save a hand-edited copy that is about to be OVERWRITTEN to
 * `{ws}/.ptah/harness/.history/<slug>/<ts>/<relPath>` and prove the save.
 *
 * Lives beside the harness manifests, outside every CLI's read directory, so a
 * snapshot is never read back as a skill, an agent, or a `foreign` finding;
 * `.history` is also in the content-hash ignore set. Keeping `relPath` under
 * `<ts>` stops two targets snapshotting the same slug in one pass from
 * colliding, and tells the user exactly where the file came from.
 *
 * The snapshot counts only when it re-hashes to `expectedHash`, the hash of
 * the copy about to be overwritten. Throws on any failure.
 */
export async function snapshotLocalEdit(
  workspaceRoot: string,
  relPath: string,
  isDirectory: boolean,
  expectedHash: string,
): Promise<void> {
  const slugRoot = join(
    workspaceRoot,
    HARNESS_STATE_DIR,
    LOCAL_EDIT_HISTORY_DIR,
    historySlug(relPath),
  );
  await withWindowsRetry(() => mkdir(slugRoot, { recursive: true }));
  const stampDir = await createUniqueDir(slugRoot, timestampName());

  const destination = join(stampDir, ...relPath.split('/'));
  await withWindowsRetry(() =>
    mkdir(dirname(destination), { recursive: true }),
  );
  await withWindowsRetry(() =>
    cp(toAbsolute(workspaceRoot, relPath), destination, {
      recursive: isDirectory,
    }),
  );

  const saved = await hashArtifact(destination, isDirectory);
  if (saved !== expectedHash) {
    throw new Error(
      `snapshot at ${destination} does not match the copy on disk`,
    );
  }
}

/** `.codex/agents/a2.toml` -> `a2`; skill dir `.agents/skills/foo` -> `foo`. */
function historySlug(relPath: string): string {
  const name = basename(relPath);
  const dot = name.indexOf('.');
  return dot > 0 ? name.slice(0, dot) : name;
}

function timestampName(): string {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

/**
 * `<ts>` is created with a NON-recursive `mkdir`, so a directory that already
 * exists is never reused or overwritten: EEXIST moves on to `<ts>-1`, `<ts>-2`.
 */
async function createUniqueDir(parent: string, name: string): Promise<string> {
  for (let attempt = 0; attempt <= MAX_SNAPSHOT_SUFFIX; attempt++) {
    const candidate = join(parent, attempt === 0 ? name : `${name}-${attempt}`);
    try {
      await withWindowsRetry(() => mkdir(candidate));
      return candidate;
    } catch (error: unknown) {
      if (errorCode(error) !== 'EEXIST') throw error;
    }
  }
  throw new Error(`no free snapshot directory under ${parent} for ${name}`);
}

function toAbsolute(workspaceRoot: string, relPath: string): string {
  return join(workspaceRoot, ...relPath.split('/'));
}

async function lstatOrNull(path: string): Promise<Stats | null> {
  try {
    return await lstat(path);
  } catch {
    // degradation-audit: optional-capability - stat is a presence probe; null
    // means absent or unreachable, and every caller treats that conservatively.
    return null;
  }
}
