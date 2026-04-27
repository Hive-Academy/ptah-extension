/**
 * `runStateStorageContract` — behavioural contract for `IStateStorage`.
 *
 * Models the Memento semantics: synchronous `get` (returns the default when
 * absent), async `update`, and `keys()` reflecting the stored set. Setting a
 * value to `undefined` should behave as "delete" per VS Code's Memento docs.
 */

import type { IStateStorage } from '../../interfaces/state-storage.interface';

export function runStateStorageContract(
  name: string,
  createProvider: () => Promise<IStateStorage> | IStateStorage,
  teardown?: () => Promise<void> | void,
): void {
  describe(`IStateStorage contract — ${name}`, () => {
    let provider: IStateStorage;

    beforeEach(async () => {
      provider = await createProvider();
    });

    afterEach(async () => {
      await teardown?.();
    });

    it('get on unset key returns undefined without a default', () => {
      expect(provider.get('missing')).toBeUndefined();
    });

    it('get on unset key returns the provided default', () => {
      expect(provider.get<number>('missing', 42)).toBe(42);
    });

    it('update then get round-trips the typed value', async () => {
      await provider.update('count', 7);
      expect(provider.get<number>('count')).toBe(7);
    });

    it('update with undefined acts as delete — keys() no longer lists it', async () => {
      await provider.update('temp', 'x');
      expect(provider.keys()).toContain('temp');
      await provider.update('temp', undefined);
      expect(provider.keys()).not.toContain('temp');
    });

    it('update preserves non-primitive values via structural identity', async () => {
      const payload = { nested: { value: 1 } };
      await provider.update('obj', payload);
      expect(provider.get('obj')).toEqual(payload);
    });

    it('keys() reflects inserted keys in any order', async () => {
      await provider.update('a', 1);
      await provider.update('b', 2);
      expect([...provider.keys()].sort()).toEqual(['a', 'b']);
    });

    it('update overwrites existing values under the same key', async () => {
      await provider.update('overwrite', 'first');
      await provider.update('overwrite', 'second');
      expect(provider.get('overwrite')).toBe('second');
    });
  });
}
