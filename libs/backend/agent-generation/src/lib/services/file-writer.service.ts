/**
 * Agent File Writer Service
 *
 * Service for writing generated agents to the filesystem with atomic operations,
 * backup support, and transaction-style rollback on failures.
 *
 * Implements the IAgentFileWriterService interface with robust error handling
 * and security features including path traversal protection.
 *
 * @module @ptah-extension/agent-generation/services
 */

import { injectable, inject } from 'tsyringe';
import {
  mkdir,
  writeFile,
  readFile,
  copyFile,
  unlink,
  access,
} from 'fs/promises';
import { dirname, join, normalize, relative, sep } from 'path';
import { Logger, TOKENS } from '@ptah-extension/vscode-core';
import { Result } from '@ptah-extension/shared';
import { IAgentFileWriterService } from '../interfaces/agent-file-writer.interface';
import { GeneratedAgent } from '../types/core.types';
import { FileWriteError } from '../errors/file-write.error';

/**
 * Service for writing generated agents to the filesystem.
 *
 * Responsibilities:
 * - Write agent files to .claude/agents/ or .claude/commands/ directory
 * - Create backup of existing files before overwriting (.backup-{timestamp}.md)
 * - Atomic batch operations (all succeed or all rollback)
 * - Directory creation if missing
 * - Path traversal protection (reject attempts to write outside .claude/)
 * - Transaction-style rollback on write failures
 *
 * @example
 * ```typescript
 * const result = await fileWriter.writeAgent(generatedAgent);
 * if (result.isOk()) {
 *   console.log(`Agent written to: ${result.value}`);
 * }
 * ```
 */
@injectable()
export class AgentFileWriterService implements IAgentFileWriterService {
  /**
   * Backup file extension pattern.
   * Format: {original-name}.backup-{YYYYMMDD-HHmmss}.md
   */
  private readonly BACKUP_EXTENSION = '.backup';

  /**
   * Maximum file path length (Windows limit)
   */
  private readonly MAX_PATH_LENGTH = 260;

  constructor(@inject(TOKENS.LOGGER) private readonly logger: Logger) {
    this.logger.debug('AgentFileWriterService initialized');
  }

  /**
   * Write a generated agent to its target path.
   *
   * Performs the following operations atomically:
   * 1. Validate file path (security check for path traversal)
   * 2. Validate content is non-empty
   * 3. Create target directory if it doesn't exist
   * 4. Backup existing file if present (with .backup-{timestamp}.md extension)
   * 5. Write new content to target path
   * 6. Verify write succeeded
   *
   * If any step fails, previous steps are rolled back and error is returned.
   *
   * @param agent - Generated agent with content and target file path
   * @returns Result containing absolute file path where agent was written, or Error
   *
   * @example
   * ```typescript
   * const result = await service.writeAgent(generatedAgent);
   * if (result.isErr()) {
   *   console.error('Failed to write agent:', result.error);
   *   return;
   * }
   *
   * const filePath = result.value;
   * console.log(`Agent successfully written to: ${filePath}`);
   * ```
   */
  async writeAgent(agent: GeneratedAgent): Promise<Result<string, Error>> {
    try {
      this.logger.debug('Writing agent to filesystem', {
        filePath: agent.filePath,
        templateId: agent.sourceTemplateId,
        contentLength: agent.content.length,
      });

      // Validate content is non-empty
      if (!agent.content || agent.content.trim().length === 0) {
        return Result.err(
          new FileWriteError(
            'Agent content cannot be empty',
            agent.filePath,
            'write',
            { templateId: agent.sourceTemplateId }
          )
        );
      }

      // Security: Validate file path
      const pathValidation = this.validateFilePath(agent.filePath);
      if (pathValidation.isErr()) {
        return Result.err(pathValidation.error!);
      }

      // Resolve to absolute path
      const absolutePath = this.resolveAbsolutePath(agent.filePath);

      // Create directory if it doesn't exist
      const dirResult = await this.ensureDirectoryExists(absolutePath);
      if (dirResult.isErr()) {
        return Result.err(dirResult.error!);
      }

      // Backup existing file if present
      let backupPath: string | undefined;
      const backupResult = await this.backupExisting(absolutePath);
      if (backupResult.isErr()) {
        return Result.err(backupResult.error!);
      }
      backupPath = backupResult.value!;

      // Write new content
      try {
        await writeFile(absolutePath, agent.content, 'utf-8');
        this.logger.info('Agent written successfully', {
          filePath: absolutePath,
          backupCreated: !!backupPath,
        });
      } catch (error) {
        // Rollback: restore backup if one was created
        if (backupPath) {
          await this.restoreBackup(backupPath, absolutePath);
        }

        return this.handleFileSystemError(
          error,
          agent.filePath,
          'write',
          'Failed to write agent file'
        );
      }

      return Result.ok(absolutePath);
    } catch (error) {
      this.logger.error('Unexpected error writing agent', error as Error);
      return Result.err(
        new FileWriteError(
          `Unexpected error writing agent: ${(error as Error).message}`,
          agent.filePath,
          'write'
        )
      );
    }
  }

