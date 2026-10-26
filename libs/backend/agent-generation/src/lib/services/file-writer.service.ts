/**
 * Agent File Writer Service
 *
 * The guarded writer: the only place a wizard agent file is written. It
 * writes through the platform file-system port, with directory creation and
 * path-traversal protection, and re-checks the target against the caller's
 * write guard immediately before writing.
 *
 * A write is idempotent: when the target already holds exactly the generated
 * bytes the file is left alone and the result says `unchanged`.
 *
 * @module @ptah-extension/agent-generation/services
 */

import { injectable, inject } from 'tsyringe';
import { dirname, isAbsolute, normalize } from 'path';
import {
  PLATFORM_TOKENS,
  type IFileSystemProvider,
} from '@ptah-extension/platform-core';
import { Logger, TOKENS } from '@ptah-extension/vscode-core';
import { Result } from '@ptah-extension/shared';
import { hashContent } from '@ptah-extension/harness-sync';
import type {
  AgentWriteGuard,
  AgentWriteResult,
  AgentWriteStatus,
  IAgentFileWriterService,
} from '../interfaces/agent-file-writer.interface';
import { GeneratedAgent } from '../types/core.types';
import { FileWriteError } from '../errors/file-write.error';

/** What is on disk at the target right before the guarded write. */
type CurrentTarget =
  | { state: 'absent' }
  | { state: 'present'; content: string }
  | { state: 'unreadable'; code: string | undefined };

/** Error codes that mean "nothing at this path": Node, and the VS Code FS. */
const NOT_FOUND_CODES: ReadonlySet<string> = new Set([
  'ENOENT',
  'FileNotFound',
]);

/** The string `code` of a filesystem error, read structurally (any realm). */
function errorCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null || !('code' in error)) {
    return undefined;
  }
  const { code } = error;
  return typeof code === 'string' ? code : undefined;
}

