/**
 * `runMasterKeyProviderContract` — cross-platform invariants for `IMasterKeyProvider`.
 *
 * Asserts observable key shape, persistence semantics, and idempotency policy.
 * Does NOT assert secure-storage internals or corruption/data-loss paths —
 * those belong in Phase 3 (data-loss audit).
 *
 * Factory signature supports adapters with and without a persistent state root:
 *
 *   - Adapters that persist to a directory (e.g. ElectronMasterKeyProvider)
 *     pass `makeStateRoot` + `createProvider(stateRoot)`.
 *   - Adapters backed by an in-memory or injected store (e.g. Vscode, CLI-keytar)
 *     pass `makeStateRoot: undefined` and a `createProvider` that ignores the
 *     stateRoot argument. The cross-restart test is skipped for those adapters.
 *
 * The "same Buffer reference" (cached) invariant is intentionally strict: it
 * documents that all implementations MUST cache the key in-process so callers
 * can rely on reference equality for identity checks.
 */

import type { IMasterKeyProvider } from '../../interfaces/master-key-provider.interface';

export function runMasterKeyProviderContract(
  name: string,
  /**
   * Factory that creates a provider instance.
   * `stateRoot` is the temporary directory created by `makeStateRoot` (if
   * provided), or an empty string when the adapter has no file-based backing.
   */
  createProvider: (
    stateRoot: string,
  ) => Promise<IMasterKeyProvider> | IMasterKeyProvider,
  /**
   * Optional: creates a temporary directory that serves as the adapter's
   * persistent state root. If omitted, the cross-restart persistence test is
   * skipped because the adapter has no file-based backing store to simulate a
   * restart against.
   */
  makeStateRoot?: () => Promise<string>,
  teardown?: (stateRoot: string) => Promise<void> | void,
): void {
  describe(`IMasterKeyProvider contract — ${name}`, () => {
    let stateRoot: string;
    let provider: IMasterKeyProvider;

    beforeEach(async () => {
      stateRoot = makeStateRoot ? await makeStateRoot() : '';
      provider = await createProvider(stateRoot);
    });

    afterEach(async () => {
      await teardown?.(stateRoot);
    });

    // -------------------------------------------------------------------------
    // Key shape
    // -------------------------------------------------------------------------

    it('getMasterKey() resolves to a Buffer of exactly 32 bytes', async () => {
      const key = await provider.getMasterKey();
      expect(Buffer.isBuffer(key)).toBe(true);
      expect(key.length).toBe(32);
    });

    it('getMasterKey() returns the same Buffer reference on repeated calls (in-process cache)', async () => {
      const k1 = await provider.getMasterKey();
      const k2 = await provider.getMasterKey();
      expect(k1).toBe(k2);
    });

    it('getMasterKey() bytes are not all-zero (key material is non-trivial)', async () => {
      const key = await provider.getMasterKey();
      const allZero = key.every((b) => b === 0);
      expect(allZero).toBe(false);
    });

    // -------------------------------------------------------------------------
    // Idempotent get-or-create: two concurrent calls on a fresh instance must
    // resolve to the same key value (no race-created divergence).
    // -------------------------------------------------------------------------

    it('two concurrent getMasterKey() calls on a fresh instance return identical bytes', async () => {
      const [k1, k2] = await Promise.all([
        provider.getMasterKey(),
        provider.getMasterKey(),
      ]);
      expect(k1.toString('hex')).toBe(k2.toString('hex'));
    });

    // -------------------------------------------------------------------------
    // Cross-restart persistence — only for file-backed adapters.
    // Skipped when makeStateRoot is not provided (in-memory / injected store).
    // -------------------------------------------------------------------------

    it('getMasterKey() returns the same key value across two provider instances sharing a state root', async () => {
      if (!makeStateRoot) {
        // Adapter has no file-based state root — persistence across restarts is
        // handled by the injected store (VS Code SecretStorage / keytar) rather
        // than a temporary directory.  Skip rather than fail.
        return;
      }

      const k1 = await provider.getMasterKey();
      const provider2 = await createProvider(stateRoot);
      const k2 = await provider2.getMasterKey();
      expect(k1.toString('hex')).toBe(k2.toString('hex'));
    });

    // -------------------------------------------------------------------------
    // Regeneration policy — decisions pending (see Open Question 1 in
    // docs/test-strategy-plan.md §8). Bodies are left as todos until the
    // specified behavior is ratified.
    // -------------------------------------------------------------------------

    it.todo(
      '[DECISION REQUIRED] corrupt key-ref: regenerate silently (data loss) vs. throw loudly (no data loss)',
    );

    it.todo(
      '[DECISION REQUIRED] wrong-length key-ref: regenerate silently vs. throw loudly',
    );
  });
}
