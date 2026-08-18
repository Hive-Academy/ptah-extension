/**
 * Cross-process workspace lock for reconcile (edge case E11).
 *
 * VS Code, Electron, `ptah tui` and a cron job can all reconcile the same
 * workspace at the same moment. Without a lock the read-modify-write on the
 * managed manifest interleaves: the second writer persists a snapshot taken
 * before the first writer's entries existed, those entries vanish from the
 * record, and the NEXT reconcile classifies Ptah's own files as foreign and
 * refuses to update them forever. That is defect 10 in the TASK_2026_278
 * inventory, and it is silent.
 *
 * Design constraints that shaped this:
 *
 * - **`O_EXCL` create, not a mutex.** The contenders are separate OS processes,
 *   possibly separate installs. The filesystem is the only thing they share.
 * - **Stale detection is mandatory.** A host killed mid-reconcile leaves the
 *   lock file behind. A lock older than {@link STALE_AFTER_MS} is broken and
 *   reclaimed; without that rule one crash disables reconcile permanently.
 * - **Failure to acquire never blocks the work.** After ~5s of contention the
 *   caller proceeds unlocked with a warning. A workspace that reconciles with a
 *   small race risk beats one whose skills never appear because a stale peer
 *   held a file. The in-process queue below makes the common case (two calls in
 *   ONE host) fully serialized anyway.
 */

import {
  closeSync,
  mkdirSync,
  openSync,
  readFileSync,
  rmSync,
  writeSync,
} from 'fs';
import { join } from 'path';
import { HARNESS_STATE_DIR } from '../manifest-store/managed-manifest';

/** A lock this old is assumed to belong to a dead process. */
export const STALE_AFTER_MS = 30_000;

/** Give up waiting after this and proceed unlocked. */
const MAX_WAIT_MS = 5_000;

const FIRST_BACKOFF_MS = 25;
const MAX_BACKOFF_MS = 400;

export interface HarnessLockHandle {
  /** False when the lock could not be taken and the caller proceeded anyway. */
  acquired: boolean;
  release(): void;
}

interface LockPayload {
  pid: number;
  at: number;
}

export function lockPath(workspaceRoot: string): string {
  return join(workspaceRoot, HARNESS_STATE_DIR, '.lock');
}

/**
 * Serializes reconciles inside THIS process, per workspace.
 *
 * The file lock alone would make two concurrent in-process calls busy-wait
 * against each other for up to 5 seconds and then both proceed unlocked. A
 * promise chain per workspace turns that into an ordered queue at zero cost.
 */
const inProcessQueue = new Map<string, Promise<unknown>>();

function queueKey(workspaceRoot: string): string {
  return process.platform === 'win32'
    ? workspaceRoot.toLowerCase()
    : workspaceRoot;
}

/** Run `task` after every previously-queued task for this workspace. */
export function serializePerWorkspace<T>(
  workspaceRoot: string,
  task: () => Promise<T>,
): Promise<T> {
  const key = queueKey(workspaceRoot);
  const previous = inProcessQueue.get(key) ?? Promise.resolve();
  const next = previous.then(task, task);
  // Keep the chain alive but never let a rejection poison the next caller.
  inProcessQueue.set(
    key,
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
 * Break the lock if it is older than {@link STALE_AFTER_MS}.
 *
 * An unparseable or unreadable lock file counts as stale: it cannot prove a
 * live owner, and refusing to break it would strand the workspace.
 */
function breakIfStale(path: string, now: number): boolean {
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

  if (payload !== null && now - payload.at < STALE_AFTER_MS) return false;

  try {
    rmSync(path, { force: true });
    return true;
  } catch {
    return false;
  }
}

/**
 * Acquire the workspace lock, waiting up to ~5s.
 *
 * Always returns a handle. Check `acquired` to decide whether to log the
 * degraded path; `release()` is safe either way.
 */
export async function acquireWorkspaceLock(
  workspaceRoot: string,
  options: { maxWaitMs?: number; staleAfterMs?: number } = {},
): Promise<HarnessLockHandle> {
  const path = lockPath(workspaceRoot);
  const maxWaitMs = options.maxWaitMs ?? MAX_WAIT_MS;

  try {
    mkdirSync(join(workspaceRoot, HARNESS_STATE_DIR), { recursive: true });
  } catch {
    // An unwritable workspace cannot be locked and cannot be reconciled; the
    // targets will report write-failed per entry, which is the right surface.
    return { acquired: false, release: () => undefined };
  }

  const deadline = Date.now() + maxWaitMs;
  let backoff = FIRST_BACKOFF_MS;

  for (;;) {
    if (tryCreate(path)) {
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

    if (breakIfStale(path, Date.now()) && tryCreate(path)) {
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

    if (Date.now() >= deadline) {
      return { acquired: false, release: () => undefined };
    }

    await sleep(backoff);
    backoff = Math.min(backoff * 2, MAX_BACKOFF_MS);
  }
}
