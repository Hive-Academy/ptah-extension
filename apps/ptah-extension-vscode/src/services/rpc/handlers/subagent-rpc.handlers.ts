/**
 * Subagent RPC Handlers
 *
 * Handles subagent-related RPC methods: subagent:resume, subagent:query
 * Provides frontend access to subagent resumption functionality.
 *
 * TASK_2025_103: Subagent Resumption Feature
 *
 * RPC Methods:
 * - subagent:resume - Resume an interrupted subagent by toolCallId
 * - subagent:query - Query subagents (resumable or by specific ID)
 */

import { injectable, inject } from 'tsyringe';
import {
  Logger,
  RpcHandler,
  TOKENS,
  SubagentRegistryService,
} from '@ptah-extension/vscode-core';
// eslint-disable-next-line @nx/enforce-module-boundaries
import { SdkAgentAdapter, SDK_TOKENS } from '@ptah-extension/agent-sdk';
import {
  SubagentResumeParams,
  SubagentResumeResult,
  SubagentQueryParams,
  SubagentQueryResult,
  FlatStreamEventUnion,
  MESSAGE_TYPES,
  SessionId,
} from '@ptah-extension/shared';

interface WebviewManager {
  sendMessage(viewType: string, type: string, payload: unknown): Promise<void>;
}

/**
 * RPC handlers for subagent operations (resumption and query)
 *
 * @example
 * ```typescript
 * // Frontend: Resume an interrupted subagent
 * const result = await rpcService.call('subagent:resume', { toolCallId: 'toolu_abc123' });
 *
 * // Frontend: Query all resumable subagents
 * const { subagents } = await rpcService.call('subagent:query', {});
 * ```
 */
