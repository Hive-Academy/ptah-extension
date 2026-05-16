/**
 * FileSettingsStore — ISettingsStore adapter for CLI.
 *
 * Delegates global read/write operations to PtahFileSettingsManager so that
 * the settings-core repositories can read and write settings without knowing
 * about the underlying platform file format.
 *
 * This file is intentionally separate from
 * libs/backend/platform-electron/src/settings/file-settings-store.ts.
 * Per the project's hexagonal rules, adapters in different platforms are
 * mutually exclusive — each platform lib pays the cost of duplication
 * to preserve isolation. Do NOT import or re-export the Electron class here.
 *
 * Secret operations are backed by SecretsFileStore (AES-256-GCM in
 * ~/.ptah/secrets.enc.json) with the master key from IMasterKeyProvider
 * (CliMasterKeyProvider uses keytar with HKDF fallback).
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

  /** Cross-process secret change notifications. */
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
   * Uses the cached master key from the last async access. If the cache is
   * empty (no secrets were accessed in this process), the secrets flush is
   * skipped — there is no dirty data to write.
   */
  flushSync(): void {
    this.fileSettings.flushSync();
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
