/**
 * SecretEnvelope — AES-256-GCM encryption primitives for secrets at rest.
 *
 * Pure functions; no I/O. Every secret entry gets a fresh random 12-byte IV
 * and its own 16-byte GCM auth tag. The entry's logical key is bound to the
 * ciphertext as AAD so ciphertexts cannot be swapped between entries without
 * detection.
 */

import * as crypto from 'crypto';

/** On-disk representation of a single encrypted secret entry. */
export interface SecretEnvelope {
  /** Base64-encoded 12-byte random IV. */
  iv: string;
  /** Base64-encoded 16-byte GCM authentication tag. */
  tag: string;
  /** Base64-encoded ciphertext (length matches plaintext). */
  ciphertext: string;
}

/**
 * Encrypt a plaintext string into a SecretEnvelope.
 *
 * @param plaintext - UTF-8 string to encrypt.
 * @param masterKey - 32-byte AES-256 key buffer.
 * @param aadKey    - The entry's logical dot-notation key (e.g. "gateway.telegram.tokenCipher").
 *                    Bound as AAD so envelopes cannot be reused for a different key.
 */
export function encryptValue(
  plaintext: string,
  masterKey: Buffer,
  aadKey: string,
): SecretEnvelope {
  if (masterKey.length !== 32) {
    throw new Error(
      `encryptValue: masterKey must be 32 bytes, got ${masterKey.length}`,
    );
  }

  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', masterKey, iv);
  cipher.setAAD(Buffer.from(aadKey, 'utf-8'));

  const encrypted = Buffer.concat([
    cipher.update(Buffer.from(plaintext, 'utf-8')),
    cipher.final(),
  ]);

  const tag = cipher.getAuthTag();

  return {
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
    ciphertext: encrypted.toString('base64'),
  };
}

/**
 * Decrypt a SecretEnvelope back to the original plaintext string.
 *
 * @param envelope  - The encrypted envelope from disk.
 * @param masterKey - 32-byte AES-256 key buffer (must match the key used to encrypt).
 * @param aadKey    - The entry's logical key (must match the key used to encrypt).
 * @throws If authentication fails (wrong key, wrong AAD, or tampered data).
 */
export function decryptValue(
  envelope: SecretEnvelope,
  masterKey: Buffer,
  aadKey: string,
): string {
  if (masterKey.length !== 32) {
    throw new Error(
      `decryptValue: masterKey must be 32 bytes, got ${masterKey.length}`,
    );
  }

  const iv = Buffer.from(envelope.iv, 'base64');
  const tag = Buffer.from(envelope.tag, 'base64');
  const ciphertextBuf = Buffer.from(envelope.ciphertext, 'base64');

  const decipher = crypto.createDecipheriv('aes-256-gcm', masterKey, iv);
  decipher.setAAD(Buffer.from(aadKey, 'utf-8'));
  decipher.setAuthTag(tag);

  const decrypted = Buffer.concat([
    decipher.update(ciphertextBuf),
    decipher.final(),
  ]);

  return decrypted.toString('utf-8');
}
