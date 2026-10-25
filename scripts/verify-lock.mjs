// Machine-wide FIFO lock for heavy checks (scripts/verify.mjs, .husky/pre-push).
//
// Several agent sessions and worktrees share one developer machine, and two
// concurrent Nx/Jest runs exhaust its RAM. This lock replaces the old
// "is the slot free?" messages between sessions.
//
// Layout under <lockDir> (default: <os.tmpdir()>/ptah-verify-lock):
//   holder.json        the current holder. Created with link(), which is
//                      atomic and fails with EEXIST, so a reader never sees a
//                      half-written holder and two processes never both win.
//   queue/<seq>.json   one ticket per waiter. Tickets sort by creation time,
//                      and only the first live ticket may take the lock (FIFO).
//
// A holder is stale when its PID is dead or it is older than the maximum age.
// Only the head of the queue removes a stale holder, so two waiters never
// race to replace it. Waiters refresh their ticket every poll. A ticket whose
// PID is dead, or that has not been refreshed for TICKET_TTL_MS, is removed.

import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const POLL_MS = 1000;
const TICKET_TTL_MS = 5 * 60_000;
const UNREADABLE_GRACE_MS = 30_000;
const DEFAULT_MAX_AGE_MIN = 120;

export const TOKEN_ENV = 'PTAH_VERIFY_LOCK_TOKEN';

export function lockPaths() {
  const dir =
    process.env.PTAH_VERIFY_LOCK_DIR ||
    path.join(os.tmpdir(), 'ptah-verify-lock');
  return {
    dir,
    holder: path.join(dir, 'holder.json'),
    queue: path.join(dir, 'queue'),
  };
}

function maxAgeMs() {
  const minutes = Number(process.env.PTAH_VERIFY_LOCK_MAX_AGE_MIN);
  return (
    (Number.isFinite(minutes) && minutes > 0 ? minutes : DEFAULT_MAX_AGE_MIN) *
    60_000
  );
}

function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM: the process exists but belongs to another user.
    return error.code === 'EPERM';
  }
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    // Missing (released meanwhile) or unreadable: the caller treats it as absent.
    return null;
  }
}

/**
 * Reads a lock file and says why it failed. 'missing' means released;
 * 'read' (EBUSY/EPERM from AV or a sharing violation) is inconclusive;
 * 'corrupt' means the file exists and its content is not a lock entry.
 */
function inspect(file) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (error) {
    return { status: error.code === 'ENOENT' ? 'missing' : 'read' };
  }
  try {
    const value = JSON.parse(text);
    if (value && typeof value.pid === 'number') return { status: 'ok', value };
  } catch {
    // Falls through to 'corrupt'.
  }
  return { status: 'corrupt' };
}

function mtimeOf(file) {
  try {
    return fs.statSync(file).mtimeMs;
  } catch {
    return null;
  }
}

