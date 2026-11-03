// Machine-wide FIFO counting lock for heavy checks (scripts/verify.mjs,
// .husky/pre-push).
//
// Several agent sessions and worktrees share one developer machine, and too
// many concurrent Nx/Jest runs exhaust its RAM. This lock replaces the old
// "is the slot free?" messages between sessions.
//
// Layout under <lockDir> (default: <os.tmpdir()>/ptah-verify-lock):
//   holder.json        slot 0. The path is the one the single-holder lock used,
//                      so a client that runs an older copy of this script still
//                      sees (and competes for) slot 0 only.
//   holder-<n>.json    slot n (1 .. slots-1).
//                      Slot files are created with link(), which is atomic and
//                      fails with EEXIST, so a reader never sees a half-written
//                      holder and two processes never own the same slot.
//   queue/<seq>.json   one ticket per waiter. Tickets sort by creation time.
//
// Admission (FIFO): a waiter takes a free slot only when no ticket ahead of it
// can take a free slot now. Tickets of the older single-holder client (no
// `format` field) can only take slot 0, and only from the head of the queue,
// so a newer waiter goes past an old ticket that cannot move.
//
// Memory gate: when at least one slot is held, a waiter also needs
// os.freemem() >= PTAH_VERIFY_MIN_FREE_GB, and the newest holder must have run
// for PTAH_VERIFY_SETTLE_SEC (a run's memory climbs after it starts, so free memory right
// after an admission says little). An empty lock always admits the waiter, so
// a lone run never starves. Old clients ignore the gate for slot 0.
//
// Limit of the mixed-version period: an old client checks a nested call's
// token (PTAH_VERIFY_LOCK_TOKEN) against slot 0 only. If a new holder in slot 1
// runs the OLD verify.mjs of another worktree, that child queues for slot 0 as
// a separate run. The usual nesting (pre-push hook, `npm run verify` inside
// `--exec`) calls the script of the same worktree, so it does not occur there.
//
// A holder is stale when its PID is dead or it is older than the maximum age.
// Only one waiter may remove a stale holder, so two waiters never race to
// replace it: the queue head for slot 0 (old clients do the same), and the
// first new-format ticket for the other slots. Waiters refresh their ticket
// every poll. A ticket whose PID is dead, or that has not been refreshed for
// TICKET_TTL_MS, is removed.

import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const POLL_MS = 1000;
const TICKET_TTL_MS = 5 * 60_000;
const UNREADABLE_GRACE_MS = 30_000;
const DEFAULT_MAX_AGE_MIN = 120;
const DEFAULT_SLOTS = 3;
const DEFAULT_MIN_FREE_GB = 5;
const DEFAULT_SETTLE_SEC = 30;
const GB = 1024 ** 3;
// Marks tickets and holders of this (multi-slot) version. See the header.
const FORMAT = 2;
const SLOT_FILE = /^holder(?:-(\d+))?\.json$/;

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

export function slotFile(slot) {
  const { dir, holder } = lockPaths();
  return slot === 0 ? holder : path.join(dir, `holder-${slot}.json`);
}

/** A non-negative number from the environment, or null when unset/invalid. */
function envNumber(name) {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return null;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? value : null;
}

/** Number of slots: PTAH_VERIFY_SLOTS, an integer >= 1 (default 3). */
export function slotCount() {
  const value = envNumber('PTAH_VERIFY_SLOTS');
  return Number.isInteger(value) && value >= 1 ? value : DEFAULT_SLOTS;
}

/** Free memory a waiter needs for a slot while another slot is held. */
export function minFreeBytes() {
  return (envNumber('PTAH_VERIFY_MIN_FREE_GB') ?? DEFAULT_MIN_FREE_GB) * GB;
}

/** Free memory in bytes. PTAH_VERIFY_FAKE_FREE_GB overrides it for tests. */
export function freeMemory() {
  const fake = envNumber('PTAH_VERIFY_FAKE_FREE_GB');
  return fake === null ? os.freemem() : fake * GB;
}

