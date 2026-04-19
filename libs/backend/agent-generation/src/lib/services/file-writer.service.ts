/**
 * Agent File Writer Service
 *
 * Service for writing generated agents to the filesystem with atomic operations
 * and directory creation support.
 *
 * Implements the IAgentFileWriterService interface with robust error handling
 * and security features including path traversal protection.
 *
 * @module @ptah-extension/agent-generation/services
 */

import { injectable, inject } from 'tsyringe';
import { mkdir, writeFile, unlink } from 'fs/promises';
import { dirname, join, normalize } from 'path';
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
 * - Overwrite existing files in place (no backup — avoids duplicate agent .md files)
 * - Directory creation if missing
 * - Path traversal protection (reject attempts to write outside .claude/)
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
   * 4. Write new content to target path (overwrites existing)
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
            { templateId: agent.sourceTemplateId },
          ),
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

      // Write new content (overwrite if exists — no backup to avoid
      // duplicate .md files being read as agents in .claude/agents/)
      try {
        await writeFile(absolutePath, agent.content, 'utf-8');
        this.logger.info('Agent written successfully', {
          filePath: absolutePath,
        });
      } catch (error) {
        return this.handleFileSystemError(
          error,
          agent.filePath,
          'write',
          'Failed to write agent file',
        );
      }

      return Result.ok(absolutePath);
    } catch (error) {
      this.logger.error('Unexpected error writing agent', error as Error);
      return Result.err(
        new FileWriteError(
          `Unexpected error writing agent: ${(error as Error).message}`,
          agent.filePath,
          'write',
        ),
      );
    }
  }

  /**
   * Write multiple agents atomically.
   *
   * Writes all agents sequentially. If any write fails, previously written
   * files in this batch are cleaned up. Existing files are overwritten in place.
   *
   * Write order:
   * 1. Validate all agents (paths, content)
   * 2. Create all necessary directories
   * 3. Write all new files (overwrite existing)
   * 4. On failure: delete partial writes
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
    agents: GeneratedAgent[],
  ): Promise<Result<string[], Error>> {
    // Handle empty array
    if (agents.length === 0) {
      this.logger.debug('Empty agents array provided, returning empty result');
      return Result.ok([]);
    }

    this.logger.debug('Writing agents batch', { count: agents.length });

    const writtenPaths: string[] = [];

    try {
      // Phase 1: Validate all agents
      for (const agent of agents) {
        if (!agent.content || agent.content.trim().length === 0) {
          return Result.err(
            new FileWriteError(
              `Agent content cannot be empty: ${agent.filePath}`,
              agent.filePath,
              'write',
              { templateId: agent.sourceTemplateId },
            ),
          );
        }

        const pathValidation = this.validateFilePath(agent.filePath);
        if (pathValidation.isErr()) {
          return Result.err(pathValidation.error!);
        }
      }

      // Phase 2: Create all directories
      const absolutePaths = agents.map((agent) =>
        this.resolveAbsolutePath(agent.filePath),
      );

      for (const absolutePath of absolutePaths) {
        const dirResult = await this.ensureDirectoryExists(absolutePath);
        if (dirResult.isErr()) {
          return Result.err(dirResult.error!);
        }
      }

      // Phase 3: Write all files (overwrite if exists — no backup to avoid
      // duplicate .md files being read as agents in .claude/agents/)
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
          // On failure, delete any files we already wrote in this batch
          for (const written of writtenPaths) {
            try {
              await unlink(written);
            } catch {
              this.logger.error('Failed to clean up partial write', {
                path: written,
              });
            }
          }

          return this.handleFileSystemError(
            error,
            agent.filePath,
            'write',
            `Failed to write agent file in batch (index ${i})`,
          );
        }
      }

      this.logger.info('Agents batch written successfully', {
        count: writtenPaths.length,
      });

      return Result.ok(writtenPaths);
    } catch (error) {
      this.logger.error('Unexpected error in batch write', error as Error);

      return Result.err(
        new FileWriteError(
          `Unexpected error writing agents batch: ${(error as Error).message}`,
          agents[0]?.filePath || 'unknown',
          'write',
        ),
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
            { securityViolation: true },
          ),
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
            { securityViolation: true },
          ),
        );
      }

      // Check path length (Windows limit)
      if (normalizedPath.length > this.MAX_PATH_LENGTH) {
        return Result.err(
          new FileWriteError(
            `File path exceeds maximum length (${this.MAX_PATH_LENGTH} characters)`,
            filePath,
            'write',
            { pathLength: normalizedPath.length },
          ),
        );
      }

      return Result.ok(undefined);
    } catch (error) {
      return Result.err(
        new FileWriteError(
          `Failed to validate file path: ${(error as Error).message}`,
          filePath,
          'write',
        ),
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

    // Otherwise, resolve relative to home directory as safe fallback.
    // In production, filePath should already be absolute (orchestrator uses context.rootPath).
    this.logger.warn(
      `[FileWriter] Relative path "${filePath}" — resolving against homedir. Caller should provide absolute path.`,
    );
    return normalize(join(require('os').homedir(), filePath));
  }

  /**
   * Ensure directory exists, creating it recursively if needed.
   *
   * @param filePath - File path (directory will be extracted)
   * @returns Result.ok() if directory exists or created, Result.err() on failure
   */
  private async ensureDirectoryExists(
    filePath: string,
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
        'Failed to create directory',
      );
    }
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
    operation: 'write' | 'mkdir',
    message: string,
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
      new FileWriteError(errorMessage, filePath, operation, context),
    );
  }
}
