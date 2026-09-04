/**
 * Content hashing for harness artifacts.
 *
 * A hash is the identity of a desired artifact. Two properties matter and both
 * are load-bearing for the reconciler:
 *
 * 1. **Stable across machines and separators.** Relative paths are normalized
 *    to POSIX and sorted before they enter the digest, so the same skill
 *    directory hashes identically on Windows and macOS. Without that, every
 *    reconcile on a synced workspace would look like drift.
 * 2. **Blind to Ptah's own bookkeeping.** `.ptah-origin.json` sidecars,
 *    `.history/` snapshots and the synthesis `_candidates` staging directory
 *    live inside source directories but are never copied to a target. Hashing
 *    them would make an untouched skill appear changed the moment the mirror
 *    rewrote a sidecar timestamp.
 *
 * Symlinks are skipped outright rather than followed — a symlink loop inside a
 * skill directory must not turn a hash into a hang.
 *
 * **Everything here is asynchronous, and that is the point (TASK_2026_323 /
 * B8).** The walk used to be `readdirSync` + `lstatSync` + `readFileSync` +
 * sha256, recursive to depth 20, and it runs on EVERY session start and EVERY
 * rival-CLI agent spawn — once to hash the sources and once more per detected
 * target to hash the copies. In Electron the backend shares its event loop with
 * `BrowserWindow`, so that walk is measured in frozen UI. Going through
 * `fs/promises` yields the loop once per directory and once per batch of
 * {@link HASH_BATCH_SIZE} files, and it lets a pass that has run out of budget
 * be abandoned between whole-file operations instead of finishing in the
 * background. There is deliberately no synchronous variant left: a second
 * spelling of this walk is exactly how the blocking one would grow back.
 *
 * It is also FASTER than what it replaced, which was not a given — an async
 * read is a threadpool round trip where a sync one is a direct syscall. Two
 * choices pay for that and then some: `readdir({ withFileTypes: true })`
 * removes the per-entry `lstat` the old walk made (one syscall per directory
 * instead of one plus one per child), and the batch reads give the threadpool
 * more than one file at a time. Measured on this lib's own reconciler suites:
 * 35 s serial-async → 4.9 s, against roughly 30 s for the original sync walk.
 *
 * **The digest is byte-for-byte what the synchronous version produced**, and it
 * has to stay that way — every manifest on every user's disk records these
 * hashes, so a change in the fold would make every workspace on earth read as
 * drifted on the next pass. Same entry set, same POSIX relative paths, same
 * sorted order, same NUL-separated fold.
 */

import { createHash } from 'crypto';
import type { Dirent } from 'fs';
import { readdir, readFile, lstat } from 'fs/promises';
import { join } from 'path';
import { throwIfPassAborted, yieldToEventLoop } from '../abort/pass-abort';
import { QUARANTINE_DIR_NAME } from '../quarantine/quarantine';

/** Guards against symlink loops and pathological nesting, mirroring the copy engine. */
const MAX_DEPTH = 20;

/**
 * Files read concurrently, and therefore also the interval between yields.
 *
 * An async read costs more wall-clock than a sync one — it is a round trip
 * through libuv's threadpool rather than a direct syscall — so a naive
 * one-file-at-a-time rewrite trades a frozen event loop for a walk several
 * times slower end to end. Reading a batch at once gives the threadpool
 * (4 workers by default) something to do and brings throughput back, while the
 * `await` between batches is the yield: the renderer's IPC, an agent's stdout
 * and the next timer all get a turn.
 *
 * The FOLD stays strictly ordered regardless — batches are read out of order
 * and digested in sorted order — because the digest is a content identity that
 * two different code paths compare against each other.
 */
export const HASH_BATCH_SIZE = 16;

