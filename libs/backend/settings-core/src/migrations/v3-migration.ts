/**
 * V3 Migration — gateway token ciphers: settings.json → secrets.enc.json.
 *
 * Moves the four gateway token cipher keys from the plaintext settings file
 * into the AES-256-GCM encrypted secrets envelope:
 *
 *   gateway.telegram.tokenCipher
 *   gateway.discord.tokenCipher
 *   gateway.slack.botTokenCipher
 *   gateway.slack.appTokenCipher
 *
 * IMPORTANT — Two-layer encryption:
 *
 * The values in settings.json are already application-layer-encrypted by the
 * gateway's ITokenVault (Vault.encrypt()). The v3 migration does NOT decrypt
 * them — it cannot, because ITokenVault is not available at the settings layer.
 *
 * Instead, the existing Vault cipher string is treated as "plaintext" from
 * the perspective of the new envelope layer. The migration encrypts the Vault
 * cipher with the AES-256-GCM envelope.
 *
 * At runtime, reading a gateway token goes through two layers:
 *   1. SecretsFileStore.read() → decrypts envelope → returns Vault cipher string.
 *   2. ITokenVault.decrypt()   → decrypts Vault cipher  → returns plaintext token.
 *
 * This is intentional defense-in-depth: even if secrets.enc.json is exfiltrated,
 * an attacker needs both the platform master key AND the Vault key to recover
 * the raw bot token.
 *
 * WP-4A: v3 migration.
 */

import * as fsPromises from 'fs/promises';
import * as path from 'path';
import type { IMasterKeyProvider } from '../encryption/master-key-provider';
import { SecretsFileStore } from '../encryption/secrets-file-store';

/** Keys to migrate from settings.json into secrets.enc.json. */
const GATEWAY_SECRET_KEYS = [
  'gateway.telegram.tokenCipher',
  'gateway.discord.tokenCipher',
  'gateway.slack.botTokenCipher',
  'gateway.slack.appTokenCipher',
] as const;

export async function runV3Migration(
  ptahDir: string,
  masterKeyProvider: IMasterKeyProvider,
): Promise<void> {
  const settingsPath = path.join(ptahDir, 'settings.json');

  // 1. Read settings.json.
  let raw: string;
  try {
    raw = await fsPromises.readFile(settingsPath, 'utf8');
  } catch (err: unknown) {
    if (isNodeError(err) && err.code === 'ENOENT') {
      // No settings file yet — nothing to migrate.
      return;
    }
    throw err;
  }

  let data: Record<string, unknown>;
  try {
    data = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    // Corrupt settings file — skip migration.
    return;
  }

  // 2. Collect gateway cipher values (nested JSON format, e.g. { gateway: { telegram: { tokenCipher: '...' } } }).
  const toMigrate: Array<{ key: string; value: string }> = [];
  for (const key of GATEWAY_SECRET_KEYS) {
    const value = readNestedKey(data, key);
    if (typeof value === 'string' && value.length > 0) {
      toMigrate.push({ key, value });
    }
  }

  if (toMigrate.length === 0) {
    // Nothing to move — migration is already complete or no tokens were set.
    return;
  }

  // 3. Encrypt and write each value into secrets.enc.json.
  //    We treat the existing Vault cipher string as the "plaintext" for the
  //    envelope layer (see module doc for the two-layer encryption rationale).
  const masterKey = await masterKeyProvider.getMasterKey();
  const secretsStore = new SecretsFileStore(ptahDir);

  for (const { key, value } of toMigrate) {
    await secretsStore.write(key, value, masterKey);
  }

  // 4. Delete the migrated keys from settings.json and write atomically.
  for (const { key } of toMigrate) {
    deleteNestedKey(data, key);
  }

  const tmpPath = path.join(ptahDir, 'settings.v3.tmp');
  await fsPromises.writeFile(tmpPath, JSON.stringify(data, null, 2), 'utf8');
  await fsPromises.rename(tmpPath, settingsPath);
}

// ---- helpers ----------------------------------------------------------------

/**
 * Read a dot-notation key from a nested JSON object.
 * E.g. readNestedKey(data, 'gateway.telegram.tokenCipher') reads
 * data.gateway.telegram.tokenCipher.
 */
function readNestedKey(obj: Record<string, unknown>, dotKey: string): unknown {
  const parts = dotKey.split('.');
  let current: unknown = obj;
  for (const part of parts) {
    if (!isObject(current)) return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

/**
 * Delete a dot-notation key from a nested JSON object.
 * Leaves intermediate objects in place (no pruning of empty objects).
 */
function deleteNestedKey(obj: Record<string, unknown>, dotKey: string): void {
  const parts = dotKey.split('.');
  let current: unknown = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    if (!isObject(current)) return;
    current = (current as Record<string, unknown>)[parts[i]];
  }
  if (isObject(current)) {
    delete (current as Record<string, unknown>)[parts[parts.length - 1]];
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNodeError(err: unknown): err is NodeJS.ErrnoException {
  return (
    typeof err === 'object' && err !== null && 'code' in err && 'message' in err
  );
}
