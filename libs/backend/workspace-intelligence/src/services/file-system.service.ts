/**
 * File System Service
 *
 * Platform-agnostic file system wrapper that delegates to IFileSystemProvider.
 * Supports string-based paths (no vscode.Uri dependency).
 *
 * Research Finding 2: Migrate from Node.js fs to platform-agnostic API
 * Evidence: IFileSystemProvider handles all URI schemes via platform-vscode adapter
 */

import { injectable, inject } from 'tsyringe';
import { PLATFORM_TOKENS, FileType } from '@ptah-extension/platform-core';
import type {
  IFileSystemProvider,
  DirectoryEntry,
  FileStat,
} from '@ptah-extension/platform-core';

/**
 * File system service with platform-agnostic provider
 */
@injectable()
export class FileSystemService {
  constructor(
    @inject(PLATFORM_TOKENS.FILE_SYSTEM_PROVIDER)
    private readonly fsProvider: IFileSystemProvider,
  ) {}

  /**
   * Read file contents as string
   *
   * @param path File path (absolute string)
   * @returns File contents as UTF-8 string
   */
  async readFile(path: string): Promise<string> {
    try {
      return await this.fsProvider.readFile(path);
    } catch (error) {
      throw new FileSystemError(
        `Failed to read file: ${path}`,
        error instanceof Error ? error : undefined,
      );
    }
  }

  /**
   * Read directory contents
   *
   * @param path Directory path (absolute string)
   * @returns Array of DirectoryEntry objects
   */
  async readDirectory(path: string): Promise<DirectoryEntry[]> {
    try {
      return await this.fsProvider.readDirectory(path);
    } catch (error) {
      throw new FileSystemError(
        `Failed to read directory: ${path}`,
        error instanceof Error ? error : undefined,
      );
    }
  }

  /**
   * Get file/directory stats
   *
   * @param path File or directory path (absolute string)
   * @returns File stats (type, size, timestamps)
   */
  async stat(path: string): Promise<FileStat> {
    try {
      return await this.fsProvider.stat(path);
    } catch (error) {
      throw new FileSystemError(
        `Failed to stat: ${path}`,
        error instanceof Error ? error : undefined,
      );
    }
  }

  /**
   * Check if path points to a virtual workspace
   *
   * Virtual workspaces use schemes other than 'file' (e.g., vscode-vfs, untitled).
   * For string-based paths, we detect this by checking for URI scheme patterns.
   *
   * @param path Path to check
   * @returns True if virtual workspace
   */
  isVirtualWorkspace(path: string): boolean {
    // If the path contains a scheme indicator (e.g., "vscode-vfs://"),
    // it's a virtual workspace. Regular file paths don't contain "://"
    return path.includes('://') && !path.startsWith('file://');
  }

  /**
   * Check if file/directory exists
   *
   * @param path File or directory path (absolute string)
   * @returns True if exists
   */
  async exists(path: string): Promise<boolean> {
    try {
      return await this.fsProvider.exists(path);
    } catch {
      return false;
    }
  }
}

/**
 * File system error with context
 */
export class FileSystemError extends Error {
  constructor(
    message: string,
    public override readonly cause?: Error,
  ) {
    super(message);
    this.name = 'FileSystemError';

    // Maintain stack trace
    if (cause?.stack) {
      this.stack = `${this.stack}\nCaused by: ${cause.stack}`;
    }
  }
}