function pause(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

// Publishes a complete file in one step, so readers never see it half written.
function writeAtomic(target, data) {
  const tmp = `${target}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`;
  fs.writeFileSync(tmp, data);
  for (let attempt = 0; ; attempt++) {
    try {
      fs.renameSync(tmp, target);
      return true;
    } catch (error) {
      if (attempt >= 4) {
        unlinkQuiet(tmp);
        return false;
      }
      // A reader can hold the target open for a moment on Windows. Retry.
      pause(50);
    }
  }
}

function unlinkQuiet(file) {
  try {
    fs.unlinkSync(file);
  } catch {
    // Already gone: another process cleaned it up first.
  }
}

export function describe(entry) {
  if (!entry) return 'nobody';
  if (entry.unreadable) return `an unreadable lock file (${entry.reason})`;
  const started = new Date(entry.startedAt);
  const since = Number.isNaN(started.getTime())
    ? 'an unknown time'
    : started.toISOString();
  return `pid ${entry.pid} [${entry.task}] in ${entry.worktree} since ${since}`;
}

/**
 * Why the holder is stale, or null while it is valid.
 *
 * The holder is alive while its own PID or the PID of the command it runs
 * (`childPid`) is alive. On POSIX a hard kill (SIGKILL) of verify.mjs leaves
 * the command running, and the lock must stay until it ends too. On Windows
 * Node's kill-on-close job object ends the command with verify.mjs.
 */
export function staleReason(holder, now = Date.now()) {
  if (holder.unreadable) {
    // A read error (AV, sharing violation) says nothing about the holder, so
    // it never makes the lock stale. Corrupt content does: a live holder's
    // file always parses, because link() and rename() publish complete files.
    // The grace period covers the brief empty file of the 'wx' fallback.
    if (holder.reason !== 'corrupt') return null;
    const age = now - holder.mtimeMs;
    return age > UNREADABLE_GRACE_MS
      ? `holder file corrupt for ${Math.round(age / 1000)}s`
      : null;
  }
  const age = now - holder.startedAt;
  if (age > maxAgeMs())
    return `held for ${Math.round(age / 1000)}s, more than the max age`;
  if (isAlive(holder.pid)) return null;
  if (typeof holder.childPid === 'number' && isAlive(holder.childPid))
    return null;
  return `pid ${holder.pid} is not running`;
}

export function readHolder() {
  const { holder } = lockPaths();
  for (let attempt = 0; ; attempt++) {
    const result = inspect(holder);
    if (result.status === 'ok') return result.value;
    if (result.status === 'missing') return null;
    if (attempt === 2) {
      return {
        unreadable: true,
        reason: result.status,
        mtimeMs: mtimeOf(holder) ?? Date.now(),
      };
    }
    pause(50);
  }
}

/** Records the PID of the command the holder runs. See staleReason(). */
export function recordChild(entry, childPid) {
  const { holder } = lockPaths();
  const current = readJson(holder);
  if (!current || current.token !== entry.token) return;
  writeAtomic(holder, JSON.stringify({ ...current, childPid }, null, 2));
}

/**
 * Live tickets in FIFO order. Removes tickets of dead or silent waiters.
 * A ticket that cannot be read right now keeps its place in the queue.
 */
export function readQueue(now = Date.now()) {
  const { queue } = lockPaths();
  let names;
  try {
    names = fs
      .readdirSync(queue)
      .filter((n) => n.endsWith('.json'))
      .sort();
  } catch {
    return [];
  }
  const live = [];
  for (const name of names) {
    const file = path.join(queue, name);
    const result = inspect(file);
    const mtime = mtimeOf(file);
    if (result.status === 'missing' || mtime === null) continue;
    const silent = now - mtime > TICKET_TTL_MS;
    if (result.status === 'ok') {
      if (!isAlive(result.value.pid) || silent) unlinkQuiet(file);
      else live.push({ name, ...result.value });
      continue;
    }
    // Tickets are published with rename(), so 'corrupt' is real damage. Drop
    // it only once it is old. Until then, and for read errors, keep the slot.
    if (result.status === 'corrupt' && now - mtime > UNREADABLE_GRACE_MS) {
      unlinkQuiet(file);
      continue;
    }
    live.push({ name, unreadable: true, reason: result.status });
  }
  return live;
}

function writeExclusive(target, data) {
  const tmp = `${target}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`;
  fs.writeFileSync(tmp, data);
  try {
    fs.linkSync(tmp, target);
    return true;
  } catch (error) {
    if (error.code === 'EEXIST') return false;
    // No hard links on this file system. An exclusive create is still atomic
    // for the "who wins" part. readHolder() retries a briefly empty file.
    try {
      fs.writeFileSync(target, data, { flag: 'wx' });
      return true;
    } catch (fallbackError) {
      if (fallbackError.code === 'EEXIST') return false;
      throw fallbackError;
    }
  } finally {
    unlinkQuiet(tmp);
  }
}

/** Removes `holder.json` only if it still is the stale entry we inspected. */
function breakStale(expected) {
  const { holder } = lockPaths();
  const moved = `${holder}.stale-${process.pid}`;
  try {
    fs.renameSync(holder, moved);
  } catch {
    return;
  }
  const current = readJson(moved);
  // expected === null: we judged a corrupt file. If it parses now, a holder
  // replaced it meanwhile, so it is not ours to drop.
  const replaced = expected
    ? current && current.token !== expected.token
    : current && typeof current.pid === 'number';
  if (replaced) {
    // The holder changed between our read and the rename. Put it back.
    try {
      fs.renameSync(moved, holder);
      return;
    } catch {
      // A new holder exists already. The moved one is ours to drop.
    }
  }
  unlinkQuiet(moved);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Waits for the lock and takes it. Returns `{ entry, release, reentrant }`.
 * `onWait(message)` receives progress lines for the user.
 */
export async function acquire({ task, worktree, onWait = () => {} }) {
  const paths = lockPaths();
  const inherited = process.env[TOKEN_ENV];
  if (inherited) {
    const holder = readHolder();
    if (holder && holder.token === inherited) {
      // A parent (e.g. the pre-push hook) already holds it for us.
      return { entry: holder, release: () => {}, reentrant: true };
    }
  }

  fs.mkdirSync(paths.queue, { recursive: true });
  const entry = {
    pid: process.pid,
    task,
    worktree,
    token: randomBytes(12).toString('hex'),
    startedAt: Date.now(),
  };
  const ticketName = `${String(Date.now()).padStart(15, '0')}-${String(process.pid).padStart(8, '0')}.json`;
  const ticketFile = path.join(paths.queue, ticketName);
  const ticketData = JSON.stringify(entry);
  const leaveQueue = () => unlinkQuiet(ticketFile);
  process.once('exit', leaveQueue);

  let lastMessage = '';
  let lastPrinted = 0;
  const report = (message) => {
    const now = Date.now();
    if (message !== lastMessage || now - lastPrinted > 60_000) {
      onWait(message);
      lastMessage = message;
      lastPrinted = now;
    }
  };

  for (;;) {
    // Refresh (or restore) our ticket so other waiters see we are alive.
    try {
      const now = new Date();
      fs.utimesSync(ticketFile, now, now);
    } catch {
      writeAtomic(ticketFile, ticketData);
    }

    const queue = readQueue();
    const head = queue[0];
    const atHead = head?.name === ticketName;
    const holder = readHolder();

    if (holder) {
      const reason = staleReason(holder);
      if (reason && atHead) {
        report(`stale lock (${reason}): ${describe(holder)}. Taking over.`);
        breakStale(holder.unreadable ? null : holder);
        // Fall through to the sleep: if the rename failed, do not spin.
        await sleep(POLL_MS / 10);
        continue;
      }
      const position = queue.findIndex((t) => t.name === ticketName) + 1;
      report(`waiting on ${describe(holder)} (queue position ${position})`);
    } else if (!atHead) {
      report(`waiting on queued ${describe(head)}`);
    } else {
      entry.startedAt = Date.now();
      if (writeExclusive(paths.holder, JSON.stringify(entry, null, 2))) {
        leaveQueue();
        process.removeListener('exit', leaveQueue);
        const release = () => {
          const current = readJson(paths.holder);
          if (current && current.token === entry.token)
            unlinkQuiet(paths.holder);
        };
        process.once('exit', release);
        return { entry, release, reentrant: false };
      }
      continue;
    }
    await sleep(POLL_MS);
  }
}
