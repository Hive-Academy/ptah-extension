/**
 * Electron Config Extended RPC Handlers
 *
 * Initializes the permission handler from saved config at startup. The
 * `config:model-set`, `auth:setApiKey`, and `auth:getStatus` methods this
 * file used to register were lifted to the shared `rpc-handlers` library
 * so all hosts get the same implementation via `registerAllRpcHandlers()`.
 *
 * Kept here because the permission-handler bootstrap is Electron-specific
 * startup glue, not an RPC method — there is nowhere shared to put it.
 */

import { injectable, inject, DependencyContainer } from 'tsyringe';
import { TOKENS } from '@ptah-extension/vscode-core';
import type { Logger, RpcHandler } from '@ptah-extension/vscode-core';
import { SDK_TOKENS } from '@ptah-extension/agent-sdk';

@injectable()
export class ConfigExtendedRpcHandlers {
  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(TOKENS.RPC_HANDLER) private readonly rpcHandler: RpcHandler,
    private readonly container: DependencyContainer,
  ) {
    void this.rpcHandler;
  }

  register(): void {
    this.initializePermissionHandler();
  }

  /**
   * Initialize permission handler from saved config at startup.
   * Ensures the saved autopilot permission level is applied immediately
   * rather than waiting for the user to toggle it in the UI.
   */
  private initializePermissionHandler(): void {
    try {
      const initStorageService = this.container.resolve<{
        get<T>(key: string, defaultValue: T): T;
      }>(TOKENS.STORAGE_SERVICE);
      const savedEnabled = initStorageService.get('autopilot.enabled', false);
      const savedLevel = initStorageService.get(
        'autopilot.permissionLevel',
        'ask',
      );
      if (savedEnabled && savedLevel !== 'ask') {
        const permissionHandler = this.container.resolve<{
          setPermissionLevel(level: string): void;
        }>(SDK_TOKENS.SDK_PERMISSION_HANDLER);
        permissionHandler.setPermissionLevel(savedLevel);
        this.logger.info(
          '[Electron RPC] Initialized permission handler from saved config',
          { permissionLevel: savedLevel } as unknown as Error,
        );
      }
    } catch {
      this.logger.debug(
        '[Electron RPC] Permission handler initialization skipped (best-effort)',
      );
    }
  }
}