/**
 * Entries excluded from both the hash and the copy.
 *
 * `.ptah-origin.json` is the user-layer provenance sidecar, `.history` is the
 * enhancement snapshot store, `_candidates` is skill-synthesis staging. None of
 * the three is part of a skill's content and none belongs in a target dir.
 *
 * `.ptah-quarantine` is the repair's undo store (TASK_2026_306 Batch 8). It
 * only ever lands inside a TARGET directory, so the two target scans that could
 * see it call `isQuarantineEntry` directly; listing it here as well is what
 * makes "never scanned as a SOURCE either" structural rather than incidental —
 * `HarnessManifestBuilder.listSkillSlugs` and `listMarkdownFiles` both filter
 * through this set, and a user who moves a quarantine into `~/.ptah/user` by
 * hand must not have it propagated back out to six targets.
 */
export const IGNORED_ENTRY_NAMES: ReadonlySet<string> = new Set([
  '.ptah-origin.json',
  '.history',
  '_candidates',
  QUARANTINE_DIR_NAME,
]);

/** True when a directory entry must not be hashed or copied. */
export function isIgnoredEntry(name: string): boolean {
  return IGNORED_ENTRY_NAMES.has(name);
}

/** sha256 of a buffer, hex-encoded. */
function sha256(input: Buffer | string): string {
  return createHash('sha256').update(input).digest('hex');
}

/**
 * Content hash of an in-memory string, comparable with {@link hashFile}.
 *
 * Needed by targets that TRANSFORM content on the way out: the hash of what
 * will land on disk has to be known before the write, and it is not the hash of
 * any file that exists yet. Encoded as UTF-8 so it equals `hashFile` of the
 * same string written with `'utf-8'`.
 *
 * The one synchronous function in this file, and legitimately so — it touches
 * no filesystem.
 */
export function hashContent(content: string): string {
  return sha256(Buffer.from(content, 'utf-8'));
}

/** Content hash of a single file. Resolves `null` when it cannot be read. */
export async function hashFile(filePath: string): Promise<string | null> {
  try {
    return sha256(await readFile(filePath));
  } catch {
    return null;
  }
}

/** Options shared by the walk and the fold. */
export interface ContentHashOptions {
  /**
   * Cancels the walk BETWEEN whole files. Never mid-read, so an aborted walk
   * has read either all of a file or none of it and has written nothing at all.
   * Aborting raises `HarnessPassAbortedError`.
   */
  signal?: AbortSignal;
}

/**
 * Collect `relativePath -> absolutePath` for every regular file under `dir`,
 * skipping ignored names and symlinks. Relative paths use POSIX separators.
 *
 * Yields the event loop once per directory entered, and honours `signal`
 * between entries.
 *
 * `withFileTypes` is what keeps this affordable: the entry type comes back with
 * the directory listing, so the per-entry `lstat` the synchronous version had to
 * make is gone — one syscall for a directory instead of one plus one per child.
 * `Dirent` reports link/dir/file exactly as `lstat` does (a symlink reads as a
 * symlink, never as its target), so the classification below is unchanged. The
 * `isUnknown` fallback covers the filesystems that do not carry a type in the
 * directory entry.
 */
export async function listContentFiles(
  dir: string,
  options: ContentHashOptions = {},
  prefix = '',
  depth = 0,
): Promise<Map<string, string>> {
  const files = new Map<string, string>();
  if (depth > MAX_DEPTH) return files;

  let entries: Dirent[];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return files;
  }

  // One yield per directory: the recursion below is depth-first, so this
  // spreads the pauses through the tree rather than bunching them at the root.
  await yieldToEventLoop();
  throwIfPassAborted(options.signal);

  for (const entry of entries) {
    if (isIgnoredEntry(entry.name)) continue;
    const absolute = join(dir, entry.name);
    const relative = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
    const kind = await classifyEntry(entry, absolute);
    if (kind === 'directory') {
      const nested = await listContentFiles(
        absolute,
        options,
        relative,
        depth + 1,
      );
      for (const [nestedRel, nestedAbs] of nested) {
        files.set(nestedRel, nestedAbs);
      }
    } else if (kind === 'file') {
      files.set(relative, absolute);
    }
  }

  return files;
}

