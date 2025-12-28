/**
 * Stream Transformer
 *
 * Transforms SDK message streams into FlatStreamEventUnion for UI rendering.
 *
 * Responsibilities:
 * - Transform SDK stream_event messages to flat events for frontend
 * - Extract real session ID from system 'init' message
 * - Extract stats (cost, tokens, duration) from result messages
 *
 * NOTE: Does NOT store messages - SDK handles persistence natively.
 * @see TASK_2025_088 - Removed redundant message storage
 */

import { injectable, inject } from 'tsyringe';
import { SessionId, FlatStreamEventUnion } from '@ptah-extension/shared';
import { Logger, TOKENS } from '@ptah-extension/vscode-core';
import { SdkMessageTransformer } from '../sdk-message-transformer';
import { SDK_TOKENS } from '../di/tokens';
import {
  SDKMessage,
  SDKResultMessage,
  isResultMessage,
  isSystemInit,
} from '../types/sdk-types/claude-sdk.types';

/**
 * Callback type for notifying when real session ID is received from SDK
 * This is the real SDK UUID that should be used everywhere.
 */
export type SessionIdResolvedCallback = (realSessionId: string) => void;

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
 * Responsibilities:
 * - Transform SDK stream_event messages to FlatStreamEventUnion
 * - Extract real session ID from system 'init' message
 * - Extract stats (cost, tokens, duration) from result messages
 * - Handle authentication errors gracefully
 *
 * Does NOT store messages - SDK handles persistence natively.
 * @see TASK_2025_088 - Simplified architecture
 */
