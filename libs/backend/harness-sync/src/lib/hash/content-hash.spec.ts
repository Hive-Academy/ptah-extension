/**
 * Content hashing unit tests (required coverage item 18).
 *
 * Source-under-test: `hashDir`, `hashFile`, `isIgnoredEntry`.
 */

/**
 * A counting passthrough for `readFile`, which is how the cancellation test
 * observes that an aborted walk STOPPED rather than merely rejected.
 *
 * `jest.spyOn(require('fs/promises'), 'readFile')` throws `Cannot redefine
 * property` — the `fs/promises` exports are non-configurable — so the module
 * has to be replaced wholesale. Every other export is passed through untouched
 * so the rest of this file exercises the real filesystem.
 */
jest.mock('fs/promises', () => {
  const real: typeof import('fs/promises') = jest.requireActual('fs/promises');
  return {
    ...real,
    readFile: jest.fn((...args: unknown[]) =>
      (real.readFile as unknown as (...a: unknown[]) => Promise<unknown>)(
        ...args,
      ),
    ),
  };
});

import { createHash } from 'crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { readFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { HarnessPassAbortedError } from '../abort/pass-abort';
import {
  HASH_BATCH_SIZE,
  hashDir,
  hashFile,
  isIgnoredEntry,
} from './content-hash';

const readFileMock = readFile as unknown as jest.Mock;
const realReadFile = jest.requireActual<typeof import('fs/promises')>(
  'fs/promises',
).readFile as unknown as (...args: unknown[]) => Promise<unknown>;

function writeTree(root: string, files: Record<string, string>): void {
  for (const [relPath, content] of Object.entries(files)) {
    const absolute = join(root, ...relPath.split('/'));
    mkdirSync(join(absolute, '..'), { recursive: true });
    writeFileSync(absolute, content, 'utf-8');
  }
}

describe('hashDir', () => {
  let parentA: string;
  let parentB: string;

  beforeEach(() => {
    parentA = mkdtempSync(join(tmpdir(), 'harness-sync-hash-a-'));
    parentB = mkdtempSync(join(tmpdir(), 'harness-sync-hash-b-'));
  });

  afterEach(() => {
    rmSync(parentA, { recursive: true, force: true });
    rmSync(parentB, { recursive: true, force: true });
  });

  it('is stable across two identical trees living under different parent directories', async () => {
    const files = {
      'SKILL.md': '---\nname: foo\n---\nbody',
      'nested/notes.md': 'nested content',
    };
    const dirA = join(parentA, 'skill');
    const dirB = join(parentB, 'skill');
    writeTree(dirA, files);
    writeTree(dirB, files);

    // Absolute parent paths differ, but hashDir feeds only the RELATIVE
    // path plus content into the digest — the parent directory must never leak
    // into the hash, or every synced workspace would look perpetually stale.
    expect(await hashDir(dirA)).toBe(await hashDir(dirB));
  });

  it('changes when a single file content changes', async () => {
    const dir = join(parentA, 'skill');
    writeTree(dir, { 'SKILL.md': 'version 1' });
    const before = await hashDir(dir);

    writeFileSync(join(dir, 'SKILL.md'), 'version 2', 'utf-8');
    const after = await hashDir(dir);

    expect(before).not.toBeNull();
    expect(after).not.toBeNull();
    expect(after).not.toBe(before);
  });

  it('ignores .ptah-origin.json, .history and _candidates so bookkeeping churn never registers as drift', async () => {
    const dir = join(parentA, 'skill');
    writeTree(dir, { 'SKILL.md': 'stable content' });
    const baseline = await hashDir(dir);

    writeTree(dir, {
      '.ptah-origin.json': JSON.stringify({ any: 'thing' }),
      '.history/snapshot-1.md': 'old snapshot',
      '_candidates/draft.md': 'staged draft',
    });
    const withIgnoredEntries = await hashDir(dir);

    expect(withIgnoredEntries).toBe(baseline);
  });

  it('folds exactly `relPath NUL sha256(content) NUL` per sorted file, and nothing else', async () => {
    // The fold is a WIRE FORMAT, not an implementation detail: every managed
    // manifest on every user's disk records these digests, so changing the
    // separator, the order, or what goes into each step would make every
    // workspace read as drifted on its next pass. Recomputed here from first
    // principles rather than snapshotted, so the assertion says what the format
    // IS instead of what it happened to be on the day it was recorded.
    const dir = join(parentA, 'skill');
    writeTree(dir, {
      'SKILL.md': 'top level',
      'b/second.md': 'second',
      'a/first.md': 'first',
    });

    const expected = createHash('sha256');
    // POSIX separators, sorted — NOT the OS's `\` and not readdir order.
    for (const [relative, content] of [
      ['SKILL.md', 'top level'],
      ['a/first.md', 'first'],
      ['b/second.md', 'second'],
    ]) {
      expected.update(relative);
      expected.update('\u0000');
      expected.update(createHash('sha256').update(content).digest('hex'));
      expected.update('\u0000');
    }

    expect(await hashDir(dir)).toBe(expected.digest('hex'));
  });

  it('returns null for a directory that does not exist', async () => {
    expect(await hashDir(join(parentA, 'never-created'))).toBeNull();
  });

  it('returns a non-null, real digest for a directory that exists but is empty', async () => {
    const dir = join(parentA, 'empty-skill');
    mkdirSync(dir, { recursive: true });

    // "present but empty" and "absent" must be distinguishable states to the
    // reconciler, so an empty dir gets a real (constant) hash, not null.
    const hash = await hashDir(dir);
    expect(hash).not.toBeNull();
    expect(typeof hash).toBe('string');
  });
});

