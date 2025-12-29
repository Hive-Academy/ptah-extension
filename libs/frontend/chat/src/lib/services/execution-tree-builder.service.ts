/**
 * ExecutionTreeBuilderService - Builds ExecutionNode tree from flat streaming events
 *
 * ARCHITECTURE (TASK_2025_082):
 * - Backend emits flat events with relationship IDs (messageId, toolCallId, parentToolUseId)
 * - Frontend stores flat events in Map (no tree building during streaming)
 * - This service builds ExecutionNode tree AT RENDER TIME from flat events
 *
 * This eliminates state corruption from interleaved sub-agent streams.
 *
 * @example
 * ```typescript
 * // In computed signal
 * const tree = treeBuilder.buildTree(streamingState);
 * ```
 */

import { Injectable } from '@angular/core';
import type {
  ExecutionNode,
  MessageStartEvent,
  MessageCompleteEvent,
  ToolStartEvent,
  ToolResultEvent,
  AgentStartEvent,
} from '@ptah-extension/shared';
import { createExecutionNode } from '@ptah-extension/shared';
import type { StreamingState } from './chat.types';

/**
 * Maximum recursion depth for tool children to prevent stack overflow.
 * Real-world agent nesting rarely exceeds 3-4 levels.
 */
const MAX_DEPTH = 10;

/**
 * ParseResult - Result of safe JSON parsing with error tracking
 * TASK_2025_088 Batch 2 Task 2.1: Prevents data loss from silent parse failures
 */
interface ParseResult<T> {
  success: boolean;
  data?: T;
  error?: string;
  raw?: string;
}

/**
 * PERFORMANCE OPTIMIZATION: Cache entry for memoized tree building
 * Stores the built tree along with the event count used to build it.
 * When event count matches, we return cached tree instead of rebuilding.
 */
interface TreeCacheEntry {
  eventCount: number;
  messageEventIdsLength: number;
  textAccumulatorsSize: number;
  toolInputAccumulatorsSize: number;
  tree: ExecutionNode[];
}

@Injectable({ providedIn: 'root' })
export class ExecutionTreeBuilderService {
  /**
   * PERFORMANCE OPTIMIZATION: Memoization cache for tree building
   * Key: Unique identifier for the streaming state (could be session-based)
   * Value: Cached tree and the state snapshot used to build it
   *
   * This prevents rebuilding the entire tree 100+ times/sec during streaming.
   * Tree is only rebuilt when the underlying data actually changes.
   */
  private readonly treeCache = new Map<string, TreeCacheEntry>();

