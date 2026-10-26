// Tests for the counting verify lock (scripts/verify-lock.mjs).
//
//   node scripts/verify.mjs --exec --task verify-lock-test -- node --test scripts/verify-lock.test.mjs
//
// Plain node:test, not Jest: verify-lock.mjs is an ES module script with no
// Nx project. The process tests start real `verify.mjs --exec` sleepers on a
// private lock directory, so they never touch the machine-wide lock. The
// compatibility test also starts the single-holder version of the scripts
// (`git show OLD_REF:scripts/...`) to prove that old and new
// clients share the lock without two owners of one slot.

import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

import { admission } from './verify-lock.mjs';

const GB = 1024 ** 3;
const here = path.dirname(fileURLToPath(import.meta.url));
// The last commit of the single-holder lock.
const OLD_REF = 'b72dd7a54';

const holder = (slot, startedAt = 0, extra = {}) => ({
  slot,
  holder: { pid: 1, task: `t${slot}`, worktree: 'w', startedAt, ...extra },
});
const ticket = (name, format = 2) => ({
  name,
  pid: 1,
  task: name,
  worktree: 'w',
  startedAt: 0,
  ...(format ? { format } : {}),
});
const base = {
  slots: 2,
  freeBytes: 20 * GB,
  minFree: 8 * GB,
  settle: 30_000,
  now: 100_000,
};

test('an empty lock admits the head even with no free memory', () => {
  const result = admission({
    ...base,
    ticketName: 'a',
    queue: [ticket('a')],
    holders: [],
    freeBytes: 0,
  });
  assert.deepEqual(result, { take: 0 });
});

test('a second run takes slot 1 when memory is free and the first settled', () => {
  const result = admission({
    ...base,
    ticketName: 'b',
    queue: [ticket('b')],
    holders: [holder(0, 10_000)],
  });
  assert.deepEqual(result, { take: 1 });
});

test('the memory gate holds the second slot', () => {
  const result = admission({
    ...base,
    ticketName: 'b',
    queue: [ticket('b')],
    holders: [holder(0, 10_000)],
    freeBytes: 7.9 * GB,
  });
  assert.match(result.wait, /^waiting for memory: 7\.9 GB free/);
});

test('a run that just started blocks a second admission until it settles', () => {
  const result = admission({
    ...base,
    ticketName: 'b',
    queue: [ticket('b')],
    holders: [holder(0, 90_000)],
  });
  assert.match(result.wait, /^waiting for the newest run to settle/);
});

test('all slots held: wait for a slot', () => {
  const result = admission({
    ...base,
    ticketName: 'c',
    queue: [ticket('c')],
    holders: [holder(0), holder(1)],
  });
  assert.match(result.wait, /^waiting for a slot: 2\/2 held/);
});

test('FIFO: a new ticket ahead takes the free slot first', () => {
  const result = admission({
    ...base,
    ticketName: 'b',
    queue: [ticket('a'), ticket('b')],
    holders: [],
  });
  assert.match(result.wait, /^waiting on queued/);
});

test('an old ticket at the head claims a free slot 0', () => {
  const result = admission({
    ...base,
    ticketName: 'b',
    queue: [ticket('old', 0), ticket('b')],
    holders: [],
  });
  assert.match(result.wait, /^waiting on queued .*\[old\]/);
});

test('an old ticket that cannot take slot 0 does not block a new waiter', () => {
  const result = admission({
    ...base,
    ticketName: 'b',
    queue: [ticket('old', 0), ticket('b')],
    holders: [holder(0)],
  });
  assert.deepEqual(result, { take: 1 });
});

test('a waiter whose ticket is not in the queue read does not take a slot', () => {
  const result = admission({
    ...base,
    ticketName: 'b',
    queue: [],
    holders: [],
  });
  assert.match(result.wait, /queue ticket is visible/);
});

test('PTAH_VERIFY_SLOTS=1 keeps the single-holder behavior', () => {
  const result = admission({
    ...base,
    slots: 1,
    ticketName: 'b',
    queue: [ticket('b')],
    holders: [holder(0)],
  });
  assert.match(result.wait, /^waiting for a slot: 1\/1/);
});

test('a slot above this client slot count still counts as a held run', () => {
  const result = admission({
    ...base,
    slots: 2,
    ticketName: 'b',
    queue: [ticket('b')],
    holders: [holder(2, 10_000)],
    freeBytes: 1 * GB,
  });
  assert.match(result.wait, /^waiting for memory/);
});

// ---- Real processes -------------------------------------------------------

const SLEEP_MS = 2500;
const SLEEPER = `
const fs = require('fs');
const [log, id] = process.argv.slice(1);
fs.appendFileSync(log, 'start ' + id + ' ' + Date.now() + '\\n');
setTimeout(() => fs.appendFileSync(log, 'end ' + id + ' ' + Date.now() + '\\n'), ${SLEEP_MS});
`;

function tempDir(name) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `verify-lock-${name}-`));
}

