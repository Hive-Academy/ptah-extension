import { Injectable, inject } from '@angular/core';
import {
  ExecutionNode,
  ExecutionChatMessage,
  JSONLMessage,
  AgentInfo,
  createExecutionNode,
  createExecutionChatMessage,
} from '@ptah-extension/shared';
import { ExecutionTreeBuilder } from './tree-builder.service';
import {
  AgentSessionData,
  ClassifiedAgentMessages,
  NodeMaps,
} from './chat.types';

/**
 * SessionReplayService - Reconstructs chat history from JSONL session files
 *
 * Single Responsibility: Parse and reconstruct historical sessions
 *
 * Key Features:
 * - Converts raw JSONL messages to ExecutionChatMessage format
 * - Groups agent sessions by agentId (each agent file = separate bubble)
 * - Correlates agents to Task tool_use via timestamp proximity
 * - Links tool_use to tool_result
 * - Filters warmup/internal agents (no slug = warmup)
 * - Builds execution trees from historical data
 * - Returns NodeMaps for bridging to streaming
 *
 * IMPORTANT: Slug is SESSION-scoped, NOT agent-scoped!
 * All agents in a session share the same slug, so we must use agentId for grouping.
 *
 * Complexity Level: 3 (Complex - agent grouping, timestamp correlation, multi-pass processing)
 *
 * Architecture Pattern: Stateless Service
 * - Pure functions only
 * - No internal state
 * - Injects ExecutionTreeBuilder for tree operations
 *
 * @example
 * ```typescript
 * const result = replayService.replaySession(mainMessages, agentSessions);
 * // Returns: { messages: ExecutionChatMessage[], nodeMaps: NodeMaps }
 * ```
 */
@Injectable({ providedIn: 'root' })
export class SessionReplayService {
  private readonly treeBuilder = inject(ExecutionTreeBuilder);

