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
 * Secret operations are stubs that throw an explicit error to mark the Phase 4
 * encryption boundary. When Phase 4 lands, replace these with vscode.SecretStorage
 * delegation.
 *
 * WP-2B: Platform adapter creation.
 */

import type { IDisposable } from '@ptah-extension/platform-core';
import { isFileBasedSettingKey } from '@ptah-extension/platform-core';
import type { VscodeWorkspaceProvider } from '../implementations/vscode-workspace-provider';
import type { ISettingsStore } from '@ptah-extension/settings-core';

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

  constructor(
    workspaceProvider: VscodeWorkspaceProvider,
    vscodeModule: VscodeApiSlice,
  ) {
    this.workspaceProvider = workspaceProvider;
    this.vscode = vscodeModule;
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
  // Secret storage — Phase 4 placeholder (vscode.SecretStorage)
  // ---------------------------------------------------------------------------

  readSecret(_key: string): Promise<string | undefined> {
    throw new Error(
      'VscodeSettingsAdapter.readSecret: Encryption not yet implemented — Phase 4',
    );
  }

  writeSecret(_key: string, _ciphertext: string): Promise<void> {
    throw new Error(
      'VscodeSettingsAdapter.writeSecret: Encryption not yet implemented — Phase 4',
    );
  }

  deleteSecret(_key: string): Promise<void> {
    throw new Error(
      'VscodeSettingsAdapter.deleteSecret: Encryption not yet implemented — Phase 4',
    );
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
   *
   * No-op for Phase 4 — secrets are not yet persisted via this adapter.
   * TODO (Phase 4): wire into vscode.SecretStorage.onDidChange.
   */
  watchSecret(_key: string, _cb: () => void): IDisposable {
    // Phase 4: vscode.SecretStorage.onDidChange integration — currently a no-op.
    return {
      dispose: () => {
        /* no-op until SecretStorage integration */
      },
    };
  }

  // ---------------------------------------------------------------------------
  // Flush
  // ---------------------------------------------------------------------------

  /**
   * Flush file-based settings to disk synchronously.
   * VS Code's own configuration store handles persistence internally.
   */
  flushSync(): void {
    this.workspaceProvider.fileSettings.flushSync();
  }
}
