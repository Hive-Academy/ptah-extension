/**
 * CliFileSystemProvider — IFileSystemProvider implementation using Node.js fs/promises.
 *
 * Uses fast-glob for findFiles() and chokidar for createFileWatcher().
 * No Electron imports required — pure Node.js implementation.
 *
 * Copied from ElectronFileSystemProvider (identical logic, CLI class prefix).
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import type {
  IFileSystemProvider,
  FileStat,
  DirectoryEntry,
  IFileWatcher,
} from '@ptah-extension/platform-core';
import { FileType, createEvent } from '@ptah-extension/platform-core';

export class CliFileSystemProvider implements IFileSystemProvider {
  async readFile(filePath: string): Promise<string> {
    return fs.readFile(filePath, 'utf-8');
  }

  async readFileBytes(filePath: string): Promise<Uint8Array> {
    const buffer = await fs.readFile(filePath);
    return new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  }

  async writeFile(filePath: string, content: string): Promise<void> {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, content, 'utf-8');
  }

  async writeFileBytes(filePath: string, content: Uint8Array): Promise<void> {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, content);
  }

  async readDirectory(dirPath: string): Promise<DirectoryEntry[]> {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    return entries.map((entry) => ({
      name: entry.name,
      type: entry.isFile()
        ? FileType.File
        : entry.isDirectory()
          ? FileType.Directory
          : entry.isSymbolicLink()
            ? FileType.SymbolicLink
            : FileType.Unknown,
    }));
  }

  async stat(filePath: string): Promise<FileStat> {
    const stats = await fs.stat(filePath);
    return {
      type: stats.isFile()
        ? FileType.File
        : stats.isDirectory()
          ? FileType.Directory
          : stats.isSymbolicLink()
            ? FileType.SymbolicLink
            : FileType.Unknown,
      ctime: stats.ctimeMs,
      mtime: stats.mtimeMs,
      size: stats.size,
    };
  }

  async exists(filePath: string): Promise<boolean> {
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  async delete(
    filePath: string,
    options?: { recursive?: boolean },
  ): Promise<void> {
    await fs.rm(filePath, {
      recursive: options?.recursive ?? false,
      force: true,
    });
  }

  async createDirectory(dirPath: string): Promise<void> {
    await fs.mkdir(dirPath, { recursive: true });
  }

  async copy(
    source: string,
    destination: string,
    options?: { overwrite?: boolean },
  ): Promise<void> {
    const destExists = await this.exists(destination);
    if (destExists && !options?.overwrite) {
      throw new Error(`Destination already exists: ${destination}`);
    }
    await fs.cp(source, destination, {
      recursive: true,
      force: options?.overwrite,
    });
  }

  async findFiles(
    pattern: string,
    exclude?: string,
    maxResults?: number,
  ): Promise<string[]> {
    // Dynamic import to avoid issues if fast-glob not installed in test environments
    const fg = await import('fast-glob');
    const results = await fg.default(pattern, {
      ignore: exclude ? [exclude] : undefined,
      absolute: true,
      onlyFiles: true,
    });
    return maxResults ? results.slice(0, maxResults) : results;
  }

  createFileWatcher(pattern: string): IFileWatcher {
    const chokidar = require('chokidar');
    const watcher = chokidar.watch(pattern, {
      ignoreInitial: true,
      persistent: true,
    });

    const [onDidChange, fireChange] = createEvent<string>();
    const [onDidCreate, fireCreate] = createEvent<string>();
    const [onDidDelete, fireDelete] = createEvent<string>();

    watcher.on('change', (filePath: string) => fireChange(filePath));
    watcher.on('add', (filePath: string) => fireCreate(filePath));
    watcher.on('unlink', (filePath: string) => fireDelete(filePath));

    return {
      onDidChange,
      onDidCreate,
      onDidDelete,
      dispose() {
        watcher.close();
      },
    };
  }
}
