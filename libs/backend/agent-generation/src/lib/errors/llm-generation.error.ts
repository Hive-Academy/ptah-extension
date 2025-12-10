import { AgentGenerationError } from './agent-generation.error';

/**
 * Error from LLM operations during generation.
 * Thrown when the LLM provider fails to generate content for a specific section.
 */
export class LlmGenerationError extends AgentGenerationError {
  constructor(
    message: string,
    public readonly sectionId?: string,
    public readonly prompt?: string,
    context?: Record<string, unknown>
  ) {
    super(message, 'LLM_ERROR', { ...context, sectionId });
    this.name = 'LlmGenerationError';
    Object.setPrototypeOf(this, LlmGenerationError.prototype);
  }
}
