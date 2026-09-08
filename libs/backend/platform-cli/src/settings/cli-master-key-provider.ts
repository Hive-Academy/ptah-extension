/**
 * CliMasterKeyProvider — IMasterKeyProvider for the headless CLI platform.
 *
 * Attempts to use `keytar` (service "ptah", account "masterKey") to store the
 * master key in the OS keychain. If keytar is unavailable (not installed,
 * not built, or no keyring daemon on Linux), falls back to a deterministic
 * key derived via HKDF-SHA256 from `username:hostname`.
 *
 * Fallback derivation is weaker than a random key in a real keychain because
 * an attacker with filesystem access to secrets.enc.json who also knows the
 * username and hostname can derive the key. A one-time WARN is logged so the
 * operator is informed.
 *
 * Fallback design rationale (from architect's spec):
 *   input  = os.userInfo().username + ':' + os.hostname()
 *   salt   = Buffer.from('ptah-cli-fallback-salt-v1', 'utf-8'), padded/truncated to 16 bytes
 *   info   = 'ptah:masterKey:v1'
 *   length = 32 bytes
 *   hash   = sha256
 *
 * This derivation is stable across process restarts on the same machine so
 * secrets encrypted with the fallback key remain readable.
 */

import * as crypto from 'crypto';
import * as os from 'os';
import type { IMasterKeyProvider } from '@ptah-extension/platform-core';
import type { IUserInteraction } from '@ptah-extension/platform-core';

const KEYTAR_SERVICE = 'ptah';
const KEYTAR_ACCOUNT = 'masterKey';

const FALLBACK_SALT_SOURCE = 'ptah-cli-fallback-salt-v1';
const FALLBACK_INFO = 'ptah:masterKey:v1';

const CORRUPT_KEY_MESSAGE =
  "Ptah's encrypted settings store could not be opened (master key is corrupted or unreadable). " +
  'A new key will be generated and any previously stored secrets will be lost. ' +
  'You may need to re-enter your API keys and provider credentials.';

/** Minimal keytar API surface used by this provider. */
interface KeytarApi {
  getPassword(service: string, account: string): Promise<string | null>;
  setPassword(
    service: string,
    account: string,
    password: string,
  ): Promise<void>;
}

export class CliMasterKeyProvider implements IMasterKeyProvider {
  private cachedKey: Buffer | null = null;
  private pendingKey: Promise<Buffer> | null = null;
  /**
   * If true, the WARN about reduced protection has already been emitted.
   * We track this statically so tests that construct multiple instances
   * don't spam the console.
   */
  private static fallbackWarnEmitted = false;

  /**
   * Optional IUserInteraction for surfacing key-corruption errors to the user.
   * When not provided, falls back to console.error.
   */
  constructor(private readonly userInteraction?: IUserInteraction) {}

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
    const keytar = await tryLoadKeytar();
    if (keytar) {
      return this.getOrCreateKeytarKey(keytar);
    }
    if (!CliMasterKeyProvider.fallbackWarnEmitted) {
      CliMasterKeyProvider.fallbackWarnEmitted = true;
      console.warn(
        '[ptah-cli] WARN: OS keyring (keytar) is unavailable. ' +
          'Master key is derived from username + hostname (reduced protection). ' +
          'Install libsecret-1-dev (Linux) or run in macOS/Windows for full keychain protection.',
      );
    }

    return deriveFallbackKey();
  }

  private async getOrCreateKeytarKey(keytar: KeytarApi): Promise<Buffer> {
    const stored = await keytar.getPassword(KEYTAR_SERVICE, KEYTAR_ACCOUNT);

    if (stored) {
      const keyBuf = Buffer.from(stored, 'base64');
      if (keyBuf.length === 32) {
        return keyBuf;
      }
      await this.notifyCorruption();
    }
    const newKey = crypto.randomBytes(32);
    await keytar.setPassword(
      KEYTAR_SERVICE,
      KEYTAR_ACCOUNT,
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
        console.error('[ptah-cli] ERROR:', CORRUPT_KEY_MESSAGE);
      }
    } else {
      console.error('[ptah-cli] ERROR:', CORRUPT_KEY_MESSAGE);
    }
  }
}

/**
 * Attempt to require keytar at runtime. Returns null if it is not installed
 * or fails to load (common on headless Linux without a keyring daemon).
 *
 * ## Why this swallow is not a defect (TASK_2026_383, task 2.3)
 *
 * `keytar` is an OPTIONAL native dependency and its absence is the expected
 * state on a large share of the CLI's hosts — a container, a CI runner, any
 * headless Linux box with no D-Bus keyring daemon. The caller's fallback is
 * `deriveFallbackKey()`, a real HKDF-derived key, not a stub: the capability
 * that degrades is OS-keychain storage, not encryption. Deleting the fallback
 * would make the CLI unusable everywhere keytar cannot load.
 *
 * It is classified rather than reported because `platform-cli` may import only
 * `platform-core` (per this lib's CLAUDE.md, "Never import platform-vscode or
 * platform-electron"; its one internal dependency is `platform-core`), and
 * `DegradationReporter` lives in `vscode-core`. Reaching for it here would add
 * an adapter → infrastructure edge to satisfy a diagnostic, which is a worse
 * trade than the suppression. If a CLI-side report is ever wanted, the seam is
 * the CALLER — which already knows whether it fell back — not this probe.
 */
async function tryLoadKeytar(): Promise<KeytarApi | null> {
  try {
    // degradation-audit: optional-capability — keytar is an optional native
    // module; absent on headless hosts with no OS keyring, and the caller falls
    // back to an HKDF-derived key.
    const kt = await import('keytar').catch(() => null);
    if (!kt) return null;
    if (
      typeof kt.getPassword !== 'function' ||
      typeof kt.setPassword !== 'function'
    ) {
      return null;
    }
    return kt as unknown as KeytarApi;
  } catch {
    // degradation-audit: optional-capability — a synchronous module-resolution
    // failure is the same absent-keytar case as the rejection above; same HKDF
    // fallback, same reason it must not become a throw.
    return null;
  }
}

/**
 * Derive a 32-byte key deterministically from the current username and hostname.
 *
 * Uses HKDF-SHA256 per the architect's spec:
 *   input  = utf8(username + ':' + hostname)
 *   salt   = 'ptah-cli-fallback-salt-v1' truncated/padded to 16 bytes
 *   info   = 'ptah:masterKey:v1'
 *   length = 32
 */
function deriveFallbackKey(): Buffer {
  const username = os.userInfo().username;
  const hostname = os.hostname();
  const inputMaterial = Buffer.from(`${username}:${hostname}`, 'utf-8');
  const saltSource = Buffer.from(FALLBACK_SALT_SOURCE, 'utf-8');
  const salt = Buffer.alloc(16, 0);
  saltSource.copy(salt, 0, 0, Math.min(saltSource.length, 16));

  const info = Buffer.from(FALLBACK_INFO, 'utf-8');

  const derived = crypto.hkdfSync('sha256', inputMaterial, salt, info, 32);
  return Buffer.from(derived);
}
