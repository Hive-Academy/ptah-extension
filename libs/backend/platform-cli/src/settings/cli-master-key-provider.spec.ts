/**
 * CliMasterKeyProvider — keytar-unavailable HKDF fallback tests (Gap C3).
 *
 * Verifies that when keytar is not installed (simulated by mocking the dynamic
 * import to throw), CliMasterKeyProvider falls back to HKDF-SHA256 derivation
 * and emits a one-time console.warn about reduced protection.
 *
 * Source-under-test:
 *   libs/backend/platform-cli/src/settings/cli-master-key-provider.ts
 */

import { CliMasterKeyProvider } from './cli-master-key-provider';

// ---------------------------------------------------------------------------
// Reset the static fallbackWarnEmitted flag between tests so each test
// observes a clean state. The flag is private static; we access it via
// a one-line `any` cast (see resetFallbackWarnFlag below) to bypass TS
// visibility. Avoid the literal `eslint-disable-next-line` phrase here —
// ESLint parses it as an attempted directive.
// ---------------------------------------------------------------------------

function resetFallbackWarnFlag(): void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (CliMasterKeyProvider as any).fallbackWarnEmitted = false;
}

// ---------------------------------------------------------------------------
// Mock `keytar` dynamic import to simulate it being unavailable.
//
// CliMasterKeyProvider calls `await import('keytar').catch(() => null)` via
// a private `tryLoadKeytar()` helper. We cannot jest.mock() a dynamic import
// directly, but we can mock the module registry before the first import so
// that subsequent dynamic imports resolve our mock.
//
// Because the dynamic import is wrapped in `.catch(() => null)`, throwing
// from the mock is equivalent to keytar being absent.
// ---------------------------------------------------------------------------

jest.mock(
  'keytar',
  () => {
    throw new Error('keytar not installed');
  },
  { virtual: true },
);

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('C3 — CliMasterKeyProvider: HKDF fallback when keytar unavailable', () => {
  let warnSpy: jest.SpyInstance;

  beforeEach(() => {
    resetFallbackWarnFlag();
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    warnSpy.mockRestore();
    resetFallbackWarnFlag();
  });

  it('getMasterKey() returns a 32-byte Buffer when keytar is unavailable (HKDF fallback)', async () => {
    const provider = new CliMasterKeyProvider();
    const key = await provider.getMasterKey();

    expect(Buffer.isBuffer(key)).toBe(true);
    expect(key.length).toBe(32);
  });

  it('getMasterKey() emits a console.warn mentioning "reduced protection" on first call', async () => {
    const provider = new CliMasterKeyProvider();
    await provider.getMasterKey();

    expect(warnSpy).toHaveBeenCalledTimes(1);
    const [warningText] = warnSpy.mock.calls[0] as [string];
    expect(warningText).toMatch(/reduced protection/i);
  });

  it('console.warn is emitted exactly once across multiple getMasterKey() calls (static flag)', async () => {
    const provider = new CliMasterKeyProvider();

    await provider.getMasterKey();
    await provider.getMasterKey();
    await provider.getMasterKey();

    // The warn must fire only on the first call — subsequent calls use the
    // cached key and the static flag prevents duplicate warnings.
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });

  it('fallback key is deterministic across instances on the same machine', async () => {
    // Two separate provider instances should derive the SAME key from
    // username:hostname (stable derivation is required so secrets survive restarts).
    resetFallbackWarnFlag();
    const warnMock = jest
      .spyOn(console, 'warn')
      .mockImplementation(() => undefined);

    const provider1 = new CliMasterKeyProvider();
    const key1 = await provider1.getMasterKey();

    resetFallbackWarnFlag();

    const provider2 = new CliMasterKeyProvider();
    const key2 = await provider2.getMasterKey();

    expect(key1.equals(key2)).toBe(true);
    warnMock.mockRestore();
  });

  it('fallback key is cached — getMasterKey() returns the same Buffer reference', async () => {
    const provider = new CliMasterKeyProvider();

    const key1 = await provider.getMasterKey();
    const key2 = await provider.getMasterKey();

    // Same object reference (cached after first derivation).
    expect(key1).toBe(key2);
  });

  it('warn message mentions the keyring installation remedy', async () => {
    const provider = new CliMasterKeyProvider();
    await provider.getMasterKey();

    const [warningText] = warnSpy.mock.calls[0] as [string];
    // The warn must be actionable: instruct the user to install libsecret / use a real keyring.
    expect(warningText).toMatch(/keyring|libsecret|keytar/i);
  });
});
