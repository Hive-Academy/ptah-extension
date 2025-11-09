/**
 * File System Service
 *
 * VS Code workspace.fs wrapper for async, platform-agnostic file operations.
 * Replaces Node.js fs module for virtual workspace support.
 *
 * Research Finding 2: Migrate from Node.js fs to workspace.fs API
 * Evidence: workspace.fs handles all URI schemes (file, vscode-vfs, untitled)
 */

import { injectable } from 'tsyringe';
import * as vscode from 'vscode';

/**
 * File system service with VS Code workspace.fs wrapper
 */
@injectable()
export class FileSystemService {
  /**
   * Read file contents as string
   *
   * @param uri File URI (supports all schemes: file://, vscode-vfs://, untitled://)
   * @returns File contents as UTF-8 string
   */
  async readFile(uri: vscode.Uri): Promise<string> {
    try {
      const bytes = await vscode.workspace.fs.readFile(uri);
      return new TextDecoder('utf-8').decode(bytes);
    } catch (error) {
      throw new FileSystemError(
        `Failed to read file: ${uri.toString()}`,
        error instanceof Error ? error : undefined
      );
    }
  }

  /**
   * Read directory contents
   *
   * @param uri Directory URI
   * @returns Array of [name, fileType] tuples
   */
  async readDirectory(uri: vscode.Uri): Promise<[string, vscode.FileType][]> {
    try {
      return await vscode.workspace.fs.readDirectory(uri);
    } catch (error) {
      throw new FileSystemError(
        `Failed to read directory: ${uri.toString()}`,
        error instanceof Error ? error : undefined
      );
    }
  }

  /**
   * Get file/directory stats
   *
   * @param uri File or directory URI
   * @returns File stats (type, size, timestamps)
   */
  async stat(uri: vscode.Uri): Promise<vscode.FileStat> {
    try {
      return await vscode.workspace.fs.stat(uri);
    } catch (error) {
      throw new FileSystemError(
        `Failed to stat: ${uri.toString()}`,
        error instanceof Error ? error : undefined
      );
    }
  }

  /**
   * Check if URI points to a virtual workspace
   *
   * Virtual workspaces use schemes other than 'file' (e.g., vscode-vfs, untitled)
   *
   * @param uri URI to check
   * @returns True if virtual workspace
   */
  isVirtualWorkspace(uri: vscode.Uri): boolean {
    return uri.scheme !== 'file';
  }

  /**
   * Check if file/directory exists
   *
   * @param uri File or directory URI
   * @returns True if exists
   */
  async exists(uri: vscode.Uri): Promise<boolean> {
    try {
      await vscode.workspace.fs.stat(uri);
      return true;
    } catch {
      return false;
    }
  }
}

/**
 * File system error with context
 */
export class FileSystemError extends Error {
  constructor(message: string, public readonly cause?: Error) {
    super(message);
    this.name = 'FileSystemError';

    // Maintain stack trace
    if (cause?.stack) {
      this.stack = `${this.stack}\nCaused by: ${cause.stack}`;
    }
  }
}
