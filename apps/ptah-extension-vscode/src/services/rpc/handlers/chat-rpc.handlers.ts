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
  SubagentRegistryService,
  LicenseService,
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
    private readonly historyReader: SessionHistoryReaderService,
    @inject(TOKENS.SUBAGENT_REGISTRY_SERVICE)
    private readonly subagentRegistry: SubagentRegistryService,
    @inject(TOKENS.LICENSE_SERVICE)
    private readonly licenseService: LicenseService
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

          // TASK_2025_108: Get license status for premium feature gating
          const licenseStatus = await this.licenseService.verifyLicense();
          const isPremium =
            licenseStatus.valid &&
            (licenseStatus.plan?.isPremium === true ||
              licenseStatus.tier === 'early_adopter');

          this.logger.debug('RPC: chat:start - license check', {
            tier: licenseStatus.tier,
            isPremium,
          });

          // Get current model: prefer frontend-provided model, then config, then hardcoded fallback
          const currentModel =
            options?.model ||
            this.configManager.getWithDefault<string>(
              'model.selected',
              'claude-sonnet-4-20250514'
            );

          // TASK_2025_093: tabId is now the primary tracking key
          // SDK generates real UUID in system init message
          const files = options?.files ?? [];

          // Log files received for debugging (Phase 2)
          if (files.length > 0) {
            this.logger.debug('RPC: chat:start received files', {
              tabId,
              fileCount: files.length,
              files,
            });
          }

          // Start SDK session with streaming ExecutionNode output
          // TASK_2025_093: Single config argument with tabId as primary tracking key
          // Prompt and files are now passed in config, not via separate sendMessageToSession
          // TASK_2025_108: Pass isPremium for premium feature gating (MCP + system prompt)
          const stream = await this.sdkAdapter.startChatSession({
            tabId, // REQUIRED: Primary tracking key for multi-tab isolation
            workspaceId: workspacePath,
            model: options?.model || currentModel,
            systemPrompt: options?.systemPrompt,
            projectPath: workspacePath,
            name,
            prompt, // Initial prompt passed in config
            files,
            isPremium, // TASK_2025_108: Enable premium features for licensed users
          });

          // Stream ExecutionNodes to webview (background - don't await)
          // Pass tabId so events can be routed to correct frontend tab
          this.streamExecutionNodesToWebview(tabId as SessionId, stream, tabId);

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

            // TASK_2025_108: Get license status for premium feature gating in resumed sessions
            const licenseStatus = await this.licenseService.verifyLicense();
            const isPremium =
              licenseStatus.valid &&
              (licenseStatus.plan?.isPremium === true ||
                licenseStatus.tier === 'early_adopter');

            this.logger.debug('RPC: chat:continue - license check for resume', {
              tier: licenseStatus.tier,
              isPremium,
              sessionId,
            });

            // Get current model: prefer frontend-provided model, then config, then hardcoded fallback
            const currentModel =
              params.model ||
              this.configManager.getWithDefault<string>(
                'model.selected',
                'claude-sonnet-4-20250514'
              );

            // Resume the session to reconnect to Claude's conversation context
            // TASK_2025_108: Pass isPremium to maintain premium features in resumed sessions
            const stream = await this.sdkAdapter.resumeSession(sessionId, {
              projectPath: workspacePath,
              model: currentModel,
              isPremium,
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

          // TASK_2025_109: Inject interrupted subagent context into prompt
          // This enables Claude to naturally resume interrupted agents through conversation
          // instead of requiring a dedicated Resume RPC and UI button.
          let enhancedPrompt = prompt;
          const resumableSubagents =
            this.subagentRegistry.getResumableBySession(sessionId);

          if (resumableSubagents.length > 0) {
            const agentContext = resumableSubagents
              .map((s) => `agentId: ${s.agentId} (${s.agentType})`)
              .join(', ');
            const contextPrefix = `[System: Previously interrupted agents available for resumption: ${agentContext}. You can resume them by including their agentId in your response.]\n\n`;
            enhancedPrompt = contextPrefix + prompt;

            this.logger.info('RPC: chat:continue - injected subagent context', {
              sessionId,
              resumableCount: resumableSubagents.length,
              agents: resumableSubagents.map((s) => ({
                agentId: s.agentId,
                agentType: s.agentType,
              })),
            });
          }

          // Now send the message to the (now active) session
          await this.sdkAdapter.sendMessageToSession(sessionId, enhancedPrompt, {
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
   * Returns full streaming events for building ExecutionNode tree with tool calls.
   *
   * TASK_2025_092 FIX: Now returns `events` array with FlatStreamEventUnion
   * including tool_start, tool_result, thinking, agent_start events.
   * Frontend processes these through StreamingHandler to build execution tree.
   *
   * Also returns `messages` for backward compatibility (deprecated).
   */
  private registerChatResume(): void {
    this.rpcHandler.registerMethod<ChatResumeParams, ChatResumeResult>(
      'chat:resume',
      async (params) => {
        try {
          const { sessionId, workspacePath } = params;
          this.logger.debug('RPC: chat:resume called', { sessionId });

          const resolvedWorkspacePath = workspacePath || process.cwd();

          // TASK_2025_092 FIX: Read full session history as FlatStreamEventUnion[]
          // This includes tool calls, thinking blocks, agent spawns, etc.
          // Also includes aggregated usage stats from JSONL
          const { events, stats } = await this.historyReader.readSessionHistory(
            sessionId,
            resolvedWorkspacePath
          );

          // Also read simple messages for backward compatibility
          const messages = await this.historyReader.readHistoryAsMessages(
            sessionId,
            resolvedWorkspacePath
          );

          // TASK_2025_103 FIX: Query resumable subagents for this session
          // Frontend uses this to mark agent nodes as resumable when loading from history
          const resumableSubagents =
            this.subagentRegistry.getResumableBySession(sessionId);

          this.logger.info('[RPC] Session history loaded from JSONL', {
            sessionId,
            messageCount: messages.length,
            eventCount: events.length,
            hasStats: !!stats,
            totalCost: stats?.totalCost,
            resumableSubagentCount: resumableSubagents.length,
          });

          return { success: true, messages, events, stats, resumableSubagents };
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
        await this.webviewManager.sendMessage(
          'ptah.main',
          MESSAGE_TYPES.CHAT_CHUNK,
          {
            tabId, // For frontend tab routing
            sessionId: event.sessionId, // Real SDK UUID from the event
            event,
          }
        );

        // TASK_2025_092: Reset turnCompleteSent when new turn starts (message_start)
        // This ensures multi-turn conversations properly signal completion for each turn
        if (event.eventType === 'message_start') {
          turnCompleteSent = false;
        }

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
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      const lowerMessage = errorMessage.toLowerCase();

      // Check if this is a user-initiated abort (not a real error)
      const isUserAbort =
        lowerMessage.includes('aborted by user') ||
        lowerMessage.includes('abort') ||
        lowerMessage.includes('cancelled') ||
        lowerMessage.includes('canceled');

      if (isUserAbort) {
        // User aborts are expected behavior, log at INFO level
        this.logger.info(
          `[RPC] Session ${sessionId} aborted by user after ${eventCount} events`
        );
      } else {
        // Real errors should be logged at ERROR level
        this.logger.error(
          `[RPC] Error streaming flat events for session ${sessionId}, tabId ${tabId} after ${eventCount} events`,
          error instanceof Error ? error : new Error(String(error))
        );
      }

      // Send error to webview (frontend handles abort vs error display)
      await this.webviewManager.sendMessage(
        'ptah.main',
        MESSAGE_TYPES.CHAT_ERROR,
        {
          tabId,
          sessionId,
          error: errorMessage,
        }
      );
    }
  }
}
