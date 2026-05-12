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
 *
 * WP-4A: Electron master key provider.
 */

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as fsPromises from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import type { IMasterKeyProvider } from '@ptah-extension/settings-core';

const KEY_REF_ALGORITHM = 'electron-safeStorage';
const KEY_REF_VERSION = 1;

interface MasterKeyRef {
  version: number;
  algorithm: string;
  /** Base64-encoded bytes from safeStorage.encryptString(base64Key). */
  wrapped: string;
}

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

  constructor(ptahDir?: string) {
    const dir = ptahDir ?? path.join(os.homedir(), '.ptah');
    this.keyRefPath = path.join(dir, 'master-key-ref.json');
  }

  async getMasterKey(): Promise<Buffer> {
    if (this.cachedKey) return this.cachedKey;

    const safeStorage = await this.loadSafeStorage();
    const key = await this.loadOrCreateKey(safeStorage);
    this.cachedKey = key;
    return key;
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

    let ref: unknown;
    try {
      ref = JSON.parse(rawRef);
    } catch {
      // Corrupt ref file — regenerate.
      return this.createAndStoreKey(safeStorage);
    }

    if (!isMasterKeyRef(ref)) {
      // Unrecognised format — regenerate.
      return this.createAndStoreKey(safeStorage);
    }

    const wrappedBuf = Buffer.from(ref.wrapped, 'base64');
    let base64Key: string;
    try {
      base64Key = safeStorage.decryptString(wrappedBuf);
    } catch {
      // Decrypt failed (e.g. OS keyring changed) — regenerate and overwrite.
      return this.createAndStoreKey(safeStorage);
    }

    const keyBuf = Buffer.from(base64Key, 'base64');
    if (keyBuf.length !== 32) {
      // Stored key has wrong length — regenerate.
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
}

// ---- helpers ----------------------------------------------------------------

function isMasterKeyRef(value: unknown): value is MasterKeyRef {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v['version'] === 'number' &&
    typeof v['algorithm'] === 'string' &&
    typeof v['wrapped'] === 'string'
  );
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
