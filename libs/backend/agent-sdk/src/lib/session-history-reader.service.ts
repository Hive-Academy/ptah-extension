/**
 * SessionHistoryReaderService - Reads JSONL session files and converts to FlatStreamEventUnion
 *
 * This service loads historical session data from Claude JSONL files and
 * converts them to the same FlatStreamEventUnion format used by live streaming.
 *
 * Features:
 * - Reads main session JSONL files
 * - Loads linked agent session files
 * - Correlates agents to Task tool_uses via timestamp
 * - Links tool_use to tool_result
 * - Outputs FlatStreamEventUnion[] for seamless UI integration
 *
 * Architecture: The frontend ExecutionTreeBuilder processes these events
 * exactly as it would live streaming events - no UI changes required.
 */

import { injectable, inject } from 'tsyringe';
import { promises as fs } from 'fs';
import { createReadStream } from 'fs';
import { createInterface } from 'readline';
import * as path from 'path';
import * as os from 'os';
import {
  MessageStartEvent,
  TextDeltaEvent,
  ThinkingDeltaEvent,
  ToolStartEvent,
  ToolResultEvent,
  AgentStartEvent,
  MessageCompleteEvent,
  FlatStreamEventUnion,
  JSONLMessage,
} from '@ptah-extension/shared';
import type { Logger } from '@ptah-extension/vscode-core';
import { TOKENS } from '@ptah-extension/vscode-core';

// ============================================================================
// INTERFACES
// ============================================================================

// JsonlSummaryLine interface removed - not needed for replay

interface JsonlMessageLine {
  uuid: string;
  sessionId: string;
  timestamp: string;
  cwd?: string;
  type?: string;
  message?: {
    role: string;
    content: string | ContentBlock[];
  };
  isMeta?: boolean;
  slug?: string;
}

interface ContentBlock {
  type: string;
  text?: string;
  thinking?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
  tool_use_id?: string;
  content?: string | unknown[];
  is_error?: boolean;
}

interface AgentSessionData {
  agentId: string;
  filePath: string;
  messages: JSONLMessage[];
}

interface ToolResultData {
  content: string;
  isError: boolean;
}

// ============================================================================
// SERVICE
// ============================================================================

@injectable()
export class SessionHistoryReaderService {
  constructor(@inject(TOKENS.LOGGER) private readonly logger: Logger) {}

  /**
   * Read session history and convert to FlatStreamEventUnion events
   *
   * @param sessionId - Session identifier
   * @param workspacePath - Workspace path for locating session files
   * @returns Array of FlatStreamEventUnion events ready for streaming to webview
   */
  async readSessionHistory(
    sessionId: string,
    workspacePath: string
  ): Promise<FlatStreamEventUnion[]> {
    try {
      // 1. Find the sessions directory
      const sessionsDir = await this.findSessionsDirectory(workspacePath);
      if (!sessionsDir) {
        this.logger.warn('[SessionHistoryReader] Sessions directory not found');
        return [];
      }

      // 2. Find the session file
      const sessionPath = path.join(sessionsDir, `${sessionId}.jsonl`);
      try {
        await fs.access(sessionPath);
      } catch {
        this.logger.warn('[SessionHistoryReader] Session file not found', {
          sessionId,
        });
        return [];
      }

      // 3. Read main session messages
      const mainMessages = await this.readJsonlMessages(sessionPath);
      this.logger.debug('[SessionHistoryReader] Read main messages', {
        count: mainMessages.length,
      });

      // 4. Load agent sessions
      const agentSessions = await this.loadAgentSessions(
        sessionsDir,
        sessionId
      );
      this.logger.debug('[SessionHistoryReader] Loaded agent sessions', {
        count: agentSessions.length,
      });

      // 5. Replay and convert to stream events
      const events = this.replayToStreamEvents(
        sessionId,
        mainMessages,
        agentSessions
      );

      this.logger.info('[SessionHistoryReader] Converted to stream events', {
        eventCount: events.length,
      });

      return events;
    } catch (error) {
      this.logger.error(
        '[SessionHistoryReader] Failed to read session history',
        error instanceof Error ? error : new Error(String(error))
      );
      return [];
    }
  }

