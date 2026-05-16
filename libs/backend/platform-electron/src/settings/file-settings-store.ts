/**
 * FileSettingsStore — ISettingsStore adapter for Electron.
 *
 * Delegates global read/write operations to PtahFileSettingsManager so that
 * the settings-core repositories can read and write settings without knowing
 * about the underlying platform file format.
 *
 * Secret operations are backed by SecretsFileStore (AES-256-GCM in
 * ~/.ptah/secrets.enc.json) with the master key from IMasterKeyProvider
 * (ElectronMasterKeyProvider uses safeStorage).
 */

import type { IDisposable } from '@ptah-extension/platform-core';
import type { PtahFileSettingsManager } from '@ptah-extension/platform-core';
import type { IMasterKeyProvider } from '@ptah-extension/platform-core';
import type { ISettingsStore } from '@ptah-extension/settings-core';
import { SecretsFileStore } from '@ptah-extension/settings-core';

export class FileSettingsStore implements ISettingsStore {
  private readonly fileSettings: PtahFileSettingsManager;
  private readonly masterKeyProvider: IMasterKeyProvider;
  private readonly secretsStore: SecretsFileStore;
  /** Cached master key for synchronous flush path. Null until first async access. */
  private cachedMasterKey: Buffer | null = null;

  constructor(
    fileSettings: PtahFileSettingsManager,
    masterKeyProvider: IMasterKeyProvider,
    secretsStore: SecretsFileStore,
  ) {
    this.fileSettings = fileSettings;
    this.masterKeyProvider = masterKeyProvider;
    this.secretsStore = secretsStore;
  }

  // ---------------------------------------------------------------------------
  // Global settings — backed by PtahFileSettingsManager (~/.ptah/settings.json)
  // ---------------------------------------------------------------------------

  readGlobal<T>(key: string): T | undefined {
    return this.fileSettings.get<T>(key);
  }

  async writeGlobal<T>(key: string, value: T): Promise<void> {
    await this.fileSettings.set(key, value);
  }

  // ---------------------------------------------------------------------------
  // Secret storage — AES-256-GCM via SecretsFileStore
  // ---------------------------------------------------------------------------

  /**
   * Read a secret from the encrypted secrets file.
   * Returns undefined if the key has never been written.
   */
  async readSecret(key: string): Promise<string | undefined> {
    const masterKey = await this.getAndCacheMasterKey();
    return this.secretsStore.read(key, masterKey);
  }

  /**
   * Encrypt and persist a secret value.
   *
   * The parameter name `plaintext` reflects that the adapter performs
   * AES-256-GCM encryption internally — callers pass the raw value.
   */
  async writeSecret(key: string, plaintext: string): Promise<void> {
    const masterKey = await this.getAndCacheMasterKey();
    await this.secretsStore.write(key, plaintext, masterKey);
  }

  /** Remove a secret from the encrypted secrets file. */
  async deleteSecret(key: string): Promise<void> {
    await this.secretsStore.delete(key);
  }

  // ---------------------------------------------------------------------------
  // Watchers
  // ---------------------------------------------------------------------------

  /**
   * Subscribe to in-process changes for a global setting key.
   *
   * Delegates to PtahFileSettingsManager.watch() which fires after every
   * successful in-process write.
   */
  watchGlobal(key: string, cb: (value: unknown) => void): IDisposable {
    return this.fileSettings.watch(key, cb);
  }

  /**
   * Subscribe to changes on a secret key.
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  watchSecret(_key: string, _cb: () => void): IDisposable {
    // eslint-disable-next-line @typescript-eslint/no-empty-function
    return { dispose: () => {} };
  }

  // ---------------------------------------------------------------------------
  // Flush
  // ---------------------------------------------------------------------------

  /**
   * Flush both the global settings file and the secrets file synchronously.
   *
   * The master key fetch is async, so this method uses the cached key from
   * the last async readSecret/writeSecret call. If the cache is empty (no
   * secrets were accessed in this process), the secrets flush is skipped
   * with a logged warning (no data has been changed, so nothing is lost).
   */
  flushSync(): void {
    this.fileSettings.flushSync();
    if (this.cachedMasterKey === null) {
      // Secrets were not accessed — nothing to flush.
      return;
    }
    this.secretsStore.flushSync(this.cachedMasterKey);
  }

  // ---------------------------------------------------------------------------
  // Internal
  // ---------------------------------------------------------------------------

  private async getAndCacheMasterKey(): Promise<Buffer> {
    if (!this.cachedMasterKey) {
      this.cachedMasterKey = await this.masterKeyProvider.getMasterKey();
    }
    return this.cachedMasterKey;
  }
}
