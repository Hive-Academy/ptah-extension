import { AgentGenerationError } from './agent-generation.error';
import { ValidationIssue } from '../types';

/**
 * Error when content validation fails.
 * Thrown when generated agent content does not meet quality or completeness requirements.
 */
export class ValidationError extends AgentGenerationError {
  constructor(
    message: string,
    public readonly issues: ValidationIssue[],
    public readonly score: number,
    context?: Record<string, unknown>
  ) {
    super(message, 'VALIDATION_ERROR', { ...context, issues, score });
    this.name = 'ValidationError';
    Object.setPrototypeOf(this, ValidationError.prototype);
  }
}
