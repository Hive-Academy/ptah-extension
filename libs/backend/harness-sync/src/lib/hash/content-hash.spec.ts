/**
 * Content hashing unit tests (required coverage item 18).
 *
 * Source-under-test: `hashDirSync`, `hashFileSync`, `isIgnoredEntry`.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { hashDirSync, hashFileSync, isIgnoredEntry } from './content-hash';

function writeTree(root: string, files: Record<string, string>): void {
  for (const [relPath, content] of Object.entries(files)) {
    const absolute = join(root, ...relPath.split('/'));
    mkdirSync(join(absolute, '..'), { recursive: true });
    writeFileSync(absolute, content, 'utf-8');
  }
}

describe('hashDirSync', () => {
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

  it('is stable across two identical trees living under different parent directories', () => {
    const files = {
      'SKILL.md': '---\nname: foo\n---\nbody',
      'nested/notes.md': 'nested content',
    };
    const dirA = join(parentA, 'skill');
    const dirB = join(parentB, 'skill');
    writeTree(dirA, files);
    writeTree(dirB, files);

    // Absolute parent paths differ, but hashDirSync feeds only the RELATIVE
    // path plus content into the digest — the parent directory must never leak
    // into the hash, or every synced workspace would look perpetually stale.
    expect(hashDirSync(dirA)).toBe(hashDirSync(dirB));
  });

  it('changes when a single file content changes', () => {
    const dir = join(parentA, 'skill');
    writeTree(dir, { 'SKILL.md': 'version 1' });
    const before = hashDirSync(dir);

    writeFileSync(join(dir, 'SKILL.md'), 'version 2', 'utf-8');
    const after = hashDirSync(dir);

    expect(before).not.toBeNull();
    expect(after).not.toBeNull();
    expect(after).not.toBe(before);
  });

  it('ignores .ptah-origin.json, .history and _candidates so bookkeeping churn never registers as drift', () => {
    const dir = join(parentA, 'skill');
    writeTree(dir, { 'SKILL.md': 'stable content' });
    const baseline = hashDirSync(dir);

    writeTree(dir, {
      '.ptah-origin.json': JSON.stringify({ any: 'thing' }),
      '.history/snapshot-1.md': 'old snapshot',
      '_candidates/draft.md': 'staged draft',
    });
    const withIgnoredEntries = hashDirSync(dir);

    expect(withIgnoredEntries).toBe(baseline);
  });

  it('returns null for a directory that does not exist', () => {
    expect(hashDirSync(join(parentA, 'never-created'))).toBeNull();
  });

  it('returns a non-null, real digest for a directory that exists but is empty', () => {
    const dir = join(parentA, 'empty-skill');
    mkdirSync(dir, { recursive: true });

    // "present but empty" and "absent" must be distinguishable states to the
    // reconciler, so an empty dir gets a real (constant) hash, not null.
    const hash = hashDirSync(dir);
    expect(hash).not.toBeNull();
    expect(typeof hash).toBe('string');
  });
});

describe('hashFileSync', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'harness-sync-hash-file-'));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('returns the same hash for identical content and a different hash for different content', () => {
    const fileA = join(root, 'a.md');
    const fileB = join(root, 'b.md');
    writeFileSync(fileA, 'same content', 'utf-8');
    writeFileSync(fileB, 'same content', 'utf-8');

    expect(hashFileSync(fileA)).toBe(hashFileSync(fileB));

    writeFileSync(fileB, 'different content', 'utf-8');
    expect(hashFileSync(fileA)).not.toBe(hashFileSync(fileB));
  });

  it('returns null for a file that cannot be read', () => {
    expect(hashFileSync(join(root, 'missing.md'))).toBeNull();
  });
});

describe('isIgnoredEntry', () => {
  it('flags the three bookkeeping names and nothing else', () => {
    expect(isIgnoredEntry('.ptah-origin.json')).toBe(true);
    expect(isIgnoredEntry('.history')).toBe(true);
    expect(isIgnoredEntry('_candidates')).toBe(true);
    expect(isIgnoredEntry('SKILL.md')).toBe(false);
    expect(isIgnoredEntry('history')).toBe(false);
  });
});
