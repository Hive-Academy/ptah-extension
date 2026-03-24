import { injectable, inject } from 'tsyringe';
import * as path from 'path';
import { Result } from '@ptah-extension/shared';
import { PLATFORM_TOKENS } from '@ptah-extension/platform-core';
import type { IFileSystemProvider } from '@ptah-extension/platform-core';
import { FileType } from '@ptah-extension/platform-core';

/**
 * FileSystemAdapter - Adapter for platform-agnostic file system operations
 *
 * Bridges the API gap between template-generation (string paths, Result returns)
 * and IFileSystemProvider (string-based, throws errors).
 *
 * Responsibilities:
 * - Wrap IFileSystemProvider calls with Result<T, Error> pattern
 * - Implement missing methods (copyDirectoryRecursive)
 * - Catch thrown errors and return as Result.err()
 */
@injectable()
export class FileSystemAdapter {
  constructor(
    @inject(PLATFORM_TOKENS.FILE_SYSTEM_PROVIDER)
    private readonly fs: IFileSystemProvider
  ) {}

  /**
   * Read file contents as string
   * @param filePath - Absolute file path (string)
   * @returns Result containing file content or error
   */
  async readFile(filePath: string): Promise<Result<string, Error>> {
    try {
      const content = await this.fs.readFile(filePath);
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
      await this.fs.writeFile(filePath, content);
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
      await this.fs.createDirectory(dirPath);
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
      // Read source directory
      const entries = await this.fs.readDirectory(sourceDir);

      // Create destination directory
      await this.fs.createDirectory(destDir);

      // Copy each entry recursively
      for (const entry of entries) {
        const srcPath = path.join(sourceDir, entry.name);
        const dstPath = path.join(destDir, entry.name);

        if (entry.type === FileType.Directory) {
          // Recursive copy for directories
          const recursiveResult = await this.copyDirectoryRecursive(
            srcPath,
            dstPath
          );
          if (recursiveResult.isErr()) {
            return recursiveResult;
          }
        } else {
          // Copy file
          await this.fs.copy(srcPath, dstPath, { overwrite: true });
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
      const exists = await this.fs.exists(filePath);
      return Result.ok(exists);
    } catch (error) {
      return Result.err(
        error instanceof Error ? error : new Error(String(error))
      );
    }
  }
}