  /**
   * Replay session messages from JSONL format to ExecutionChatMessage format
   *
   * This processes the raw JSONL messages from Claude CLI sessions and
   * reconstructs them as displayable chat messages with execution trees.
   *
   * KEY INSIGHT: Slug is SESSION-scoped, not agent-scoped!
   * All agents in a session share the same slug, so we group by agentId instead.
   * Each agent file becomes a separate bubble, matched to its parent Task via timestamp.
   *
   * The returned NodeMaps contain references to all agents and tools, enabling
   * streaming messages to connect to historical nodes when resuming a session.
   *
   * @param mainMessages - Messages from the main session file
   * @param agentSessions - Linked agent sessions with their messages
   * @returns Object containing processed messages and node maps
   */
  replaySession(
    mainMessages: JSONLMessage[],
    agentSessions: AgentSessionData[]
  ): { messages: ExecutionChatMessage[]; nodeMaps: NodeMaps } {
    const chatMessages: ExecutionChatMessage[] = [];
    const nodeMaps: NodeMaps = {
      agents: new Map<string, ExecutionNode>(),
      tools: new Map<string, ExecutionNode>(),
    };

    // PHASE 1: Process agent sessions by agentId (NOT slug!)
    // Each agent file becomes a separate entry, regardless of slug
    const agentDataMap = this.buildAgentDataMap(agentSessions);

    // PHASE 2: Extract Task tool_use info from main session for correlation
    const taskToolUses = this.extractTaskToolUses(mainMessages);

    // PHASE 3: Correlate agents to Task tool_uses via timestamp proximity
    const taskToAgentMap = this.correlateAgentsToTasks(
      taskToolUses,
      agentDataMap
    );

    // PHASE 4: Pre-scan for tool_results to detect interrupted agents
    const taskToolResults = this.extractTaskToolResults(mainMessages);

    // PHASE 4.5: Extract ALL tool results with content for linking to tool nodes
    const allToolResults = this.extractAllToolResults(mainMessages);

    console.log('[SessionReplayService] Replay session - agent processing', {
      mainMessagesCount: mainMessages.length,
      totalAgentSessions: agentSessions.length,
      validAgents: agentDataMap.size,
      taskToolUses: taskToolUses.length,
      correlatedTasks: taskToAgentMap.size,
      taskToolResults: taskToolResults.size,
      allToolResults: allToolResults.size,
    });

    // PHASE 5: Process main messages and create chat bubbles
    let currentAssistantTree: ExecutionNode | null = null;
    let currentAssistantId: string | null = null;

    for (const msg of mainMessages) {
      const rawMsg = msg as any;

      // Skip non-message types
      if (!msg.type || !['user', 'assistant'].includes(msg.type)) {
        continue;
      }

      if (msg.type === 'user' && msg.message?.content) {
        // Skip system/meta messages
        if (rawMsg.isMeta === true) continue;

        // Skip tool_result messages
        const contentRaw = msg.message.content;
        if (
          Array.isArray(contentRaw) &&
          contentRaw.length > 0 &&
          contentRaw[0]?.type === 'tool_result'
        ) {
          continue;
        }

        // Finalize pending assistant message
        if (currentAssistantTree && currentAssistantId) {
          chatMessages.push(
            this.createAssistantMessageFromTree(
              currentAssistantTree,
              currentAssistantId
            )
          );
          currentAssistantTree = null;
          currentAssistantId = null;
        }

        // Create user message
        const content = this.extractTextContent(msg.message.content);
        if (content) {
          chatMessages.push(
            createExecutionChatMessage({
              id: rawMsg.uuid || this.generateId(),
              role: 'user',
              rawContent: content,
              sessionId: rawMsg.sessionId || msg.session_id,
              timestamp: rawMsg.timestamp
                ? new Date(rawMsg.timestamp).getTime()
                : undefined,
            })
          );
        }
      } else if (msg.type === 'assistant' && msg.message?.content) {
        // Initialize assistant tree if needed
        if (!currentAssistantTree) {
          currentAssistantId = rawMsg.uuid || this.generateId();
          currentAssistantTree = createExecutionNode({
            id: currentAssistantId!,
            type: 'message',
            status: 'complete',
          });
        }

        // Collect Task blocks for separate agent bubbles
        const agentBlocks: Array<{ block: any; agentId: string | null }> = [];

        for (const block of msg.message.content) {
          if (block.type === 'text' && block.text) {
            currentAssistantTree = {
              ...currentAssistantTree,
              children: [
                ...currentAssistantTree.children,
                createExecutionNode({
                  id: this.generateId(),
                  type: 'text',
                  status: 'complete',
                  content: block.text,
                }),
              ],
            };
          } else if (block.type === 'tool_use') {
            if (block.name === 'Task' && block.input) {
              // Find correlated agent for this Task
              const agentId = block.id
                ? taskToAgentMap.get(block.id) || null
                : null;
              agentBlocks.push({ block, agentId });
            } else {
              // Regular tool - add to assistant tree
              // Look up the tool result by tool_use_id
              const toolResult = block.id
                ? allToolResults.get(block.id)
                : undefined;

              const toolNode = createExecutionNode({
                id: block.id || this.generateId(),
                type: 'tool',
                status: toolResult?.isError ? 'error' : 'complete',
                toolName: block.name,
                toolInput: block.input,
                toolOutput: toolResult?.content,
                toolCallId: block.id,
                isCollapsed: true,
              });

              if (block.id) {
                nodeMaps.tools.set(block.id, toolNode);
              }

              currentAssistantTree = {
                ...currentAssistantTree,
                children: [...currentAssistantTree.children, toolNode],
              };
            }
          }
        }

        // Finalize assistant tree before agent bubbles
        if (
          currentAssistantTree.children.length > 0 &&
          agentBlocks.length > 0
        ) {
          chatMessages.push(
            this.createAssistantMessageFromTree(
              currentAssistantTree,
              currentAssistantId!
            )
          );
          currentAssistantId = this.generateId();
          currentAssistantTree = createExecutionNode({
            id: currentAssistantId,
            type: 'message',
            status: 'complete',
          });
        }

        // Create separate bubble for each agent
        for (const { block, agentId } of agentBlocks) {
          const agentMessage = this.createAgentBubble(
            block,
            agentId,
            agentDataMap,
            taskToolResults,
            nodeMaps
          );
          chatMessages.push(agentMessage);
        }
      }
    }

    // Finalize remaining assistant message
    if (
      currentAssistantTree &&
      currentAssistantId &&
      currentAssistantTree.children.length > 0
    ) {
      chatMessages.push(
        this.createAssistantMessageFromTree(
          currentAssistantTree,
          currentAssistantId
        )
      );
    }

    console.log('[SessionReplayService] Replay complete', {
      messagesGenerated: chatMessages.length,
      agentsRegistered: nodeMaps.agents.size,
      toolsRegistered: nodeMaps.tools.size,
    });

    return { messages: chatMessages, nodeMaps };
  }