  /**
   * Maximum cache entries to prevent memory leaks
   * Old entries are evicted when limit is reached (LRU-like behavior)
   */
  private readonly MAX_CACHE_SIZE = 50;
  /**
   * Build ExecutionNode tree from flat events at render time
   *
   * PERFORMANCE OPTIMIZATION: Memoized tree building
   * - Uses cache keyed by streaming state fingerprint
   * - Only rebuilds when event count or accumulator sizes change
   * - Reduces tree building from 100+/sec to only when data changes
   *
   * Algorithm:
   * 1. Check cache using state fingerprint (event count + accumulator sizes)
   * 2. Return cached tree if fingerprint matches
   * 3. Otherwise, build tree and cache result
   * 4. Group events by messageId (root messages)
   * 5. For each message, build tree using parentToolUseId for nesting
   * 6. Use toolCallId to link tool_result to tool_start
   * 7. Use blockIndex for ordering text/thinking blocks
   * 8. Accumulate text deltas into full content
   *
   * @param streamingState - Flat event storage
   * @param cacheKey - Optional cache key (defaults to 'default')
   * @returns Array of root ExecutionNode objects
   */
  buildTree(
    streamingState: StreamingState,
    cacheKey = 'default'
  ): ExecutionNode[] {
    // DIAGNOSTIC: Log buildTree call
    console.log(
      '[ExecutionTreeBuilderService] buildTree called:',
      JSON.stringify({
        cacheKey,
        eventCount: streamingState.events.size,
        messageEventIdsLength: streamingState.messageEventIds.length,
        messageIds: streamingState.messageEventIds,
      })
    );

    // PERFORMANCE: Calculate state fingerprint for cache validation
    // These values change when new events arrive or accumulators update
    const eventCount = streamingState.events.size;
    const messageEventIdsLength = streamingState.messageEventIds.length;
    const textAccumulatorsSize = streamingState.textAccumulators.size;
    const toolInputAccumulatorsSize = streamingState.toolInputAccumulators.size;

    // Check cache for existing tree with matching fingerprint
    const cached = this.treeCache.get(cacheKey);
    if (
      cached &&
      cached.eventCount === eventCount &&
      cached.messageEventIdsLength === messageEventIdsLength &&
      cached.textAccumulatorsSize === textAccumulatorsSize &&
      cached.toolInputAccumulatorsSize === toolInputAccumulatorsSize
    ) {
      // Cache hit - return existing tree without rebuilding
      console.log(
        '[ExecutionTreeBuilderService] buildTree cache HIT - skipping rebuild'
      );
      return cached.tree;
    }

    console.log(
      '[ExecutionTreeBuilderService] buildTree cache MISS - building tree'
    );
    // Cache miss - build new tree
    const rootNodes: ExecutionNode[] = [];

    for (const messageId of streamingState.messageEventIds) {
      const messageNode = this.buildMessageNode(messageId, streamingState);
      if (messageNode) {
        rootNodes.push(messageNode);
      }
    }

    // Evict old cache entries if at capacity (simple LRU-like eviction)
    if (this.treeCache.size >= this.MAX_CACHE_SIZE) {
      const firstKey = this.treeCache.keys().next().value;
      if (firstKey) {
        this.treeCache.delete(firstKey);
      }
    }

    // Cache the result
    this.treeCache.set(cacheKey, {
      eventCount,
      messageEventIdsLength,
      textAccumulatorsSize,
      toolInputAccumulatorsSize,
      tree: rootNodes,
    });

    return rootNodes;
  }

  /**
   * Clear cache for a specific key or all entries
   * Call this when a session is closed or switched
   */
  clearCache(cacheKey?: string): void {
    if (cacheKey) {
      this.treeCache.delete(cacheKey);
    } else {
      this.treeCache.clear();
    }
  }

  /**
   * Build a single message node with all its children
   *
   * @param messageId - Root message ID
   * @param state - Streaming state
   * @param depth - Current recursion depth (for preventing stack overflow)
   * @returns Complete message ExecutionNode
   */
  private buildMessageNode(
    messageId: string,
    state: StreamingState,
    depth = 0
  ): ExecutionNode | null {
    // Use pre-indexed events for O(1) lookup (TASK_2025_084 Batch 1 Task 1.2)
    // TASK_2025_087: Defensive check - eventsByMessage might not be a Map if loaded from localStorage
    const messageEvents =
      state.eventsByMessage instanceof Map
        ? state.eventsByMessage.get(messageId) || []
        : [];

    // Sort by timestamp to handle out-of-order arrival (TASK_2025_084 Batch 2 Task 2.3)
    const sortedEvents = messageEvents.slice().sort((a, b) => {
      const timeA = a.timestamp || 0;
      const timeB = b.timestamp || 0;
      return timeA - timeB;
    });

    // Find message_start event
    const startEvent = sortedEvents.find(
      (e) => e.eventType === 'message_start'
    ) as MessageStartEvent | undefined;

    if (!startEvent) return null;

    // Find message_complete event (may not exist if streaming)
    const completeEvent = sortedEvents.find(
      (e) => e.eventType === 'message_complete'
    ) as MessageCompleteEvent | undefined;

    // Build children
    const children = this.buildMessageChildren(messageId, state, depth);

    return createExecutionNode({
      id: startEvent.id,
      type: 'message',
      status: completeEvent ? 'complete' : 'streaming',
      content: '', // Content is in children
      children,
      startTime: startEvent.timestamp,
      tokenUsage: completeEvent?.tokenUsage,
      cost: completeEvent?.cost,
      duration: completeEvent?.duration,
    });
  }

