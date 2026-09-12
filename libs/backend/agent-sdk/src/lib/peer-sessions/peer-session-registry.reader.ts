/**
 * Reader for the Claude CLI's own session registry (TASK_2026_402, Task 10.2).
 *
 * The CLI writes one JSON file per live session at
 * `~/.claude/sessions/<pid>.json` and removes it on a clean exit. That
 * directory is the ONLY source of truth for "which sessions can this user
 * reach": Ptah's own bookkeeping knows about sessions Ptah started, and the
 * whole point of Requirement 10 is addressing the ones it did not.
 *
 * ## Why the schema is not `.strict()`
 *
 * This file is written by another program, at its own pace, with no
 * compatibility promise to us. Live records read on 2026-09-12 already differ
 * from each other: a 2.1.233 record carries neither `peerFeatures`,
 * `pidDomain` nor `messagingSocketPath`, and one 2.1.268 record carries an
 * `updatedAt` the others lack. A strict schema would reject exactly the rows
 * this feature exists to show, and rejecting them is indistinguishable from
 * "no sessions are running" — the silent omission Requirement 10 criterion 3
 * forbids. So the schema pins the fields we read, tolerates the rest, and an
 * unparseable file becomes an explicitly unreadable ROW rather than a
 * disappearance. Strictness belongs at the RPC boundary, where Ptah owns both
 * sides; see `peer-session-rpc.schema.ts`.
 */

import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { z } from 'zod';

/**
 * The registry fields this feature reads. Every one was verified present on a
 * live record on 2026-09-12; the optional ones are optional because a real
 * record on this machine lacked them, not as defensive habit.
 */
export const PeerSessionRecordSchema = z
  .object({
    pid: z.number().int().positive(),
    sessionId: z.string().min(1),
    cwd: z.string().min(1),
    startedAt: z.number().int().nonnegative().optional(),
    /**
     * The process start fingerprint, as a decimal string. On Windows this is a
     * `FILETIME` — 100-nanosecond ticks since 1601-01-01 UTC — measured exact
     * to the millisecond against `Get-Process().StartTime` for three live pids
     * (see `process-start-time.probe.ts`). Absent on pre-peer-channel builds.
     */
    procStart: z.string().min(1).optional(),
    /** Current schema's name for the same value. Neither is guaranteed. */
    procStartFt: z.string().min(1).optional(),
    /** e.g. `win32:abdo` — platform plus host, qualifying the pid. */
    pidDomain: z.string().min(1).optional(),
    version: z.string().min(1).optional(),
    /** Absent on builds older than the peer channel; its absence is a state. */
    messagingSocketPath: z.string().min(1).optional(),
    /** Batch 9 is what puts a user-chosen name here. May be missing entirely. */
    name: z.string().optional(),
    nameSource: z.string().optional(),
  })
  .loose();

export type PeerSessionRecord = z.infer<typeof PeerSessionRecordSchema>;

/** A registry file that existed but did not parse. Reported, never dropped. */
export interface UnreadablePeerSessionFile {
  readonly file: string;
  readonly reason: string;
}

export interface PeerSessionRegistryScan {
  readonly records: readonly PeerSessionRecord[];
  readonly unreadable: readonly UnreadablePeerSessionFile[];
}

/** `~/.claude/sessions`, the directory the CLI registers live sessions in. */
export function peerSessionRegistryDirectory(
  homeDir: string = os.homedir(),
): string {
  return path.join(homeDir, '.claude', 'sessions');
}

/**
 * Read every session record in the registry directory.
 *
 * `.key` files live in the same directory and are deliberately ignored: they
 * hold the peer auth token for the socket protocol, which
 * `research-report-addressing.md` put out of scope. Nothing here reads one.
 *
 * A missing directory is not an error — it means the CLI has never registered
 * a session on this machine — and yields an empty scan.
 */
export async function scanPeerSessionRegistry(
  homeDir: string = os.homedir(),
): Promise<PeerSessionRegistryScan> {
  const directory = peerSessionRegistryDirectory(homeDir);

  let entries: string[];
  try {
    entries = await fs.readdir(directory);
  } catch (error: unknown) {
    if (isMissingPath(error)) {
      return { records: [], unreadable: [] };
    }
    throw error;
  }

  const records: PeerSessionRecord[] = [];
  const unreadable: UnreadablePeerSessionFile[] = [];

  for (const entry of entries.filter((name) => name.endsWith('.json'))) {
    const file = path.join(directory, entry);
    let raw: string;
    try {
      raw = await fs.readFile(file, 'utf8');
    } catch (error: unknown) {
      // A record removed between the readdir and the read is an exited
      // session, not a fault — the common case, and silent on purpose.
      if (isMissingPath(error)) {
        continue;
      }
      unreadable.push({ file, reason: describe(error) });
      continue;
    }

    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(raw);
    } catch (error: unknown) {
      unreadable.push({ file, reason: `malformed JSON: ${describe(error)}` });
      continue;
    }

    const parsed = PeerSessionRecordSchema.safeParse(parsedJson);
    if (!parsed.success) {
      unreadable.push({
        file,
        reason: `unexpected record shape: ${parsed.error.issues
          .map((issue) => issue.path.join('.') || '<root>')
          .join(', ')}`,
      });
      continue;
    }

    records.push(parsed.data);
  }

  return { records, unreadable };
}

/**
 * The start fingerprint the record actually carries. Two field names exist in
 * the wild for one value; callers should never have to know which.
 */
export function recordStartFingerprint(
  record: PeerSessionRecord,
): string | undefined {
  return record.procStart ?? record.procStartFt;
}

/**
 * This host's `pidDomain`, in the CLI's own shape.
 *
 * Read off a live record on 2026-09-12: `win32:abdo` on a machine whose
 * `os.hostname()` is `Abdo`. Compared case-insensitively, because the CLI
 * lower-cases and we have no promise it always will.
 */
export function currentPidDomain(
  platform: string = process.platform,
  hostname: string = os.hostname(),
): string {
  return `${platform}:${hostname}`.toLowerCase();
}

function isMissingPath(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 'ENOENT'
  );
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
