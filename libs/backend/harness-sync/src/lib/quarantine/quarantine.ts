/**
 * The quarantine convention: where a blocked path's occupant goes when the user
 * consents to a repair, and why it is a MOVE and never an overwrite.
 *
 * `.claude/skills/.ptah-quarantine/<name>-<timestamp>` — alongside the target
 * directory, one level down from the occupied path itself. Decided by the user
 * on 2026-08-22 (TASK_2026_306 / U2–U4). Four properties, each load-bearing:
 *
 * - **Same volume, by construction.** The quarantine directory is a sibling of
 *   the occupant inside its own parent, so `rename` is an atomic metadata
 *   operation on Windows rather than a copy-then-delete that can half-finish.
 *   Not `~/.ptah/` (a workspace on `D:` and a home on `C:` is the common Windows
 *   case, and that move is a cross-volume copy), not the OS recycle bin (opaque
 *   and not scriptable). {@link moveToQuarantine} still carries an `EXDEV`
 *   fallback because a directory can itself be a mount point, and that fallback
 *   copies BEFORE it deletes so a crash anywhere leaves the content in at least
 *   one place — the same ordering as `skills-sh-legacy-adoption.ts:120-127`.
 *
 * - **The reconciler never scans it.** A quarantined directory is neither a
 *   source nor a target: it must not appear in the desired state, must not be
 *   manifest-owned, must not be reported `foreign`, and must not be reaped.
 *   {@link isQuarantineEntry} is the one predicate that says so, and it is
 *   called from every directory walk that could see it —
 *   `ClaudeTarget.scanTargetDirs`, `WorkspaceHarnessTarget.scanForeignDirs`,
 *   and (via `IGNORED_ENTRY_NAMES`) every source walk and every content hash.
 *   A leading dot is NOT the mechanism; the scans do not filter on one.
 *
 * - **Nothing ever cleans it up.** No TTL, no sweep, no "older than N days"
 *   job, and no UI button offering one. The quarantine IS the undo, and an
 *   expiry policy silently converts a reversible operation into a destructive
 *   one on a timer. A user who wants the space back deletes the directory
 *   themselves, having looked at what is in it. If you are reading this looking
 *   for the cleanup code: there deliberately is none.
 *
 * - **It is already git-ignored.** `ClaudeTarget.managedDirs()` puts
 *   `.claude/skills` in the managed `.gitignore` block (E23), and the rival
 *   targets do the same for theirs, so a quarantine inside one of them never
 *   shows up in `git status`.
 *
 * WHY A MOVE AT ALL. Nothing proves Ptah wrote the directories that occupy
 * these paths — `SkillJunctionService` linked skills and only copied commands,
 * so it never wrote one and could not have
 * (`git e107e6f89^:.../skill-junction.service.ts:304-356`). The occupant may be
 * the Claude Code SDK's, the pre-TASK_2026_288 `npx skills add` path's, or the
 * user's own hand-written work. Consent is the only ownership proof available
 * and consent is not certainty, so the operation has to stay undoable.
 */

import { cp, lstat, mkdir, rename, rm } from 'fs/promises';
import { basename, dirname, join } from 'path';
import { errorCode, withWindowsRetry } from '../fs/windows-retry';

/** The one directory name. Never construct this string anywhere else. */
export const QUARANTINE_DIR_NAME = '.ptah-quarantine';

/**
 * True when a directory entry is the quarantine and must not be scanned.
 *
 * Called by name rather than by a dot-prefix rule: `.ptah-managed.json` and
 * `.mcp.json` are both dot-prefixed and both very much scanned, so a prefix
 * test would be a different rule that happens to agree today.
 */
export function isQuarantineEntry(name: string): boolean {
  return name === QUARANTINE_DIR_NAME;
}

/** The quarantine directory for an occupant, i.e. its sibling. */
export function quarantineDirFor(occupantAbsolute: string): string {
  return join(dirname(occupantAbsolute), QUARANTINE_DIR_NAME);
}

/**
 * `20260823T141530123` — UTC, compact, millisecond precision.
 *
 * Millisecond rather than second precision because two repairs of the same slug
 * within one second is not a hypothetical: the repair loops over a consent set
 * and a failed-then-retried path can land twice in the same tick.
 * {@link moveToQuarantine} still resolves a residual collision by suffixing, so
 * the format is one of two defences rather than the only one.
 */
export function formatQuarantineTimestamp(when: Date): string {
  const iso = when.toISOString(); // 2026-08-23T14:15:30.123Z
  return iso.replace(/[-:]/g, '').replace('.', '').slice(0, 18);
}

/** Outcome of a successful quarantine move. */
export interface QuarantinedOccupant {
  /** Absolute path the occupant now lives at. Named in every report. */
  quarantinePath: string;
}

/**
 * Move `occupantAbsolute` into its sibling quarantine and PROVE it moved.
 *
 * The verification is not defensive padding. The whole safety argument of the
 * repair is "the occupant is somewhere else before anything is written here",
 * and a `rename` that resolved without throwing but left the source in place —
 * which is what a silently-failing overlay filesystem or a stale handle looks
 * like — would break that argument while reporting success. So both ends are
 * stat'ed: the destination must exist and the source must be gone.
 *
 * Throws on any failure, having attempted no write at the original path. The
 * caller turns that into a per-path `move-failed` and moves on to the next
 * path; it must NOT proceed to the write for this one.
 */