@injectable()
export class StreamTransformer {
  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(SDK_TOKENS.SDK_MESSAGE_TRANSFORMER)
    private readonly messageTransformer: SdkMessageTransformer
  ) {}

  /**
   * Create a transformed flat event stream from SDK messages
   */
  transform(
    config: StreamTransformConfig
  ): AsyncIterable<FlatStreamEventUnion> {
    const { sdkQuery, sessionId, onSessionIdResolved, onResultStats } = config;

    // Capture references for use in generator
    const logger = this.logger;
    const messageTransformer = this.messageTransformer;

    return {
      async *[Symbol.asyncIterator]() {
        let sdkMessageCount = 0;
        let yieldedEventCount = 0;
        // TASK_2025_092: Track the effective session ID - updated when SDK resolves real UUID
        // Initial value is temp ID from config, updated to real UUID on system init message
        let effectiveSessionId = sessionId;
        // TASK_2025_091: Track if we've seen stream_event messages for this turn
        // When providers send BOTH stream_event AND assistant messages,
        // we should only process stream_event to avoid duplicate content.
        // stream_event provides real-time deltas, assistant provides complete message.
        const hasSeenStreamEvent = false;

        try {
          logger.info(
            `[StreamTransformer] Starting message stream for ${sessionId}`
          );

          for await (const sdkMessage of sdkQuery) {
            sdkMessageCount++;

            // DIAGNOSTIC: Log detailed message info to understand message flow
            // This helps debug streaming behavior differences between Anthropic vs OpenRouter
            const messageDetails: Record<string, unknown> = {
              sessionId,
              messageType: sdkMessage.type,
              messageNumber: sdkMessageCount,
            };

            // Extract message ID if available (for deduplication tracking)
            if (sdkMessage.type === 'stream_event') {
              const event = sdkMessage.event as {
                type?: string;
                message?: { id?: string };
              };
              messageDetails['eventType'] = event?.type;
              messageDetails['messageId'] = event?.message?.id;
            } else if (sdkMessage.type === 'assistant') {
              const msg = sdkMessage as { message?: { id?: string } };
              messageDetails['messageId'] = msg?.message?.id;
            }

            logger.info(
              `[StreamTransformer] SDK message #${sdkMessageCount} received: type=${sdkMessage.type}`,
              messageDetails
            );

            // Extract real session ID from system 'init' message using type guard
            if (isSystemInit(sdkMessage)) {
              const realSessionId = sdkMessage.session_id;
              logger.info(
                `[StreamTransformer] Received session ID from SDK: ${realSessionId}`
              );

              // TASK_2025_092: Update effective session ID to real UUID
              // This ensures stats and events use the real UUID, not temp ID
              effectiveSessionId = realSessionId as SessionId;

              // Notify caller of the real session ID
              if (onSessionIdResolved) {
                onSessionIdResolved(realSessionId);
              }
            }

            // Extract stats from result message and notify via callback
            if (isResultMessage(sdkMessage)) {
              // Check callback is set
              if (!onResultStats) {
                logger.error(
                  '[StreamTransformer] Result stats callback not set - stats will be lost!',
                  { sessionId: effectiveSessionId }
                );
                // Continue processing (don't throw) - stats are non-critical
              } else {
                // TASK_2025_092: Use effectiveSessionId (real UUID) instead of temp ID
                // This ensures frontend can find the tab by sessionId
                const rawStats = {
                  sessionId: effectiveSessionId,
                  cost: sdkMessage.total_cost_usd,
                  tokens: {
                    input: sdkMessage.usage.input_tokens,
                    output: sdkMessage.usage.output_tokens,
                  },
                  duration: sdkMessage.duration_ms,
                };

                logger.debug(
                  `[StreamTransformer] Result message received for ${effectiveSessionId}`,
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

            // TASK_2025_091: Process BOTH stream_event AND assistant messages
            // - stream_event: Real-time streaming deltas (native Anthropic API)
            // - assistant: Complete messages (some providers send these)
            // - user: Contains tool_result blocks after tool execution (TASK_2025_092)
            //
            // DEDUPLICATION STRATEGY:
            // Backend sends ALL messages. Frontend handles deduplication by messageId.
            // When duplicate message_start arrives (same messageId), frontend CLEARS
            // accumulators so complete content REPLACES streamed content.
            // This is the systematic solution that works for all providers/scenarios.
            //
            // CRITICAL FIX (TASK_2025_092): Must process 'user' messages to extract tool_result!
            // SDK sends tool_result content blocks in user messages after tool execution.
            // Without this, tools remain in __streaming: true state forever.
            if (
              sdkMessage.type === 'stream_event' ||
              sdkMessage.type === 'assistant' ||
              sdkMessage.type === 'user'
            ) {
              // TASK_2025_092: Use effectiveSessionId (real UUID) for events
              // This ensures events have the real sessionId for proper routing
              const flatEvents = messageTransformer.transform(
                sdkMessage,
                effectiveSessionId
              );

              const msgType =
                sdkMessage.type === 'stream_event'
                  ? 'stream_event'
                  : 'assistant (complete)';

              logger.info(
                `[StreamTransformer] Transformed ${msgType} to ${flatEvents.length} flat events`,
                {
                  sessionId: effectiveSessionId,
                  sourceType: sdkMessage.type,
                  eventCount: flatEvents.length,
                  eventTypes: flatEvents.map((e) => e.eventType),
                }
              );

              for (const event of flatEvents) {
                yieldedEventCount++;
                logger.debug(
                  `[StreamTransformer] Yielding event #${yieldedEventCount}`,
                  {
                    eventType: event.eventType,
                    messageId: event.messageId,
                    sessionId: event.sessionId,
                  }
                );
                yield event;
              }
            } else {
              // DIAGNOSTIC: Log skipped message types
              logger.debug(
                `[StreamTransformer] Skipping message type: ${sdkMessage.type}`,
                { sessionId }
              );
            }
            // Note: 'user' and 'result' messages are NOT yielded
            // SDK persists them natively to ~/.claude/projects/{sessionId}.jsonl
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
          logger.info(`[StreamTransformer] Session ${sessionId} stream ended`);
        }
      },
    };
  }
}
