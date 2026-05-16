/**
 * Electron Command RPC Handlers
 *
 * Handles command execution in Electron by mapping VS Code commands
 * to Electron equivalents:
 * - workbench.action.reloadWindow → app.relaunch() + app.exit()
 * - ptah.openPricing / ptah.openSignup → shell.openExternal(url)
 * - Other ptah.* commands → accepted silently (no-op)
 *
 * Uses resolveEnvironment() to pick dev vs production URLs,
 * matching the VS Code extension's behavior.
 */

import { injectable, inject } from 'tsyringe';
import { TOKENS } from '@ptah-extension/vscode-core';
import type { Logger, RpcHandler } from '@ptah-extension/vscode-core';
import type { IPlatformCommands } from '@ptah-extension/rpc-handlers';
import { resolveEnvironment, MESSAGE_TYPES } from '@ptah-extension/shared';

/**
 * Minimal interface for the WebviewManager's broadcast capability.
 * Matches ElectronWebviewManagerAdapter.broadcastMessage() signature.
 */
interface WebviewBroadcaster {
  broadcastMessage(type: string, payload: unknown): Promise<void>;
}

@injectable()
export class CommandRpcHandlers {
  /** Resolved URLs for the current environment (dev vs production) */
  private readonly urls = resolveEnvironment(
    process.env['NODE_ENV'] === 'development',
  ).urls;

  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(TOKENS.RPC_HANDLER) private readonly rpcHandler: RpcHandler,
    @inject(TOKENS.PLATFORM_COMMANDS)
    private readonly platformCommands: IPlatformCommands,
    @inject(TOKENS.WEBVIEW_MANAGER)
    private readonly webviewManager: WebviewBroadcaster,
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

        // Map ptah.* commands that have Electron equivalents
        const handled = await this.handlePtahCommand(params.command);
        if (handled !== null) {
          return handled;
        }

        return {
          success: false,
          error: `Command not available in Electron: ${params.command}`,
        };
      },
    );
  }

  /**
   * Handle ptah.* commands with Electron-specific implementations.
   * Returns null if the command is unknown (caller should reject).
   */
  private async handlePtahCommand(
    command: string,
  ): Promise<{ success: boolean; error?: string } | null> {
    if (!command.startsWith('ptah.')) {
      return null;
    }

    switch (command) {
      // Open external URLs in system browser (matches VS Code extension behavior)
      case 'ptah.openPricing': {
        const { shell } = await import('electron');
        await shell.openExternal(this.urls.PRICING_URL);
        this.logger.debug('[Electron RPC] Opened pricing page', {
          url: this.urls.PRICING_URL,
        } as unknown as Error);
        return { success: true };
      }

      case 'ptah.openSignup': {
        const { shell } = await import('electron');
        const signupUrl = this.urls.SIGNUP_URL + '?source=electron';
        await shell.openExternal(signupUrl);
        this.logger.debug('[Electron RPC] Opened signup page', {
          url: signupUrl,
        } as unknown as Error);
        return { success: true };
      }

      // Backward compat: sends 'orchestra-canvas' which AppStateManager.handleViewSwitch()
      // maps to layoutMode('grid') + chat view at runtime.
      case 'ptah.openOrchestraCanvas': {
        await this.webviewManager.broadcastMessage(MESSAGE_TYPES.SWITCH_VIEW, {
          view: 'orchestra-canvas',
        });
        this.logger.info(
          '[Electron RPC] Orchestra Canvas opened via SWITCH_VIEW',
        );
        return { success: true };
      }

      // Commands that are VS Code-specific and have no Electron equivalent
      case 'ptah.openFullPanel':
      case 'ptah.toggleChat':
        return {
          success: false,
          error: `Command not available in Electron: ${command}`,
        };

      // Unknown ptah.* commands — fail explicitly to prevent silent no-ops
      default:
        this.logger.debug(
          '[Electron RPC] command:execute - unknown ptah command',
          { command } as unknown as Error,
        );
        return {
          success: false,
          error: `Command not supported in Electron: ${command}`,
        };
    }
  }
}