/** PTAH_VERIFY_SETTLE_SEC: how long the newest run runs before a second run. */
function settleMs() {
  return (envNumber('PTAH_VERIFY_SETTLE_SEC') ?? DEFAULT_SETTLE_SEC) * 1000;
}

export const formatGb = (bytes) => `${(bytes / GB).toFixed(1)} GB`;

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

/** The holder of one slot, null when it is free. */
export function readHolder(slot = 0) {
  const file = slotFile(slot);
  for (let attempt = 0; ; attempt++) {
    const result = inspect(file);
    if (result.status === 'ok') return result.value;
    if (result.status === 'missing') return null;
    if (attempt === 2) {
      return {
        unreadable: true,
        reason: result.status,
        mtimeMs: mtimeOf(file) ?? Date.now(),
      };
    }
    pause(50);
  }
}

/**
 * Every held slot as `{ slot, holder }`, sorted by slot. Slots above this
 * client's slotCount() are included: a client with a larger
 * PTAH_VERIFY_SLOTS can hold them, and they still use memory.
 * Returns null when the lock directory exists but cannot be listed: an empty
 * list would wrongly admit a waiter past the memory gate.
 */
export function readHolders() {
  let names;
  try {
    names = fs.readdirSync(lockPaths().dir);
  } catch (error) {
    return error.code === 'ENOENT' ? [] : null;
  }
  const slots = names
    .map((name) => SLOT_FILE.exec(name))
    .filter(Boolean)
    .map((match) => Number(match[1] ?? 0))
    .sort((a, b) => a - b);
  const held = [];
  for (const slot of slots) {
    const holder = readHolder(slot);
    if (holder) held.push({ slot, holder });
  }
  return held;
}

/** Records the PID of the command the holder runs. See staleReason(). */
export function recordChild(entry, childPid, slot = 0) {
  const file = slotFile(slot);
  const current = readJson(file);
  if (!current || current.token !== entry.token) return;
  writeAtomic(file, JSON.stringify({ ...current, childPid }, null, 2));
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

/** Removes a slot file only if it still is the stale entry we inspected. */
function breakStale(slot, expected) {
  const file = slotFile(slot);
  const moved = `${file}.stale-${process.pid}`;
  try {
    fs.renameSync(file, moved);
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
      fs.renameSync(moved, file);
      return;
    } catch {
      // A new holder exists already. The moved one is ours to drop.
    }
  }
  unlinkQuiet(moved);
}

// Tickets written by the single-holder client have no `format`. An unreadable
// ticket is treated as new: it may take any slot, so it keeps its place.
const isOldTicket = (ticket) => !ticket.unreadable && ticket.format !== FORMAT;

/**
 * Whether `ticket` at queue index `index` can take one of the `free` slots
 * now. An old client takes only slot 0, and only from the head of the queue.
 * A new client takes only slots below its own PTAH_VERIFY_SLOTS (`slots`).
 */
function canTakeNow(ticket, index, free) {
  if (isOldTicket(ticket)) return index === 0 && free.includes(0);
  const limit = typeof ticket.slots === 'number' ? ticket.slots : Infinity;
  return free.some((slot) => slot < limit);
}

/**
 * One admission decision for the ticket `ticketName`. Pure apart from its
 * inputs, so tests can drive it. Returns `{ take: slot }` or `{ wait: why }`.
 */
