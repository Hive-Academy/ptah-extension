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
import {
  SdkAgentAdapter,
  SessionHistoryReaderService,
  SDK_TOKENS,
} from '@ptah-extension/agent-sdk';
import {
  SessionId,
  FlatStreamEventUnion,
  ChatStartParams,
  ChatStartResult,
  ChatContinueParams,
  ChatContinueResult,
  ChatAbortParams,
  ChatAbortResult,
  ChatResumeParams,
  ChatResumeResult,
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
    @inject('SdkAgentAdapter') private readonly sdkAdapter: SdkAgentAdapter,
    @inject(SDK_TOKENS.SDK_SESSION_HISTORY_READER)
    private readonly historyReader: SessionHistoryReaderService
  ) {}

  /**
   * Register all chat RPC methods
   */
  register(): void {
    this.registerChatStart();
    this.registerChatContinue();
    this.registerChatResume();
    this.registerChatAbort();

    this.logger.debug('Chat RPC handlers registered', {
      methods: ['chat:start', 'chat:continue', 'chat:resume', 'chat:abort'],
    });
  }

  /**
   * chat:start - Start new SDK session
   * Now uses tabId for frontend correlation instead of placeholder sessionId
   */
  private registerChatStart(): void {
    this.rpcHandler.registerMethod<ChatStartParams, ChatStartResult>(
      'chat:start',
      async (params) => {
        try {
          const { prompt, tabId, workspacePath, options, name } = params;
          this.logger.debug('RPC: chat:start called', {
            tabId,
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

          // Generate a temporary session ID for SDK lifecycle tracking
          // Real UUID will come from SDK system init message
          const tempSessionId = `temp_${Date.now()}_${Math.random()
            .toString(36)
            .substring(2, 9)}` as SessionId;

          // Start SDK session with streaming ExecutionNode output
          const stream = await this.sdkAdapter.startChatSession(tempSessionId, {
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
              tabId,
              fileCount: files.length,
              files,
            });
          }

          // Send initial prompt if provided
          if (prompt) {
            await this.sdkAdapter.sendMessageToSession(tempSessionId, prompt, {
              files,
            });
          }

          // Stream ExecutionNodes to webview (background - don't await)
          // Pass tabId so events can be routed to correct frontend tab
          this.streamExecutionNodesToWebview(tempSessionId, stream, tabId);

          return { success: true };
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
   * Now includes tabId for event routing
   */
  private registerChatContinue(): void {
    this.rpcHandler.registerMethod<ChatContinueParams, ChatContinueResult>(
      'chat:continue',
      async (params) => {
        try {
          const { prompt, sessionId, tabId, workspacePath, name } = params;
          this.logger.debug('RPC: chat:continue called', {
            sessionId,
            tabId,
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
            // Pass tabId for event routing
            this.streamExecutionNodesToWebview(sessionId, stream, tabId);

            this.logger.info(`[RPC] Session ${sessionId} resumed successfully`);
          }

          // Extract files from params for debugging (Phase 2)
          const files = params.files ?? [];
          if (files.length > 0) {
            this.logger.debug('RPC: chat:continue received files', {
              sessionId,
              tabId,
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
   * chat:resume - Load session history from JSONL files
   *
   * Used when user clicks a session from sidebar to load conversation history.
   * Returns complete messages directly in RPC response (not streaming).
   *
   * TASK_2025_092: Fixed infinite loading - Returns complete messages instead
   * of streaming events. Frontend sets messages directly on tab.
   */
  private registerChatResume(): void {
    this.rpcHandler.registerMethod<ChatResumeParams, ChatResumeResult>(
      'chat:resume',
      async (params) => {
        try {
          const { sessionId, workspacePath } = params;
          this.logger.debug('RPC: chat:resume called', { sessionId });

          // Read JSONL session history as complete messages
          const messages = await this.historyReader.readHistoryAsMessages(
            sessionId,
            workspacePath || process.cwd()
          );

          this.logger.info('[RPC] Session history loaded from JSONL', {
            sessionId,
            messageCount: messages.length,
          });

          return { success: true, messages };
        } catch (error) {
          this.logger.error(
            'RPC: chat:resume failed',
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
   * TASK_2025_092: Added tabId for frontend event routing
   * TASK_2025_092: CRITICAL FIX - Added message_complete handling for turn completion
   *   (This fix was previously only in dead-code SdkRpcHandlers, not here!)
   *
   * The webview rebuilds ExecutionNode trees at render time from these flat events.
   * Events include tabId for routing and sessionId (real SDK UUID) for storage.
   *
   * IMPORTANT: With streaming input mode, the for-await-of loop may never complete
   * because SDK keeps the session open for multi-turn. We must send chat:complete
   * on message_complete event for proper turn-level completion.
   */
  private async streamExecutionNodesToWebview(
    sessionId: SessionId,
    stream: AsyncIterable<FlatStreamEventUnion>,
    tabId: string
  ): Promise<void> {
    this.logger.info(
      `[RPC] streamExecutionNodesToWebview STARTED for session ${sessionId}, tabId ${tabId}`
    );
    let eventCount = 0;

    // TASK_2025_092: Track if we've sent chat:complete for this turn
    // This prevents duplicate completion signals when multiple message_complete events arrive
    // (e.g., OpenRouter sends duplicate assistant messages with same messageId)
    let turnCompleteSent = false;

    try {
      for await (const event of stream) {
        eventCount++;
        this.logger.debug(
          `[RPC] Streaming event #${eventCount} type=${event.eventType} to webview`,
          {
            sessionId,
            tabId,
            eventType: event.eventType,
            messageId: event.messageId,
          }
        );

        // Include tabId for frontend routing
        // sessionId in event is the real SDK UUID
        const sendResult = await this.webviewManager.sendMessage(
          'ptah.main',
          MESSAGE_TYPES.CHAT_CHUNK,
          {
            tabId, // For frontend tab routing
            sessionId: event.sessionId, // Real SDK UUID from the event
            event,
          }
        );

        this.logger.debug(`[RPC] CHAT_CHUNK sent, result=${sendResult}`, {
          sessionId,
          tabId,
          eventCount,
        });

        // TASK_2025_092: Reset turnCompleteSent when new turn starts (message_start)
        // This ensures multi-turn conversations properly signal completion for each turn
        if (event.eventType === 'message_start') {
          turnCompleteSent = false;
        }

        // TASK_2025_092: Send chat:complete when message_complete is received
        // This is the proper turn-completion signal for streaming input mode
        // where the SDK keeps the iterator open waiting for more user input.
        //
        // Why this works for both Anthropic and OpenRouter:
        // - Anthropic: stream_event with message_stop → transformer emits message_complete
        // - OpenRouter: assistant (complete) message → transformer emits message_complete
        // - In both cases, message_complete signals the end of the assistant's turn
        //
        // The session stream stays open for multi-turn conversations, but UI transitions
        // from "streaming" to "loaded" state, ready for next user input.
        this.logger.info(`[RPC] Event #${eventCount} eventType check`, {
          eventType: event.eventType,
          isMessageComplete: event.eventType === 'message_complete',
          turnCompleteSent,
          sessionId,
          tabId,
        });

        if (event.eventType === 'message_complete' && !turnCompleteSent) {
          turnCompleteSent = true;
          this.logger.info(
            `[RPC] Turn complete - sending chat:complete for session ${sessionId}, tabId ${tabId}`,
            { eventCount }
          );
          await this.webviewManager.sendMessage(
            'ptah.main',
            MESSAGE_TYPES.CHAT_COMPLETE,
            {
              tabId,
              sessionId,
              code: 0,
            }
          );
        }
      }

      // Stream fully completed (session ended) - send final completion if not already sent
      this.logger.info(
        `[RPC] Stream completed for session ${sessionId}, tabId ${tabId}, total events: ${eventCount}`
      );

      if (!turnCompleteSent) {
        await this.webviewManager.sendMessage(
          'ptah.main',
          MESSAGE_TYPES.CHAT_COMPLETE,
          {
            tabId,
            sessionId,
            code: 0,
          }
        );
      }
    } catch (error) {
      this.logger.error(
        `[RPC] Error streaming flat events for session ${sessionId}, tabId ${tabId} after ${eventCount} events`,
        error instanceof Error ? error : new Error(String(error))
      );
      await this.webviewManager.sendMessage(
        'ptah.main',
        MESSAGE_TYPES.CHAT_ERROR,
        {
          tabId,
          sessionId,
          error: error instanceof Error ? error.message : String(error),
        }
      );
    }
  }
}
