/**
 * Agent File Writer Service
 *
 * Service for writing generated agents to the filesystem through the
 * platform file-system port, with directory creation and path-traversal
 * protection.
 *
 * A write is idempotent: when the target already holds exactly the generated
 * bytes the file is left alone and the result says `unchanged`; otherwise it
 * is overwritten and the result says `written`.
 *
 * @module @ptah-extension/agent-generation/services
 */

import { injectable, inject } from 'tsyringe';
import { homedir } from 'os';
import { dirname, join, normalize } from 'path';
import {
  PLATFORM_TOKENS,
  type IFileSystemProvider,
} from '@ptah-extension/platform-core';
import { Logger, TOKENS } from '@ptah-extension/vscode-core';
import { Result } from '@ptah-extension/shared';
import { IAgentFileWriterService } from '../interfaces/agent-file-writer.interface';
import { GeneratedAgent } from '../types/core.types';
import { FileWriteError } from '../errors/file-write.error';

/** Outcome of one agent write. */
export type AgentWriteResult = {
  filePath: string;
  status: 'written' | 'unchanged';
};

/**
 * Service for writing generated agents to the filesystem.
 *
 * Responsibilities:
 * - Write agent files to .claude/agents/ or .claude/commands/ directory
 * - Overwrite existing files in place (no backup — avoids duplicate agent .md files)
 * - Skip the write when the existing bytes already match (`unchanged`)
 * - Directory creation if missing (explicit, through the port)
 * - Path traversal protection (reject attempts to write outside .claude/)
 */
