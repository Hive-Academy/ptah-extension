/**
 * Session Replay Service
 *
 * Orchestrates the conversion of JSONL messages to FlatStreamEventUnion events.
 * Handles message sequencing, nested agent events, and event ordering with micro-offsets.
 *
 * Extracted from SessionHistoryReaderService for single responsibility.
 *
 * Responsibilities:
 * - Replay main session messages to stream events
 * - Process nested agent messages
 * - Handle event sequencing with micro-offsets for ordering
 * - Coordinate correlation and event factory services
 *
 * CRITICAL: Event ordering preservation
 * - Uses micro-offsets (0.001ms per event) to preserve event creation order
 * - When events share the same timestamp, frontend sorts by timestamp which is undefined
 * - Micro-offsets keep events grouped by original message time while maintaining order
 *
 * CRITICAL: TASK_2025_096 fix for agent message ID collision
 * - Must include parentToolUseId in agent message IDs to prevent collision
 * - Without this, multiple agents spawned in the same message block would collide
 *
 * @see TASK_2025_106 - Session History Reader Refactoring
 */

import type { FlatStreamEventUnion } from '@ptah-extension/shared';
import {
  calculateMessageCost,
  AuthEnv,
  isAgentDispatchTool,
} from '@ptah-extension/shared';
import { Logger, TOKENS } from '@ptah-extension/vscode-core';
import { inject, injectable } from 'tsyringe';
import { SDK_TOKENS } from '../../di/tokens';
import { extractTokenUsage } from '../usage-extraction.utils';
import { resolveActualModelForPricing } from '../anthropic-provider-registry';
import { AgentCorrelationService } from './agent-correlation.service';
import type { MessageUsageData } from './history-event-factory';
import { HistoryEventFactory } from './history-event-factory';
import type {
  AgentSessionData,
  ContentBlock,
  SessionHistoryMessage,
} from './history.types';

/**
 * Service for replaying session history as stream events.
 *
 * Pattern: Injectable service with multiple child service dependencies
 * @see libs/backend/agent-sdk/src/lib/helpers/session-lifecycle-manager.ts:108-126
 */
