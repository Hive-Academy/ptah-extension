/**
 * VscodeMasterKeyProvider — IMasterKeyProvider contract suite.
 *
 * VscodeMasterKeyProvider delegates all storage to the injected
 * `VscodeSecretStorageSlice`. For tests we use `InMemorySecretStorage` from
 * the VS Code test-double to observe real round-trip behaviour without touching
 * the OS keychain.
 *
 * No `makeStateRoot` is passed to the contract runner because the VS Code
 * adapter has no file-backed state directory — persistence across "restarts"
 * is managed by the injected SecretStorage. The cross-restart test in the
 * contract suite is skipped for this adapter via the early-return guard.
 *
 * Source-under-test:
 *   libs/backend/platform-vscode/src/settings/vscode-master-key-provider.ts
 */

import 'reflect-metadata';
import { runMasterKeyProviderContract } from '@ptah-extension/platform-core/testing';
import { VscodeMasterKeyProvider } from './vscode-master-key-provider';
import { InMemorySecretStorage } from '../../__mocks__/vscode';

// ---------------------------------------------------------------------------
// IMasterKeyProvider contract
// ---------------------------------------------------------------------------

runMasterKeyProviderContract(
  'VscodeMasterKeyProvider',
  () =>
    new VscodeMasterKeyProvider(
      new InMemorySecretStorage() as unknown as import('vscode').SecretStorage,
    ),
  // No makeStateRoot — VS Code adapter persists through injected SecretStorage,
  // not a temporary directory. Cross-restart test is skipped.
);

// ---------------------------------------------------------------------------
// VS Code-specific extras
// ---------------------------------------------------------------------------

describe('VscodeMasterKeyProvider — VS Code-specific behaviour', () => {
  it('generates a new key when stored value has wrong byte length', async () => {
    const backing = new InMemorySecretStorage();
    // Pre-seed with a 16-byte (too-short) key.
    await backing.store(
      'ptah.masterKey',
      Buffer.alloc(16, 0xab).toString('base64'),
    );

    const provider = new VscodeMasterKeyProvider(
      backing as unknown as import('vscode').SecretStorage,
    );
    const key = await provider.getMasterKey();

    // Provider should regenerate — 32 bytes, not the pre-seeded 16.
    expect(Buffer.isBuffer(key)).toBe(true);
    expect(key.length).toBe(32);
    expect(key.equals(Buffer.alloc(16, 0xab))).toBe(false);
  });

  it('uses a shared backing store — second provider instance reads the same key', async () => {
    const backing = new InMemorySecretStorage();

    const provider1 = new VscodeMasterKeyProvider(
      backing as unknown as import('vscode').SecretStorage,
    );
    const k1 = await provider1.getMasterKey();

    const provider2 = new VscodeMasterKeyProvider(
      backing as unknown as import('vscode').SecretStorage,
    );
    const k2 = await provider2.getMasterKey();

    expect(k1.toString('hex')).toBe(k2.toString('hex'));
  });
});

// ---------------------------------------------------------------------------
// Deliverable D: IUserInteraction wiring
//
// Verifies that when IUserInteraction is provided and the master key is
// corrupt, showErrorMessage is called exactly once with the corruption message.
// ---------------------------------------------------------------------------

