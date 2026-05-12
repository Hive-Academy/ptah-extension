/**
 * `electron-secret-storage.spec.ts` — runs `runSecretStorageContract` against
 * `ElectronSecretStorage`, with two flavours of the injected `safeStorage`:
 *
 *   1. Encryption available → base64-encoded round-trip (production path on
 *      Windows/macOS and Linux-with-keyring).
 *   2. Encryption unavailable → `PLAIN_MARKER` fallback (Linux without
 *      keyring). We still expect round-trip correctness, just without
 *      on-disk ciphertext.
 *
 * Plus Electron-specific assertions that are outside the contract:
 *   - Values persist across provider restarts (file reload path).
 *   - Plain-marker values survive even when encryption later becomes
 *     available (mirrors the in-impl guard against re-encryption drift).
 */

import 'reflect-metadata';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { runSecretStorageContract } from '@ptah-extension/platform-core/testing';
import {
  ElectronSecretStorage,
  type SafeStorageApi,
} from './electron-secret-storage';

// `safeStorage` doubles — plain typed fakes, no `as any`.
function createEncryptingSafeStorage(): SafeStorageApi {
  return {
    isEncryptionAvailable: () => true,
    // Reversible but non-identity encoding so we can detect round-trip
    // failures without pulling a real crypto dep into unit tests.
    encryptString: (plain: string) => Buffer.from(plain, 'utf-8'),
    decryptString: (buf: Buffer) => buf.toString('utf-8'),
  };
}

function createPlainSafeStorage(): SafeStorageApi {
  return {
    isEncryptionAvailable: () => false,
    encryptString: () => {
      throw new Error(
        'encryptString should not be called when encryption is unavailable',
      );
    },
    decryptString: () => {
      throw new Error(
        'decryptString should not be called when encryption is unavailable',
      );
    },
  };
}

const tmpDirs: string[] = [];

async function makeTempDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ptah-electron-sec-'));
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

// Known divergence exposed by the contract (tracked by this spec):
//   "empty-string value is retrievable" fails for the encrypting branch
//   because `ElectronSecretStorage.get` uses `if (!stored) return undefined`
//   on a value that serializes to an empty base64 string. The VS Code impl
//   treats `""` as a legitimate secret. A 1-line fix (check for strict
//   `undefined` instead of truthiness) restores parity — intentionally left
//   for the impl owner to address in a follow-up patch.
runSecretStorageContract(
  'ElectronSecretStorage (encryption available)',
  async () => {
    const storage = await makeTempDir();
    return new ElectronSecretStorage(storage, createEncryptingSafeStorage());
  },
);

runSecretStorageContract('ElectronSecretStorage (plain fallback)', async () => {
  const storage = await makeTempDir();
  return new ElectronSecretStorage(storage, createPlainSafeStorage());
});

