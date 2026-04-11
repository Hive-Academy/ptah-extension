/**
 * ElectronStateStorage — IStateStorage implementation using JSON file with in-memory cache.
 *
 * Replaces vscode.Memento (globalState / workspaceState).
 * Thread-safe writes via atomic rename pattern (write to .tmp then rename).
 * Serializes concurrent writes via promise chain to prevent corruption.
 */

import * as fs from 'fs';
import * as fsPromises from 'fs/promises';
import * as path from 'path';
import type { IStateStorage } from '@ptah-extension/platform-core';

export class ElectronStateStorage implements IStateStorage {
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
      () => this.persist(),
    );
    await this.writePromise;
  }

  updateSync(key: string, value: unknown): void {
    if (value === undefined) {
      delete this.data[key];
    } else {
      this.data[key] = value;
    }
    this.persistSync();
    // Any in-flight async persist is now stale — reset the chain so future
    // async writes serialize from the state we just wrote to disk.
    this.writePromise = Promise.resolve();
  }

  keys(): readonly string[] {
    return Object.keys(this.data);
  }

  private loadSync(): void {
    try {
      const raw = fs.readFileSync(this.filePath, 'utf-8');
      this.data = JSON.parse(raw);
    } catch {
      // File doesn't exist or is corrupted — start fresh
      this.data = {};
    }
  }

  private async persist(): Promise<void> {
    const dir = path.dirname(this.filePath);
    await fsPromises.mkdir(dir, { recursive: true });
    // Atomic write: write to temp file then rename to prevent partial writes
    const tmpPath = this.filePath + '.tmp';
    await fsPromises.writeFile(
      tmpPath,
      JSON.stringify(this.data, null, 2),
      'utf-8',
    );
    await fsPromises.rename(tmpPath, this.filePath);
  }

  private persistSync(): void {
    const dir = path.dirname(this.filePath);
    fs.mkdirSync(dir, { recursive: true });
    // Distinct suffix from async persist() to avoid collisions if an async
    // write is still in-flight when will-quit triggers this sync path.
    const tmpPath = this.filePath + '.sync-tmp';
    fs.writeFileSync(tmpPath, JSON.stringify(this.data, null, 2), 'utf-8');
    fs.renameSync(tmpPath, this.filePath);
  }
}
