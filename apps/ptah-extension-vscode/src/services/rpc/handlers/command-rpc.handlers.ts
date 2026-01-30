/**
 * Command RPC Handlers
 *
 * Handles command-related RPC methods: command:execute
 *
 * TASK_2025_126: Allows webview to execute VS Code commands
 * TASK_2025_129 Batch 3: Added specific whitelisted commands beyond ptah.* prefix
 *
 * Security:
 * - Commands with the ptah.* prefix are allowed from webview
 * - Specific whitelisted commands (e.g., workbench.action.reloadWindow) are also allowed
 * - All other commands are rejected with error
 * - This prevents arbitrary VS Code command execution
 */

import { injectable, inject } from 'tsyringe';
import { Logger, RpcHandler, TOKENS } from '@ptah-extension/vscode-core';
import type {
  CommandExecuteParams,
  CommandExecuteResponse,
} from '@ptah-extension/shared';
import * as vscode from 'vscode';

/**
 * RPC handlers for command operations
 *
 * TASK_2025_126: Enables webview to execute VS Code commands
 * TASK_2025_129 Batch 3: Extended whitelist to include workbench.action.reloadWindow
 *
 * Allowed commands:
 * - ptah.* prefix: All extension-specific commands (e.g., ptah.enterLicenseKey, ptah.openPricing)
 * - workbench.action.reloadWindow: Window reload after auth config changes
 */
@injectable()
export class CommandRpcHandlers {
  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(TOKENS.RPC_HANDLER) private readonly rpcHandler: RpcHandler
  ) {}

  /**
   * Register all command RPC methods
   */
  register(): void {
    this.registerCommandExecute();

    this.logger.debug('Command RPC handlers registered', {
      methods: ['command:execute'],
    });
  }

  /**
   * command:execute - Execute a VS Code command from webview
   *
   * SECURITY: Only allows whitelisted commands to prevent arbitrary command execution.
   * Allowed: ptah.* prefix commands and specific exact-match commands.
   * This is a critical security boundary - the webview should NOT be able to
   * execute arbitrary VS Code commands like editor.action.* or workbench.action.*
   * (except for specifically whitelisted ones like workbench.action.reloadWindow).
   *
   * @param params.command - Command ID (must match whitelist)
   * @param params.args - Optional arguments for the command
   */
  private registerCommandExecute(): void {
    this.rpcHandler.registerMethod<
      CommandExecuteParams,
      CommandExecuteResponse
    >('command:execute', async (params) => {
      try {
        const { command, args } = params;

        this.logger.debug('RPC: command:execute called', { command });

        // SECURITY: Only allow whitelisted commands from webview
        // This prevents arbitrary VS Code command execution
        // TASK_2025_129 Batch 3: Added workbench.action.reloadWindow for auth reload
        const ALLOWED_COMMAND_PREFIXES = ['ptah.'];
        const ALLOWED_EXACT_COMMANDS = ['workbench.action.reloadWindow'];
        const isAllowed =
          ALLOWED_COMMAND_PREFIXES.some((prefix) =>
            command.startsWith(prefix)
          ) || ALLOWED_EXACT_COMMANDS.includes(command);

        if (!isAllowed) {
          this.logger.warn('RPC: command:execute blocked disallowed command', {
            command,
          });
          return {
            success: false,
            error: `Command not allowed from webview. Received: ${command}`,
          };
        }

        // Execute the command with optional arguments
        await vscode.commands.executeCommand(command, ...(args || []));

        this.logger.debug('RPC: command:execute success', { command });

        return { success: true };
      } catch (error) {
        this.logger.error(
          'RPC: command:execute failed',
          error instanceof Error ? error : new Error(String(error))
        );
        return {
          success: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    });
  }
}
