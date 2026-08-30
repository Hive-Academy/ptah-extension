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
 * - **The deadline is a liveness bound, not a licence to write unlocked.**
 *   Blocking forever on a stale lock is worse than failing, which is why the
 *   bound exists — but running the mutation anyway after it expires is how the
 *   lost update TASK_2026_318 removed comes straight back, silently, under
 *   exactly the contention the lock was added for. So {@link withFileLock}
 *   THROWS {@link FileLockTimeoutError} instead (TASK_2026_332); see its doc for
 *   why every caller can absorb that. {@link acquireFileLock} still returns an
 *   unheld handle, because {@link acquireWorkspaceLock} genuinely does want to
 *   proceed degraded and inspects `acquired` itself.
 *   {@link serializeByKey} makes the common case (two calls in ONE host) fully
 *   serialized anyway, so the throwing path needs real cross-PROCESS contention.
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

/**
 * Why a handle is not held. The two are not interchangeable:
 *
 * - `timeout` — somebody else holds a live lock. Another writer is mid
 *   read-modify-write on the very file we are about to read, so proceeding is
 *   the lost update.
 * - `no-lock-directory` — the lock file's directory cannot be created. That is
 *   the directory the guarded file lives in, so the caller's own write is going
 *   to fail and report itself; proceeding keeps that the ONE error rather than
 *   masking it with a lock error about the same permission problem.
 */
export type LockUnavailableReason = 'timeout' | 'no-lock-directory';

export interface HarnessLockHandle {
  /** False when the lock could not be taken. */
  acquired: boolean;
  /** Set only when `acquired` is false. */
  reason?: LockUnavailableReason;
  /** Milliseconds spent waiting. Zero unless the lock was contended. */
  waitedMs: number;
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

/** A handle that does nothing, for the "could not take the lock" paths. */
function unheldHandle(
  reason: LockUnavailableReason,
  waitedMs: number,
): HarnessLockHandle {
  return { acquired: false, reason, waitedMs, release: () => undefined };
}

/**
 * Thrown by {@link withFileLock} when the deadline expired with another writer
 * still holding the lock.
 *
 * Carries the file and the wait duration because both are what a reader needs:
 * a `writeFailed` row naming neither is indistinguishable from a disk error.
 */
export class FileLockTimeoutError extends Error {
  readonly lockFilePath: string;
  readonly waitedMs: number;

  constructor(lockFilePath: string, waitedMs: number) {
    super(
      `Timed out after ${waitedMs}ms waiting for the lock at ${lockFilePath}; ` +
        'the mutation was not performed',
    );
    this.name = 'FileLockTimeoutError';
    this.lockFilePath = lockFilePath;
    this.waitedMs = waitedMs;
  }
}

export function isFileLockTimeoutError(
  error: unknown,
): error is FileLockTimeoutError {
  return error instanceof FileLockTimeoutError;
}

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

function heldHandle(path: string, waitedMs: number): HarnessLockHandle {
  return {
    acquired: true,
    waitedMs,
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
 * Always returns a handle — it never throws. Check `acquired`, and `reason`
 * when it is false, to decide what a failure to acquire means for YOUR
 * operation; `release()` is safe either way. {@link withFileLock} is the
 * opinionated wrapper over this and refuses to run unlocked past the deadline.
 */
export async function acquireFileLock(
  lockFilePath: string,
  options: FileLockOptions = {},
): Promise<HarnessLockHandle> {
  const maxWaitMs = options.maxWaitMs ?? DEFAULT_MAX_WAIT_MS;
  const staleAfterMs = options.staleAfterMs ?? STALE_AFTER_MS;
  const startedAt = Date.now();

  try {
    mkdirSync(dirname(lockFilePath), { recursive: true });
  } catch {
    return unheldHandle('no-lock-directory', Date.now() - startedAt);
  }

  const deadline = startedAt + maxWaitMs;
  let backoff = FIRST_BACKOFF_MS;

  for (;;) {
    if (tryCreate(lockFilePath)) {
      return heldHandle(lockFilePath, Date.now() - startedAt);
    }

    if (
      breakIfStale(lockFilePath, Date.now(), staleAfterMs) &&
      tryCreate(lockFilePath)
    ) {
      return heldHandle(lockFilePath, Date.now() - startedAt);
    }

    if (Date.now() >= deadline) {
      return unheldHandle('timeout', Date.now() - startedAt);
    }

    await sleep(backoff);
    backoff = Math.min(backoff * 2, MAX_BACKOFF_MS);
  }
}

/**
 * Take the lock, run `task`, release it whatever happens.
 *
 * **A contended deadline FAILS the task rather than running it unlocked**
 * (TASK_2026_332). The previous behaviour ran it anyway, which meant that two
 * processes contending for longer than the deadline — an Electron host and a VS
 * Code host reconciling the same workspace — both proceeded unlocked and lost
 * each other's key with no error, no torn file and nothing in any health
 * report. That is precisely the failure the lock exists to prevent, so the one
 * outcome ruled out is writing unlocked in silence.
 *
 * Failing is affordable because every caller of this function already treats a
 * mutation failure as transient and retries on its own schedule:
 * `applyMcpFacet` records a `writeFailed` row that the next `mode: 'full'` pass
 * (every host activation) re-attempts; `AntigravityCliAdapter` documents its
 * spawn-time write as non-fatal and the next spawn rewrites it;
 * `CodeExecutionMCP` logs and deliberately keeps its registration record so a
 * later call retries. What is traded away is liveness for ONE mutation under
 * cross-process contention — which is the trade the deadline was already
 * making, just now in the direction that cannot lose data.
 *
 * `no-lock-directory` is deliberately NOT a failure here: see
 * {@link LockUnavailableReason}.
 *
 * @throws {FileLockTimeoutError} when the deadline expired under contention.
 */
export async function withFileLock<T>(
  lockFilePath: string,
  task: () => Promise<T>,
  options: FileLockOptions = {},
): Promise<T> {
  const handle = await acquireFileLock(lockFilePath, options);
  if (!handle.acquired && handle.reason === 'timeout') {
    throw new FileLockTimeoutError(lockFilePath, handle.waitedMs);
  }
  try {
    return await task();
  } finally {
    handle.release();
  }
}
