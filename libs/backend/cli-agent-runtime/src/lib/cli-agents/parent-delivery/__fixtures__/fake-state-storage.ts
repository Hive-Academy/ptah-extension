import type { IStateStorage } from '@ptah-extension/platform-core';

type KeyPredicate = (key: string, value: unknown) => boolean;

/**
 * In-memory `IStateStorage` for parent delivery specs. Values are cloned on
 * write and read, so a new store instance over the same fake simulates a
 * restart. `failWrites` / `failReads` inject storage outages per key.
 */
export class FakeStateStorage implements IStateStorage {
  readonly values = new Map<string, unknown>();
  readonly writes: string[] = [];
  failWrites: KeyPredicate = () => false;
  failReads: (key: string) => boolean = () => false;

  get<T>(key: string, defaultValue?: T): T | undefined {
    if (this.failReads(key)) throw new Error(`read failed: ${key}`);
    const value = this.values.get(key);
    return value === undefined ? defaultValue : structuredClone(value) as T;
  }

  async update(key: string, value: unknown): Promise<void> {
    if (this.failWrites(key, value)) throw new Error(`write failed: ${key}`);
    this.writes.push(key);
    if (value === undefined) this.values.delete(key);
    else this.values.set(key, structuredClone(value));
  }

  keys(): readonly string[] {
    return [...this.values.keys()];
  }

  keysWithPrefix(prefix: string): readonly string[] {
    return this.keys().filter((key) => key.startsWith(prefix));
  }
}
