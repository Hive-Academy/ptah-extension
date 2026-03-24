/**
 * VscodeDiskStateStorage — IStateStorage implementation using JSON file with in-memory cache.
 *
 * Atomic writes (.tmp + rename) and promise chain serialization for concurrent safety.
 */

import * as fs from 'fs';
import * as fsPromises from 'fs/promises';
import * as path from 'path';
import type { IStateStorage } from '@ptah-extension/platform-core';

export class VscodeDiskStateStorage implements IStateStorage {
  private data: Record<string, unknown> = {};
  private readonly filePath: string;
  private writePromise: Promise<void> = Promise.resolve();

  constructor(storageDirPath: string, filename: string) {
    this.filePath = path.join(storageDirPath, filename);
    this.loadSync();
  }

  get<T>(key: string, defaultValue?: T): T | undefined {
    const value = this.data[key];
    return value !== undefined ? (value as T) : defaultValue;
  }

  async update(key: string, value: unknown): Promise<void> {
    if (value === undefined) {
      delete this.data[key];
    } else {
      this.data[key] = value;
    }
    // Serialize writes to prevent corruption from concurrent updates.
    // Catch errors to prevent a single failure from breaking the chain permanently.
    this.writePromise = this.writePromise.then(
      () => this.persist(),
      () => this.persist()
    );
    await this.writePromise;
  }

  keys(): readonly string[] {
    return Object.keys(this.data);
  }

  private loadSync(): void {
    try {
      const raw = fs.readFileSync(this.filePath, 'utf-8');
      const parsed = JSON.parse(raw);
      // Guard against corrupted files containing null, arrays, or primitives
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        this.data = parsed;
      } else {
        this.data = {};
      }
    } catch {
      // File doesn't exist or is corrupted — start fresh
      this.data = {};
    }
  }

  private async persist(): Promise<void> {
    try {
      const dir = path.dirname(this.filePath);
      await fsPromises.mkdir(dir, { recursive: true });
      // Atomic write: write to temp file then rename to prevent partial writes
      const tmpPath = this.filePath + '.tmp';
      await fsPromises.writeFile(
        tmpPath,
        JSON.stringify(this.data, null, 2),
        'utf-8'
      );
      await fsPromises.rename(tmpPath, this.filePath);
    } catch (err) {
      // Log but don't throw — in-memory state remains authoritative.
      // Next successful persist() will reconcile.
      console.error(
        `[VscodeDiskStateStorage] Failed to persist state to ${this.filePath}:`,
        err
      );
    }
  }
}
