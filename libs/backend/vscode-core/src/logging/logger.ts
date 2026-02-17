/**
 * Logger Service - Structured logging with VS Code integration
 * Based on TASK_CORE_001 implementation plan
 * Extracted from apps/ptah-extension-vscode/src/core/logger.ts
 *
 * Features:
 * - Dependency injection via TSyringe
 * - Structured logging with context
 * - VS Code Output Channel integration
 * - Stack trace capture for errors
 * - Timestamp and level formatting
 */

import { injectable, inject } from 'tsyringe';
import { PtahProdDefaults, PtahDevDefaults } from '@ptah-extension/shared';
import { OUTPUT_MANAGER } from '../di/tokens';
import { OutputManager } from '../api-wrappers/output-manager';
import type { LogLevel, LogContext, LogEntry } from './types';

/**
 * Logger service for centralized logging
 * Uses OutputManager for VS Code integration
 *
 * Log Level Filtering:
 * - Production: 'info' (skips debug messages)
 * - Development: 'debug' (logs everything)
 * - Detects development mode via VS Code extensionMode
 */
@injectable()
export class Logger {
  private static readonly CHANNEL_NAME = 'Ptah';

  /**
   * Minimum log level - messages below this level are filtered out
   * Levels ordered: debug < info < warn < error
   */
  private readonly minLevel: LogLevel;

  /**
   * Whether to also log to the developer console.
   * Enabled in development, disabled in production to reduce noise.
   */
  private readonly logToConsole: boolean;

  private static readonly LEVEL_ORDER: Record<LogLevel, number> = {
    debug: 0,
    info: 1,
    warn: 2,
    error: 3,
  };

  constructor(
    @inject(OUTPUT_MANAGER) private readonly outputManager: OutputManager
  ) {
    // Ensure output channel is created for logging
    this.outputManager.createOutputChannel({ name: Logger.CHANNEL_NAME });

    // Detect development mode and apply centralized log level defaults.
    // PTAH_LOG_LEVEL env var always takes priority for explicit overrides.
    const explicitLevel = process.env['PTAH_LOG_LEVEL'] as LogLevel | undefined;
    if (explicitLevel && Logger.LEVEL_ORDER[explicitLevel] !== undefined) {
      this.minLevel = explicitLevel;
    } else {
      const isDevelopment = this.detectDevelopmentMode();
      this.minLevel = isDevelopment
        ? PtahDevDefaults.LOG_LEVEL
        : PtahProdDefaults.LOG_LEVEL;
    }
    this.logToConsole = this.detectDevelopmentMode()
      ? PtahDevDefaults.LOG_TO_CONSOLE
      : PtahProdDefaults.LOG_TO_CONSOLE;
  }

  /**
   * Detect if running in development mode
   * Uses VS Code's extension host detection
   */
  private detectDevelopmentMode(): boolean {
    try {
      // Check for VS Code extension development mode
      // process.env.VSCODE_DEBUG_MODE is set during F5 debugging
      // NODE_ENV can also be used for explicit configuration
      return (
        process.env['VSCODE_DEBUG_MODE'] === 'true' ||
        process.env['NODE_ENV'] === 'development' ||
        process.env['PTAH_LOG_LEVEL'] === 'debug'
      );
    } catch {
      return false;
    }
  }

  /**
   * Check if a log level should be logged based on minLevel
   */
  private shouldLog(level: LogLevel): boolean {
    return Logger.LEVEL_ORDER[level] >= Logger.LEVEL_ORDER[this.minLevel];
  }

  /**
   * Log debug message
   * For detailed diagnostic information during development
   *
   * @param message - Debug message
   * @param args - Additional arguments to log
   */
  debug(message: string, ...args: unknown[]): void {
    this.log('debug', message, args);
  }

  /**
   * Log informational message
   * For general informational messages about application state
   *
   * @param message - Info message
   * @param args - Additional arguments to log
   */
  info(message: string, ...args: unknown[]): void {
    this.log('info', message, args);
  }

  /**
   * Log warning message
   * For potentially harmful situations that don't prevent execution
   *
   * @param message - Warning message
   * @param args - Additional arguments to log
   */
  warn(message: string, ...args: unknown[]): void {
    this.log('warn', message, args);
  }

  /**
   * Log error message
   * For error events that might still allow the application to continue
   *
   * @param message - Error message or Error instance
   * @param errorOrContext - Error instance or context object
   */
  error(
    message: string | Error,
    errorOrContext?: Error | Record<string, unknown>
  ): void {
    let actualMessage: string;
    let actualError: Error | undefined;
    let actualContext: Record<string, unknown> | undefined;

    // Handle different parameter combinations
    if (message instanceof Error) {
      actualError = message;
      actualMessage = message.message;

      if (errorOrContext && !(errorOrContext instanceof Error)) {
        actualContext = errorOrContext;
      }
    } else {
      actualMessage = message;

      if (errorOrContext instanceof Error) {
        actualError = errorOrContext;
      } else if (errorOrContext) {
        actualContext = errorOrContext;
      }
    }

    const context: LogContext = {
      ...actualContext,
      error: actualError,
    };

    this.logWithContext('error', actualMessage, context);
  }

