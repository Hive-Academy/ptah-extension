/**
 * Base error class for all agent generation errors.
 * Provides a consistent error interface with error codes and contextual information.
 */
export class AgentGenerationError extends Error {
  constructor(
    message: string,
    public readonly code: AgentGenerationErrorCode,
    public readonly context?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'AgentGenerationError';
    Object.setPrototypeOf(this, AgentGenerationError.prototype);
  }

  /**
   * Creates an AgentGenerationError from an unknown error object.
   * Useful for wrapping caught errors with proper error codes.
   * @param error The caught error
   * @param code The error code to assign
   * @returns AgentGenerationError with the specified code
   */
  static fromError(
    error: unknown,
    code: AgentGenerationErrorCode
  ): AgentGenerationError {
    if (error instanceof AgentGenerationError) return error;
    const message = error instanceof Error ? error.message : String(error);
    return new AgentGenerationError(message, code);
  }
}

/**
 * Standardized error codes for agent generation operations.
 */
export type AgentGenerationErrorCode =
  | 'TEMPLATE_NOT_FOUND' // Template ID not found in registry
  | 'TEMPLATE_PARSE_ERROR' // Failed to parse template file
  | 'TEMPLATE_VALIDATION_ERROR' // Template fails validation rules
  | 'GENERATION_FAILED' // Generation process failed
  | 'LLM_ERROR' // LLM provider error during generation
  | 'FILE_WRITE_ERROR' // Failed to write agent file to disk
  | 'VALIDATION_ERROR' // Generated content fails validation
  | 'CANCELLED' // Operation cancelled by user
  | 'UNKNOWN_ERROR'; // Uncategorized error
