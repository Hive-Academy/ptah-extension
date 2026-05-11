/**
 * Electron Update RPC Handlers
 *
 * Handles auto-update methods specific to the Electron app:
 *   - update:check-now   — Trigger an immediate update check
 *   - update:install-now — Quit and install a previously downloaded update
 *
 * This handler is Electron-local and must NOT appear in
 * `libs/backend/rpc-handlers/` or the SHARED_HANDLERS list.
 *
 * TASK_2026_117: In-App Electron Auto-Update UX (VS Code-Style)
 */

import { injectable, inject } from 'tsyringe';
import { TOKENS } from '@ptah-extension/vscode-core';
import type { Logger, RpcHandler } from '@ptah-extension/vscode-core';
import { UpdateManager } from '../../update/update-manager';
import { UPDATE_MANAGER_TOKEN } from '../../update/update-tokens';
import {
  UpdateCheckNowSchema,
  UpdateInstallNowSchema,
} from './update-rpc.schema';

@injectable()
export class UpdateRpcHandlers {
  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(TOKENS.RPC_HANDLER) private readonly rpcHandler: RpcHandler,
    @inject(UPDATE_MANAGER_TOKEN) private readonly updateManager: UpdateManager,
  ) {}

  register(): void {
    this.registerCheckNow();
    this.registerInstallNow();
  }

  private registerCheckNow(): void {
    this.rpcHandler.registerMethod(
      'update:check-now',
      async (params: unknown) => {
        // Validate input (empty object schema)
        UpdateCheckNowSchema.parse(params ?? {});

        try {
          await this.updateManager.triggerCheck();
          return { success: true };
        } catch (error: unknown) {
          const message =
            error instanceof Error ? error.message : String(error);
          this.logger.error(
            '[UpdateRpcHandlers] update:check-now failed',
            error instanceof Error ? error : new Error(message),
          );
          return { success: false, error: message };
        }
      },
    );
  }

  private registerInstallNow(): void {
    this.rpcHandler.registerMethod(
      'update:install-now',
      async (params: unknown) => {
        // Validate input (empty object schema)
        UpdateInstallNowSchema.parse(params ?? {});

        // Synchronous read — _currentState is set before broadcastMessage,
        // so there is no race condition with async event listeners.
        const state = this.updateManager.getCurrentState();

        if (state.state !== 'downloaded') {
          return {
            success: false,
            code: 'UPDATE_NOT_READY' as const,
            error: 'No update is ready to install',
          };
        }

        // FIX 3: Wrap quitAndInstall() in try/catch so that synchronous
        // throws (e.g. Windows elevation failure, expired code signature)
        // are returned as structured errors rather than unhandled rejections.
        try {
          const { autoUpdater } = await import('electron-updater');
          autoUpdater.quitAndInstall();
          // quitAndInstall() terminates the app; return below is technically
          // unreachable on success but satisfies the type contract.
          return { success: true };
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : String(err);
          this.logger.error(
            '[UpdateRpcHandlers] quitAndInstall failed',
            err instanceof Error ? err : new Error(message),
          );
          return {
            success: false,
            code: 'INSTALL_FAILED' as const,
            error: message,
          };
        }
      },
    );
  }
}