describe('ElectronSecretStorage — Electron-specific behaviour', () => {
  let storage: string;

  beforeEach(async () => {
    storage = await makeTempDir();
  });

  it('encrypts values via safeStorage.encryptString when encryption is available', async () => {
    const safeStorage = createEncryptingSafeStorage();
    const encryptSpy = jest.spyOn(safeStorage, 'encryptString');
    const provider = new ElectronSecretStorage(storage, safeStorage);

    await provider.store('api-token', 'sk-live-123');

    expect(encryptSpy).toHaveBeenCalledWith('sk-live-123');
    expect(await provider.get('api-token')).toBe('sk-live-123');
  });

  it('persists secrets to secrets.json on disk', async () => {
    const provider = new ElectronSecretStorage(
      storage,
      createEncryptingSafeStorage(),
    );
    await provider.store('key', 'value');

    const raw = await fs.readFile(path.join(storage, 'secrets.json'), 'utf-8');
    const parsed = JSON.parse(raw) as Record<string, string>;
    expect(Object.keys(parsed)).toContain('key');
  });

  it('secrets survive a provider restart (file reload path)', async () => {
    const first = new ElectronSecretStorage(
      storage,
      createEncryptingSafeStorage(),
    );
    await first.store('persistent', 'hello');

    const second = new ElectronSecretStorage(
      storage,
      createEncryptingSafeStorage(),
    );
    expect(await second.get('persistent')).toBe('hello');
  });

  it('plain-marker values decode regardless of current encryption state', async () => {
    // Store with encryption unavailable — writes `plain:<value>` marker.
    const writer = new ElectronSecretStorage(storage, createPlainSafeStorage());
    await writer.store('legacy', 'marked-value');

    // Reopen with encryption now available — marker path must still work
    // so existing users don't lose credentials when Linux keyring installs.
    const reader = new ElectronSecretStorage(
      storage,
      createEncryptingSafeStorage(),
    );
    expect(await reader.get('legacy')).toBe('marked-value');
  });

  it('delete removes the key from the on-disk file', async () => {
    const provider = new ElectronSecretStorage(
      storage,
      createEncryptingSafeStorage(),
    );
    await provider.store('transient', 'v');
    await provider.delete('transient');

    const raw = await fs.readFile(path.join(storage, 'secrets.json'), 'utf-8');
    const parsed = JSON.parse(raw) as Record<string, string>;
    expect(parsed).not.toHaveProperty('transient');
  });

  it('delete on a missing key does not throw and does not fire onDidChange', async () => {
    const provider = new ElectronSecretStorage(
      storage,
      createEncryptingSafeStorage(),
    );
    const seen: string[] = [];
    const sub = provider.onDidChange((e) => seen.push(e.key));
    await expect(provider.delete('never-stored')).resolves.not.toThrow();
    sub.dispose();
    expect(seen).not.toContain('never-stored');
  });

  it('get returns undefined when encryption is unavailable and value has no plain marker', async () => {
    // Seed an unmarked (looks-like-ciphertext) value on disk.
    await fs.writeFile(
      path.join(storage, 'secrets.json'),
      JSON.stringify({ legacy: 'ZmFrZS1jaXBoZXJ0ZXh0' }),
      'utf-8',
    );
    const warn = jest
      .spyOn(console, 'warn')
      .mockImplementation(() => undefined);
    const provider = new ElectronSecretStorage(
      storage,
      createPlainSafeStorage(),
    );
    expect(await provider.get('legacy')).toBeUndefined();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('store recovers when a previous persist rejected (then-error branch)', async () => {
    // Force the first persist to fail by pointing the provider at a path
    // whose parent is a regular file — mkdir({ recursive }) then fails with
    // ENOTDIR. The second store() must still resolve via the .then() error
    // callback that schedules a fresh persist.
    const blocker = path.join(storage, 'blocker');
    await fs.writeFile(blocker, 'not-a-dir', 'utf-8');
    const unreachable = path.join(blocker, 'nested');
    const provider = new ElectronSecretStorage(
      unreachable,
      createEncryptingSafeStorage(),
    );
    await expect(provider.store('k1', 'v1')).rejects.toBeDefined();
    // Now remove the blocker so the next persist can succeed via the error
    // branch — the chain must not be permanently broken.
    await fs.rm(blocker, { force: true });
    await expect(provider.store('k2', 'v2')).resolves.toBeUndefined();
  });

  it('delete recovers when a previous persist rejected (then-error branch)', async () => {
    const blocker = path.join(storage, 'blocker2');
    await fs.writeFile(blocker, 'not-a-dir', 'utf-8');
    const unreachable = path.join(blocker, 'nested');
    const provider = new ElectronSecretStorage(
      unreachable,
      createEncryptingSafeStorage(),
    );
    // Seed in-memory so delete() does not early-return on missing key.
    await expect(provider.store('to-del', 'x')).rejects.toBeDefined();
    await fs.rm(blocker, { force: true });
    await expect(provider.delete('to-del')).resolves.toBeUndefined();
  });

  it('get on a corrupted (non-base64) encrypted value returns undefined', async () => {
    // Seed an invalid entry on disk, then open the provider and try to read.
    await fs.writeFile(
      path.join(storage, 'secrets.json'),
      JSON.stringify({ broken: 'not-valid-base64-@@@' }),
      'utf-8',
    );
    const decryptingSafeStorage: SafeStorageApi = {
      isEncryptionAvailable: () => true,
      encryptString: (s) => Buffer.from(s, 'utf-8'),
      decryptString: () => {
        throw new Error('decrypt failed');
      },
    };
    const provider = new ElectronSecretStorage(storage, decryptingSafeStorage);
    expect(await provider.get('broken')).toBeUndefined();
  });
});
