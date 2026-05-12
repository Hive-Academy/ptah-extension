/**
 * VscodeMasterKeyProvider — IMasterKeyProvider for the VS Code platform.
 *
 * Stores the 32-byte AES-256 master key in vscode.SecretStorage under the
 * key "ptah.masterKey" as a base64-encoded string. SecretStorage is backed
 * by the OS keychain (macOS Keychain, Windows Credential Manager, Linux
 * libsecret) so the master key is never stored in plaintext on disk.
 *
 * WP-4A: VS Code master key provider.
 */

import * as crypto from 'crypto';
import type { IMasterKeyProvider } from '@ptah-extension/settings-core';

const SECRET_STORAGE_KEY = 'ptah.masterKey';

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

  constructor(secretStorage: VscodeSecretStorageSlice) {
    this.secretStorage = secretStorage;
  }

  async getMasterKey(): Promise<Buffer> {
    const stored = await this.secretStorage.get(SECRET_STORAGE_KEY);

    if (stored) {
      const keyBuf = Buffer.from(stored, 'base64');
      if (keyBuf.length === 32) {
        return keyBuf;
      }
      // Stored value is corrupt or wrong length — generate a fresh key.
      // Existing secrets encrypted with the old key will become unreadable,
      // but that is preferable to using a truncated/expanded key silently.
    }

    // Generate a new 32-byte random master key and persist it.
    const newKey = crypto.randomBytes(32);
    await this.secretStorage.store(
      SECRET_STORAGE_KEY,
      newKey.toString('base64'),
    );
    return newKey;
  }
}
