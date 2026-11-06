import { randomBytes } from 'node:crypto';
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { processStartTime, processState } from './process-state';

const OWNER_FILE = 'owner.json';
const POLL_MS = 25;
const DEFAULT_TIMEOUT_MS = 2000;

export interface FileLockOptions {
  /** How long to wait for another holder; default 2 s. */
  timeoutMs?: number;
  /**
   * Receives a failure to remove the lock after the operation finished. The
   * operation's result or error is still what the caller gets. Without it the
   * failure becomes a process warning. A lock that another owner holds by
   * then is never removed; that is reported here too.
   */
  onReleaseError?: (error: unknown) => void;
}

export class FileLockBusyError extends Error {
  readonly code = 'FILE_LOCK_BUSY';
  constructor(readonly file: string) {
    super(`Worker file is busy: ${file}`);
    this.name = 'FileLockBusyError';
  }
}

/**
 * Who holds a lock. `startedAt` (the owner's start time, from
 * `/proc/<pid>/stat` on Linux) tells a reused PID from the owner; `nonce`
 * tells this acquisition from any other, so a release removes only its own.
 */
interface LockOwner {
  pid: number;
  startedAt: string | null;
  nonce: string;
  acquiredAt: number;
}

/** Callers in this process queue per file instead of polling the lock. */
const tails = new Map<string, Promise<void>>();

/**
 * Runs `operation` while holding `<file>.lock`, a directory shared by every
 * process that uses the worker data path. The lock records its owner's PID,
 * start time and a nonce. A lock is stolen only when its owner is dead, or
 * when its PID now names a process with another start time (PID reuse). A
 * live owner keeps its lock however long it runs.
 */
export async function withFileLock<T>(
  file: string,
  operation: () => Promise<T>,
  options: FileLockOptions = {},
): Promise<T> {
  const previous = tails.get(file) ?? Promise.resolve();
  let done!: () => void;
  const tail = new Promise<void>((resolve) => {
    done = resolve;
  });
  tails.set(file, tail);
  try {
    // `previous` is another caller's tail: it always resolves, never rejects.
    await previous;
    return await locked(file, operation, options);
  } finally {
    done();
    if (tails.get(file) === tail) tails.delete(file);
  }
}

