/**
 * FileSettingsStore — unit tests for the Electron settings adapter.
 *
 * Covers:
 *   - Global read/write delegation to PtahFileSettingsManager.
 *   - flushSync delegation.
 *   - watchGlobal delegation.
 *   - Secret round-trip: writeSecret → readSecret returns plaintext.
 *   - Secret deletion: deleteSecret removes the value.
 *   - writeSecret encrypts via SecretsFileStore (mock.write is called with the master key).
 */

import 'reflect-metadata';
import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';
import { FileSettingsStore } from './file-settings-store';
import type { PtahFileSettingsManager } from '@ptah-extension/platform-core';
import type { IMasterKeyProvider } from '@ptah-extension/platform-core';
import { SecretsFileStore } from '@ptah-extension/settings-core';

// ---------------------------------------------------------------------------
// Shared mock factories
// ---------------------------------------------------------------------------

function makeMockFileSettingsManager(): jest.Mocked<PtahFileSettingsManager> {
  return {
    get: jest.fn(),
    set: jest.fn().mockResolvedValue(undefined),
    watch: jest.fn().mockReturnValue({ dispose: jest.fn() }),
    flushSync: jest.fn(),
    getFilePath: jest.fn().mockReturnValue('/mock/.ptah/settings.json'),
  } as unknown as jest.Mocked<PtahFileSettingsManager>;
}

const FIXED_MASTER_KEY = Buffer.alloc(32, 1);

const mockMasterKeyProvider: IMasterKeyProvider = {
  getMasterKey: jest.fn().mockResolvedValue(FIXED_MASTER_KEY),
};

/** Stub SecretsFileStore — all methods are no-ops; useful for non-secret tests. */
function makeStubSecretsStore(): jest.Mocked<SecretsFileStore> {
  return {
    read: jest.fn().mockResolvedValue(undefined),
    write: jest.fn().mockResolvedValue(undefined),
    delete: jest.fn().mockResolvedValue(undefined),
    flushSync: jest.fn(),
  } as unknown as jest.Mocked<SecretsFileStore>;
}

/** Create a temporary directory for real SecretsFileStore round-trip tests. */
function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'ptah-fss-test-'));
}

// ---------------------------------------------------------------------------
// Global settings delegation
// ---------------------------------------------------------------------------

describe('FileSettingsStore — global settings', () => {
  it('readGlobal delegates to fileSettings.get', () => {
    const mgr = makeMockFileSettingsManager();
    mgr.get.mockReturnValue('stored-value' as unknown as undefined);
    const store = new FileSettingsStore(
      mgr,
      mockMasterKeyProvider,
      makeStubSecretsStore(),
    );
    const result = store.readGlobal<string>('some.key');
    expect(mgr.get).toHaveBeenCalledWith('some.key');
    expect(result).toBe('stored-value');
  });

  it('writeGlobal delegates to fileSettings.set', async () => {
    const mgr = makeMockFileSettingsManager();
    const store = new FileSettingsStore(
      mgr,
      mockMasterKeyProvider,
      makeStubSecretsStore(),
    );
    await store.writeGlobal('some.key', 'new-value');
    expect(mgr.set).toHaveBeenCalledWith('some.key', 'new-value');
  });

  it('flushSync delegates to fileSettings.flushSync', () => {
    const mgr = makeMockFileSettingsManager();
    const store = new FileSettingsStore(
      mgr,
      mockMasterKeyProvider,
      makeStubSecretsStore(),
    );
    store.flushSync();
    expect(mgr.flushSync).toHaveBeenCalled();
  });

  it('watchGlobal delegates to fileSettings.watch and returns a disposable', () => {
    const mgr = makeMockFileSettingsManager();
    const cb = jest.fn();
    const store = new FileSettingsStore(
      mgr,
      mockMasterKeyProvider,
      makeStubSecretsStore(),
    );
    const handle = store.watchGlobal('some.key', cb);
    expect(mgr.watch).toHaveBeenCalledWith('some.key', cb);
    expect(typeof handle.dispose).toBe('function');
  });
});

// ---------------------------------------------------------------------------
// Secret round-trip tests — use a real SecretsFileStore with a temp dir so
// AES-256-GCM encryption actually executes.
// ---------------------------------------------------------------------------

describe('FileSettingsStore — secret round-trip (real SecretsFileStore)', () => {
  let tmpDir: string;
  let store: FileSettingsStore;

  beforeEach(() => {
    tmpDir = makeTempDir();
    const secretsStore = new SecretsFileStore(tmpDir);
    store = new FileSettingsStore(
      makeMockFileSettingsManager(),
      mockMasterKeyProvider,
      secretsStore,
    );
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('readSecret returns the plaintext written by writeSecret', async () => {
    await store.writeSecret('foo', 'plaintext-value');
    const result = await store.readSecret('foo');
    expect(result).toBe('plaintext-value');
  });

  it('deleteSecret removes the value (subsequent readSecret returns undefined)', async () => {
    await store.writeSecret('foo', 'to-be-deleted');
    await store.deleteSecret('foo');
    const result = await store.readSecret('foo');
    expect(result).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// writeSecret encrypts via SecretsFileStore — verify write is called with key
// ---------------------------------------------------------------------------

describe('FileSettingsStore — writeSecret calls SecretsFileStore.write with master key', () => {
  it('passes the master key to SecretsFileStore.write', async () => {
    const stubSecrets = makeStubSecretsStore();
    const store = new FileSettingsStore(
      makeMockFileSettingsManager(),
      mockMasterKeyProvider,
      stubSecrets,
    );

    await store.writeSecret('bar', 'some-value');

    expect(stubSecrets.write).toHaveBeenCalledWith(
      'bar',
      'some-value',
      FIXED_MASTER_KEY,
    );
  });
});

// ---------------------------------------------------------------------------
// flushSync — both global and secrets flush path
// ---------------------------------------------------------------------------

describe('FileSettingsStore — flushSync', () => {
  it('flushes secrets store with cached master key after a secret has been accessed', async () => {
    const mgr = makeMockFileSettingsManager();
    const stubSecrets = makeStubSecretsStore();
    const store = new FileSettingsStore(
      mgr,
      mockMasterKeyProvider,
      stubSecrets,
    );

    // Access a secret so the master key gets cached.
    await store.readSecret('my-key');

    store.flushSync();

    expect(mgr.flushSync).toHaveBeenCalled();
    expect(stubSecrets.flushSync).toHaveBeenCalledWith(FIXED_MASTER_KEY);
  });

  it('watchSecret returns a disposable with a no-op dispose', () => {
    const mgr = makeMockFileSettingsManager();
    const store = new FileSettingsStore(
      mgr,
      mockMasterKeyProvider,
      makeStubSecretsStore(),
    );
    const handle = store.watchSecret('irrelevant-key', jest.fn());
    expect(typeof handle.dispose).toBe('function');
    // Should not throw.
    expect(() => handle.dispose()).not.toThrow();
  });
});
