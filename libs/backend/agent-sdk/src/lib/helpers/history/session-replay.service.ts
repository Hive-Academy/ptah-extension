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
 * CRITICAL: for agent message ID collision
 * - Must include parentToolUseId in agent message IDs to prevent collision
 * - Without this, multiple agents spawned in the same message block would collide
 *
 */

import type {
  AgentCompletedEvent,
  FlatStreamEventUnion,
} from '@ptah-extension/shared';
import {
  calculateMessageCost,
  isAgentDispatchTool,
  laneEnvelopePeerLabel,
  parseLaneEnvelope,
} from '@ptah-extension/shared';
import { Logger, TOKENS } from '@ptah-extension/vscode-core';
import { inject, injectable } from 'tsyringe';
import { SDK_TOKENS } from '../../di/tokens';
import { AUTH_PROVIDERS_TOKENS } from '@ptah-extension/auth-providers-tokens';
import { extractTokenUsage } from '../usage-extraction.utils';
import type { IModelResolver } from '../../auth-env.port';
import { AgentCorrelationService } from './agent-correlation.service';
import type { MessageUsageData } from './history-event-factory';
import { HistoryEventFactory } from './history-event-factory';
import type {
  AgentSessionData,
  ContentBlock,
  SessionHistoryMessage,
} from './history.types';
import { isInterruptSentinelText } from '../../types/sdk-types/claude-sdk.types';
import {
  isHiddenTranscriptRecord,
  isSkillOrMetaContent,
} from '../../message-transform/message-transform-helpers';

export interface HistoryReplayCollector {
  blockOwners: Map<FlatStreamEventUnion, string>;
  syntheticToolResults: Set<FlatStreamEventUnion>;
}

interface TaskNotification {
  taskId: string;
  toolUseId?: string;
  status: AgentCompletedEvent['status'];
  summary: string;
  outputFile: string;
}

