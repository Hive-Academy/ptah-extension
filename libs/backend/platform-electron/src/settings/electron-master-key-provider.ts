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
import {
  encryptWithMachineSeed,
  decryptWithMachineSeed,
} from './machine-seed-key';

const KEY_REF_ALGORITHM = 'electron-safeStorage';
const KEY_REF_VERSION = 1;

const CORRUPT_KEY_MESSAGE =
  "Ptah's encrypted settings store could not be opened (master key is corrupted or unreadable). " +
  'A new key will be generated and any previously stored secrets will be lost. ' +
  'You may need to re-enter your API keys and provider credentials.';

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
  /**
   * OPTIONAL recovery wrap: the SAME base64 master key encrypted under the
   * stable per-machine seed key (AES-256-GCM, `gcm:<iv>:<tag>:<ct>`).
   * Absent on older installs; backfilled on next successful read. Lets the
   * master key survive an OS-keychain change (e.g. Windows reinstall) that
   * breaks `wrapped`, instead of silently regenerating and dropping secrets.
   */
  machineWrapped: z.string().optional(),
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
  /** Directory holding master-key-ref.json AND the machine-seed .machine-uuid. */
  private readonly ptahDir: string;
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
    this.ptahDir = dir;
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
    let rawRef: string;
    try {
      rawRef = await fsPromises.readFile(this.keyRefPath, 'utf8');
    } catch (err: unknown) {
      if (isNodeError(err) && err.code === 'ENOENT') {
        return this.createAndStoreKey(safeStorage);
      }
      throw err;
    }
    let parsedRef: unknown;
    try {
      parsedRef = JSON.parse(rawRef);
    } catch {
      await this.notifyCorruption('corrupt JSON in master-key-ref.json');
      return this.createAndStoreKey(safeStorage);
    }
    const parseResult = MasterKeyRefSchema.safeParse(parsedRef);
    if (!parseResult.success) {
      await this.notifyCorruption(
        `invalid master-key-ref.json schema: ${parseResult.error.message}`,
      );
      return this.createAndStoreKey(safeStorage);
    }

    const ref: MasterKeyRef = parseResult.data;

    // -----------------------------------------------------------------
    // Recovery step 1: keychain (safeStorage) — the fast, primary path.
    // -----------------------------------------------------------------
    const keychainKey = this.tryDecryptKeychain(safeStorage, ref.wrapped);
    if (keychainKey) {
      // Older installs have no machineWrapped. Backfill it now (best-effort)
      // so a FUTURE OS-keychain change (e.g. Windows reinstall) is survivable.
      if (!ref.machineWrapped) {
        await this.backfillMachineWrap(ref, keychainKey);
      }
      return keychainKey;
    }

    // -----------------------------------------------------------------
    // Recovery step 2: machine-seed fallback. This is what saves the token
    // after a Windows reinstall — the master key is recovered WITHOUT
    // regenerating, so secrets.enc.json stays decryptable.
    // -----------------------------------------------------------------
    if (ref.machineWrapped) {
      const recovered = this.tryDecryptMachineWrap(ref.machineWrapped);
      if (recovered) {
        // Re-establish the keychain wrap for next boot (best-effort). Only
        // possible when the keychain is actually available to encrypt.
        await this.restoreKeychainWrap(safeStorage, ref, recovered);
        return recovered;
      }
    }

    // -----------------------------------------------------------------
    // Recovery step 3: both wraps absent or unrecoverable — true loss.
    // Regenerate (unchanged legacy behavior).
    // -----------------------------------------------------------------
    await this.notifyCorruption(
      'master key unreadable via keychain and machine-seed fallback ' +
        '(OS keyring changed and no valid machineWrapped present)',
    );
    return this.createAndStoreKey(safeStorage);
  }

  /**
   * Attempt to unwrap the master key via safeStorage. Returns the 32-byte
   * key on success, or null if decryption throws or yields a wrong length.
   */
  private tryDecryptKeychain(
    safeStorage: ElectronSafeStorageApi,
    wrapped: string,
  ): Buffer | null {
    let base64Key: string;
    try {
      base64Key = safeStorage.decryptString(Buffer.from(wrapped, 'base64'));
    } catch (error: unknown) {
      void error;
      return null;
    }
    const keyBuf = Buffer.from(base64Key, 'base64');
    return keyBuf.length === 32 ? keyBuf : null;
  }

  /**
   * Attempt to unwrap the master key via the machine-seed envelope. Returns
   * the 32-byte key on success, or null on any failure. Does NOT depend on
   * safeStorage being available (that is the whole point of the fallback).
   */
  private tryDecryptMachineWrap(machineWrapped: string): Buffer | null {
    const base64Key = decryptWithMachineSeed(machineWrapped, this.ptahDir);
    if (base64Key === null) return null;
    const keyBuf = Buffer.from(base64Key, 'base64');
    return keyBuf.length === 32 ? keyBuf : null;
  }

  /**
   * Best-effort: add a machineWrapped envelope to an existing ref and rewrite
   * it atomically. Never throws — a backfill failure must not fail the read.
   */
  private async backfillMachineWrap(
    ref: MasterKeyRef,
    key: Buffer,
  ): Promise<void> {
    try {
      const machineWrapped = encryptWithMachineSeed(
        key.toString('base64'),
        this.ptahDir,
      );
      await this.writeKeyRefAtomic({ ...ref, machineWrapped });
    } catch (error: unknown) {
      const detail = error instanceof Error ? error.message : String(error);
      console.error(
        `[ptah-electron] WARN: failed to backfill machineWrapped master-key-ref (${detail}). ` +
          'Keychain read still succeeded; recovery fallback is not yet armed.',
      );
    }
  }

  /**
   * Best-effort: after recovering via the machine seed, re-wrap the key with
   * safeStorage so the keychain fast-path works again next boot. Never throws.
   */
  private async restoreKeychainWrap(
    safeStorage: ElectronSafeStorageApi,
    ref: MasterKeyRef,
    key: Buffer,
  ): Promise<void> {
    try {
      if (!safeStorage.isEncryptionAvailable()) return;
      const wrapped = safeStorage
        .encryptString(key.toString('base64'))
        .toString('base64');
      await this.writeKeyRefAtomic({ ...ref, wrapped });
    } catch (error: unknown) {
      const detail = error instanceof Error ? error.message : String(error);
      console.error(
        `[ptah-electron] WARN: recovered master key via machine seed but could not ` +
          `restore the keychain wrap (${detail}). Recovery still succeeded.`,
      );
    }
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
    // Dual-wrap: ALSO wrap under the stable machine seed so a future OS
    // keychain change can recover this key instead of regenerating.
    const machineWrapped = encryptWithMachineSeed(base64Key, this.ptahDir);
    const ref: MasterKeyRef = {
      version: KEY_REF_VERSION,
      algorithm: KEY_REF_ALGORITHM,
      wrapped: wrappedBuf.toString('base64'),
      machineWrapped,
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
        console.error(
          `[ptah-electron] ERROR: master key corruption (${detail}). ${CORRUPT_KEY_MESSAGE}`,
        );
      }
    } else {
      console.error(
        `[ptah-electron] ERROR: master key corruption (${detail}). ${CORRUPT_KEY_MESSAGE}`,
      );
    }
  }
}

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
