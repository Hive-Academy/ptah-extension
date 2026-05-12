import { EventEmitter } from 'events';
import type { IDisposable } from '@ptah-extension/platform-core';
import type { ISettingsStore } from '../ports/settings-store.interface';

/**
 * Reactive wrapper around a backend ISettingsStore.
 *
 * Adds in-process event emission so that multiple parts of the application
 * can subscribe to settings changes without polling the underlying store.
 *
 * Responsibilities:
 * - Maintains an in-memory read-through cache for global settings.
 * - On write, persists via the backend store, updates the cache, and fires listeners.
 * - Delegates secret reads/writes directly to the backend (no caching of secrets).
 * - Delegates flushSync() to the backend.
 *
 * This class does NOT perform I/O itself — that is the backend store's job.
 * Adapters in platform-{electron,cli,vscode} supply the concrete backend.
 */
export class ReactiveSettingsStore implements ISettingsStore {
  private readonly backend: ISettingsStore;
  private readonly globalCache = new Map<string, unknown>();
  private readonly globalEmitter = new EventEmitter();
  private readonly secretEmitter = new EventEmitter();

  constructor(backend: ISettingsStore) {
    this.backend = backend;
    // Avoid Node's default MaxListenersExceededWarning in large apps.
    this.globalEmitter.setMaxListeners(100);
    this.secretEmitter.setMaxListeners(100);
  }

  readGlobal<T>(key: string): T | undefined {
    if (this.globalCache.has(key)) {
      return this.globalCache.get(key) as T | undefined;
    }
    const value = this.backend.readGlobal<T>(key);
    // Cache even undefined so we don't repeatedly hit the backend for missing keys.
    this.globalCache.set(key, value);
    return value;
  }

  async writeGlobal<T>(key: string, value: T): Promise<void> {
    await this.backend.writeGlobal(key, value);
    this.globalCache.set(key, value);
    this.globalEmitter.emit(key, value);
  }

  readSecret(key: string): Promise<string | undefined> {
    return this.backend.readSecret(key);
  }

  async writeSecret(key: string, ciphertext: string): Promise<void> {
    await this.backend.writeSecret(key, ciphertext);
    this.secretEmitter.emit(key);
  }

  async deleteSecret(key: string): Promise<void> {
    await this.backend.deleteSecret(key);
    this.secretEmitter.emit(key);
  }

  watchGlobal(key: string, cb: (value: unknown) => void): IDisposable {
    this.globalEmitter.on(key, cb);
    return {
      dispose: () => {
        this.globalEmitter.off(key, cb);
      },
    };
  }

  watchSecret(key: string, cb: () => void): IDisposable {
    this.secretEmitter.on(key, cb);
    return {
      dispose: () => {
        this.secretEmitter.off(key, cb);
      },
    };
  }

  flushSync(): void {
    this.backend.flushSync();
  }

  /**
   * Invalidate the in-memory cache for a specific key.
   * Call this when the underlying store may have been modified out-of-band
   * (e.g., after a file-watcher fires for settings.json).
   */
  invalidateCache(key: string): void {
    this.globalCache.delete(key);
  }

  /** Invalidate the entire in-memory cache. */
  invalidateAllCache(): void {
    this.globalCache.clear();
  }
}