/** Starts one `verify.mjs --exec` sleeper. Resolves with its exit code and output. */
function sleeper(script, { lockDir, log, id, env = {} }) {
  const child = spawn(
    process.execPath,
    [
      script,
      '--exec',
      '--task',
      id,
      '--',
      process.execPath,
      '-e',
      SLEEPER,
      log,
      id,
    ],
    {
      env: {
        ...process.env,
        PTAH_VERIFY_LOCK_DIR: lockDir,
        PTAH_VERIFY_LOCK_TOKEN: '',
        ...env,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  let output = '';
  child.stdout.on('data', (d) => (output += d));
  child.stderr.on('data', (d) => (output += d));
  return new Promise((resolve) =>
    child.on('exit', (code) => resolve({ id, code, output })),
  );
}

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Starts sleepers 300 ms apart, so their queue order is fixed. */
async function runAll(specs) {
  const runs = [];
  for (const spec of specs) {
    runs.push(sleeper(spec.script, spec));
    await delay(300);
  }
  return Promise.all(runs);
}

/** The largest number of sleepers that ran at the same time. */
function maxOverlap(log) {
  const events = fs
    .readFileSync(log, 'utf8')
    .trim()
    .split('\n')
    .map((line) => {
      const [kind, id, time] = line.split(' ');
      return { kind, id, time: Number(time) };
    })
    .sort((a, b) => a.time - b.time || (a.kind === 'end' ? -1 : 1));
  let current = 0;
  let max = 0;
  for (const event of events) {
    current += event.kind === 'start' ? 1 : -1;
    max = Math.max(max, current);
  }
  return { max, events };
}

const NEW_SCRIPT = path.join(here, 'verify.mjs');
const fastGate = {
  PTAH_VERIFY_SLOTS: '2',
  PTAH_VERIFY_MIN_FREE_GB: '8',
  PTAH_VERIFY_FAKE_FREE_GB: '20',
  PTAH_VERIFY_SETTLE_SEC: '0',
};

test('three sleepers: two run at once, the third waits for a slot', async () => {
  const lockDir = tempDir('slots');
  const log = path.join(lockDir, 'events.log');
  const results = await runAll(
    ['a', 'b', 'c'].map((id) => ({
      script: NEW_SCRIPT,
      lockDir,
      log,
      id,
      env: fastGate,
    })),
  );
  for (const r of results) assert.equal(r.code, 0, r.output);
  assert.equal(maxOverlap(log).max, 2);
  const third = results.find((r) => r.id === 'c').output;
  assert.match(third, /waiting for a slot: 2\/2 held/);
});

test('the memory gate holds the second slot when free memory is low', async () => {
  const lockDir = tempDir('memory');
  const log = path.join(lockDir, 'events.log');
  const results = await runAll(
    ['a', 'b'].map((id) => ({
      script: NEW_SCRIPT,
      lockDir,
      log,
      id,
      env: { ...fastGate, PTAH_VERIFY_FAKE_FREE_GB: '2' },
    })),
  );
  for (const r of results) assert.equal(r.code, 0, r.output);
  assert.equal(maxOverlap(log).max, 1);
  assert.match(
    results.find((r) => r.id === 'b').output,
    /waiting for memory: 2\.0 GB free/,
  );
});

test('old single-holder clients and new clients never share a slot', async (t) => {
  const oldDir = tempDir('old-scripts');
  for (const file of ['verify.mjs', 'verify-lock.mjs']) {
    let text;
    try {
      text = execFileSync('git', ['show', `${OLD_REF}:scripts/${file}`], {
        cwd: here,
        encoding: 'utf8',
      });
    } catch {
      t.skip(`git show ${OLD_REF} is not available`);
      return;
    }
    fs.writeFileSync(path.join(oldDir, file), text);
  }
  const OLD_SCRIPT = path.join(oldDir, 'verify.mjs');
  const lockDir = tempDir('mixed');
  const log = path.join(lockDir, 'events.log');
  const results = await runAll(
    [
      // new1 takes slot 0. old1 needs slot 0 and waits at the head. new2 goes
      // past old1 into slot 1. old2 waits behind old1. new3 waits for a slot.
      { script: NEW_SCRIPT, id: 'new1' },
      { script: OLD_SCRIPT, id: 'old1' },
      { script: NEW_SCRIPT, id: 'new2' },
      { script: OLD_SCRIPT, id: 'old2' },
      { script: NEW_SCRIPT, id: 'new3' },
    ].map((spec) => ({ ...spec, lockDir, log, env: fastGate })),
  );
  for (const r of results) assert.equal(r.code, 0, `${r.id}: ${r.output}`);
  const { max, events } = maxOverlap(log);
  assert.equal(max, 2);

  // Old clients only use slot 0. No two runs that use slot 0 overlap.
  const slotOf = (r) =>
    r.id.startsWith('old')
      ? 0
      : Number(/lock slot (\d+) acquired/.exec(r.output)[1]);
  const spans = results.map((r) => ({
    id: r.id,
    slot: slotOf(r),
    start: events.find((e) => e.kind === 'start' && e.id === r.id).time,
    end: events.find((e) => e.kind === 'end' && e.id === r.id).time,
  }));
  for (const a of spans)
    for (const b of spans)
      if (a !== b && a.slot === b.slot)
        assert.ok(
          a.end <= b.start || b.end <= a.start,
          `${a.id} and ${b.id} overlap in slot ${a.slot}`,
        );
  assert.equal(spans.find((s) => s.id === 'new2').slot, 1);
  // new2 went past old1, which could not take the held slot 0.
  assert.ok(
    spans.find((s) => s.id === 'new2').start <
      spans.find((s) => s.id === 'old1').start,
  );
});
