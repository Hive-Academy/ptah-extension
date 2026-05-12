import type { IDisposable } from '@ptah-extension/platform-core';

/**
 * Abstract port for settings persistence backends.
 *
 * Adapters in platform-{vscode,electron,cli} implement this interface,
 * providing the actual I/O layer. ReactiveSettingsStore wraps an adapter
 * instance to add in-process event emission.
 */
export interface ISettingsStore {
  /** Read a global (non-secret) setting from persistent storage. */
  readGlobal<T>(key: string): T | undefined;

  /** Write a global setting to persistent storage. */
  writeGlobal<T>(key: string, value: T): Promise<void>;

  /** Read a secret value (e.g., cipher text) from secure storage. */
  readSecret(key: string): Promise<string | undefined>;

  /** Write a secret value to secure storage. */
  writeSecret(key: string, ciphertext: string): Promise<void>;

  /** Delete a secret from secure storage. */
  deleteSecret(key: string): Promise<void>;

  /**
   * Subscribe to changes on a global setting key.
   * The callback fires whenever the value at `key` changes.
   * Dispose the returned handle to unsubscribe.
   */
  watchGlobal(key: string, cb: (value: unknown) => void): IDisposable;

  /**
   * Subscribe to changes on a secret key.
   * The callback fires (without the value — secrets are read-only on demand)
   * whenever the secret at `key` is written or deleted.
   * Dispose the returned handle to unsubscribe.
   */
  watchSecret(key: string, cb: () => void): IDisposable;

  /**
   * Synchronously flush any buffered writes to disk.
   * Used by process-exit handlers to avoid data loss.
   */
  flushSync(): void;
}
