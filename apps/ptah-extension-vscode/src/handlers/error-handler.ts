import * as vscode from 'vscode';
import { Logger } from '../core/logger';

/**
 * Centralized error handling for the Ptah extension
 */
export class ErrorHandler {
  /**
   * Handle command execution errors
   */
  static handleCommandError(commandId: string, error: unknown, context?: string): void {
    const errorMessage = this.formatError(error);
    const fullMessage = context
      ? `Command '${commandId}' failed: ${errorMessage} (Context: ${context})`
      : `Command '${commandId}' failed: ${errorMessage}`;

    Logger.error(fullMessage);

    // Show user-friendly error message
    vscode.window.showErrorMessage(`Ptah: ${errorMessage}`);
  }

  /**
   * Handle service initialization errors
   */
  static handleServiceError(serviceName: string, error: unknown): void {
    const errorMessage = this.formatError(error);
    const fullMessage = `Service '${serviceName}' initialization failed: ${errorMessage}`;

    Logger.error(fullMessage);

    // Show user-friendly error message
    vscode.window.showErrorMessage(`Ptah: Failed to initialize ${serviceName}. ${errorMessage}`);
  }

  /**
   * Handle webview errors
   */
  static handleWebviewError(viewId: string, error: unknown, context?: string): void {
    const errorMessage = this.formatError(error);
    const fullMessage = context
      ? `Webview '${viewId}' error: ${errorMessage} (Context: ${context})`
      : `Webview '${viewId}' error: ${errorMessage}`;

    Logger.error(fullMessage);

    // Show user-friendly error message
    vscode.window.showWarningMessage(`Ptah: Webview issue - ${errorMessage}`);
  }

  /**
   * Handle general extension errors
   */
  static handleExtensionError(error: unknown, context?: string): void {
    const errorMessage = this.formatError(error);
    const fullMessage = context
      ? `Extension error: ${errorMessage} (Context: ${context})`
      : `Extension error: ${errorMessage}`;

    Logger.error(fullMessage);

    // Show user-friendly error message
    vscode.window.showErrorMessage(`Ptah: ${errorMessage}`);
  }

  /**
   * Handle Claude CLI detection/communication errors
   */
  static handleClaudeError(error: unknown, operation?: string): void {
    const errorMessage = this.formatError(error);
    const fullMessage = operation
      ? `Claude CLI operation '${operation}' failed: ${errorMessage}`
      : `Claude CLI error: ${errorMessage}`;

    Logger.error(fullMessage);

    // Show user-friendly error message with suggestion
    vscode.window.showErrorMessage(
      `Ptah: Claude CLI issue - ${errorMessage}. Please ensure Claude CLI is installed and accessible.`
    );
  }

  /**
   * Format error objects into readable strings
   */
  private static formatError(error: unknown): string {
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

  /**
   * Create error handler with context
   */
  static withContext(context: string) {
    return {
      handleCommand: (commandId: string, error: unknown) =>
        this.handleCommandError(commandId, error, context),

      handleService: (serviceName: string, error: unknown) =>
        this.handleServiceError(serviceName, error),

      handleWebview: (viewId: string, error: unknown) =>
        this.handleWebviewError(viewId, error, context),

      handleExtension: (error: unknown) => this.handleExtensionError(error, context),

      handleClaude: (error: unknown, operation?: string) =>
        this.handleClaudeError(error, operation),
    };
  }
}
