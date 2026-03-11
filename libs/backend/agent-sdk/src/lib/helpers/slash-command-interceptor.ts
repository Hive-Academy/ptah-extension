/**
 * Slash Command Interceptor - Detects and classifies slash commands in messages
 *
 * The Claude Agent SDK only parses slash commands from raw string prompts passed
 * to query(), NOT from SDKUserMessage objects delivered via streamInput().
 * This interceptor allows the application to detect follow-up slash commands
 * and route them appropriately:
 *
 * - 'native': Commands handled locally without SDK (/clear, /context, /cost)
 * - 'new-query': Commands requiring a new SDK query (/compact, /review, plugin commands)
 * - 'passthrough': Not a slash command, send as regular message
 *
 * @see TASK_2025_184 - Follow-up slash command support
 */

import { injectable, inject } from 'tsyringe';
import { Logger, TOKENS } from '@ptah-extension/vscode-core';

export type SlashCommandResult =
  | { action: 'passthrough' }
  | { action: 'native'; commandName: string; args: string; rawCommand: string }
  | {
      action: 'new-query';
      commandName: string;
      args: string;
      rawCommand: string;
    };

@injectable()
export class SlashCommandInterceptor {
  private static readonly NATIVE_COMMANDS = new Set([
    'clear',
    'context',
    'cost',
  ]);

  private static readonly SLASH_COMMAND_REGEX = /^\/[a-zA-Z]/;

  constructor(@inject(TOKENS.LOGGER) private readonly logger: Logger) {}

  /**
   * Check whether a string starts with a slash command pattern.
   * Useful for external callers that need to test without full interception.
   */
  static isSlashCommand(content: string): boolean {
    return SlashCommandInterceptor.SLASH_COMMAND_REGEX.test(content.trim());
  }

  /**
   * Parse and classify a potential slash command.
   * Returns handling instructions for the caller.
   */
  intercept(content: string): SlashCommandResult {
    const trimmed = content.trim();

    if (!SlashCommandInterceptor.SLASH_COMMAND_REGEX.test(trimmed)) {
      return { action: 'passthrough' };
    }

    const { commandName, args } = this.parseCommand(trimmed);

    // Commands we handle natively (don't need SDK)
    if (SlashCommandInterceptor.NATIVE_COMMANDS.has(commandName)) {
      const action = 'native' as const;
      this.logger.debug('[SlashCommandInterceptor] Command intercepted', {
        action,
        commandName,
        rawCommand: trimmed,
      });
      return {
        action,
        commandName,
        args,
        rawCommand: trimmed,
      };
    }

    // SDK commands — need a new query to parse them
    // This includes built-in SDK commands AND plugin commands (e.g., ptah-core:orchestrate)
    const action = 'new-query' as const;
    this.logger.debug('[SlashCommandInterceptor] Command intercepted', {
      action,
      commandName,
      rawCommand: trimmed,
    });
    return {
      action,
      commandName,
      args,
      rawCommand: trimmed,
    };
  }

  private parseCommand(content: string): {
    commandName: string;
    args: string;
  } {
    const spaceIndex = content.indexOf(' ');
    if (spaceIndex === -1) {
      return { commandName: content.slice(1), args: '' };
    }
    return {
      commandName: content.slice(1, spaceIndex),
      args: content.slice(spaceIndex + 1).trim(),
    };
  }
}
