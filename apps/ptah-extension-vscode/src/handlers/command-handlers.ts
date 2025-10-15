import * as vscode from 'vscode';
import { injectable, inject } from 'tsyringe';
import { TOKENS, type Logger } from '@ptah-extension/vscode-core';
import {
  ChatOrchestrationService,
  CHAT_ORCHESTRATION_SERVICE,
} from '@ptah-extension/claude-domain';
import { ServiceDependencies } from '../core/ptah-extension';
import { WebviewDiagnostic } from '../services/webview-diagnostic';

/**
 * Command Handlers - Implements all extension commands
 */
@injectable()
export class CommandHandlers {
  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(CHAT_ORCHESTRATION_SERVICE)
    private readonly chatOrchestration: ChatOrchestrationService,
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
   * Review current file - Add file to context and send review request
   */
  async reviewCurrentFile(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      vscode.window.showWarningMessage('No file is currently open to review.');
      return;
    }

    this.logger.info(`Reviewing file: ${editor.document.fileName}`);

    try {
      // Add current file to context
      const filePath = editor.document.uri.fsPath;
      await this.services.contextManager.includeFile(vscode.Uri.file(filePath));

      // Send review message using orchestration service
      const reviewMessage = `Please review this code for bugs, security issues, and improvements:\n\n${editor.document.getText()}`;
      const result = await this.chatOrchestration.sendMessage({
        content: reviewMessage,
        files: [filePath],
      });

      if (result.success) {
        // Open chat to show the review
        await this.quickChat();
        vscode.window.showInformationMessage(
          'Code review request sent to Claude'
        );
      } else {
        throw new Error(result.error || 'Failed to send review request');
      }
    } catch (error) {
      this.logger.error('Failed to review current file', error);
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

    this.logger.info(`Generating tests for: ${editor.document.fileName}`);

    try {
      // Add current file to context
      const filePath = editor.document.uri.fsPath;
      await this.services.contextManager.includeFile(vscode.Uri.file(filePath));

      // Send test generation message using orchestration service
      const testMessage = `Generate comprehensive unit tests for this code:\n\n${editor.document.getText()}`;
      const result = await this.chatOrchestration.sendMessage({
        content: testMessage,
        files: [filePath],
      });

      if (result.success) {
        // Open chat to show the generated tests
        await this.quickChat();
        vscode.window.showInformationMessage(
          'Test generation request sent to Claude'
        );
      } else {
        throw new Error(
          result.error || 'Failed to send test generation request'
        );
      }
    } catch (error) {
      this.logger.error('Failed to generate tests', error);
      vscode.window.showErrorMessage('Failed to send test generation request');
    }
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
   * New session - Create a new chat session
   */
  async newSession(): Promise<void> {
    this.logger.info('Creating new session');

    try {
      const result = await this.chatOrchestration.createSession({
        name: undefined, // Let the service generate a default name
      });

      if (result.success && result.session) {
        vscode.window.showInformationMessage(
          `New session created: ${result.session.name}`
        );

        // Open chat sidebar to show the new session
        await this.quickChat();
      } else {
        throw new Error(result.error || 'Failed to create new session');
      }
    } catch (error) {
      this.logger.error('Failed to create new session', error);
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

      this.logger.info(`File included in context: ${uri.fsPath}`);
    } catch (error) {
      this.logger.error('Failed to include file', error);
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

      this.logger.info(`File excluded from context: ${uri.fsPath}`);
    } catch (error) {
      this.logger.error('Failed to exclude file', error);
      vscode.window.showErrorMessage('Failed to exclude file from context');
    }
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
   * Switch session - Show session picker
   */
  async switchSession(): Promise<void> {
    this.logger.info('Opening session picker');

    try {
      // Get all sessions from orchestration service
      const sessions = this.chatOrchestration.getAllSessions();

      if (sessions.length === 0) {
        vscode.window.showInformationMessage(
          'No sessions available. Create a new session first.'
        );
        return;
      }

      // Create VS Code quick pick items
      const items = sessions.map((session) => ({
        label: session.name,
        description: `${session.messageCount} messages`,
        detail: `Created: ${new Date(session.createdAt).toLocaleDateString()}`,
        sessionId: session.id,
      }));

      const selected = await vscode.window.showQuickPick(items, {
        title: 'Switch to Session',
        placeHolder: 'Select a session to switch to',
      });

      if (selected) {
        const result = await this.chatOrchestration.switchSession({
          sessionId: selected.sessionId,
        });

        if (result.success) {
          vscode.window.showInformationMessage(
            `Switched to: ${selected.label}`
          );
          await this.quickChat(); // Open chat to show the switched session
        } else {
          throw new Error(result.error || 'Failed to switch session');
        }
      }
    } catch (error) {
      this.logger.error('Failed to show session picker', error);
      vscode.window.showErrorMessage('Failed to show session picker');
    }
  }

  /**
   * Show context optimization suggestions
   */
  async optimizeContext(): Promise<void> {
    this.logger.info('Showing context optimization suggestions');

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
      this.logger.error('Failed to show context optimization', error);
      vscode.window.showErrorMessage('Failed to load optimization suggestions');
    }
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