/**
 * Service for writing generated agents to the filesystem.
 *
 * Responsibilities:
 * - Write agent files to .claude/agents/ or .claude/commands/ directory
 * - Apply the write guard against the file as it is on disk right now
 * - Skip the write when the existing bytes already match (`unchanged`)
 * - Never replace a file that cannot be read (`kept`)
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
   * Write a generated agent to its target path under a write guard.
   *
   * 1. Validate content is non-empty and the path is safe and absolute
   * 2. Read the target: not found → absent; any other read error → `kept`
   * 3. Equal bytes → `unchanged`, no write
   * 4. Apply the guard: `kept` / `changed-since-preview` leave the file alone
   * 5. Create the parent directory and write the new content → `written`:
   *    an absent target is created exclusively (a collision leaves the new
   *    file alone); a present one is re-read and re-checked just before the
   *    replace (see `replaceContent` for the window that remains)
   *
   * The target is read right before the write, so a decision made against an
   * earlier preview never overwrites content the user did not see.
   *
   * @param agent - Generated agent with content and target file path
   * @param guard - The write permission the user's decision grants
   * @returns Result with the absolute file path and its status, or Error
   */
  async writeAgent(
    agent: GeneratedAgent,
    guard: AgentWriteGuard,
  ): Promise<Result<AgentWriteResult, Error>> {
    try {
      this.logger.debug('Writing agent to filesystem', {
        filePath: agent.filePath,
        templateId: agent.sourceTemplateId,
        contentLength: agent.content.length,
        guard: guard.mode,
      });
      const prepared = this.prepare(agent);
      if (prepared.isErr()) {
        return Result.err(prepared.error!);
      }
      const absolutePath = prepared.value!;

      const current = await this.readCurrent(absolutePath);
      if (current.state === 'unreadable') {
        this.logger.warn('Agent file cannot be read; keeping it untouched', {
          filePath: absolutePath,
          code: current.code,
        });
        return Result.ok({ filePath: absolutePath, status: 'kept' });
      }
      if (current.state === 'present' && current.content === agent.content) {
        this.logger.info('Agent already current, skipping write', {
          filePath: absolutePath,
        });
        return Result.ok({ filePath: absolutePath, status: 'unchanged' });
      }

      const blocked = this.blockedByGuard(guard, current);
      if (blocked !== null) {
        this.logger.info('Agent write blocked by its guard', {
          filePath: absolutePath,
          guard: guard.mode,
          status: blocked,
        });
        return Result.ok({ filePath: absolutePath, status: blocked });
      }

      const dirResult = await this.ensureDirectoryExists(absolutePath);
      if (dirResult.isErr()) {
        return Result.err(dirResult.error!);
      }
      if (current.state === 'absent') {
        return await this.createContent(agent, absolutePath, guard);
      }
      return await this.replaceContent(agent, absolutePath, guard);
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
    // Security checks first, so a traversal or non-.claude path keeps its
    // `securityViolation` flag even when it is also relative.
    const pathValidation = this.validateFilePath(agent.filePath);
    if (pathValidation.isErr()) {
      return Result.err(pathValidation.error!);
    }
    return this.resolveAbsolutePath(agent.filePath);
  }

  /**
   * Read the target as it is now. Only a not-found error means "absent";
   * every other read error is reported as `unreadable`, because replacing a
   * file nobody could read would destroy content nobody has seen.
   */
  private async readCurrent(absolutePath: string): Promise<CurrentTarget> {
    try {
      const content = await this.fs.readFile(absolutePath);
      return { state: 'present', content };
    } catch (error: unknown) {
      const code = errorCode(error);
      if (code !== undefined && NOT_FOUND_CODES.has(code)) {
        return { state: 'absent' };
      }
      return { state: 'unreadable', code };
    }
  }

  /**
   * The status that leaves the file alone, or `null` when the guard allows
   * the write. Called only after equal bytes were ruled out.
   *
   * - create-only: any existing file is `kept`.
   * - replace-allowed from `missing`: a file that appeared since the
   *   decision was not part of it → `changed-since-preview`.
   * - replace-allowed from `present`: content whose hash differs from the
   *   baseline → `changed-since-preview`. A file deleted since the decision
   *   holds nothing to lose, so the write goes ahead.
   */
  private blockedByGuard(
    guard: AgentWriteGuard,
    current: Exclude<CurrentTarget, { state: 'unreadable' }>,
  ): AgentWriteStatus | null {
    if (current.state === 'absent') return null;
    if (guard.mode === 'create-only') return 'kept';
    if (guard.baseline.state === 'missing') return 'changed-since-preview';
    return hashContent(current.content) === guard.baseline.hash
      ? null
      : 'changed-since-preview';
  }

  /**
   * Create an absent target with an exclusive create, so a file another
   * writer (the pack installer, another window or process) created after
   * our read is never replaced. A collision is the guard's "leave it" status:
   * `kept` for create-only, `changed-since-preview` for replace-allowed
   * (that file was not part of the decision).
   */
  private async createContent(
    agent: GeneratedAgent,
    absolutePath: string,
    guard: AgentWriteGuard,
  ): Promise<Result<AgentWriteResult, Error>> {
    try {
      await this.fs.writeFileExclusive(absolutePath, agent.content);
    } catch (error: unknown) {
      if (errorCode(error) === 'EEXIST') {
        const status: AgentWriteStatus =
          guard.mode === 'create-only' ? 'kept' : 'changed-since-preview';
        this.logger.info('Agent file appeared before the create; left as is', {
          filePath: absolutePath,
          status,
        });
        return Result.ok({ filePath: absolutePath, status });
      }
      return this.handleFileSystemError(
        error,
        agent.filePath,
        'write',
        'Failed to write agent file',
      );
    }
    return this.written(absolutePath);
  }

  /**
   * Replace a present target that matched the guard's baseline. The target
   * is re-read and its hash re-checked immediately before the write, which
   * closes the gap across the directory creation and any other await since
   * the first read.
   *
   * Remaining guarantee: the port has no compare-and-swap for replacement
   * and there is no lock shared with editors or other processes, so a write
   * landing between this re-check and `writeFile` is still replaced. The
   * window is one read; only an absent target is fully race-free.
   */
  private async replaceContent(
    agent: GeneratedAgent,
    absolutePath: string,
    guard: AgentWriteGuard,
  ): Promise<Result<AgentWriteResult, Error>> {
    const recheck = await this.readCurrent(absolutePath);
    if (recheck.state === 'absent') {
      return this.createContent(agent, absolutePath, guard);
    }
    if (recheck.state === 'unreadable') {
      return Result.ok({ filePath: absolutePath, status: 'kept' });
    }
    if (recheck.content === agent.content) {
      return Result.ok({ filePath: absolutePath, status: 'unchanged' });
    }
    const blocked = this.blockedByGuard(guard, recheck);
    if (blocked !== null) {
      this.logger.info('Agent file changed before the replace; left as is', {
        filePath: absolutePath,
        status: blocked,
      });
      return Result.ok({ filePath: absolutePath, status: blocked });
    }
    try {
      await this.fs.writeFile(absolutePath, agent.content);
    } catch (error: unknown) {
      return this.handleFileSystemError(
        error,
        agent.filePath,
        'write',
        'Failed to write agent file',
      );
    }
    return this.written(absolutePath);
  }

  private written(absolutePath: string): Result<AgentWriteResult, Error> {
    this.logger.info('Agent written successfully', { filePath: absolutePath });
    return Result.ok({ filePath: absolutePath, status: 'written' });
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
   * Require an absolute target path and normalize it.
   * Relative paths are rejected without resolving against the home directory.
   */
  private resolveAbsolutePath(filePath: string): Result<string, Error> {
    if (!isAbsolute(filePath)) {
      return Result.err(
        new FileWriteError(
          `An absolute path is required: "${filePath}"`,
          filePath,
          'write',
        ),
      );
    }
    return Result.ok(normalize(filePath));
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
