/**
 * VscodeMasterKeyProvider — IMasterKeyProvider for the VS Code platform.
 *
 * Stores the 32-byte AES-256 master key in vscode.SecretStorage under the
 * key "ptah.masterKey" as a base64-encoded string. SecretStorage is backed
 * by the OS keychain (macOS Keychain, Windows Credential Manager, Linux
 * libsecret) so the master key is never stored in plaintext on disk.
 */

import * as crypto from 'crypto';
import type { IMasterKeyProvider } from '@ptah-extension/platform-core';
import type { IUserInteraction } from '@ptah-extension/platform-core';

const SECRET_STORAGE_KEY = 'ptah.masterKey';

const CORRUPT_KEY_MESSAGE =
  "Ptah's encrypted settings store could not be opened (master key is corrupted or unreadable). " +
  'A new key will be generated and any previously stored secrets will be lost. ' +
  'You may need to re-enter your API keys and provider credentials.';

/**
 * Minimal slice of vscode.SecretStorage required by this provider.
 * Typed structurally to avoid a hard vscode import at the top level,
 * preserving compile-time safety when the vscode runtime is absent.
 */
export interface VscodeSecretStorageSlice {
  get(key: string): Thenable<string | undefined>;
  store(key: string, value: string): Thenable<void>;
}

export class VscodeMasterKeyProvider implements IMasterKeyProvider {
  private readonly secretStorage: VscodeSecretStorageSlice;
  private cachedKey: Buffer | null = null;
  private pendingKey: Promise<Buffer> | null = null;

  /**
   * @param secretStorage - VS Code SecretStorage slice (injected for testability).
   * @param userInteraction - Optional IUserInteraction for surfacing key-corruption
   *   errors to the user. When absent, falls back to console.error.
   *   Production code passes this via registerVscodeSettings.
   */
  constructor(
    secretStorage: VscodeSecretStorageSlice,
    private readonly userInteraction?: IUserInteraction,
  ) {
    this.secretStorage = secretStorage;
  }

  async getMasterKey(): Promise<Buffer> {
    if (this.cachedKey) return this.cachedKey;
    if (this.pendingKey) return this.pendingKey;
    this.pendingKey = this.doGetMasterKey();
    try {
      const key = await this.pendingKey;
      this.cachedKey = key;
      return key;
    } finally {
      this.pendingKey = null;
    }
  }

  private async doGetMasterKey(): Promise<Buffer> {
    const stored = await this.secretStorage.get(SECRET_STORAGE_KEY);

    if (stored) {
      const keyBuf = Buffer.from(stored, 'base64');
      if (keyBuf.length === 32) {
        return keyBuf;
      }
      // Stored value is corrupt or wrong length — notify and regenerate.
      await this.notifyCorruption();
    }

    // Generate a new 32-byte random master key and persist it.
    const newKey = crypto.randomBytes(32);
    await this.secretStorage.store(
      SECRET_STORAGE_KEY,
      newKey.toString('base64'),
    );
    return newKey;
  }

  /**
   * Notify the user that the master key is corrupted/unreadable and a new
   * key will be generated, causing loss of any previously stored secrets.
   */
  private async notifyCorruption(): Promise<void> {
    if (this.userInteraction) {
      try {
        await this.userInteraction.showErrorMessage(CORRUPT_KEY_MESSAGE);
      } catch {
        // Notification failure must not block key regeneration.
        console.error('[ptah-vscode] ERROR:', CORRUPT_KEY_MESSAGE);
      }
    } else {
      // IUserInteraction not provided — log to console as fallback.
      // Production code always passes userInteraction via registerVscodeSettings.
      console.error('[ptah-vscode] ERROR:', CORRUPT_KEY_MESSAGE);
    }
  }
}
