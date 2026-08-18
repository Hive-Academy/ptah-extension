/**
 * The lock mechanism, with no opinion about what is being locked.
 *
 * `workspace-lock.ts` was the only caller until TASK_2026_285 put a SECOND
 * writer on an MCP config file that lives in `$HOME` — `AntigravityCliAdapter`
 * writes Ptah's own server into `~/.gemini/config/mcp_config.json` before every
 * spawn, while the reconciler writes the user's servers into the same file. The
 * workspace lock cannot serialize those two: the file is not in the workspace,
 * and two workspaces have two different locks anyway.
 *
 * So the policy (WHICH file, and where its lock file lives) moved out to the
 * callers and the mechanism stayed here, unchanged:
 *
 * - **`O_EXCL` create, not a mutex.** The contenders are separate OS processes,
 *   possibly separate installs. The filesystem is the only thing they share.
 * - **Stale detection is mandatory.** A host killed mid-write leaves the lock
 *   file behind. A lock older than {@link STALE_AFTER_MS} is broken and
 *   reclaimed; without that rule one crash disables the operation permanently.
 * - **Failure to acquire never blocks the work.** After the deadline the caller
 *   proceeds unlocked. Degraded beats stuck, and {@link serializeByKey} makes
 *   the common case (two calls in ONE host) fully serialized anyway.
 */

import {
  closeSync,
  mkdirSync,
  openSync,
  readFileSync,
  rmSync,
  writeSync,
} from 'fs';
import { dirname } from 'path';

/** A lock this old is assumed to belong to a dead process. */
export const STALE_AFTER_MS = 30_000;

/** Give up waiting after this and proceed unlocked. */
export const DEFAULT_MAX_WAIT_MS = 5_000;

const FIRST_BACKOFF_MS = 25;
const MAX_BACKOFF_MS = 400;

export interface HarnessLockHandle {
  /** False when the lock could not be taken and the caller proceeded anyway. */
  acquired: boolean;
  release(): void;
}

export interface FileLockOptions {
  maxWaitMs?: number;
  staleAfterMs?: number;
}

interface LockPayload {
  pid: number;
  at: number;
}

/** A handle that does nothing, for the "proceed unlocked" path. */
const UNLOCKED: HarnessLockHandle = {
  acquired: false,
  release: () => undefined,
};

/**
 * Serializes work inside THIS process, per key.
 *
 * The file lock alone would make two concurrent in-process calls busy-wait
 * against each other and then both proceed unlocked. A promise chain per key
 * turns that into an ordered queue at zero cost.
 */
const inProcessQueue = new Map<string, Promise<unknown>>();

/** Windows paths are case-insensitive, so two spellings are one key. */
export function normalizeLockKey(key: string): string {
  return process.platform === 'win32' ? key.toLowerCase() : key;
}

/** Run `task` after every previously-queued task for this key. */
export function serializeByKey<T>(
  key: string,
  task: () => Promise<T>,
): Promise<T> {
  const normalized = normalizeLockKey(key);
  const previous = inProcessQueue.get(normalized) ?? Promise.resolve();
  const next = previous.then(task, task);
  // Keep the chain alive but never let a rejection poison the next caller.
  inProcessQueue.set(
    normalized,
    next.then(
      () => undefined,
      () => undefined,
    ),
  );
  return next;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function tryCreate(path: string): boolean {
  try {
    const fd = openSync(path, 'wx');
    try {
      const payload: LockPayload = { pid: process.pid, at: Date.now() };
      writeSync(fd, JSON.stringify(payload));
    } finally {
      closeSync(fd);
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Break the lock if it is older than `staleAfterMs`.
 *
 * An unparseable or unreadable lock file counts as stale: it cannot prove a
 * live owner, and refusing to break it would strand the caller forever.
 */
function breakIfStale(
  path: string,
  now: number,
  staleAfterMs: number,
): boolean {
  let payload: LockPayload | null = null;
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, 'utf-8'));
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      typeof (parsed as LockPayload).at === 'number'
    ) {
      payload = parsed as LockPayload;
    }
  } catch {
    payload = null;
  }

  if (payload !== null && now - payload.at < staleAfterMs) return false;

  try {
    rmSync(path, { force: true });
    return true;
  } catch {
    return false;
  }
}

function heldHandle(path: string): HarnessLockHandle {
  return {
    acquired: true,
    release: () => {
      try {
        rmSync(path, { force: true });
      } catch {
        /* the next stale check reclaims it */
      }
    },
  };
}

/**
 * Acquire an exclusive lock at `lockFilePath`, waiting up to `maxWaitMs`.
 *
 * Always returns a handle. Check `acquired` to decide whether to log the
 * degraded path; `release()` is safe either way.
 */
export async function acquireFileLock(
  lockFilePath: string,
  options: FileLockOptions = {},
): Promise<HarnessLockHandle> {
  const maxWaitMs = options.maxWaitMs ?? DEFAULT_MAX_WAIT_MS;
  const staleAfterMs = options.staleAfterMs ?? STALE_AFTER_MS;

  try {
    mkdirSync(dirname(lockFilePath), { recursive: true });
  } catch {
    // A directory we cannot create is a directory we cannot write either; the
    // caller's own write will fail and report itself, which is the right
    // surface. Proceeding unlocked here keeps that the ONE error.
    return UNLOCKED;
  }

  const deadline = Date.now() + maxWaitMs;
  let backoff = FIRST_BACKOFF_MS;

  for (;;) {
    if (tryCreate(lockFilePath)) return heldHandle(lockFilePath);

    if (
      breakIfStale(lockFilePath, Date.now(), staleAfterMs) &&
      tryCreate(lockFilePath)
    ) {
      return heldHandle(lockFilePath);
    }

    if (Date.now() >= deadline) return UNLOCKED;

    await sleep(backoff);
    backoff = Math.min(backoff * 2, MAX_BACKOFF_MS);
  }
}

/** Take the lock, run `task`, release it whatever happens. */
export async function withFileLock<T>(
  lockFilePath: string,
  task: () => Promise<T>,
  options: FileLockOptions = {},
): Promise<T> {
  const handle = await acquireFileLock(lockFilePath, options);
  try {
    return await task();
  } finally {
    handle.release();
  }
}
