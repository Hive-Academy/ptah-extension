/**
 * Electron Config Extended RPC Handlers
 *
 * Handles Electron-specific config methods that go beyond
 * what the shared ConfigRpcHandlers provides:
 * - config:model-set - Persist model selection via StorageService
 *   (The shared ConfigRpcHandlers registers config:model-get, config:autopilot-get,
 *    config:autopilot-toggle, config:models-list, config:model-switch)
 *
 * Also initializes the permission handler from saved config at startup.
 *
 * TASK_2025_203 Batch 5: Extracted from inline registrations
 */

import { injectable, inject, DependencyContainer } from 'tsyringe';
import { TOKENS } from '@ptah-extension/vscode-core';
import type { Logger, RpcHandler } from '@ptah-extension/vscode-core';
import { SDK_TOKENS } from '@ptah-extension/agent-sdk';

/** Default model for SDK operations when no user preference is stored. */
const DEFAULT_MODEL = 'claude-sonnet-4-20250514';

@injectable()
export class ElectronConfigExtendedRpcHandlers {
  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(TOKENS.RPC_HANDLER) private readonly rpcHandler: RpcHandler,
    private readonly container: DependencyContainer
  ) {}

  register(): void {
    this.registerModelSet();
    this.initializePermissionHandler();
  }

  /**
   * Register config:model-set method.
   * The rpc-handler-setup.ts previously handled this inline. Now it's extracted
   * as a proper handler method.
   */
  private registerModelSet(): void {
    this.rpcHandler.registerMethod(
      'config:model-set',
      async (params: { model?: string; autopilot?: boolean } | undefined) => {
        if (params?.model !== undefined) {
          const storageService = this.container.resolve<{
            set<T>(key: string, value: T): Promise<void>;
          }>(TOKENS.STORAGE_SERVICE);
          await storageService.set('model.selected', params.model);
        }
        if (params?.autopilot !== undefined) {
          const storageService = this.container.resolve<{
            set<T>(key: string, value: T): Promise<void>;
          }>(TOKENS.STORAGE_SERVICE);
          await storageService.set('autopilot.enabled', params.autopilot);
        }
        return { success: true };
      }
    );
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
        'ask'
      );
      if (savedEnabled && savedLevel !== 'ask') {
        const permissionHandler = this.container.resolve<{
          setPermissionLevel(level: string): void;
        }>(SDK_TOKENS.SDK_PERMISSION_HANDLER);
        permissionHandler.setPermissionLevel(savedLevel);
        this.logger.info(
          '[Electron RPC] Initialized permission handler from saved config',
          { permissionLevel: savedLevel } as unknown as Error
        );
      }
    } catch {
      // Permission handler may not be registered yet -- best-effort
      this.logger.debug(
        '[Electron RPC] Permission handler initialization skipped (best-effort)'
      );
    }
  }
}
