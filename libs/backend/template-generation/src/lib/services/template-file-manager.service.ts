import path from 'path';
import { injectable, inject } from 'tsyringe';
import { Result } from '@ptah-extension/shared';
import { Logger, FileSystemService, TOKENS } from '@ptah-extension/vscode-core';
import { ITemplateFileManager } from '../interfaces';
import { TemplateFileError } from '../errors';

/**
 * Template File Manager Service
 * Handles file operations for template generation
 * Adapted from roocode-generator MemoryBankFileManager
 */
@injectable()
export class TemplateFileManagerService implements ITemplateFileManager {
  constructor(
    @inject(TOKENS.FILE_SYSTEM) private readonly fileSystem: FileSystemService,
    @inject(TOKENS.LOGGER) private readonly logger: Logger
  ) {}

  /**
   * Helper method to create, log, and return a TemplateFileError Result
   */
  private _handleFileError(
    message: string,
    filePath: string,
    operation: string,
    cause?: Error | null
  ): Result<never> {
    const error = new TemplateFileError(
      message,
      filePath,
      { operation },
      cause ?? undefined
    );
    this.logger.error(error.message, error);
    return Result.err(error);
  }

  /**
   * Helper method for wrapping errors caught in catch blocks
   */
  private _wrapCaughtError(
    message: string,
    filePathOrContext: string,
    operation: string,
    caughtError: unknown
  ): Result<never> {
    const cause =
      caughtError instanceof Error
        ? caughtError
        : new Error(String(caughtError));
    return this._handleFileError(message, filePathOrContext, operation, cause);
  }

  /**
   * Creates the template output directory structure
   * @param baseDir - Base directory for template output
   * @returns Result indicating success or failure
   */
  async createTemplateDirectory(baseDir: string): Promise<Result<void>> {
    try {
      // Create generated-templates directory
      const templatesDir = path.join(baseDir, 'generated-templates');
      this.logger.debug(`Creating template directory: ${templatesDir}`);

      const dirResult = await this.fileSystem.createDirectory(templatesDir);
      if (dirResult.isErr()) {
        // If directory already exists, that's fine
        if (dirResult.error?.message.includes('EEXIST')) {
          this.logger.debug(
            `Template directory already exists: ${templatesDir}`
          );
        } else {
          return this._handleFileError(
            'Failed to create template directory',
            templatesDir,
            'createDirectory',
            dirResult.error
          );
        }
      } else {
        this.logger.debug(`Created template directory: ${templatesDir}`);
      }

      return Result.ok(undefined);
    } catch (error) {
      return this._wrapCaughtError(
        'Error creating template directory structure',
        baseDir,
        'createStructure',
        error
      );
    }
  }

  /**
   * Writes a generated template file
   * @param filePath - File path to write
   * @param content - Template content to write
   * @returns Result indicating success or failure
   */
  async writeTemplateFile(
    filePath: string,
    content: string
  ): Promise<Result<void>> {
    try {
      // Ensure the directory exists before writing the file
      const dirPath = path.dirname(filePath);
      const dirResult = await this.fileSystem.createDirectory(dirPath);
      if (dirResult.isErr() && !dirResult.error?.message.includes('EEXIST')) {
        return this._handleFileError(
          'Failed to create directory for file',
          dirPath,
          'createDirectory',
          dirResult.error
        );
      }

      this.logger.debug(`Writing template file: ${filePath}`);
      const result = await this.fileSystem.writeFile(filePath, content);
      if (result.isErr()) {
        return this._handleFileError(
          'Failed to write template file',
          filePath,
          'writeFile',
          result.error
        );
      }
      this.logger.debug(`Successfully wrote template file: ${filePath}`);
      return Result.ok(undefined);
    } catch (error) {
      return this._wrapCaughtError(
        'Error writing template file',
        filePath,
        'writeFileCatch',
        error
      );
    }
  }

  /**
   * Reads a template file
   * @param filePath - File path to read
   * @returns Result containing file content or error
   */
  async readTemplateFile(filePath: string): Promise<Result<string>> {
    try {
      this.logger.debug(`Reading template file: ${filePath}`);
      const result = await this.fileSystem.readFile(filePath);
      if (result.isErr()) {
        if (result.error?.message.includes('ENOENT')) {
          this.logger.debug(`Template file does not exist: ${filePath}`);
        } else {
          this.logger.error(
            `Failed to read template file (non-ENOENT): ${filePath}`,
            result.error ?? new Error('Unknown error')
          );
        }
        const message = result.error?.message.includes('ENOENT')
          ? 'Template file not found'
          : 'Failed to read template file';
        return this._handleFileError(
          message,
          filePath,
          'readFile',
          result.error
        );
      }
      if (result.value === undefined) {
        return this._handleFileError(
          'File content is undefined',
          filePath,
          'readFile'
        );
      }
      this.logger.debug(`Successfully read template file: ${filePath}`);
      return Result.ok(result.value);
    } catch (error) {
      return this._wrapCaughtError(
        'Error reading template file',
        filePath,
        'readFileCatch',
        error
      );
    }
  }

  /**
   * Recursively copies a directory from source to destination.
   * @param sourceDir - Source directory path
   * @param destDir - Destination directory path
   * @returns A Result indicating success or failure
   */
  async copyDirectoryRecursive(
    sourceDir: string,
    destDir: string
  ): Promise<Result<void, Error>> {
    try {
      this.logger.debug(
        `Copying directory recursively from ${sourceDir} to ${destDir}`
      );

      // Use the FileSystemService to perform the actual copy
      const result = await this.fileSystem.copyDirectoryRecursive(
        sourceDir,
        destDir
      );

      if (result.isErr()) {
        return this._handleFileError(
          `Failed to copy directory ${sourceDir} to ${destDir}`,
          sourceDir,
          'copyDirectoryRecursive',
          result.error
        );
      }

      this.logger.debug(
        `Successfully copied directory from ${sourceDir} to ${destDir}`
      );
      return Result.ok(undefined);
    } catch (error) {
      return this._wrapCaughtError(
        `Unexpected error during directory copy`,
        sourceDir,
        'copyDirectoryRecursiveCatch',
        error
      );
    }
  }
}