/** Extract only the small, known fields of an untrusted CLI notification. */
function parseTaskNotification(text: string): TaskNotification | null {
  const root = '<task-notification>';
  const endRoot = '</task-notification>';
  const head = text.slice(0, 65_536).trimStart();
  if (!head.startsWith(root)) return null;
  const bodyStart = root.length;
  const bodyEnd = head.indexOf(endRoot, bodyStart);
  const body = head.slice(bodyStart, bodyEnd < 0 ? undefined : bodyEnd);
  const field = (tag: string, limit: number, allowTruncated = false): string | null => {
    const startTag = `<${tag}>`;
    const endTag = `</${tag}>`;
    const start = body.indexOf(startTag);
    if (start < 0) return null;
    const valueStart = start + startTag.length;
    const end = body.indexOf(endTag, valueStart);
    if ((end < 0 && !allowTruncated) || (!allowTruncated && end - valueStart > limit)) return null;
    return body.slice(valueStart, Math.min(end < 0 ? body.length : end, valueStart + limit)).trim();
  };
  const taskId = field('task-id', 128);
  const toolUseId = field('tool-use-id', 128);
  const statusText = field('status', 32);
  if (!taskId || !/^[A-Za-z0-9_-]+$/.test(taskId)) return null;
  if (toolUseId !== null && !/^[A-Za-z0-9_-]+$/.test(toolUseId))
    return null;
  const status =
    statusText === 'completed'
      ? 'completed'
      : statusText === 'failed' || statusText === 'error'
        ? 'failed'
        : statusText === 'killed' || statusText === 'stopped'
          ? 'stopped'
          : null;
  if (!status) return null;
  return {
    taskId,
    toolUseId: toolUseId || undefined,
    status,
    summary: field('summary', 240, true) ?? '',
    outputFile: field('output-file', 2048, true) ?? '',
  };
}

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
    @inject(AUTH_PROVIDERS_TOKENS.SDK_MODEL_RESOLVER)
    private readonly modelResolver: IModelResolver,
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
    collector?: HistoryReplayCollector,
  ): FlatStreamEventUnion[] {
    const events: FlatStreamEventUnion[] = [];
    const recordBlock = (messageId: string | undefined): void => {
      if (messageId)
        collector?.blockOwners.set(events[events.length - 1], messageId);
    };
    let eventIndex = 0;
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
    const effectiveMessages =
      startIndex > 0 ? mainMessages.slice(startIndex) : mainMessages;
    const agentDataMap =
      this.correlationService.buildAgentDataMap(agentSessions);
    const taskToolUses =
      this.correlationService.extractTaskToolUses(effectiveMessages);
    const taskToAgentMap = this.correlationService.correlateAgentsToTasks(
      taskToolUses,
      agentDataMap,
    );
    const emittedAgentStarts = new Map<string, { agentId?: string }>();
    const completedTaskIds = new Set<string>();
    const allToolResults =
      this.correlationService.extractAllToolResults(effectiveMessages);
    let currentMessageId: string | null = null;
    let currentMessageTimestamp: number = Date.now();
    let blockIndex = 0;
    let messageSequence = 0;
    let currentMessageUsage: MessageUsageData | undefined;

    for (const msg of effectiveMessages) {
      if (!msg.type || !['user', 'assistant'].includes(msg.type)) {
        continue;
      }

      if (msg.type === 'user' && msg.message?.content) {
        if (isHiddenTranscriptRecord(msg)) continue;
        if (
          (msg as unknown as Record<string, unknown>)['sourceToolUseID'] !==
          undefined
        ) {
          continue;
        }
        const contentRaw = msg.message.content;
        if (
          isSkillOrMetaContent(
            msg as unknown as Parameters<typeof isSkillOrMetaContent>[0],
          )
        ) {
          continue;
        }
        if (
          Array.isArray(contentRaw) &&
          contentRaw.length > 0 &&
          (contentRaw[0] as ContentBlock)?.type === 'tool_result'
        ) {
          continue;
        }
        const rawText = this.eventFactory.extractTextContent(contentRaw);
        if (rawText && rawText.slice(0, 1024).trimStart().startsWith('<task-notification>')) {
          // A typed user message may contain an XML-looking example.
          if (msg.origin?.kind === 'human' || msg.turnOrigin === 'human')
            continue;
          const notification = parseTaskNotification(rawText);
          if (notification) {
            const correlatedToolUseId = notification.toolUseId
              ? undefined
              : [...taskToAgentMap].find(
                  ([, agentFileId]) =>
                    agentFileId === `agent-${notification.taskId}` ||
                    agentFileId === notification.taskId,
                )?.[0];
            const toolUseId = notification.toolUseId ?? correlatedToolUseId;
            const started = toolUseId
              ? emittedAgentStarts.get(toolUseId)
              : undefined;
            if (toolUseId && started && !completedTaskIds.has(notification.taskId)) {
              completedTaskIds.add(notification.taskId);
              const parsedTimestamp = Date.parse(msg.timestamp ?? '');
              const event: AgentCompletedEvent = {
                id: `history-task-${msg.uuid ?? `${notification.taskId}-${eventIndex}`}`,
                eventType: 'agent_completed',
                timestamp: Number.isFinite(parsedTimestamp)
                  ? parsedTimestamp
                  : Date.now(),
                sessionId,
                source: 'history',
                messageId: `task_${notification.taskId}`,
                parentToolUseId: toolUseId,
                taskId: notification.taskId,
                status: notification.status,
                summary: notification.summary,
                outputFile: notification.outputFile,
                agentId: started.agentId,
              };
              events.push(event);
              eventIndex++;
            }
          }
          continue;
        }
        if (isInterruptSentinelText(rawText)) {
          continue;
        }
        if (currentMessageId) {
          events.push(
            this.eventFactory.createMessageComplete(
              sessionId,
              currentMessageId,
              eventIndex++,
              currentMessageTimestamp + messageSequence++ * 0.001,
              currentMessageUsage, // Pass usage data for per-message stats
            ),
          );
          currentMessageId = null;
          blockIndex = 0;
          messageSequence = 0; // Reset for new message
          currentMessageUsage = undefined; // Reset usage for next message
        }
        const messageId = msg.uuid || this.eventFactory.generateId();
        const content = this.eventFactory.extractTextContent(
          msg.message.content,
        );
        const timestamp = msg.timestamp
          ? new Date(msg.timestamp).getTime()
          : Date.now();
        let userSeq = 0;
        const imageCount = Array.isArray(msg.message.content)
          ? (msg.message.content as ContentBlock[]).filter(
              (b) => b.type === 'image',
            ).length
          : 0;
        // The CLI does not write a peer `origin` to the transcript, so a peer
        // turn (lane report, lane completion) is recognised by its envelope.
        // Only a root record can be a peer turn into this session, and a
        // record the CLI marks as typed by the human never is, even when its
        // text is an envelope.
        const typedByHuman =
          msg.origin?.kind === 'human' || msg.turnOrigin === 'human';
        const envelope =
          content &&
          !typedByHuman &&
          !msg.isSidechain &&
          !msg.parent_tool_use_id
            ? parseLaneEnvelope(content)
            : null;

        events.push(
          this.eventFactory.createMessageStart(
            sessionId,
            messageId,
            'user',
            eventIndex++,
            timestamp + userSeq++ * 0.001,
            imageCount > 0 ? imageCount : undefined,
            envelope ? { label: laneEnvelopePeerLabel(envelope) } : undefined,
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
        const msgTimestamp = msg.timestamp
          ? new Date(msg.timestamp).getTime()
          : Date.now();
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
        const msgUsage = msg.message.usage as {
          readonly input_tokens: number;
          readonly output_tokens: number;
          readonly cache_read_input_tokens: number;
          readonly cache_creation_input_tokens: number;
        };
        const msgModel = msg.message.model || '';

        if (msgUsage) {
          const tokenUsage = extractTokenUsage(msgUsage);
          if (tokenUsage) {
            const priced = this.modelResolver.resolveForCost(msgModel);
            const cost = calculateMessageCost(
              priced.modelId,
              {
                input: tokenUsage.input,
                output: tokenUsage.output,
                cacheHit: tokenUsage.cacheRead,
                cacheCreation: tokenUsage.cacheCreation,
              },
              priced.pricing,
            );
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
              currentMessageUsage.tokenUsage = {
                input:
                  (currentMessageUsage.tokenUsage?.input ?? 0) +
                  tokenUsage.input,
                output:
                  (currentMessageUsage.tokenUsage?.output ?? 0) +
                  tokenUsage.output,
              };
              const currentCost = currentMessageUsage.cost;
              currentMessageUsage.cost =
                currentCost === null ||
                currentCost === undefined ||
                cost === null
                  ? null
                  : currentCost + cost;
            }
          }
        }
        const content = msg.message.content;
        if (Array.isArray(content)) {
          for (const block of content as ContentBlock[]) {
            if (block.type === 'text' && isInterruptSentinelText(block.text)) {
              continue;
            }
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
              recordBlock(msg.message.id);
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
              recordBlock(msg.message.id);
            } else if (block.type === 'tool_use') {
              const toolResult = block.id
                ? allToolResults.get(block.id)
                : undefined;

              if (isAgentDispatchTool(block.name || '') && block.input) {
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
                recordBlock(msg.message.id);
                const correlatedAgentFileId = block.id
                  ? taskToAgentMap.get(block.id) || null
                  : null;
                const agentId = correlatedAgentFileId
                  ? correlatedAgentFileId.replace(/^agent-/, '')
                  : null;

                emittedAgentStarts.set(toolCallId, {
                  agentId: agentId ?? undefined,
                });

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
                const agentData = correlatedAgentFileId
                  ? agentDataMap.get(correlatedAgentFileId)
                  : undefined;

                if (agentData) {
                  const nestedEvents = this.processAgentMessages(
                    sessionId,
                    toolCallId,
                    agentData.executionMessages,
                    currentMessageTimestamp + messageSequence++ * 0.001,
                    collector,
                  );
                  messageSequence += nestedEvents.length;
                  events.push(...nestedEvents);
                }
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
                  this.logger.info(
                    '[SessionReplay] Creating synthetic tool_result for agent with session data but missing parent tool_result',
                    {
                      toolCallId,
                      agentId,
                      agentMessageCount: agentData.executionMessages.length,
                    },
                  );
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
                  collector?.syntheticToolResults.add(
                    events[events.length - 1],
                  );
                }
              } else {
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
                recordBlock(msg.message.id);

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
    if (currentMessageId) {
      events.push(
        this.eventFactory.createMessageComplete(
          sessionId,
          currentMessageId,
          eventIndex++,
          currentMessageTimestamp + messageSequence++ * 0.001,
          currentMessageUsage, // Pass usage data for per-message stats
        ),
      );
    }

    return events;
  }

  /** Resolve the SDK agent file associated with one parent Task tool use. */
  correlateAgentId(
    toolCallId: string,
    mainMessages: SessionHistoryMessage[],
    agentSessions: AgentSessionData[],
  ): string | null {
    const tasks = this.correlationService.extractTaskToolUses(mainMessages);
    const agents = this.correlationService.buildAgentDataMap(agentSessions);
    return (
      this.correlationService
        .correlateAgentsToTasks(tasks, agents)
        .get(toolCallId) ?? null
    );
  }

  replayAgentToStreamEvents(
    sessionId: string,
    toolCallId: string,
    messages: SessionHistoryMessage[],
  ): FlatStreamEventUnion[] {
    // Preserve-mode fallbacks must remain stable between page requests.
    return this.processAgentMessages(
      sessionId,
      toolCallId,
      messages,
      0,
      undefined,
      true,
    );
  }

  /**
   * Process agent session messages and convert to nested events.
   *
   * CRITICAL: Must create message_start/message_complete events for each assistant message
   * so the frontend's buildToolChildren can find them via parentToolUseId.
   *
   * CRITICAL: - Must include parentToolUseId in agent message IDs
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
    collector?: HistoryReplayCollector,
    preserveJsonlIdentity = false,
  ): FlatStreamEventUnion[] {
    const events: FlatStreamEventUnion[] = [];
    let eventIndex = 0;
    let sequence = 0;
    const toolResults = this.correlationService.extractAllToolResults(messages);
    let previousId: string | null = null;
    let runningBlockIndex = 0;

    for (let messageIndex = 0; messageIndex < messages.length; messageIndex++) {
      const msg = messages[messageIndex];
      if (msg.type !== 'assistant' || !msg.message?.content) continue;

      const content = msg.message.content;
      if (!Array.isArray(content)) continue;
      const jsonlTimestamp = msg.timestamp ? Date.parse(msg.timestamp) : NaN;
      const eventTime = (): number =>
        preserveJsonlIdentity && Number.isFinite(jsonlTimestamp)
          ? jsonlTimestamp
          : parentTimestamp + sequence++ * 0.0001;
      const continued =
        preserveJsonlIdentity &&
        !!msg.message.id &&
        msg.message.id === previousId;
      const agentMessageId = preserveJsonlIdentity
        ? (msg.message.id ??
          `agent_msg_${parentToolUseId}_${messageIndex}_${msg.uuid ?? 'line'}`)
        : `agent_msg_${parentToolUseId}_${eventIndex}_${Math.floor(parentTimestamp)}`;
      let blockIndex = continued ? runningBlockIndex : 0;
      if (!continued) {
        events.push(
          this.eventFactory.createAgentMessageStart(
            sessionId,
            agentMessageId,
            eventIndex++,
            eventTime(),
            parentToolUseId,
          ),
        );
      }

      for (const block of content as ContentBlock[]) {
        const eventTimestamp = eventTime();

        if (block.type === 'thinking' && block.thinking) {
          events.push(
            this.eventFactory.createAgentThinkingDelta(
              sessionId,
              agentMessageId,
              block.thinking,
              blockIndex++,
              eventIndex++,
              eventTimestamp,
              parentToolUseId,
            ),
          );
          if (msg.message.id)
            collector?.blockOwners.set(
              events[events.length - 1],
              msg.message.id,
            );
        } else if (block.type === 'text' && block.text) {
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
          if (msg.message.id) {
            collector?.blockOwners.set(
              events[events.length - 1],
              msg.message.id,
            );
          }
        } else if (block.type === 'tool_use') {
          if (preserveJsonlIdentity) blockIndex++;
          const toolResult = block.id ? toolResults.get(block.id) : undefined;
          const toolCallId =
            block.id ||
            (preserveJsonlIdentity
              ? `agent_tool_${parentToolUseId}_${messageIndex}_${eventIndex}`
              : this.eventFactory.generateId());

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
          if (msg.message.id) {
            collector?.blockOwners.set(
              events[events.length - 1],
              msg.message.id,
            );
          }

          if (toolResult) {
            const resultTimestamp = eventTime();
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
        } else if (
          preserveJsonlIdentity &&
          block.type === 'tool_result' &&
          block.tool_use_id
        ) {
          blockIndex++;
          const output =
            typeof block.content === 'string'
              ? block.content
              : JSON.stringify(block.content ?? '');
          events.push(
            this.eventFactory.createAgentToolResult(
              sessionId,
              agentMessageId,
              block.tool_use_id,
              output,
              block.is_error ?? false,
              eventIndex++,
              eventTimestamp,
              parentToolUseId,
            ),
          );
        }
      }

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
          const priced = this.modelResolver.resolveForCost(agentMsgModel);
          agentMessageUsage = {
            tokenUsage: { input: tokenUsage.input, output: tokenUsage.output },
            model: agentMsgModel || undefined,
            cost: calculateMessageCost(
              priced.modelId,
              {
                input: tokenUsage.input,
                output: tokenUsage.output,
                cacheHit: tokenUsage.cacheRead,
                cacheCreation: tokenUsage.cacheCreation,
              },
              priced.pricing,
            ),
          };
        }
      }
      runningBlockIndex = blockIndex;
      previousId = msg.message.id ?? null;
      let next: SessionHistoryMessage | undefined;
      for (
        let nextIndex = messageIndex + 1;
        nextIndex < messages.length;
        nextIndex++
      ) {
        const candidate = messages[nextIndex];
        if (
          candidate.type === 'assistant' &&
          Array.isArray(candidate.message?.content)
        ) {
          next = candidate;
          break;
        }
      }
      const continues =
        preserveJsonlIdentity &&
        !!previousId &&
        next?.message?.id === previousId;
      if (!continues) {
        events.push(
          this.eventFactory.createAgentMessageComplete(
            sessionId,
            agentMessageId,
            eventIndex++,
            eventTime(),
            parentToolUseId,
            agentMessageUsage,
          ),
        );
      }
    }

    return events;
  }
}
