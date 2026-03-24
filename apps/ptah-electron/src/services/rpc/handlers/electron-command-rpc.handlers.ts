/**
 * Electron Command RPC Handlers
 *
 * Handles command execution in Electron:
 * - command:execute - Accept ptah.* commands silently, reject others
 *
 * In Electron, VS Code commands are not available. Ptah-prefixed commands
 * are accepted silently (frontend expects success) while others are rejected.
 *
 * TASK_2025_203 Batch 5: Extracted from inline registrations
 */

import { injectable, inject } from 'tsyringe';
import { TOKENS } from '@ptah-extension/vscode-core';
import type { Logger, RpcHandler } from '@ptah-extension/vscode-core';
import type { IPlatformCommands } from '@ptah-extension/rpc-handlers';

@injectable()
export class ElectronCommandRpcHandlers {
  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(TOKENS.RPC_HANDLER) private readonly rpcHandler: RpcHandler,
    @inject(TOKENS.PLATFORM_COMMANDS)
    private readonly platformCommands: IPlatformCommands
  ) {}

  register(): void {
    this.rpcHandler.registerMethod(
      'command:execute',
      async (params: { command: string; args?: unknown[] } | undefined) => {
        if (!params?.command) {
          return { success: false, error: 'command is required' };
        }

        // Map VS Code commands to Electron equivalents
        if (params.command === 'workbench.action.reloadWindow') {
          this.logger.info('[Electron RPC] command:execute - reloading window');
          setTimeout(() => this.platformCommands.reloadWindow(), 500);
          return { success: true };
        }

        // In Electron, VS Code commands are not available.
        // Accept ptah.* commands silently (frontend expects success).
        if (params.command.startsWith('ptah.')) {
          this.logger.debug(
            '[Electron RPC] command:execute no-op for ptah command',
            { command: params.command } as unknown as Error
          );
          return { success: true };
        }

        return {
          success: false,
          error: `Command not available in Electron: ${params.command}`,
        };
      }
    );
  }
}
