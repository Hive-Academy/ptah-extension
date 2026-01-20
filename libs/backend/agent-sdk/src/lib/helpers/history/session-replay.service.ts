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

import { injectable, inject } from 'tsyringe';
import { Logger, TOKENS } from '@ptah-extension/vscode-core';
import type {
  FlatStreamEventUnion,
  MessageStartEvent,
  TextDeltaEvent,
  ToolStartEvent,
  ToolResultEvent,
  MessageCompleteEvent,
} from '@ptah-extension/shared';
import { SDK_TOKENS } from '../../di/tokens';
import { AgentCorrelationService } from './agent-correlation.service';
import { HistoryEventFactory } from './history-event-factory';
import type {
  SessionHistoryMessage,
  AgentSessionData,
  ContentBlock,
  AgentDataMapEntry,
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
    private readonly eventFactory: HistoryEventFactory
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
    agentSessions: AgentSessionData[]
  ): FlatStreamEventUnion[] {
    const events: FlatStreamEventUnion[] = [];
    let eventIndex = 0;

    // Build maps for correlation
    const agentDataMap = this.correlationService.buildAgentDataMap(agentSessions);
    const taskToolUses = this.correlationService.extractTaskToolUses(mainMessages);
    const taskToAgentMap = this.correlationService.correlateAgentsToTasks(
      taskToolUses,
      agentDataMap
    );
    const allToolResults = this.correlationService.extractAllToolResults(mainMessages);

    // Process messages
    let currentMessageId: string | null = null;
    let currentMessageTimestamp: number = Date.now();
    let blockIndex = 0;
    // CRITICAL: Track sequence within message to preserve event ordering
    // When events share the same timestamp, frontend sorts by timestamp which is undefined.
    // Add micro-offsets (0.001ms per event) to preserve creation order while keeping
    // events grouped by their original message time.
    let messageSequence = 0;

    for (const msg of mainMessages) {
      // Skip non-message types
      if (!msg.type || !['user', 'assistant'].includes(msg.type)) {
        continue;
      }

      if (msg.type === 'user' && msg.message?.content) {
        if (msg.isMeta === true) continue;

        // Skip tool_result messages - they are processed as part of tool calls
        const contentRaw = msg.message.content;
        if (
          Array.isArray(contentRaw) &&
          contentRaw.length > 0 &&
          (contentRaw[0] as ContentBlock)?.type === 'tool_result'
        ) {
          continue;
        }

        // Close previous assistant message if open
        if (currentMessageId) {
          events.push(
            this.eventFactory.createMessageComplete(
              sessionId,
              currentMessageId,
              eventIndex++,
              currentMessageTimestamp + messageSequence++ * 0.001
            )
          );
          currentMessageId = null;
          blockIndex = 0;
          messageSequence = 0; // Reset for new message
        }

        // Create user message events (user messages are self-contained, use local sequence)
        const messageId = msg.uuid || this.eventFactory.generateId();
        const content = this.eventFactory.extractTextContent(msg.message.content);
        const timestamp = msg.timestamp
          ? new Date(msg.timestamp).getTime()
          : Date.now();
        let userSeq = 0;

        events.push(
          this.eventFactory.createMessageStart(
            sessionId,
            messageId,
            'user',
            eventIndex++,
            timestamp + userSeq++ * 0.001
          )
        );
        if (content) {
          events.push(
            this.eventFactory.createTextDelta(
              sessionId,
              messageId,
              content,
              0,
              eventIndex++,
              timestamp + userSeq++ * 0.001
            )
          );
        }
        events.push(
          this.eventFactory.createMessageComplete(
            sessionId,
            messageId,
            eventIndex++,
            timestamp + userSeq++ * 0.001
          )
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
              currentMessageTimestamp + messageSequence++ * 0.001
            )
          );
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
                  currentMessageTimestamp + messageSequence++ * 0.001
                )
              );
            } else if (block.type === 'thinking' && block.thinking) {
              events.push(
                this.eventFactory.createThinkingDelta(
                  sessionId,
                  currentMessageId,
                  block.thinking,
                  blockIndex++,
                  eventIndex++,
                  currentMessageTimestamp + messageSequence++ * 0.001
                )
              );
            } else if (block.type === 'tool_use') {
              const toolResult = block.id
                ? allToolResults.get(block.id)
                : undefined;

              if (block.name === 'Task' && block.input) {
                // Agent spawn - create tool_start first (Task is a tool call)
                const toolCallId = block.id || this.eventFactory.generateId();

                events.push(
                  this.eventFactory.createToolStart(
                    sessionId,
                    currentMessageId,
                    toolCallId,
                    'Task',
                    block.input,
                    eventIndex++,
                    currentMessageTimestamp + messageSequence++ * 0.001
                  )
                );

                // Then create agent_start with parentToolUseId linking to the tool
                const agentId = block.id
                  ? taskToAgentMap.get(block.id) || null
                  : null;

                events.push(
                  this.eventFactory.createAgentStart(
                    sessionId,
                    currentMessageId,
                    toolCallId,
                    block.input,
                    eventIndex++,
                    currentMessageTimestamp + messageSequence++ * 0.001,
                    toolCallId // parentToolUseId - links to parent Task tool
                  )
                );

                // Add nested agent events if we have the agent data
                const agentData = agentId
                  ? agentDataMap.get(agentId)
                  : undefined;

                if (agentData) {
                  const nestedEvents = this.processAgentMessages(
                    sessionId,
                    toolCallId,
                    agentData.executionMessages,
                    currentMessageTimestamp + messageSequence++ * 0.001
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
                      currentMessageTimestamp + messageSequence++ * 0.001
                    )
                  );
                }
              } else {
                // Regular tool (not Task)
                events.push(
                  this.eventFactory.createToolStart(
                    sessionId,
                    currentMessageId,
                    block.id || this.eventFactory.generateId(),
                    block.name || 'unknown',
                    block.input,
                    eventIndex++,
                    currentMessageTimestamp + messageSequence++ * 0.001
                  )
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
                      currentMessageTimestamp + messageSequence++ * 0.001
                    )
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
          currentMessageTimestamp + messageSequence++ * 0.001
        )
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
    parentTimestamp: number
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
        parentTimestamp
      )}`;
      const messageTimestamp = parentTimestamp + sequence++ * 0.0001;
      let blockIndex = 0;

      // Create message_start for this agent message (CRITICAL for frontend detection)
      // TASK_2025_096 FIX: Include parentToolUseId in event ID to prevent collision
      events.push({
        eventType: 'message_start',
        id: `evt_agent_${parentToolUseId}_${eventIndex++}_${Math.floor(
          messageTimestamp
        )}`,
        sessionId,
        messageId: agentMessageId,
        parentToolUseId, // Links to parent Task tool
        role: 'assistant',
        timestamp: messageTimestamp,
        source: 'history',
      } as MessageStartEvent);

      for (const block of content as ContentBlock[]) {
        const eventTimestamp = parentTimestamp + sequence++ * 0.0001;

        if (block.type === 'text' && block.text) {
          events.push({
            eventType: 'text_delta',
            id: `evt_agent_${parentToolUseId}_${eventIndex++}_${Math.floor(
              eventTimestamp
            )}`,
            sessionId,
            messageId: agentMessageId,
            parentToolUseId,
            blockIndex: blockIndex++,
            delta: block.text,
            timestamp: eventTimestamp,
            source: 'history',
          } as TextDeltaEvent);
        } else if (block.type === 'tool_use') {
          const toolResult = block.id ? toolResults.get(block.id) : undefined;

          events.push({
            eventType: 'tool_start',
            id: `evt_agent_${parentToolUseId}_${eventIndex++}_${Math.floor(
              eventTimestamp
            )}`,
            sessionId,
            messageId: agentMessageId,
            parentToolUseId,
            toolCallId: block.id || this.eventFactory.generateId(),
            toolName: block.name || 'unknown',
            toolInput: block.input,
            isTaskTool: block.name === 'Task',
            timestamp: eventTimestamp,
            source: 'history',
          } as ToolStartEvent);

          if (toolResult) {
            const resultTimestamp = parentTimestamp + sequence++ * 0.0001;
            events.push({
              eventType: 'tool_result',
              id: `evt_agent_${parentToolUseId}_${eventIndex++}_${Math.floor(
                resultTimestamp
              )}`,
              sessionId,
              messageId: agentMessageId,
              parentToolUseId,
              toolCallId: block.id || '',
              output: toolResult.content,
              isError: toolResult.isError,
              timestamp: resultTimestamp,
              source: 'history',
            } as ToolResultEvent);
          }
        }
      }

      // Create message_complete for this agent message
      const completeTimestamp = parentTimestamp + sequence++ * 0.0001;
      events.push({
        eventType: 'message_complete',
        id: `evt_agent_${parentToolUseId}_${eventIndex++}_${Math.floor(
          completeTimestamp
        )}`,
        sessionId,
        messageId: agentMessageId,
        parentToolUseId,
        timestamp: completeTimestamp,
        source: 'history',
      } as MessageCompleteEvent);
    }

    return events;
  }
}
