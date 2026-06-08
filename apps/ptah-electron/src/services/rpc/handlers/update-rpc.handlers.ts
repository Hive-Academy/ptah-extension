/**
 * Electron Update RPC Handlers
 *
 * Desktop update banner methods:
 *   - update:get-state — Pull the current lifecycle state (race-proof hydration)
 *   - update:check-now — Trigger an immediate GitHub Releases check
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
}
