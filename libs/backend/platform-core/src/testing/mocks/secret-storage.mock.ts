/**
 * `createMockSecretStorage` — seedable in-memory `jest.Mocked<ISecretStorage>`.
 *
 * Writes / deletes mutate the backing `Map<string, string>` so round-trip
 * tests (`store(k, v)` → `get(k)`) work without touching OS secret stores.
 */

import type { ISecretStorage } from '../../interfaces/secret-storage.interface';
import type { SecretChangeEvent } from '../../types/platform.types';
import { createEvent } from '../../utils/event-emitter';

export interface MockSecretStorageState {
  readonly entries: Map<string, string>;
  seed(key: string, value: string): void;
  fireChange(key: string): void;
}

export type MockSecretStorage = jest.Mocked<ISecretStorage> & {
  readonly __state: MockSecretStorageState;
};

export interface MockSecretStorageOverrides extends Partial<ISecretStorage> {
  /** Initial key/value map seeded before tests run. */
  seed?: Record<string, string>;
}

export function createMockSecretStorage(
  overrides?: MockSecretStorageOverrides,
): MockSecretStorage {
  const entries = new Map<string, string>(
    Object.entries(overrides?.seed ?? {}),
  );
  const [onDidChange, fireChange] = createEvent<SecretChangeEvent>();

  const mock = {
    get: jest.fn(
      async (key: string): Promise<string | undefined> => entries.get(key),
    ),
    store: jest.fn(async (key: string, value: string): Promise<void> => {
      entries.set(key, value);
      fireChange({ key });
    }),
    delete: jest.fn(async (key: string): Promise<void> => {
      if (entries.delete(key)) fireChange({ key });
    }),
    onDidChange,
    __state: {
      entries,
      seed(key: string, value: string): void {
        entries.set(key, value);
      },
      fireChange(key: string): void {
        fireChange({ key });
      },
    },
  } as unknown as MockSecretStorage;

  if (overrides) {
    for (const key of ['get', 'store', 'delete'] as const) {
      const value = overrides[key];
      if (typeof value === 'function') {
        (mock as unknown as Record<string, unknown>)[key] = jest.fn(
          value as (...args: unknown[]) => unknown,
        );
      }
    }
  }

  return mock;
}