  /**
   * Build a map of agentId → agent data from agent sessions.
   * Filters out warmup agents (no slug).
   */
  private buildAgentDataMap(agentSessions: AgentSessionData[]): Map<
    string,
    {
      agentId: string;
      timestamp: number;
      summaryContent: string | null;
      executionMessages: JSONLMessage[];
    }
  > {
    const agentDataMap = new Map<
      string,
      {
        agentId: string;
        timestamp: number;
        summaryContent: string | null;
        executionMessages: JSONLMessage[];
      }
    >();

    for (const agent of agentSessions) {
      // Find slug from any message
      let slug: string | null = null;
      let timestamp: number = Date.now();

      for (const msg of agent.messages) {
        const rawMsg = msg as any;
        if (rawMsg.slug && !slug) {
          slug = rawMsg.slug;
        }
        if (rawMsg.timestamp && timestamp === Date.now()) {
          timestamp = new Date(rawMsg.timestamp).getTime();
        }
      }

      // Filter out warmup agents (no slug)
      if (!slug) {
        continue;
      }

      // Extract content
      const { summaryContent, executionMessages } = this.classifyAgentMessages(
        agent.messages
      );

      agentDataMap.set(agent.agentId, {
        agentId: agent.agentId,
        timestamp,
        summaryContent,
        executionMessages,
      });
    }

    return agentDataMap;
  }

  /**
   * Extract Task tool_use blocks from main session with their timestamps.
   */
  private extractTaskToolUses(
    mainMessages: JSONLMessage[]
  ): Array<{ toolUseId: string; timestamp: number; subagentType: string }> {
    const taskToolUses: Array<{
      toolUseId: string;
      timestamp: number;
      subagentType: string;
    }> = [];

    for (const msg of mainMessages) {
      const rawMsg = msg as any;
      if (msg.type !== 'assistant' || !msg.message?.content) continue;

      const timestamp = rawMsg.timestamp
        ? new Date(rawMsg.timestamp).getTime()
        : Date.now();

      for (const block of msg.message.content) {
        if (block.type === 'tool_use' && block.name === 'Task' && block.id) {
          taskToolUses.push({
            toolUseId: block.id,
            timestamp,
            subagentType:
              (block.input?.['subagent_type'] as string) || 'unknown',
          });
        }
      }
    }

    return taskToolUses;
  }

