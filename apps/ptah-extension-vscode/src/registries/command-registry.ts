import * as vscode from 'vscode';
import { CommandHandlers } from '../handlers/command-handlers';
import { Logger } from '../core/logger';

/**
 * Command Registry - Handles command registration and routing
 */
export class CommandRegistry implements vscode.Disposable {
  private disposables: vscode.Disposable[] = [];
  private commandHandlers: CommandHandlers;

  constructor(commandHandlers: CommandHandlers) {
    this.commandHandlers = commandHandlers;
  }

  /**
   * Register all extension commands
   */
  registerAll(): void {
    Logger.info('Registering extension commands...');

    const commands = [
      // Core commands
      this.registerCommand('ptah.quickChat', () => this.commandHandlers.quickChat()),
      this.registerCommand('ptah.reviewCurrentFile', () =>
        this.commandHandlers.reviewCurrentFile()
      ),
      this.registerCommand('ptah.generateTests', () => this.commandHandlers.generateTests()),
      this.registerCommand('ptah.buildCommand', () => this.commandHandlers.buildCommand()),

      // Session management
      this.registerCommand('ptah.newSession', () => this.commandHandlers.newSession()),
      this.registerCommand('ptah.switchSession', () => this.commandHandlers.switchSession()),

      // Context management
      this.registerCommand('ptah.includeFile', (uri) => this.commandHandlers.includeFile(uri)),
      this.registerCommand('ptah.excludeFile', (uri) => this.commandHandlers.excludeFile(uri)),
      this.registerCommand('ptah.optimizeContext', () => this.commandHandlers.optimizeContext()),

      // Analytics and insights
      this.registerCommand('ptah.showAnalytics', () => this.commandHandlers.showAnalytics()),

      // Diagnostic (debugging)
      this.registerCommand('ptah.runDiagnostic', () => this.commandHandlers.runDiagnostic()),
    ];

    this.disposables.push(...commands);
    Logger.info(`Registered ${commands.length} commands`);
  }

  /**
   * Register a single command with error handling
   */
  private registerCommand(command: string, callback: (...args: any[]) => any): vscode.Disposable {
    return vscode.commands.registerCommand(command, async (...args) => {
      try {
        Logger.info(`Executing command: ${command}`);
        await callback(...args);
      } catch (error) {
        Logger.error(`Failed to execute command: ${command}`, error);
        vscode.window.showErrorMessage(
          `Failed to execute ${command}: ${error instanceof Error ? error.message : 'Unknown error'}`
        );
      }
    });
  }

  /**
   * Get all registered commands
   */
  getRegisteredCommands(): string[] {
    return [
      'ptah.quickChat',
      'ptah.reviewCurrentFile',
      'ptah.generateTests',
      'ptah.buildCommand',
      'ptah.newSession',
      'ptah.switchSession',
      'ptah.includeFile',
      'ptah.excludeFile',
      'ptah.optimizeContext',
      'ptah.showAnalytics',
      'ptah.runDiagnostic',
    ];
  }

  /**
   * Dispose all registered commands
   */
  dispose(): void {
    Logger.info('Disposing command registry...');
    this.disposables.forEach((d) => d.dispose());
    this.disposables = [];
  }
}