@injectable()
export class AgentFileWriterService implements IAgentFileWriterService {
  /**
   * Maximum file path length (Windows limit)
   */
  private readonly MAX_PATH_LENGTH = 260;

  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(PLATFORM_TOKENS.FILE_SYSTEM_PROVIDER)
    private readonly fs: IFileSystemProvider,
  ) {
    this.logger.debug('AgentFileWriterService initialized');
  }

  /**
   * Write a generated agent to its target path.
   *
   * 1. Validate content is non-empty
   * 2. Validate file path (security check for path traversal)
   * 3. Create target directory if it doesn't exist
   * 4. Read the existing target; equal bytes -> `unchanged`, no write
   * 5. Otherwise write the new content -> `written`
   *
   * @param agent - Generated agent with content and target file path
   * @returns Result with the absolute file path and its write status, or Error
   */
  async writeAgent(
    agent: GeneratedAgent,
  ): Promise<Result<AgentWriteResult, Error>> {
    try {
      this.logger.debug('Writing agent to filesystem', {
        filePath: agent.filePath,
        templateId: agent.sourceTemplateId,
        contentLength: agent.content.length,
      });
      const prepared = this.prepare(agent);
      if (prepared.isErr()) {
        return Result.err(prepared.error!);
      }
      const absolutePath = prepared.value!;
      const dirResult = await this.ensureDirectoryExists(absolutePath);
      if (dirResult.isErr()) {
        return Result.err(dirResult.error!);
      }
      return await this.writeIfChanged(agent, absolutePath);
    } catch (error: unknown) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.logger.error('Unexpected error writing agent', err);
      return Result.err(
        new FileWriteError(
          `Unexpected error writing agent: ${err.message}`,
          agent.filePath,
          'write',
        ),
      );
    }
  }

  /**
   * Write multiple agents sequentially.
   *
   * All agents are validated and their directories created before any write.
   * If a write fails, files this batch newly WROTE are removed again; files
   * that were `unchanged` already existed and are left alone.
   *
   * @param agents - Array of generated agents to write
   * @returns Result containing one write result per agent, or Error
   */
  async writeAgentsBatch(
    agents: GeneratedAgent[],
  ): Promise<Result<AgentWriteResult[], Error>> {
    if (agents.length === 0) {
      this.logger.debug('Empty agents array provided, returning empty result');
      return Result.ok([]);
    }

    this.logger.debug('Writing agents batch', { count: agents.length });

    const results: AgentWriteResult[] = [];

    try {
      const absolutePaths: string[] = [];
      for (const agent of agents) {
        const prepared = this.prepare(agent);
        if (prepared.isErr()) {
          return Result.err(prepared.error!);
        }
        absolutePaths.push(prepared.value!);
      }

      for (const absolutePath of absolutePaths) {
        const dirResult = await this.ensureDirectoryExists(absolutePath);
        if (dirResult.isErr()) {
          return Result.err(dirResult.error!);
        }
      }
      for (let i = 0; i < agents.length; i++) {
        const agent = agents[i];
        const absolutePath = absolutePaths[i];
        const writeResult = await this.writeIfChanged(agent, absolutePath);
        if (writeResult.isErr()) {
          await this.rollback(results);
          return Result.err(
            new FileWriteError(
              `Failed to write agent file in batch (index ${i}): ${writeResult.error!.message}`,
              agent.filePath,
              'write',
            ),
          );
        }
        results.push(writeResult.value!);
        this.logger.debug('Agent written in batch', {
          filePath: absolutePath,
          status: writeResult.value!.status,
          index: i + 1,
          total: agents.length,
        });
      }

      this.logger.info('Agents batch written successfully', {
        count: results.length,
        written: results.filter((r) => r.status === 'written').length,
        unchanged: results.filter((r) => r.status === 'unchanged').length,
      });

      return Result.ok(results);
    } catch (error: unknown) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.logger.error('Unexpected error in batch write', err);

      return Result.err(
        new FileWriteError(
          `Unexpected error writing agents batch: ${err.message}`,
          agents[0]?.filePath || 'unknown',
          'write',
        ),
      );
    }
  }

  /**
   * Validate content and path, and resolve the absolute target path.
   */
  private prepare(agent: GeneratedAgent): Result<string, Error> {
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
    return Result.ok(this.resolveAbsolutePath(agent.filePath));
  }

  /**
   * Compare the existing target with the generated content and write only
   * when they differ.
   */
  private async writeIfChanged(
    agent: GeneratedAgent,
    absolutePath: string,
  ): Promise<Result<AgentWriteResult, Error>> {
    let existing: string | null = null;
    try {
      existing = await this.fs.readFile(absolutePath);
    } catch {
      existing = null;
    }
    if (existing !== null && existing === agent.content) {
      this.logger.info('Agent already current, skipping write', {
        filePath: absolutePath,
      });
      return Result.ok({ filePath: absolutePath, status: 'unchanged' });
    }
    try {
      await this.fs.writeFile(absolutePath, agent.content);
      this.logger.info('Agent written successfully', {
        filePath: absolutePath,
      });
      return Result.ok({ filePath: absolutePath, status: 'written' });
    } catch (error: unknown) {
      return this.handleFileSystemError(
        error,
        agent.filePath,
        'write',
        'Failed to write agent file',
      );
    }
  }

  /** Remove files this batch newly wrote after a later write failed. */
  private async rollback(results: AgentWriteResult[]): Promise<void> {
    for (const result of results) {
      if (result.status !== 'written') continue;
      try {
        await this.fs.delete(result.filePath);
      } catch {
        this.logger.error('Failed to clean up partial write', {
          path: result.filePath,
        });
      }
    }
  }

  /**
   * Validate file path for security (prevent path traversal attacks).
   *
   * Checks:
   * - Path must be within .claude/ directory
   * - No path traversal attempts (../)
   * - Path length within OS limits
   */
  private validateFilePath(filePath: string): Result<void, Error> {
    try {
      const normalizedPath = normalize(filePath);
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
    } catch (error: unknown) {
      return Result.err(
        new FileWriteError(
          `Failed to validate file path: ${error instanceof Error ? error.message : String(error)}`,
          filePath,
          'write',
        ),
      );
    }
  }

  /**
   * Resolve file path to absolute path.
   * If path is relative, assumes it's relative to the home directory.
   */
  private resolveAbsolutePath(filePath: string): string {
    if (filePath.startsWith('/') || /^[A-Za-z]:/.test(filePath)) {
      return normalize(filePath);
    }
    this.logger.warn(
      `[FileWriter] Relative path "${filePath}" — resolving against homedir. Caller should provide absolute path.`,
    );
    return normalize(join(homedir(), filePath));
  }

  /**
   * Ensure the parent directory exists through the port. Explicit because
   * the VS Code adapter's `writeFile()` does not create parents.
   */
  private async ensureDirectoryExists(
    filePath: string,
  ): Promise<Result<void, Error>> {
    try {
      const dir = dirname(filePath);
      await this.fs.createDirectory(dir);
      this.logger.debug('Directory ensured', { directory: dir });
      return Result.ok(undefined);
    } catch (error: unknown) {
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
   */
  private handleFileSystemError(
    error: unknown,
    filePath: string,
    operation: 'write' | 'mkdir',
    message: string,
  ): Result<never, Error> {
    const nodeError =
      error instanceof Error
        ? (error as NodeJS.ErrnoException)
        : (new Error(String(error)) as NodeJS.ErrnoException);
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
