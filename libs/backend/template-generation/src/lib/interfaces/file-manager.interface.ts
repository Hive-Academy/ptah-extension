import { Result } from '@ptah-extension/shared';

/**
 * Interface for template file management
 * Adapted from IMemoryBankFileManager
 */
export interface ITemplateFileManager {
  /**
   * Creates the template output directory structure
   * @param baseDir - Base directory for template output
   * @returns Result indicating success or failure
   */
  createTemplateDirectory(baseDir: string): Promise<Result<void>>;

  /**
   * Writes a generated template file
   * @param path - File path to write
   * @param content - Template content to write
   * @returns Result indicating success or failure
   */
  writeTemplateFile(path: string, content: string): Promise<Result<void>>;

  /**
   * Reads a template file
   * @param path - File path to read
   * @returns Result containing file content or error
   */
  readTemplateFile(path: string): Promise<Result<string>>;

  /**
   * Recursively copies a directory
   * @param sourceDir - Source directory path
   * @param destDir - Destination directory path
   * @returns Result indicating success or failure
   */
  copyDirectoryRecursive(
    sourceDir: string,
    destDir: string
  ): Promise<Result<void, Error>>;
}
