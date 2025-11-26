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
import { AgentSessionData, ClassifiedAgentMessages, NodeMaps } from './chat.types';

/**
 * SessionReplayService - Reconstructs chat history from JSONL session files
 *
 * Single Responsibility: Parse and reconstruct historical sessions
 *
 * Key Features:
 * - Converts raw JSONL messages to ExecutionChatMessage format
 * - Groups and classifies agent sessions by slug
 * - Links tool_use to tool_result
 * - Filters warmup/internal agents
 * - Builds execution trees from historical data
 * - Returns NodeMaps for bridging to streaming
 *
 * Complexity Level: 3 (Complex - agent grouping, slug classification, multi-pass processing)
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
   * SIMPLIFIED APPROACH: All agent sessions are combined and shown under the
   * first Task tool_use found. This is simpler and more reliable than trying
   * to match individual agents to individual Task tools by timestamp.
   *
   * The returned NodeMaps contain references to all agents and tools, enabling
   * streaming messages to connect to historical nodes when resuming a session.
   *
   * @param mainMessages - Messages from the main session file
   * @param agentSessions - Linked agent sessions with their messages
   * @returns Object containing processed messages and node maps
   *
   * @example
   * ```typescript
   * const result = replayService.replaySession(
   *   mainMessages,
   *   [{ agentId: 'agent_123', messages: [...] }]
   * );
   * chatStore.setMessages(result.messages);
   * chatStore.setNodeMaps(result.nodeMaps);
   * ```
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

    // Classify and group agent sessions by slug
    //
    // Agent classification rules (discovered via schema analysis):
    // 1. WARMUP agent: NO slug, NO tool_use - just initial response, filter out
    // 2. SUMMARY agent: HAS slug, NO tool_use - contains summarized text
    // 3. EXECUTION agent: HAS slug, HAS tool_use - contains actual tool calls
    //
    // Key insight: SUMMARY and EXECUTION agents with the SAME SLUG belong to the
    // SAME logical agent invocation. They should be merged together.
    //
    // The slug may appear on ANY message in the agent file (not always the first!)
    const slugToAgentData = new Map<
      string,
      { summaryContent: string | null; executionMessages: JSONLMessage[] }
    >();

    let warmupAgentsFiltered = 0;
    let summaryAgentsFound = 0;
    let executionAgentsFound = 0;

    for (const agent of agentSessions) {
      // Find the slug from ANY message in the agent session
      // (the slug may not appear on the first line!)
      let slug: string | null = null;
      for (const msg of agent.messages) {
        const rawMsg = msg as any;
        if (rawMsg.slug) {
          slug = rawMsg.slug;
          break;
        }
      }

      // Check if this agent has any tool_use blocks
      const hasToolUse = agent.messages.some((msg) => {
        const content = (msg as any).message?.content;
        if (!Array.isArray(content)) return false;
        return content.some((block: any) => block.type === 'tool_use');
      });

      // Classification logic
      if (!slug && !hasToolUse) {
        // WARMUP: No slug AND no tool_use - filter out
        warmupAgentsFiltered++;
        continue;
      }

      if (!slug && hasToolUse) {
        // Orphan execution (no slug but has tool_use) - shouldn't happen normally
        // but handle it by creating a placeholder slug
        console.warn('[SessionReplayService] Found execution agent without slug:', agent.agentId);
        slug = `__orphan_${agent.agentId}__`;
      }

      // Get or create data for this slug
      const existing = slugToAgentData.get(slug!) || {
        summaryContent: null,
        executionMessages: [],
      };

      if (hasToolUse) {
        // EXECUTION agent: Extract tool calls
        executionAgentsFound++;
        const { executionMessages } = this.classifyAgentMessages(agent.messages);
        existing.executionMessages.push(...executionMessages);
      } else {
        // SUMMARY agent: Extract summary text
        summaryAgentsFound++;
        const { summaryContent } = this.classifyAgentMessages(agent.messages);
        if (summaryContent && !existing.summaryContent) {
          existing.summaryContent = summaryContent;
        } else if (summaryContent && existing.summaryContent) {
          existing.summaryContent += '\n\n' + summaryContent;
        }
      }

      slugToAgentData.set(slug!, existing);
    }

    // Track whether we've already attached agents to a Task tool
    let agentsAttached = false;

    console.log('[SessionReplayService] Replay session - agent classification', {
      mainMessagesCount: mainMessages.length,
      totalAgentSessions: agentSessions.length,
      warmupAgentsFiltered,
      summaryAgentsFound,
      executionAgentsFound,
      uniqueSlugs: slugToAgentData.size,
      slugs: Array.from(slugToAgentData.keys()),
      slugDetails: Array.from(slugToAgentData.entries()).map(([slug, data]) => ({
        slug,
        hasSummary: !!data.summaryContent,
        summaryLength: data.summaryContent?.length ?? 0,
        executionMsgCount: data.executionMessages.length,
      })),
    });

    // Track current assistant message being built
    let currentAssistantTree: ExecutionNode | null = null;
    let currentAssistantId: string | null = null;

    for (const msg of mainMessages) {
      // Cast to any for flexible access to raw JSONL fields
      // JSONL from Claude CLI has more fields than our typed interface
      const rawMsg = msg as any;

      // Skip non-message types (queue-operation, file-history-snapshot, summary)
      if (!msg.type || !['user', 'assistant'].includes(msg.type)) {
        continue;
      }

      if (msg.type === 'user' && msg.message?.content) {
        // Skip isMeta messages - these are system-injected prompts, not user input
        if (rawMsg.isMeta === true) {
          continue;
        }

        // Skip tool_result messages (they come back as type: "user" but are tool responses)
        const content_raw = msg.message.content;
        if (
          Array.isArray(content_raw) &&
          content_raw.length > 0 &&
          content_raw[0]?.type === 'tool_result'
        ) {
          continue;
        }

        // Finalize any pending assistant message
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
          const userMessage = createExecutionChatMessage({
            id: rawMsg.uuid || this.generateId(),
            role: 'user',
            rawContent: content,
            sessionId: rawMsg.sessionId || msg.session_id,
            timestamp: rawMsg.timestamp
              ? new Date(rawMsg.timestamp).getTime()
              : undefined,
          });
          chatMessages.push(userMessage);
        }
      } else if (msg.type === 'assistant' && msg.message?.content) {
        // Start or continue assistant message
        if (!currentAssistantTree) {
          currentAssistantId = rawMsg.uuid || this.generateId();
          currentAssistantTree = createExecutionNode({
            id: currentAssistantId!,
            type: 'message',
            status: 'complete',
          });
        }

        // Process content blocks - collect agent blocks separately
        const agentBlocks: Array<{
          block: any;
          summaryContent: string | null;
          executionMessages: JSONLMessage[];
        }> = [];

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
            // Check if this is a Task tool (agent spawn)
            if (block.name === 'Task' && block.input) {
              // Get agent data from slug map - attach all agent data to first Task
              const hasAgentData = !agentsAttached && slugToAgentData.size > 0;

              // Combine all slug data for this first Task
              let combinedSummary: string | null = null;
              const combinedExecutionMessages: JSONLMessage[] = [];

              if (hasAgentData) {
                for (const [, data] of slugToAgentData) {
                  if (data.summaryContent) {
                    combinedSummary = combinedSummary
                      ? combinedSummary + '\n\n' + data.summaryContent
                      : data.summaryContent;
                  }
                  combinedExecutionMessages.push(...data.executionMessages);
                }
              }

              console.log('[SessionReplayService] Processing Task tool', {
                toolUseId: block.id,
                agentsAttached,
                hasAgentData,
                hasSummary: !!combinedSummary,
                executionMsgCount: combinedExecutionMessages.length,
              });

              // Collect agent blocks to create separate bubbles
              agentBlocks.push({
                block,
                summaryContent: hasAgentData ? combinedSummary : null,
                executionMessages: hasAgentData ? combinedExecutionMessages : [],
              });

              // Mark agents as attached so subsequent Task tools don't duplicate
              if (hasAgentData) {
                agentsAttached = true;
              }
            } else {
              // Regular tool use - stays in assistant message
              const toolNode = createExecutionNode({
                id: block.id || this.generateId(),
                type: 'tool',
                status: 'complete',
                toolName: block.name,
                toolInput: block.input,
                toolCallId: block.id,
                isCollapsed: true,
              });

              // Register in nodeMaps for streaming bridge
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

        // If we have text/tool content in the assistant tree, finalize it first
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
          // Start fresh tree for any content after agents
          currentAssistantId = this.generateId();
          currentAssistantTree = createExecutionNode({
            id: currentAssistantId,
            type: 'message',
            status: 'complete',
          });
        }

        // Create separate chat bubbles for each agent execution
        for (const { block, summaryContent, executionMessages } of agentBlocks) {
          const agentType = block.input?.['subagent_type'] as string;
          const agentDescription = block.input?.['description'] as string;
          const agentModel = block.input?.['model'] as string | undefined;

          // Create agent's execution tree from execution messages (tool calls)
          // Note: Summary content is stored in agentInfo, not in the execution tree
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

          // Register agent node in nodeMaps for streaming bridge
          if (block.id) {
            const agentNode = createExecutionNode({
              id: block.id,
              type: 'agent',
              status: 'complete',
              agentType,
              agentModel,
              agentDescription,
              toolCallId: block.id,
              children: executionNodes,
            });
            nodeMaps.agents.set(block.id, agentNode);
          }

          // Create agent info for styling with summary and execution flags
          const agentInfo: AgentInfo = {
            agentType,
            agentDescription,
            agentModel,
            summaryContent: summaryContent || undefined,
            hasSummary: !!summaryContent,
            hasExecution: executionNodes.length > 0,
          };

          // Create separate agent chat message
          const agentMessage = createExecutionChatMessage({
            id: block.id || this.generateId(),
            role: 'assistant',
            executionTree: agentExecutionTree,
            agentInfo,
          });

          chatMessages.push(agentMessage);
        }
      }
    }

    // Finalize any remaining assistant message (only if it has content)
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
  private classifyAgentMessages(messages: JSONLMessage[]): ClassifiedAgentMessages {
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
      summaryContent: summaryTexts.length > 0 ? summaryTexts.join('\n\n') : null,
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
