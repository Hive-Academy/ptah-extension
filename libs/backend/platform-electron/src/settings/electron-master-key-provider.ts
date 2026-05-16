/**
 * ElectronMasterKeyProvider — IMasterKeyProvider for the Electron platform.
 *
 * Uses Electron's safeStorage API to wrap (encrypt) the 32-byte AES-256
 * master key. The wrapped bytes are stored in ~/.ptah/master-key-ref.json
 * with version + algorithm metadata.
 *
 * safeStorage encrypts with the OS keychain (macOS Keychain, Windows DPAPI,
 * Linux libsecret / plain-text fallback when keyring unavailable). This means
 * the master key bytes are never stored in plaintext on disk.
 *
 * Import is lazy (import('electron')) because the electron module is only
 * available at runtime inside the Electron main process. Importing it at
 * module load time breaks jest tests and VS Code shim environments.
 */

import { z } from 'zod';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as fsPromises from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import type { IMasterKeyProvider } from '@ptah-extension/platform-core';
import type { IUserInteraction } from '@ptah-extension/platform-core';

const KEY_REF_ALGORITHM = 'electron-safeStorage';
const KEY_REF_VERSION = 1;

const CORRUPT_KEY_MESSAGE =
  "Ptah's encrypted settings store could not be opened (master key is corrupted or unreadable). " +
  'A new key will be generated and any previously stored secrets will be lost. ' +
  'You may need to re-enter your API keys and provider credentials.';

// ---------------------------------------------------------------------------
// Zod schema for master-key-ref.json (Q2 decision)
// ---------------------------------------------------------------------------

/** Regex matching a non-empty base64 string (standard alphabet + padding). */
const base64Regex = /^[A-Za-z0-9+/]+=*$/;

const MasterKeyRefSchema = z.object({
  version: z.number(),
  algorithm: z.string(),
  /**
   * Base64-encoded bytes from safeStorage.encryptString(base64Key).
   * Must be a syntactically valid base64 string — value format is validated
   * here so we catch corrupt refs before attempting a decryptString call.
   */
  wrapped: z
    .string()
    .regex(base64Regex, 'wrapped must be a valid base64 string'),
});

type MasterKeyRef = z.infer<typeof MasterKeyRefSchema>;

/**
 * Minimal slice of the Electron safeStorage API for testability.
 * The real impl resolves this lazily from import('electron').
 */
export interface ElectronSafeStorageApi {
  isEncryptionAvailable(): boolean;
  encryptString(plaintext: string): Buffer;
  decryptString(encrypted: Buffer): string;
}

export class ElectronMasterKeyProvider implements IMasterKeyProvider {
  private readonly keyRefPath: string;
  private cachedKey: Buffer | null = null;
  /** In-flight Promise coalesces concurrent first-calls to prevent key divergence. */
  private pendingKey: Promise<Buffer> | null = null;

  /**
   * @param ptahDir - Directory that holds master-key-ref.json.
   *   Defaults to ~/.ptah.
   * @param userInteraction - Optional IUserInteraction port for surfacing
   *   key-corruption errors to the user. When absent, falls back to
   *   console.error (a TODO comment marks the injection point).
   */
  constructor(
    ptahDir?: string,
    private readonly userInteraction?: IUserInteraction,
  ) {
    const dir = ptahDir ?? path.join(os.homedir(), '.ptah');
    this.keyRefPath = path.join(dir, 'master-key-ref.json');
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
    const safeStorage = await this.loadSafeStorage();
    return this.loadOrCreateKey(safeStorage);
  }

  private async loadOrCreateKey(
    safeStorage: ElectronSafeStorageApi,
  ): Promise<Buffer> {
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error(
        'ElectronMasterKeyProvider: safeStorage encryption is unavailable on this system. ' +
          'On Linux this typically means no keyring daemon is running (gnome-keyring, kwallet, etc.). ' +
          'Encrypted secrets cannot be safely created without OS-level key wrapping.',
      );
    }

    // Try to read the existing key reference.
    let rawRef: string;
    try {
      rawRef = await fsPromises.readFile(this.keyRefPath, 'utf8');
    } catch (err: unknown) {
      if (isNodeError(err) && err.code === 'ENOENT') {
        return this.createAndStoreKey(safeStorage);
      }
      throw err;
    }

    // Parse JSON — corrupt JSON is treated as key-ref corruption.
    let parsedRef: unknown;
    try {
      parsedRef = JSON.parse(rawRef);
    } catch {
      await this.notifyCorruption('corrupt JSON in master-key-ref.json');
      return this.createAndStoreKey(safeStorage);
    }

