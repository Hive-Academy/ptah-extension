/**
 * DeepAgentHistoryReaderService — Reads deep agent session history from
 * JsonFileCheckpointer's on-disk format and converts it to FlatStreamEventUnion[].
 *
 * LangGraph checkpoints store serialized LangChain messages in
 * `channel_values.messages`. This service reads those JSON files without
 * importing LangChain — it parses the serialized format directly.
 *
 * File layout (set by JsonFileCheckpointer):
 *   {workspacePath}/.ptah/deep-agent-sessions/{thread_id}/
 *     metadata.json          — ThreadIndex with checkpoint IDs
 *     checkpoint-{id}.json   — StoredCheckpoint with messages
 */

import { injectable, inject } from 'tsyringe';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import type { FlatStreamEventUnion } from '@ptah-extension/shared';
import type { Logger } from '@ptah-extension/vscode-core';
import { TOKENS } from '@ptah-extension/vscode-core';
import { HistoryEventFactory } from './history-event-factory';
import { SDK_TOKENS } from '../../di/tokens';

const DEEP_AGENT_SESSIONS_DIR = '.ptah/deep-agent-sessions';

interface ThreadIndex {
  checkpointIds: string[];
  createdAt: string;
  updatedAt: string;
}

interface StoredCheckpoint {
  checkpoint: {
    id: string;
    ts: string;
    channel_values: Record<string, unknown>;
  };
  metadata: Record<string, unknown>;
  parentId?: string;
}

// LangChain serialized message formats
interface LcSerializedMessage {
  lc: number;
  type: string;
  id: string[];
  kwargs: {
    content: string | LcContentBlock[];
    tool_calls?: LcToolCall[];
    additional_kwargs?: Record<string, unknown>;
    response_metadata?: Record<string, unknown>;
    name?: string;
    tool_call_id?: string;
    status?: string;
  };
}

interface LcContentBlock {
  type: string;
  text?: string;
  thinking?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
}

interface LcToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
}

// Plain object format (some serializers produce this)
interface PlainMessage {
  type: string; // "human" | "ai" | "tool" | "system"
  content: string | LcContentBlock[];
  tool_calls?: LcToolCall[];
  tool_call_id?: string;
  name?: string;
}

type SerializedMessage = LcSerializedMessage | PlainMessage;

