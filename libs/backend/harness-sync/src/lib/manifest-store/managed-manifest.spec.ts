/**
 * ManagedManifestStore unit tests (required coverage item 17).
 *
 * Source-under-test: `ManagedManifestStore`.
 */

import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  emptyManifest,
  managedEntry,
  ManagedManifestStore,
  type ManagedEntries,
} from './managed-manifest';

describe('ManagedManifestStore', () => {
  let ws: string;

  beforeEach(() => {
    ws = mkdtempSync(join(tmpdir(), 'harness-sync-manifest-store-'));
  });

  afterEach(() => {
    rmSync(ws, { recursive: true, force: true });
  });

  it('returns an empty manifest without throwing when the file does not exist', () => {
    const store = new ManagedManifestStore();

    const manifest = store.load(ws, 'claude');

    expect(manifest).toEqual(emptyManifest('claude'));
  });

  it('returns an empty manifest and fires the warn callback when the file exists but is not valid JSON', () => {
    const warn = jest.fn();
    const store = new ManagedManifestStore(warn);
    const path = join(ws, '.ptah', 'harness', 'claude.manifest.json');
    mkdirSync(join(ws, '.ptah', 'harness'), { recursive: true });
    writeFileSync(path, '{ not valid json', 'utf-8');

    const manifest = store.load(ws, 'claude');

    // A damaged manifest re-classifies every previously-owned path as foreign
    // rather than risk trusting a torn record — see managed-manifest.ts.
    expect(manifest).toEqual(emptyManifest('claude'));
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('round-trips entries written by save() back out of load()', () => {
    const store = new ManagedManifestStore();
    const entries: ManagedEntries = {
      '.claude/skills/foo': managedEntry('hash-foo', '/src/foo', 'skill'),
      '.claude/commands/bar.md': managedEntry(
        'hash-bar',
        '/src/bar.md',
        'command',
      ),
    };

    store.save(ws, 'claude', entries);
    const loaded = store.load(ws, 'claude');

    expect(loaded.entries).toEqual(entries);
    expect(loaded.version).toBe(1);
    expect(loaded.owner).toBe('ptah');
    expect(loaded.target).toBe('claude');
  });

  it('persists entries with keys sorted alphabetically, so an unchanged reconcile produces a byte-identical file', () => {
    const store = new ManagedManifestStore();
    const entries: ManagedEntries = {
      '.claude/skills/zeta': managedEntry('hash-z', '/src/zeta', 'skill'),
      '.claude/skills/alpha': managedEntry('hash-a', '/src/alpha', 'skill'),
      '.claude/commands/mid.md': managedEntry(
        'hash-m',
        '/src/mid.md',
        'command',
      ),
    };

    store.save(ws, 'claude', entries);

    const raw = readFileSync(
      join(ws, '.ptah', 'harness', 'claude.manifest.json'),
      'utf-8',
    );
    const parsed = JSON.parse(raw) as { entries: ManagedEntries };
    expect(Object.keys(parsed.entries)).toEqual([
      '.claude/commands/mid.md',
      '.claude/skills/alpha',
      '.claude/skills/zeta',
    ]);
  });
});
