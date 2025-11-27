import { injectable, inject } from 'tsyringe';
import * as vscode from 'vscode';
import { Result } from '@ptah-extension/shared';
import { TOKENS } from '@ptah-extension/vscode-core';
import { FileSystemService } from '@ptah-extension/workspace-intelligence';

/**
 * FileSystemAdapter - Adapter for workspace-intelligence FileSystemService
 *
 * Bridges the API gap between template-generation (string paths, Result returns)
 * and workspace-intelligence FileSystemService (Uri-based, throws errors).
 *
 * Responsibilities:
 * - Convert string file paths to vscode.Uri
 * - Wrap FileSystemService calls with Result<T, Error> pattern
 * - Implement missing methods (createDirectory, writeFile, copyDirectoryRecursive)
 * - Catch thrown errors and return as Result.err()
 */
@injectable()
export class FileSystemAdapter {
  constructor(
    @inject(TOKENS.FILE_SYSTEM_SERVICE)
    private readonly fileSystemService: FileSystemService
  ) {}

  /**
   * Read file contents as string
   * @param filePath - Absolute file path (string)
   * @returns Result containing file content or error
   */
  async readFile(filePath: string): Promise<Result<string, Error>> {
    try {
      const uri = vscode.Uri.file(filePath);
      const content = await this.fileSystemService.readFile(uri);
      return Result.ok(content);
    } catch (error) {
      return Result.err(
        error instanceof Error ? error : new Error(String(error))
      );
    }
  }

  /**
   * Write file contents (creates parent directories if needed)
   * @param filePath - Absolute file path (string)
   * @param content - File content to write
   * @returns Result indicating success or error
   */
  async writeFile(
    filePath: string,
    content: string
  ): Promise<Result<void, Error>> {
    try {
      const uri = vscode.Uri.file(filePath);
      const bytes = new TextEncoder().encode(content);
      await vscode.workspace.fs.writeFile(uri, bytes);
      return Result.ok(undefined);
    } catch (error) {
      return Result.err(
        error instanceof Error ? error : new Error(String(error))
      );
    }
  }

  /**
   * Create directory (including parent directories)
   * @param dirPath - Absolute directory path (string)
   * @returns Result indicating success or error
   */
  async createDirectory(dirPath: string): Promise<Result<void, Error>> {
    try {
      const uri = vscode.Uri.file(dirPath);
      await vscode.workspace.fs.createDirectory(uri);
      return Result.ok(undefined);
    } catch (error) {
      return Result.err(
        error instanceof Error ? error : new Error(String(error))
      );
    }
  }

  /**
   * Recursively copy directory from source to destination
   * @param sourceDir - Source directory path (string)
   * @param destDir - Destination directory path (string)
   * @returns Result indicating success or error
   */
  async copyDirectoryRecursive(
    sourceDir: string,
    destDir: string
  ): Promise<Result<void, Error>> {
    try {
      const sourceUri = vscode.Uri.file(sourceDir);
      const destUri = vscode.Uri.file(destDir);

      // Read source directory
      const entries = await this.fileSystemService.readDirectory(sourceUri);

      // Create destination directory
      await vscode.workspace.fs.createDirectory(destUri);

      // Copy each entry recursively
      for (const [name, type] of entries) {
        const srcPath = vscode.Uri.joinPath(sourceUri, name);
        const dstPath = vscode.Uri.joinPath(destUri, name);

        if (type === vscode.FileType.Directory) {
          // Recursive copy for directories
          const recursiveResult = await this.copyDirectoryRecursive(
            srcPath.fsPath,
            dstPath.fsPath
          );
          if (recursiveResult.isErr()) {
            return recursiveResult;
          }
        } else {
          // Copy file
          await vscode.workspace.fs.copy(srcPath, dstPath, { overwrite: true });
        }
      }

      return Result.ok(undefined);
    } catch (error) {
      return Result.err(
        error instanceof Error ? error : new Error(String(error))
      );
    }
  }

  /**
   * Check if file/directory exists
   * @param filePath - File or directory path (string)
   * @returns Result containing boolean or error
   */
  async exists(filePath: string): Promise<Result<boolean, Error>> {
    try {
      const uri = vscode.Uri.file(filePath);
      const exists = await this.fileSystemService.exists(uri);
      return Result.ok(exists);
    } catch (error) {
      return Result.err(
        error instanceof Error ? error : new Error(String(error))
      );
    }
  }
}
