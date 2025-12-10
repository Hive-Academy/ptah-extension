import { AgentGenerationError } from './agent-generation.error';

/**
 * Error during content generation process.
 * Thrown when the generation pipeline encounters errors in specific phases.
 */
export class ContentGenerationError extends AgentGenerationError {
  constructor(
    message: string,
    public readonly phase: 'template' | 'content' | 'llm' | 'file',
    public readonly agentName?: string,
    context?: Record<string, unknown>
  ) {
    super(message, 'GENERATION_FAILED', { ...context, phase, agentName });
    this.name = 'ContentGenerationError';
    Object.setPrototypeOf(this, ContentGenerationError.prototype);
  }
}