@injectable()
export class DeepAgentHistoryReaderService {
  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(SDK_TOKENS.SDK_HISTORY_EVENT_FACTORY)
    private readonly eventFactory: HistoryEventFactory,
  ) {}

  /**
   * Check whether a deep agent session directory exists for the given sessionId.
   */
  hasSession(sessionId: string, workspacePath: string): boolean {
    const threadDir = this.getThreadDir(sessionId, workspacePath);
    const indexPath = join(threadDir, 'metadata.json');
    return existsSync(indexPath);
  }

  /**
   * Read deep agent session history as FlatStreamEventUnion[] for UI rendering.
   */
  async readSessionHistory(
    sessionId: string,
    workspacePath: string,
  ): Promise<{
    events: FlatStreamEventUnion[];
    stats: {
      totalCost: number;
      tokens: {
        input: number;
        output: number;
        cacheRead: number;
        cacheCreation: number;
      };
      messageCount: number;
    } | null;
  }> {
    try {
      const messages = this.loadMessages(sessionId, workspacePath);
      if (!messages || messages.length === 0) {
        return { events: [], stats: null };
      }

      const events = this.convertToEvents(sessionId, messages);

      const assistantCount = messages.filter(
        (m) => this.getMessageRole(m) === 'ai',
      ).length;

      return {
        events,
        stats: {
          totalCost: 0,
          tokens: { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 },
          messageCount: assistantCount,
        },
      };
    } catch (error) {
      this.logger.error(
        '[DeepAgentHistoryReader] Failed to read session history',
        error instanceof Error ? error : new Error(String(error)),
      );
      return { events: [], stats: null };
    }
  }

  /**
   * Read deep agent session history as simple messages (for backward compat).
   */
  async readHistoryAsMessages(
    sessionId: string,
    workspacePath: string,
  ): Promise<
    {
      id: string;
      role: 'user' | 'assistant';
      content: string;
      timestamp: number;
    }[]
  > {
    try {
      const messages = this.loadMessages(sessionId, workspacePath);
      if (!messages) return [];

      const result: {
        id: string;
        role: 'user' | 'assistant';
        content: string;
        timestamp: number;
      }[] = [];
      const now = Date.now();

      for (let i = 0; i < messages.length; i++) {
        const msg = messages[i];
        const role = this.getMessageRole(msg);
        if (role !== 'human' && role !== 'ai') continue;

        const content = this.extractTextContent(msg);
        if (!content) continue;

        result.push({
          id: `deep-msg-${i}`,
          role: role === 'human' ? 'user' : 'assistant',
          content,
          timestamp: now - (messages.length - i) * 1000,
        });
      }

      return result;
    } catch (error) {
      this.logger.error(
        '[DeepAgentHistoryReader] Failed to read history as messages',
        error instanceof Error ? error : new Error(String(error)),
      );
      return [];
    }
  }

  // ==========================================================================
  // PRIVATE — Checkpoint I/O
  // ==========================================================================

  private getThreadDir(sessionId: string, workspacePath: string): string {
    const safe = sessionId.replace(/[^a-zA-Z0-9_-]/g, '_');
    return join(workspacePath, DEEP_AGENT_SESSIONS_DIR, safe);
  }

  private loadMessages(
    sessionId: string,
    workspacePath: string,
  ): SerializedMessage[] | null {
    const threadDir = this.getThreadDir(sessionId, workspacePath);
    const indexPath = join(threadDir, 'metadata.json');

    if (!existsSync(indexPath)) {
      this.logger.debug('[DeepAgentHistoryReader] No metadata.json found', {
        sessionId,
        threadDir,
      });
      return null;
    }

    const index: ThreadIndex = JSON.parse(readFileSync(indexPath, 'utf-8'));
    if (!index.checkpointIds || index.checkpointIds.length === 0) {
      return null;
    }

    // Read the latest checkpoint
    const latestId = index.checkpointIds[index.checkpointIds.length - 1];
    const cpPath = join(threadDir, `checkpoint-${latestId}.json`);
    if (!existsSync(cpPath)) {
      this.logger.warn('[DeepAgentHistoryReader] Checkpoint file missing', {
        sessionId,
        checkpointId: latestId,
      });
      return null;
    }

    const stored: StoredCheckpoint = JSON.parse(readFileSync(cpPath, 'utf-8'));
    const channelMessages = stored.checkpoint.channel_values?.['messages'];

    if (!Array.isArray(channelMessages)) {
      this.logger.debug('[DeepAgentHistoryReader] No messages in checkpoint', {
        sessionId,
        channels: Object.keys(stored.checkpoint.channel_values ?? {}),
      });
      return null;
    }

    this.logger.info('[DeepAgentHistoryReader] Loaded checkpoint messages', {
      sessionId,
      messageCount: channelMessages.length,
      checkpointId: latestId,
    });

    return channelMessages as SerializedMessage[];
  }

  // ==========================================================================
  // PRIVATE — Message format detection
  // ==========================================================================

  private isLcSerialized(msg: SerializedMessage): msg is LcSerializedMessage {
    return 'lc' in msg && 'kwargs' in msg;
  }

  private getMessageRole(msg: SerializedMessage): string {
    if (this.isLcSerialized(msg)) {
      const ids = msg.id;
      if (ids.some((id) => id === 'HumanMessage')) return 'human';
      if (ids.some((id) => id === 'AIMessage')) return 'ai';
      if (ids.some((id) => id === 'ToolMessage')) return 'tool';
      if (ids.some((id) => id === 'SystemMessage')) return 'system';
      return 'unknown';
    }
    return (msg as PlainMessage).type ?? 'unknown';
  }

  private getContent(msg: SerializedMessage): string | LcContentBlock[] {
    if (this.isLcSerialized(msg)) {
      return msg.kwargs.content;
    }
    return (msg as PlainMessage).content;
  }

  private getToolCalls(msg: SerializedMessage): LcToolCall[] {
    if (this.isLcSerialized(msg)) {
      return msg.kwargs.tool_calls ?? [];
    }
    return (msg as PlainMessage).tool_calls ?? [];
  }

  private getToolCallId(msg: SerializedMessage): string | undefined {
    if (this.isLcSerialized(msg)) {
      return msg.kwargs.tool_call_id;
    }
    return (msg as PlainMessage).tool_call_id;
  }

  /**
   * Extract plain text from a message's content (string or content blocks).
   */
  private extractTextContent(msg: SerializedMessage): string {
    const content = this.getContent(msg);
    if (typeof content === 'string') return content;
    if (!Array.isArray(content)) return '';

    return content
      .filter((block) => block.type === 'text' && block.text)
      .map((block) => block.text!)
      .join('\n');
  }

  // ==========================================================================
  // PRIVATE — Convert to FlatStreamEventUnion
  // ==========================================================================

  private convertToEvents(
    sessionId: string,
    messages: SerializedMessage[],
  ): FlatStreamEventUnion[] {
    const events: FlatStreamEventUnion[] = [];
    let eventIndex = 0;
    const now = Date.now();

    // Build a map of tool_call_id → tool result message for pairing
    const toolResultMap = new Map<string, SerializedMessage>();
    for (const msg of messages) {
      const role = this.getMessageRole(msg);
      if (role === 'tool') {
        const tcId = this.getToolCallId(msg);
        if (tcId) toolResultMap.set(tcId, msg);
      }
    }

    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i];
      const role = this.getMessageRole(msg);
      const timestamp = now - (messages.length - i) * 1000;

      if (role === 'human') {
        const messageId = `deep-user-${i}`;
        events.push(
          this.eventFactory.createMessageStart(
            sessionId,
            messageId,
            'user',
            eventIndex++,
            timestamp,
          ),
        );

        const text = this.extractTextContent(msg);
        if (text) {
          events.push(
            this.eventFactory.createTextDelta(
              sessionId,
              messageId,
              text,
              0,
              eventIndex++,
              timestamp,
            ),
          );
        }

        events.push(
          this.eventFactory.createMessageComplete(
            sessionId,
            messageId,
            eventIndex++,
            timestamp,
          ),
        );
      } else if (role === 'ai') {
        const messageId = `deep-ai-${i}`;
        events.push(
          this.eventFactory.createMessageStart(
            sessionId,
            messageId,
            'assistant',
            eventIndex++,
            timestamp,
          ),
        );

        const content = this.getContent(msg);
        let blockIndex = 0;

        if (typeof content === 'string') {
          if (content) {
            events.push(
              this.eventFactory.createTextDelta(
                sessionId,
                messageId,
                content,
                blockIndex++,
                eventIndex++,
                timestamp,
              ),
            );
          }
        } else if (Array.isArray(content)) {
          for (const block of content) {
            if (block.type === 'thinking' && block.thinking) {
              events.push(
                this.eventFactory.createThinkingDelta(
                  sessionId,
                  messageId,
                  block.thinking,
                  blockIndex++,
                  eventIndex++,
                  timestamp,
                ),
              );
            } else if (block.type === 'text' && block.text) {
              events.push(
                this.eventFactory.createTextDelta(
                  sessionId,
                  messageId,
                  block.text,
                  blockIndex++,
                  eventIndex++,
                  timestamp,
                ),
              );
            } else if (block.type === 'tool_use' && block.id && block.name) {
              events.push(
                this.eventFactory.createToolStart(
                  sessionId,
                  messageId,
                  block.id,
                  block.name,
                  block.input,
                  eventIndex++,
                  timestamp,
                ),
              );

              // Pair with tool result if available
              const toolResult = toolResultMap.get(block.id);
              if (toolResult) {
                const resultContent = this.extractTextContent(toolResult);
                const isError = this.isLcSerialized(toolResult)
                  ? toolResult.kwargs.status === 'error'
                  : false;
                events.push(
                  this.eventFactory.createToolResult(
                    sessionId,
                    messageId,
                    block.id,
                    resultContent,
                    isError,
                    eventIndex++,
                    timestamp,
                  ),
                );
              }
            }
          }
        }

        // Emit tool_start + tool_result for tool_calls array (alternative format)
        const toolCalls = this.getToolCalls(msg);
        for (const tc of toolCalls) {
          // Skip if we already emitted this from content blocks
          if (Array.isArray(content) && content.some((b) => b.id === tc.id)) {
            continue;
          }

          events.push(
            this.eventFactory.createToolStart(
              sessionId,
              messageId,
              tc.id,
              tc.name,
              tc.args,
              eventIndex++,
              timestamp,
            ),
          );

          const toolResult = toolResultMap.get(tc.id);
          if (toolResult) {
            const resultContent = this.extractTextContent(toolResult);
            const isError = this.isLcSerialized(toolResult)
              ? toolResult.kwargs.status === 'error'
              : false;
            events.push(
              this.eventFactory.createToolResult(
                sessionId,
                messageId,
                tc.id,
                resultContent,
                isError,
                eventIndex++,
                timestamp,
              ),
            );
          }
        }

        events.push(
          this.eventFactory.createMessageComplete(
            sessionId,
            messageId,
            eventIndex++,
            timestamp,
          ),
        );
      }
      // Skip 'tool' role messages — they're paired with AI tool_calls above
      // Skip 'system' messages — not shown in UI
    }

    this.logger.info('[DeepAgentHistoryReader] Converted to events', {
      sessionId,
      inputMessages: messages.length,
      outputEvents: events.length,
    });

    return events;
  }
}
