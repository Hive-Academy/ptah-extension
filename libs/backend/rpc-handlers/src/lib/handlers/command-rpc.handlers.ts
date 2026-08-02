/**
 * Command RPC Handlers — `command:execute`.
 *
 * SECURITY: this is the boundary that stops a webview from running arbitrary
 * host commands. Only `ptah.*` and a short exact-match list get through;
 * everything else is refused before the host ever sees it. Execution itself
 * is IPlatformCommands' job — VS Code forwards to its command registry,
 * Electron implements each id directly.
 *
 * Unified from two app-local copies that had drifted apart in kind: VS Code
 * had the allowlist but no implementations, Electron had implementations but
 * no allowlist. Splitting them along the port boundary gives both hosts both
 * halves — which means Electron gains the gate it was missing.
 */

import { injectable, inject } from 'tsyringe';
import type { DependencyContainer } from 'tsyringe';
import { TOKENS } from '@ptah-extension/vscode-core';
import type { Logger, RpcHandler } from '@ptah-extension/vscode-core';
import { PLATFORM_TOKENS } from '@ptah-extension/platform-core';
import type { IPlatformCommands } from '@ptah-extension/platform-core';
import type {
  CommandExecuteParams,
  CommandExecuteResponse,
  RpcMethodName,
} from '@ptah-extension/shared';

/** Every Ptah-owned command is addressable by the webview that ships with it. */
const ALLOWED_COMMAND_PREFIXES = ['ptah.'];

/**
 * Host commands the webview may invoke by name. Keep this list short and
 * justified — each entry is a hole in the boundary above.
 */
const ALLOWED_EXACT_COMMANDS = [
  // Reload after an auth/config change that needs a fresh window.
  'workbench.action.reloadWindow',
  // Open-folder dialog behind the setup widget's no-workspace guard.
  'workbench.action.files.openFolder',
];

@injectable()
export class CommandRpcHandlers {
  static readonly METHODS = [
    'command:execute',
  ] as const satisfies readonly RpcMethodName[];

  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(TOKENS.RPC_HANDLER) private readonly rpcHandler: RpcHandler,
    @inject(TOKENS.PLATFORM_COMMANDS)
    private readonly platformCommands: IPlatformCommands,
    @inject(PLATFORM_TOKENS.DI_CONTAINER)
    private readonly container: DependencyContainer,
  ) {}

  register(): void {
    this.rpcHandler.registerMethod<
      CommandExecuteParams,
      CommandExecuteResponse
    >('command:execute', async (params) => {
      const command = params?.command;
      if (!command) {
        return { success: false, error: 'command is required' };
      }

      if (!isAllowed(command)) {
        this.logger.warn('RPC: command:execute blocked disallowed command', {
          command,
        });
        return {
          success: false,
          error: `Command not allowed from webview. Received: ${command}`,
        };
      }

      try {
        const result = await this.platformCommands.executeCommand(
          command,
          params.args,
        );
        if (!result.handled) {
          return {
            success: false,
            error: result.error ?? `Command not supported: ${command}`,
          };
        }
        this.logger.debug('RPC: command:execute success', { command });
        return { success: true };
      } catch (error: unknown) {
        this.captureException(error);
        this.logger.error(
          'RPC: command:execute failed',
          error instanceof Error ? error : new Error(String(error)),
        );
        return {
          success: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    });
  }

  /** Report to Sentry when the host registered it. */
  private captureException(error: unknown): void {
    if (!this.container.isRegistered(TOKENS.SENTRY_SERVICE)) return;
    try {
      this.container
        .resolve<{
          captureException(e: Error, ctx: { errorSource: string }): void;
        }>(TOKENS.SENTRY_SERVICE)
        .captureException(
          error instanceof Error ? error : new Error(String(error)),
          { errorSource: 'CommandRpcHandlers.registerCommandExecute' },
        );
    } catch {
      // Observability must never break an RPC call.
    }
  }
}

function isAllowed(command: string): boolean {
  return (
    ALLOWED_COMMAND_PREFIXES.some((prefix) => command.startsWith(prefix)) ||
    ALLOWED_EXACT_COMMANDS.includes(command)
  );
}
