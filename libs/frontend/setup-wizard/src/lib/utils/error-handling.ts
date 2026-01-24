/**
 * Error Handling Utilities for Setup Wizard
 *
 * Provides standardized error handling patterns for wizard operations.
 * Ensures consistent error messaging and retry logic across components.
 *
 * @module @ptah-extension/setup-wizard/utils
 */

/**
 * Standard error display format for wizard operations.
 * Used by components to display user-friendly error messages.
 */
export interface WizardError {
  /** User-friendly error message */
  message: string;
  /** Technical details for debugging (optional) */
  details?: string;
  /** Whether the operation can be retried */
  retryable: boolean;
}

/**
 * Determine if an error is retryable based on its message.
 * Network errors and timeouts are generally retryable.
 * Validation errors are not retryable without user action.
 *
 * @param error - Error to check
 * @returns true if the error is retryable
 */
export function isRetryableError(error: Error): boolean {
  const message = error.message.toLowerCase();

  // Network errors are retryable
  if (
    message.includes('network') ||
    message.includes('timeout') ||
    message.includes('connection') ||
    message.includes('fetch') ||
    message.includes('econnrefused') ||
    message.includes('enotfound')
  ) {
    return true;
  }

  // Transient server errors are retryable
  if (
    message.includes('500') ||
    message.includes('502') ||
    message.includes('503') ||
    message.includes('504') ||
    message.includes('service unavailable') ||
    message.includes('server error')
  ) {
    return true;
  }

  // Validation errors are not retryable
  if (
    message.includes('invalid') ||
    message.includes('validation') ||
    message.includes('required') ||
    message.includes('missing') ||
    message.includes('not found') ||
    message.includes('unauthorized') ||
    message.includes('forbidden')
  ) {
    return false;
  }

  // Default to retryable for unknown errors
  return true;
}

/**
 * Convert unknown error to user-friendly WizardError.
 * Handles Error instances, strings, and unknown types.
 *
 * @param error - Unknown error value
 * @param context - Context description for the error message (e.g., "Starting agent generation")
 * @returns Standardized WizardError object
 *
 * @example
 * ```typescript
 * try {
 *   await someOperation();
 * } catch (error) {
 *   const wizardError = toWizardError(error, 'Loading agents');
 *   this.errorMessage.set(wizardError.message);
 * }
 * ```
 */
export function toWizardError(error: unknown, context: string): WizardError {
  if (error instanceof Error) {
    return {
      message: `${context}: ${error.message}`,
      details: error.stack,
      retryable: isRetryableError(error),
    };
  }

  if (typeof error === 'string') {
    return {
      message: `${context}: ${error}`,
      details: undefined,
      retryable: true, // Assume retryable for string errors
    };
  }

  return {
    message: `${context}: An unexpected error occurred`,
    details: String(error),
    retryable: true, // Assume retryable for unknown errors
  };
}

/**
 * Standard async operation wrapper with error handling.
 * Executes an operation and calls the error handler on failure.
 *
 * @param operation - Async operation to execute
 * @param context - Context description for error messages
 * @param onError - Callback to handle WizardError on failure
 * @returns The operation result on success, or null on failure
 *
 * @example
 * ```typescript
 * const result = await withErrorHandling(
 *   async () => {
 *     const response = await this.rpc.submitAgentSelection(agents);
 *     if (!response.success) throw new Error(response.error);
 *     return response;
 *   },
 *   'Starting agent generation',
 *   (error) => this.errorMessage.set(error.message)
 * );
 *
 * if (result) {
 *   this.wizardState.setCurrentStep('generation');
 * }
 * ```
 */
export async function withErrorHandling<T>(
  operation: () => Promise<T>,
  context: string,
  onError: (error: WizardError) => void
): Promise<T | null> {
  try {
    return await operation();
  } catch (error) {
    const wizardError = toWizardError(error, context);
    onError(wizardError);
    return null;
  }
}

/**
 * Extract a user-friendly message from an unknown error.
 * Simpler alternative to toWizardError when full WizardError is not needed.
 *
 * @param error - Unknown error value
 * @param fallbackMessage - Message to use if error cannot be parsed
 * @returns User-friendly error message string
 *
 * @example
 * ```typescript
 * try {
 *   await someOperation();
 * } catch (error) {
 *   this.errorMessage.set(extractErrorMessage(error, 'Operation failed'));
 * }
 * ```
 */
export function extractErrorMessage(
  error: unknown,
  fallbackMessage: string
): string {
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === 'string') {
    return error;
  }

  return fallbackMessage;
}
