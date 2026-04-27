/**
 * `createMockStateStorage` — seedable in-memory `jest.Mocked<IStateStorage>`.
 *
 * Mirrors `vscode.Memento` semantics: synchronous `get`, async `update`, and a
 * `keys()` view backed by the same `Map`.
 */

import type { IStateStorage } from '../../interfaces/state-storage.interface';

export interface MockStateStorageState {
  readonly entries: Map<string, unknown>;
  seed(key: string, value: unknown): void;
}

export type MockStateStorage = jest.Mocked<IStateStorage> & {
  readonly __state: MockStateStorageState;
};

export interface MockStateStorageOverrides extends Partial<IStateStorage> {
  /** Initial key/value map seeded before tests run. */
  seed?: Record<string, unknown>;
}

export function createMockStateStorage(
  overrides?: MockStateStorageOverrides,
): MockStateStorage {
  const entries = new Map<string, unknown>(
    Object.entries(overrides?.seed ?? {}),
  );

  const mock = {
    get: jest.fn(<T>(key: string, defaultValue?: T): T | undefined => {
      return (entries.has(key) ? entries.get(key) : defaultValue) as
        | T
        | undefined;
    }),
    update: jest.fn(async (key: string, value: unknown): Promise<void> => {
      if (value === undefined) {
        entries.delete(key);
      } else {
        entries.set(key, value);
      }
    }),
    keys: jest.fn((): readonly string[] => [...entries.keys()]),
    __state: {
      entries,
      seed(key: string, value: unknown): void {
        entries.set(key, value);
      },
    },
  } as MockStateStorage;

  if (overrides) {
    for (const key of ['get', 'update', 'keys'] as const) {
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
