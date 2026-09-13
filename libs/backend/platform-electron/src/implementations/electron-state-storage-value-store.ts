import type {
  ElectronStateBlob,
  ElectronStateManifest,
} from './electron-state-storage-manifest';
import {
  estimateElectronStateJsonBytes,
  type JsonValue,
} from './electron-state-storage-worker-protocol';

export const DEFAULT_ELECTRON_STATE_VALUE_CACHE_BYTES = 32 * 1024 * 1024;

export type ElectronStateBlobReader = (
  blob: ElectronStateBlob,
) => Promise<JsonValue>;

interface CachedValue {
  readonly relativePath: string;
  readonly value: JsonValue;
  readonly bytes: number;
}

export interface ElectronStateValueCacheStats {
  readonly entries: number;
  readonly bytes: number;
  readonly maxBytes: number;
}

export class ElectronStateValueStore {
  private manifest: ElectronStateManifest | null = null;
  private readonly entries = new Map<string, CachedValue>();
  private cachedBytes = 0;

  constructor(
    private readonly readBlob: ElectronStateBlobReader,
    private readonly maxBytes = DEFAULT_ELECTRON_STATE_VALUE_CACHE_BYTES,
  ) {}

  setManifest(manifest: ElectronStateManifest): void {
    this.manifest = manifest;
    for (const [key, entry] of this.entries) {
      if (manifest.values[key]?.relativePath !== entry.relativePath) {
        this.drop(key);
      }
    }
  }

  has(key: string): boolean {
    return this.blobFor(key) !== undefined;
  }

  keys(): string[] {
    return this.manifest ? Object.keys(this.manifest.values) : [];
  }

  blobFor(key: string): ElectronStateBlob | undefined {
    const values = this.manifest?.values;
    return values && Object.prototype.hasOwnProperty.call(values, key)
      ? values[key]
      : undefined;
  }

  async get(key: string): Promise<JsonValue | undefined> {
    const blob = this.blobFor(key);
    if (!blob) return undefined;
    const cached = this.entries.get(key);
    if (cached && cached.relativePath === blob.relativePath) {
      this.entries.delete(key);
      this.entries.set(key, cached);
      return cached.value;
    }
    const value = await this.readBlob(blob);
    this.remember(key, blob, value);
    return value;
  }

  remember(key: string, blob: ElectronStateBlob, value: JsonValue): void {
    this.drop(key);
    const bytes = estimateElectronStateJsonBytes(value);
    if (bytes > this.maxBytes) return;
    this.entries.set(key, { relativePath: blob.relativePath, value, bytes });
    this.cachedBytes += bytes;
    for (const [oldestKey] of this.entries) {
      if (this.cachedBytes <= this.maxBytes) break;
      this.drop(oldestKey);
    }
  }

  evict(keys: Iterable<string>): void {
    for (const key of keys) this.drop(key);
  }

  stats(): ElectronStateValueCacheStats {
    return {
      entries: this.entries.size,
      bytes: this.cachedBytes,
      maxBytes: this.maxBytes,
    };
  }

  private drop(key: string): void {
    const entry = this.entries.get(key);
    if (!entry) return;
    this.entries.delete(key);
    this.cachedBytes -= entry.bytes;
  }
}