@injectable()
export class SessionReplayService {
  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(SDK_TOKENS.SDK_AGENT_CORRELATION)
    private readonly correlationService: AgentCorrelationService,
    @inject(SDK_TOKENS.SDK_HISTORY_EVENT_FACTORY)
    private readonly eventFactory: HistoryEventFactory,
    @inject(SDK_TOKENS.SDK_AUTH_ENV) private readonly authEnv: AuthEnv,
  ) {}

  /**
   * Main replay function - converts JSONL messages to FlatStreamEventUnion events.
   *
   * Processing steps:
   * 1. Build correlation maps (agents, tasks, tool results)
   * 2. Process each message in order (user then assistant)
   * 3. Handle nested Task tool spawning with agent events
   * 4. Preserve event ordering with micro-offsets
   *
   * @param sessionId - Session identifier
   * @param mainMessages - Main session messages from JSONL
   * @param agentSessions - Linked agent session data
   * @returns Array of FlatStreamEventUnion events in correct order
   */
  replayToStreamEvents(
    sessionId: string,
    mainMessages: SessionHistoryMessage[],
    agentSessions: AgentSessionData[],
  ): FlatStreamEventUnion[] {
    const events: FlatStreamEventUnion[] = [];
    let eventIndex = 0;

    // Find the last compact_boundary in the session.
    // After compaction, only messages AFTER the boundary are relevant.
    // Pre-compaction messages were summarized by the SDK and should not be replayed.
    let startIndex = 0;
    for (let i = mainMessages.length - 1; i >= 0; i--) {
      if (
        mainMessages[i].type === 'system' &&
        mainMessages[i].subtype === 'compact_boundary'
      ) {
        startIndex = i + 1;
        this.logger.info(
          `[SessionReplay] Found compact_boundary at index ${i}, skipping ${startIndex} pre-compaction messages`,
        );
        break;
      }
    }

    // Slice to only post-compaction messages
    const effectiveMessages =
      startIndex > 0 ? mainMessages.slice(startIndex) : mainMessages;

    // Build maps for correlation
    const agentDataMap =
      this.correlationService.buildAgentDataMap(agentSessions);
    const taskToolUses =
      this.correlationService.extractTaskToolUses(effectiveMessages);
    const taskToAgentMap = this.correlationService.correlateAgentsToTasks(
      taskToolUses,
      agentDataMap,
    );
    const allToolResults =
      this.correlationService.extractAllToolResults(effectiveMessages);

    // Process messages
    let currentMessageId: string | null = null;
    let currentMessageTimestamp: number = Date.now();
    let blockIndex = 0;
    // CRITICAL: Track sequence within message to preserve event ordering
    // When events share the same timestamp, frontend sorts by timestamp which is undefined.
    // Add micro-offsets (0.001ms per event) to preserve creation order while keeping
    // events grouped by their original message time.
    let messageSequence = 0;
    // TASK_2025_098 FIX: Track accumulated usage for current assistant message
    // Usage is extracted from JSONL message.usage and accumulated across message blocks
    let currentMessageUsage: MessageUsageData | undefined;

    for (const msg of effectiveMessages) {
      // Skip non-message types
      if (!msg.type || !['user', 'assistant'].includes(msg.type)) {
        continue;
      }

      if (msg.type === 'user' && msg.message?.content) {
        if (msg.isMeta === true) continue;

        // Fallback: detect skill/meta content by patterns when isMeta flag is missing.
        // The SDK's Skill tool injects newMessages with sourceToolUseID; these are meta.
        if (
          (msg as unknown as Record<string, unknown>)['sourceToolUseID'] !==
          undefined
        ) {
          continue;
        }

        // Skip tool_result messages - they are processed as part of tool calls
        const contentRaw = msg.message.content;
        if (
          Array.isArray(contentRaw) &&
          contentRaw.length > 0 &&
          (contentRaw[0] as ContentBlock)?.type === 'tool_result'
        ) {
          continue;
        }

        // Skip task-notification messages - generated by orchestration when subagents complete
        const rawText = this.eventFactory.extractTextContent(contentRaw);
        if (rawText && rawText.trimStart().startsWith('<task-notification>')) {
          continue;
        }

        // Close previous assistant message if open
        if (currentMessageId) {
          events.push(
            this.eventFactory.createMessageComplete(
              sessionId,
              currentMessageId,
              eventIndex++,
              currentMessageTimestamp + messageSequence++ * 0.001,
              currentMessageUsage, // TASK_2025_098 FIX: Pass usage data for per-message stats
            ),
          );
          currentMessageId = null;
          blockIndex = 0;
          messageSequence = 0; // Reset for new message
          currentMessageUsage = undefined; // Reset usage for next message
        }

        // Create user message events (user messages are self-contained, use local sequence)
        const messageId = msg.uuid || this.eventFactory.generateId();
        const content = this.eventFactory.extractTextContent(
          msg.message.content,
        );
        const timestamp = msg.timestamp
          ? new Date(msg.timestamp).getTime()
          : Date.now();
        let userSeq = 0;

        // Count inline image content blocks for imageCount propagation
        const imageCount = Array.isArray(msg.message.content)
          ? (msg.message.content as ContentBlock[]).filter(
              (b) => b.type === 'image',
            ).length
          : 0;

        events.push(
          this.eventFactory.createMessageStart(
            sessionId,
            messageId,
            'user',
            eventIndex++,
            timestamp + userSeq++ * 0.001,
            imageCount > 0 ? imageCount : undefined,
          ),
        );
        if (content) {
          events.push(
            this.eventFactory.createTextDelta(
              sessionId,
              messageId,
              content,
              0,
              eventIndex++,
              timestamp + userSeq++ * 0.001,
            ),
          );
        }
        events.push(
          this.eventFactory.createMessageComplete(
            sessionId,
            messageId,
            eventIndex++,
            timestamp + userSeq++ * 0.001,
          ),
        );
      } else if (msg.type === 'assistant' && msg.message?.content) {
        // Get message timestamp from JSONL
        const msgTimestamp = msg.timestamp
          ? new Date(msg.timestamp).getTime()
          : Date.now();

        // Initialize message if needed
        if (!currentMessageId) {
          currentMessageId = msg.uuid || this.eventFactory.generateId();
          currentMessageTimestamp = msgTimestamp;
          messageSequence = 0; // Reset sequence for new message
          events.push(
            this.eventFactory.createMessageStart(
              sessionId,
              currentMessageId,
              'assistant',
              eventIndex++,
              currentMessageTimestamp + messageSequence++ * 0.001,
            ),
          );
        }

        // TASK_2025_098 FIX: Extract usage data from assistant message for per-message stats
        // Usage comes from msg.message.usage (Claude API format)
        const msgUsage = msg.message.usage as {
          readonly input_tokens: number;
          readonly output_tokens: number;
          readonly cache_read_input_tokens: number;
          readonly cache_creation_input_tokens: number;
        };
        // Extract model from JSONL assistant message for accurate pricing
        const msgModel = msg.message.model || '';

        if (msgUsage) {
          const tokenUsage = extractTokenUsage(msgUsage);
          if (tokenUsage) {
            // TASK_2025_164: Pass authEnv for provider-aware model resolution
            const cost = calculateMessageCost(
              resolveActualModelForPricing(msgModel, this.authEnv),
              {
                input: tokenUsage.input,
                output: tokenUsage.output,
                cacheHit: tokenUsage.cacheRead,
                cacheCreation: tokenUsage.cacheCreation,
              },
            );
            // Accumulate usage (in case multiple assistant blocks per logical message)
            if (!currentMessageUsage) {
              currentMessageUsage = {
                tokenUsage: {
                  input: tokenUsage.input,
                  output: tokenUsage.output,
                },
                cost,
                model: msgModel || undefined,
              };
            } else {
              // Accumulate tokens and cost for multi-block messages
              currentMessageUsage.tokenUsage = {
                input:
                  (currentMessageUsage.tokenUsage?.input ?? 0) +
                  tokenUsage.input,
                output:
                  (currentMessageUsage.tokenUsage?.output ?? 0) +
                  tokenUsage.output,
              };
              currentMessageUsage.cost = (currentMessageUsage.cost ?? 0) + cost;
            }
          }
        }

        // Process content blocks - add micro-offset to each event for correct ordering
        const content = msg.message.content;
        if (Array.isArray(content)) {
          for (const block of content as ContentBlock[]) {
            if (block.type === 'text' && block.text) {
              events.push(
                this.eventFactory.createTextDelta(
                  sessionId,
                  currentMessageId,
                  block.text,
                  blockIndex++,
                  eventIndex++,
                  currentMessageTimestamp + messageSequence++ * 0.001,
                ),
              );
            } else if (block.type === 'thinking' && block.thinking) {
              events.push(
                this.eventFactory.createThinkingDelta(
                  sessionId,
                  currentMessageId,
                  block.thinking,
                  blockIndex++,
                  eventIndex++,
                  currentMessageTimestamp + messageSequence++ * 0.001,
                ),
              );
            } else if (block.type === 'tool_use') {
              const toolResult = block.id
                ? allToolResults.get(block.id)
                : undefined;

              if (isAgentDispatchTool(block.name || '') && block.input) {
                // Agent spawn - create tool_start first (Agent/Task is a tool call)
                const toolCallId = block.id || this.eventFactory.generateId();

                events.push(
                  this.eventFactory.createToolStart(
                    sessionId,
                    currentMessageId,
                    toolCallId,
                    block.name || 'Agent',
                    block.input,
                    eventIndex++,
                    currentMessageTimestamp + messageSequence++ * 0.001,
                  ),
                );

                // Then create agent_start with parentToolUseId linking to the tool
                const correlatedAgentFileId = block.id
                  ? taskToAgentMap.get(block.id) || null
                  : null;
                // Strip 'agent-' prefix from filename-based ID (e.g., "agent-a329b32" -> "a329b32")
                const agentId = correlatedAgentFileId
                  ? correlatedAgentFileId.replace(/^agent-/, '')
                  : null;

                events.push(
                  this.eventFactory.createAgentStart(
                    sessionId,
                    currentMessageId,
                    toolCallId,
                    block.input,
                    eventIndex++,
                    currentMessageTimestamp + messageSequence++ * 0.001,
                    toolCallId, // parentToolUseId - links to parent Task tool
                    agentId ?? undefined, // Real agentId from correlated agent file
                  ),
                );

                // Add nested agent events if we have the agent data
                const agentData = correlatedAgentFileId
                  ? agentDataMap.get(correlatedAgentFileId)
                  : undefined;

                if (agentData) {
                  const nestedEvents = this.processAgentMessages(
                    sessionId,
                    toolCallId,
                    agentData.executionMessages,
                    currentMessageTimestamp + messageSequence++ * 0.001,
                  );
                  messageSequence += nestedEvents.length;
                  events.push(...nestedEvents);
                }

                // Add tool result if available
                if (toolResult) {
                  events.push(
                    this.eventFactory.createToolResult(
                      sessionId,
                      currentMessageId,
                      toolCallId,
                      toolResult.content,
                      toolResult.isError,
                      eventIndex++,
                      currentMessageTimestamp + messageSequence++ * 0.001,
                    ),
                  );
                } else if (
                  agentData &&
                  agentData.executionMessages.length > 0
                ) {
                  // FIX: Agent session data exists (agent JSONL found with messages)
                  // but the parent session JSONL is missing the tool_result.
                  // This happens when the JSONL was compacted, not fully flushed,
                  // or the SDK didn't write an explicit tool_result for the Task tool.
                  // Without this synthetic tool_result, registerFromHistoryEvents()
                  // would falsely mark the agent as "interrupted" because it only
                  // checks for tool_result events matching agent_start events.
                  this.logger.info(
                    '[SessionReplay] Creating synthetic tool_result for agent with session data but missing parent tool_result',
                    {
                      toolCallId,
                      agentId,
                      agentMessageCount: agentData.executionMessages.length,
                    },
                  );
                  // Extract the agent's last response as the synthetic result content.
                  let lastAgentResponse: SessionHistoryMessage | undefined;
                  for (
                    let i = agentData.executionMessages.length - 1;
                    i >= 0;
                    i--
                  ) {
                    const m = agentData.executionMessages[i];
                    if (m.type === 'assistant' && m.message?.content) {
                      lastAgentResponse = m;
                      break;
                    }
                  }
                  const syntheticContent = lastAgentResponse
                    ? this.eventFactory.extractTextContent(
                        lastAgentResponse.message?.content,
                      )
                    : '';

                  events.push(
                    this.eventFactory.createToolResult(
                      sessionId,
                      currentMessageId,
                      toolCallId,
                      syntheticContent || '[Agent completed]',
                      false,
                      eventIndex++,
                      currentMessageTimestamp + messageSequence++ * 0.001,
                    ),
                  );
                }
              } else {
                // Regular tool (not Agent/Task)
                events.push(
                  this.eventFactory.createToolStart(
                    sessionId,
                    currentMessageId,
                    block.id || this.eventFactory.generateId(),
                    block.name || 'unknown',
                    block.input,
                    eventIndex++,
                    currentMessageTimestamp + messageSequence++ * 0.001,
                  ),
                );

                if (toolResult) {
                  events.push(
                    this.eventFactory.createToolResult(
                      sessionId,
                      currentMessageId,
                      block.id || '',
                      toolResult.content,
                      toolResult.isError,
                      eventIndex++,
                      currentMessageTimestamp + messageSequence++ * 0.001,
                    ),
                  );
                }
              }
            }
          }
        }
      }
    }

    // Close final message if still open
    if (currentMessageId) {
      events.push(
        this.eventFactory.createMessageComplete(
          sessionId,
          currentMessageId,
          eventIndex++,
          currentMessageTimestamp + messageSequence++ * 0.001,
          currentMessageUsage, // TASK_2025_098 FIX: Pass usage data for per-message stats
        ),
      );
    }

    return events;
  }

  /**
   * Process agent session messages and convert to nested events.
   *
   * CRITICAL: Must create message_start/message_complete events for each assistant message
   * so the frontend's buildToolChildren can find them via parentToolUseId.
   *
   * CRITICAL: TASK_2025_096 FIX - Must include parentToolUseId in agent message IDs
   * to prevent collision when multiple agents are spawned in the same message block.
   * Without this, the second agent's events would overwrite the first agent's events
   * (same messageId, different parentToolUseId).
   *
   * @param sessionId - Session identifier
   * @param parentToolUseId - Tool use ID of the parent Task tool
   * @param messages - Agent session messages
   * @param parentTimestamp - Base timestamp for nested events
   * @returns Array of nested FlatStreamEventUnion events
   */
  private processAgentMessages(
    sessionId: string,
    parentToolUseId: string,
    messages: SessionHistoryMessage[],
    parentTimestamp: number,
  ): FlatStreamEventUnion[] {
    const events: FlatStreamEventUnion[] = [];
    let eventIndex = 0;
    // Use micro-offsets for nested events to preserve order within agent
    let sequence = 0;

    // Extract tool results from agent messages
    const toolResults = this.correlationService.extractAllToolResults(messages);

    for (const msg of messages) {
      if (msg.type !== 'assistant' || !msg.message?.content) continue;

      const content = msg.message.content;
      if (!Array.isArray(content)) continue;

      // TASK_2025_096 FIX: Generate unique message ID for this agent message.
      // CRITICAL: Must include parentToolUseId to prevent collision when multiple
      // agents are spawned in the same message block. Without this, the second agent's
      // events would overwrite the first agent's events (same messageId, different parentToolUseId).
      const agentMessageId = `agent_msg_${parentToolUseId}_${eventIndex}_${Math.floor(
        parentTimestamp,
      )}`;
      const messageTimestamp = parentTimestamp + sequence++ * 0.0001;
      let blockIndex = 0;

      // Create message_start for this agent message using factory method
      events.push(
        this.eventFactory.createAgentMessageStart(
          sessionId,
          agentMessageId,
          eventIndex++,
          messageTimestamp,
          parentToolUseId,
        ),
      );

      for (const block of content as ContentBlock[]) {
        const eventTimestamp = parentTimestamp + sequence++ * 0.0001;

        if (block.type === 'text' && block.text) {
          events.push(
            this.eventFactory.createAgentTextDelta(
              sessionId,
              agentMessageId,
              block.text,
              blockIndex++,
              eventIndex++,
              eventTimestamp,
              parentToolUseId,
            ),
          );
        } else if (block.type === 'tool_use') {
          const toolResult = block.id ? toolResults.get(block.id) : undefined;
          const toolCallId = block.id || this.eventFactory.generateId();

          events.push(
            this.eventFactory.createAgentToolStart(
              sessionId,
              agentMessageId,
              toolCallId,
              block.name || 'unknown',
              block.input,
              eventIndex++,
              eventTimestamp,
              parentToolUseId,
            ),
          );

          if (toolResult) {
            const resultTimestamp = parentTimestamp + sequence++ * 0.0001;
            events.push(
              this.eventFactory.createAgentToolResult(
                sessionId,
                agentMessageId,
                block.id || '',
                toolResult.content,
                toolResult.isError,
                eventIndex++,
                resultTimestamp,
                parentToolUseId,
              ),
            );
          }
        }
      }

      // TASK_2025_098 FIX: Extract usage data from agent message for per-message stats
      let agentMessageUsage: MessageUsageData | undefined;
      const agentMsgUsage = msg.message.usage as {
        readonly input_tokens: number;
        readonly output_tokens: number;
        readonly cache_read_input_tokens: number;
        readonly cache_creation_input_tokens: number;
      };
      if (agentMsgUsage) {
        const tokenUsage = extractTokenUsage(agentMsgUsage);
        if (tokenUsage) {
          const agentMsgModel = msg.message.model || '';
          // TASK_2025_164: Pass authEnv for provider-aware model resolution
          agentMessageUsage = {
            tokenUsage: { input: tokenUsage.input, output: tokenUsage.output },
            model: agentMsgModel || undefined,
            cost: calculateMessageCost(
              resolveActualModelForPricing(agentMsgModel, this.authEnv),
              {
                input: tokenUsage.input,
                output: tokenUsage.output,
                cacheHit: tokenUsage.cacheRead,
                cacheCreation: tokenUsage.cacheCreation,
              },
            ),
          };
        }
      }

      // Create message_complete for this agent message using factory method
      const completeTimestamp = parentTimestamp + sequence++ * 0.0001;
      events.push(
        this.eventFactory.createAgentMessageComplete(
          sessionId,
          agentMessageId,
          eventIndex++,
          completeTimestamp,
          parentToolUseId,
          agentMessageUsage, // TASK_2025_098 FIX: Pass usage data for per-message stats
        ),
      );
    }

    return events;
  }
}
