/**
 * ITokenVault — abstract encrypt/decrypt interface for storing platform
 * bot tokens at rest as base64 ciphertext blobs in `~/.ptah/settings.json`.
 *
 * The Electron implementation (`ElectronSafeStorageVault`) uses
 * `safeStorage.encryptString` when available, with an AES-256-GCM
 * fallback for Linux without keyring (architecture §7.4 + §11 default 6).
 *
 * Decrypt failures return `null` so callers can surface a one-time
 * "please re-enter your token via gateway:setToken" notification rather
 * than crashing.
 */
export interface ITokenVault {
  /** True when the platform offers real (OS-keychain backed) encryption. */
  isEncryptionAvailable(): boolean;
  /** Encrypt plaintext → base64 ciphertext (string-safe for JSON). */
  encrypt(plaintext: string): string;
  /** Decrypt base64 ciphertext → plaintext, or `null` on failure. */
  decrypt(ciphertext: string): string | null;
}