  /**
   * Read session history as simple message objects (for RPC response)
   *
   * This is a simpler method that returns complete messages directly,
   * suitable for returning in the RPC response instead of streaming events.
   *
   * @param sessionId - Session identifier
   * @param workspacePath - Workspace path for locating session files
   * @returns Array of simple message objects
   */
  async readHistoryAsMessages(
    sessionId: string,
    workspacePath: string
  ): Promise<
    {
      id: string;
      role: 'user' | 'assistant';
      content: string;
      timestamp: number;
    }[]
  > {
    try {
      const sessionsDir = await this.findSessionsDirectory(workspacePath);
      if (!sessionsDir) {
        this.logger.warn('[SessionHistoryReader] Sessions directory not found');
        return [];
      }

      // Read main session file directly
      const sessionFile = path.join(sessionsDir, `${sessionId}.jsonl`);
      const messages: {
        id: string;
        role: 'user' | 'assistant';
        content: string;
        timestamp: number;
      }[] = [];

      // Read file line by line
      const fileStream = createReadStream(sessionFile, { encoding: 'utf-8' });
      const rl = createInterface({ input: fileStream, crlfDelay: Infinity });

      for await (const line of rl) {
        if (!line.trim()) continue;

        try {
          const parsed = JSON.parse(line) as JsonlMessageLine;

          // Skip non-message lines (summary, meta)
          if (!parsed.message?.role) continue;

          const role = parsed.message.role;
          if (role !== 'user' && role !== 'assistant') continue;

          // Extract text content
          const content = this.extractTextContent(parsed.message.content);
          if (!content) continue;

          const timestamp = parsed.timestamp
            ? new Date(parsed.timestamp).getTime()
            : Date.now();

          messages.push({
            id: parsed.uuid || this.generateId(),
            role: role as 'user' | 'assistant',
            content,
            timestamp,
          });
        } catch {
          // Skip malformed lines
          continue;
        }
      }

      this.logger.info('[SessionHistoryReader] Loaded history as messages', {
        sessionId,
        messageCount: messages.length,
      });

      return messages;
    } catch (error) {
      this.logger.error(
        '[SessionHistoryReader] Failed to read history as messages',
        error instanceof Error ? error : new Error(String(error))
      );
      return [];
    }
  }

  // ==========================================================================
  // JSONL READING
  // ==========================================================================

  /**
   * Find the sessions directory for a workspace
   */
  private async findSessionsDirectory(
    workspacePath: string
  ): Promise<string | null> {
    const homeDir = os.homedir();
    const projectsDir = path.join(homeDir, '.claude', 'projects');

    try {
      await fs.access(projectsDir);
    } catch {
      return null;
    }

    // Generate the escaped path pattern
    const escapedPath = workspacePath.replace(/[:\\/]/g, '-');
    const dirs = await fs.readdir(projectsDir);

    // Try exact match first
    if (dirs.includes(escapedPath)) {
      return path.join(projectsDir, escapedPath);
    }

    // Try lowercase match
    const lowerEscaped = escapedPath.toLowerCase();
    const match = dirs.find((d) => d.toLowerCase() === lowerEscaped);
    if (match) {
      return path.join(projectsDir, match);
    }

    // Try partial match
    const workspaceName = path.basename(workspacePath);
    const partialMatch = dirs.find((d) =>
      d.toLowerCase().includes(workspaceName.toLowerCase())
    );
    if (partialMatch) {
      return path.join(projectsDir, partialMatch);
    }

    return null;
  }

  /**
   * Read all messages from a JSONL file
   */
  private async readJsonlMessages(filePath: string): Promise<JSONLMessage[]> {
    const messages: JSONLMessage[] = [];
    const stream = createReadStream(filePath, { encoding: 'utf8' });
    const reader = createInterface({ input: stream });

    try {
      for await (const line of reader) {
        if (!line.trim()) continue;

        try {
          const parsed = JSON.parse(line) as JsonlMessageLine;
          // Convert to JSONLMessage format
          messages.push(this.convertToJSONLMessage(parsed));
        } catch {
          // Skip malformed lines
        }
      }
    } finally {
      reader.close();
      stream.destroy();
    }

    return messages;
  }

