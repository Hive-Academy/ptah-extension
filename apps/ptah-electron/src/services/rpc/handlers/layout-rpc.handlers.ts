/**
 * Electron Layout RPC Handlers
 *
 * Handles desktop layout persistence methods:
 * - layout:persist - Save layout state (sidebar/editor panel widths) to storage
 * - layout:restore - Restore saved layout state from storage
 *
 * Layout state is primarily managed client-side via signals. These RPC methods
 * provide optional persistence across Electron restarts via IStateStorage.
 */

import { injectable, inject } from 'tsyringe';
import { TOKENS } from '@ptah-extension/vscode-core';
import type { Logger, RpcHandler } from '@ptah-extension/vscode-core';
import { PLATFORM_TOKENS } from '@ptah-extension/platform-core';
import type { IStateStorage } from '@ptah-extension/platform-core';

const LAYOUT_STORAGE_KEY = 'electron.layout.state';

@injectable()
export class ElectronLayoutRpcHandlers {
  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(TOKENS.RPC_HANDLER) private readonly rpcHandler: RpcHandler,
    @inject(PLATFORM_TOKENS.STATE_STORAGE)
    private readonly stateStorage: IStateStorage
  ) {}

  register(): void {
    this.registerPersist();
    this.registerRestore();

    this.logger.debug('Electron Layout RPC handlers registered', {
      methods: ['layout:persist', 'layout:restore'],
    });
  }

  private registerPersist(): void {
    this.rpcHandler.registerMethod(
      'layout:persist',
      async (params: Record<string, unknown> | undefined) => {
        try {
          if (params && Object.keys(params).length > 0) {
            await this.stateStorage.update(LAYOUT_STORAGE_KEY, params);
            this.logger.debug('[Electron RPC] layout:persist saved', {
              keys: Object.keys(params),
            });
          }
          return { success: true };
        } catch (error) {
          this.logger.error(
            '[Electron RPC] layout:persist failed',
            error instanceof Error ? error : new Error(String(error))
          );
          return { success: true };
        }
      }
    );
  }

  private registerRestore(): void {
    this.rpcHandler.registerMethod('layout:restore', async () => {
      try {
        const saved = this.stateStorage.get<Record<string, unknown>>(
          LAYOUT_STORAGE_KEY,
          {}
        );
        this.logger.debug('[Electron RPC] layout:restore loaded', {
          hasData: !!saved && Object.keys(saved).length > 0,
        });
        return { success: true, ...saved };
      } catch (error) {
        this.logger.error(
          '[Electron RPC] layout:restore failed',
          error instanceof Error ? error : new Error(String(error))
        );
        return { success: true };
      }
    });
  }
}
