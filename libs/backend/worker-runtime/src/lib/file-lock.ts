import { createHash } from 'node:crypto';
import * as net from 'node:net';
import { realpath } from 'node:fs/promises';
import { userInfo } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';

const POLL_MS = 25;
const DEFAULT_TIMEOUT_MS = 2000;

export interface FileLockOptions {
  /** How long to wait for another holder; default 2 s. */
  timeoutMs?: number;
  /**
   * Receives a failure to release the lock after the operation finished. The
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

/** Callers in this process queue per file instead of polling the lock. */
const tails = new Map<string, Promise<void>>();

/**
 * Runs `operation` while holding the lock for `file`, shared by every process
 * of this OS user. The lock is a listening endpoint whose name derives from the
 * canonical path (symlinks in the parent resolved): an abstract Unix socket on Linux, a named pipe on Windows.
 * The kernel lets one process bind a name at a time and frees it when that
 * process exits or crashes, so there is no owner record and no stale lock to
 * take over. A live holder keeps its lock however long it runs.
 */
export async function withFileLock<T>(
  file: string,
  operation: () => Promise<T>,
  options: FileLockOptions = {},
): Promise<T> {
  const previous = tails.get(file) ?? Promise.resolve();
  let done!: () => void;
  const tail = new Promise<void>((resolveTail) => {
    done = resolveTail;
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

/**
 * `file` with its parent directory's symlinks resolved, so every path that
 * reaches the same file names the same lock. A missing parent directory has
 * no file to share yet; its lexical absolute path is used then.
 */
async function canonicalFile(file: string): Promise<string> {
  const absolute = resolve(file);
  try {
    return join(await realpath(dirname(absolute)), basename(absolute));
  } catch (error) {
    if (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      error.code === 'ENOENT'
    )
      return absolute;
    throw error;
  }
}

/** The OS endpoint name that stands for `file`'s lock. */
async function fileLockEndpoint(file: string): Promise<string> {
  const digest = createHash('sha256')
    .update(await canonicalFile(file))
    .digest('hex')
    .slice(0, 32);
  const name = `ptah-worker-lock-${userKey()}-${digest}`;
  if (process.platform === 'linux') return `\0${name}`;
  if (process.platform === 'win32') return `\\\\.\\pipe\\${name}`;
  throw new Error('Worker file locks need Linux or Windows');
}

async function locked<T>(
  file: string,
  operation: () => Promise<T>,
  options: FileLockOptions,
): Promise<T> {
  const endpoint = await fileLockEndpoint(file);
  const deadline = Date.now() + (options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const server = await acquireBefore(file, endpoint, deadline);
  let outcome: { ok: true; value: T } | { ok: false; error: unknown };
  try {
    outcome = { ok: true, value: await operation() };
  } catch (error) {
    outcome = { ok: false, error };
  }
  try {
    await closeServer(server);
  } catch (error) {
    reportRelease(options, error);
  }
  if (!outcome.ok) throw outcome.error;
  return outcome.value;
}

async function acquireBefore(
  file: string,
  endpoint: string,
  deadline: number,
): Promise<net.Server> {
  for (;;) {
    const server = await bind(endpoint);
    if (server) return server;
    if (Date.now() >= deadline) throw new FileLockBusyError(file);
    await new Promise((wake) => setTimeout(wake, POLL_MS));
  }
}

/** The bound server, or undefined while another holder has the name. */
async function bind(endpoint: string): Promise<net.Server | undefined> {
  // Nothing is meant to connect; a peer that does is dropped at once so it can
  // never delay server.close() during release.
  const server = net.createServer((socket) => socket.destroy());
  const error = await new Promise<NodeJS.ErrnoException | null>((settle) => {
    server.once('error', settle);
    server.listen(endpoint, () => {
      server.off('error', settle);
      settle(null);
    });
  });
  if (!error) {
    // The bind is the lock; it must not keep a finished process alive.
    server.unref();
    return server;
  }
  if (error.code === 'EADDRINUSE') return undefined;
  throw error;
}

function closeServer(server: net.Server): Promise<void> {
  return new Promise((settle, fail) => {
    server.close((error) => (error ? fail(error) : settle()));
  });
}

/** OS-user identity: the UID, or a hash of the normalized username on Windows. */
function userKey(): string {
  const info = userInfo();
  if (process.platform !== 'win32') return String(info.uid);
  return createHash('sha256')
    .update(info.username.normalize('NFKC').toLowerCase())
    .digest('hex')
    .slice(0, 16);
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
