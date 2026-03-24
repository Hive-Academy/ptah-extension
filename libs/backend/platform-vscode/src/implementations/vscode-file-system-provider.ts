/**
 * VscodeFileSystemProvider — IFileSystemProvider implementation using VS Code APIs.
 *
 * Handles all string-to-Uri conversion internally.
 * Supports file://, vscode-vfs://, and untitled:// schemes.
 */

import * as vscode from 'vscode';
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

  async copy(
    source: string,
    destination: string,
    options?: { overwrite?: boolean }
  ): Promise<void> {
    await vscode.workspace.fs.copy(
      this.toUri(source),
      this.toUri(destination),
      {
        overwrite: options?.overwrite ?? false,
      }
    );
  }

  async findFiles(
    pattern: string,
    exclude?: string,
    maxResults?: number
  ): Promise<string[]> {
    const uris = await vscode.workspace.findFiles(
      pattern,
      exclude ?? undefined,
      maxResults
    );
    return uris.map((uri) => uri.fsPath);
  }

  createFileWatcher(pattern: string): IFileWatcher {
    const watcher = vscode.workspace.createFileSystemWatcher(pattern);

    const [onDidChange, fireChange] = createEvent<string>();
    const [onDidCreate, fireCreate] = createEvent<string>();
    const [onDidDelete, fireDelete] = createEvent<string>();

    const changeDisposable = watcher.onDidChange((uri) =>
      fireChange(uri.fsPath)
    );
    const createDisposable = watcher.onDidCreate((uri) =>
      fireCreate(uri.fsPath)
    );
    const deleteDisposable = watcher.onDidDelete((uri) =>
      fireDelete(uri.fsPath)
    );

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
