/**
 * Error Handling Types - Type definitions for error management
 * Based on TASK_CORE_001 implementation plan
 */

/**
 * Contextual information for error handling
 * Provides metadata about where and why an error occurred
 */
export interface ErrorContext {
  /**
   * Service or component name where error occurred
   */
  readonly service: string;

  /**
   * Operation or method name being performed when error occurred
   */
  readonly operation: string;

  /**
   * Additional structured metadata about the error
   */
  readonly metadata?: Record<string, unknown>;
}

/**
 * Action that can be taken in response to an error
 * Provides user-friendly error recovery options
 */
export interface ErrorAction {
  /**
   * Display title for the action button
   */
  readonly title: string;

  /**
   * Handler function to execute when action is selected
   */
  readonly handler: () => void | Promise<void>;
}

/**
 * Result of an error boundary operation
 * Wraps success/failure state with optional value or error
 */
export interface ErrorBoundaryResult<T> {
  /**
   * Whether the operation succeeded
   */
  readonly success: boolean;

  /**
   * Return value if operation succeeded
   */
  readonly value?: T;

  /**
   * Error instance if operation failed
   */
  readonly error?: Error;
}
