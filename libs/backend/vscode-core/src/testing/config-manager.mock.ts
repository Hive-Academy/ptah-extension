/**
 * Mock factory for {@link ConfigManager} (vscode-core).
 *
 * Produces a `jest.Mocked<ConfigManager>` whose method surface exactly matches
 * the production class (see `libs/backend/vscode-core/src/config/config-manager.ts`).
 * A private in-memory bag backs `get` / `getWithDefault` / `getTyped` /
 * `getTypedWithDefault` / `set` / `setTyped` so tests can seed or drive
 * configuration through a partial `overrides` object instead of re-stubbing
 * every call site.
 *
 * Pattern reference: `libs/backend/workspace-intelligence/src/services/file-system.service.spec.ts`
 * (jest.Mocked<IInterface> convention).
 */

import type * as vscode from 'vscode';
import type { z } from 'zod';
import type { ConfigManager } from '../config/config-manager';
import type { IFileSettingsStore } from '../config/config-manager';
import type { ConfigUpdateOptions } from '../config/types';

export type ConfigBag = Record<string, unknown>;

export interface MockConfigManagerOverrides {
  /** Initial key→value pairs to seed into the mock store. */
  values?: ConfigBag;
  /** Keys to report via `has()` and `inspect()` as configured. */
  knownKeys?: readonly string[];
}

/**
 * Extended mock with test-only helpers exposed alongside the real surface.
 * `__seed` / `__snapshot` let tests inspect or mutate the backing store
 * without poking at private fields on the production class.
 */
export interface MockConfigManager extends jest.Mocked<
  Omit<
    ConfigManager,
    | 'setFileSettingsStore'
    | 'watch'
    | 'watchTyped'
    | 'dispose'
    | 'inspect'
    | 'has'
    | 'getSection'
  >
> {
  setFileSettingsStore: jest.Mock<
    void,
    [keys: Set<string>, store: IFileSettingsStore]
  >;
  watch: jest.Mock<vscode.Disposable, [string, (value: unknown) => void]>;
  watchTyped: jest.Mock<
    vscode.Disposable,
    [string, z.ZodSchema<unknown>, (value: unknown) => void]
  >;
  has: jest.Mock<boolean, [string]>;
  inspect: jest.Mock<unknown, [string]>;
  getSection: jest.Mock<unknown, [string?]>;
  dispose: jest.Mock<void, []>;

  /** Seed additional keys. Merges with the existing store. */
  __seed(values: ConfigBag): void;
  /** Snapshot a shallow copy of the current backing store. */
  __snapshot(): ConfigBag;
}

/**
 * Create a fully-typed mock `ConfigManager` with an in-memory configuration
 * bag. Override behavior per-test by passing `{ values, knownKeys }` or by
 * calling `.mockReturnValue(...)` on any individual jest.fn.
 */
export function createMockConfigManager(
  overrides?: MockConfigManagerOverrides,
): MockConfigManager {
  const store: ConfigBag = { ...(overrides?.values ?? {}) };
  const knownKeys = new Set<string>(overrides?.knownKeys ?? []);

  const mock: MockConfigManager = {
    get: jest.fn(
      <T>(key: string): T | undefined => store[key] as T | undefined,
    ),
    getWithDefault: jest.fn(<T>(key: string, defaultValue: T): T => {
      const raw = store[key];
      return raw === undefined ? defaultValue : (raw as T);
    }),
    getTyped: jest.fn(
      <T>(key: string, schema: z.ZodSchema<T>): T => schema.parse(store[key]),
    ),
    getTypedWithDefault: jest.fn(
      <T>(key: string, schema: z.ZodSchema<T>, defaultValue: T): T => {
        try {
          return schema.parse(store[key]);
        } catch {
          return defaultValue;
        }
      },
    ),
    set: jest.fn(
      async <T>(
        key: string,
        value: T,
        _options?: ConfigUpdateOptions,
      ): Promise<void> => {
        store[key] = value;
      },
    ),
    setTyped: jest.fn(
      async <T>(
        key: string,
        value: T,
        schema: z.ZodSchema<T>,
        _options?: ConfigUpdateOptions,
      ): Promise<void> => {
        store[key] = schema.parse(value);
      },
    ),
    setFileSettingsStore: jest.fn<
      void,
      [keys: Set<string>, store: IFileSettingsStore]
    >(),
    watch: jest.fn((_key: string, _cb: (value: unknown) => void) => ({
      dispose: jest.fn(),
    })),
    watchTyped: jest.fn(
      (
        _key: string,
        _schema: z.ZodSchema<unknown>,
        _cb: (value: unknown) => void,
      ) => ({ dispose: jest.fn() }),
    ),
    has: jest.fn((key: string) => knownKeys.has(key) || key in store),
    inspect: jest.fn((_key: string) => undefined),
    getSection: jest.fn((_section?: string) => ({}) as unknown),
    dispose: jest.fn(),

    __seed(values: ConfigBag): void {
      Object.assign(store, values);
    },
    __snapshot(): ConfigBag {
      return { ...store };
    },
  } as MockConfigManager;

  return mock;
}
