/**
 * FileSettingsStore — ISettingsStore adapter for CLI.
 *
 * Delegates global read/write operations to PtahFileSettingsManager so that
 * the settings-core repositories can read and write settings without knowing
 * about the underlying platform file format.
 *
 * This file is intentionally a copy of
 * libs/backend/platform-electron/src/settings/file-settings-store.ts.
 * Per the project's hexagonal rules, adapters in different platforms are
 * mutually exclusive copies — each platform lib pays the cost of duplication
 * to preserve isolation. Do NOT import or re-export the Electron class here.
 *
 * Secret operations are stubs that throw an explicit error to mark the Phase 4
 * encryption boundary. Do NOT convert these to no-ops — a silent no-op would
 * silently lose secret writes.
 *
 * WP-2B: Platform adapter creation.
 */

import type { IDisposable } from '@ptah-extension/platform-core';
import type { PtahFileSettingsManager } from '@ptah-extension/platform-core';
import type { ISettingsStore } from '@ptah-extension/settings-core';

export class FileSettingsStore implements ISettingsStore {
  private readonly fileSettings: PtahFileSettingsManager;

  constructor(fileSettings: PtahFileSettingsManager) {
    this.fileSettings = fileSettings;
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
  // Secret storage — Phase 4 placeholder
  // ---------------------------------------------------------------------------

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  readSecret(_key: string): Promise<string | undefined> {
    throw new Error(
      'FileSettingsStore.readSecret: Encryption not yet implemented — Phase 4',
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  writeSecret(_key: string, _ciphertext: string): Promise<void> {
    throw new Error(
      'FileSettingsStore.writeSecret: Encryption not yet implemented — Phase 4',
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  deleteSecret(_key: string): Promise<void> {
    throw new Error(
      'FileSettingsStore.deleteSecret: Encryption not yet implemented — Phase 4',
    );
  }

  // ---------------------------------------------------------------------------
  // Watchers
  // ---------------------------------------------------------------------------

  /**
   * Subscribe to in-process changes for a global setting key.
   *
   * Delegates to PtahFileSettingsManager.watch() which fires after every
   * successful in-process write. Cross-process reactivity (fs.watch on
   * settings.json shared between CLI and other processes) is Phase 5.
   */
  watchGlobal(key: string, cb: (value: unknown) => void): IDisposable {
    return this.fileSettings.watch(key, cb);
  }

  /**
   * Subscribe to changes on a secret key.
   *
   * No-op for Phase 4 — secrets are not yet persisted via this adapter.
   * TODO (Phase 5): wire into platform secret-storage change notifications.
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  watchSecret(_key: string, _cb: () => void): IDisposable {
    // Phase 5: cross-process secret change notifications.
    // eslint-disable-next-line @typescript-eslint/no-empty-function
    return { dispose: () => {} };
  }

  // ---------------------------------------------------------------------------
  // Flush
  // ---------------------------------------------------------------------------

  flushSync(): void {
    this.fileSettings.flushSync();
  }
}
