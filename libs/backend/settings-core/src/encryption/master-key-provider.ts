/**
 * IMasterKeyProvider — port for retrieving the process master encryption key.
 *
 * Platform adapters implement this interface to provide the 32-byte AES-256
 * master key from their respective secure storage (vscode.SecretStorage,
 * Electron safeStorage, or OS keychain via keytar).
 *
 * The key is generated randomly on first call and stored in the platform's
 * secure storage. Subsequent calls return the cached / retrieved key.
 *
 * WP-4A: Master key provider port.
 */

export interface IMasterKeyProvider {
  /**
   * Returns the 32-byte AES-256 master key.
   * Generates and persists a new random key if one has not been stored yet.
   */
  getMasterKey(): Promise<Buffer>;
}