  /**
   * Correlate agents to Task tool_uses via timestamp proximity.
   * Returns a map of toolUseId → agentId.
   */
  private correlateAgentsToTasks(
    taskToolUses: Array<{
      toolUseId: string;
      timestamp: number;
      subagentType: string;
    }>,
    agentDataMap: Map<
      string,
      {
        agentId: string;
        timestamp: number;
        summaryContent: string | null;
        executionMessages: JSONLMessage[];
      }
    >
  ): Map<string, string> {
    const taskToAgentMap = new Map<string, string>();
    const usedAgents = new Set<string>();

    // Sort tasks by timestamp
    const sortedTasks = [...taskToolUses].sort(
      (a, b) => a.timestamp - b.timestamp
    );

    // Sort agents by timestamp
    const sortedAgents = [...agentDataMap.values()].sort(
      (a, b) => a.timestamp - b.timestamp
    );

    // Match each task to the closest agent that starts after it
    for (const task of sortedTasks) {
      let bestMatch: string | null = null;
      let bestTimeDiff = Infinity;

      for (const agent of sortedAgents) {
        if (usedAgents.has(agent.agentId)) continue;

        // Agent should start after or around the same time as task
        const timeDiff = agent.timestamp - task.timestamp;

        // Allow agents that start within 60 seconds after the task
        // (agents spawn shortly after Task tool_use)
        if (timeDiff >= -1000 && timeDiff < bestTimeDiff && timeDiff < 60000) {
          bestTimeDiff = timeDiff;
          bestMatch = agent.agentId;
        }
      }

      if (bestMatch) {
        taskToAgentMap.set(task.toolUseId, bestMatch);
        usedAgents.add(bestMatch);
      }
    }

    return taskToAgentMap;
  }

  /**
   * Extract tool_result IDs for Task tools to detect completion status.
   */
  private extractTaskToolResults(mainMessages: JSONLMessage[]): Set<string> {
    const taskToolResults = new Set<string>();

    for (const msg of mainMessages) {
      if (msg.type === 'user' && msg.message?.content) {
        for (const block of msg.message.content) {
          if (block.type === 'tool_result' && block.tool_use_id) {
            taskToolResults.add(block.tool_use_id);
          }
        }
      }
    }

    return taskToolResults;
  }

  /**
   * Extract ALL tool results with their content from main messages.
   * Maps tool_use_id to the result content string.
   *
   * This is used to link tool_use blocks to their corresponding tool_result
   * outputs when replaying a session.
   */
  private extractAllToolResults(
    mainMessages: JSONLMessage[]
  ): Map<string, { content: string; isError: boolean }> {
    const toolResults = new Map<
      string,
      { content: string; isError: boolean }
    >();

    for (const msg of mainMessages) {
      if (msg.type === 'user' && msg.message?.content) {
        for (const block of msg.message.content) {
          if (block.type === 'tool_result' && block.tool_use_id) {
            const content = block.content;
            const isError = block.is_error === true;
            let resultText = '';

            if (typeof content === 'string') {
              resultText = content;
            } else if (Array.isArray(content)) {
              // Handle array content (text blocks)
              resultText = content
                .filter((c: any) => c.type === 'text')
                .map((c: any) => c.text || '')
                .join('\n');
            }

            toolResults.set(block.tool_use_id, {
              content: resultText,
              isError,
            });
          }
        }
      }
    }

    console.log('[SessionReplayService] extractAllToolResults', {
      resultsFound: toolResults.size,
    });

    return toolResults;
  }

  /**
   * Create an agent chat bubble from a Task tool_use block.
   */
  private createAgentBubble(
    block: any,
    agentId: string | null,
    agentDataMap: Map<
      string,
      {
        agentId: string;
        timestamp: number;
        summaryContent: string | null;
        executionMessages: JSONLMessage[];
      }
    >,
    taskToolResults: Set<string>,
    nodeMaps: NodeMaps
  ): ExecutionChatMessage {
    const agentType = block.input?.['subagent_type'] as string;
    const agentDescription = block.input?.['description'] as string;
    const agentModel = block.input?.['model'] as string | undefined;

    // Get agent data if correlated
    const agentData = agentId ? agentDataMap.get(agentId) : null;
    const summaryContent = agentData?.summaryContent || null;
    const executionMessages = agentData?.executionMessages || [];

    // Build execution nodes
    const executionNodes =
      executionMessages.length > 0
        ? this.processAgentExecutionMessages(executionMessages, nodeMaps)
        : [];

    const agentExecutionTree = createExecutionNode({
      id: block.id || this.generateId(),
      type: 'message',
      status: 'complete',
      children: executionNodes,
    });

    // Register in nodeMaps
    if (block.id) {
      nodeMaps.agents.set(
        block.id,
        createExecutionNode({
          id: block.id,
          type: 'agent',
          status: 'complete',
          agentType,
          agentModel,
          agentDescription,
          toolCallId: block.id,
          children: executionNodes,
        })
      );
    }

    // Determine interrupted status
    const hasToolResult = block.id ? taskToolResults.has(block.id) : false;
    const hasNoData = !summaryContent && executionNodes.length === 0;
    const isInterrupted = hasNoData && !hasToolResult;

    const agentInfo: AgentInfo = {
      agentType,
      agentDescription,
      agentModel,
      summaryContent: summaryContent || undefined,
      hasSummary: !!summaryContent,
      hasExecution: executionNodes.length > 0,
      isInterrupted,
      // NEW: Add toolUseId for consistency with streaming agent bubbles
      toolUseId: block.id || undefined,
      isStreaming: false, // Replay is never streaming
    };

    return createExecutionChatMessage({
      id: block.id || this.generateId(),
      role: 'assistant',
      executionTree: agentExecutionTree,
      agentInfo,
    });
  }

