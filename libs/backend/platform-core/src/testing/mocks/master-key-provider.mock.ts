/**
 * `createMockMasterKeyProvider` — deterministic in-memory `IMasterKeyProvider`.
 *
 * Generates a fixed 32-byte key on first call and caches it in-process,
 * matching the contract invariants (32-byte Buffer, non-zero, same reference
 * on repeated calls). Suitable for the conformance runner self-spec and for
 * downstream specs that need an `IMasterKeyProvider` stand-in.
 */

import type { IMasterKeyProvider } from '../../interfaces/master-key-provider.interface';

export type MockMasterKeyProvider = jest.Mocked<IMasterKeyProvider>;

export function createMockMasterKeyProvider(
  /** Optional fixed key bytes. Defaults to a non-zero 32-byte pattern. */
  fixedKey?: Buffer,
): MockMasterKeyProvider {
  // Generate a deterministic but non-zero key if none is provided.
  const key: Buffer =
    fixedKey ??
    Buffer.from(Array.from({ length: 32 }, (_, i) => (i + 1) & 0xff));
  let cached: Buffer | null = null;

  return {
    getMasterKey: jest.fn(async (): Promise<Buffer> => {
      if (!cached) {
        cached = key;
      }
      return cached;
    }),
  } as MockMasterKeyProvider;
}
