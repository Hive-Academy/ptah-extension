/**
 * Slash Command Interceptor - Detects and classifies slash commands in messages
 *
 * This interceptor detects follow-up slash commands and routes them
 * appropriately:
 *
 * - 'native': Commands handled locally without SDK (/clear)
 * - 'new-query': Commands requiring a new SDK query (/context, /cost, /compact, /review, plugin commands)
 * - 'passthrough': Not a slash command, send as regular message
 *
 * A 'new-query' command is delivered to the SDK as an ordinary SDKUserMessage
 * through the session's persistent input stream, exactly like any other prompt.
 * An earlier version of this comment claimed the SDK parses slash commands only
 * from raw string prompts passed to query(); that was written 2026-05-15 against
 * SDK 0.2.140 and is false for the installed 0.3.150, where a streamed command
 * executes with `num_turns=0` and zero cost. Believing it cost background
 * subagents their tools, because a raw string prompt also marks the query
 * single-turn and closes the input on the first result (TASK_2026_472;
 * `.ptah/specs/TASK_2026_472_a7e2/experiment-slash-over-streaminput.md`).
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
  private static readonly NATIVE_COMMANDS = new Set(['clear']);

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