  /**
   * Extract content from agent messages.
   *
   * This method extracts:
   * - Summary content: ALL text blocks from messages (no filtering by format)
   * - Execution messages: Messages with tool_use blocks AND their tool_result responses
   *
   * The caller determines whether an agent is "summary" or "execution" based on
   * whether it has tool_use blocks. This method just extracts the content.
   *
   * @param messages - Raw JSONL messages from an agent session
   * @returns Object with summary text and execution messages
   *
   * @example
   * ```typescript
   * const { summaryContent, executionMessages } =
   *   replayService.classifyAgentMessages(agentMessages);
   * ```
   */
  private classifyAgentMessages(
    messages: JSONLMessage[]
  ): ClassifiedAgentMessages {
    const summaryTexts: string[] = [];
    const executionMessages: JSONLMessage[] = [];

    for (const msg of messages) {
      // Tool results come as type: "user" messages - include them in execution
      if (msg.type === 'user' && msg.message?.content) {
        const hasToolResult = msg.message.content.some(
          (b: any) => b.type === 'tool_result'
        );
        if (hasToolResult) {
          executionMessages.push(msg);
        }
        continue;
      }

      if (msg.type !== 'assistant' || !msg.message?.content) continue;

      // Extract text blocks
      const textBlocks = msg.message.content.filter(
        (b: any) => b.type === 'text' && b.text
      );
      const toolBlocks = msg.message.content.filter(
        (b: any) => b.type === 'tool_use'
      );

      // Collect ALL text content as potential summary
      // (no filtering by XML format - UI should handle any text format)
      for (const textBlock of textBlocks) {
        const text = textBlock.text || '';
        if (text.trim()) {
          summaryTexts.push(text);
        }
      }

      // If the message has tool_use blocks, it's execution content
      if (toolBlocks.length > 0) {
        executionMessages.push(msg);
      }
    }

    return {
      summaryContent:
        summaryTexts.length > 0 ? summaryTexts.join('\n\n') : null,
      executionMessages,
    };
  }