  /**
   * Build children for a message node (text, thinking, tools)
   *
   * @param messageId - Parent message ID
   * @param state - Streaming state
   * @param depth - Current recursion depth (propagate to children)
   * @returns Array of child nodes
   */
  private buildMessageChildren(
    messageId: string,
    state: StreamingState,
    depth: number
  ): ExecutionNode[] {
    const children: ExecutionNode[] = [];

    // Collect text blocks (root level, no parentToolUseId)
    children.push(...this.collectTextBlocks(messageId, state));

    // Collect thinking blocks
    children.push(...this.collectThinkingBlocks(messageId, state));

    // Collect tools
    children.push(...this.collectTools(messageId, state, depth));

    // Sort by timestamp
    return children.sort((a, b) => (a.startTime || 0) - (b.startTime || 0));
  }

  /**
   * Collect and build text block nodes from text_delta events
   *
   * @param messageId - Parent message ID
   * @param state - Streaming state (for textAccumulators)
   * @returns Array of text ExecutionNode objects
   */
  private collectTextBlocks(
    messageId: string,
    state: StreamingState
  ): ExecutionNode[] {
    const blocks: ExecutionNode[] = [];

    // Get message events to find first text_delta for timestamp
    const messageEvents = state.eventsByMessage.get(messageId) || [];

    // DIAGNOSTIC: Log textAccumulators keys for this message
    const keysForMessage = [...state.textAccumulators.keys()].filter((k) =>
      k.startsWith(`${messageId}-block-`)
    );
    console.log(
      '[ExecutionTreeBuilderService] collectTextBlocks:',
      JSON.stringify({
        messageId,
        textAccumulatorKeysForMessage: keysForMessage,
        allTextAccumulatorKeys: [...state.textAccumulators.keys()],
        hasText: keysForMessage.length > 0,
      })
    );

    // Find all text block keys for this message
    for (const [key, accumulatedText] of state.textAccumulators) {
      if (key.startsWith(`${messageId}-block-`)) {
        const blockIndex = parseInt(key.split('-block-')[1], 10);

        // Find first text_delta event for this block to get timestamp
        const firstDelta = messageEvents.find(
          (e) =>
            e.eventType === 'text_delta' && (e.blockIndex ?? 0) === blockIndex
        );

        blocks.push(
          createExecutionNode({
            id: `${messageId}-text-${blockIndex}`,
            type: 'text',
            status: 'complete',
            content: accumulatedText,
            children: [],
            startTime: firstDelta?.timestamp || Date.now(),
          })
        );
      }
    }

    return blocks.sort((a, b) => {
      const aIndex = parseInt(a.id.split('-text-')[1], 10) || 0;
      const bIndex = parseInt(b.id.split('-text-')[1], 10) || 0;
      return aIndex - bIndex;
    });
  }

  /**
   * Collect and build thinking block nodes from thinking_delta events
   *
   * @param messageId - Parent message ID
   * @param state - Streaming state (for textAccumulators)
   * @returns Array of thinking ExecutionNode objects
   */
  private collectThinkingBlocks(
    messageId: string,
    state: StreamingState
  ): ExecutionNode[] {
    const blocks: ExecutionNode[] = [];

    // Get message events to find first thinking_delta for timestamp
    const messageEvents = state.eventsByMessage.get(messageId) || [];

    for (const [key, accumulatedText] of state.textAccumulators) {
      if (key.startsWith(`${messageId}-thinking-`)) {
        const blockIndex = parseInt(key.split('-thinking-')[1], 10);

        // Find first thinking_delta event for this block to get timestamp
        const firstDelta = messageEvents.find(
          (e) =>
            e.eventType === 'thinking_delta' &&
            (e.blockIndex ?? 0) === blockIndex
        );

        blocks.push(
          createExecutionNode({
            id: `${messageId}-thinking-${blockIndex}`,
            type: 'thinking',
            status: 'complete',
            content: accumulatedText,
            children: [],
            startTime: firstDelta?.timestamp || Date.now(),
          })
        );
      }
    }

    return blocks.sort((a, b) => {
      const aIndex = parseInt(a.id.split('-thinking-')[1], 10) || 0;
      const bIndex = parseInt(b.id.split('-thinking-')[1], 10) || 0;
      return aIndex - bIndex;
    });
  }

