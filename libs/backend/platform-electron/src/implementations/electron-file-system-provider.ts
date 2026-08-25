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
import {
  FileType,
  createEvent,
  planGlobWatch,
} from '@ptah-extension/platform-core';

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

  /**
   * Watch a glob.
   *
   * chokidar has not understood globs since v4 — it takes DIRECTORIES. The
   * pattern is therefore turned into a watchable directory plus two predicates
   * by {@link planGlobWatch}, which owns that translation for this adapter and
   * its CLI twin. Passing the glob through, as this did before, produced a
   * watcher on a literal directory named `**` that never fired: see the header
   * of `glob-watch-plan.ts`.
   *
   * `ignored` is given as a FUNCTION, not the caller's globs: chokidar v4+ does
   * not glob there either, and a function is consulted for directories, so it
   * prunes `node_modules` instead of walking it and discarding the events.
   */
  createFileWatcher(
    pattern: string,
    options?: { exclude?: string[]; cwd?: string },
  ): IFileWatcher {
    const chokidar = require('chokidar');
    const plan = planGlobWatch(pattern, options);
    const watcher = chokidar.watch(plan.watchRoot, {
      ignoreInitial: true,
      persistent: true,
      ignored: (candidate: string) => plan.ignores(candidate),
    });

    const [onDidChange, fireChange] = createEvent<string>();
    const [onDidCreate, fireCreate] = createEvent<string>();
    const [onDidDelete, fireDelete] = createEvent<string>();

    // chokidar echoes back the absolute root it was given, so paths arrive
    // absolute — the same shape the VS Code adapter emits (`uri.fsPath`).
    const emit =
      (fire: (p: string) => void) =>
      (filePath: string): void => {
        const absolute = path.resolve(filePath);
        if (plan.matches(absolute)) fire(absolute);
      };
    watcher.on('change', emit(fireChange));
    watcher.on('add', emit(fireCreate));
    watcher.on('unlink', emit(fireDelete));

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
