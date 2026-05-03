/**
 * ElectronSafeStorageVault — `ITokenVault` implementation for the Electron
 * host (TASK_2026_HERMES Track 4 — messaging gateway).
 *
 * Strategy (architecture §7.4):
 *   1. If `safeStorage.isEncryptionAvailable()` is true (macOS Keychain,
 *      Windows DPAPI, gnome-libsecret on Linux GNOME), use it. The blob is
 *      a `Buffer`; we base64-encode it so the cipher round-trips through
 *      `~/.ptah/settings.json` as a plain JSON string.
 *   2. Otherwise — Linux without a keyring, headless CI — fall back to
 *      AES-256-GCM with a key derived from a stable per-machine secret:
 *        - Linux: `/etc/machine-id` → `/var/lib/dbus/machine-id` → a UUID
 *          we generate once and persist to `~/.ptah/.machine-uuid`.
 *        - Windows / macOS: rarely hit (safeStorage is always available
 *          there) but the same UUID file path is used as a last resort.
 *      Format: `gcm:<base64(iv)>:<base64(authTag)>:<base64(ciphertext)>`.
 *
 * `decrypt()` accepts EITHER cipher format and returns `null` on failure
 * (architecture §9.4 — surface decrypt-failure as a one-time RPC error).
 */

import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { safeStorage } from 'electron';
import type { ITokenVault } from '@ptah-extension/messaging-gateway';

const FALLBACK_PREFIX = 'gcm:';
const MACHINE_ID_PATHS = [
  '/etc/machine-id',
  '/var/lib/dbus/machine-id',
] as const;
const FALLBACK_UUID_FILE = path.join(os.homedir(), '.ptah', '.machine-uuid');
const KEY_INFO = 'ptah-messaging-gateway-vault-v1';

export class ElectronSafeStorageVault implements ITokenVault {
  /** Cached fallback key — derived once per process. */
  private fallbackKey: Buffer | null = null;

  isEncryptionAvailable(): boolean {
    try {
      return safeStorage.isEncryptionAvailable();
    } catch {
      return false;
    }
  }

  encrypt(plaintext: string): string {
    if (this.isEncryptionAvailable()) {
      const buf = safeStorage.encryptString(plaintext);
      return buf.toString('base64');
    }
    // Fallback: AES-256-GCM.
    const key = this.getFallbackKey();
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const encrypted = Buffer.concat([
      cipher.update(plaintext, 'utf8'),
      cipher.final(),
    ]);
    const authTag = cipher.getAuthTag();
    return [
      FALLBACK_PREFIX.replace(':', ''),
      iv.toString('base64'),
      authTag.toString('base64'),
      encrypted.toString('base64'),
    ].join(':');
  }

  decrypt(ciphertext: string): string | null {
    if (!ciphertext) return null;
    try {
      if (ciphertext.startsWith(FALLBACK_PREFIX)) {
        return this.decryptFallback(ciphertext);
      }
      // safeStorage path — base64 buffer.
      if (!this.isEncryptionAvailable()) {
        // Caller stored under safeStorage on a different machine and we
        // can't read it back. Surface as decrypt failure.
        return null;
      }
      const buf = Buffer.from(ciphertext, 'base64');
      return safeStorage.decryptString(buf);
    } catch {
      return null;
    }
  }

  // ---------------------------------------------------------------------------
  // Fallback AES-GCM helpers.
  // ---------------------------------------------------------------------------

  private decryptFallback(blob: string): string | null {
    // Format: gcm:<iv64>:<tag64>:<ct64>
    const parts = blob.split(':');
    if (parts.length !== 4) return null;
    const [, iv64, tag64, ct64] = parts;
    try {
      const iv = Buffer.from(iv64, 'base64');
      const tag = Buffer.from(tag64, 'base64');
      const ct = Buffer.from(ct64, 'base64');
      if (iv.length !== 12 || tag.length !== 16) return null;
      const key = this.getFallbackKey();
      const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
      decipher.setAuthTag(tag);
      const plain = Buffer.concat([decipher.update(ct), decipher.final()]);
      return plain.toString('utf8');
    } catch {
      return null;
    }
  }

  private getFallbackKey(): Buffer {
    if (this.fallbackKey) return this.fallbackKey;
    const seed = this.resolveMachineSeed();
    // HKDF-style: HMAC-SHA-256(seed, info) gives a 32-byte key.
    this.fallbackKey = crypto
      .createHmac('sha256', seed)
      .update(KEY_INFO)
      .digest();
    return this.fallbackKey;
  }

  private resolveMachineSeed(): Buffer {
    // 1) Linux: try `/etc/machine-id`, then `/var/lib/dbus/machine-id`.
    for (const candidate of MACHINE_ID_PATHS) {
      try {
        const v = fs.readFileSync(candidate, 'utf8').trim();
        if (v.length > 0) return Buffer.from(v, 'utf8');
      } catch {
        // not readable — fall through.
      }
    }
    // 2) Persist a UUID to ~/.ptah/.machine-uuid (created on first call).
    try {
      if (fs.existsSync(FALLBACK_UUID_FILE)) {
        const v = fs.readFileSync(FALLBACK_UUID_FILE, 'utf8').trim();
        if (v.length > 0) return Buffer.from(v, 'utf8');
      }
      const fresh = crypto.randomUUID();
      fs.mkdirSync(path.dirname(FALLBACK_UUID_FILE), { recursive: true });
      fs.writeFileSync(FALLBACK_UUID_FILE, fresh, { mode: 0o600 });
      return Buffer.from(fresh, 'utf8');
    } catch {
      // SECURITY: do NOT fall back to hostname+username — both values are
      // world-readable on multi-user systems, making the derived AES-GCM key
      // publicly computable. Throw so the failure surfaces clearly rather
      // than silently encrypting with a predictable key. On a healthy system
      // this path is unreachable: /etc/machine-id exists on all modern Linux
      // distros, and ~/.ptah/ is always writable (we create it on first run).
      throw new Error(
        'ElectronSafeStorageVault: cannot derive a stable machine seed. ' +
          '/etc/machine-id is unreadable and ~/.ptah/.machine-uuid could not be created. ' +
          'Ensure the ~/.ptah directory is writable.',
      );
    }
  }
}
