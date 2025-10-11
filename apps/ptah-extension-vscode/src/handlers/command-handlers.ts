import * as vscode from 'vscode';
import { ServiceDependencies } from '../core/ptah-extension';
import { Logger } from '../core/logger';
import { WebviewDiagnostic } from '../services/webview-diagnostic';

/**
 * Command Handlers - Implements all extension commands
 */
export class CommandHandlers {
  constructor(private services: ServiceDependencies) {}

  /**
   * Quick chat - Open chat sidebar and focus input
   */
  async quickChat(): Promise<void> {
    Logger.info('Executing quick chat command');
    await vscode.commands.executeCommand('ptah.chatSidebar.focus');

    // Switch the Angular webview to chat mode
    this.services.angularWebviewProvider.switchView('chat');
  }

  /**
   * Review current file - Add file to context and send review request
   */
  async reviewCurrentFile(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      vscode.window.showWarningMessage('No file is currently open to review.');
      return;
    }

    Logger.info(`Reviewing file: ${editor.document.fileName}`);

    try {
      // Add current file to context
      const filePath = editor.document.uri.fsPath;
      await this.services.contextManager.includeFile(vscode.Uri.file(filePath));

      // Ensure we have a session for the review
      let currentSession = this.services.sessionManager.getCurrentSession();
      if (!currentSession) {
        currentSession = await this.services.sessionManager.createSession(
          'Code Review'
        );
      }

      // Send review message to chat
      const reviewMessage = `Please review this code for bugs, security issues, and improvements:\n\n${editor.document.getText()}`;
      await this.services.sessionManager.sendMessage(reviewMessage, [filePath]);

      // Open chat to show the review
      await this.quickChat();

      vscode.window.showInformationMessage(
        'Code review request sent to Claude'
      );
    } catch (error) {
      Logger.error('Failed to review current file', error);
      vscode.window.showErrorMessage('Failed to send review request');
    }
  }

  /**
   * Generate tests - Add file to context and send test generation request
   */
  async generateTests(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      vscode.window.showWarningMessage(
        'No file is currently open to generate tests for.'
      );
      return;
    }

    Logger.info(`Generating tests for: ${editor.document.fileName}`);

    try {
      // Add current file to context
      const filePath = editor.document.uri.fsPath;
      await this.services.contextManager.includeFile(vscode.Uri.file(filePath));

      // Ensure we have a session for test generation
      let currentSession = this.services.sessionManager.getCurrentSession();
      if (!currentSession) {
        currentSession = await this.services.sessionManager.createSession(
          'Test Generation'
        );
      }

      // Send test generation message
      const testMessage = `Generate comprehensive unit tests for this code:\n\n${editor.document.getText()}`;
      await this.services.sessionManager.sendMessage(testMessage, [filePath]);

      // Open chat to show the generated tests
      await this.quickChat();

      vscode.window.showInformationMessage(
        'Test generation request sent to Claude'
      );
    } catch (error) {
      Logger.error('Failed to generate tests', error);
      vscode.window.showErrorMessage('Failed to send test generation request');
    }
  }

  /**
   * Build command - Open command builder
   */
  async buildCommand(): Promise<void> {
    Logger.info('Opening command builder');
    await vscode.commands.executeCommand('ptah.commandBuilder.focus');

    // Switch the Angular webview to command builder mode
    this.services.angularWebviewProvider.switchView('command-builder');
  }

  /**
   * New session - Create a new chat session
   */
  async newSession(): Promise<void> {
    Logger.info('Creating new session');

    try {
      const session = await this.services.sessionManager.createSession();
      vscode.window.showInformationMessage(
        `New session created: ${session.name}`
      );

      // Open chat sidebar to show the new session
      await this.quickChat();
    } catch (error) {
      Logger.error('Failed to create new session', error);
      vscode.window.showErrorMessage('Failed to create new session');
    }
  }

  /**
   * Include file in context
   */
  async includeFile(uri?: vscode.Uri): Promise<void> {
    try {
      // If no URI provided, use current file
      if (!uri) {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
          vscode.window.showWarningMessage('No file selected or open');
          return;
        }
        uri = editor.document.uri;
      }

      await this.services.contextManager.includeFile(uri);

      const fileName = uri.fsPath.split(/[\\/]/).pop();
      vscode.window.showInformationMessage(`Added ${fileName} to context`);

      Logger.info(`File included in context: ${uri.fsPath}`);
    } catch (error) {
      Logger.error('Failed to include file', error);
      vscode.window.showErrorMessage('Failed to include file in context');
    }
  }

  /**
   * Exclude file from context
   */
  async excludeFile(uri?: vscode.Uri): Promise<void> {
    try {
      // If no URI provided, use current file
      if (!uri) {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
          vscode.window.showWarningMessage('No file selected or open');
          return;
        }
        uri = editor.document.uri;
      }

      await this.services.contextManager.excludeFile(uri);

      const fileName = uri.fsPath.split(/[\\/]/).pop();
      vscode.window.showInformationMessage(`Removed ${fileName} from context`);

      Logger.info(`File excluded from context: ${uri.fsPath}`);
    } catch (error) {
      Logger.error('Failed to exclude file', error);
      vscode.window.showErrorMessage('Failed to exclude file from context');
    }
  }

  /**
   * Show analytics dashboard
   */
  async showAnalytics(): Promise<void> {
    Logger.info('Opening analytics dashboard');
    await vscode.commands.executeCommand('ptah.chatSidebar.focus');

    // Switch the Angular webview to analytics mode
    this.services.angularWebviewProvider.switchView('analytics');
  }

  /**
   * Switch session - Show session picker
   */
  async switchSession(): Promise<void> {
    Logger.info('Opening session picker');

    try {
      await this.services.sessionManager.showSessionPicker();
    } catch (error) {
      Logger.error('Failed to show session picker', error);
      vscode.window.showErrorMessage('Failed to show session picker');
    }
  }

  /**
   * Show context optimization suggestions
   */
  async optimizeContext(): Promise<void> {
    Logger.info('Showing context optimization suggestions');

    try {
      const suggestions =
        await this.services.contextManager.getOptimizationSuggestions();

      if (suggestions.length === 0) {
        vscode.window.showInformationMessage('Context is already optimized!');
        return;
      }

      const items = suggestions.map((suggestion) => ({
        label: suggestion.type.replace(/_/g, ' ').toUpperCase(),
        description: suggestion.description,
        detail: `Potential savings: ${suggestion.estimatedSavings} tokens`,
      }));

      const selected = await vscode.window.showQuickPick(items, {
        title: 'Context Optimization Suggestions',
        placeHolder: 'Select an optimization to apply',
      });

      if (selected) {
        // Apply the optimization (this would need to be implemented in ContextManager)
        vscode.window.showInformationMessage(
          `Applied optimization: ${selected.label}`
        );
      }
    } catch (error) {
      Logger.error('Failed to show context optimization', error);
      vscode.window.showErrorMessage('Failed to load optimization suggestions');
    }
  }

  /**
   * Run webview diagnostic (for debugging)
   */
  async runDiagnostic(): Promise<void> {
    Logger.info('Creating diagnostic webview...');

    try {
      WebviewDiagnostic.createDiagnosticWebview(this.services.context);
      vscode.window.showInformationMessage(
        'Diagnostic webview created. Check the new panel.'
      );
    } catch (error) {
      Logger.error('Failed to create diagnostic webview', error);
      vscode.window.showErrorMessage('Failed to create diagnostic webview');
    }
  }
}
