/**
 * ErrorHandler Service - Centralized error management
 * Based on TASK_CORE_001 implementation plan
 * Extracted from apps/ptah-extension-vscode/src/handlers/error-handler.ts
 *
 * Features:
 * - Dependency injection via TSyringe
 * - Error boundaries for safe function execution
 * - Async error handling with promises
 * - User-friendly error notifications
 * - Contextual error logging
 * - Error action handlers
 */

import { injectable, inject } from 'tsyringe';
import * as vscode from 'vscode';
import { Logger } from '../logging/logger';
import { TOKENS } from '../di/tokens';
import type { ErrorContext, ErrorAction, ErrorBoundaryResult } from './types';

/**
 * ErrorHandler service for centralized error management
 * Provides error boundaries and user-friendly error notifications
 */
@injectable()
export class ErrorHandler {
  constructor(@inject(TOKENS.LOGGER) private readonly logger: Logger) {}

  /**
   * Handle general errors with contextual information
   * Logs error and optionally shows user notification
   *
   * @param error - Error instance or message
   * @param context - Contextual information about the error
   * @param showToUser - Whether to display error notification to user
   */
  handleError(
    error: Error | string,
    context?: ErrorContext,
    showToUser = true
  ): void {
    const errorMessage = this.formatError(error);
    const fullMessage = context
      ? `${context.service}.${context.operation}: ${errorMessage}`
      : errorMessage;

    // Log with context
    this.logger.error(fullMessage, {
      service: context?.service,
      operation: context?.operation,
      metadata: context?.metadata,
      error: error instanceof Error ? error : undefined,
    });

    // Show to user if requested
    if (showToUser) {
      const userMessage = context
        ? `${context.service} error: ${errorMessage}`
        : `Error: ${errorMessage}`;

      vscode.window.showErrorMessage(`Ptah: ${userMessage}`);
    }
  }

  /**
   * Handle async errors with promises
   * Wraps promise execution in error boundary
   *
   * @param promise - Promise to execute
   * @param context - Contextual information
   * @param showToUser - Whether to display error notification
   * @returns Promise that won't reject (errors are handled internally)
   */
  async handleAsyncError<T>(
    promise: Promise<T>,
    context?: ErrorContext,
    showToUser = true
  ): Promise<T | undefined> {
    try {
      return await promise;
    } catch (error) {
      this.handleError(
        error instanceof Error ? error : String(error),
        context,
        showToUser
      );
      return undefined;
    }
  }

  /**
   * Create error boundary for safe function execution
   * Catches and handles errors, preventing propagation
   *
   * @param fn - Function to execute within error boundary
   * @param fallback - Optional fallback value on error
   * @param context - Contextual information
   * @returns Result object with success/failure state
   */
  createErrorBoundary<T>(
    fn: () => T,
    fallback?: T,
    context?: ErrorContext
  ): ErrorBoundaryResult<T> {
    try {
      const value = fn();
      return { success: true, value };
    } catch (error) {
      this.handleError(
        error instanceof Error ? error : String(error),
        context,
        false
      );

      return {
        success: false,
        error: error instanceof Error ? error : new Error(String(error)),
        value: fallback,
      };
    }
  }

  /**
   * Create async error boundary for safe async function execution
   * Catches and handles async errors, preventing propagation
   *
   * @param fn - Async function to execute within error boundary
   * @param fallback - Optional fallback value on error
   * @param context - Contextual information
   * @returns Promise of result object with success/failure state
   */
  async createAsyncErrorBoundary<T>(
    fn: () => Promise<T>,
    fallback?: T,
    context?: ErrorContext
  ): Promise<ErrorBoundaryResult<T>> {
    try {
      const value = await fn();
      return { success: true, value };
    } catch (error) {
      this.handleError(
        error instanceof Error ? error : String(error),
        context,
        false
      );

      return {
        success: false,
        error: error instanceof Error ? error : new Error(String(error)),
        value: fallback,
      };
    }
  }