  /**
   * Collect and build tool nodes from tool_start events
   *
   * @param messageId - Parent message ID
   * @param state - Streaming state
   * @param depth - Current recursion depth (propagate to tool nodes)
   * @returns Array of tool ExecutionNode objects
   */
  private collectTools(
    messageId: string,
    state: StreamingState,
    depth: number
  ): ExecutionNode[] {
    const tools: ExecutionNode[] = [];

    // TASK_2025_095 FIX: Collect tools based on messageId AND context depth
    // - For root-level messages (depth 0): Only collect tools WITHOUT parentToolUseId
    //   These are direct tool calls from the main assistant message.
    // - For nested messages (depth > 0): Collect tools WITH parentToolUseId
    //   These are tool calls from within agent messages, linked to parent Task tool.
    const toolStarts = [...state.events.values()].filter((e) => {
      if (e.eventType !== 'tool_start') return false;
      if (e.messageId !== messageId) return false;

      // Root-level: only tools without parentToolUseId (direct tools)
      // Nested: collect any tools (they have parentToolUseId linking to Task)
      if (depth === 0 && e.parentToolUseId) return false;

      return true;
    }) as ToolStartEvent[];

    // DIAGNOSTIC: Log ALL tool_start events in state for debugging
    const allToolStarts = [...state.events.values()].filter(
      (e) => e.eventType === 'tool_start'
    );
    console.log(
      '[ExecutionTreeBuilderService] collectTools:',
      JSON.stringify({
        messageId,
        depth,
        toolStartsFound: toolStarts.length,
        toolNames: toolStarts.map((t) => ({
          name: t.toolName,
          id: t.toolCallId,
          hasParentToolUseId: !!t.parentToolUseId,
        })),
        // Debug: show ALL tool_start events in state
        allToolStartsInState: allToolStarts.map((t) => ({
          id: t.id,
          toolName: (t as ToolStartEvent).toolName,
          messageId: t.messageId,
          parentToolUseId: (t as ToolStartEvent).parentToolUseId,
        })),
      })
    );

    for (const toolStart of toolStarts) {
      // TASK_2025_095: For Task tools that spawn agents, show agent directly instead of Task wrapper
      // This prevents the duplication: Task tool → Agent → tools
      // User should see only: Agent → tools
      if (toolStart.isTaskTool || toolStart.toolName === 'Task') {
        // Check if this Task tool has an agent child
        const agentStarts = [...state.events.values()].filter(
          (e) =>
            e.eventType === 'agent_start' &&
            e.parentToolUseId === toolStart.toolCallId
        ) as AgentStartEvent[];

        // DIAGNOSTIC: Log agent search for Task tools
        console.log(
          '[ExecutionTreeBuilderService] Task tool agent search:',
          JSON.stringify({
            toolCallId: toolStart.toolCallId,
            agentStartsFound: agentStarts.length,
            agentStartIds: agentStarts.map((a) => a.id),
            allAgentStartsInState: [...state.events.values()]
              .filter((e) => e.eventType === 'agent_start')
              .map((e) => ({
                id: e.id,
                parentToolUseId: (e as AgentStartEvent).parentToolUseId,
              })),
          })
        );

        if (agentStarts.length > 0) {
          // Build agent nodes directly (skip the Task tool wrapper)
          for (const agentStart of agentStarts) {
            console.log(
              '[ExecutionTreeBuilderService] Building agent node for Task tool:',
              JSON.stringify({
                agentStartId: agentStart.id,
                toolCallId: toolStart.toolCallId,
                agentType: agentStart.agentType,
              })
            );
            const agentNode = this.buildAgentNode(
              agentStart,
              toolStart.toolCallId,
              state,
              depth
            );
            if (agentNode) {
              console.log(
                '[ExecutionTreeBuilderService] Agent node created:',
                JSON.stringify({
                  nodeId: agentNode.id,
                  nodeType: agentNode.type,
                  childrenCount: agentNode.children?.length ?? 0,
                })
              );
              tools.push(agentNode);
            } else {
              console.warn(
                '[ExecutionTreeBuilderService] buildAgentNode returned null!'
              );
            }
          }
          continue; // Skip building the Task tool node
        } else {
          console.log(
            '[ExecutionTreeBuilderService] No agent_starts found for Task tool, building as regular tool'
          );
        }
      }

      // Normal tool - build tool node as usual
      tools.push(this.buildToolNode(toolStart, state, depth));
    }

    return tools;
  }