@injectable()
export class SubagentRpcHandlers {
  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(TOKENS.RPC_HANDLER) private readonly rpcHandler: RpcHandler,
    @inject(TOKENS.SUBAGENT_REGISTRY_SERVICE)
    private readonly registry: SubagentRegistryService,
    @inject(TOKENS.WEBVIEW_MANAGER)
    private readonly webviewManager: WebviewManager,
    @inject(TOKENS.SDK_AGENT_ADAPTER)
    private readonly sdkAdapter: SdkAgentAdapter
  ) {}

  /**
   * Register all subagent RPC methods
   */
  register(): void {
    this.registerSubagentResume();
    this.registerSubagentQuery();

    this.logger.debug('Subagent RPC handlers registered', {
      methods: ['subagent:resume', 'subagent:query'],
    });
  }

  /**
   * subagent:resume - Resume an interrupted subagent
   *
   * Looks up the subagent record by toolCallId and initiates
   * SDK resumption if the subagent is in 'interrupted' status.
   * The streaming response is wired to the webview for UI updates.
   *
   * FIX (TASK_2025_103 QA): Now properly consumes the AsyncIterable stream
   * and routes events to webview. Registry entry is only removed after
   * streaming completes successfully.
   *
   * @returns Success if resume initiated, error if subagent not found or not resumable
   */
  private registerSubagentResume(): void {
    this.rpcHandler.registerMethod<SubagentResumeParams, SubagentResumeResult>(
      'subagent:resume',
      async (params) => {
        try {
          const { toolCallId } = params;

          this.logger.info('RPC: subagent:resume called', { toolCallId });

          // Look up the subagent record
          const record = this.registry.get(toolCallId);

          if (!record) {
            this.logger.warn(
              'RPC: subagent:resume failed - subagent not found',
              { toolCallId }
            );
            return {
              success: false,
              error: 'Subagent not found or expired',
            };
          }

          if (record.status !== 'interrupted') {
            this.logger.warn(
              'RPC: subagent:resume failed - subagent not resumable',
              {
                toolCallId,
                status: record.status,
              }
            );
            return {
              success: false,
              error: `Subagent is not resumable (status: ${record.status})`,
            };
          }

          // Resume the subagent via SDK adapter
          this.logger.info('RPC: subagent:resume initiating SDK resume', {
            toolCallId,
            sessionId: record.sessionId,
            agentType: record.agentType,
            parentSessionId: record.parentSessionId,
          });

          // Mark as 'running' to prevent double-resume attempts while streaming
          this.registry.update(toolCallId, { status: 'running' });

          // Call the SDK adapter to resume the subagent
          // FIX: Wire the stream to the webview instead of discarding it
          const stream = await this.sdkAdapter.resumeSubagent(record);

          // Stream events to webview in background (don't await - return immediately)
          // Use parent session ID for routing since that's the active chat session
          this.streamSubagentEventsToWebview(
            record.parentSessionId as SessionId,
            stream,
            toolCallId
          );

          this.logger.info('RPC: subagent:resume streaming started', {
            toolCallId,
            sessionId: record.sessionId,
          });

          return { success: true };
        } catch (error) {
          this.logger.error(
            'RPC: subagent:resume failed',
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
   * Stream subagent events to webview
   *
   * FIX (TASK_2025_103 QA): Properly consume the AsyncIterable stream from
   * resumeSubagent and route events to the webview. Registry entry is only
   * removed after streaming completes successfully.
   *
   * @param parentSessionId - Parent session ID for routing to correct tab
   * @param stream - AsyncIterable stream from SDK
   * @param toolCallId - Tool call ID for registry cleanup
   */
  private async streamSubagentEventsToWebview(
    parentSessionId: SessionId,
    stream: AsyncIterable<FlatStreamEventUnion>,
    toolCallId: string
  ): Promise<void> {
    this.logger.info(
      `[SubagentRPC] streamSubagentEventsToWebview STARTED for toolCallId ${toolCallId}`
    );
    let eventCount = 0;
    let turnCompleteSent = false;

    try {
      for await (const event of stream) {
        eventCount++;
        this.logger.debug(
          `[SubagentRPC] Streaming event #${eventCount} type=${event.eventType}`,
          {
            parentSessionId,
            toolCallId,
            eventType: event.eventType,
            messageId: event.messageId,
          }
        );

        // Send event to webview using parent session ID for tab routing
        await this.webviewManager.sendMessage(
          'ptah.main',
          MESSAGE_TYPES.CHAT_CHUNK,
          {
            sessionId: parentSessionId,
            event,
          }
        );

        // Reset turn complete flag on new message
        if (event.eventType === 'message_start') {
          turnCompleteSent = false;
        }

        // Send chat:complete on message_complete
        if (event.eventType === 'message_complete' && !turnCompleteSent) {
          turnCompleteSent = true;
          this.logger.info(
            `[SubagentRPC] Turn complete for subagent ${toolCallId}`,
            { eventCount }
          );
          await this.webviewManager.sendMessage(
            'ptah.main',
            MESSAGE_TYPES.CHAT_COMPLETE,
            {
              sessionId: parentSessionId,
              code: 0,
            }
          );
        }
      }

      // Stream completed successfully - remove from registry
      this.registry.remove(toolCallId);
      this.logger.info(
        `[SubagentRPC] Subagent resume completed successfully for ${toolCallId}`,
        { eventCount }
      );

      // Send final complete if not sent during stream
      if (!turnCompleteSent) {
        await this.webviewManager.sendMessage(
          'ptah.main',
          MESSAGE_TYPES.CHAT_COMPLETE,
          {
            sessionId: parentSessionId,
            code: 0,
          }
        );
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      const lowerMessage = errorMessage.toLowerCase();

      // Check if this is a user-initiated abort
      const isUserAbort =
        lowerMessage.includes('aborted by user') ||
        lowerMessage.includes('abort') ||
        lowerMessage.includes('cancelled') ||
        lowerMessage.includes('canceled');

      if (isUserAbort) {
        this.logger.info(
          `[SubagentRPC] Subagent ${toolCallId} aborted by user after ${eventCount} events`
        );
        // Mark as interrupted again so it can be re-resumed
        this.registry.update(toolCallId, {
          status: 'interrupted',
          interruptedAt: Date.now(),
        });
      } else {
        this.logger.error(
          `[SubagentRPC] Error streaming subagent ${toolCallId} after ${eventCount} events`,
          error instanceof Error ? error : new Error(String(error))
        );
        // Keep as 'running' to prevent re-resume attempts on error
        // The record will expire via TTL cleanup
      }

      // Send error to webview
      await this.webviewManager.sendMessage(
        'ptah.main',
        MESSAGE_TYPES.CHAT_ERROR,
        {
          sessionId: parentSessionId,
          error: errorMessage,
        }
      );
    }
  }

  /**
   * subagent:query - Query subagents from the registry
   *
   * Supports three query modes:
   * 1. By toolCallId: Returns specific subagent record
   * 2. By sessionId: Returns resumable subagents for a specific session
   * 3. No params: Returns all resumable subagents
   *
   * @returns Array of matching SubagentRecord objects
   */
  private registerSubagentQuery(): void {
    this.rpcHandler.registerMethod<SubagentQueryParams, SubagentQueryResult>(
      'subagent:query',
      async (params) => {
        try {
          const { toolCallId, sessionId } = params;

          this.logger.debug('RPC: subagent:query called', {
            toolCallId,
            sessionId,
          });

          // Query by specific toolCallId
          if (toolCallId) {
            const record = this.registry.get(toolCallId);
            return { subagents: record ? [record] : [] };
          }

          // Query by session ID (return only resumable for that session)
          if (sessionId) {
            const subagents = this.registry.getResumableBySession(sessionId);
            this.logger.debug('RPC: subagent:query by session result', {
              sessionId,
              count: subagents.length,
            });
            return { subagents };
          }

          // Return all resumable subagents
          const subagents = this.registry.getResumable();
          this.logger.debug('RPC: subagent:query all resumable result', {
            count: subagents.length,
          });
          return { subagents };
        } catch (error) {
          this.logger.error(
            'RPC: subagent:query failed',
            error instanceof Error ? error : new Error(String(error))
          );
          // Return empty array on error
          return { subagents: [] };
        }
      }
    );
  }
}
