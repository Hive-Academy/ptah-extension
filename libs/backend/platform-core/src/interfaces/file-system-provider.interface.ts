/**
 * IFileSystemProvider — Platform-agnostic file system operations.
 *
 * Replaces: vscode.workspace.fs.*, vscode.workspace.findFiles(),
 *           vscode.workspace.createFileSystemWatcher()
 *
 * All paths are string-based (no vscode.Uri). The VS Code implementation
 * handles string-to-Uri conversion internally.
 */

import type {
  FileStat,
  DirectoryEntry,
  IFileWatcher,
} from '../types/platform.types';

export interface IFileSystemProvider {
  /**
   * Read file contents as UTF-8 string.
   * Replaces: vscode.workspace.fs.readFile() + TextDecoder
   */
  readFile(path: string): Promise<string>;

  /**
   * Read file contents as binary (Uint8Array).
   * Replaces: vscode.workspace.fs.readFile()
   */
  readFileBytes(path: string): Promise<Uint8Array>;

  /**
   * Write string content to a file (creates parent dirs if needed).
   * Replaces: vscode.workspace.fs.writeFile()
   */
  writeFile(path: string, content: string): Promise<void>;

  /**
   * Write binary content to a file.
   * Replaces: vscode.workspace.fs.writeFile()
   */
  writeFileBytes(path: string, content: Uint8Array): Promise<void>;

  /**
   * Read directory entries.
   * Replaces: vscode.workspace.fs.readDirectory()
   */
  readDirectory(path: string): Promise<DirectoryEntry[]>;

  /**
   * Get file or directory stats.
   * Replaces: vscode.workspace.fs.stat()
   */
  stat(path: string): Promise<FileStat>;

  /**
   * Check if a file or directory exists.
   * Replaces: try { await vscode.workspace.fs.stat(uri) } catch { false }
   */
  exists(path: string): Promise<boolean>;

  /**
   * Delete a file or directory.
   * Replaces: vscode.workspace.fs.delete()
   */
  delete(path: string, options?: { recursive?: boolean }): Promise<void>;

  /**
   * Create a directory (including parent directories).
   * Replaces: vscode.workspace.fs.createDirectory()
   */
  createDirectory(path: string): Promise<void>;

  /**
   * Copy a file or directory.
   * Replaces: vscode.workspace.fs.copy()
   */
  copy(
    source: string,
    destination: string,
    options?: { overwrite?: boolean },
  ): Promise<void>;

  /**
   * Find files matching a glob pattern in the workspace.
   * Replaces: vscode.workspace.findFiles()
   *
   * @param pattern - Glob pattern (e.g., '**\/*.ts')
   * @param exclude - Optional exclusion glob pattern
   * @param maxResults - Maximum number of results
   * @returns Array of absolute file paths
   */
  findFiles(
    pattern: string,
    exclude?: string,
    maxResults?: number,
    cwd?: string,
  ): Promise<string[]>;

  /**
   * Create a file system watcher.
   * Replaces: vscode.workspace.createFileSystemWatcher()
   *
   * @param pattern - Glob pattern to watch
   * @returns File watcher with change/create/delete events
   */
  createFileWatcher(pattern: string): IFileWatcher;
}