export async function moveToQuarantine(
  occupantAbsolute: string,
  now: Date,
): Promise<QuarantinedOccupant> {
  const quarantineDir = quarantineDirFor(occupantAbsolute);
  await withWindowsRetry(() => mkdir(quarantineDir, { recursive: true }));

  const quarantinePath = await reserveQuarantinePath(
    quarantineDir,
    basename(occupantAbsolute),
    now,
  );

  await moveOrCopyThenDelete(occupantAbsolute, quarantinePath);
  await assertMoved(occupantAbsolute, quarantinePath);
  return { quarantinePath };
}

/** Outcome of putting a quarantined occupant back. */
export interface RestoredOccupant {
  /**
   * Where whatever was sitting on the path went, when something was. Absent in
   * the ordinary case, where the write pass left the path empty.
   */
  supersededPath?: string;
}

/**
 * Put a quarantined occupant back where it came from.
 *
 * Reached only when the managed write did NOT land after a successful move, so
 * the realistic obstruction is this pass's own half-finished managed copy.
 *
 * **THERE IS NO `rm` ON THIS PATH, DELIBERATELY.** An earlier revision deleted
 * whatever sat on the destination first, justified by "the repair emptied it
 * moments ago under the workspace lock". That justification was false:
 * `HarnessBlockedRepairService.moveOccupants` RELEASES the lock before the
 * write pass runs — it has to, or it would deadlock the pass — so the restore
 * window is not exclusive by construction. Rather than reason about who else
 * might have written there, the obstruction is MOVED ASIDE into the quarantine
 * exactly as the original occupant was. This batch's whole premise is that
 * these paths hold content of unknown provenance; a single `rm -rf` in the
 * middle of it, guarded by an argument about a lock that is not held, is not a
 * risk worth carrying for a tidier directory listing. The caller takes the lock
 * around the restore as well, so the window is now BOTH narrow and non-lethal.
 *
 * Throws if the occupant could not be put back. The caller reports that as
 * `restore-failed` and NAMES the quarantine path, because at that point the
 * user's directory exists in exactly one place and they need to be told which.
 */
export async function restoreFromQuarantine(
  quarantinePath: string,
  occupantAbsolute: string,
  now: Date,
): Promise<RestoredOccupant> {
  const restored: RestoredOccupant = {};

  if (await pathExists(occupantAbsolute)) {
    const quarantineDir = quarantineDirFor(occupantAbsolute);
    await withWindowsRetry(() => mkdir(quarantineDir, { recursive: true }));
    const supersededPath = await reserveQuarantinePath(
      quarantineDir,
      `${basename(occupantAbsolute)}.superseded`,
      now,
    );
    await moveOrCopyThenDelete(occupantAbsolute, supersededPath);
    await assertMoved(occupantAbsolute, supersededPath);
    restored.supersededPath = supersededPath;
  }

  await withWindowsRetry(() =>
    mkdir(dirname(occupantAbsolute), { recursive: true }),
  );
  await moveOrCopyThenDelete(quarantinePath, occupantAbsolute);
  await assertMoved(quarantinePath, occupantAbsolute);
  return restored;
}

// --------------------------------------------------------------- internals

/**
 * The first free `<name>-<timestamp>` under the quarantine directory.
 *
 * A residual collision gets `-2`, `-3`, … rather than a re-roll of the clock:
 * the timestamp is the part a human reads to find their directory again, so it
 * must stay the moment of the repair even when two entries share it.
 */
async function reserveQuarantinePath(
  quarantineDir: string,
  name: string,
  now: Date,
): Promise<string> {
  const stamp = formatQuarantineTimestamp(now);
  const base = join(quarantineDir, `${name}-${stamp}`);
  if (!(await pathExists(base))) return base;

  for (let suffix = 2; suffix < 1000; suffix++) {
    const candidate = `${base}-${suffix}`;
    if (!(await pathExists(candidate))) return candidate;
  }
  throw new Error(
    `quarantine destination is exhausted for ${name} at ${quarantineDir}`,
  );
}

/**
 * `rename`, falling back to copy-then-delete across a volume boundary.
 *
 * The fallback should be unreachable — source and destination share a parent
 * directory — but a directory can be a mount point, so `EXDEV` is possible and
 * an unhandled one would abort a repair the user consented to. Copy BEFORE
 * delete, so a crash between them leaves the content present in at least one
 * place. That is the same ordering the in-repo precedent uses
 * (`skills-sh-legacy-adoption.ts:120-127`) and it is what keeps the fallback as
 * reversible as the rename it replaces.
 */
async function moveOrCopyThenDelete(from: string, to: string): Promise<void> {
  try {
    await withWindowsRetry(() => rename(from, to));
    return;
  } catch (error: unknown) {
    if (errorCode(error) !== 'EXDEV') throw error;
  }

  await withWindowsRetry(() => cp(from, to, { recursive: true }));
  await withWindowsRetry(() => rm(from, { recursive: true, force: true }));
}

/** The destination exists and the source is gone, or this throws. */
async function assertMoved(from: string, to: string): Promise<void> {
  if (!(await pathExists(to))) {
    throw new Error(`the move reported success but ${to} does not exist`);
  }
  if (await pathExists(from)) {
    throw new Error(`the move reported success but ${from} is still in place`);
  }
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch {
    return false;
  }
}
