import { AgentGenerationError } from './agent-generation.error';

/**
 * Error when writing generated agent to filesystem.
 * Thrown when file system operations fail during agent file creation or backup.
 */
export class FileWriteError extends AgentGenerationError {
  constructor(
    message: string,
    public readonly filePath: string,
    public readonly operation: 'write' | 'backup' | 'mkdir',
    context?: Record<string, unknown>
  ) {
    super(message, 'FILE_WRITE_ERROR', { ...context, filePath, operation });
    this.name = 'FileWriteError';
    Object.setPrototypeOf(this, FileWriteError.prototype);
  }
}