describe('hashFile', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'harness-sync-hash-file-'));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('returns the same hash for identical content and a different hash for different content', async () => {
    const fileA = join(root, 'a.md');
    const fileB = join(root, 'b.md');
    writeFileSync(fileA, 'same content', 'utf-8');
    writeFileSync(fileB, 'same content', 'utf-8');

    expect(await hashFile(fileA)).toBe(await hashFile(fileB));

    writeFileSync(fileB, 'different content', 'utf-8');
    expect(await hashFile(fileA)).not.toBe(await hashFile(fileB));
  });

  it('returns null for a file that cannot be read', async () => {
    expect(await hashFile(join(root, 'missing.md'))).toBeNull();
  });
});

/**
 * B8 (TASK_2026_323): the losing preflight pass must STOP, not finish in the
 * background.
 *
 * Before this, a walk that lost the 1500 ms race kept `readFileSync`-ing and
 * sha256-ing every file of every skill on the Electron main thread — the same
 * loop every window renders on — for a session that had already given up on it.
 * With three chat tabs and a handful of rival CLI agents each starting their own
 * preflight, that is a standing source of the freeze.
 */
describe('hashDir cancellation', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'harness-sync-hash-abort-'));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  /** A skill directory big enough that the walk cannot finish in one tick. */
  function writeManyFiles(dir: string, count: number): void {
    mkdirSync(dir, { recursive: true });
    for (let index = 0; index < count; index++) {
      writeFileSync(
        join(dir, `file-${String(index).padStart(4, '0')}.md`),
        `content ${index}`,
        'utf-8',
      );
    }
  }

  // Generous, because the fixture itself is 200 real file creations and
  // Windows + a virus scanner make that the slow part, not the walk.
  const FIXTURE_TIMEOUT_MS = 60_000;

  it(
    'stops reading once the signal fires instead of walking the whole tree',
    async () => {
      const dir = join(root, 'big-skill');
      writeManyFiles(dir, 200);

      const controller = new AbortController();
      readFileMock.mockClear();
      // Abort as soon as the walk has actually started reading, so the assertion
      // is about the walk STOPPING rather than about it never beginning.
      readFileMock.mockImplementationOnce((...args: unknown[]) => {
        controller.abort();
        return realReadFile(...args);
      });

      await expect(
        hashDir(dir, { signal: controller.signal }),
      ).rejects.toBeInstanceOf(HarnessPassAbortedError);

      // At most ONE batch. The signal is checked between batches, so the reads
      // already in flight when it fired still finish and nothing after them
      // starts — 16 of 200 rather than 200 of 200, which is the whole point.
      // Before TASK_2026_323 there was no signal to hand it at all and it read
      // every file, synchronously, on the main thread, for a session that had
      // already stopped waiting.
      expect(readFileMock.mock.calls.length).toBeLessThanOrEqual(
        HASH_BATCH_SIZE,
      );
    },
    FIXTURE_TIMEOUT_MS,
  );

  it('completes normally when the signal never fires', async () => {
    const dir = join(root, 'ordinary-skill');
    writeManyFiles(dir, 20);

    const controller = new AbortController();
    await expect(hashDir(dir, { signal: controller.signal })).resolves.toEqual(
      expect.any(String),
    );
  });

  it('rejects immediately when handed an already-aborted signal', async () => {
    const dir = join(root, 'never-walked');
    writeManyFiles(dir, 5);

    await expect(
      hashDir(dir, { signal: AbortSignal.abort() }),
    ).rejects.toBeInstanceOf(HarnessPassAbortedError);
  });
});

describe('isIgnoredEntry', () => {
  it('flags the three bookkeeping names and nothing else', async () => {
    expect(isIgnoredEntry('.ptah-origin.json')).toBe(true);
    expect(isIgnoredEntry('.history')).toBe(true);
    expect(isIgnoredEntry('_candidates')).toBe(true);
    expect(isIgnoredEntry('SKILL.md')).toBe(false);
    expect(isIgnoredEntry('history')).toBe(false);
  });
});
