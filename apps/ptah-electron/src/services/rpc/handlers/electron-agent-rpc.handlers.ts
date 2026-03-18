/**
 * Electron Agent RPC Handlers
 *
 * Handles agent management methods specific to Electron:
 * - agent:stop - Stop an active agent session via SDK
 *
 * TASK_2025_203 Batch 5: Extracted from inline registrations
 */

import { injectable, inject } from 'tsyringe';
import { TOKENS } from '@ptah-extension/vscode-core';
import type { Logger, RpcHandler } from '@ptah-extension/vscode-core';
import { SDK_TOKENS } from '@ptah-extension/agent-sdk';
import type { SdkAgentAdapter } from '@ptah-extension/agent-sdk';
import type { SessionId } from '@ptah-extension/shared';

@injectable()
export class ElectronAgentRpcHandlers {
  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(TOKENS.RPC_HANDLER) private readonly rpcHandler: RpcHandler,
    @inject(SDK_TOKENS.SDK_AGENT_ADAPTER)
    private readonly sdkAdapter: SdkAgentAdapter
  ) {}

  register(): void {
    this.rpcHandler.registerMethod(
      'agent:stop',
      async (params: { agentId: string } | undefined) => {
        if (!params?.agentId) {
          return { success: false, error: 'agentId is required' };
        }
        try {
          await this.sdkAdapter.interruptSession(params.agentId as SessionId);
          return { success: true };
        } catch (error) {
          this.logger.error(
            '[Electron RPC] agent:stop failed',
            error instanceof Error ? error : new Error(String(error))
          );
          return {
            success: false,
            error: error instanceof Error ? error.message : String(error),
          };
        }
      }
    );
  }
}
