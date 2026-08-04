/**
 * VscodeFileSystemProvider — IFileSystemProvider implementation using VS Code APIs.
 *
 * Handles all string-to-Uri conversion internally.
 * Supports file://, vscode-vfs://, and untitled:// schemes.
 */

import * as vscode from 'vscode';
import * as nodeFs from 'node:fs/promises';
import picomatch from 'picomatch';
import type {
  IFileSystemProvider,
  FileStat,
  DirectoryEntry,
  IFileWatcher,
} from '@ptah-extension/platform-core';
import { FileType, createEvent } from '@ptah-extension/platform-core';

export class VscodeFileSystemProvider implements IFileSystemProvider {
  /**
   * Convert string path to vscode.Uri.
   * If the path looks like a URI scheme (contains ://), parse it.
   * Otherwise treat it as a file path.
   */
  private toUri(path: string): vscode.Uri {
    if (path.includes('://')) {
      return vscode.Uri.parse(path);
    }
    return vscode.Uri.file(path);
  }

  /**
   * Convert vscode.FileType to platform FileType
   */
  /**
   * Convert vscode.FileType bitflags to platform FileType.
   * VS Code uses bitwise OR for combinations (e.g., SymbolicLink | Directory = 66).
   */
  private convertFileType(vsType: vscode.FileType): FileType {
    let result: FileType = FileType.Unknown;
    if (vsType & vscode.FileType.File) {
      result |= FileType.File;
    }
    if (vsType & vscode.FileType.Directory) {
      result |= FileType.Directory;
    }
    if (vsType & vscode.FileType.SymbolicLink) {
      result |= FileType.SymbolicLink;
    }
    return result;
  }

  async readFile(path: string): Promise<string> {
    const bytes = await vscode.workspace.fs.readFile(this.toUri(path));
    return new TextDecoder('utf-8').decode(bytes);
  }

  async readFileBytes(path: string): Promise<Uint8Array> {
    return vscode.workspace.fs.readFile(this.toUri(path));
  }

  async writeFile(path: string, content: string): Promise<void> {
    const bytes = new TextEncoder().encode(content);
    await vscode.workspace.fs.writeFile(this.toUri(path), bytes);
  }

  async writeFileBytes(path: string, content: Uint8Array): Promise<void> {
    await vscode.workspace.fs.writeFile(this.toUri(path), content);
  }

  async readDirectory(path: string): Promise<DirectoryEntry[]> {
    const entries = await vscode.workspace.fs.readDirectory(this.toUri(path));
    return entries.map(([name, type]) => ({
      name,
      type: this.convertFileType(type),
    }));
  }

  async stat(path: string): Promise<FileStat> {
    const vsStat = await vscode.workspace.fs.stat(this.toUri(path));
    return {
      type: this.convertFileType(vsStat.type),
      ctime: vsStat.ctime,
      mtime: vsStat.mtime,
      size: vsStat.size,
    };
  }

  async exists(path: string): Promise<boolean> {
    try {
      await vscode.workspace.fs.stat(this.toUri(path));
      return true;
    } catch {
      return false;
    }
  }

  async delete(path: string, options?: { recursive?: boolean }): Promise<void> {
    await vscode.workspace.fs.delete(this.toUri(path), {
      recursive: options?.recursive ?? false,
    });
  }

  async createDirectory(path: string): Promise<void> {
    await vscode.workspace.fs.createDirectory(this.toUri(path));
  }

  /**
   * Claim a directory name atomically.
   *
   * DELIBERATELY NOT `vscode.workspace.fs.createDirectory`. That API is
   * recursive and resolves when the directory already exists, so building this
   * method on top of it would produce something that looks like a
   * compare-and-swap and silently is not — defeating the only reason the method
   * exists. Node's `mkdir` WITHOUT `recursive` is the one primitive available
   * here that fails with `EEXIST` in a single syscall.
   *
   * Stat-then-create is not an option either: the gap between the stat and the
   * create is exactly the race being closed.
   *
   * The trade-off is that this is local-disk only. Virtual filesystems
   * (`vscode-vfs://`, remote schemes) expose no exclusive-create primitive at
   * all, so rather than silently degrade to a non-atomic emulation we reject
   * and let the caller decide.
   */
  async createDirectoryExclusive(path: string): Promise<void> {
    const uri = this.toUri(path);
    if (uri.scheme !== 'file') {
      throw new Error(
        `createDirectoryExclusive requires a local file path, but '${path}' uses ` +
          `the '${uri.scheme}' scheme. Virtual filesystems provide no atomic ` +
          `exclusive-create, and emulating one would reintroduce the race this ` +
          `method exists to prevent.`,
      );
    }
    await nodeFs.mkdir(uri.fsPath);
  }

  async copy(
    source: string,
    destination: string,
    options?: { overwrite?: boolean },
  ): Promise<void> {
    await vscode.workspace.fs.copy(
      this.toUri(source),
      this.toUri(destination),
      {
        overwrite: options?.overwrite ?? false,
      },
    );
  }

  async findFiles(
    pattern: string,
    exclude?: string[],
    maxResults?: number,
    _cwd?: string,
  ): Promise<string[]> {
    let excludeGlob: string | undefined;
    if (exclude && exclude.length > 0) {
      excludeGlob =
        exclude.length === 1 ? exclude[0] : `{${exclude.join(',')}}`;
    }
    const uris = await vscode.workspace.findFiles(
      pattern,
      excludeGlob,
      maxResults,
    );
    return uris.map((uri) => uri.fsPath);
  }

  createFileWatcher(
    pattern: string,
    options?: { exclude?: string[]; cwd?: string },
  ): IFileWatcher {
    // Scope the watch to `cwd` via RelativePattern when given (correct for
    // multi-root); otherwise watch the bare glob across all workspace folders.
    // Either way `uri.fsPath` is absolute.
    const watcher = vscode.workspace.createFileSystemWatcher(
      options?.cwd ? new vscode.RelativePattern(options.cwd, pattern) : pattern,
    );

    const [onDidChange, fireChange] = createEvent<string>();
    const [onDidCreate, fireCreate] = createEvent<string>();
    const [onDidDelete, fireDelete] = createEvent<string>();

    // The OS watch already honours `files.watcherExclude` (so node_modules etc.
    // are excluded there). We additionally filter emitted events against the
    // caller's excludes for parity with the chokidar-backed adapters, which
    // push the same globs into chokidar's `ignored`.
    const excludeGlobs = options?.exclude ?? [];
    const isExcluded =
      excludeGlobs.length > 0
        ? (() => {
            const match = picomatch(excludeGlobs, { dot: true });
            return (fsPath: string): boolean =>
              match(fsPath.replace(/\\/g, '/'));
          })()
        : (): boolean => false;

    const changeDisposable = watcher.onDidChange((uri) => {
      if (!isExcluded(uri.fsPath)) fireChange(uri.fsPath);
    });
    const createDisposable = watcher.onDidCreate((uri) => {
      if (!isExcluded(uri.fsPath)) fireCreate(uri.fsPath);
    });
    const deleteDisposable = watcher.onDidDelete((uri) => {
      if (!isExcluded(uri.fsPath)) fireDelete(uri.fsPath);
    });

    return {
      onDidChange,
      onDidCreate,
      onDidDelete,
      dispose() {
        changeDisposable.dispose();
        createDisposable.dispose();
        deleteDisposable.dispose();
        watcher.dispose();
      },
    };
  }
}
