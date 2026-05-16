/**
 * Logging Types - Type definitions for structured logging
 */

/**
 * Log severity levels
 */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

/**
 * Contextual information for log entries
 * Provides additional metadata for debugging and tracing
 */
export interface LogContext {
  /**
   * Service or component name that generated the log
   */
  readonly service?: string;

  /**
   * Operation or method name being performed
   */
  readonly operation?: string;

  /**
   * Additional structured metadata
   */
  readonly metadata?: Record<string, unknown>;

  /**
   * Error instance if logging an error
   */
  readonly error?: Error;
}

/**
 * Complete log entry with timestamp and context
 * Immutable structure for log events
 */
export interface LogEntry {
  /**
   * Severity level of the log entry
   */
  readonly level: LogLevel;

  /**
   * Human-readable log message
   */
  readonly message: string;

  /**
   * Timestamp when log was created
   */
  readonly timestamp: Date;

  /**
   * Optional contextual information
   */
  readonly context?: LogContext;

  /**
   * Stack trace for error-level logs
   */
  readonly stackTrace?: string;
}
