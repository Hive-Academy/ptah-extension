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

function unlinkQuiet(file) {
  try {
    fs.unlinkSync(file);
  } catch {
    // Already gone: another process cleaned it up first.
  }
}

export function describe(entry) {
  if (!entry) return 'nobody';
  if (entry.unreadable) return 'an unreadable holder file';
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
    // link() publishes complete files, so this is corruption or a read that
    // AV or a sharing violation blocked. Only an old file counts as stale.
    const age = now - holder.mtimeMs;
    return age > UNREADABLE_GRACE_MS
      ? `holder file unreadable for ${Math.round(age / 1000)}s`
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
  for (let attempt = 0; attempt < 3; attempt++) {
    let mtimeMs;
    try {
      mtimeMs = fs.statSync(holder).mtimeMs;
    } catch {
      return null;
    }
    const entry = readJson(holder);
    if (entry && typeof entry.pid === 'number') return entry;
    if (attempt === 2) return { unreadable: true, mtimeMs };
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50);
  }
  return null;
}

/** Records the PID of the command the holder runs. See staleReason(). */
export function recordChild(entry, childPid) {
  const { holder } = lockPaths();
  const current = readJson(holder);
  if (!current || current.token !== entry.token) return;
  const tmp = `${holder}.${process.pid}.child.tmp`;
  fs.writeFileSync(tmp, JSON.stringify({ ...current, childPid }, null, 2));
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      fs.renameSync(tmp, holder);
      return;
    } catch {
      // A reader can hold the file open for a moment on Windows. Retry.
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50);
    }
  }
  unlinkQuiet(tmp);
}

/** Live tickets in FIFO order. Removes tickets of dead or silent waiters. */
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
    const ticket = readJson(file);
    let mtime = 0;
    try {
      mtime = fs.statSync(file).mtimeMs;
    } catch {
      continue;
    }
    if (!ticket || !isAlive(ticket.pid) || now - mtime > TICKET_TTL_MS) {
      unlinkQuiet(file);
      continue;
    }
    live.push({ name, ...ticket });
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
  if (current && expected && current.token !== expected.token) {
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
      fs.writeFileSync(ticketFile, ticketData);
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
