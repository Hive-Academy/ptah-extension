/**
 * `cli-state-storage.spec.ts` — runs `runStateStorageContract` against
 * `CliStateStorage`, plus CLI-specific checks for atomic-rename persistence
 * and restart recovery. Mirrors the Electron state-storage spec since the
 * CLI impl is a direct port of the same logic.
 */

import 'reflect-metadata';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { runStateStorageContract } from '@ptah-extension/platform-core/testing';
import { CliStateStorage } from './cli-state-storage';

const tmpDirs: string[] = [];

async function makeTempDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ptah-cli-state-'));
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

runStateStorageContract('CliStateStorage', async () => {
  const storage = await makeTempDir();
  return new CliStateStorage(storage, 'state.json');
});

describe('CliStateStorage — CLI-specific behaviour', () => {
  let storage: string;
  let provider: CliStateStorage;

  beforeEach(async () => {
    storage = await makeTempDir();
    provider = new CliStateStorage(storage, 'state.json');
  });

  it('update persists JSON to the configured filename', async () => {
    await provider.update('greeting', 'hello');
    const raw = await fs.readFile(path.join(storage, 'state.json'), 'utf-8');
    expect(JSON.parse(raw)).toEqual({ greeting: 'hello' });
  });

  it('persisted state survives a restart', async () => {
    await provider.update('counter', 5);
    const fresh = new CliStateStorage(storage, 'state.json');
    expect(fresh.get<number>('counter')).toBe(5);
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
    // drop any of them or corrupt the JSON on disk.
    const promises: Promise<void>[] = [];
    for (let i = 0; i < 20; i++) {
      promises.push(provider.update('race', i));
    }
    await Promise.all(promises);
    expect(provider.get<number>('race')).toBe(19);

    const raw = await fs.readFile(path.join(storage, 'state.json'), 'utf-8');
    expect(() => JSON.parse(raw)).not.toThrow();
  }, // Explicit timeout, matching the precedent in
  // `platform-core/src/file-settings-manager.cross-process.spec.ts`.
  //
  // `CliStateStorage.update` SERIALIZES through a promise chain, so twenty
  // parallel calls become sixty sequential real-disk syscalls (mkdir +
  // write + atomic rename, twenty times). That is the behaviour under test —
  // it cannot be made faster without testing something else — and its
  // wall-clock cost scales with whatever else is hitting the disk. Under the
  // eleven-project `nx run-many` gate it exceeded Jest's 5s default and
  // failed the whole gate, while passing in isolation; Nx then marked the
  // task flaky.
  //
  // This is a load-sensitive DURATION, not a leaked handle: nothing here is
  // left open, and a genuine serialization break still fails fast (wrong
  // final value, or unparseable JSON) rather than waiting this out.
  30_000);

  it('loadSync recovers from a missing file without throwing', () => {
    expect(
      () => new CliStateStorage(storage, 'does-not-exist.json'),
    ).not.toThrow();
    const p = new CliStateStorage(storage, 'does-not-exist.json');
    expect(p.keys()).toEqual([]);
  });

  it('loadSync recovers from a corrupted file by starting empty', async () => {
    await fs.writeFile(
      path.join(storage, 'corrupt.json'),
      '{ not: valid: json',
      'utf-8',
    );
    const p = new CliStateStorage(storage, 'corrupt.json');
    expect(p.keys()).toEqual([]);
  });

  it('uses atomic rename (no leftover .tmp after a successful write)', async () => {
    await provider.update('atomic', true);
    const entries = await fs.readdir(storage);
    expect(entries).toContain('state.json');
    expect(entries.some((e) => e.endsWith('.tmp'))).toBe(false);
  });
});