async function locked<T>(
  file: string,
  operation: () => Promise<T>,
  options: FileLockOptions,
): Promise<T> {
  const lock = `${file}.lock`;
  const deadline = Date.now() + (options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const owner = await acquireBefore(file, lock, deadline);
  let outcome: { ok: true; value: T } | { ok: false; error: unknown };
  try {
    outcome = { ok: true, value: await operation() };
  } catch (error) {
    outcome = { ok: false, error };
  }
  try {
    await release(lock, owner);
  } catch (error) {
    reportRelease(options, error);
  }
  if (!outcome.ok) throw outcome.error;
  return outcome.value;
}

async function acquireBefore(
  file: string,
  lock: string,
  deadline: number,
): Promise<LockOwner> {
  for (;;) {
    const owner = await acquire(lock);
    if (owner) return owner;
    if (await stealAbandoned(lock)) continue;
    if (Date.now() >= deadline) throw new FileLockBusyError(file);
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
}

/** Stages the owner record, then renames it into place: the lock always has an owner. */
async function acquire(lock: string): Promise<LockOwner | undefined> {
  const staging = `${lock}.${process.pid}.${randomBytes(6).toString('hex')}`;
  await mkdir(staging, { mode: 0o700 });
  try {
    const owner: LockOwner = {
      pid: process.pid,
      startedAt: await processStartTime(process.pid),
      nonce: randomBytes(16).toString('hex'),
      acquiredAt: Date.now(),
    };
    await writeFile(join(staging, OWNER_FILE), JSON.stringify(owner), {
      mode: 0o600,
    });
    await rename(staging, lock);
    return owner;
  } catch (error) {
    if (hasCode(error, 'ENOTEMPTY') || hasCode(error, 'EEXIST'))
      return undefined;
    throw error;
  } finally {
    // Gone after a successful rename; `force` makes that a no-op.
    await rm(staging, { recursive: true, force: true });
  }
}

/** Removes the lock only while it is still this acquisition's. */
async function release(lock: string, owner: LockOwner): Promise<void> {
  const current = await readOwner(lock);
  if (current === 'missing') return;
  if (current === 'unreadable' || current.nonce !== owner.nonce)
    throw new Error(`Worker file lock is held by another owner: ${lock}`);
  await rm(lock, { recursive: true, force: true });
}

/** True when the lock is free now: it was released, or its owner was dead and it was removed. */
async function stealAbandoned(lock: string): Promise<boolean> {
  const owner = await readOwner(lock);
  if (owner === 'missing') return true;
  if (owner !== 'unreadable' && !(await abandoned(owner))) return false;
  const grave = `${lock}.stale.${process.pid}.${randomBytes(6).toString('hex')}`;
  try {
    await rename(lock, grave);
  } catch (error) {
    if (hasCode(error, 'ENOENT')) return true;
    throw error;
  }
  const moved = await readOwner(grave);
  if (sameOwner(moved, owner)) {
    await rm(grave, { recursive: true, force: true });
    return true;
  }
  // Another process replaced the abandoned lock between our read and the
  // rename: hand its live lock back.
  await rename(grave, lock);
  return false;
}

/** Dead, another user's process (never ours), or a reused PID. */
async function abandoned(owner: LockOwner): Promise<boolean> {
  const state = processState(owner.pid);
  if (state !== 'alive') return true;
  if (!owner.startedAt) return false;
  const startedAt = await processStartTime(owner.pid);
  return startedAt !== null && startedAt !== owner.startedAt;
}

function sameOwner(
  a: LockOwner | 'missing' | 'unreadable',
  b: LockOwner | 'unreadable',
): boolean {
  if (a === 'missing') return false;
  if (a === 'unreadable' || b === 'unreadable') return a === b;
  return a.nonce === b.nonce && a.pid === b.pid;
}

async function readOwner(
  lock: string,
): Promise<LockOwner | 'missing' | 'unreadable'> {
  let text: string;
  try {
    text = await readFile(join(lock, OWNER_FILE), 'utf8');
  } catch (error) {
    if (!hasCode(error, 'ENOENT') && !hasCode(error, 'ENOTDIR')) throw error;
    return (await exists(lock)) ? 'unreadable' : 'missing';
  }
  return parseOwner(text);
}

function parseOwner(text: string): LockOwner | 'unreadable' {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    // degradation-audit: reported - an unparsable owner record cannot name a
    // live holder, so the caller treats the lock as abandoned and steals it.
    return 'unreadable';
  }
  if (
    typeof value === 'object' &&
    value !== null &&
    'pid' in value &&
    'acquiredAt' in value &&
    typeof value.pid === 'number' &&
    typeof value.acquiredAt === 'number'
  ) {
    const startedAt =
      'startedAt' in value && typeof value.startedAt === 'string'
        ? value.startedAt
        : null;
    // A lock written before owner nonces existed is matched by PID and time.
    const nonce =
      'nonce' in value && typeof value.nonce === 'string'
        ? value.nonce
        : `legacy:${value.acquiredAt}`;
    return {
      pid: value.pid,
      startedAt,
      nonce,
      acquiredAt: value.acquiredAt,
    };
  }
  return 'unreadable';
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (hasCode(error, 'ENOENT')) return false;
    throw error;
  }
}

function reportRelease(options: FileLockOptions, error: unknown): void {
  if (options.onReleaseError) {
    options.onReleaseError(error);
    return;
  }
  process.emitWarning(
    `Worker file lock release failed: ${error instanceof Error ? error.message : String(error)}`,
  );
}

function hasCode(error: unknown, code: string): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === code
  );
}
