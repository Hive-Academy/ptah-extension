/**
 * ElectronFileSystemProvider — IFileSystemProvider implementation using Node.js fs/promises.
 *
 * Uses fast-glob for findFiles() and chokidar for createFileWatcher().
 * No Electron imports required — pure Node.js implementation.
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

export class ElectronFileSystemProvider implements IFileSystemProvider {
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

  /**
   * Non-recursive `mkdir(2)`. Omitting `recursive` is the entire point:
   * `{ recursive: true }` resolves silently on an existing path, whereas the
   * bare call fails with `EEXIST`, giving us a real compare-and-swap in one
   * syscall. Never stat first — that would reopen the TOCTOU window.
   */
  async createDirectoryExclusive(dirPath: string): Promise<void> {
    await fs.mkdir(dirPath);
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
      force: options?.overwrite ?? false,
    });
  }

  async findFiles(
    pattern: string,
    exclude?: string[],
    maxResults?: number,
    cwd?: string,
  ): Promise<string[]> {
    const fg = await import('fast-glob');
    const results = await fg.default(pattern, {
      ignore: exclude && exclude.length > 0 ? exclude : undefined,
      absolute: true,
      onlyFiles: true,
      dot: true,
      cwd: cwd || undefined,
    });
    return maxResults ? results.slice(0, maxResults) : results;
  }

  createFileWatcher(
    pattern: string,
    options?: { exclude?: string[]; cwd?: string },
  ): IFileWatcher {
    const chokidar = require('chokidar');
    const hasExcludes = !!options?.exclude && options.exclude.length > 0;
    const cwd = options?.cwd;
    const watcher = chokidar.watch(pattern, {
      ignoreInitial: true,
      persistent: true,
      ...(cwd ? { cwd } : {}),
      ...(hasExcludes ? { ignored: options?.exclude } : {}),
    });

    const [onDidChange, fireChange] = createEvent<string>();
    const [onDidCreate, fireCreate] = createEvent<string>();
    const [onDidDelete, fireDelete] = createEvent<string>();

    // With `cwd`, chokidar emits paths relative to it — resolve to absolute so
    // consumers get the same absolute paths the VS Code adapter emits.
    const toAbs = (p: string): string => (cwd ? path.resolve(cwd, p) : p);
    watcher.on('change', (filePath: string) => fireChange(toAbs(filePath)));
    watcher.on('add', (filePath: string) => fireCreate(toAbs(filePath)));
    watcher.on('unlink', (filePath: string) => fireDelete(toAbs(filePath)));

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
