/**
 * Electron Update RPC Handlers
 *
 * Handles auto-update methods specific to the Electron app:
 *   - update:get-state    — Pull the current lifecycle state (race-proof hydration)
 *   - update:check-now    — Trigger an immediate update check
 *   - update:download-now — Start downloading an available update
 *   - update:install-now  — Quit and install a previously downloaded update
 *
 * This handler is Electron-local and must NOT appear in
 * `libs/backend/rpc-handlers/` or the SHARED_HANDLERS list.
 */

import { injectable, inject } from 'tsyringe';
import { TOKENS } from '@ptah-extension/vscode-core';
import type { Logger, RpcHandler } from '@ptah-extension/vscode-core';
import { UpdateManager } from '../../update/update-manager';
import { UPDATE_MANAGER_TOKEN } from '../../update/update-tokens';
import {
  UpdateGetStateSchema,
  UpdateCheckNowSchema,
  UpdateDownloadNowSchema,
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
    this.registerGetState();
    this.registerCheckNow();
    this.registerDownloadNow();
    this.registerInstallNow();
  }

  private registerGetState(): void {
    this.rpcHandler.registerMethod(
      'update:get-state',
      async (params: unknown) => {
        UpdateGetStateSchema.parse(params ?? {});
        return { state: this.updateManager.getCurrentState() };
      },
    );
  }

  private registerCheckNow(): void {
    this.rpcHandler.registerMethod(
      'update:check-now',
      async (params: unknown) => {
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

  private registerDownloadNow(): void {
    this.rpcHandler.registerMethod(
      'update:download-now',
      async (params: unknown) => {
        UpdateDownloadNowSchema.parse(params ?? {});
        const state = this.updateManager.getCurrentState();

        if (state.state !== 'available') {
          return {
            success: false,
            code: 'UPDATE_NOT_AVAILABLE' as const,
            error: 'No update is available to download',
          };
        }
        try {
          await this.updateManager.downloadUpdate();
          return { success: true };
        } catch (error: unknown) {
          const message =
            error instanceof Error ? error.message : String(error);
          this.logger.error(
            '[UpdateRpcHandlers] update:download-now failed',
            error instanceof Error ? error : new Error(message),
          );
          return {
            success: false,
            code: 'DOWNLOAD_FAILED' as const,
            error: message,
          };
        }
      },
    );
  }

  private registerInstallNow(): void {
    this.rpcHandler.registerMethod(
      'update:install-now',
      async (params: unknown) => {
        UpdateInstallNowSchema.parse(params ?? {});
        const state = this.updateManager.getCurrentState();

        if (state.state !== 'downloaded') {
          return {
            success: false,
            code: 'UPDATE_NOT_READY' as const,
            error: 'No update is ready to install',
          };
        }
        try {
          const { autoUpdater } = await import('electron-updater');
          autoUpdater.quitAndInstall();
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