  /**
   * Convert JsonlMessageLine to JSONLMessage format
   */
  private convertToJSONLMessage(line: JsonlMessageLine): JSONLMessage {
    return {
      type: (line.type ||
        line.message?.role ||
        'unknown') as JSONLMessage['type'],
      uuid: line.uuid,
      sessionId: line.sessionId,
      timestamp: line.timestamp,
      isMeta: line.isMeta,
      message: line.message as JSONLMessage['message'],
    };
  }

  /**
   * Load agent session files (agent-*.jsonl)
   */
  private async loadAgentSessions(
    sessionsDir: string,
    _parentSessionId: string
  ): Promise<AgentSessionData[]> {
    const agentSessions: AgentSessionData[] = [];

    try {
      const files = await fs.readdir(sessionsDir);
      const agentFiles = files.filter(
        (f) => f.startsWith('agent-') && f.endsWith('.jsonl')
      );

      for (const file of agentFiles) {
        const filePath = path.join(sessionsDir, file);
        const agentId = file.replace('.jsonl', '');

        try {
          const messages = await this.readJsonlMessages(filePath);

          // Check if this agent belongs to parent session by checking first message
          const firstMsg = messages[0] as unknown as JsonlMessageLine;
          if (firstMsg?.slug || messages.length > 0) {
            agentSessions.push({
              agentId,
              filePath,
              messages,
            });
          }
        } catch {
          // Skip unreadable agent files
        }
      }
    } catch {
      // No agent files found
    }

    return agentSessions;
  }

  // ==========================================================================
  // REPLAY & CONVERSION
  // ==========================================================================

