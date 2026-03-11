import {
  AgentGenerationError,
  AgentGenerationErrorCode,
} from './agent-generation.error';

/**
 * Error during template operations (loading, parsing, validation).
 * Thrown when template files cannot be loaded, parsed, or when template structure is invalid.
 */
export class TemplateError extends AgentGenerationError {
  constructor(
    message: string,
    public readonly templateId: string,
    code: AgentGenerationErrorCode = 'TEMPLATE_PARSE_ERROR',
    context?: Record<string, unknown>
  ) {
    super(message, code, { ...context, templateId });
    this.name = 'TemplateError';
    Object.setPrototypeOf(this, TemplateError.prototype);
  }
}
