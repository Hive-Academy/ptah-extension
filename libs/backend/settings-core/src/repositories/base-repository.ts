import type { IDisposable } from '@ptah-extension/platform-core';
import type { ISettingsStore } from '../ports/settings-store.interface';
import type { SettingDefinition } from '../schema/definition';
import type { SettingHandle } from './setting-handle';

/**
 * Base class for per-namespace settings repositories.
 *
 * Provides a `handleFor()` factory that wires a SettingDefinition's Zod schema
 * into the get/set/watch path, ensuring validation on every write and safe
 * parsing on every read.
 *
 * Subclasses expose typed public properties (e.g., `authMethod`, `selectedModel`)
 * backed by handles created via `handleFor()`.
 */
export class BaseSettingsRepository {
  protected readonly store: ISettingsStore;

  constructor(store: ISettingsStore) {
    this.store = store;
  }

  /**
   * Create a typed SettingHandle for the given definition.
   *
   * - `get()` reads from the store, parses with Zod, falls back to definition default.
   * - `set(value)` validates with Zod, then persists.
   * - `watch(cb)` subscribes to changes; fires immediately with current value.
   */
  protected handleFor<T>(def: SettingDefinition<T>): SettingHandle<T> {
    const store = this.store;

    return {
      get(): T {
        const raw = store.readGlobal<unknown>(def.key);
        const parsed = def.schema.safeParse(raw);
        return parsed.success ? parsed.data : def.default;
      },

      async set(value: T): Promise<void> {
        const validated = def.schema.parse(value);
        await store.writeGlobal(def.key, validated);
      },

      watch(cb: (value: T) => void): IDisposable {
        const sub = store.watchGlobal(def.key, (raw: unknown) => {
          const parsed = def.schema.safeParse(raw);
          cb(parsed.success ? parsed.data : def.default);
        });
        // Fire immediately with the current value.
        const current = store.readGlobal<unknown>(def.key);
        const parsedCurrent = def.schema.safeParse(current);
        cb(parsedCurrent.success ? parsedCurrent.data : def.default);
        return sub;
      },
    };
  }
}