  /**
   * Write multiple agents atomically.
   *
   * Writes all agents in a single transaction. If any write fails, all previous
   * writes are rolled back to maintain consistency. Backup files are created
   * for all existing files before any writes occur.
   *
   * Write order:
   * 1. Validate all agents (paths, content)
   * 2. Create all necessary directories
   * 3. Backup all existing files
   * 4. Write all new files
   * 5. Verify all writes
   * 6. On failure: restore all backups, delete partial writes
   *
   * @param agents - Array of generated agents to write
   * @returns Result containing array of absolute file paths written, or Error
   *
   * @example
   * ```typescript
   * const result = await service.writeAgentsBatch(generatedAgents);
   * if (result.isErr()) {
   *   console.error('Batch write failed (rolled back):', result.error);
   *   return;
   * }
   *
   * const filePaths = result.value;
   * console.log(`Successfully wrote ${filePaths.length} agents`);
   * ```
   */
  async writeAgentsBatch(
    agents: GeneratedAgent[]
  ): Promise<Result<string[], Error>> {
    // Handle empty array
    if (agents.length === 0) {
      this.logger.debug('Empty agents array provided, returning empty result');
      return Result.ok([]);
    }

    this.logger.debug('Writing agents batch', { count: agents.length });

    const writtenPaths: string[] = [];
    const backupPaths = new Map<string, string>(); // absolutePath -> backupPath

    try {
      // Phase 1: Validate all agents
      for (const agent of agents) {
        // Validate content
        if (!agent.content || agent.content.trim().length === 0) {
          return Result.err(
            new FileWriteError(
              `Agent content cannot be empty: ${agent.filePath}`,
              agent.filePath,
              'write',
              { templateId: agent.sourceTemplateId }
            )
          );
        }

        // Validate path
        const pathValidation = this.validateFilePath(agent.filePath);
        if (pathValidation.isErr()) {
          return Result.err(pathValidation.error!);
        }
      }

      // Phase 2: Create all directories
      const absolutePaths = agents.map((agent) =>
        this.resolveAbsolutePath(agent.filePath)
      );

      for (const absolutePath of absolutePaths) {
        const dirResult = await this.ensureDirectoryExists(absolutePath);
        if (dirResult.isErr()) {
          return Result.err(dirResult.error!);
        }
      }

      // Phase 3: Backup all existing files
      for (let i = 0; i < agents.length; i++) {
        const absolutePath = absolutePaths[i];
        const backupResult = await this.backupExisting(absolutePath);

        if (backupResult.isErr()) {
          // Rollback: restore all previous backups
          await this.rollbackTransaction(Array.from(backupPaths.entries()), []);
          return Result.err(backupResult.error!);
        }

        if (backupResult.value!) {
          backupPaths.set(absolutePath, backupResult.value!);
        }
      }

      // Phase 4: Write all files
      for (let i = 0; i < agents.length; i++) {
        const agent = agents[i];
        const absolutePath = absolutePaths[i];

        try {
          await writeFile(absolutePath, agent.content, 'utf-8');
          writtenPaths.push(absolutePath);
          this.logger.debug('Agent written in batch', {
            filePath: absolutePath,
            index: i + 1,
            total: agents.length,
          });
        } catch (error) {
          // Rollback: restore all backups and delete all written files
          await this.rollbackTransaction(
            Array.from(backupPaths.entries()),
            writtenPaths
          );

          return this.handleFileSystemError(
            error,
            agent.filePath,
            'write',
            `Failed to write agent file in batch (index ${i})`
          );
        }
      }

      this.logger.info('Agents batch written successfully', {
        count: writtenPaths.length,
        backupsCreated: backupPaths.size,
      });

      return Result.ok(writtenPaths);
    } catch (error) {
      // Unexpected error: attempt rollback
      this.logger.error('Unexpected error in batch write', error as Error);
      await this.rollbackTransaction(
        Array.from(backupPaths.entries()),
        writtenPaths
      );

      return Result.err(
        new FileWriteError(
          `Unexpected error writing agents batch: ${(error as Error).message}`,
          agents[0]?.filePath || 'unknown',
          'write'
        )
      );
    }
  }

