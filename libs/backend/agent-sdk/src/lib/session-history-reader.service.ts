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
  EventSource,
  isTaskToolInput,
} from '@ptah-extension/shared';
import type { Logger } from '@ptah-extension/vscode-core';
import { TOKENS } from '@ptah-extension/vscode-core';

// ============================================================================
// INTERFACES
// ============================================================================

/**
 * Raw JSONL message line from Claude session files.
 * This is the actual format stored in .jsonl files.
 */
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

/**
 * Extended message type for session history processing.
 * Extends the base JSONLMessage with fields needed for:
 * - Session matching (sessionId)
 * - Correlation (timestamp)
 * - Warmup filtering (slug, isMeta)
 * - Message tracking (uuid)
 */
interface SessionHistoryMessage extends JSONLMessage {
  readonly uuid?: string;
  readonly sessionId?: string;
  readonly timestamp?: string;
  readonly isMeta?: boolean;
  readonly slug?: string;
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
  messages: SessionHistoryMessage[];
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
  private async readJsonlMessages(
    filePath: string
  ): Promise<SessionHistoryMessage[]> {
    const messages: SessionHistoryMessage[] = [];
    const stream = createReadStream(filePath, { encoding: 'utf8' });
    const reader = createInterface({ input: stream });

    try {
      for await (const line of reader) {
        if (!line.trim()) continue;

        try {
          const parsed = JSON.parse(line) as JsonlMessageLine;
          // Convert to SessionHistoryMessage format (preserves extra fields)
          messages.push(this.convertToSessionHistoryMessage(parsed));
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
  private convertToSessionHistoryMessage(
    line: JsonlMessageLine
  ): SessionHistoryMessage {
    return {
      type: (line.type ||
        line.message?.role ||
        'unknown') as SessionHistoryMessage['type'],
      uuid: line.uuid,
      sessionId: line.sessionId,
      timestamp: line.timestamp,
      isMeta: line.isMeta,
      slug: line.slug,
      message: line.message as SessionHistoryMessage['message'],
    };
  }

  /**
   * Load agent session files (agent-*.jsonl)
   */
  private async loadAgentSessions(
    sessionsDir: string,
    parentSessionId: string
  ): Promise<AgentSessionData[]> {
    const agentSessions: AgentSessionData[] = [];

    try {
      const files = await fs.readdir(sessionsDir);
      const agentFiles = files.filter(
        (f) => f.startsWith('agent-') && f.endsWith('.jsonl')
      );

      this.logger.info('[SessionHistoryReader] Scanning for agent files', {
        sessionsDir,
        parentSessionId,
        agentFilesFound: agentFiles.length,
      });

      for (const file of agentFiles) {
        const filePath = path.join(sessionsDir, file);
        const agentId = file.replace('.jsonl', '');

        try {
          const messages = await this.readJsonlMessages(filePath);

          // Check if this agent belongs to parent session by checking sessionId in first message
          // Agent files have sessionId pointing to their parent main session
          const firstMsg = messages[0];

          this.logger.debug('[SessionHistoryReader] Checking agent file', {
            file,
            firstMsgSessionId: firstMsg?.sessionId,
            parentSessionId,
            matches: firstMsg?.sessionId === parentSessionId,
          });

          if (firstMsg?.sessionId === parentSessionId) {
            agentSessions.push({
              agentId,
              filePath,
              messages,
            });
            this.logger.info('[SessionHistoryReader] Agent matched', {
              agentId,
              messageCount: messages.length,
            });
          }
        } catch {
          // Skip unreadable agent files
        }
      }

      this.logger.info('[SessionHistoryReader] Agent sessions loaded', {
        parentSessionId,
        agentSessionsLoaded: agentSessions.length,
        agentIds: agentSessions.map((s) => s.agentId),
      });
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
    mainMessages: SessionHistoryMessage[],
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
              eventIndex++,
              currentMessageTimestamp + messageSequence++ * 0.001
            )
          );
          currentMessageId = null;
          blockIndex = 0;
          messageSequence = 0; // Reset for new message
        }

        // Create user message events (user messages are self-contained, use local sequence)
        const messageId = msg.uuid || this.generateId();
        const content = this.extractTextContent(msg.message.content);
        const timestamp = msg.timestamp
          ? new Date(msg.timestamp).getTime()
          : Date.now();
        let userSeq = 0;

        events.push(
          this.createMessageStart(
            sessionId,
            messageId,
            'user',
            eventIndex++,
            timestamp + userSeq++ * 0.001
          )
        );
        if (content) {
          events.push(
            this.createTextDelta(
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
          this.createMessageComplete(
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
          currentMessageId = msg.uuid || this.generateId();
          currentMessageTimestamp = msgTimestamp;
          messageSequence = 0; // Reset sequence for new message
          events.push(
            this.createMessageStart(
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
                this.createTextDelta(
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
                this.createThinkingDelta(
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
                const toolCallId = block.id || this.generateId();

                events.push(
                  this.createToolStart(
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
                  this.createAgentStart(
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
                    currentMessageId,
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
                    this.createToolResult(
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
                // Regular tool
                events.push(
                  this.createToolStart(
                    sessionId,
                    currentMessageId,
                    block.id || this.generateId(),
                    block.name || 'unknown',
                    block.input,
                    eventIndex++,
                    currentMessageTimestamp + messageSequence++ * 0.001
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

    // Close final message
    if (currentMessageId) {
      events.push(
        this.createMessageComplete(
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
   * Process agent session messages and convert to nested events
   *
   * CRITICAL: Must create message_start/message_complete events for each assistant message
   * so the frontend's buildToolChildren can find them via parentToolUseId.
   */
  private processAgentMessages(
    sessionId: string,
    _parentMessageId: string, // Unused - each agent message gets its own ID
    parentToolUseId: string,
    messages: SessionHistoryMessage[],
    parentTimestamp: number
  ): FlatStreamEventUnion[] {
    const events: FlatStreamEventUnion[] = [];
    let eventIndex = 0;
    // Use micro-offsets for nested events to preserve order within agent
    let sequence = 0;

    // Extract tool results from agent messages
    const toolResults = this.extractAllToolResults(messages);

    for (const msg of messages) {
      if (msg.type !== 'assistant' || !msg.message?.content) continue;

      const content = msg.message.content;
      if (!Array.isArray(content)) continue;

      // Generate unique message ID for this agent message
      const agentMessageId = `agent_msg_${eventIndex}_${Math.floor(
        parentTimestamp
      )}`;
      const messageTimestamp = parentTimestamp + sequence++ * 0.0001;
      let blockIndex = 0;

      // Create message_start for this agent message (CRITICAL for frontend detection)
      events.push({
        eventType: 'message_start',
        id: `evt_agent_${eventIndex++}_${Math.floor(messageTimestamp)}`,
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
            id: `evt_agent_${eventIndex++}_${Math.floor(eventTimestamp)}`,
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
            id: `evt_agent_${eventIndex++}_${Math.floor(eventTimestamp)}`,
            sessionId,
            messageId: agentMessageId,
            parentToolUseId,
            toolCallId: block.id || this.generateId(),
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
              id: `evt_agent_${eventIndex++}_${Math.floor(resultTimestamp)}`,
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
        id: `evt_agent_${eventIndex++}_${Math.floor(completeTimestamp)}`,
        sessionId,
        messageId: agentMessageId,
        parentToolUseId,
        timestamp: completeTimestamp,
        source: 'history',
      } as MessageCompleteEvent);
    }

    return events;
  }

  // ==========================================================================
  // CORRELATION HELPERS (Ported from SessionReplayService)
  // ==========================================================================

  private buildAgentDataMap(agentSessions: AgentSessionData[]): Map<
    string,
    {
      agentId: string;
      timestamp: number;
      executionMessages: SessionHistoryMessage[];
    }
  > {
    const map = new Map<
      string,
      {
        agentId: string;
        timestamp: number;
        executionMessages: SessionHistoryMessage[];
      }
    >();

    for (const agent of agentSessions) {
      let slug: string | null = null;
      let timestamp: number | null = null;

      for (const msg of agent.messages) {
        if (msg.slug && !slug) slug = msg.slug;
        // Only extract timestamp from first message that has it
        if (msg.timestamp && timestamp === null) {
          timestamp = new Date(msg.timestamp).getTime();
        }
      }

      // Default to current time if no timestamp found
      if (timestamp === null) {
        timestamp = Date.now();
      }

      // Filter warmup agents by checking first message content
      // Warmup agents have first user message content = "Warmup"
      // Real agents have first user message content = actual task prompt
      const firstMsg = agent.messages[0];
      // Cast to unknown first since actual JSONL format has string content for user messages
      // but the JSONLMessage type expects ContentBlock[]
      const msgContent = firstMsg?.message?.content as unknown;
      let firstMsgContent = '';
      if (typeof msgContent === 'string') {
        firstMsgContent = msgContent.trim().toLowerCase();
      }
      const isWarmupAgent = firstMsgContent === 'warmup';

      if (isWarmupAgent) {
        this.logger.debug('[SessionHistoryReader] Skipping warmup agent', {
          agentId: agent.agentId,
          messageCount: agent.messages.length,
          firstMsgContent: firstMsgContent.substring(0, 50),
        });
        continue;
      }

      map.set(agent.agentId, {
        agentId: agent.agentId,
        timestamp,
        executionMessages: agent.messages,
      });

      this.logger.debug('[SessionHistoryReader] Agent added to map', {
        agentId: agent.agentId,
        messageCount: agent.messages.length,
        hasSlug: !!slug,
      });
    }

    this.logger.info('[SessionHistoryReader] Agent data map built', {
      totalAgents: map.size,
    });

    return map;
  }

  private extractTaskToolUses(
    messages: SessionHistoryMessage[]
  ): Array<{ toolUseId: string; timestamp: number; subagentType: string }> {
    const tasks: Array<{
      toolUseId: string;
      timestamp: number;
      subagentType: string;
    }> = [];

    for (const msg of messages) {
      if (msg.type !== 'assistant' || !msg.message?.content) continue;

      const timestamp = msg.timestamp
        ? new Date(msg.timestamp).getTime()
        : Date.now();

      const content = msg.message.content;
      if (!Array.isArray(content)) continue;

      for (const block of content as ContentBlock[]) {
        if (block.type === 'tool_use' && block.name === 'Task' && block.id) {
          let subagentType = 'unknown';
          if (block.input && isTaskToolInput(block.input)) {
            subagentType = block.input.subagent_type;
          }
          tasks.push({
            toolUseId: block.id,
            timestamp,
            subagentType,
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

    this.logger.info('[SessionHistoryReader] Correlating agents to tasks', {
      taskCount: sortedTasks.length,
      agentCount: sortedAgents.length,
    });

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
        this.logger.info('[SessionHistoryReader] Task-Agent correlated', {
          toolUseId: task.toolUseId,
          agentId: bestMatch,
        });
      } else {
        this.logger.warn('[SessionHistoryReader] No agent for task', {
          toolUseId: task.toolUseId,
        });
      }
    }

    this.logger.info('[SessionHistoryReader] Correlation complete', {
      correlationsFound: map.size,
    });

    return map;
  }

  private extractAllToolResults(
    messages: SessionHistoryMessage[]
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
      id: `evt_${index}_${timestamp}`,
      sessionId,
      messageId,
      role,
      timestamp,
      source: 'history',
    };
  }

  private createTextDelta(
    sessionId: string,
    messageId: string,
    text: string,
    blockIndex: number,
    index: number,
    timestamp: number
  ): TextDeltaEvent {
    return {
      eventType: 'text_delta',
      id: `evt_${index}_${timestamp}`,
      sessionId,
      messageId,
      blockIndex,
      delta: text,
      timestamp,
      source: 'history',
    };
  }

  private createThinkingDelta(
    sessionId: string,
    messageId: string,
    thinking: string,
    blockIndex: number,
    index: number,
    timestamp: number
  ): ThinkingDeltaEvent {
    return {
      eventType: 'thinking_delta',
      id: `evt_${index}_${timestamp}`,
      sessionId,
      messageId,
      blockIndex,
      delta: thinking,
      timestamp,
      source: 'history',
    };
  }

  private createToolStart(
    sessionId: string,
    messageId: string,
    toolCallId: string,
    toolName: string,
    toolInput: Record<string, unknown> | undefined,
    index: number,
    timestamp: number
  ): ToolStartEvent {
    return {
      eventType: 'tool_start',
      id: `evt_${index}_${timestamp}`,
      sessionId,
      messageId,
      toolCallId,
      toolName,
      toolInput,
      isTaskTool: toolName === 'Task',
      timestamp,
      source: 'history',
    };
  }

  private createAgentStart(
    sessionId: string,
    messageId: string,
    toolCallId: string,
    input: Record<string, unknown>,
    index: number,
    timestamp: number,
    parentToolUseId?: string
  ): AgentStartEvent {
    let agentType = 'unknown';
    let agentDescription: string | undefined;
    let agentPrompt: string | undefined;

    if (isTaskToolInput(input)) {
      agentType = input.subagent_type;
      agentDescription = input.description;
      agentPrompt = input.prompt;
    }

    return {
      eventType: 'agent_start',
      id: `evt_${index}_${timestamp}`,
      sessionId,
      messageId,
      toolCallId,
      agentType,
      agentDescription,
      agentPrompt,
      timestamp,
      parentToolUseId,
      source: 'history',
    };
  }

  private createToolResult(
    sessionId: string,
    messageId: string,
    toolCallId: string,
    output: string,
    isError: boolean,
    index: number,
    timestamp: number
  ): ToolResultEvent {
    return {
      eventType: 'tool_result',
      id: `evt_${index}_${timestamp}`,
      sessionId,
      messageId,
      toolCallId,
      output,
      isError,
      timestamp,
      source: 'history',
    };
  }

  private createMessageComplete(
    sessionId: string,
    messageId: string,
    index: number,
    timestamp: number
  ): MessageCompleteEvent {
    return {
      eventType: 'message_complete',
      id: `evt_${index}_${timestamp}`,
      sessionId,
      messageId,
      timestamp,
      source: 'history',
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
