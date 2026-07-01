/**
 * machine-seed-key — stable per-machine AES-256 key derivation for the
 * Electron platform, plus AES-256-GCM encrypt/decrypt helpers.
 *
 * PURPOSE
 * -------
 * Electron's `safeStorage` (OS keychain / Windows DPAPI) is the PRIMARY way
 * Ptah wraps its master key. But that wrap is fragile: after a Windows
 * reinstall the DPAPI context can change and `safeStorage.decryptString`
 * fails, which previously forced a master-key regeneration and silently
 * dropped every encrypted secret (e.g. the Discord bot token).
 *
 * This module provides a SECONDARY, recovery-only key: a stable 32-byte key
 * derived via HMAC-SHA256 over a per-machine seed. The seed resolves from
 * `/etc/machine-id` -> `/var/lib/dbus/machine-id` -> a UUID we generate once
 * and persist to `~/.ptah/.machine-uuid`. On Windows only the last path is
 * hit; `~/.ptah/.machine-uuid` survives an app reinstall, so a master key
 * ALSO wrapped under this key can be recovered.
 *
 * This mirrors the proven derivation in
 * `apps/ptah-electron/src/services/platform/electron-safe-storage-vault.ts`
 * EXACTLY (same MACHINE_ID_PATHS, same `.machine-uuid` fallback, same
 * HMAC-SHA256 construction) but with a DISTINCT info string so the two
 * derived keys are cryptographically independent — this key wraps the
 * master key; the vault key wraps gateway tokens. They must never collide.
 *
 * Envelope format (identical to the vault's fallback format):
 *   `gcm:<base64(iv)>:<base64(authTag)>:<base64(ciphertext)>`
 * with a 12-byte IV and a 16-byte GCM auth tag.
 */

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

/** Envelope prefix for the AES-256-GCM machine-seed format. */
export const MACHINE_WRAP_PREFIX = 'gcm:';

/**
 * Info string mixed into the HMAC. DISTINCT from the messaging-gateway
 * vault's `'ptah-messaging-gateway-vault-v1'` — different purpose, different
 * derived key. Do NOT change this value: existing `machineWrapped` envelopes
 * would stop decrypting.
 */
const KEY_INFO = 'ptah-master-key-machine-wrap-v1';

/** Ordered candidate paths for a stable Linux machine id. */
const MACHINE_ID_PATHS = [
  '/etc/machine-id',
  '/var/lib/dbus/machine-id',
] as const;

/** Name of the last-resort UUID file kept under the ptah home dir. */
const MACHINE_UUID_FILENAME = '.machine-uuid';

/**
 * Derive the stable 32-byte machine-seed key.
 *
 * @param ptahDir - Directory that holds `.machine-uuid`. Defaults to
 *   `~/.ptah`. Injectable so tests can point it at a temp dir (mirrors the
 *   `ptahDir` arg on ElectronMasterKeyProvider).
 */
export function deriveMachineSeedKey(ptahDir?: string): Buffer {
  const seed = resolveMachineSeed(ptahDir);
  return crypto.createHmac('sha256', seed).update(KEY_INFO).digest();
}

/**
 * Encrypt a UTF-8 string under the machine-seed key using AES-256-GCM.
 * Returns the `gcm:<iv>:<tag>:<ciphertext>` envelope.
 */
export function encryptWithMachineSeed(
  plaintext: string,
  ptahDir?: string,
): string {
  const key = deriveMachineSeedKey(ptahDir);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();
  return [
    MACHINE_WRAP_PREFIX.replace(':', ''),
    iv.toString('base64'),
    authTag.toString('base64'),
    encrypted.toString('base64'),
  ].join(':');
}

/**
 * Decrypt a `gcm:...` envelope produced by {@link encryptWithMachineSeed}.
 * Returns the plaintext, or `null` if the input is malformed or decryption
 * fails (wrong key, tampered ciphertext, bad auth tag).
 */
export function decryptWithMachineSeed(
  ciphertext: string,
  ptahDir?: string,
): string | null {
  if (!ciphertext || !ciphertext.startsWith(MACHINE_WRAP_PREFIX)) return null;
  const parts = ciphertext.split(':');
  if (parts.length !== 4) return null;
  const [, iv64, tag64, ct64] = parts;
  try {
    const iv = Buffer.from(iv64, 'base64');
    const tag = Buffer.from(tag64, 'base64');
    const ct = Buffer.from(ct64, 'base64');
    if (iv.length !== 12 || tag.length !== 16) return null;
    const key = deriveMachineSeedKey(ptahDir);
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    const plain = Buffer.concat([decipher.update(ct), decipher.final()]);
    return plain.toString('utf8');
  } catch (error: unknown) {
    // Any decrypt failure (bad key after real corruption, tampering) is a
    // recovery miss, not a crash — the caller decides what to do next.
    void error;
    return null;
  }
}

/**
 * Resolve the stable per-machine seed bytes.
 *
 * Order: `/etc/machine-id` -> `/var/lib/dbus/machine-id` ->
 * `<ptahDir>/.machine-uuid` (auto-created once). On Windows only the last
 * path is reachable, and it survives an app reinstall.
 */
function resolveMachineSeed(ptahDir?: string): Buffer {
  for (const candidate of MACHINE_ID_PATHS) {
    try {
      const v = fs.readFileSync(candidate, 'utf8').trim();
      if (v.length > 0) return Buffer.from(v, 'utf8');
    } catch (error: unknown) {
      // Missing/unreadable on this OS (always the case on Windows) — try the
      // next candidate rather than failing.
      void error;
    }
  }
  const uuidFile = path.join(
    ptahDir ?? path.join(os.homedir(), '.ptah'),
    MACHINE_UUID_FILENAME,
  );
  try {
    if (fs.existsSync(uuidFile)) {
      const v = fs.readFileSync(uuidFile, 'utf8').trim();
      if (v.length > 0) return Buffer.from(v, 'utf8');
    }
    const fresh = crypto.randomUUID();
    fs.mkdirSync(path.dirname(uuidFile), { recursive: true });
    fs.writeFileSync(uuidFile, fresh, { mode: 0o600 });
    return Buffer.from(fresh, 'utf8');
  } catch (error: unknown) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(
      'machine-seed-key: cannot derive a stable machine seed. ' +
        '/etc/machine-id is unreadable and .machine-uuid could not be created. ' +
        `Ensure the ptah home directory is writable. (${detail})`,
    );
  }
}