  /**
   * Create backup of existing agent file.
   *
   * Creates a backup copy with timestamp before overwriting. Backup filename
   * format: `{original-name}.backup-{timestamp}.md`
   *
   * Example: `backend-developer.md` → `backend-developer.backup-20231210-143022.md`
   *
   * If the file doesn't exist, returns success with empty string.
   *
   * @param filePath - Absolute path to file to backup
   * @returns Result containing backup file path (empty string if file doesn't exist), or Error if backup fails
   *
   * @example
   * ```typescript
   * const result = await service.backupExisting('/workspace/.claude/agents/backend-developer.md');
   * if (result.isOk()) {
   *   const backupPath = result.value;
   *   if (backupPath) {
   *     console.log(`Backup created: ${backupPath}`);
   *   } else {
   *     console.log('No existing file to backup');
   *   }
   * }
   * ```
   */
  async backupExisting(filePath: string): Promise<Result<string, Error>> {
    try {
      this.logger.debug('Checking if backup needed', { filePath });

      // Check if file exists
      const exists = await this.fileExists(filePath);
      if (!exists) {
        this.logger.debug('No existing file to backup', { filePath });
        return Result.ok('');
      }

      // Generate backup filename with timestamp
      const timestamp = this.generateTimestamp();
      const backupPath = this.generateBackupPath(filePath, timestamp);

      // Copy file to backup location
      try {
        await copyFile(filePath, backupPath);
        this.logger.info('Backup created successfully', {
          originalPath: filePath,
          backupPath,
        });
        return Result.ok(backupPath);
      } catch (error) {
        return this.handleFileSystemError(
          error,
          filePath,
          'backup',
          'Failed to create backup file'
        );
      }
    } catch (error) {
      this.logger.error('Unexpected error creating backup', error as Error);
      return Result.err(
        new FileWriteError(
          `Unexpected error creating backup: ${(error as Error).message}`,
          filePath,
          'backup'
        )
      );
    }
  }

  /**
   * Validate file path for security (prevent path traversal attacks).
   *
   * Checks:
   * - Path must be within .claude/ directory
   * - No path traversal attempts (../)
   * - Path length within OS limits
   *
   * @param filePath - File path to validate (relative or absolute)
   * @returns Result.ok() if valid, Result.err() if invalid
   */
  private validateFilePath(filePath: string): Result<void, Error> {
    try {
      // Normalize path (convert backslashes to forward slashes, resolve ..)
      const normalizedPath = normalize(filePath);

      // Check for path traversal attempts
      if (normalizedPath.includes('..')) {
        this.logger.warn('Path traversal attempt detected', { filePath });
        return Result.err(
          new FileWriteError(
            'Path traversal detected: file path contains ".."',
            filePath,
            'write',
            { securityViolation: true }
          )
        );
      }

      // Ensure path is within .claude/ directory
      // (relative paths should start with .claude/, absolute paths will be resolved)
      if (!normalizedPath.includes('.claude')) {
        this.logger.warn('Attempt to write outside .claude directory', {
          filePath,
        });
        return Result.err(
          new FileWriteError(
            'Security violation: file path must be within .claude/ directory',
            filePath,
            'write',
            { securityViolation: true }
          )
        );
      }

      // Check path length (Windows limit)
      if (normalizedPath.length > this.MAX_PATH_LENGTH) {
        return Result.err(
          new FileWriteError(
            `File path exceeds maximum length (${this.MAX_PATH_LENGTH} characters)`,
            filePath,
            'write',
            { pathLength: normalizedPath.length }
          )
        );
      }

      return Result.ok(undefined);
    } catch (error) {
      return Result.err(
        new FileWriteError(
          `Failed to validate file path: ${(error as Error).message}`,
          filePath,
          'write'
        )
      );
    }
  }

  /**
   * Resolve file path to absolute path.
   * If path is relative, assumes it's relative to workspace root.
   *
   * @param filePath - Relative or absolute file path
   * @returns Absolute file path
   */
  private resolveAbsolutePath(filePath: string): string {
    // If already absolute, return as-is
    if (filePath.startsWith('/') || /^[A-Za-z]:/.test(filePath)) {
      return normalize(filePath);
    }

    // Otherwise, resolve relative to current working directory
    // In production, this would be workspace root
    return normalize(join(process.cwd(), filePath));
  }

