/**
 * `go-vet-consent-store.spec.ts` — TASK_2026_559 Batch 37a, O2 §1.2 and §7.1
 * cases 1-9 (User Decision 25: consent ends when the root moves, is replaced
 * or the resolved Go binary changes).
 *
 * Storages are in-memory doubles of the host contract
 * (`IWorkspaceScopedStateStorage`); roots are `mkdtemp` directories removed
 * after each case. Root identity is injected where a case needs to move or
 * replace a root without depending on the host file system.
 */

import { createHash } from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { StateStorageNotReadyError } from '@ptah-extension/platform-core';
import type {
  IStateStorage,
  IWorkspaceScopedStateStorage,
} from '@ptah-extension/platform-core';
import {
  GO_VET_CONSENT_DIR,
  GoVetConsentStore,
  parseGoVetConsentRecord,
  type ConsentRootFileSystem,
  type GoVetConsentRecord,
} from './go-vet-consent-store';
import type { GoBinaryIdentity } from './go-binary-resolver';

class MemoryStorage implements IStateStorage {
  readonly values = new Map<string, unknown>();

  get<T>(key: string, defaultValue?: T): T | undefined {
    return this.values.has(key) ? (this.values.get(key) as T) : defaultValue;
  }

  async update(key: string, value: unknown): Promise<void> {
    if (value === undefined) this.values.delete(key);
    else this.values.set(key, value);
  }

  keys(): readonly string[] {
    return [...this.values.keys()];
  }
}

/** Per-root storages; the plain `IStateStorage` face is the ACTIVE root's. */
class ScopedStorage implements IWorkspaceScopedStateStorage {
  readonly byRoot = new Map<string, MemoryStorage>();
  active: MemoryStorage = new MemoryStorage();

  register(root: string): MemoryStorage {
    const storage = new MemoryStorage();
    this.byRoot.set(path.resolve(root), storage);
    return storage;
  }

  get<T>(key: string, defaultValue?: T): T | undefined {
    return this.active.get(key, defaultValue);
  }

  update(key: string, value: unknown): Promise<void> {
    return this.active.update(key, value);
  }

  keys(): readonly string[] {
    return this.active.keys();
  }

  getStorageForWorkspace(workspacePath: string): IStateStorage | undefined {
    return this.byRoot.get(workspacePath);
  }

  getAllWorkspacePaths(): string[] {
    return [...this.byRoot.keys()];
  }
}

const GO: GoBinaryIdentity = {
  path: '/usr/local/go/bin/go',
  size: 1000,
  mtimeMs: 1700000000000.5,
};

const tempRoots: string[] = [];

function tempDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempRoots.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempRoots.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

/** The record file of `root` under `userData` (the store's naming, pinned). */
function recordPath(
  userData: string,
  root: string,
  platform: NodeJS.Platform = process.platform,
): string {
  const resolved = path.resolve(root);
  const key = platform === 'win32' ? resolved.toLowerCase() : resolved;
  return path.join(
    userData,
    GO_VET_CONSENT_DIR,
    `${createHash('sha256').update(key).digest('hex').slice(0, 32)}.json`,
  );
}

function readRecord(userData: string, root: string): unknown {
  return JSON.parse(fs.readFileSync(recordPath(userData, root), 'utf8'));
}

function writeRecord(userData: string, root: string, value: unknown): void {
  const file = recordPath(userData, root);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value));
}

/** A root file system whose realpath and identity the case controls. */
function fakeRootFs(
  realpath: (target: string) => string = (target) => path.resolve(target),
  rootId: () => string | null = () => '7:42',
): ConsentRootFileSystem {
  return { realpath, rootId: () => rootId() };
}

function setup(options: { fileSystem?: ConsentRootFileSystem } = {}): {
  root: string;
  userData: string;
  scoped: ScopedStorage;
  own: MemoryStorage;
  store: GoVetConsentStore;
} {
  const root = tempDir('ptah-consent-root-');
  const userData = tempDir('ptah-consent-userdata-');
  const scoped = new ScopedStorage();
  const own = scoped.register(root);
  const store = new GoVetConsentStore(scoped, {
    userDataPath: userData,
    fileSystem: options.fileSystem,
  });
  return { root, userData, scoped, own, store };
}