describe('VscodeMasterKeyProvider — IUserInteraction wiring (Deliverable D)', () => {
  it('calls showErrorMessage when IUserInteraction is provided and key is corrupt', async () => {
    const backing = new InMemorySecretStorage();
    // Pre-seed with a wrong-length key (8 bytes) to trigger notifyCorruption.
    await backing.store(
      'ptah.masterKey',
      Buffer.alloc(8, 0xcc).toString('base64'),
    );

    const showErrorMessage = jest.fn().mockResolvedValue(undefined);
    const provider = new VscodeMasterKeyProvider(
      backing as unknown as import('vscode').SecretStorage,
      {
        showErrorMessage,
      } as unknown as import('@ptah-extension/platform-core').IUserInteraction,
    );

    const key = await provider.getMasterKey();

    // Key was regenerated (new 32-byte key, not the 8-byte seed).
    expect(key.length).toBe(32);

    // showErrorMessage must have been called exactly once with the corruption message.
    expect(showErrorMessage).toHaveBeenCalledTimes(1);
    const [msg] = showErrorMessage.mock.calls[0] as [string];
    expect(msg).toMatch(/corrupted or unreadable/i);
  });

  it('falls back to console.error (no throw) when IUserInteraction is absent', async () => {
    const backing = new InMemorySecretStorage();
    await backing.store(
      'ptah.masterKey',
      Buffer.alloc(4, 0xdd).toString('base64'),
    );

    const consoleSpy = jest
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);

    // No IUserInteraction passed.
    const provider = new VscodeMasterKeyProvider(
      backing as unknown as import('vscode').SecretStorage,
    );

    const key = await provider.getMasterKey();

    expect(key.length).toBe(32);
    // console.error must have been called (fallback path).
    expect(consoleSpy).toHaveBeenCalled();

    consoleSpy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// MKP-DL data-loss audit tests — VscodeMasterKeyProvider
//
// The VS Code adapter stores the master key in SecretStorage (OS keychain).
// "Corruption" is simulated by pre-seeding SecretStorage with an invalid value.
//
// MKP-DL-4: covered by the IMasterKeyProvider contract suite's test
// "two concurrent getMasterKey() calls on a fresh instance return identical bytes".
// ---------------------------------------------------------------------------

describe('MKP-DL — VscodeMasterKeyProvider: data-loss audit', () => {
  // MKP-DL-1: corrupt the persisted key (wrong length) — reinitialize provider
  // should regenerate a valid 32-byte key.
  it('MKP-DL-1: wrong-length key in SecretStorage causes regeneration; new key is 32 bytes', async () => {
    const backing = new InMemorySecretStorage();
    // Pre-seed with a corrupt (wrong length) key.
    await backing.store(
      'ptah.masterKey',
      Buffer.alloc(8, 0xff).toString('base64'),
    );

    const provider = new VscodeMasterKeyProvider(
      backing as unknown as import('vscode').SecretStorage,
    );
    const key = await provider.getMasterKey();

    expect(Buffer.isBuffer(key)).toBe(true);
    expect(key.length).toBe(32);
    // The corrupt entry must have been replaced.
    const stored = await backing.get('ptah.masterKey');
    expect(stored).toBeDefined();
    expect(Buffer.from(stored as string, 'base64').length).toBe(32);
  });

  // MKP-DL-2: simulate SecretStorage becoming unavailable (get returns undefined).
  // All reads must fail deterministically — no partial success.
  it('MKP-DL-2: SecretStorage.get throwing causes getMasterKey to reject consistently', async () => {
    const backing = new InMemorySecretStorage();
    // Pre-store a valid key then make the store throw on get.
    const storedKey = Buffer.alloc(32, 0x42);
    await backing.store('ptah.masterKey', storedKey.toString('base64'));

    // Simulate keyring unavailable by making get throw.
    jest
      .spyOn(backing, 'get')
      .mockRejectedValue(new Error('keyring unavailable'));

    const provider = new VscodeMasterKeyProvider(
      backing as unknown as import('vscode').SecretStorage,
    );

    const [r1, r2] = await Promise.allSettled([
      provider.getMasterKey(),
      provider.getMasterKey(),
    ]);

    // Both must fail — never partial success.
    expect(r1.status).toBe('rejected');
    expect(r2.status).toBe('rejected');
  });

  // MKP-DL-3: after key regeneration, the value written to SecretStorage is
  // a valid base64-encoded 32-byte key.
  it('MKP-DL-3: key regeneration writes a valid 32-byte base64 key to SecretStorage', async () => {
    const backing = new InMemorySecretStorage();
    // Force regeneration by seeding with a corrupt value.
    await backing.store('ptah.masterKey', 'not-valid-base64-!@#');

    const provider = new VscodeMasterKeyProvider(
      backing as unknown as import('vscode').SecretStorage,
    );
    const key = await provider.getMasterKey();

    // Key returned must be 32 bytes.
    expect(key.length).toBe(32);

    // Persisted value must be valid base64 encoding of a 32-byte key.
    const stored = await backing.get('ptah.masterKey');
    expect(stored).toBeDefined();
    const decoded = Buffer.from(stored as string, 'base64');
    expect(decoded.length).toBe(32);
    // Must match the returned key.
    expect(decoded.equals(key)).toBe(true);
  });

  // MKP-DL-4: covered by IMasterKeyProvider contract — two concurrent calls
  // return identical bytes. No duplicate test here.
  it.todo(
    'MKP-DL-4: covered by IMasterKeyProvider contract — two concurrent calls return identical bytes',
  );
});