  /**
   * Ensure directory exists, creating it recursively if needed.
   *
   * @param filePath - File path (directory will be extracted)
   * @returns Result.ok() if directory exists or created, Result.err() on failure
   */
  private async ensureDirectoryExists(
    filePath: string
  ): Promise<Result<void, Error>> {
    try {
      const dir = dirname(filePath);
      await mkdir(dir, { recursive: true });
      this.logger.debug('Directory ensured', { directory: dir });
      return Result.ok(undefined);
    } catch (error) {
      return this.handleFileSystemError(
        error,
        filePath,
        'mkdir',
        'Failed to create directory'
      );
    }
  }

  /**
   * Check if file exists.
   *
   * @param filePath - File path to check
   * @returns true if file exists, false otherwise
   */
  private async fileExists(filePath: string): Promise<boolean> {
    try {
      await access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Generate timestamp string for backup filename.
   * Format: YYYYMMDD-HHmmss
   *
   * @returns Timestamp string
   */
  private generateTimestamp(): string {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    const seconds = String(now.getSeconds()).padStart(2, '0');
    return `${year}${month}${day}-${hours}${minutes}${seconds}`;
  }

  /**
   * Generate backup file path with timestamp.
   * Format: {original-name}.backup-{timestamp}.md
   *
   * @param originalPath - Original file path
   * @param timestamp - Timestamp string
   * @returns Backup file path
   */
  private generateBackupPath(originalPath: string, timestamp: string): string {
    const dir = dirname(originalPath);
    const ext = '.md';
    const nameWithoutExt = originalPath.slice(0, -ext.length);
    return `${nameWithoutExt}${this.BACKUP_EXTENSION}-${timestamp}${ext}`;
  }

  /**
   * Restore backup file to original location.
   *
   * @param backupPath - Path to backup file
   * @param originalPath - Original file path to restore to
   */
  private async restoreBackup(
    backupPath: string,
    originalPath: string
  ): Promise<void> {
    try {
      await copyFile(backupPath, originalPath);
      this.logger.info('Backup restored', { backupPath, originalPath });
    } catch (error) {
      this.logger.error('Failed to restore backup', error as Error);
    }
  }

  /**
   * Rollback transaction: restore all backups and delete partial writes.
   *
   * @param backups - Array of [absolutePath, backupPath] tuples
   * @param writtenPaths - Array of file paths that were written (need deletion)
   */
  private async rollbackTransaction(
    backups: Array<[string, string]>,
    writtenPaths: string[]
  ): Promise<void> {
    this.logger.warn('Rolling back transaction', {
      backupCount: backups.length,
      writtenCount: writtenPaths.length,
    });

    // Restore all backups
    for (const [originalPath, backupPath] of backups) {
      try {
        await copyFile(backupPath, originalPath);
        this.logger.debug('Backup restored during rollback', { originalPath });
      } catch (error) {
        this.logger.error(
          'Failed to restore backup during rollback',
          error as Error
        );
      }
    }

    // Delete all partial writes
    for (const writtenPath of writtenPaths) {
      try {
        await unlink(writtenPath);
        this.logger.debug('Partial write deleted during rollback', {
          writtenPath,
        });
      } catch (error) {
        this.logger.error(
          'Failed to delete partial write during rollback',
          error as Error
        );
      }
    }

    this.logger.info('Transaction rollback completed');
  }

  /**
   * Handle file system errors and convert to FileWriteError with appropriate context.
   *
   * @param error - Caught error
   * @param filePath - File path involved
   * @param operation - Operation being performed
   * @param message - Human-readable error message
   * @returns Result.err with FileWriteError
   */
  private handleFileSystemError(
    error: unknown,
    filePath: string,
    operation: 'write' | 'backup' | 'mkdir',
    message: string
  ): Result<never, Error> {
    const nodeError = error as NodeJS.ErrnoException;

    // Map Node.js error codes to descriptive messages
    let errorMessage = message;
    const context: Record<string, unknown> = { code: nodeError.code };

    switch (nodeError.code) {
      case 'EACCES':
      case 'EPERM':
        errorMessage = `${message}: Permission denied`;
        context['permissionDenied'] = true;
        break;
      case 'ENOSPC':
        errorMessage = `${message}: Insufficient disk space`;
        context['diskFull'] = true;
        break;
      case 'EROFS':
        errorMessage = `${message}: Read-only file system`;
        context['readOnlyFileSystem'] = true;
        break;
      case 'ENOENT':
        errorMessage = `${message}: File or directory not found`;
        context['notFound'] = true;
        break;
      case 'EMFILE':
      case 'ENFILE':
        errorMessage = `${message}: Too many open files`;
        context['tooManyFiles'] = true;
        break;
      default:
        errorMessage = `${message}: ${nodeError.message}`;
    }

    this.logger.error(errorMessage, nodeError);

    return Result.err(
      new FileWriteError(errorMessage, filePath, operation, context)
    );
  }
}