/**
 * Directory / file / neither, from the listing when it knows and from an
 * `lstat` when it does not. Symlinks are `'skip'`: following one could loop, or
 * copy content from outside the source root.
 *
 * The fallback covers an entry the listing typed as none of the three — either
 * a filesystem that carries no type in the directory entry, or an unusual node
 * (socket, fifo, device). The `lstat` costs one syscall in exactly the case the
 * cheap answer was unavailable, and never on the ordinary path.
 */
async function classifyEntry(
  entry: Dirent,
  absolute: string,
): Promise<'directory' | 'file' | 'skip'> {
  if (entry.isSymbolicLink()) return 'skip';
  if (entry.isDirectory()) return 'directory';
  if (entry.isFile()) return 'file';
  try {
    const stat = await lstat(absolute);
    if (stat.isSymbolicLink()) return 'skip';
    if (stat.isDirectory()) return 'directory';
    return stat.isFile() ? 'file' : 'skip';
  } catch {
    return 'skip';
  }
}

/**
 * The byte separator between a path and its content digest.
 *
 * NUL, because it is the one byte no path and no hex digest can contain: with a
 * printable separator, `a/b` + hash and `a` + `/b` + hash could collide, and a
 * directory could be made to hash equal to a different directory.
 */
const DIGEST_SEPARATOR = '\u0000';

/**
 * Fold a `relativePath -> absolutePath` map into one digest.
 *
 * Shared so that every "hash of a directory" in this lib produces the SAME
 * format. {@link hashDir} hashes what is on disk and `hashTransformedDir`
 * (`targets/copy-engine.ts`) hashes what a transformed copy WOULD be; the two
 * are compared against each other to decide whether an unowned copy is Ptah's
 * own work, so a difference in this loop — a different separator, a different
 * order — would silently make every such comparison fail.
 *
 * @param hashOf content digest for one file, given its relative and absolute
 *   paths. Returning a stand-in for an unreadable file is the caller's choice.
 */
export async function digestFileMap(
  files: ReadonlyMap<string, string>,
  hashOf: (relative: string, absolute: string) => Promise<string>,
  options: ContentHashOptions = {},
): Promise<string> {
  const digest = createHash('sha256');
  const ordered = [...files.keys()].sort();

  for (let start = 0; start < ordered.length; start += HASH_BATCH_SIZE) {
    // Between whole files, before any read in this batch starts: an abort here
    // leaves a half-built digest to be thrown away and nothing else.
    throwIfPassAborted(options.signal);
    const batch = ordered.slice(start, start + HASH_BATCH_SIZE);
    const digests = await Promise.all(
      batch.map(async (relative) => {
        const absolute = files.get(relative);
        return absolute === undefined ? null : await hashOf(relative, absolute);
      }),
    );
    // Folded in the batch's own (sorted) order, so concurrency above cannot
    // change the digest. Two code paths compare these against each other.
    for (let index = 0; index < batch.length; index++) {
      const fileDigest = digests[index];
      if (fileDigest === null) continue;
      digest.update(batch[index]);
      digest.update(DIGEST_SEPARATOR);
      digest.update(fileDigest);
      digest.update(DIGEST_SEPARATOR);
    }
  }

  return digest.digest('hex');
}

/**
 * Content hash of a directory tree: sha256 over each sorted relative path
 * followed by that file's own content digest.
 *
 * Resolves `null` when the directory does not exist. An EMPTY directory hashes
 * to a real (constant) digest rather than null — "present but empty" and
 * "absent" are different states to the reconciler.
 */
export async function hashDir(
  dir: string,
  options: ContentHashOptions = {},
): Promise<string | null> {
  let stat;
  try {
    stat = await lstat(dir);
  } catch {
    return null;
  }
  if (!stat.isDirectory()) return null;

  return digestFileMap(
    await listContentFiles(dir, options),
    async (_relative, absolute) => (await hashFile(absolute)) ?? 'unreadable',
    options,
  );
}
