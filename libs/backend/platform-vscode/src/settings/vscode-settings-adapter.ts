/**
 * VscodeSettingsAdapter — ISettingsStore adapter for the VS Code platform.
 *
 * VS Code has a hybrid settings story:
 * - Trademarked/sensitive keys (FILE_BASED_SETTINGS_KEYS) live in
 *   ~/.ptah/settings.json via PtahFileSettingsManager (owned by VscodeWorkspaceProvider).
 * - Non-trademarked keys live in VS Code's own configuration store
 *   (vscode.workspace.getConfiguration).
 *
 * This adapter unifies both stores behind the ISettingsStore port so that
 * settings-core repositories are unaware of the routing.
 *
 * The vscode module is passed in as a constructor parameter (not imported at
 * the top level) so that this file can compile without the vscode types being
 * loaded — preserving testability and correct behaviour for the CLI shim.
 *
 * Secret operations are backed by SecretsFileStore (AES-256-GCM in
 * ~/.ptah/secrets.enc.json) with the master key from VscodeMasterKeyProvider
 * (which uses vscode.SecretStorage — OS keychain backed).
 *
 * WP-2B: Platform adapter creation.
 * WP-4A: Secret storage implementation.
 */

import type { IDisposable } from '@ptah-extension/platform-core';
import { isFileBasedSettingKey } from '@ptah-extension/platform-core';
import type { VscodeWorkspaceProvider } from '../implementations/vscode-workspace-provider';
import type {
  ISettingsStore,
  IMasterKeyProvider,
} from '@ptah-extension/settings-core';
import { SecretsFileStore } from '@ptah-extension/settings-core';

/**
 * Minimal slice of the vscode module required by VscodeSettingsAdapter.
 * Typed structurally so the adapter can be used without a hard vscode import.
 */
export interface VscodeApiSlice {
  workspace: {
    getConfiguration(section: string): {
      get<T>(key: string): T | undefined;
      update(key: string, value: unknown, target: unknown): Thenable<void>;
    };
    onDidChangeConfiguration(
      listener: (e: { affectsConfiguration(section: string): boolean }) => void,
    ): { dispose(): void };
  };
  ConfigurationTarget: {
    Global: unknown;
  };
}

export class VscodeSettingsAdapter implements ISettingsStore {
  private readonly workspaceProvider: VscodeWorkspaceProvider;
  private readonly vscode: VscodeApiSlice;
  private readonly masterKeyProvider: IMasterKeyProvider;
  private readonly secretsStore: SecretsFileStore;
  /** Cached master key for synchronous flush path. Null until first async access. */
  private cachedMasterKey: Buffer | null = null;

  constructor(
    workspaceProvider: VscodeWorkspaceProvider,
    vscodeModule: VscodeApiSlice,
    masterKeyProvider: IMasterKeyProvider,
    secretsStore: SecretsFileStore,
  ) {
    this.workspaceProvider = workspaceProvider;
    this.vscode = vscodeModule;
    this.masterKeyProvider = masterKeyProvider;
    this.secretsStore = secretsStore;
  }

  // ---------------------------------------------------------------------------
  // Global settings — routed between fileSettings and VS Code configuration
  // ---------------------------------------------------------------------------

  readGlobal<T>(key: string): T | undefined {
    if (isFileBasedSettingKey(key)) {
      return this.workspaceProvider.fileSettings.get<T>(key);
    }
    return this.vscode.workspace.getConfiguration('ptah').get<T>(key);
  }

  async writeGlobal<T>(key: string, value: T): Promise<void> {
    if (isFileBasedSettingKey(key)) {
      await this.workspaceProvider.fileSettings.set(key, value);
      return;
    }
    await this.vscode.workspace
      .getConfiguration('ptah')
      .update(key, value, this.vscode.ConfigurationTarget.Global);
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
   * Subscribe to changes on a global setting key.
   *
   * For file-based keys: delegates to PtahFileSettingsManager.watch() (in-process,
   * fires on every successful write within this process).
   *
   * For VS Code config keys: listens on vscode.workspace.onDidChangeConfiguration
   * and reads the updated value when ptah.<key> changes.
   *
   * Returns a composite disposable that cleans up all subscriptions.
   */
  watchGlobal(key: string, cb: (value: unknown) => void): IDisposable {
    if (isFileBasedSettingKey(key)) {
      return this.workspaceProvider.fileSettings.watch(key, cb);
    }

    // VS Code configuration watcher
    const fullKey = `ptah.${key}`;
    const disposable = this.vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration(fullKey)) {
        const updated = this.vscode.workspace
          .getConfiguration('ptah')
          .get<unknown>(key);
        cb(updated);
      }
    });
    return { dispose: () => disposable.dispose() };
  }

  /**
   * Subscribe to changes on a secret key.
   * Phase 5: cross-process secret change notifications via vscode.SecretStorage.onDidChange.
   */
  watchSecret(_key: string, _cb: () => void): IDisposable {
    return {
      dispose: () => {
        /* Phase 5: vscode.SecretStorage.onDidChange integration */
      },
    };
  }

  // ---------------------------------------------------------------------------
  // Flush
  // ---------------------------------------------------------------------------

  /**
   * Flush both file-based settings and the secrets file synchronously.
   * VS Code's own configuration store handles its persistence internally.
   *
   * Uses the cached master key from the last async access. If no secrets
   * were accessed in this process, the secrets flush is skipped.
   */
  flushSync(): void {
    this.workspaceProvider.fileSettings.flushSync();
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
