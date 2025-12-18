/**
 * Chat RPC Handlers
 *
 * Handles chat-related RPC methods: chat:start, chat:continue, chat:abort
 * Manages SDK session lifecycle and streaming ExecutionNodes to webview.
 *
 * TASK_2025_074: Extracted from monolithic RpcMethodRegistrationService
 */

import { injectable, inject } from 'tsyringe';
import {
  Logger,
  RpcHandler,
  TOKENS,
  ConfigManager,
} from '@ptah-extension/vscode-core';
// eslint-disable-next-line @nx/enforce-module-boundaries
import { SdkAgentAdapter } from '@ptah-extension/agent-sdk';
import {
  SessionId,
  FlatStreamEventUnion,
  ChatStartParams,
  ChatStartResult,
  ChatContinueParams,
  ChatContinueResult,
  ChatAbortParams,
  ChatAbortResult,
  MESSAGE_TYPES,
} from '@ptah-extension/shared';

interface WebviewManager {
  sendMessage(viewType: string, type: string, payload: unknown): Promise<void>;
}

/**
 * RPC handlers for chat operations (SDK-based)
 */
@injectable()
export class ChatRpcHandlers {
  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(TOKENS.RPC_HANDLER) private readonly rpcHandler: RpcHandler,
    @inject(TOKENS.WEBVIEW_MANAGER)
    private readonly webviewManager: WebviewManager,
    @inject(TOKENS.CONFIG_MANAGER)
    private readonly configManager: ConfigManager,
    @inject('SdkAgentAdapter') private readonly sdkAdapter: SdkAgentAdapter
  ) {}

  /**
   * Register all chat RPC methods
   */
  register(): void {
    this.registerChatStart();
    this.registerChatContinue();
    this.registerChatAbort();

    this.logger.debug('Chat RPC handlers registered', {
      methods: ['chat:start', 'chat:continue', 'chat:abort'],
    });
  }

  /**
   * chat:start - Start new SDK session
   */
  private registerChatStart(): void {
    this.rpcHandler.registerMethod<ChatStartParams, ChatStartResult>(
      'chat:start',
      async (params) => {
        try {
          const { prompt, sessionId, workspacePath, options, name } = params;
          this.logger.debug('RPC: chat:start called', {
            sessionId,
            workspacePath,
            sessionName: name,
          });

          // Get current model: prefer frontend-provided model, then config, then hardcoded fallback
          const currentModel =
            options?.model ||
            this.configManager.getWithDefault<string>(
              'model.selected',
              'claude-sonnet-4-20250514'
            );

          // Start SDK session with streaming ExecutionNode output
          const stream = await this.sdkAdapter.startChatSession(sessionId, {
            workspaceId: workspacePath,
            model: options?.model || currentModel,
            systemPrompt: options?.systemPrompt,
            projectPath: workspacePath,
            name,
          });

          // Log files received for debugging (Phase 2)
          const files = options?.files ?? [];
          if (files.length > 0) {
            this.logger.debug('RPC: chat:start received files', {
              sessionId,
              fileCount: files.length,
              files,
            });
          }

          // Send initial prompt if provided
          if (prompt) {
            await this.sdkAdapter.sendMessageToSession(sessionId, prompt, {
              files,
            });
          }

          // Stream ExecutionNodes to webview (background - don't await)
          this.streamExecutionNodesToWebview(sessionId, stream);

          return { success: true, sessionId };
        } catch (error) {
          this.logger.error(
            'RPC: chat:start failed',
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

  /**
   * chat:continue - Send message to existing session (with auto-resume)
   */
  private registerChatContinue(): void {
    this.rpcHandler.registerMethod<ChatContinueParams, ChatContinueResult>(
      'chat:continue',
      async (params) => {
        try {
          const { prompt, sessionId, workspacePath, name } = params;
          this.logger.debug('RPC: chat:continue called', {
            sessionId,
            sessionName: name,
          });

          // Check if session is active in memory
          if (!this.sdkAdapter.isSessionActive(sessionId)) {
            this.logger.info(
              `[RPC] Session ${sessionId} not active, attempting resume...`
            );

            // Get current model: prefer frontend-provided model, then config, then hardcoded fallback
            const currentModel =
              params.model ||
              this.configManager.getWithDefault<string>(
                'model.selected',
                'claude-sonnet-4-20250514'
              );

            // Resume the session to reconnect to Claude's conversation context
            const stream = await this.sdkAdapter.resumeSession(sessionId, {
              projectPath: workspacePath,
              model: currentModel,
            });

            // Start streaming responses to webview (background - don't await)
            this.streamExecutionNodesToWebview(sessionId, stream);

            this.logger.info(`[RPC] Session ${sessionId} resumed successfully`);
          }

          // Extract files from params for debugging (Phase 2)
          const files = params.files ?? [];
          if (files.length > 0) {
            this.logger.debug('RPC: chat:continue received files', {
              sessionId,
              fileCount: files.length,
              files,
            });
          }

          // Now send the message to the (now active) session
          await this.sdkAdapter.sendMessageToSession(sessionId, prompt, {
            files,
          });

          return { success: true, sessionId };
        } catch (error) {
          this.logger.error(
            'RPC: chat:continue failed',
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

  /**
   * chat:abort - Interrupt session
   */
  private registerChatAbort(): void {
    this.rpcHandler.registerMethod<ChatAbortParams, ChatAbortResult>(
      'chat:abort',
      async (params) => {
        try {
          const { sessionId } = params;
          this.logger.debug('RPC: chat:abort called', { sessionId });

          await this.sdkAdapter.interruptSession(sessionId);

          return { success: true };
        } catch (error) {
          this.logger.error(
            'RPC: chat:abort failed',
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

  /**
   * Stream flat events to webview
   * Handles SDK AsyncIterable<FlatStreamEventUnion> → webview messages
   *
   * TASK_2025_082: Migrated from ExecutionNode to FlatStreamEventUnion
   * The webview rebuilds ExecutionNode trees at render time from these flat events.
   */
  private async streamExecutionNodesToWebview(
    sessionId: SessionId,
    stream: AsyncIterable<FlatStreamEventUnion>
  ): Promise<void> {
    this.logger.info(
      `[RPC] streamExecutionNodesToWebview STARTED for session ${sessionId}`
    );
    let eventCount = 0;

    try {
      for await (const event of stream) {
        eventCount++;
        this.logger.debug(
          `[RPC] Streaming event #${eventCount} type=${event.eventType} to webview`,
          { sessionId, eventType: event.eventType, messageId: event.messageId }
        );

        const sendResult = await this.webviewManager.sendMessage(
          'ptah.main',
          MESSAGE_TYPES.CHAT_CHUNK,
          {
            sessionId,
            event,
          }
        );

        this.logger.debug(`[RPC] CHAT_CHUNK sent, result=${sendResult}`, {
          sessionId,
          eventCount,
        });
      }

      this.logger.info(
        `[RPC] Stream completed for session ${sessionId}, total events: ${eventCount}`
      );

      // Stream completed successfully
      await this.webviewManager.sendMessage(
        'ptah.main',
        MESSAGE_TYPES.CHAT_COMPLETE,
        {
          sessionId,
          code: 0,
        }
      );
    } catch (error) {
      this.logger.error(
        `[RPC] Error streaming flat events for session ${sessionId} after ${eventCount} events`,
        error instanceof Error ? error : new Error(String(error))
      );
      await this.webviewManager.sendMessage(
        'ptah.main',
        MESSAGE_TYPES.CHAT_ERROR,
        {
          sessionId,
          error: error instanceof Error ? error.message : String(error),
        }
      );
    }
  }
}
