/**
 * CliSecretStorage — ISecretStorage implementation using Node.js crypto module.
 *
 * Stores encrypted secrets in a JSON file at ~/.ptah/secrets.enc.
 * Uses AES-256-GCM encryption with a key derived from a machine-specific
 * identifier via PBKDF2.
 *
 * Security model:
 * - Key derivation: PBKDF2 with 100,000 iterations, SHA-512
 * - Machine ID: os.hostname() + ':' + os.userInfo().username
 *   (not cryptographically strong, but sufficient for local-only secret storage
 *   where the threat model is accidental exposure, not targeted attack)
 * - Each write generates a fresh random IV (12 bytes for GCM)
 * - Auth tag stored alongside ciphertext for tamper detection
 *
 * On corruption: the encrypted file is deleted and a fresh store is created.
 * Concurrent writes are serialized via a promise chain + atomic rename pattern.
 */

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as fsPromises from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import type { ISecretStorage } from '@ptah-extension/platform-core';
import type { IEvent, SecretChangeEvent } from '@ptah-extension/platform-core';
import { createEvent } from '@ptah-extension/platform-core';

/** On-disk encrypted store format */
interface EncryptedStore {
  /** Hex-encoded PBKDF2 salt (32 bytes) */
  salt: string;
  /** Hex-encoded AES-GCM initialization vector (12 bytes) */
  iv: string;
  /** Hex-encoded GCM authentication tag (16 bytes) */
  tag: string;
  /** Hex-encoded AES-256-GCM ciphertext */
  data: string;
}

const ALGORITHM = 'aes-256-gcm';
const KEY_LENGTH = 32; // 256 bits
const IV_LENGTH = 12; // 96 bits (recommended for GCM)
const SALT_LENGTH = 32; // 256 bits
const PBKDF2_ITERATIONS = 100_000;
const PBKDF2_DIGEST = 'sha512';

export class CliSecretStorage implements ISecretStorage {
  public readonly onDidChange: IEvent<SecretChangeEvent>;
  private readonly fireChange: (data: SecretChangeEvent) => void;

  private secrets: Record<string, string> = {};
  private readonly filePath: string;
  private readonly machineId: string;
  private writePromise: Promise<void> = Promise.resolve();

  /** Cached salt — reused across writes for consistent key derivation */
  private salt: Buffer;

  constructor(storageDirPath: string) {
    this.filePath = path.join(storageDirPath, 'secrets.enc');
    this.machineId = this.computeMachineId();

    const [event, fire] = createEvent<SecretChangeEvent>();
    this.onDidChange = event;
    this.fireChange = fire;

    // Generate a fresh salt — will be overridden by loadSync if file exists
    this.salt = crypto.randomBytes(SALT_LENGTH);
    this.loadSync();
  }

  async get(key: string): Promise<string | undefined> {
    const value = this.secrets[key];
    return value !== undefined ? value : undefined;
  }

  async store(key: string, value: string): Promise<void> {
    this.secrets[key] = value;
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

  /**
   * Derive a machine-specific identifier for key derivation.
   * Not cryptographically strong, but provides local-only secret binding.
   */
  private computeMachineId(): string {
    try {
      return `${os.hostname()}:${os.userInfo().username}`;
    } catch {
      // os.userInfo() can throw on some platforms (e.g., containers without /etc/passwd)
      return `${os.hostname()}:unknown`;
    }
  }

  /**
   * Derive an encryption key from the machine ID and salt using PBKDF2.
   */
  private deriveKey(salt: Buffer): Buffer {
    return crypto.pbkdf2Sync(
      this.machineId,
      salt,
      PBKDF2_ITERATIONS,
      KEY_LENGTH,
      PBKDF2_DIGEST,
    );
  }

  /**
   * Encrypt the in-memory secrets map to an EncryptedStore.
   */
  private encrypt(plaintext: string): EncryptedStore {
    const iv = crypto.randomBytes(IV_LENGTH);
    const key = this.deriveKey(this.salt);

    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
    let encrypted = cipher.update(plaintext, 'utf-8', 'hex');
    encrypted += cipher.final('hex');
    const tag = cipher.getAuthTag();

    return {
      salt: this.salt.toString('hex'),
      iv: iv.toString('hex'),
      tag: tag.toString('hex'),
      data: encrypted,
    };
  }

  /**
   * Decrypt an EncryptedStore back to plaintext.
   * Returns null if decryption fails (wrong key, tampered data, etc.).
   */
  private decrypt(store: EncryptedStore): string | null {
    try {
      const salt = Buffer.from(store.salt, 'hex');
      const iv = Buffer.from(store.iv, 'hex');
      const tag = Buffer.from(store.tag, 'hex');
      const key = this.deriveKey(salt);

      const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
      decipher.setAuthTag(tag);

      let decrypted = decipher.update(store.data, 'hex', 'utf-8');
      decrypted += decipher.final('utf-8');
      return decrypted;
    } catch {
      return null;
    }
  }

  /**
   * Load secrets from the encrypted file on disk.
   * On corruption or decryption failure, delete the file and start fresh.
   */
  private loadSync(): void {
    try {
      const raw = fs.readFileSync(this.filePath, 'utf-8');
      const store: EncryptedStore = JSON.parse(raw);

      // Validate the stored format has all required fields
      if (!store.salt || !store.iv || !store.tag || !store.data) {
        throw new Error('Invalid encrypted store format');
      }

      // Restore the salt from disk for consistent key derivation
      this.salt = Buffer.from(store.salt, 'hex');

      const plaintext = this.decrypt(store);
      if (plaintext === null) {
        // Decryption failed — key mismatch or corruption
        console.warn(
          '[CliSecretStorage] Failed to decrypt secrets file — starting fresh',
        );
        this.deleteFileSync();
        this.secrets = {};
        return;
      }

      this.secrets = JSON.parse(plaintext);
    } catch {
      // File doesn't exist, is corrupted JSON, or has invalid format — start fresh
      this.secrets = {};
    }
  }

  /**
   * Persist secrets to disk as encrypted JSON.
   * Uses atomic write pattern (write to .tmp, then rename).
   */
  private async persist(): Promise<void> {
    const dir = path.dirname(this.filePath);
    await fsPromises.mkdir(dir, { recursive: true });

    const plaintext = JSON.stringify(this.secrets);
    const store = this.encrypt(plaintext);

    // Atomic write: write to temp file then rename
    const tmpPath = this.filePath + '.tmp';
    await fsPromises.writeFile(
      tmpPath,
      JSON.stringify(store, null, 2),
      'utf-8',
    );
    await fsPromises.rename(tmpPath, this.filePath);
  }

  /**
   * Delete the encrypted file if it exists (used on corruption recovery).
   */
  private deleteFileSync(): void {
    try {
      fs.unlinkSync(this.filePath);
    } catch {
      // File may not exist — ignore
    }
  }
}