  /**
   * Main replay function - converts JSONL messages to FlatStreamEventUnion events
   */
  private replayToStreamEvents(
    sessionId: string,
    mainMessages: JSONLMessage[],
    agentSessions: AgentSessionData[]
  ): FlatStreamEventUnion[] {
    const events: FlatStreamEventUnion[] = [];
    let eventIndex = 0;

    // Build maps for correlation
    const agentDataMap = this.buildAgentDataMap(agentSessions);
    const taskToolUses = this.extractTaskToolUses(mainMessages);
    const taskToAgentMap = this.correlateAgentsToTasks(
      taskToolUses,
      agentDataMap
    );
    const allToolResults = this.extractAllToolResults(mainMessages);

    // Process messages
    let currentMessageId: string | null = null;
    let blockIndex = 0;

    for (const msg of mainMessages) {
      const rawMsg = msg as unknown as JsonlMessageLine;

      // Skip non-message types
      if (!msg.type || !['user', 'assistant'].includes(msg.type)) {
        continue;
      }

      if (msg.type === 'user' && msg.message?.content) {
        if (rawMsg.isMeta === true) continue;

        // Skip tool_result messages
        const contentRaw = msg.message.content;
        if (
          Array.isArray(contentRaw) &&
          contentRaw.length > 0 &&
          (contentRaw[0] as ContentBlock)?.type === 'tool_result'
        ) {
          continue;
        }

        // Close previous assistant message
        if (currentMessageId) {
          events.push(
            this.createMessageComplete(
              sessionId,
              currentMessageId,
              eventIndex++
            )
          );
          currentMessageId = null;
          blockIndex = 0;
        }

        // Create user message events
        const messageId = rawMsg.uuid || this.generateId();
        const content = this.extractTextContent(msg.message.content);
        const timestamp = rawMsg.timestamp
          ? new Date(rawMsg.timestamp).getTime()
          : Date.now();

        events.push(
          this.createMessageStart(
            sessionId,
            messageId,
            'user',
            eventIndex++,
            timestamp
          )
        );
        if (content) {
          events.push(
            this.createTextDelta(sessionId, messageId, content, 0, eventIndex++)
          );
        }
        events.push(
          this.createMessageComplete(sessionId, messageId, eventIndex++)
        );
      } else if (msg.type === 'assistant' && msg.message?.content) {
        // Initialize message if needed
        if (!currentMessageId) {
          currentMessageId = rawMsg.uuid || this.generateId();
          const timestamp = rawMsg.timestamp
            ? new Date(rawMsg.timestamp).getTime()
            : Date.now();
          events.push(
            this.createMessageStart(
              sessionId,
              currentMessageId,
              'assistant',
              eventIndex++,
              timestamp
            )
          );
        }

        // Process content blocks
        const content = msg.message.content;
        if (Array.isArray(content)) {
          for (const block of content as ContentBlock[]) {
            if (block.type === 'text' && block.text) {
              events.push(
                this.createTextDelta(
                  sessionId,
                  currentMessageId,
                  block.text,
                  blockIndex++,
                  eventIndex++
                )
              );
            } else if (block.type === 'thinking' && block.thinking) {
              events.push(
                this.createThinkingDelta(
                  sessionId,
                  currentMessageId,
                  block.thinking,
                  blockIndex++,
                  eventIndex++
                )
              );
            } else if (block.type === 'tool_use') {
              const toolResult = block.id
                ? allToolResults.get(block.id)
                : undefined;

              if (block.name === 'Task' && block.input) {
                // Agent spawn
                const agentId = block.id
                  ? taskToAgentMap.get(block.id) || null
                  : null;
                events.push(
                  this.createAgentStart(
                    sessionId,
                    currentMessageId,
                    block.id || this.generateId(),
                    block.input,
                    eventIndex++
                  )
                );

                // Add nested agent events if we have the agent data
                const agentData = agentId
                  ? agentDataMap.get(agentId)
                  : undefined;
                if (agentData) {
                  const nestedEvents = this.processAgentMessages(
                    sessionId,
                    currentMessageId,
                    block.id || this.generateId(),
                    agentData.executionMessages
                  );
                  events.push(...nestedEvents);
                }

                // Add tool result if available
                if (toolResult) {
                  events.push(
                    this.createToolResult(
                      sessionId,
                      currentMessageId,
                      block.id || '',
                      toolResult.content,
                      toolResult.isError,
                      eventIndex++
                    )
                  );
                }
              } else {
                // Regular tool
                events.push(
                  this.createToolStart(
                    sessionId,
                    currentMessageId,
                    block.id || this.generateId(),
                    block.name || 'unknown',
                    block.input,
                    eventIndex++
                  )
                );

                if (toolResult) {
                  events.push(
                    this.createToolResult(
                      sessionId,
                      currentMessageId,
                      block.id || '',
                      toolResult.content,
                      toolResult.isError,
                      eventIndex++
                    )
                  );
                }
              }
            }
          }
        }
      }
    }

    // Close final message
    if (currentMessageId) {
      events.push(
        this.createMessageComplete(sessionId, currentMessageId, eventIndex++)
      );
    }

    return events;
  }

  /**
   * Process agent session messages and convert to nested events
   */
  private processAgentMessages(
    sessionId: string,
    parentMessageId: string,
    parentToolUseId: string,
    messages: JSONLMessage[]
  ): FlatStreamEventUnion[] {
    const events: FlatStreamEventUnion[] = [];
    let blockIndex = 0;

    // Extract tool results from agent messages
    const toolResults = this.extractAllToolResults(messages);

    for (const msg of messages) {
      if (msg.type !== 'assistant' || !msg.message?.content) continue;

      const content = msg.message.content;
      if (!Array.isArray(content)) continue;

      for (const block of content as ContentBlock[]) {
        if (block.type === 'text' && block.text) {
          events.push({
            eventType: 'text_delta',
            id: this.generateId(),
            sessionId,
            messageId: parentMessageId,
            parentToolUseId,
            blockIndex: blockIndex++,
            delta: block.text,
            timestamp: Date.now(),
          } as TextDeltaEvent);
        } else if (block.type === 'tool_use') {
          const toolResult = block.id ? toolResults.get(block.id) : undefined;

          events.push({
            eventType: 'tool_start',
            id: this.generateId(),
            sessionId,
            messageId: parentMessageId,
            parentToolUseId,
            toolCallId: block.id || this.generateId(),
            toolName: block.name || 'unknown',
            toolInput: block.input,
            isTaskTool: block.name === 'Task',
            timestamp: Date.now(),
          } as ToolStartEvent);

          if (toolResult) {
            events.push({
              eventType: 'tool_result',
              id: this.generateId(),
              sessionId,
              messageId: parentMessageId,
              parentToolUseId,
              toolCallId: block.id || '',
              output: toolResult.content,
              isError: toolResult.isError,
              timestamp: Date.now(),
            } as ToolResultEvent);
          }
        }
      }
    }

    return events;
  }