  /**
   * Log message with full contextual information
   * For advanced logging scenarios with structured metadata
   *
   * @param level - Log severity level
   * @param message - Log message
   * @param context - Contextual information
   */
  logWithContext(level: LogLevel, message: string, context: LogContext): void {
    // Skip logging if below minimum level
    if (!this.shouldLog(level)) return;

    const entry = this.createLogEntry(level, message, context);
    this.writeLogEntry(entry);
  }

  /**
   * Show the output channel to the user
   * Useful for drawing attention to logs during critical events
   */
  show(): void {
    this.outputManager.show(Logger.CHANNEL_NAME);
  }

  /**
   * Dispose resources (called on extension deactivation)
   */
  dispose(): void {
    // OutputManager handles disposal of channels
    // No additional cleanup needed for Logger
  }

  /**
   * Log message with arguments
   * Internal helper for standard log methods
   *
   * DIAGNOSTIC MODE: Stringify objects directly into the message for easier log analysis
   * This ensures all context is visible in the saved log file as a single line.
   *
   * @param level - Log severity level
   * @param message - Log message
   * @param args - Additional arguments
   */
  private log(level: LogLevel, message: string, args: unknown[]): void {
    // Skip logging if below minimum level (early check for performance)
    if (!this.shouldLog(level)) return;

    // DIAGNOSTIC: Inline objects directly into the message for easier debugging
    // This makes log entries self-contained and visible in saved log files
    let inlinedMessage = message;
    if (args.length > 0) {
      const inlinedArgs = args
        .map((arg) => {
          try {
            if (typeof arg === 'object' && arg !== null) {
              return JSON.stringify(arg);
            }
            return String(arg);
          } catch {
            return '[Unserializable]';
          }
        })
        .join(' ');
      inlinedMessage = `${message}: ${inlinedArgs}`;
    }

    // Use empty context since args are now inlined into message
    this.logWithContext(level, inlinedMessage, {});
  }

  /**
   * Create a complete log entry with timestamp and formatting
   *
   * @param level - Log severity level
   * @param message - Log message
   * @param context - Optional context
   * @returns Complete log entry
   */
  private createLogEntry(
    level: LogLevel,
    message: string,
    context?: LogContext
  ): LogEntry {
    return {
      level,
      message,
      timestamp: new Date(),
      context,
      stackTrace: context?.error?.stack,
    };
  }

  /**
   * Write log entry to output channel
   * Formats the entry with timestamp, level, and context
   *
   * @param entry - Log entry to write
   */
  private writeLogEntry(entry: LogEntry): void {
    const levelPrefix = entry.level.toUpperCase().padEnd(5);
    const timestamp = entry.timestamp.toISOString();
    const formattedMessage = `[${levelPrefix}] ${timestamp} - ${entry.message}`;

    // Write to output channel
    this.outputManager.write(Logger.CHANNEL_NAME, formattedMessage);

    // Add context information if available
    if (entry.context) {
      if (entry.context.service) {
        this.outputManager.write(
          Logger.CHANNEL_NAME,
          `  Service: ${entry.context.service}`
        );
      }

      if (entry.context.operation) {
        this.outputManager.write(
          Logger.CHANNEL_NAME,
          `  Operation: ${entry.context.operation}`
        );
      }

      if (entry.context.metadata) {
        this.outputManager.write(
          Logger.CHANNEL_NAME,
          `  Metadata: ${JSON.stringify(entry.context.metadata, null, 2)}`
        );
      }

      if (entry.context.error) {
        this.outputManager.write(
          Logger.CHANNEL_NAME,
          `  Error: ${entry.context.error.message}`
        );
      }
    }

    // Add stack trace for errors
    if (entry.stackTrace) {
      this.outputManager.write(Logger.CHANNEL_NAME, `  Stack trace:`);
      this.outputManager.write(Logger.CHANNEL_NAME, entry.stackTrace);
    }

    // Also log to console when enabled (dev mode)
    if (this.logToConsole) {
      this.writeToConsole(entry);
    }
  }

  /**
   * Log to console based on log level
   * Provides redundant logging for development scenarios
   *
   * @param entry - Log entry to write to console
   */
  private writeToConsole(entry: LogEntry): void {
    const consoleMessage = `[${entry.level.toUpperCase()}] ${entry.message}`;
    const consoleArgs = entry.context?.metadata ? [entry.context.metadata] : [];

    switch (entry.level) {
      case 'debug':
        console.debug(consoleMessage, ...consoleArgs);
        break;
      case 'info':
        console.log(consoleMessage, ...consoleArgs);
        break;
      case 'warn':
        console.warn(consoleMessage, ...consoleArgs);
        break;
      case 'error':
        console.error(
          consoleMessage,
          entry.context?.error || '',
          ...consoleArgs
        );
        break;
    }
  }

  /**
   * Serialize arguments for logging
   * Handles various types safely
   *
   * @param args - Arguments to serialize
   * @returns Serialized arguments object
   */
  private serializeArgs(args: unknown[]): Record<string, unknown> {
    const serialized: Record<string, unknown> = {};

    args.forEach((arg, index) => {
      try {
        if (arg instanceof Error) {
          serialized[`arg${index}`] = {
            message: arg.message,
            stack: arg.stack,
            name: arg.name,
          };
        } else if (typeof arg === 'object' && arg !== null) {
          serialized[`arg${index}`] = arg;
        } else {
          serialized[`arg${index}`] = String(arg);
        }
      } catch {
        serialized[`arg${index}`] = '[Failed to serialize]';
      }
    });

    return serialized;
  }
}
