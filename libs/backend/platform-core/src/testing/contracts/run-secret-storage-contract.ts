/**
 * `runSecretStorageContract` — behavioural contract for `ISecretStorage`.
 *
 * Store/get round-trips, delete semantics, and event firing — all asserted
 * against observable behaviour so VS Code (OS keychain), Electron (file), and
 * CLI (in-memory) impls can share this suite.
 */

import type { ISecretStorage } from '../../interfaces/secret-storage.interface';

export function runSecretStorageContract(
  name: string,
  createProvider: () => Promise<ISecretStorage> | ISecretStorage,
  teardown?: () => Promise<void> | void,
): void {
  describe(`ISecretStorage contract — ${name}`, () => {
    let provider: ISecretStorage;

    beforeEach(async () => {
      provider = await createProvider();
    });

    afterEach(async () => {
      await teardown?.();
    });

    it('get on unset key resolves to undefined', async () => {
      expect(await provider.get('missing-key')).toBeUndefined();
    });

    it('store then get round-trips the value verbatim', async () => {
      await provider.store('api-token', 'sk-1234');
      expect(await provider.get('api-token')).toBe('sk-1234');
    });

    it('store overwrites prior value for the same key', async () => {
      await provider.store('api-token', 'v1');
      await provider.store('api-token', 'v2');
      expect(await provider.get('api-token')).toBe('v2');
    });

    it('delete removes the key — subsequent get resolves to undefined', async () => {
      await provider.store('temp', 'x');
      await provider.delete('temp');
      expect(await provider.get('temp')).toBeUndefined();
    });

    it('delete on missing key does not throw', async () => {
      await expect(provider.delete('never-existed')).resolves.not.toThrow();
    });

    it('onDidChange fires with key on store', async () => {
      const seen: string[] = [];
      const sub = provider.onDidChange((evt) => seen.push(evt.key));
      await provider.store('watched', 'v');
      sub.dispose();
      expect(seen).toContain('watched');
    });

    it('onDidChange fires with key on delete', async () => {
      await provider.store('to-delete', 'v');
      const seen: string[] = [];
      const sub = provider.onDidChange((evt) => seen.push(evt.key));
      await provider.delete('to-delete');
      sub.dispose();
      expect(seen).toContain('to-delete');
    });

    it('empty-string value is retrievable (not treated as absent)', async () => {
      await provider.store('blank', '');
      expect(await provider.get('blank')).toBe('');
    });
  });
}