  /**
   * Build an agent node directly (for Task tools that spawn agents)
   * TASK_2025_095: Used to show agent bubble without Task tool wrapper
   *
   * @param agentStart - Agent start event
   * @param toolCallId - Parent tool call ID (for finding nested messages)
   * @param state - Streaming state
   * @param depth - Current recursion depth
   * @returns Agent ExecutionNode or null
   */
  private buildAgentNode(
    agentStart: AgentStartEvent,
    toolCallId: string,
    state: StreamingState,
    depth: number
  ): ExecutionNode | null {
    // Early exit if max depth exceeded
    if (depth >= MAX_DEPTH) {
      console.warn(
        '[ExecutionTreeBuilderService] Max recursion depth exceeded in buildAgentNode',
        {
          toolCallId,
          depth,
          maxDepth: MAX_DEPTH,
        }
      );
      return null;
    }

    // Find message_start events for this agent (linked via parentToolUseId)
    const agentMessageStarts = [...state.events.values()].filter(
      (e) => e.eventType === 'message_start' && e.parentToolUseId === toolCallId
    ) as MessageStartEvent[];

    // DIAGNOSTIC: Log nested message search
    const allMessageStarts = [...state.events.values()].filter(
      (e) => e.eventType === 'message_start'
    ) as MessageStartEvent[];
    console.log(
      '[ExecutionTreeBuilderService] buildAgentNode - searching for nested messages:',
      JSON.stringify({
        agentStartId: agentStart.id,
        searchingForParentToolUseId: toolCallId,
        foundMessageStarts: agentMessageStarts.length,
        foundMessageIds: agentMessageStarts.map((m) => m.messageId),
        allMessageStartsWithParentToolUseId: allMessageStarts
          .filter((m) => m.parentToolUseId)
          .map((m) => ({
            messageId: m.messageId,
            parentToolUseId: m.parentToolUseId,
          })),
      })
    );

    // Build children for the agent node (the nested message content)
    const agentChildren: ExecutionNode[] = [];

    for (const msgStart of agentMessageStarts) {
      const messageNode = this.buildMessageNode(
        msgStart.messageId,
        state,
        depth + 1
      );
      if (messageNode) {
        // Unwrap message node - agent shows its content directly
        agentChildren.push(...messageNode.children);
      }
    }

    // Create the AGENT node
    return createExecutionNode({
      id: agentStart.id,
      type: 'agent',
      status: agentChildren.length > 0 ? 'complete' : 'streaming',
      content: agentStart.agentDescription || '',
      children: agentChildren,
      startTime: agentStart.timestamp,
      agentType: agentStart.agentType,
      agentDescription: agentStart.agentDescription,
    });
  }

  /**
   * Parse tool input JSON with error tracking
   * TASK_2025_088 Batch 2 Task 2.1: Safe JSON parser with error tracking
   *
   * @param input - Raw JSON string
   * @returns ParseResult with success/error state
   */
  private parseToolInput(input: string): ParseResult<Record<string, unknown>> {
    try {
      const parsed = JSON.parse(input);
      if (typeof parsed !== 'object' || parsed === null) {
        return { success: false, error: 'Not an object', raw: input };
      }
      return { success: true, data: parsed };
    } catch (e) {
      return { success: false, error: String(e), raw: input };
    }
  }

