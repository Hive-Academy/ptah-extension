import 'reflect-metadata'; // CRITICAL: Required for TSyringe decorators
import * as vscode from 'vscode';
import { injectable, inject } from 'tsyringe';
import { TOKENS, type Logger } from '@ptah-extension/vscode-core';
import { ServiceDependencies } from '../core/ptah-extension';
import { WebviewDiagnostic } from '../services/webview-diagnostic';

/**
 * Command Handlers - Implements all extension commands
 */
@injectable()
export class CommandHandlers {
  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    private services: ServiceDependencies
  ) {}

  /**
   * Quick chat - Open chat sidebar and focus input
   */
  async quickChat(): Promise<void> {
    this.logger.info('Executing quick chat command');
    await vscode.commands.executeCommand('ptah.chatSidebar.focus');

    // Switch the Angular webview to chat mode
    this.services.angularWebviewProvider.switchView('chat');
  }

  /**
   * Review current file - TODO: Use frontend chat templates instead
   */
  async reviewCurrentFile(): Promise<void> {
    vscode.window.showWarningMessage(
      'Code review command deprecated - use chat templates in webview instead'
    );
    this.logger.info('reviewCurrentFile called - feature deprecated');
    // TODO: Remove this command registration and use frontend chat templates
  }

  /**
   * Generate tests - TODO: Use frontend chat templates instead
   */
  async generateTests(): Promise<void> {
    vscode.window.showWarningMessage(
      'Test generation command deprecated - use chat templates in webview instead'
    );
    this.logger.info('generateTests called - feature deprecated');
    // TODO: Remove this command registration and use frontend chat templates
  }

  /**
   * Build command - Open command builder
   */
  async buildCommand(): Promise<void> {
    this.logger.info('Opening command builder');
    await vscode.commands.executeCommand('ptah.commandBuilder.focus');

    // Switch the Angular webview to command builder mode
    this.services.angularWebviewProvider.switchView('command-builder');
  }

  /**
   * New session - TODO: Use RPC session:create instead
   */
  async newSession(): Promise<void> {
    vscode.window.showWarningMessage(
      'New session command deprecated - use frontend session controls instead'
    );
    this.logger.info('newSession called - feature deprecated');
    // TODO: Remove this command and use RPC session:create from frontend
  }

  /**
   * Include file in context - TODO: Use RPC context operations instead
   */
  async includeFile(uri?: vscode.Uri): Promise<void> {
    vscode.window.showWarningMessage(
      'Include file command deprecated - use frontend context controls instead'
    );
    this.logger.info('includeFile called - feature deprecated');
    // TODO: Remove this command and use RPC context operations from frontend
  }

  /**
   * Exclude file from context - TODO: Use RPC context operations instead
   */
  async excludeFile(uri?: vscode.Uri): Promise<void> {
    vscode.window.showWarningMessage(
      'Exclude file command deprecated - use frontend context controls instead'
    );
    this.logger.info('excludeFile called - feature deprecated');
    // TODO: Remove this command and use RPC context operations from frontend
  }

  /**
   * Show analytics dashboard
   */
  async showAnalytics(): Promise<void> {
    this.logger.info('Opening analytics dashboard');
    await vscode.commands.executeCommand('ptah.chatSidebar.focus');

    // Switch the Angular webview to analytics mode
    this.services.angularWebviewProvider.switchView('analytics');
  }

  /**
   * Switch session - TODO: Use RPC session:switch instead
   */
  async switchSession(): Promise<void> {
    vscode.window.showWarningMessage(
      'Switch session command deprecated - use frontend session controls instead'
    );
    this.logger.info('switchSession called - feature deprecated');
    // TODO: Remove this command and use RPC session:switch from frontend
  }

  /**
   * Show context optimization suggestions - TODO: Use frontend controls instead
   */
  async optimizeContext(): Promise<void> {
    vscode.window.showWarningMessage(
      'Context optimization command deprecated - use frontend context controls instead'
    );
    this.logger.info('optimizeContext called - feature deprecated');
    // TODO: Remove this command and use frontend context optimization UI
  }

  /**
   * Run webview diagnostic (for debugging)
   */
  async runDiagnostic(): Promise<void> {
    this.logger.info('Creating diagnostic webview...');

    try {
      WebviewDiagnostic.createDiagnosticWebview(this.services.context);
      vscode.window.showInformationMessage(
        'Diagnostic webview created. Check the new panel.'
      );
    } catch (error) {
      this.logger.error('Failed to create diagnostic webview', error);
      vscode.window.showErrorMessage('Failed to create diagnostic webview');
    }
  }
}