  /**
   * Process agent execution messages into ExecutionNode children.
   * Links tool_use calls with their tool_result outputs by tool_use_id.
   *
   * Tools are collapsed by default to keep the view compact.
   *
   * Also registers tool nodes in nodeMaps for streaming bridge.
   *
   * @param messages - JSONL messages containing tool_use and tool_result blocks
   * @param nodeMaps - Node maps to register tool nodes for streaming bridge
   * @returns Array of ExecutionNode representing tool executions
   *
   * @example
   * ```typescript
   * const nodes = replayService.processAgentExecutionMessages(
   *   executionMessages,
   *   nodeMaps
   * );
   * ```
   */
  private processAgentExecutionMessages(
    messages: JSONLMessage[],
    nodeMaps: NodeMaps
  ): readonly ExecutionNode[] {
    // First pass: collect all tool results by their tool_use_id
    const toolResults = new Map<string, string>();

    for (const msg of messages) {
      // Tool results come as type: "user" messages with tool_result content
      if (msg.type === 'user' && msg.message?.content) {
        for (const block of msg.message.content) {
          if (block.type === 'tool_result' && block.tool_use_id) {
            // Extract the result content
            const content = block.content;
            if (typeof content === 'string') {
              toolResults.set(block.tool_use_id, content);
            } else if (Array.isArray(content)) {
              // Handle array content (text blocks)
              const textContent = content
                .filter((c: any) => c.type === 'text')
                .map((c: any) => c.text || '')
                .join('\n');
              toolResults.set(block.tool_use_id, textContent);
            }
          }
        }
      }
    }

    // Second pass: create tool nodes with linked results
    const nodes: ExecutionNode[] = [];
    let toolsWithOutput = 0;
    let toolsWithoutOutput = 0;

    for (const msg of messages) {
      if (msg.type === 'assistant' && msg.message?.content) {
        for (const block of msg.message.content) {
          if (block.type === 'tool_use') {
            const toolId = block.id || this.generateId();
            const toolOutput = block.id ? toolResults.get(block.id) : undefined;

            if (toolOutput) {
              toolsWithOutput++;
            } else {
              toolsWithoutOutput++;
            }

            const toolNode = createExecutionNode({
              id: toolId,
              type: 'tool',
              status: 'complete',
              toolName: block.name,
              toolInput: block.input,
              toolOutput: toolOutput,
              toolCallId: block.id,
              isCollapsed: true,
            });

            // Register in nodeMaps for streaming bridge
            if (block.id) {
              nodeMaps.tools.set(block.id, toolNode);
            }

            nodes.push(toolNode);
          }
        }
      }
    }

    console.log('[SessionReplayService] processAgentExecutionMessages', {
      inputMessages: messages.length,
      toolResultsCollected: toolResults.size,
      toolNodesCreated: nodes.length,
      toolsWithOutput,
      toolsWithoutOutput,
    });

    console.log('[SessionReplayService] Agent execution messages processed', {
      inputMessages: messages.length,
      toolResultsFound: toolResults.size,
      outputNodes: nodes.length,
    });

    return nodes;
  }

  /**
   * Extract text content from message content (handles both string and array formats)
   *
   * @param content - Raw content from JSONL message (string or array of content blocks)
   * @returns Extracted text content
   *
   * @example
   * ```typescript
   * const text = replayService.extractTextContent('Hello world');
   * // Returns: 'Hello world'
   *
   * const text2 = replayService.extractTextContent([
   *   { type: 'text', text: 'Line 1' },
   *   { type: 'text', text: 'Line 2' }
   * ]);
   * // Returns: 'Line 1\nLine 2'
   * ```
   */
  private extractTextContent(content: unknown): string {
    if (typeof content === 'string') {
      return content;
    }
    if (Array.isArray(content)) {
      return content
        .filter((b: any) => b.type === 'text')
        .map((b: any) => b.text || '')
        .join('\n');
    }
    return '';
  }

  /**
   * Create an ExecutionChatMessage from an execution tree
   *
   * @param tree - Execution tree root node
   * @param messageId - Unique message identifier
   * @returns ExecutionChatMessage ready for display
   *
   * @example
   * ```typescript
   * const message = replayService.createAssistantMessageFromTree(tree, 'msg_123');
   * ```
   */
  private createAssistantMessageFromTree(
    tree: ExecutionNode,
    messageId: string
  ): ExecutionChatMessage {
    return createExecutionChatMessage({
      id: messageId,
      role: 'assistant',
      executionTree: tree,
    });
  }

  /**
   * Generate a unique ID for messages and nodes
   *
   * Uses timestamp + random string for uniqueness.
   * Format: `msg_${timestamp}_${random7chars}`
   *
   * @returns Unique ID string
   */
  private generateId(): string {
    return `msg_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  }
}
