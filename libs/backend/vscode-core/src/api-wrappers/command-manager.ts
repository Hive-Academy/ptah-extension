/**
 * VS Code Command Manager
 * Based on MONSTER_EXTENSION_REFACTOR_PLAN lines 299-355
 * Provides type-safe command registration with event bus integration
 */

import * as vscode from 'vscode';
import { injectable, inject } from 'tsyringe';
import { EventBus } from '../messaging/event-bus';
import { TOKENS } from '../di/tokens';

/**
 * Command definition interface with type safety
 * Defines structure for registering VS Code commands
 */
export interface CommandDefinition<T = unknown> {
  readonly id: string;
  readonly title: string;
  readonly category?: string;
  readonly handler: (...args: T[]) => Promise<void> | void;
  readonly when?: string; // VS Code when clause for conditional availability
}

/**
 * Command execution event payload for event bus
 */
export interface CommandExecutedPayload {
  readonly commandId: string;
  readonly args: readonly unknown[];
  readonly timestamp: number;
  readonly duration?: number;
}

/**
 * Command error event payload for event bus
 */
export interface CommandErrorPayload {
  readonly commandId: string;
  readonly error: string;
  readonly timestamp: number;
  readonly args?: readonly unknown[];
}

/**
 * VS Code Command Manager with event integration
 * Provides centralized command registration and execution tracking
 */
@injectable()
export class CommandManager {
  private readonly registeredCommands = new Map<string, vscode.Disposable>();
  private readonly commandMetrics = new Map<string, {
    executionCount: number;
    totalDuration: number;
    lastExecuted: number;
    errorCount: number;
  }>();

  constructor(
    @inject(TOKENS.EXTENSION_CONTEXT) private readonly context: vscode.ExtensionContext,
    @inject(TOKENS.EVENT_BUS) private readonly eventBus: EventBus
  ) {}

  /**
   * Register a single command with type safety and event integration
   * Automatically tracks execution metrics and publishes events
   *
   * @param definition - Command definition with handler and metadata
   */
  registerCommand<T = unknown>(definition: CommandDefinition<T>): void {
    if (this.registeredCommands.has(definition.id)) {
      throw new Error(`Command ${definition.id} is already registered`);
    }

    const disposable = vscode.commands.registerCommand(
      definition.id,
      async (...args: T[]) => {
        const startTime = Date.now();

        try {
          // Publish command execution started event
          this.eventBus.publish('commands:executeCommand', {
            templateId: definition.id,
            parameters: this.argsToParameters(args)
          });

          // Execute the command handler
          await definition.handler(...args);

          const duration = Date.now() - startTime;

          // Update metrics
          this.updateCommandMetrics(definition.id, duration, false);

          // Publish successful execution event (using existing event payload structure)
          const executedPayload: CommandExecutedPayload = {
            commandId: definition.id,
            args: args as readonly unknown[],
            timestamp: Date.now(),
            duration
          };

          // Since we don't have a specific command:executed type in MessagePayloadMap,
          // we'll use the generic analytics event with flattened properties
          this.eventBus.publish('analytics:trackEvent', {
            event: 'command:executed',
            properties: {
              commandId: executedPayload.commandId,
              timestamp: executedPayload.timestamp,
              duration: duration,
              argsLength: executedPayload.args.length
            }
          });

        } catch (error) {
          const duration = Date.now() - startTime;

          // Update error metrics
          this.updateCommandMetrics(definition.id, duration, true);

          // Publish error event
          const errorPayload: CommandErrorPayload = {
            commandId: definition.id,
            error: error instanceof Error ? error.message : String(error),
            timestamp: Date.now(),
            args: args as readonly unknown[]
          };

          // Publish error using existing error event type
          this.eventBus.publish('error', {
            code: 'COMMAND_EXECUTION_ERROR',
            message: `Command ${definition.id} failed: ${errorPayload.error}`,
            source: 'CommandManager',
            data: {
              commandId: definition.id,
              args: args as readonly unknown[]
            },
            timestamp: Date.now()
          });

          // Re-throw to maintain VS Code error handling
          throw error;
        }
      }
    );

    // Add to extension subscriptions for proper cleanup
    this.context.subscriptions.push(disposable);
    this.registeredCommands.set(definition.id, disposable);

    // Initialize metrics tracking
    this.commandMetrics.set(definition.id, {
      executionCount: 0,
      totalDuration: 0,
      lastExecuted: 0,
      errorCount: 0
    });
  }

  /**
   * Register multiple commands in bulk
   * Convenient method for setting up multiple commands at once
   *
   * @param commands - Array of command definitions to register
   */
  registerCommands(commands: readonly CommandDefinition[]): void {
    commands.forEach(cmd => this.registerCommand(cmd));
  }

  /**
   * Unregister a command by ID
   * Properly cleans up resources and stops tracking metrics
   *
   * @param commandId - ID of the command to unregister
   * @returns True if command was unregistered, false if it wasn't registered
   */
  unregisterCommand(commandId: string): boolean {
    const disposable = this.registeredCommands.get(commandId);

    if (!disposable) {
      return false;
    }

    disposable.dispose();
    this.registeredCommands.delete(commandId);
    this.commandMetrics.delete(commandId);

    return true;
  }

  /**
   * Get command execution metrics for monitoring and debugging
   * Provides insights into command usage patterns and performance
   *
   * @param commandId - Optional specific command ID, or all commands if not provided
   * @returns Metrics for the specified command or all commands
   */
  getCommandMetrics(commandId?: string) {
    if (commandId) {
      return this.commandMetrics.get(commandId) || null;
    }

    return Object.fromEntries(this.commandMetrics);
  }

  /**
   * Get list of all registered command IDs
   * Useful for debugging and validation
   *
   * @returns Array of registered command IDs
   */
  getRegisteredCommands(): readonly string[] {
    return Array.from(this.registeredCommands.keys());
  }

  /**
   * Check if a command is registered
   *
   * @param commandId - Command ID to check
   * @returns True if command is registered
   */
  isCommandRegistered(commandId: string): boolean {
    return this.registeredCommands.has(commandId);
  }

  /**
   * Dispose all registered commands
   * Should be called during extension deactivation
   */
  dispose(): void {
    this.registeredCommands.forEach(disposable => disposable.dispose());
    this.registeredCommands.clear();
    this.commandMetrics.clear();
  }

  /**
   * Convert command arguments to parameters object for event payload
   * Handles the conversion from array args to parameter object expected by events
   */
  private argsToParameters(args: unknown[]): Record<string, unknown> {
    const parameters: Record<string, unknown> = {};

    args.forEach((arg, index) => {
      parameters[`arg${index}`] = arg;
    });

    return parameters;
  }

  /**
   * Update command execution metrics
   * Tracks performance and error statistics for monitoring
   */
  private updateCommandMetrics(commandId: string, duration: number, isError: boolean): void {
    const metrics = this.commandMetrics.get(commandId);

    if (!metrics) return;

    metrics.executionCount++;
    metrics.totalDuration += duration;
    metrics.lastExecuted = Date.now();

    if (isError) {
      metrics.errorCount++;
    }
  }
}