    // Validate schema with Zod (Q2: also validates base64 format of wrapped).
    const parseResult = MasterKeyRefSchema.safeParse(parsedRef);
    if (!parseResult.success) {
      await this.notifyCorruption(
        `invalid master-key-ref.json schema: ${parseResult.error.message}`,
      );
      return this.createAndStoreKey(safeStorage);
    }

    const ref: MasterKeyRef = parseResult.data;
    const wrappedBuf = Buffer.from(ref.wrapped, 'base64');
    let base64Key: string;
    try {
      base64Key = safeStorage.decryptString(wrappedBuf);
    } catch {
      // Decrypt failed (e.g. OS keyring changed) — notify and regenerate.
      await this.notifyCorruption(
        'decryptString failed (OS keyring may have changed)',
      );
      return this.createAndStoreKey(safeStorage);
    }

    const keyBuf = Buffer.from(base64Key, 'base64');
    if (keyBuf.length !== 32) {
      // Stored key has wrong length — notify and regenerate.
      await this.notifyCorruption(
        `master key has wrong length ${keyBuf.length} (expected 32)`,
      );
      return this.createAndStoreKey(safeStorage);
    }

    return keyBuf;
  }

  private async createAndStoreKey(
    safeStorage: ElectronSafeStorageApi,
  ): Promise<Buffer> {
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error(
        'ElectronMasterKeyProvider: safeStorage encryption is unavailable on this system. ' +
          'On Linux this typically means no keyring daemon is running (gnome-keyring, kwallet, etc.). ' +
          'Encrypted secrets cannot be safely created without OS-level key wrapping.',
      );
    }

    const newKey = crypto.randomBytes(32);
    const base64Key = newKey.toString('base64');

    const wrappedBuf = safeStorage.encryptString(base64Key);
    const ref: MasterKeyRef = {
      version: KEY_REF_VERSION,
      algorithm: KEY_REF_ALGORITHM,
      wrapped: wrappedBuf.toString('base64'),
    };

    await this.writeKeyRefAtomic(ref);
    return newKey;
  }

  private async writeKeyRefAtomic(ref: MasterKeyRef): Promise<void> {
    const dir = path.dirname(this.keyRefPath);
    await fsPromises.mkdir(dir, { recursive: true });
    const tmpPath = this.keyRefPath + '.tmp';
    await fsPromises.writeFile(tmpPath, JSON.stringify(ref, null, 2), 'utf8');
    await fsPromises.rename(tmpPath, this.keyRefPath);
  }

  private async loadSafeStorage(): Promise<ElectronSafeStorageApi> {
    // Lazy import to avoid crashing in non-Electron environments.
    try {
      const electron = await import('electron');
      const { safeStorage } = electron;
      return safeStorage as unknown as ElectronSafeStorageApi;
    } catch {
      throw new Error(
        'ElectronMasterKeyProvider: failed to import electron safeStorage — ' +
          'this provider must only be used in the Electron main process.',
      );
    }
  }

  /**
   * Notify the user that the master key is corrupted/unreadable.
   * Logs the detail at error level; shows a user-actionable message via
   * IUserInteraction if available.
   */
  private async notifyCorruption(detail: string): Promise<void> {
    if (this.userInteraction) {
      try {
        await this.userInteraction.showErrorMessage(CORRUPT_KEY_MESSAGE);
      } catch {
        // Notification failure must not block key regeneration.
        console.error(
          `[ptah-electron] ERROR: master key corruption (${detail}). ${CORRUPT_KEY_MESSAGE}`,
        );
      }
    } else {
      // IUserInteraction not provided — log to console as fallback.
      // Production code always passes userInteraction via registerElectronSettings.
      console.error(
        `[ptah-electron] ERROR: master key corruption (${detail}). ${CORRUPT_KEY_MESSAGE}`,
      );
    }
  }
}

// ---- helpers ----------------------------------------------------------------

function isNodeError(err: unknown): err is NodeJS.ErrnoException {
  return (
    typeof err === 'object' && err !== null && 'code' in err && 'message' in err
  );
}

/** Synchronous version for process-exit flush path. */
export function writeKeyRefSync(keyRefPath: string, ref: MasterKeyRef): void {
  const dir = path.dirname(keyRefPath);
  fs.mkdirSync(dir, { recursive: true });
  const tmpPath = keyRefPath + '.flush.tmp';
  fs.writeFileSync(tmpPath, JSON.stringify(ref, null, 2), 'utf8');
  fs.renameSync(tmpPath, keyRefPath);
}