describe('GoVetConsentStore', () => {
  it('grants and reads back `on` from the root’s own record file under the user-data dir; no host-state key is written', async () => {
    const { root, userData, own, scoped, store } = setup();

    await store.grant(root, GO, new Date('2026-09-27T00:00:00Z'));

    const state = store.read(root, GO);
    expect(state.state).toBe('on');
    expect(own.keys()).toEqual([]);
    expect(scoped.active.keys()).toEqual([]);
    expect(fs.readdirSync(path.join(userData, GO_VET_CONSENT_DIR))).toEqual([
      path.basename(recordPath(userData, root)),
    ]);
    const record = readRecord(userData, root) as GoVetConsentRecord;
    expect(record).toEqual({
      v: 1,
      rootRealpath: fs.realpathSync.native(root),
      rootId: expect.any(String),
      goBinary: GO,
      grantedAt: '2026-09-27T00:00:00.000Z',
    });
  });

  it('case 1: a storage that is not workspace-scoped is `off`, even with a record file', () => {
    const root = tempDir('ptah-consent-root-');
    const userData = tempDir('ptah-consent-userdata-');
    writeRecord(userData, root, {
      v: 1,
      rootRealpath: fs.realpathSync.native(root),
      rootId: null,
      goBinary: GO,
      grantedAt: 'x',
    });
    const store = new GoVetConsentStore(new MemoryStorage(), {
      userDataPath: userData,
    });

    expect(store.read(root, GO)).toEqual({ state: 'off' });
  });

  it('case 2: an unregistered root is `off`; a registered sibling with consent and the active storage do not leak', async () => {
    const { root: sibling, scoped, store } = setup();
    await store.grant(sibling, GO);
    scoped.active = scoped.byRoot.get(path.resolve(sibling)) ?? scoped.active;
    const unregistered = tempDir('ptah-consent-other-');

    expect(store.read(unregistered, GO)).toEqual({ state: 'off' });
    await expect(store.grant(unregistered, GO)).rejects.toThrow(
      'go vet consent: no host storage for this workspace',
    );
  });

  it('case 3: a win32 drive-letter case variant of a registered root is found', async () => {
    const scoped = new ScopedStorage();
    const registered = path.resolve('/Workspace/Project');
    scoped.register(registered);
    const store = new GoVetConsentStore(scoped, {
      userDataPath: tempDir('ptah-consent-userdata-'),
      platform: 'win32',
      fileSystem: fakeRootFs((target) => path.resolve(target).toLowerCase()),
    });
    await store.grant(registered, GO);

    expect(store.read(registered.toLowerCase(), GO).state).toBe('on');
    expect(store.read(registered.toUpperCase(), GO).state).toBe('on');
  });

  it('case 3 (POSIX): case variants are different roots', async () => {
    const scoped = new ScopedStorage();
    const registered = path.resolve('/Workspace/Project');
    scoped.register(registered);
    const store = new GoVetConsentStore(scoped, {
      userDataPath: tempDir('ptah-consent-userdata-'),
      platform: 'linux',
      fileSystem: fakeRootFs(),
    });
    await store.grant(registered, GO);

    expect(store.read(registered.toLowerCase(), GO)).toEqual({
      state: 'off',
    });
  });

  it.each<[string, unknown]>([
    ['wrong v', { v: 2 }],
    ['an extra key', { extra: true }],
    ['a numeric rootRealpath', { rootRealpath: 7 }],
    ['an empty rootId', { rootId: '' }],
    ['a goBinary with an extra key', { goBinary: { ...GO, sha: 'x' } }],
    ['a negative size', { goBinary: { ...GO, size: -1 } }],
    ['a string mtime', { goBinary: { ...GO, mtimeMs: '1' } }],
  ])('case 4: a record with %s is `off`', async (_label, patch) => {
    const { root, userData, store } = setup();
    await store.grant(root, GO);
    const record = readRecord(userData, root) as Record<string, unknown>;
    writeRecord(userData, root, { ...record, ...(patch as object) });

    expect(store.read(root, GO)).toEqual({ state: 'off' });
  });

  it.each<unknown>([null, 'on', true, [], 1])(
    'case 4: a non-record value %p is `off`',
    (value) => {
      const { root, userData, store } = setup();
      writeRecord(userData, root, value);
      expect(store.read(root, GO)).toEqual({ state: 'off' });
    },
  );

  it('case 5: StateStorageNotReadyError, an unreadable record, or any throw, is `off`', async () => {
    const { root, userData, scoped, store } = setup();
    await store.grant(root, GO);
    const spy = jest
      .spyOn(scoped, 'getStorageForWorkspace')
      .mockImplementation(() => {
        throw new StateStorageNotReadyError();
      });
    expect(store.read(root, GO)).toEqual({ state: 'off' });
    spy.mockRestore();

    const file = recordPath(userData, root);
    fs.rmSync(file);
    fs.mkdirSync(file);
    expect(store.read(root, GO)).toEqual({ state: 'off' });
  });

  describe('case 6: staleness', () => {
    it('realpath differs → stale/root-moved', async () => {
      let target = path.resolve('/real/a');
      let rootPath = '';
      const { root, store } = setup({
        // Only the root is re-pointed; the user-data directory stays put.
        fileSystem: fakeRootFs((candidate) =>
          path.resolve(candidate) === rootPath
            ? target
            : path.resolve(candidate),
        ),
      });
      rootPath = path.resolve(root);
      await store.grant(root, GO);
      target = path.resolve('/real/b');

      expect(store.read(root, GO)).toEqual({
        state: 'stale',
        reason: 'root-moved',
      });
    });

    it('dev:ino differs → stale/root-replaced', async () => {
      let id: string | null = '7:42';
      const { root, store } = setup({
        fileSystem: fakeRootFs(undefined, () => id),
      });
      await store.grant(root, GO);
      id = '7:43';

      expect(store.read(root, GO)).toEqual({
        state: 'stale',
        reason: 'root-replaced',
      });
    });

    it('a null rootId (ino 0) at grant or now skips the identity check', async () => {
      let id: string | null = null;
      const { root, store } = setup({
        fileSystem: fakeRootFs(undefined, () => id),
      });
      await store.grant(root, GO);
      id = '7:43';
      expect(store.read(root, GO).state).toBe('on');
    });

    it.each<[string, GoBinaryIdentity | null]>([
      ['path', { ...GO, path: '/opt/go/bin/go' }],
      ['size', { ...GO, size: GO.size + 1 }],
      ['mtime', { ...GO, mtimeMs: GO.mtimeMs + 1 }],
      ['absence', null],
    ])('a binary differing in %s → stale/go-changed', async (_label, now) => {
      const { root, store } = setup();
      await store.grant(root, GO);

      expect(store.read(root, now)).toEqual({
        state: 'stale',
        reason: 'go-changed',
      });
    });

    it('a real folder replaced at the same path → stale/root-replaced', async () => {
      const { root, store } = setup();
      await store.grant(root, GO);
      const before = fs.statSync(root, { bigint: true }).ino;
      fs.rmSync(root, { recursive: true, force: true });
      fs.mkdirSync(root);
      const after = fs.statSync(root, { bigint: true }).ino;

      if (before === after || after === BigInt(0)) {
        // The volume reused the id or reports none: only the path checks
        // apply there (O2 §1.2 limitation), so the record stays valid.
        expect(store.read(root, GO).state).toBe('on');
      } else {
        expect(store.read(root, GO)).toEqual({
          state: 'stale',
          reason: 'root-replaced',
        });
      }
    });

    it('a real junction/symlink root retargeted → stale/root-moved', async () => {
      const holder = tempDir('ptah-consent-link-');
      const targetA = tempDir('ptah-consent-a-');
      const targetB = tempDir('ptah-consent-b-');
      const root = path.join(holder, 'ws');
      fs.symlinkSync(targetA, root, 'junction');
      const scoped = new ScopedStorage();
      scoped.register(root);
      const store = new GoVetConsentStore(scoped, {
        userDataPath: tempDir('ptah-consent-userdata-'),
      });
      await store.grant(root, GO);
      expect(store.read(root, GO).state).toBe('on');

      fs.rmSync(root, { recursive: true, force: true });
      fs.symlinkSync(targetB, root, 'junction');

      expect(store.read(root, GO)).toEqual({
        state: 'stale',
        reason: 'root-moved',
      });
    });
  });

  it('case 7: revoke deletes the record file and reads back `off`', async () => {
    const { root, userData, store } = setup();
    await store.grant(root, GO);
    expect(store.hasRecord(root)).toBe(true);

    await store.revoke(root);

    expect(fs.existsSync(recordPath(userData, root))).toBe(false);
    expect(store.hasRecord(root)).toBe(false);
    expect(store.read(root, GO)).toEqual({ state: 'off' });
  });

  it('closing review 1: a revoke by another process (a second store over the same user-data dir) is seen at the next read; a later write of other host state never restores it', async () => {
    const { root, userData, own, store: running } = setup();
    await running.grant(root, GO);
    expect(running.read(root, GO).state).toBe('on');

    const otherHost = new ScopedStorage();
    otherHost.register(root);
    const otherProcess = new GoVetConsentStore(otherHost, {
      userDataPath: userData,
    });
    await otherProcess.revoke(root);

    expect(running.read(root, GO)).toEqual({ state: 'off' });
    await own.update('some.other.key', 1);
    expect(running.read(root, GO)).toEqual({ state: 'off' });
    expect(fs.existsSync(recordPath(userData, root))).toBe(false);
  });

  it('closing review 2: a grant whose durable write fails is not effective — nothing is published', async () => {
    const { root, userData, store } = setup();
    // A file where the record directory must go.
    fs.writeFileSync(path.join(userData, GO_VET_CONSENT_DIR), 'blocker');

    await expect(store.grant(root, GO)).rejects.toThrow();

    expect(store.read(root, GO)).toEqual({ state: 'off' });
  });

  it('closing review 2: a failed re-grant leaves the committed record, never a half-written one', async () => {
    const { root, userData, store } = setup();
    await store.grant(root, GO);
    const committed = readRecord(userData, root);
    const newer = { ...GO, size: GO.size + 5 };
    jest
      .spyOn(fs.promises, 'rename')
      .mockRejectedValueOnce(new Error('rename failed'));

    await expect(store.grant(root, newer)).rejects.toThrow('rename failed');

    expect(readRecord(userData, root)).toEqual(committed);
    expect(store.read(root, newer)).toEqual({
      state: 'stale',
      reason: 'go-changed',
    });
    expect(
      fs
        .readdirSync(path.join(userData, GO_VET_CONSENT_DIR))
        .filter((name) => name.endsWith('.tmp')),
    ).toEqual([]);
  });

  it('closing review 4: confirmToken binds the root identity and the binary', async () => {
    let id: string | null = '7:42';
    const { root, store } = setup({
      fileSystem: fakeRootFs(undefined, () => id),
    });
    const shown = store.confirmToken(root, GO);
    expect(shown).toMatch(/^[0-9a-f]{24}\.[0-9a-f]{24}$/);
    expect(store.confirmToken(root, GO)).toBe(shown);

    const otherBinary = store.confirmToken(root, { ...GO, mtimeMs: 1 });
    expect(otherBinary?.split('.')[0]).toBe(shown?.split('.')[0]);
    expect(otherBinary).not.toBe(shown);

    id = '7:43';
    expect(store.confirmToken(root, GO)?.split('.')[0]).not.toBe(
      shown?.split('.')[0],
    );
  });

  it('case 8: repository files claiming consent are never read — `off`', () => {
    const { root, store } = setup();
    const claim = JSON.stringify({
      'ptah.diagnostics.goVet.consent': {
        v: 1,
        rootRealpath: fs.realpathSync.native(root),
        rootId: null,
        goBinary: GO,
        grantedAt: 'x',
      },
      'diagnostics.goVet.enabled': true,
    });
    for (const file of [
      '.ptah/workspace-state.json',
      '.ptah/settings.json',
      '.vscode/settings.json',
    ]) {
      const target = path.join(root, file);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, claim);
    }

    expect(store.read(root, GO)).toEqual({ state: 'off' });
  });

  it('case 9: a user-data directory inside the root is `off`, and grant refuses', async () => {
    const root = tempDir('ptah-consent-root-');
    const scoped = new ScopedStorage();
    scoped.register(root);
    const userData = path.join(root, '.ptah-user-data');
    writeRecord(userData, root, {
      v: 1,
      rootRealpath: fs.realpathSync.native(root),
      rootId: null,
      goBinary: GO,
      grantedAt: 'x',
    });
    const store = new GoVetConsentStore(scoped, { userDataPath: userData });

    expect(store.read(root, GO)).toEqual({ state: 'off' });
    await expect(store.grant(root, GO)).rejects.toThrow(
      'go vet consent: no host storage for this workspace',
    );
  });

  it('parseGoVetConsentRecord accepts exactly the record shape', () => {
    expect(
      parseGoVetConsentRecord({
        v: 1,
        rootRealpath: '/r',
        rootId: null,
        goBinary: GO,
        grantedAt: 't',
      }),
    ).not.toBeNull();
  });
});
