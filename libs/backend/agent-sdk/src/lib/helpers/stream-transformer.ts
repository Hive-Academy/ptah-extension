/**
 * Stream Transformer
 *
 * Transforms SDK message streams into ExecutionNode streams.
 * Handles session ID extraction and message storage.
 */

import { injectable, inject } from 'tsyringe';
import {
  SessionId,
  FlatStreamEventUnion,
  MessageId,
} from '@ptah-extension/shared';
import { Logger, TOKENS } from '@ptah-extension/vscode-core';
import {
  SdkMessageTransformer,
  isSDKResultMessage,
} from '../sdk-message-transformer';
import { SdkSessionStorage } from '../sdk-session-storage';
import { StoredSessionMessage } from '../types/sdk-session.types';
import { SDK_TOKENS } from '../di/tokens';
import { SessionLifecycleManager } from './session-lifecycle-manager';

/**
 * Generic SDK message type
 */
type SDKMessage = {
  type: string;
  [key: string]: unknown;
};

/**
 * Callback type for notifying when real Claude session ID is resolved
 */
export type SessionIdResolvedCallback = (
  placeholderId: SessionId,
  realClaudeSessionId: string
) => void;

/**
 * Callback type for notifying when result message with stats is received
 */
export type ResultStatsCallback = (stats: {
  sessionId: SessionId;
  cost: number;
  tokens: { input: number; output: number };
  duration: number;
}) => void;

/**
 * Configuration for stream transformation
 */
export interface StreamTransformConfig {
  sdkQuery: AsyncIterable<SDKMessage>;
  sessionId: SessionId;
  initialModel: string;
  onSessionIdResolved?: SessionIdResolvedCallback;
  onResultStats?: ResultStatsCallback;
}

/**
 * Helper function to get message role from SDK message type
 */
function getRoleFromSDKMessage(
  sdkMessage: SDKMessage
): 'user' | 'assistant' | 'system' {
  switch (sdkMessage.type) {
    case 'user':
      return 'user';
    case 'assistant':
      return 'assistant';
    case 'system':
    case 'result':
      return 'system';
    default:
      return 'assistant';
  }
}

/**
 * Helper function to get event role from flat stream event
 */
function getRoleFromFlatEvent(
  event: FlatStreamEventUnion
): 'user' | 'assistant' | 'system' {
  if (event.eventType === 'message_start') {
    return event.role;
  }
  // For other event types, default to assistant
  return 'assistant';
}

/**
 * Validated stats interface
 */
interface ValidatedStats {
  sessionId: SessionId;
  cost: number;
  tokens: { input: number; output: number };
  duration: number;
}

/**
 * Validate stats from SDK result message
 * Ensures all numeric values are within expected bounds to catch SDK bugs
 *
 * @param stats - Raw stats extracted from SDK result message
 * @param logger - Logger instance for validation warnings
 * @returns Validated stats or null if validation fails
 */
function validateStats(
  stats: {
    sessionId: SessionId;
    cost: number;
    tokens: { input: number; output: number };
    duration: number;
  },
  logger: Logger
): ValidatedStats | null {
  // Validate cost (max $100 catches billing bugs)
  if (
    stats.cost < 0 ||
    stats.cost > 100 ||
    isNaN(stats.cost) ||
    !isFinite(stats.cost)
  ) {
    logger.warn('[StreamTransformer] Invalid cost value from SDK:', {
      cost: stats.cost,
      sessionId: stats.sessionId,
    });
    return null;
  }

  // Validate tokens (max 1M catches overflow)
  if (
    stats.tokens.input < 0 ||
    stats.tokens.input > 1000000 ||
    isNaN(stats.tokens.input) ||
    !isFinite(stats.tokens.input) ||
    stats.tokens.output < 0 ||
    stats.tokens.output > 1000000 ||
    isNaN(stats.tokens.output) ||
    !isFinite(stats.tokens.output)
  ) {
    logger.warn('[StreamTransformer] Invalid token values from SDK:', {
      tokens: stats.tokens,
      sessionId: stats.sessionId,
    });
    return null;
  }

  // Validate duration (max 1 hour = 3,600,000ms)
  if (
    stats.duration < 0 ||
    stats.duration > 3600000 ||
    isNaN(stats.duration) ||
    !isFinite(stats.duration)
  ) {
    logger.warn('[StreamTransformer] Invalid duration value from SDK:', {
      duration: stats.duration,
      sessionId: stats.sessionId,
    });
    return null;
  }

  return stats; // All validations passed
}

/**
 * StreamTransformer - Transforms SDK messages to flat stream events
 *
 * CRITICAL CHANGE (TASK_2025_082):
 * - Yields FlatStreamEventUnion instead of ExecutionNode
 * - Frontend builds trees at render time from flat events
 *
 * CRITICAL FIX (TASK_2025_086):
 * - Accumulates events by messageId, stores ONE message per logical message
 * - Previously stored each event as separate message (causing fragmented display)
 *
 * Responsibilities:
 * - Extract real Claude session ID from system 'init' messages
 * - Transform SDK messages to flat stream event format
 * - Accumulate events per message and store when complete
 * - Handle authentication errors gracefully
 */
