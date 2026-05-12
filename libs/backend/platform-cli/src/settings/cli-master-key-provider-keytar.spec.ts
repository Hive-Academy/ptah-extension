/**
 * CliMasterKeyProvider — keytar-available path tests.
 *
 * Verifies that when keytar IS available:
 *   - A stored valid 32-byte key is returned directly.
 *   - A stored key with wrong length is discarded and a new key is generated.
 *   - When no key is stored, a new random 32-byte key is generated and persisted.
 *
 * Source-under-test:
 *   libs/backend/platform-cli/src/settings/cli-master-key-provider.ts
 *
 * We mock `keytar` via `jest.mock` with `{ virtual: true }` using a factory
 * that exposes a controllable in-memory store so we can exercise all three
 * branches of `getOrCreateKeytarKey`.
 */

// ---------------------------------------------------------------------------
// Controllable in-memory keytar mock.
// The store lives on globalThis so the hoisted factory can reach it.
// ---------------------------------------------------------------------------

declare global {
  // eslint-disable-next-line no-var
  var __keytarStore: Map<string, string>;
}

globalThis.__keytarStore = new Map<string, string>();

jest.mock(
  'keytar',
  () => {
    return {
      getPassword: jest.fn(
        (service: string, account: string): Promise<string | null> =>
          Promise.resolve(
            globalThis.__keytarStore.get(`${service}:${account}`) ?? null,
          ),
      ),
      setPassword: jest.fn(
        (service: string, account: string, password: string): Promise<void> => {
          globalThis.__keytarStore.set(`${service}:${account}`, password);
          return Promise.resolve();
        },
      ),
    };
  },
  { virtual: true },
);

import { runMasterKeyProviderContract } from '@ptah-extension/platform-core/testing';
import { CliMasterKeyProvider } from './cli-master-key-provider';

function resetFallbackWarnFlag(): void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (CliMasterKeyProvider as any).fallbackWarnEmitted = false;
}

beforeEach(() => {
  globalThis.__keytarStore.clear();
  resetFallbackWarnFlag();
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
  resetFallbackWarnFlag();
});

// ---------------------------------------------------------------------------
// IMasterKeyProvider contract suite — keytar-available path
// No makeStateRoot: CliMasterKeyProvider stores via keytar (in-memory mock),
// not a file directory. Cross-restart persistence test skipped.
// ---------------------------------------------------------------------------

runMasterKeyProviderContract('CliMasterKeyProvider (keytar)', () => {
  globalThis.__keytarStore.clear();
  resetFallbackWarnFlag();
  return new CliMasterKeyProvider();
});