  // ==========================================================================
  // CORRELATION HELPERS (Ported from SessionReplayService)
  // ==========================================================================

  private buildAgentDataMap(
    agentSessions: AgentSessionData[]
  ): Map<
    string,
    { agentId: string; timestamp: number; executionMessages: JSONLMessage[] }
  > {
    const map = new Map<
      string,
      { agentId: string; timestamp: number; executionMessages: JSONLMessage[] }
    >();

    for (const agent of agentSessions) {
      let slug: string | null = null;
      let timestamp = Date.now();

      for (const msg of agent.messages) {
        const rawMsg = msg as unknown as JsonlMessageLine;
        if (rawMsg.slug && !slug) slug = rawMsg.slug;
        if (rawMsg.timestamp && timestamp === Date.now()) {
          timestamp = new Date(rawMsg.timestamp).getTime();
        }
      }

      // Filter warmup agents (no slug)
      if (!slug) continue;

      map.set(agent.agentId, {
        agentId: agent.agentId,
        timestamp,
        executionMessages: agent.messages,
      });
    }

    return map;
  }

  private extractTaskToolUses(
    messages: JSONLMessage[]
  ): Array<{ toolUseId: string; timestamp: number; subagentType: string }> {
    const tasks: Array<{
      toolUseId: string;
      timestamp: number;
      subagentType: string;
    }> = [];

    for (const msg of messages) {
      const rawMsg = msg as unknown as JsonlMessageLine;
      if (msg.type !== 'assistant' || !msg.message?.content) continue;

      const timestamp = rawMsg.timestamp
        ? new Date(rawMsg.timestamp).getTime()
        : Date.now();

      const content = msg.message.content;
      if (!Array.isArray(content)) continue;

      for (const block of content as ContentBlock[]) {
        if (block.type === 'tool_use' && block.name === 'Task' && block.id) {
          tasks.push({
            toolUseId: block.id,
            timestamp,
            subagentType:
              (block.input?.['subagent_type'] as string) || 'unknown',
          });
        }
      }
    }

    return tasks;
  }

  private correlateAgentsToTasks(
    taskToolUses: Array<{
      toolUseId: string;
      timestamp: number;
      subagentType: string;
    }>,
    agentDataMap: Map<
      string,
      { agentId: string; timestamp: number; executionMessages: JSONLMessage[] }
    >
  ): Map<string, string> {
    const map = new Map<string, string>();
    const usedAgents = new Set<string>();

    const sortedTasks = [...taskToolUses].sort(
      (a, b) => a.timestamp - b.timestamp
    );
    const sortedAgents = [...agentDataMap.values()].sort(
      (a, b) => a.timestamp - b.timestamp
    );

    for (const task of sortedTasks) {
      let bestMatch: string | null = null;
      let bestTimeDiff = Infinity;

      for (const agent of sortedAgents) {
        if (usedAgents.has(agent.agentId)) continue;

        const timeDiff = agent.timestamp - task.timestamp;
        if (timeDiff >= -1000 && timeDiff < bestTimeDiff && timeDiff < 60000) {
          bestTimeDiff = timeDiff;
          bestMatch = agent.agentId;
        }
      }

      if (bestMatch) {
        map.set(task.toolUseId, bestMatch);
        usedAgents.add(bestMatch);
      }
    }

    return map;
  }

