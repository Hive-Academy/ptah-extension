/**
 * ElectronSecretStorage — ISecretStorage implementation using Electron safeStorage API.
 *
 * Stores encrypted secrets in a JSON file. Each value is encrypted with
 * Electron's safeStorage (DPAPI on Windows, Keychain on macOS, libsecret on Linux).
 *
 * IMPORTANT: safeStorage is only available after app.whenReady().
 * The registration function must ensure this precondition.
 *
 * Fallback: When encryption is unavailable (Linux without keyring), stores raw
 * values with a console warning. This allows the app to function in degraded mode.
 *
 * The safeStorage API is injected via constructor to avoid top-level 'electron' imports,
 * keeping the library testable without the Electron runtime.
 */

import * as fs from 'fs';
import * as fsPromises from 'fs/promises';
import * as path from 'path';
import type { ISecretStorage } from '@ptah-extension/platform-core';
import type { IEvent, SecretChangeEvent } from '@ptah-extension/platform-core';
import { createEvent } from '@ptah-extension/platform-core';

/**
 * Plain-text fallback marker. Prepended to values stored when safeStorage
 * encryption is not available (e.g. Linux without a keyring). Distinguishes
 * raw strings from base64-encoded encrypted buffers on read.
 */
const PLAIN_MARKER = 'plain:';

/** Minimal safeStorage interface — matches Electron's safeStorage module */
export interface SafeStorageApi {
  isEncryptionAvailable(): boolean;
  encryptString(plainText: string): Buffer;
  decryptString(encrypted: Buffer): string;
}

export class ElectronSecretStorage implements ISecretStorage {
  public readonly onDidChange: IEvent<SecretChangeEvent>;
  private readonly fireChange: (data: SecretChangeEvent) => void;
  private secrets: Record<string, string> = {}; // key -> base64-encoded encrypted buffer
  private readonly filePath: string;
  private writePromise: Promise<void> = Promise.resolve();

  constructor(
    storageDirPath: string,
    private readonly safeStorage: SafeStorageApi,
  ) {
    this.filePath = path.join(storageDirPath, 'secrets.json');
    const [event, fire] = createEvent<SecretChangeEvent>();
    this.onDidChange = event;
    this.fireChange = fire;
    this.loadSync();
  }

  async get(key: string): Promise<string | undefined> {
    if (!(key in this.secrets)) return undefined;
    const stored = this.secrets[key];
    if (stored === undefined) return undefined;
    if (stored.startsWith(PLAIN_MARKER)) {
      return stored.slice(PLAIN_MARKER.length);
    }
    if (stored === '') {
      return '';
    }

    if (!this.safeStorage.isEncryptionAvailable()) {
      console.warn(
        '[ElectronSecretStorage] Encryption not available and stored value has no plain marker; cannot decrypt',
      );
      return undefined;
    }

    try {
      const buffer = Buffer.from(stored, 'base64');
      return this.safeStorage.decryptString(buffer);
    } catch (error) {
      console.error(
        '[ElectronSecretStorage] Failed to decrypt secret:',
        key,
        error,
      );
      return undefined;
    }
  }

  async store(key: string, value: string): Promise<void> {
    if (this.safeStorage.isEncryptionAvailable()) {
      const encrypted = this.safeStorage.encryptString(value);
      this.secrets[key] = encrypted.toString('base64');
    } else {
      console.warn(
        '[ElectronSecretStorage] Encryption not available, storing with plain: marker',
      );
      this.secrets[key] = PLAIN_MARKER + value;
    }
    this.writePromise = this.writePromise.then(
      () => this.persist(),
      () => this.persist(),
    );
    await this.writePromise;
    this.fireChange({ key });
  }

  async delete(key: string): Promise<void> {
    if (!(key in this.secrets)) return;
    delete this.secrets[key];
    this.writePromise = this.writePromise.then(
      () => this.persist(),
      () => this.persist(),
    );
    await this.writePromise;
    this.fireChange({ key });
  }

  private loadSync(): void {
    try {
      const raw = fs.readFileSync(this.filePath, 'utf-8');
      this.secrets = JSON.parse(raw);
    } catch {
      this.secrets = {};
    }
  }

  private async persist(): Promise<void> {
    const dir = path.dirname(this.filePath);
    await fsPromises.mkdir(dir, { recursive: true });
    const tmpPath = this.filePath + '.tmp';
    await fsPromises.writeFile(
      tmpPath,
      JSON.stringify(this.secrets, null, 2),
      'utf-8',
    );
    await fsPromises.rename(tmpPath, this.filePath);
  }
}
