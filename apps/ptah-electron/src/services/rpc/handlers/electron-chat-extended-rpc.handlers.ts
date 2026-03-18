/**
 * Electron Chat Extended RPC Handlers
 *
 * Handles Electron-specific chat method aliases and stubs:
 * - chat:send-message - Alias for continuation messages
 * - chat:stop - Stop an active chat session via SDK
 *
 * The core chat methods (chat:start, chat:continue, chat:abort, chat:resume,
 * chat:running-agents) are handled by the shared ChatRpcHandlers.
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
export class ElectronChatExtendedRpcHandlers {
  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(TOKENS.RPC_HANDLER) private readonly rpcHandler: RpcHandler,
    @inject(SDK_TOKENS.SDK_AGENT_ADAPTER)
    private readonly sdkAdapter: SdkAgentAdapter
  ) {}

  register(): void {
    this.registerSendMessage();
    this.registerStop();
  }

  private registerSendMessage(): void {
    this.rpcHandler.registerMethod(
      'chat:send-message',
      async (
        params:
          | { sessionId: string; message: string; contextFiles?: string[] }
          | undefined
      ) => {
        if (!params?.sessionId || !params?.message) {
          return {
            success: false,
            error: 'sessionId and message are required',
          };
        }
        try {
          await this.sdkAdapter.sendMessageToSession(
            params.sessionId as SessionId,
            params.message,
            params.contextFiles ? { files: params.contextFiles } : undefined
          );
          return { success: true };
        } catch (error) {
          this.logger.error(
            '[Electron RPC] chat:send-message failed',
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

  private registerStop(): void {
    this.rpcHandler.registerMethod(
      'chat:stop',
      async (params: { sessionId: string } | undefined) => {
        if (!params?.sessionId) {
          return { success: false, error: 'sessionId is required' };
        }
        try {
          await this.sdkAdapter.interruptSession(params.sessionId as SessionId);
          return { success: true };
        } catch (error) {
          return {
            success: false,
            error: error instanceof Error ? error.message : String(error),
          };
        }
      }
    );
  }
}