  private extractAllToolResults(
    messages: JSONLMessage[]
  ): Map<string, ToolResultData> {
    const results = new Map<string, ToolResultData>();

    for (const msg of messages) {
      if (msg.type !== 'user' || !msg.message?.content) continue;

      const content = msg.message.content;
      if (!Array.isArray(content)) continue;

      for (const block of content as ContentBlock[]) {
        if (block.type === 'tool_result' && block.tool_use_id) {
          let resultText = '';
          const blockContent = block.content;

          if (typeof blockContent === 'string') {
            resultText = blockContent;
          } else if (Array.isArray(blockContent)) {
            resultText = (blockContent as ContentBlock[])
              .filter((c) => c.type === 'text')
              .map((c) => c.text || '')
              .join('\n');
          }

          results.set(block.tool_use_id, {
            content: resultText,
            isError: block.is_error === true,
          });
        }
      }
    }

    return results;
  }

  // ==========================================================================
  // EVENT FACTORY HELPERS
  // ==========================================================================

  private createMessageStart(
    sessionId: string,
    messageId: string,
    role: 'user' | 'assistant',
    index: number,
    timestamp: number
  ): MessageStartEvent {
    return {
      eventType: 'message_start',
      id: `evt_${index}_${Date.now()}`,
      sessionId,
      messageId,
      role,
      timestamp,
    };
  }

  private createTextDelta(
    sessionId: string,
    messageId: string,
    text: string,
    blockIndex: number,
    index: number
  ): TextDeltaEvent {
    return {
      eventType: 'text_delta',
      id: `evt_${index}_${Date.now()}`,
      sessionId,
      messageId,
      blockIndex,
      delta: text,
      timestamp: Date.now(),
    };
  }

  private createThinkingDelta(
    sessionId: string,
    messageId: string,
    thinking: string,
    blockIndex: number,
    index: number
  ): ThinkingDeltaEvent {
    return {
      eventType: 'thinking_delta',
      id: `evt_${index}_${Date.now()}`,
      sessionId,
      messageId,
      blockIndex,
      delta: thinking,
      timestamp: Date.now(),
    };
  }

  private createToolStart(
    sessionId: string,
    messageId: string,
    toolCallId: string,
    toolName: string,
    toolInput: Record<string, unknown> | undefined,
    index: number
  ): ToolStartEvent {
    return {
      eventType: 'tool_start',
      id: `evt_${index}_${Date.now()}`,
      sessionId,
      messageId,
      toolCallId,
      toolName,
      toolInput,
      isTaskTool: toolName === 'Task',
      timestamp: Date.now(),
    };
  }

  private createAgentStart(
    sessionId: string,
    messageId: string,
    toolCallId: string,
    input: Record<string, unknown>,
    index: number
  ): AgentStartEvent {
    return {
      eventType: 'agent_start',
      id: `evt_${index}_${Date.now()}`,
      sessionId,
      messageId,
      toolCallId,
      agentType: (input['subagent_type'] as string) || 'unknown',
      agentDescription: input['description'] as string | undefined,
      agentPrompt: input['prompt'] as string | undefined,
      timestamp: Date.now(),
    };
  }

  private createToolResult(
    sessionId: string,
    messageId: string,
    toolCallId: string,
    output: string,
    isError: boolean,
    index: number
  ): ToolResultEvent {
    return {
      eventType: 'tool_result',
      id: `evt_${index}_${Date.now()}`,
      sessionId,
      messageId,
      toolCallId,
      output,
      isError,
      timestamp: Date.now(),
    };
  }

  private createMessageComplete(
    sessionId: string,
    messageId: string,
    index: number
  ): MessageCompleteEvent {
    return {
      eventType: 'message_complete',
      id: `evt_${index}_${Date.now()}`,
      sessionId,
      messageId,
      timestamp: Date.now(),
    };
  }

  // ==========================================================================
  // UTILITIES
  // ==========================================================================

  private extractTextContent(content: unknown): string {
    if (typeof content === 'string') return content;
    if (Array.isArray(content)) {
      return (content as ContentBlock[])
        .filter((b) => b.type === 'text')
        .map((b) => b.text || '')
        .join('\n');
    }
    return '';
  }

  private generateId(): string {
    return `msg_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  }
}
