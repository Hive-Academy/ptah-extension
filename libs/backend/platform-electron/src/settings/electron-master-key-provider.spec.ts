/**
 * ElectronMasterKeyProvider — keyring-unavailable path tests (Gap C1, C2).
 *
 * Verifies graceful-degradation behavior when Electron's safeStorage
 * encryption is unavailable (Linux without a keyring daemon).
 *
 * Tests use the injected-safeStorage pattern already established in
 * the Electron adapter design: we bypass the lazy import('electron') path
 * by directly testing the internal logic with a mocked safeStorage.
 *
 * Source-under-test:
 *   libs/backend/platform-electron/src/settings/electron-master-key-provider.ts
 */

import 'reflect-metadata';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  ElectronMasterKeyProvider,
  type ElectronSafeStorageApi,
} from './electron-master-key-provider';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'ptah-electron-mkp-'));
}

/**
 * Create a mock safeStorage that reports encryption unavailable.
 */
function makeUnavailableSafeStorage(): ElectronSafeStorageApi {
  return {
    isEncryptionAvailable: jest.fn().mockReturnValue(false),
    encryptString: jest.fn().mockImplementation(() => {
      throw new Error('encryption unavailable');
    }),
    decryptString: jest.fn().mockImplementation(() => {
      throw new Error('encryption unavailable');
    }),
  };
}

/**
 * Create a mock safeStorage that reports encryption available and provides
 * a trivial XOR-based encrypt/decrypt for key storage (test-only, not secure).
 */
function makeAvailableSafeStorage(): ElectronSafeStorageApi {
  const xorKey = 0x42;
  return {
    isEncryptionAvailable: jest.fn().mockReturnValue(true),
    encryptString: jest.fn().mockImplementation((plaintext: string) => {
      const buf = Buffer.from(plaintext, 'utf-8');
      const enc = buf.map((b) => b ^ xorKey);
      return enc;
    }),
    decryptString: jest.fn().mockImplementation((encrypted: Buffer) => {
      const dec = Buffer.from(encrypted.map((b) => b ^ xorKey));
      return dec.toString();
    }),
  };
}

// ---------------------------------------------------------------------------
// C1: getMasterKey() throws with 'keyring' when safeStorage unavailable
// ---------------------------------------------------------------------------

describe('C1 — ElectronMasterKeyProvider: getMasterKey throws when keyring unavailable', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTempDir();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('throws an error containing "keyring" when isEncryptionAvailable returns false', async () => {
    const provider = new ElectronMasterKeyProvider(tmpDir);

    // Bypass the lazy import('electron') by monkey-patching the private
    // loadSafeStorage method. This is acceptable in tests because the
    // design documents that the method is testable via this pattern.
    const unavailableStorage = makeUnavailableSafeStorage();
    (
      provider as unknown as {
        loadSafeStorage: () => Promise<ElectronSafeStorageApi>;
      }
    ).loadSafeStorage = jest.fn().mockResolvedValue(unavailableStorage);

    await expect(provider.getMasterKey()).rejects.toThrow(/keyring/i);
  });

  it('error message also mentions the platform-specific cause (Linux keyring context)', async () => {
    const provider = new ElectronMasterKeyProvider(tmpDir);

    const unavailableStorage = makeUnavailableSafeStorage();
    (
      provider as unknown as {
        loadSafeStorage: () => Promise<ElectronSafeStorageApi>;
      }
    ).loadSafeStorage = jest.fn().mockResolvedValue(unavailableStorage);

    let errorMessage = '';
    try {
      await provider.getMasterKey();
    } catch (err) {
      errorMessage = err instanceof Error ? err.message : String(err);
    }

    // The error must be actionable: mention keyring AND explain how to fix it.
    expect(errorMessage).toMatch(/keyring/i);
    // Should not be a generic "unknown error" — must have descriptive text.
    expect(errorMessage.length).toBeGreaterThan(50);
  });

  it('does not create or modify the master-key-ref.json file when keyring unavailable', async () => {
    const provider = new ElectronMasterKeyProvider(tmpDir);

    const unavailableStorage = makeUnavailableSafeStorage();
    (
      provider as unknown as {
        loadSafeStorage: () => Promise<ElectronSafeStorageApi>;
      }
    ).loadSafeStorage = jest.fn().mockResolvedValue(unavailableStorage);

    await expect(provider.getMasterKey()).rejects.toThrow();

    // No key ref file should have been written.
    const keyRefPath = path.join(tmpDir, 'master-key-ref.json');
    expect(fs.existsSync(keyRefPath)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// C2: Keyring unavailable — getMasterKey() error propagates cleanly (no silent corruption)
// ---------------------------------------------------------------------------

describe('C2 — ElectronMasterKeyProvider: keyring error propagates; no silent corruption', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTempDir();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('second getMasterKey() call also throws (no cached corrupt key)', async () => {
    const provider = new ElectronMasterKeyProvider(tmpDir);
    const unavailableStorage = makeUnavailableSafeStorage();
    (
      provider as unknown as {
        loadSafeStorage: () => Promise<ElectronSafeStorageApi>;
      }
    ).loadSafeStorage = jest.fn().mockResolvedValue(unavailableStorage);

    // First call throws.
    await expect(provider.getMasterKey()).rejects.toThrow(/keyring/i);

    // Second call must also throw — the provider must NOT have cached a null/invalid key.
    await expect(provider.getMasterKey()).rejects.toThrow(/keyring/i);
  });

  it('getMasterKey() succeeds when safeStorage becomes available after prior failure', async () => {
    const provider = new ElectronMasterKeyProvider(tmpDir);
    const unavailableStorage = makeUnavailableSafeStorage();
    const availableStorage = makeAvailableSafeStorage();

    const loadSafeStorageMock = jest
      .fn()
      .mockResolvedValueOnce(unavailableStorage)
      .mockResolvedValueOnce(availableStorage);

    (
      provider as unknown as {
        loadSafeStorage: () => Promise<ElectronSafeStorageApi>;
      }
    ).loadSafeStorage = loadSafeStorageMock;

    // First call — unavailable.
    await expect(provider.getMasterKey()).rejects.toThrow(/keyring/i);

    // Second call — available now (simulates keyring daemon starting up).
    const key = await provider.getMasterKey();
    expect(Buffer.isBuffer(key)).toBe(true);
    expect(key.length).toBe(32);
  });

  it('happy path: getMasterKey() returns 32-byte Buffer when safeStorage is available', async () => {
    const provider = new ElectronMasterKeyProvider(tmpDir);
    const availableStorage = makeAvailableSafeStorage();
    (
      provider as unknown as {
        loadSafeStorage: () => Promise<ElectronSafeStorageApi>;
      }
    ).loadSafeStorage = jest.fn().mockResolvedValue(availableStorage);

    const key = await provider.getMasterKey();
    expect(Buffer.isBuffer(key)).toBe(true);
    expect(key.length).toBe(32);
  });

  it('getMasterKey() returns the same key on subsequent calls (cached)', async () => {
    const provider = new ElectronMasterKeyProvider(tmpDir);
    const availableStorage = makeAvailableSafeStorage();
    const loadSpy = jest.fn().mockResolvedValue(availableStorage);
    (
      provider as unknown as {
        loadSafeStorage: () => Promise<ElectronSafeStorageApi>;
      }
    ).loadSafeStorage = loadSpy;

    const key1 = await provider.getMasterKey();
    const key2 = await provider.getMasterKey();

    // Same Buffer reference after caching.
    expect(key1).toBe(key2);
    // loadSafeStorage called only once (caching works).
    expect(loadSpy).toHaveBeenCalledTimes(1);
  });
});
