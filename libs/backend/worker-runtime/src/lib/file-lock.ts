import { randomBytes } from 'node:crypto';
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { processState } from './process-state';

const OWNER_FILE = 'owner.json';
const POLL_MS = 25;
const DEFAULT_TIMEOUT_MS = 2000;
/**
 * A lock held this long by another live process is treated as abandoned: its
 * PID was reused after the owner died. Every locked operation is a small JSON
 * read and write, so a real holder never comes near this.
 */
const STALE_MS = 60_000;

export interface FileLockOptions {
  /** How long to wait for another holder; default 2 s. */
  timeoutMs?: number;
  /**
   * Receives a failure to remove the lock after the operation finished. The
   * operation's result or error is still what the caller gets. Without it the
   * failure becomes a process warning.
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

interface LockOwner {
  pid: number;
  acquiredAt: number;
}

/** Callers in this process queue per file instead of polling the lock. */
const tails = new Map<string, Promise<void>>();

/**
 * Runs `operation` while holding `<file>.lock`, a directory shared by every
 * process that uses the worker data path. The lock directory carries its
 * owner's PID; a lock whose owner process is dead (or that a reused PID has
 * held for over a minute) is stolen, so a crash never locks the file forever.
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
  for (;;) {
    if (await acquire(lock)) break;
    if (await stealAbandoned(lock)) continue;
    if (Date.now() >= deadline) throw new FileLockBusyError(file);
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
  let outcome: { ok: true; value: T } | { ok: false; error: unknown };
  try {
    outcome = { ok: true, value: await operation() };
  } catch (error) {
    outcome = { ok: false, error };
  }
  try {
    await rm(lock, { recursive: true, force: true });
  } catch (error) {
    reportRelease(options, error);
  }
  if (!outcome.ok) throw outcome.error;
  return outcome.value;
}

/** Stages the owner record, then renames it into place: the lock always has an owner. */
async function acquire(lock: string): Promise<boolean> {
  const staging = `${lock}.${process.pid}.${randomBytes(6).toString('hex')}`;
  await mkdir(staging, { mode: 0o700 });
  try {
    const owner: LockOwner = { pid: process.pid, acquiredAt: Date.now() };
    await writeFile(join(staging, OWNER_FILE), JSON.stringify(owner), {
      mode: 0o600,
    });
    await rename(staging, lock);
    return true;
  } catch (error) {
    if (hasCode(error, 'ENOTEMPTY') || hasCode(error, 'EEXIST')) return false;
    throw error;
  } finally {
    // Gone after a successful rename; `force` makes that a no-op.
    await rm(staging, { recursive: true, force: true });
  }
}

/** True when the lock is free now: it was released, or its owner was dead and it was removed. */
async function stealAbandoned(lock: string): Promise<boolean> {
  const owner = await readOwner(lock);
  if (owner === 'missing') return true;
  if (owner !== 'unreadable' && !abandoned(owner)) return false;
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

function abandoned(owner: LockOwner): boolean {
  const state = processState(owner.pid);
  if (state === 'dead') return true;
  return owner.pid !== process.pid && Date.now() - owner.acquiredAt > STALE_MS;
}

function sameOwner(
  a: LockOwner | 'missing' | 'unreadable',
  b: LockOwner | 'unreadable',
): boolean {
  if (a === 'missing') return false;
  if (a === 'unreadable' || b === 'unreadable') return a === b;
  return a.pid === b.pid && a.acquiredAt === b.acquiredAt;
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
  )
    return { pid: value.pid, acquiredAt: value.acquiredAt };
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
