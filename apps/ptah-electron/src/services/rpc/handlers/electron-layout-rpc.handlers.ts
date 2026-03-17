/**
 * Electron Layout RPC Handlers
 *
 * Handles layout persistence methods for the Electron desktop shell:
 * - layout:persist - Accept layout state (server-side persistence hook)
 * - layout:restore - Return success (layout managed client-side via IPC state)
 *
 * Layout state is primarily managed client-side via VSCodeService.setState/getState
 * (which maps to ipcRenderer get-state/set-state). These RPC methods exist as
 * optional hooks for server-side persistence or cross-window coordination.
 *
 * TASK_2025_203 Batch 5: Extracted from inline registrations
 */

import { injectable, inject } from 'tsyringe';
import { TOKENS } from '@ptah-extension/vscode-core';
import type { Logger, RpcHandler } from '@ptah-extension/vscode-core';

@injectable()
export class ElectronLayoutRpcHandlers {
  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(TOKENS.RPC_HANDLER) private readonly rpcHandler: RpcHandler
  ) {}

  register(): void {
    this.rpcHandler.registerMethod(
      'layout:persist',
      async (params: Record<string, unknown> | undefined) => {
        this.logger.debug('[Electron RPC] layout:persist', {
          params,
        } as unknown as Error);
        return { success: true };
      }
    );

    this.rpcHandler.registerMethod('layout:restore', async () => {
      this.logger.debug('[Electron RPC] layout:restore');
      return { success: true };
    });
  }
}