@injectable()
export class StreamTransformer {
  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(SDK_TOKENS.SDK_MESSAGE_TRANSFORMER)
    private readonly messageTransformer: SdkMessageTransformer,
    @inject(SDK_TOKENS.SDK_SESSION_STORAGE)
    private readonly storage: SdkSessionStorage,
    @inject(SDK_TOKENS.SDK_SESSION_LIFECYCLE_MANAGER)
    private readonly sessionLifecycle: SessionLifecycleManager
  ) {}

  /**
   * Create a transformed flat event stream from SDK messages
   */
  transform(
    config: StreamTransformConfig
  ): AsyncIterable<FlatStreamEventUnion> {
    const {
      sdkQuery,
      sessionId,
      initialModel,
      onSessionIdResolved,
      onResultStats,
    } = config;

    // Capture references for use in generator
    const logger = this.logger;
    const messageTransformer = this.messageTransformer;
    const storage = this.storage;
    const sessionLifecycle = this.sessionLifecycle;

    return {
      async *[Symbol.asyncIterator]() {
        let sdkMessageCount = 0;
        let yieldedEventCount = 0;

        try {
          logger.info(
            `[StreamTransformer] Starting message stream for ${sessionId}`
          );

          for await (const sdkMessage of sdkQuery) {
            sdkMessageCount++;
            logger.info(
              `[StreamTransformer] SDK message #${sdkMessageCount} received: type=${sdkMessage.type}`,
              { sessionId, messageType: sdkMessage.type }
            );
            // Extract real Claude session ID from system 'init' message
            // This is the ONLY place where we get the real Claude UUID
            if (
              sdkMessage.type === 'system' &&
              'subtype' in sdkMessage &&
              sdkMessage['subtype'] === 'init' &&
              'session_id' in sdkMessage &&
              typeof sdkMessage['session_id'] === 'string'
            ) {
              const realClaudeSessionId = sdkMessage['session_id'] as string;
              logger.info(
                `[StreamTransformer] Captured real Claude session ID: ${realClaudeSessionId} (placeholder: ${sessionId})`
              );

              // Store the real Claude session ID for future resumption
              try {
                await storage.updateClaudeSessionId(
                  sessionId,
                  realClaudeSessionId
                );
                logger.debug(
                  `[StreamTransformer] Stored claudeSessionId mapping: ${sessionId} -> ${realClaudeSessionId}`
                );

                // Register mapping for session lookup (enables abort by real ID)
                sessionLifecycle.registerSessionIdMapping(
                  realClaudeSessionId,
                  sessionId as string
                );

                // Notify via callback
                if (onSessionIdResolved) {
                  onSessionIdResolved(sessionId, realClaudeSessionId);
                }
              } catch (storageError) {
                logger.warn(
                  `[StreamTransformer] Failed to store Claude session ID`,
                  storageError instanceof Error
                    ? storageError
                    : new Error(String(storageError))
                );
              }
            }

            // Extract stats from result message and notify via callback
            if (sdkMessage.type === 'result') {
              // Check callback is set
              if (!onResultStats) {
                logger.error(
                  '[StreamTransformer] Result stats callback not set - stats will be lost!',
                  { sessionId }
                );
                // Continue processing (don't throw) - stats are non-critical
              } else {
                // Type guard for result message structure
                if (!isSDKResultMessage(sdkMessage)) {
                  logger.warn(
                    '[StreamTransformer] Result message missing required fields',
                    {
                      sessionId,
                      messageType: sdkMessage.type,
                    }
                  );
                } else {
                  // Extract stats
                  const rawStats = {
                    sessionId,
                    cost: sdkMessage.total_cost_usd,
                    tokens: {
                      input: sdkMessage.usage.input_tokens,
                      output: sdkMessage.usage.output_tokens,
                    },
                    duration: sdkMessage.duration_ms,
                  };

                  logger.debug(
                    `[StreamTransformer] Result message received for ${sessionId}`,
                    {
                      cost: rawStats.cost,
                      duration: rawStats.duration,
                      tokens: rawStats.tokens,
                    }
                  );

                  // Validate and notify
                  const validatedStats = validateStats(rawStats, logger);
                  if (validatedStats) {
                    onResultStats(validatedStats);
                  }
                  // If validation fails, validateStats already logged warning
                }
              }
            }

            const flatEvents = messageTransformer.transform(
              sdkMessage,
              sessionId
            );

            logger.debug(
              `[StreamTransformer] Transformed SDK message #${sdkMessageCount} to ${flatEvents.length} flat events`,
              {
                sessionId,
                messageType: sdkMessage.type,
                eventCount: flatEvents.length,
              }
            );

            // TASK_2025_086 FIX: Only yield events for real-time streaming
            // DON'T store stream_events - they're for UI only
            // Storage happens when complete 'assistant'/'user' messages arrive
            for (const event of flatEvents) {
              yieldedEventCount++;
              logger.debug(
                `[StreamTransformer] Yielding event #${yieldedEventCount}: ${event.eventType}`,
                { sessionId, eventType: event.eventType }
              );
              yield event;
            }

            // TASK_2025_086 FIX: Store COMPLETE messages only
            // SDK sends: stream_events (for UI) + complete assistant/user message (for storage)
            // The complete message has all content blocks aggregated
            if (sdkMessage.type === 'assistant' || sdkMessage.type === 'user') {
              const uuid = sdkMessage['uuid'] as string;
              const message = sdkMessage['message'] as {
                id?: string;
                content?: Array<{
                  type: string;
                  text?: string;
                  id?: string;
                  name?: string;
                  input?: unknown;
                }>;
                model?: string;
                usage?: { input_tokens?: number; output_tokens?: number };
              };
              const parentToolUseId = sdkMessage['parent_tool_use_id'] as
                | string
                | null;

              // Convert message.content blocks to ExecutionNode[] format
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const executionNodes: any[] = [];
              for (const block of message?.content || []) {
                if (block.type === 'text' && block.text) {
                  executionNodes.push({
                    id: `text-${Date.now()}`,
                    type: 'text',
                    status: 'complete',
                    content: block.text,
                  });
                } else if (
                  block.type === 'tool_use' &&
                  block.id &&
                  block.name
                ) {
                  executionNodes.push({
                    id: block.id,
                    type: block.name === 'Task' ? 'agent' : 'tool',
                    status: 'complete',
                    toolName: block.name,
                    toolInput: block.input,
                    toolCallId: block.id,
                  });
                }
              }

              // Get model from session or message
              const currentSession =
                sessionLifecycle.getActiveSession(sessionId);
              const currentModel =
                message?.model || currentSession?.currentModel || initialModel;

              // Build token usage
              const tokens = message?.usage
                ? {
                    input: message.usage.input_tokens || 0,
                    output: message.usage.output_tokens || 0,
                  }
                : undefined;

              const messageIdParsed =
                MessageId.safeParse(uuid) ?? MessageId.create();
              const parentId = parentToolUseId
                ? MessageId.safeParse(parentToolUseId)
                : null;

              const storedMessage: StoredSessionMessage = {
                id: messageIdParsed,
                parentId: parentId as MessageId | null,
                role: sdkMessage.type as 'user' | 'assistant',
                content: executionNodes, // Store proper ExecutionNode[] format
                timestamp: Date.now(),
                model: currentModel,
                tokens,
              };

              try {
                await storage.addMessage(sessionId, storedMessage);
                logger.info(
                  `[StreamTransformer] Stored complete ${sdkMessage.type} message ${uuid} with ${executionNodes.length} nodes`
                );
              } catch (storageError) {
                const errObj =
                  storageError instanceof Error
                    ? storageError
                    : new Error(String(storageError));
                logger.warn(
                  `[StreamTransformer] Failed to store message ${uuid}, continuing anyway`,
                  errObj
                );
              }
            }
          }

          logger.info(
            `[StreamTransformer] Stream ended for ${sessionId}: ${sdkMessageCount} SDK messages, ${yieldedEventCount} events yielded`
          );
        } catch (error) {
          const errorObj =
            error instanceof Error ? error : new Error(String(error));

          logger.error(
            `[StreamTransformer] Session ${sessionId} error: ${errorObj.message}`,
            errorObj
          );

          // Check for auth errors and provide helpful logging
          // Be specific to avoid false positives (e.g., "Invalid MessageId format" is not an auth error)
          const lowerMessage = errorObj.message.toLowerCase();
          const isAuthError =
            errorObj.message.includes('401') ||
            lowerMessage.includes('unauthorized') ||
            lowerMessage.includes('authentication failed') ||
            lowerMessage.includes('invalid api key') ||
            lowerMessage.includes('invalid token') ||
            lowerMessage.includes('api_key');

          if (isAuthError) {
            logger.error('[StreamTransformer] AUTHENTICATION ERROR!');
            logger.error(
              '[StreamTransformer] SDK requires valid API key from console.anthropic.com'
            );
            logger.error(
              '[StreamTransformer] OR OAuth token from "claude setup-token"'
            );
            logger.error(
              `[StreamTransformer] Current: ANTHROPIC_API_KEY=${
                process.env['ANTHROPIC_API_KEY']
                  ? `SET (${process.env['ANTHROPIC_API_KEY'].substring(
                      0,
                      10
                    )}...)`
                  : 'NOT SET'
              }`
            );
          }

          throw error;
        } finally {
          sessionLifecycle.getActiveSession(sessionId); // Cleanup handled by endSession
          logger.info(`[StreamTransformer] Session ${sessionId} ended`);
        }
      },
    };
  }
}