export function admission({
  ticketName,
  queue,
  holders,
  slots = slotCount(),
  freeBytes = freeMemory(),
  minFree = minFreeBytes(),
  settle = settleMs(),
  now = Date.now(),
}) {
  const occupied = new Set(holders.map((h) => h.slot));
  const free = [];
  for (let slot = 0; slot < slots; slot++)
    if (!occupied.has(slot)) free.push(slot);
  const position = queue.findIndex((t) => t.name === ticketName);
  const heldBy = holders.map((h) => describe(h.holder)).join('; ');
  // Our ticket is missing from this read of the queue (a read error, or the
  // ticket is being restored), so the FIFO order is unknown.
  if (position < 0)
    return { wait: 'waiting until our queue ticket is visible' };

  if (!free.length) {
    return {
      wait: `waiting for a slot: ${holders.length}/${slots} held by ${heldBy} (queue position ${position + 1})`,
    };
  }
  const ahead = queue.slice(0, position).find((t, i) => canTakeNow(t, i, free));
  if (ahead) return { wait: `waiting on queued ${describe(ahead)}` };

  if (holders.length) {
    if (freeBytes < minFree) {
      return {
        wait: `waiting for memory: ${formatGb(freeBytes)} free, a second run needs ${formatGb(minFree)} (held by ${heldBy})`,
      };
    }
    const newest = Math.max(
      ...holders.map((h) => (h.holder.unreadable ? 0 : h.holder.startedAt)),
    );
    if (now - newest < settle) {
      return {
        wait: `waiting for the newest run to settle before memory is measured (held by ${heldBy})`,
      };
    }
  }
  return { take: free[0] };
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Waits for a slot and takes it. Returns `{ entry, slot, release, reentrant }`.
 * `onWait(message)` receives progress lines for the user.
 */
export async function acquire({ task, worktree, onWait = () => {} }) {
  const paths = lockPaths();
  const inherited = process.env[TOKEN_ENV];
  if (inherited) {
    // An unreadable directory or slot file may hide the parent's slot. Wait
    // until it reads, or this nested call would queue for a second slot.
    let holders = readHolders();
    while (!holders || holders.some((h) => h.holder.reason === 'read')) {
      onWait('waiting: the lock files cannot be read to check our token');
      await sleep(POLL_MS);
      holders = readHolders();
    }
    const held = holders.find((h) => h.holder.token === inherited);
    if (held) {
      // A parent (e.g. the pre-push hook) already holds a slot for us.
      return {
        entry: held.holder,
        slot: held.slot,
        release: () => {},
        reentrant: true,
      };
    }
  }

  fs.mkdirSync(paths.queue, { recursive: true });
  const entry = {
    pid: process.pid,
    task,
    worktree,
    token: randomBytes(12).toString('hex'),
    startedAt: Date.now(),
    format: FORMAT,
    slots: slotCount(),
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
    const holders = readHolders();
    if (!holders) {
      report('waiting: the lock directory cannot be read');
      await sleep(POLL_MS);
      continue;
    }
    const atHead = queue[0]?.name === ticketName;
    const firstNew = queue.find((t) => !isOldTicket(t))?.name === ticketName;

    const stale = holders
      .map((h) => ({ ...h, reason: staleReason(h.holder) }))
      .filter((h) => h.reason);
    const mine = stale.filter((h) => (h.slot === 0 ? atHead : firstNew));
    if (mine.length) {
      for (const h of mine) {
        report(
          `stale slot ${h.slot} (${h.reason}): ${describe(h.holder)}. Taking over.`,
        );
        breakStale(h.slot, h.holder.unreadable ? null : h.holder);
      }
      // If the rename failed, do not spin.
      await sleep(POLL_MS / 10);
      continue;
    }

    const decision = admission({ ticketName, queue, holders });
    if ('wait' in decision) {
      report(decision.wait);
      await sleep(POLL_MS);
      continue;
    }

    const slot = decision.take;
    entry.startedAt = Date.now();
    if (writeExclusive(slotFile(slot), JSON.stringify(entry, null, 2))) {
      leaveQueue();
      process.removeListener('exit', leaveQueue);
      const release = () => {
        const current = readJson(slotFile(slot));
        if (current && current.token === entry.token)
          unlinkQuiet(slotFile(slot));
      };
      process.once('exit', release);
      return { entry, slot, release, reentrant: false };
    }
    // Another process took the slot first. Do not spin.
    await sleep(POLL_MS / 10);
  }
}
