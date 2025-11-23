/**
 * Standardized error class for LLM provider operations.
 * Thrown by all provider implementations when errors occur.
 */
export class LlmProviderError extends Error {
  constructor(
    public readonly message: string,
    public readonly code: LlmProviderErrorCode,
    public readonly provider: string,
    public readonly details?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'LlmProviderError';
  }

  /**
   * Creates a LlmProviderError from an unknown error object.
   * Useful for wrapping caught errors with provider context.
   * @param error The caught error
   * @param provider The provider name
   * @returns LlmProviderError with UNKNOWN_ERROR code
   */
  static fromError(error: unknown, provider: string): LlmProviderError {
    if (error instanceof LlmProviderError) return error;
    if (error instanceof Error) {
      return new LlmProviderError(error.message, 'UNKNOWN_ERROR', provider, {
        cause: error,
      });
    }
    return new LlmProviderError(
      'An unknown error occurred',
      'UNKNOWN_ERROR',
      provider
    );
  }
}

/**
 * Standardized error codes for LLM operations.
 */
export type LlmProviderErrorCode =
  | 'PROVIDER_NOT_FOUND' // Provider name not recognized
  | 'API_KEY_MISSING' // API key not provided
  | 'API_KEY_INVALID' // API key authentication failed
  | 'RATE_LIMIT_EXCEEDED' // Provider rate limit hit
  | 'CONTEXT_LENGTH_EXCEEDED' // Input too long for model
  | 'INVALID_REQUEST' // Malformed request
  | 'NETWORK_ERROR' // Network/connectivity issue
  | 'PARSING_ERROR' // Failed to parse LLM response
  | 'UNKNOWN_ERROR'; // Uncategorized error