describe('CliMasterKeyProvider: keytar-available path', () => {
  it('getMasterKey() returns the stored key when keytar has a valid 32-byte entry', async () => {
    const existingKey = Buffer.alloc(32, 0xab);
    globalThis.__keytarStore.set(
      'ptah:masterKey',
      existingKey.toString('base64'),
    );

    const provider = new CliMasterKeyProvider();
    const key = await provider.getMasterKey();

    expect(Buffer.isBuffer(key)).toBe(true);
    expect(key.length).toBe(32);
    expect(key.equals(existingKey)).toBe(true);
  });

  it('getMasterKey() caches the key — same Buffer reference on repeated calls', async () => {
    const existingKey = Buffer.alloc(32, 0x77);
    globalThis.__keytarStore.set(
      'ptah:masterKey',
      existingKey.toString('base64'),
    );

    const provider = new CliMasterKeyProvider();
    const key1 = await provider.getMasterKey();
    const key2 = await provider.getMasterKey();

    expect(key1).toBe(key2); // strict reference equality (cached)
  });

  it('getMasterKey() generates and stores a new random key when keytar has no entry', async () => {
    // Store is empty — no existing key
    const provider = new CliMasterKeyProvider();
    const key = await provider.getMasterKey();

    expect(Buffer.isBuffer(key)).toBe(true);
    expect(key.length).toBe(32);
    // The generated key must have been persisted to the store
    const stored = globalThis.__keytarStore.get('ptah:masterKey');
    expect(stored).toBeDefined();
    const storedBuf = Buffer.from(stored as string, 'base64');
    expect(storedBuf.equals(key)).toBe(true);
  });

  it('getMasterKey() discards a stored key with wrong byte length and generates a new one', async () => {
    // Store a 16-byte key (wrong length — must be 32)
    const shortKey = Buffer.alloc(16, 0x11);
    globalThis.__keytarStore.set('ptah:masterKey', shortKey.toString('base64'));

    const provider = new CliMasterKeyProvider();
    const key = await provider.getMasterKey();

    expect(key.length).toBe(32);
    // Should NOT be the short key
    expect(key.equals(shortKey)).toBe(false);
    // New key must have been persisted
    const stored = globalThis.__keytarStore.get('ptah:masterKey');
    expect(stored).toBeDefined();
    const storedBuf = Buffer.from(stored as string, 'base64');
    expect(storedBuf.equals(key)).toBe(true);
  });

  it('getMasterKey() does not emit console.warn when keytar is available', async () => {
    const existingKey = Buffer.alloc(32, 0xcc);
    globalThis.__keytarStore.set(
      'ptah:masterKey',
      existingKey.toString('base64'),
    );

    const provider = new CliMasterKeyProvider();
    await provider.getMasterKey();

    expect(console.warn).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// MKP-DL data-loss audit tests — CliMasterKeyProvider (keytar path)
//
// CLI uses keytar as its persistent store; there is no file-based key-ref.
// "Corruption" is simulated by pre-seeding the in-memory keytar store with
// a wrong-length key.
//
// MKP-DL-4: covered by IMasterKeyProvider contract suite's test
// "two concurrent getMasterKey() calls on a fresh instance return identical bytes".
// ---------------------------------------------------------------------------

describe('MKP-DL — CliMasterKeyProvider (keytar): data-loss audit', () => {
  beforeEach(() => {
    globalThis.__keytarStore.clear();
    resetFallbackWarnFlag();
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    resetFallbackWarnFlag();
    globalThis.__keytarStore.clear();
  });

  // MKP-DL-1: corrupt key in keytar store (wrong length) — reinit provider fires
  // user-visible error (console.error or showErrorMessage) exactly once and
  // generates a new valid key.
  it('MKP-DL-1: wrong-length keytar entry triggers error notification and generates new 32-byte key', async () => {
    // Seed with a 12-byte (wrong-length) key.
    globalThis.__keytarStore.set(
      'ptah:masterKey',
      Buffer.alloc(12, 0xaa).toString('base64'),
    );

    const showErrorMessage = jest.fn().mockResolvedValue(undefined);
    const provider = new CliMasterKeyProvider({
      showErrorMessage,
    } as unknown as import('@ptah-extension/platform-core').IUserInteraction);

    const key = await provider.getMasterKey();

    expect(Buffer.isBuffer(key)).toBe(true);
    expect(key.length).toBe(32);
    // User-visible error fired exactly once.
    expect(showErrorMessage).toHaveBeenCalledTimes(1);
    const [msg] = showErrorMessage.mock.calls[0] as [string];
    expect(msg).toMatch(/corrupted or unreadable/i);
  });

  // MKP-DL-2: simulate keytar store becoming unavailable mid-operation.
  // Behavior must be deterministic: both concurrent calls on the same fresh
  // instance resolve to the same value (the pending-promise guard ensures this
  // regardless of the underlying error). When getPassword throws, the provider
  // rejects both calls with the same error — no partial success.
  it('MKP-DL-2: concurrent calls on a fresh instance always have the same outcome (both succeed or both fail)', async () => {
    // Inject a failing getPassword via the shared store mock. Because
    // jest.mock uses a hoisted virtual factory, we override the getPassword
    // fn that the mock exposes to throw on first call.
    const keytar = require('keytar') as {
      getPassword: jest.Mock;
      setPassword: jest.Mock;
    };
    const originalGetPassword = keytar.getPassword;

    // Make getPassword throw only on the FIRST invocation (the single shared
    // pending-promise call). Both concurrent callers share this one rejection.
    keytar.getPassword.mockImplementationOnce(() =>
      Promise.reject(new Error('keytar unavailable')),
    );

    const provider = new CliMasterKeyProvider();
    const [r1, r2] = await Promise.allSettled([
      provider.getMasterKey(),
      provider.getMasterKey(),
    ]);

    // Both outcomes must be identical — no partial split.
    expect(r1.status).toBe(r2.status);

    // Restore original implementation for subsequent tests.
    keytar.getPassword = originalGetPassword;
  });

  // MKP-DL-3: after key regeneration (due to wrong-length entry), the new key
  // written to keytar is a valid 32-byte base64-encoded key.
  it('MKP-DL-3: key regeneration writes valid 32-byte base64 key to keytar store', async () => {
    // Seed with a wrong-length key to force regeneration.
    globalThis.__keytarStore.set(
      'ptah:masterKey',
      Buffer.alloc(4, 0x11).toString('base64'),
    );

    const provider = new CliMasterKeyProvider();
    const key = await provider.getMasterKey();

    // Returned key is 32 bytes.
    expect(key.length).toBe(32);

    // The new key must have been written to the store.
    const stored = globalThis.__keytarStore.get('ptah:masterKey');
    expect(stored).toBeDefined();
    const decoded = Buffer.from(stored as string, 'base64');
    expect(decoded.length).toBe(32);
    expect(decoded.equals(key)).toBe(true);
  });

  // MKP-DL-4: covered by IMasterKeyProvider contract — two concurrent calls
  // return identical bytes. No duplicate test here.
  it.todo(
    'MKP-DL-4: covered by IMasterKeyProvider contract — two concurrent calls return identical bytes',
  );
});
