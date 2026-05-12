/**
 * SecretsFileStore — file-backed store for encrypted secret envelopes.
 *
 * Reads and writes ~/.ptah/secrets.enc.json atomically (tmp + rename).
 * Holds a Map<string, SecretEnvelope> in memory after the first load.
 *
 * This class is not an ISettingsStore — it is a pure I/O helper used by
 * the platform adapters' readSecret / writeSecret / deleteSecret methods.
 *
 * WP-4A: Encrypted secrets file abstraction.
 */

import * as fs from 'fs';
import * as fsPromises from 'fs/promises';
import * as path from 'path';
import { decryptValue, encryptValue } from './secret-envelope';
import type { SecretEnvelope } from './secret-envelope';

/** On-disk format for secrets.enc.json. */
interface SecretsFileFormat {
  $schema: string;
  version: number;
  entries: Record<string, SecretEnvelope>;
}

const FILE_SCHEMA = 'https://ptah.live/schemas/secrets.enc.json';
const FILE_VERSION = 1;
const TMP_SUFFIX = '.flush.tmp';

export class SecretsFileStore {
  private readonly filePath: string;
  private entries: Map<string, SecretEnvelope> = new Map();
  private loaded = false;

  constructor(ptahDir: string) {
    this.filePath = path.join(ptahDir, 'secrets.enc.json');
  }

  /**
   * Read a secret from the store, decrypting with the provided master key.
   * Returns undefined if the key does not exist.
   */
  async read(key: string, masterKey: Buffer): Promise<string | undefined> {
    await this.ensureLoaded();
    const envelope = this.entries.get(key);
    if (!envelope) return undefined;
    return decryptValue(envelope, masterKey, key);
  }

  /**
   * Encrypt and persist a secret value under the given key.
   * Writes atomically via tmp + rename.
   */
  async write(key: string, value: string, masterKey: Buffer): Promise<void> {
    await this.ensureLoaded();
    const envelope = encryptValue(value, masterKey, key);
    this.entries.set(key, envelope);
    await this.persist();
  }

  /**
   * Remove a secret entry by key and persist the updated file.
   * No-op (no error) if the key does not exist.
   */
  async delete(key: string): Promise<void> {
    await this.ensureLoaded();
    if (!this.entries.has(key)) return;
    this.entries.delete(key);
    await this.persist();
  }

  /**
   * Synchronously flush the current in-memory entries to disk.
   *
   * The caller must supply the master key synchronously because
   * getMasterKey() is async. The platform adapter caches the key on first
   * async access and passes the cached value here. If the cache is empty
   * (secrets were never accessed in this process), the flush is a no-op
   * because there is nothing to write that wasn't already written by the
   * async path.
   *
   * Uses a distinct `.flush.tmp` suffix to avoid racing with async writes.
   */
  flushSync(masterKey: Buffer | null): void {
    if (masterKey === null) {
      // Master key not yet loaded — no dirty secrets to flush.
      return;
    }
    if (!this.loaded) {
      // Nothing was read or written in this process — nothing to flush.
      return;
    }
    const tmpPath = this.filePath + TMP_SUFFIX;
    try {
      const data = this.buildFileData();
      fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), 'utf8');
      fs.renameSync(tmpPath, this.filePath);
    } catch (err) {
      // Swallow sync flush errors (same pattern as PtahFileSettingsManager).
      // The async write path is the primary durability path.
      console.error(
        '[SecretsFileStore] flushSync failed:',
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  // -------------------------------------------------------------------------
  // Internal
  // -------------------------------------------------------------------------

  private async ensureLoaded(): Promise<void> {
    if (this.loaded) return;
    await this.loadFromDisk();
    this.loaded = true;
  }

  private async loadFromDisk(): Promise<void> {
    let raw: string;
    try {
      raw = await fsPromises.readFile(this.filePath, 'utf8');
    } catch (err: unknown) {
      if (isNodeError(err) && err.code === 'ENOENT') {
        // File does not exist yet — start with an empty store.
        this.entries = new Map();
        return;
      }
      throw err;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      // Corrupt file — start fresh (entries will be re-written on next write).
      this.entries = new Map();
      return;
    }

    if (!isSecretsFileFormat(parsed)) {
      // Unrecognised format — start fresh.
      this.entries = new Map();
      return;
    }

    this.entries = new Map(Object.entries(parsed.entries));
  }

  private async persist(): Promise<void> {
    const dir = path.dirname(this.filePath);
    await fsPromises.mkdir(dir, { recursive: true });

    const tmpPath = this.filePath + '.tmp';
    const data = this.buildFileData();
    await fsPromises.writeFile(tmpPath, JSON.stringify(data, null, 2), 'utf8');
    await fsPromises.rename(tmpPath, this.filePath);
  }

  private buildFileData(): SecretsFileFormat {
    const entries: Record<string, SecretEnvelope> = {};
    for (const [k, v] of this.entries) {
      entries[k] = v;
    }
    return {
      $schema: FILE_SCHEMA,
      version: FILE_VERSION,
      entries,
    };
  }
}

// ---- helpers ----------------------------------------------------------------

function isNodeError(err: unknown): err is NodeJS.ErrnoException {
  return (
    typeof err === 'object' && err !== null && 'code' in err && 'message' in err
  );
}

function isSecretEnvelope(value: unknown): value is SecretEnvelope {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as Record<string, unknown>)['iv'] === 'string' &&
    typeof (value as Record<string, unknown>)['tag'] === 'string' &&
    typeof (value as Record<string, unknown>)['ciphertext'] === 'string'
  );
}

function isSecretsFileFormat(value: unknown): value is SecretsFileFormat {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  if (typeof v['version'] !== 'number') return false;
  if (typeof v['entries'] !== 'object' || v['entries'] === null) return false;
  const entries = v['entries'] as Record<string, unknown>;
  for (const entry of Object.values(entries)) {
    if (!isSecretEnvelope(entry)) return false;
  }
  return true;
}
