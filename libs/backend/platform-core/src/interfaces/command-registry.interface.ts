/**
 * ICommandRegistry — Platform-agnostic command registration and execution.
 *
 * Replaces: vscode.commands.registerCommand, vscode.commands.executeCommand
 */

import type { IDisposable } from '../types/platform.types';

export interface ICommandRegistry {
  /**
   * Register a command handler.
   * Replaces: vscode.commands.registerCommand()
   */
  registerCommand(
    id: string,
    handler: (...args: unknown[]) => unknown
  ): IDisposable;

  /**
   * Execute a command by ID.
   * Replaces: vscode.commands.executeCommand()
   */
  executeCommand<T = unknown>(id: string, ...args: unknown[]): Promise<T>;
}