  /**
   * Show error message to user with optional actions
   * Provides user-friendly error notification with recovery options
   *
   * @param error - Error instance or message
   * @param actions - Optional actions user can take
   * @param context - Contextual information
   */
  async showErrorToUser(
    error: Error | string,
    actions?: ErrorAction[],
    context?: ErrorContext
  ): Promise<void> {
    const errorMessage = this.formatError(error);
    const fullMessage = context
      ? `${context.service} error: ${errorMessage}`
      : `Error: ${errorMessage}`;

    // Log the error
    this.logger.error(fullMessage, {
      service: context?.service,
      operation: context?.operation,
      metadata: context?.metadata,
      error: error instanceof Error ? error : undefined,
    });

    // Show notification with actions
    if (actions && actions.length > 0) {
      const actionTitles = actions.map((a) => a.title);
      const result = await vscode.window.showErrorMessage(
        `Ptah: ${fullMessage}`,
        ...actionTitles
      );

      if (result) {
        const selectedAction = actions.find((a) => a.title === result);
        if (selectedAction) {
          try {
            await selectedAction.handler();
          } catch (handlerError) {
            this.logger.error('Error executing error action handler', {
              error: handlerError instanceof Error ? handlerError : undefined,
              action: result,
            });
          }
        }
      }
    } else {
      vscode.window.showErrorMessage(`Ptah: ${fullMessage}`);
    }
  }

  /**
   * Handle command execution errors
   * Specialized error handler for VS Code commands
   *
   * @param commandId - Command identifier
   * @param error - Error instance
   * @param context - Additional context
   */
  handleCommandError(
    commandId: string,
    error: unknown,
    context?: string
  ): void {
    this.handleError(error instanceof Error ? error : String(error), {
      service: 'CommandManager',
      operation: commandId,
      metadata: context ? { context } : undefined,
    });
  }

  /**
   * Handle service initialization errors
   * Specialized error handler for service initialization
   *
   * @param serviceName - Service name
   * @param error - Error instance
   */
  handleServiceError(serviceName: string, error: unknown): void {
    this.handleError(
      error instanceof Error ? error : String(error),
      {
        service: serviceName,
        operation: 'initialize',
      },
      true
    );
  }

  /**
   * Handle webview errors
   * Specialized error handler for webview operations
   *
   * @param viewId - Webview identifier
   * @param error - Error instance
   * @param context - Additional context
   */
  handleWebviewError(viewId: string, error: unknown, context?: string): void {
    this.handleError(
      error instanceof Error ? error : String(error),
      {
        service: 'WebviewManager',
        operation: viewId,
        metadata: context ? { context } : undefined,
      },
      true
    );
  }

  /**
   * Handle Claude CLI errors
   * Specialized error handler for Claude CLI operations
   *
   * @param error - Error instance
   * @param operation - Operation being performed
   */
  handleClaudeError(error: unknown, operation?: string): void {
    const errorInstance =
      error instanceof Error ? error : new Error(String(error));

    this.showErrorToUser(
      errorInstance,
      [
        {
          title: 'Open Documentation',
          handler: async () => {
            await vscode.env.openExternal(
              vscode.Uri.parse(
                'https://github.com/your-repo/ptah-extension#claude-cli-setup'
              )
            );
          },
        },
      ],
      {
        service: 'ClaudeCli',
        operation: operation || 'unknown',
      }
    );
  }

  /**
   * Create error handler with predefined context
   * Useful for creating service-specific error handlers
   *
   * @param service - Service name for context
   * @returns Error handler with context bound
   */
  withContext(service: string): {
    handleCommand: (commandId: string, error: unknown) => void;
    handleService: (serviceName: string, error: unknown) => void;
    handleWebview: (viewId: string, error: unknown) => void;
    handleClaude: (error: unknown, operation?: string) => void;
    handleError: (error: unknown, operation: string) => void;
  } {
    return {
      handleCommand: (commandId: string, error: unknown) =>
        this.handleCommandError(commandId, error, service),

      handleService: (serviceName: string, error: unknown) =>
        this.handleServiceError(serviceName, error),

      handleWebview: (viewId: string, error: unknown) =>
        this.handleWebviewError(viewId, error, service),

      handleClaude: (error: unknown, operation?: string) =>
        this.handleClaudeError(error, operation),

      handleError: (error: unknown, operation: string) =>
        this.handleError(
          error instanceof Error ? error : String(error),
          {
            service,
            operation,
          },
          true
        ),
    };
  }

  /**
   * Format error into readable string
   * Handles various error types safely
   *
   * @param error - Error to format
   * @returns Formatted error message
   */
  private formatError(error: Error | string | unknown): string {
    if (error instanceof Error) {
      return error.message;
    }

    if (typeof error === 'string') {
      return error;
    }

    if (error && typeof error === 'object') {
      try {
        return JSON.stringify(error);
      } catch {
        return 'Unknown error object';
      }
    }

    return 'Unknown error';
  }
}
