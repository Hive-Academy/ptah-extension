/**
 * Update RPC Handlers
 *
 * Desktop update banner methods:
 *   - update:get-state — Pull the current lifecycle state (race-proof hydration)
 *   - update:check-now — Trigger an immediate GitHub Releases check
 *
 * Host gating is data, not location: the manifest entry declares
 * `requires: ['appUpdater']`, and only hosts whose profile turns that
 * capability on (Electron today) register an `IAppUpdater` implementation.
 * Hosts that leave it off never resolve this class. It is therefore NOT
 * registered by `registerSharedRpcHandlers` — that runs on every host and is
 * reserved for handlers every host serves unconditionally.
 */

import { injectable, inject } from 'tsyringe';
import { TOKENS } from '@ptah-extension/vscode-core';
import type { Logger, RpcHandler } from '@ptah-extension/vscode-core';
import { PLATFORM_TOKENS } from '@ptah-extension/platform-core';
import type { IAppUpdater } from '@ptah-extension/platform-core';
import type {
  RpcMethodName,
  UpdateCheckNowParams,
  UpdateCheckNowResult,
  UpdateGetStateParams,
  UpdateGetStateResult,
} from '@ptah-extension/shared';
import {
  UpdateGetStateSchema,
  UpdateCheckNowSchema,
} from './update-rpc.schema';

@injectable()
export class UpdateRpcHandlers {
  static readonly METHODS = [
    'update:get-state',
    'update:check-now',
  ] as const satisfies readonly RpcMethodName[];

  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(TOKENS.RPC_HANDLER) private readonly rpcHandler: RpcHandler,
    @inject(PLATFORM_TOKENS.APP_UPDATER)
    private readonly updateManager: IAppUpdater,
  ) {}

  register(): void {
    this.registerGetState();
    this.registerCheckNow();
  }

  private registerGetState(): void {
    this.rpcHandler.registerMethod<UpdateGetStateParams, UpdateGetStateResult>(
      'update:get-state',
      async (params: unknown) => {
        UpdateGetStateSchema.parse(params ?? {});
        return { state: this.updateManager.getCurrentState() };
      },
    );
  }

  private registerCheckNow(): void {
    this.rpcHandler.registerMethod<UpdateCheckNowParams, UpdateCheckNowResult>(
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
