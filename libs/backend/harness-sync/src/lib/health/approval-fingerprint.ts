/**
 * The approval fingerprint: what a user consents to when they approve
 * replacing the content at a destination path (TASK_2026_701 A21; P1 review
 * findings A3 and A4).
 *
 * It is deliberately NOT the synchronization hash (`hash/content-hash.ts`).
 * That hash is permissive by design — it skips `.history`, `_candidates`,
 * `.ptah-origin.json`, the quarantine store and symlinks, stops at
 * `MAX_DEPTH`, folds an unlistable directory into an empty one and digests an
 * unreadable file as a sentinel — because its job is to compare Ptah's own
 * copies cheaply on every pass. None of that is acceptable for consent: a
 * repair MOVES the whole path, so the proof has to cover everything the move
 * takes, and a traversal that could not see something proves nothing.
 *
 * So the fingerprint is strict:
 *
 * - **Complete or nothing.** Every entry below the path is visited, ignored
 *   names included. An unlistable directory, an unreadable file, a depth past
 *   `MAX_DEPTH`, or a node that is neither file, directory nor link answers
 *   `null` — "cannot be approved", never a comparable digest.
 * - **Content.** Each regular file contributes the sha256 of its bytes; a link
 *   below the root contributes its target string (it is moved, never followed).
 * - **Identity.** Each entry contributes its type, device, inode/file id,
 *   birth time and status-change time. Deleting a path and recreating it
 *   with identical bytes yields a new object, so the fingerprint differs and
 *   the repair reports `changed-since-approval` (A4).
 *
 * IDENTITY GUARANTEE ACROSS PLATFORMS. Node reports a stable `ino` on NTFS and
 * ReFS (the 64-bit file index), and on every common POSIX filesystem (ext4,
 * xfs, btrfs, APFS, HFS+); `birthtime` is added where the platform has one,
 * and `ctime` covers a POSIX filesystem that reuses a freed inode number at
 * once (the recreated object's status-change time is later). A metadata-only
 * change such as `chmod` also moves `ctime`, and is treated as a change too.
 * Stats are read with `bigint: true` so a 64-bit NTFS file id is never
 * rounded. When a filesystem reports neither an inode (`0`) nor a birth time,
 * recreation cannot be told apart from the original, so the path has no
 * fingerprint and cannot be approved: the safe direction. One consequence is
 * intended: an editor that saves by writing a new file and renaming it over
 * the old one also produces a new identity, and that save — even with
 * unchanged bytes — counts as a change since approval.
 *
 * Never throws; every failure is `null`.
 */

import { createHash } from 'crypto';
import type { BigIntStats } from 'fs';
import { lstat, readdir, readFile, readlink } from 'fs/promises';
import { join } from 'path';
import { MAX_DEPTH } from '../hash/content-hash';

/**
 * The strict approval fingerprint of whatever is at `absolute`, or `null` when
 * nothing is there, the root is a link, or anything below it could not be
 * fully observed.
 */
export async function approvalFingerprint(
  absolute: string,
): Promise<string | null> {
  const records: string[] = [];
  try {
    const stat = await lstat(absolute, { bigint: true });
    if (stat.isSymbolicLink()) return null;
    const complete = await recordEntry(absolute, '.', stat, 0, records);
    if (!complete) return null;
  } catch {
    // degradation-audit: optional-capability - a failed stat, listing, read or
    // readlink means the traversal is incomplete, and an incomplete traversal
    // must never produce a digest a consent check could match; null makes the
    // caller refuse the approval instead.
    return null;
  }
  return createHash('sha256').update(records.join('\n')).digest('hex');
}

/**
 * Append one entry (and, for a directory, its whole subtree) to `records`.
 * Answers `false` when the entry cannot be fingerprinted; I/O errors throw and
 * are turned into `null` by {@link approvalFingerprint}.
 */
async function recordEntry(
  path: string,
  rel: string,
  stat: BigIntStats,
  depth: number,
  records: string[],
): Promise<boolean> {
  const identity = identityOf(stat);
  if (identity === null) return false;

  if (stat.isSymbolicLink()) {
    records.push(JSON.stringify(['L', rel, identity, await readlink(path)]));
    return true;
  }
  if (stat.isFile()) {
    const digest = createHash('sha256')
      .update(await readFile(path))
      .digest('hex');
    records.push(JSON.stringify(['F', rel, identity, digest]));
    return true;
  }
  if (!stat.isDirectory() || depth > MAX_DEPTH) return false;

  records.push(JSON.stringify(['D', rel, identity]));
  const names = (await readdir(path)).sort();
  for (const name of names) {
    const child = join(path, name);
    const childRel = rel === '.' ? name : `${rel}/${name}`;
    const childStat = await lstat(child, { bigint: true });
    if (!(await recordEntry(child, childRel, childStat, depth + 1, records))) {
      return false;
    }
  }
  return true;
}

/**
 * `dev:ino:birthtime:ctime`, or `null` when the filesystem reports no identity.
 * `ctime` is included because an inode number can be reused immediately after
 * a delete on some POSIX filesystems; a recreated object still has a later
 * status-change time.
 */
function identityOf(stat: BigIntStats): string | null {
  if (stat.ino === 0n && stat.birthtimeNs === 0n) return null;
  return `${stat.dev}:${stat.ino}:${stat.birthtimeNs}:${stat.ctimeNs}`;
}
