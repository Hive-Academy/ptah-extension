import { Injectable, inject } from '@angular/core';
import {
  ExecutionNode,
  ExecutionChatMessage,
  JSONLMessage,
  createExecutionNode,
  createExecutionChatMessage,
  calculateMessageCost,
} from '@ptah-extension/shared';
import { ExecutionTreeBuilder } from './tree-builder.service';
import { AgentSessionData, NodeMaps } from './chat.types';

/**
 * SessionReplayService - Reconstructs chat history from JSONL session files
 *
 * Single Responsibility: Parse and reconstruct historical sessions
 *
 * Key Features:
 * - Converts raw JSONL messages to ExecutionChatMessage format
 * - Groups agent sessions by agentId and correlates to parent Task tool_use
 * - Builds UNIFIED execution trees matching the streaming representation
 * - Agents are INLINE nodes (type: 'agent') within the assistant message tree
 * - Agent children are INTERLEAVED (text + tools in chronological order)
 * - Links tool_use to tool_result for complete execution data
 * - Filters warmup/internal agents (no slug = warmup)
 * - Returns NodeMaps for bridging to streaming
 *
 * IMPORTANT: This service produces the SAME ExecutionNode structure as
 * the SDK streaming path, ensuring visual consistency between loaded sessions
 * and live streaming.
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
    let currentAssistantUsage:
      | { input_tokens?: number; output_tokens?: number }
      | undefined;
    let currentAssistantModel: string | undefined;

    for (const msg of mainMessages) {
      const rawMsg = msg;

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

        // Finalize pending assistant message with usage data
        if (currentAssistantTree && currentAssistantId) {
          chatMessages.push(
            this.createAssistantMessageFromTree(
              currentAssistantTree,
              currentAssistantId,
              currentAssistantUsage,
              currentAssistantModel
            )
          );
          currentAssistantTree = null;
          currentAssistantId = null;
          currentAssistantUsage = undefined;
          currentAssistantModel = undefined;
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

        // Capture usage and model from each assistant message (last one will have final counts)
        if (msg.message.usage) {
          currentAssistantUsage = msg.message.usage;
          console.log(
            '[SessionReplay] 📊 Captured usage from assistant message:',
            {
              input: msg.message.usage.input_tokens,
              output: msg.message.usage.output_tokens,
            }
          );
        }
        if (msg.message.model) {
          currentAssistantModel = msg.message.model;
          console.log(
            '[SessionReplay] 🤖 Captured model:',
            currentAssistantModel
          );
        }

        // Process all content blocks and add to the assistant tree
        // Agents are added INLINE (not as separate bubbles) to match streaming behavior
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
              // Task tool = Agent spawn - add INLINE to assistant tree (matching streaming)
              const agentId = block.id
                ? taskToAgentMap.get(block.id) || null
                : null;

              // Build interleaved agent children from the agent session data
              const agentNode = this.createInlineAgentNode(
                block,
                agentId,
                agentDataMap,
                taskToolResults,
                nodeMaps
              );

              currentAssistantTree = {
                ...currentAssistantTree,
                children: [...currentAssistantTree.children, agentNode],
              };
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
      }
    }

    // Finalize remaining assistant message with usage data
    if (
      currentAssistantTree &&
      currentAssistantId &&
      currentAssistantTree.children.length > 0
    ) {
      chatMessages.push(
        this.createAssistantMessageFromTree(
          currentAssistantTree,
          currentAssistantId,
          currentAssistantUsage,
          currentAssistantModel
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
   *
   * Now stores ALL messages (not separated into summary/execution) for
   * interleaved timeline processing.
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

      // Store ALL messages for interleaved processing
      // (buildInterleavedAgentChildren will process them in order)
      agentDataMap.set(agent.agentId, {
        agentId: agent.agentId,
        timestamp,
        summaryContent: null, // No longer used - interleaved timeline instead
        executionMessages: agent.messages, // ALL messages, not filtered
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
   * Create an INLINE agent ExecutionNode from a Task tool_use block.
   *
   * Unlike the old createAgentBubble (which created separate chat messages),
   * this creates an ExecutionNode of type 'agent' that gets added as a child
   * of the main assistant message tree - matching how streaming works.
   *
   * The agent's children are built as an INTERLEAVED timeline of text + tool nodes
   * in chronological order, rather than separating into Summary/Execution sections.
   */
  private createInlineAgentNode(
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
  ): ExecutionNode {
    const agentType = block.input?.['subagent_type'] as string;
    const agentDescription = block.input?.['description'] as string;
    const agentModel = block.input?.['model'] as string | undefined;

    // Get agent data if correlated
    const agentData = agentId ? agentDataMap.get(agentId) : null;
    const agentMessages = agentData?.executionMessages || [];

    // Build INTERLEAVED children (text + tools in chronological order)
    // This processes ALL agent messages in order, creating a unified timeline
    const interleavedChildren = this.buildInterleavedAgentChildren(
      agentMessages,
      nodeMaps
    );

    // Create the agent node with interleaved children
    const agentNode = createExecutionNode({
      id: block.id || this.generateId(),
      type: 'agent',
      status: 'complete',
      agentType,
      agentModel,
      agentDescription,
      toolCallId: block.id,
      children: interleavedChildren,
    });

    // Register in nodeMaps for streaming bridge
    if (block.id) {
      nodeMaps.agents.set(block.id, agentNode);
    }

    console.log('[SessionReplayService] Created inline agent node', {
      agentId: block.id,
      agentType,
      childrenCount: interleavedChildren.length,
      textNodes: interleavedChildren.filter((c) => c.type === 'text').length,
      toolNodes: interleavedChildren.filter((c) => c.type === 'tool').length,
    });

    return agentNode;
  }

  /**
   * Build interleaved agent children from JSONL messages.
   *
   * Processes messages in chronological order, creating:
   * - text nodes for assistant text content
   * - tool nodes for tool_use blocks (linked to their tool_result outputs)
   *
   * This creates a unified timeline that matches the streaming representation,
   * where the agent's thought process and tool calls are interleaved naturally.
   */
  private buildInterleavedAgentChildren(
    messages: JSONLMessage[],
    nodeMaps: NodeMaps
  ): readonly ExecutionNode[] {
    const children: ExecutionNode[] = [];

    // First pass: collect all tool results by their tool_use_id
    const toolResults = new Map<
      string,
      { content: string; isError: boolean }
    >();

    for (const msg of messages) {
      if (msg.type === 'user' && msg.message?.content) {
        for (const block of msg.message.content) {
          if (block.type === 'tool_result' && block.tool_use_id) {
            const content = block.content;
            const isError = block.is_error === true;
            let resultText = '';

            if (typeof content === 'string') {
              resultText = content;
            } else if (Array.isArray(content)) {
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

    // Second pass: process messages in order, creating interleaved children
    for (const msg of messages) {
      if (msg.type === 'assistant' && msg.message?.content) {
        for (const block of msg.message.content) {
          if (block.type === 'text' && block.text) {
            // Add text node
            children.push(
              createExecutionNode({
                id: this.generateId(),
                type: 'text',
                status: 'complete',
                content: block.text,
              })
            );
          } else if (block.type === 'tool_use') {
            // Add tool node with linked result
            const toolResult = block.id ? toolResults.get(block.id) : undefined;

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

            children.push(toolNode);
          }
        }
      }
    }

    return children;
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
   * Create an ExecutionChatMessage from an execution tree with usage metrics
   *
   * @param tree - Execution tree root node
   * @param messageId - Unique message identifier
   * @param usage - Token usage data from JSONL message
   * @param model - Model ID for cost calculation
   * @param duration - Message duration in ms
   * @returns ExecutionChatMessage ready for display
   *
   * @example
   * ```typescript
   * const message = replayService.createAssistantMessageFromTree(tree, 'msg_123', usage, 'claude-opus-4-5');
   * ```
   */
  private createAssistantMessageFromTree(
    tree: ExecutionNode,
    messageId: string,
    usage?: { input_tokens?: number; output_tokens?: number },
    model?: string,
    duration?: number
  ): ExecutionChatMessage {
    // Extract tokens and calculate cost if usage data is available
    let tokens:
      | { input: number; output: number; cacheHit?: number }
      | undefined;
    let cost: number | undefined;

    if (usage) {
      tokens = {
        input: usage.input_tokens ?? 0,
        output: usage.output_tokens ?? 0,
      };

      // Calculate cost using model ID
      try {
        const modelId = model ?? 'default';
        cost = calculateMessageCost(modelId, tokens);
      } catch (error) {
        console.error('[SessionReplay] Cost calculation failed', error);
      }
    }

    console.log('[SessionReplay] 📝 Creating assistant message:', {
      messageId,
      hasUsage: !!usage,
      hasTokens: !!tokens,
      tokens: tokens,
      cost: cost,
      model: model,
    });

    return createExecutionChatMessage({
      id: messageId,
      role: 'assistant',
      executionTree: tree,
      tokens,
      cost,
      duration,
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