  /**
   * Build a single tool node with nested children (RECURSIVE)
   *
   * @param toolStart - Tool start event
   * @param state - Streaming state
   * @param depth - Current recursion depth (for preventing stack overflow)
   * @returns Tool ExecutionNode with nested execution
   */
  private buildToolNode(
    toolStart: ToolStartEvent,
    state: StreamingState,
    depth = 0
  ): ExecutionNode {
    // Find tool result FIRST - we only parse input when tool is complete
    const resultEvent = [...state.events.values()].find(
      (e) =>
        e.eventType === 'tool_result' && e.toolCallId === toolStart.toolCallId
    ) as ToolResultEvent | undefined;

    // Get accumulated input
    const inputKey = `${toolStart.toolCallId}-input`;
    const inputString = state.toolInputAccumulators.get(inputKey) || '';

    // Parse JSON into toolInput field ONLY when tool is complete
    // FIX: During streaming, input JSON is incomplete (e.g., '{"file_path": "d:\\proje')
    // Attempting to parse causes ~15+ SyntaxError warnings per tool call
    // Solution: Defer parsing until tool_result arrives
    let toolInput: Record<string, unknown> | undefined;
    if (inputString && resultEvent) {
      // Tool completed - safe to parse full JSON
      const result = this.parseToolInput(inputString);
      if (result.success) {
        toolInput = result.data;
      } else {
        // CRITICAL FIX: Preserve parse error for UI display instead of silent failure
        toolInput = {
          __parseError: result.error,
          __raw: result.raw,
        } as Record<string, unknown>;
        console.warn('[ExecutionTreeBuilderService] Tool input parse failed', {
          toolCallId: toolStart.toolCallId,
          error: result.error,
          raw: result.raw?.substring(0, 100), // Log first 100 chars
        });
      }
    } else if (inputString) {
      // Tool still streaming - don't parse, show raw snippet for debugging
      toolInput = {
        __streaming: true,
        __rawSnippet:
          inputString.substring(0, 50) + (inputString.length > 50 ? '...' : ''),
      } as Record<string, unknown>;
    } else if (
      toolStart.toolInput &&
      Object.keys(toolStart.toolInput).length > 0
    ) {
      // Fallback to toolStart.toolInput for historical sessions
      // Historical session loading (SessionHistoryReaderService) populates
      // toolInput directly on ToolStartEvent - no accumulator parsing needed
      toolInput = toolStart.toolInput;
    } else {
      toolInput = undefined;
    }

    // Build nested children (RECURSIVE - sub-agent messages!)
    const children = this.buildToolChildren(toolStart.toolCallId, state, depth);

    return createExecutionNode({
      id: toolStart.id,
      type: 'tool',
      status: resultEvent ? 'complete' : 'streaming',
      content: null, // Content is null, not the JSON string
      toolInput, // Parsed JSON in correct field
      children,
      startTime: toolStart.timestamp,
      toolName: toolStart.toolName,
      toolCallId: toolStart.toolCallId,
      toolOutput: resultEvent?.output,
      isPermissionRequest: resultEvent?.isPermissionRequest,
    });
  }

