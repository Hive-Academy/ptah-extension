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
