/**
 * `electron-state-storage.spec.ts` — runs `runStateStorageContract` against
 * `ElectronStateStorage`, plus Electron-specific checks around atomic-rename
 * persistence, the `updateSync` escape hatch, and provider restart recovery.
 */

import 'reflect-metadata';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { runStateStorageContract } from '@ptah-extension/platform-core/testing';
import { ElectronStateStorage } from './electron-state-storage';

const tmpDirs: string[] = [];

async function makeTempDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ptah-electron-state-'));
  tmpDirs.push(dir);
  return dir;
}

afterEach(async () => {
  while (tmpDirs.length > 0) {
    const dir = tmpDirs.pop();
    if (!dir) continue;
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {
      /* swallow */
    });
  }
});

runStateStorageContract('ElectronStateStorage', async () => {
  const storage = await makeTempDir();
  return new ElectronStateStorage(storage, 'state.json');
});

describe('ElectronStateStorage — Electron-specific behaviour', () => {
  let storage: string;
  let provider: ElectronStateStorage;

  beforeEach(async () => {
    storage = await makeTempDir();
    provider = new ElectronStateStorage(storage, 'state.json');
  });

  it('update persists JSON to the configured filename', async () => {
    await provider.update('greeting', 'hello');
    const raw = await fs.readFile(path.join(storage, 'state.json'), 'utf-8');
    expect(JSON.parse(raw)).toEqual({ greeting: 'hello' });
  });

  it('persisted state survives a restart', async () => {
    await provider.update('counter', 5);
    const fresh = new ElectronStateStorage(storage, 'state.json');
    expect(fresh.get<number>('counter')).toBe(5);
  });

  it('updateSync writes synchronously and is visible immediately', () => {
    provider.updateSync('flag', true);
    // Read back through a fresh provider to prove the bytes hit disk before
    // `updateSync` returned.
    const fresh = new ElectronStateStorage(storage, 'state.json');
    expect(fresh.get<boolean>('flag')).toBe(true);
  });

  it('update with undefined deletes the key from disk', async () => {
    await provider.update('temp', 'x');
    await provider.update('temp', undefined);
    const raw = await fs.readFile(path.join(storage, 'state.json'), 'utf-8');
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    expect(parsed).not.toHaveProperty('temp');
  });

  it('concurrent updates serialize without data loss', async () => {
    // Fire twenty updates with the same key in parallel and assert the final
    // value is whichever one was scheduled last — the write chain must not
    // drop any of them or corrupt the JSON.
    const promises: Promise<void>[] = [];
    for (let i = 0; i < 20; i++) {
      promises.push(provider.update('race', i));
    }
    await Promise.all(promises);
    expect(provider.get<number>('race')).toBe(19);

    // File on disk must still be valid JSON.
    const raw = await fs.readFile(path.join(storage, 'state.json'), 'utf-8');
    expect(() => JSON.parse(raw)).not.toThrow();
  });

  it('loadSync recovers from a missing file without throwing', () => {
    // Fresh directory, no state file — constructor should just start empty.
    expect(
      () => new ElectronStateStorage(storage, 'does-not-exist.json'),
    ).not.toThrow();
    const p = new ElectronStateStorage(storage, 'does-not-exist.json');
    expect(p.keys()).toEqual([]);
  });

  it('loadSync recovers from a corrupted file by starting empty', async () => {
    await fs.writeFile(
      path.join(storage, 'corrupt.json'),
      '{ not: valid: json',
      'utf-8',
    );
    const p = new ElectronStateStorage(storage, 'corrupt.json');
    expect(p.keys()).toEqual([]);
  });

  it('updateSync with undefined deletes the key on disk', () => {
    provider.updateSync('flag', true);
    provider.updateSync('flag', undefined);
    const fresh = new ElectronStateStorage(storage, 'state.json');
    expect(fresh.keys()).not.toContain('flag');
  });

  it('update recovers when a previous persist rejected (then-error branch)', async () => {
    // Point a fresh provider at a path whose parent is a regular file —
    // mkdir({ recursive }) then fails with ENOTDIR and the first write
    // rejects. After clearing the blocker, the chain must still drain.
    const blocker = path.join(storage, 'blocker');
    await fs.writeFile(blocker, 'not-a-dir', 'utf-8');
    const sub = path.join(blocker, 'nested');
    const broken = new ElectronStateStorage(sub, 'state.json');
    await expect(broken.update('k1', 1)).rejects.toBeDefined();
    await fs.rm(blocker, { force: true });
    await expect(broken.update('k2', 2)).resolves.toBeUndefined();
  });

  it('uses atomic rename (no leftover .tmp after a successful write)', async () => {
    await provider.update('atomic', true);
    const entries = await fs.readdir(storage);
    expect(entries).toContain('state.json');
    expect(entries.some((e) => e.endsWith('.tmp'))).toBe(false);
  });
});