  /**
   * Build children for a tool node (nested messages for agents)
   * This is RECURSIVE - agent tools contain nested message nodes
   *
   * @param toolCallId - Parent tool call ID
   * @param state - Streaming state
   * @param depth - Current recursion depth (default 0)
   * @returns Array of nested ExecutionNode objects
   */
  private buildToolChildren(
    toolCallId: string,
    state: StreamingState,
    depth = 0
  ): ExecutionNode[] {
    // Early exit if max depth exceeded
    if (depth >= MAX_DEPTH) {
      console.warn(
        '[ExecutionTreeBuilderService] Max recursion depth exceeded',
        {
          toolCallId,
          depth,
          maxDepth: MAX_DEPTH,
        }
      );
      return [];
    }

    const children: ExecutionNode[] = [];

    // Find all agent_start events where parentToolUseId = toolCallId
    const agentStarts = [...state.events.values()].filter(
      (e) => e.eventType === 'agent_start' && e.parentToolUseId === toolCallId
    ) as AgentStartEvent[];

    // DIAGNOSTIC: Log agent_start search results (JSON.stringify for log file visibility)
    console.log(
      '[ExecutionTreeBuilderService] buildToolChildren - searching for agents:',
      JSON.stringify({
        toolCallId,
        depth,
        totalEvents: state.events.size,
        agentStartsFound: agentStarts.length,
        agentStartIds: agentStarts.map((a) => ({
          id: a.id,
          parentToolUseId: a.parentToolUseId,
        })),
      })
    );

    // For each agent, create an AGENT node containing its messages
    for (const agentStart of agentStarts) {
      // Find message_start events for this agent
      const agentMessageStarts = [...state.events.values()].filter(
        (e) =>
          e.eventType === 'message_start' && e.parentToolUseId === toolCallId
      ) as MessageStartEvent[];

      // DIAGNOSTIC: Log message_start search results (JSON.stringify for log file visibility)
      console.log(
        '[ExecutionTreeBuilderService] buildToolChildren - searching for nested messages:',
        JSON.stringify({
          agentId: agentStart.id,
          toolCallId,
          agentMessageStartsFound: agentMessageStarts.length,
          agentMessageStartDetails: agentMessageStarts.map((m) => ({
            id: m.id,
            messageId: m.messageId,
            parentToolUseId: m.parentToolUseId,
            role: m.role,
          })),
          // Also log all message_start events in state for comparison
          allMessageStartsInState: [...state.events.values()]
            .filter((e) => e.eventType === 'message_start')
            .map((e) => ({
              id: e.id,
              messageId: (e as MessageStartEvent).messageId,
              parentToolUseId: (e as MessageStartEvent).parentToolUseId,
            })),
        })
      );

      // Build children for the agent node (the nested message content)
      const agentChildren: ExecutionNode[] = [];

      for (const msgStart of agentMessageStarts) {
        const messageNode = this.buildMessageNode(
          msgStart.messageId,
          state,
          depth + 1
        );

        // DIAGNOSTIC: Log buildMessageNode result (JSON.stringify for log file visibility)
        console.log(
          '[ExecutionTreeBuilderService] buildToolChildren - buildMessageNode result:',
          JSON.stringify({
            messageId: msgStart.messageId,
            messageNodeExists: !!messageNode,
            messageNodeChildrenCount: messageNode?.children?.length ?? 0,
            messageNodeChildren:
              messageNode?.children?.map((c) => ({ id: c.id, type: c.type })) ??
              [],
          })
        );

        if (messageNode) {
          // Unwrap message node - agent shows its content directly
          // Push the message's children (text, tools, etc.) as agent's children
          agentChildren.push(...messageNode.children);
        }
      }

      // DIAGNOSTIC: Log agentChildren before creating agent node (JSON.stringify for log file visibility)
      console.log(
        '[ExecutionTreeBuilderService] buildToolChildren - creating agent node:',
        JSON.stringify({
          agentId: agentStart.id,
          agentType: agentStart.agentType,
          agentChildrenCount: agentChildren.length,
          agentChildrenTypes: agentChildren.map((c) => ({
            id: c.id,
            type: c.type,
          })),
        })
      );

      // Create the AGENT node from agent_start event
      // This wraps the nested content in a proper agent bubble
      const agentNode = createExecutionNode({
        id: agentStart.id,
        type: 'agent',
        status: agentChildren.length > 0 ? 'complete' : 'streaming',
        content: agentStart.agentDescription || '',
        children: agentChildren,
        startTime: agentStart.timestamp,
        agentType: agentStart.agentType,
        agentDescription: agentStart.agentDescription,
      });

      children.push(agentNode);
    }

    // DIAGNOSTIC: Log final tool children (JSON.stringify for log file visibility)
    console.log(
      '[ExecutionTreeBuilderService] buildToolChildren - returning children:',
      JSON.stringify({
        toolCallId,
        childrenCount: children.length,
        childrenTypes: children.map((c) => ({
          id: c.id,
          type: c.type,
          childCount: c.children?.length,
        })),
      })
    );

    return children;
  }
}
