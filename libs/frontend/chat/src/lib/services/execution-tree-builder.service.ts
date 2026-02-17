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
  /**
   * TASK_2025_099: Include agent summary total length for cache invalidation.
   * Using total content length (not just map size) ensures cache invalidates
   * when content is appended to existing agents, not just when new agents are added.
   */
  agentSummaryTotalLength: number;
  /**
   * TASK_2025_102: Include content blocks total count for cache invalidation.
   * Ensures cache invalidates when new content blocks are added for interleaving.
   */
  agentContentBlocksCount: number;
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
    // PERFORMANCE: Calculate state fingerprint for cache validation
    // These values change when new events arrive or accumulators update
    const eventCount = streamingState.events.size;
    const messageEventIdsLength = streamingState.messageEventIds.length;
    const textAccumulatorsSize = streamingState.textAccumulators.size;
    const toolInputAccumulatorsSize = streamingState.toolInputAccumulators.size;
    // TASK_2025_099: Calculate total agent summary content length for cache invalidation.
    // Using total length (not just map size) ensures cache invalidates when content
    // is appended to existing agents, not just when new agents are added.
    let agentSummaryTotalLength = 0;
    for (const content of streamingState.agentSummaryAccumulators.values()) {
      agentSummaryTotalLength += content.length;
    }
    // TASK_2025_102: Calculate total content blocks count for cache invalidation.
    // Ensures cache invalidates when new content blocks are added for interleaving.
    let agentContentBlocksCount = 0;
    for (const blocks of streamingState.agentContentBlocksMap.values()) {
      agentContentBlocksCount += blocks.length;
    }

    // Check cache for existing tree with matching fingerprint
    const cached = this.treeCache.get(cacheKey);
    if (
      cached &&
      cached.eventCount === eventCount &&
      cached.messageEventIdsLength === messageEventIdsLength &&
      cached.textAccumulatorsSize === textAccumulatorsSize &&
      cached.toolInputAccumulatorsSize === toolInputAccumulatorsSize &&
      cached.agentSummaryTotalLength === agentSummaryTotalLength &&
      cached.agentContentBlocksCount === agentContentBlocksCount
    ) {
      // Cache hit - return existing tree without rebuilding
      return cached.tree;
    }

    // Cache miss - build new tree
    // TASK_2025_132: Clear per-build aggregation cache to avoid stale stats
    this.agentStatsCache.clear();

    const rootNodes: ExecutionNode[] = [];

    // TASK_2025_096 FIX: Filter out nested messages and MERGE consecutive assistant messages.
    // Problem: SDK sends multiple assistant messages in one "turn" (between user messages).
    // Each message has a unique messageId, but users expect them in ONE bubble.
    //
    // Solution: Merge consecutive assistant messages into one root node.
    // - User messages always start a new root node
    // - Assistant messages following another assistant: MERGE children into previous node
    // - This keeps the data intact while providing correct visual grouping
    let lastAssistantNode: ExecutionNode | null = null;

    for (const messageId of streamingState.messageEventIds) {
      // Check if this message is nested (has parentToolUseId)
      const msgStartEvent = this.findMessageStartEvent(
        streamingState,
        messageId
      );
      if (msgStartEvent?.parentToolUseId) {
        // Skip nested messages - they'll be rendered inside agent bubbles
        continue;
      }

      const messageNode = this.buildMessageNode(messageId, streamingState);
      if (!messageNode) continue;

      // Determine if this is a user or assistant message
      const isAssistant = msgStartEvent?.role === 'assistant';

      if (isAssistant && lastAssistantNode) {
        // MERGE: Consecutive assistant message - add children to previous node
        // This groups all content from one "turn" into one visual bubble
        // Add this message's children to the previous assistant node
        // Since children is readonly, we create a new merged node and replace in array
        if (messageNode.children && messageNode.children.length > 0) {
          const mergedChildren = [
            ...(lastAssistantNode.children || []),
            ...messageNode.children,
          ];
          const mergedNode: ExecutionNode = {
            ...lastAssistantNode,
            children: mergedChildren,
          };
          // Replace the last assistant node in rootNodes with merged version
          const lastIndex = rootNodes.length - 1;
          rootNodes[lastIndex] = mergedNode;
          lastAssistantNode = mergedNode;
        }
        // Don't add as separate root - it's merged
      } else {
        // NEW ROOT: User message OR first assistant message in turn
        rootNodes.push(messageNode);

        // Track for potential merging
        if (isAssistant) {
          lastAssistantNode = messageNode;
        } else {
          // User message resets the merge tracking
          lastAssistantNode = null;
        }
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
      agentSummaryTotalLength,
      agentContentBlocksCount,
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

    // Track used agent event IDs to prevent duplicate agent nodes.
    // When multiple tool_start events exist for the same logical agent (different
    // toolCallId formats), the agentType fallback matching could find the same
    // agent_start multiple times. Track used agent event IDs to prevent this.
    // IMPORTANT: Do NOT deduplicate by agentType alone - parallel agents can share
    // the same agentType (e.g., two "backend-developer" agents running concurrently).
    const usedAgentEventIds = new Set<string>();
    // Track toolCallIds that already have a placeholder or agent node
    const usedToolCallIds = new Set<string>();

    // DIAGNOSTIC: Log tool_starts for this message
    console.log('[ExecutionTreeBuilder] collectTools:', {
      messageId,
      depth,
      toolStartsCount: toolStarts.length,
      toolStarts: toolStarts.map((t) => ({
        toolCallId: t.toolCallId,
        toolName: t.toolName,
        isTaskTool: t.isTaskTool,
        source: t.source,
        parentToolUseId: t.parentToolUseId,
      })),
    });

    for (const toolStart of toolStarts) {
      // TASK_2025_095: For Task tools that spawn agents, show agent directly instead of Task wrapper
      // This prevents the duplication: Task tool → Agent → tools
      // User should see only: Agent → tools
      if (toolStart.isTaskTool || toolStart.toolName === 'Task') {
        // Check if this Task tool has an agent child
        // TASK_2025_128 FIX: The parentToolUseId matching often fails because:
        // - Hook-based agent_start uses UUID format for parentToolUseId
        // - SDK tool_start uses toolu_* format for toolCallId
        // These IDs refer to the SAME tool but use different formats.
        let agentStarts = [...state.events.values()].filter(
          (e) =>
            e.eventType === 'agent_start' &&
            e.parentToolUseId === toolStart.toolCallId
        ) as AgentStartEvent[];

        // TASK_2025_128 FIX: Fallback - match by agentType when ID matching fails.
        // Extract agentType from tool input and find matching agent_start.
        // This handles the UUID vs toolu_* format mismatch.
        if (agentStarts.length === 0) {
          const inputKey = `${toolStart.toolCallId}-input`;
          const inputString = state.toolInputAccumulators.get(inputKey) || '';
          const typeMatch = inputString.match(
            /"subagent_type"\s*:\s*"([^"]+)"/
          );

          if (typeMatch) {
            const agentType = typeMatch[1];
            agentStarts = [...state.events.values()].filter(
              (e) =>
                e.eventType === 'agent_start' &&
                (e as AgentStartEvent).agentType === agentType
            ) as AgentStartEvent[];

            // BUGFIX: Sort by timestamp proximity to the tool_start.
            // When multiple agents of the same type exist (e.g., 5 frontend-developer
            // agents from history + 1 streaming), the closest by timestamp is most likely
            // the correct match for this tool_start. Without sorting, Map iteration order
            // (insertion order) picks the oldest historical agent, causing content block
            // lookups to use the wrong agentId.
            agentStarts.sort(
              (a, b) =>
                Math.abs(a.timestamp - toolStart.timestamp) -
                Math.abs(b.timestamp - toolStart.timestamp)
            );
          }
        }

        if (agentStarts.length > 0) {
          // Build agent node directly (skip the Task tool wrapper).
          // For parallel agents of the same type, only take the FIRST unused agent_start.
          // Each tool_start should map to exactly one agent_start.
          let matchedAgent: AgentStartEvent | null = null;

          for (const agentStart of agentStarts) {
            // Skip if this specific agent_start event was already consumed by another tool_start
            if (usedAgentEventIds.has(agentStart.id)) {
              continue;
            }
            if (
              agentStart.agentId &&
              usedAgentEventIds.has(agentStart.agentId)
            ) {
              continue;
            }
            matchedAgent = agentStart;
            break; // Take the first unused match
          }

          if (matchedAgent) {
            // Mark this agent_start as consumed so other tool_starts won't reuse it
            usedAgentEventIds.add(matchedAgent.id);
            if (matchedAgent.agentId) {
              usedAgentEventIds.add(matchedAgent.agentId);
            }
            usedToolCallIds.add(toolStart.toolCallId);

            const agentNode = this.buildAgentNode(
              matchedAgent,
              toolStart.toolCallId,
              state,
              depth
            );
            if (agentNode) {
              tools.push(agentNode);
            }
          }
          continue; // Skip building the Task tool node
        } else {
          // DIAGNOSTIC: Log when no agent_start found for Task tool
          console.log(
            '[ExecutionTreeBuilder] No agent_start match for Task tool:',
            {
              toolCallId: toolStart.toolCallId,
              toolSource: toolStart.source,
            }
          );
          // TASK_2025_099 FIX: Create streaming agent placeholder when no agent_start yet.
          // During streaming, agent_start events only arrive when the complete message comes.
          // Create a placeholder agent node from accumulated tool input to show the agent is working.
          const toolResult = [...state.events.values()].find(
            (e) =>
              e.eventType === 'tool_result' &&
              (e as ToolResultEvent).toolCallId === toolStart.toolCallId
          );

          // Only create placeholder if tool is still streaming (no result yet)
          if (!toolResult) {
            // Try to extract agent info from accumulated tool input
            const inputKey = `${toolStart.toolCallId}-input`;
            const inputString = state.toolInputAccumulators.get(inputKey) || '';

            // Skip if this specific toolCallId already has an agent node or placeholder
            if (usedToolCallIds.has(toolStart.toolCallId)) {
              continue;
            }

            // Extract agent type and description from partial JSON
            // The JSON may be incomplete, so we use regex to extract fields
            let agentType = 'Task';
            let agentDescription = 'Agent working...';

            // Try to extract subagent_type from partial JSON
            const typeMatch = inputString.match(
              /"subagent_type"\s*:\s*"([^"]+)"/
            );
            if (typeMatch) {
              agentType = typeMatch[1];
            }

            // Try to extract description from partial JSON
            const descMatch = inputString.match(
              /"description"\s*:\s*"([^"]+)"/
            );
            if (descMatch) {
              agentDescription = descMatch[1];
            }

            // TASK_2025_100 FIX: Build children from sub-agent messages even during streaming.
            // Previously, placeholder had empty children: []. This caused sub-agent's text and
            // tool content to not display until agent_start arrived (only with complete messages).
            // Now we collect children the same way buildAgentNode does.
            const agentMessageStarts = [...state.events.values()].filter(
              (e) =>
                e.eventType === 'message_start' &&
                e.parentToolUseId === toolStart.toolCallId &&
                (e as MessageStartEvent).role === 'assistant'
            ) as MessageStartEvent[];

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

            // Try to find matching hook-based agent_start to get agentId.
            // Hook-based agent_start events have agentId for stable summary lookup.
            // Filter out already-consumed agent_starts to handle parallel agents of same type.
            // BUGFIX: Use timestamp proximity instead of .find() to avoid matching
            // historical agents when multiple agents of the same type exist.
            let hookAgentStart: AgentStartEvent | undefined;
            let bestPlaceholderTimeDiff = Infinity;
            for (const e of state.events.values()) {
              if (
                e.eventType === 'agent_start' &&
                e.source === 'hook' &&
                (e as AgentStartEvent).agentType === agentType &&
                !usedAgentEventIds.has(e.id) &&
                (!(e as AgentStartEvent).agentId ||
                  !usedAgentEventIds.has((e as AgentStartEvent).agentId!))
              ) {
                const timeDiff = Math.abs(e.timestamp - toolStart.timestamp);
                if (timeDiff < bestPlaceholderTimeDiff) {
                  bestPlaceholderTimeDiff = timeDiff;
                  hookAgentStart = e as AgentStartEvent;
                }
              }
            }

            // Mark this hook agent_start as consumed for parallel agent dedup
            if (hookAgentStart) {
              usedAgentEventIds.add(hookAgentStart.id);
              if (hookAgentStart.agentId) {
                usedAgentEventIds.add(hookAgentStart.agentId);
              }
            }

            // Get summaryContent using agentId if available
            // Fallback to toolCallId for backward compatibility
            const placeholderAgentId = hookAgentStart?.agentId;

            // TASK_2025_102: Get structured content blocks for proper interleaving
            const placeholderContentBlocks = placeholderAgentId
              ? state.agentContentBlocksMap.get(placeholderAgentId) || []
              : [];

            // Legacy: Get summaryContent (fallback if no content blocks)
            const placeholderSummaryContent = placeholderAgentId
              ? state.agentSummaryAccumulators.get(placeholderAgentId) ||
                undefined
              : state.agentSummaryAccumulators.get(toolStart.toolCallId) ||
                undefined;

            // TASK_2025_102 FIX: Build interleaved children from content blocks
            let finalPlaceholderChildren: ExecutionNode[];

            if (placeholderContentBlocks.length > 0) {
              // Use structured content blocks for proper interleaving
              finalPlaceholderChildren = this.buildInterleavedChildren(
                `agent-placeholder-${toolStart.toolCallId}`,
                toolStart.timestamp,
                placeholderContentBlocks,
                agentChildren
              );
            } else if (
              placeholderSummaryContent &&
              placeholderSummaryContent.trim()
            ) {
              // Fallback: Use legacy summaryContent as single text node at beginning
              finalPlaceholderChildren = [...agentChildren];
              const summaryTextNode = createExecutionNode({
                id: `agent-placeholder-${toolStart.toolCallId}-summary-text`,
                type: 'text',
                status: 'complete',
                content: placeholderSummaryContent,
                children: [],
                startTime: toolStart.timestamp,
              });
              finalPlaceholderChildren.unshift(summaryTextNode);
            } else {
              // No summary content - just use tool children
              finalPlaceholderChildren = [...agentChildren];
            }

            // TASK_2025_132: Aggregate stats from child message events for this placeholder agent
            const placeholderStats = this.aggregateAgentStats(
              toolStart.toolCallId,
              state
            );

            const placeholderAgent = createExecutionNode({
              id: `agent-placeholder-${toolStart.toolCallId}`,
              type: 'agent',
              status: 'streaming',
              content: agentDescription,
              children: finalPlaceholderChildren, // Now includes summary as text child
              startTime: toolStart.timestamp,
              agentType: agentType,
              agentDescription: agentDescription,
              toolCallId: toolStart.toolCallId,
              agentId: placeholderAgentId, // TASK_2025_099: From hook if available
              // summaryContent no longer needed on node - it's now a child text node
              ...placeholderStats, // TASK_2025_132: Spread agentModel, tokenUsage, cost, duration
              model: placeholderStats.agentModel, // TASK_2025_132: Also set model field for consistency
            });

            // Mark this toolCallId as used to prevent duplicates
            usedToolCallIds.add(toolStart.toolCallId);

            tools.push(placeholderAgent);
            continue; // Skip building the Task tool node
          }
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
    // TASK_2025_096 FIX: Only collect ASSISTANT messages, not user messages.
    // When SDK invokes an agent, it sends a user message with the prompt.
    // We don't want to display the agent's prompt as content inside the agent bubble.
    const agentMessageStarts = [...state.events.values()].filter(
      (e) =>
        e.eventType === 'message_start' &&
        e.parentToolUseId === toolCallId &&
        (e as MessageStartEvent).role === 'assistant'
    ) as MessageStartEvent[];

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

    // TASK_2025_099: Get summaryContent and contentBlocks from maps
    // The key is agentId (e.g., "adcecb2"), NOT toolCallId, because:
    // - Hook sends UUID-format toolCallId
    // - Complete message sends toolu_* format toolCallId
    // - agentId is stable and consistent across both sources
    //
    // TASK_2025_099 FIX: If agentStart doesn't have agentId (complete events often don't),
    // try to find a matching hook-based agent_start event by agentType and use its agentId.
    let effectiveAgentId = agentStart.agentId;

    if (!effectiveAgentId) {
      // Find hook-based agent_start with matching agentType.
      // BUGFIX: When multiple agents of the same type exist in a session,
      // we must find the CLOSEST hook agent_start by timestamp, not just the first.
      // Using .find() returned the first (oldest) match, which was wrong.
      let bestHookMatch: AgentStartEvent | undefined;
      let bestTimeDiff = Infinity;

      for (const e of state.events.values()) {
        if (
          e.eventType === 'agent_start' &&
          e.source === 'hook' &&
          (e as AgentStartEvent).agentType === agentStart.agentType &&
          (e as AgentStartEvent).agentId
        ) {
          const timeDiff = Math.abs(e.timestamp - agentStart.timestamp);
          if (timeDiff < bestTimeDiff) {
            bestTimeDiff = timeDiff;
            bestHookMatch = e as AgentStartEvent;
          }
        }
      }

      if (bestHookMatch?.agentId) {
        effectiveAgentId = bestHookMatch.agentId;
      }
    }

    // TASK_2025_102: Get structured content blocks for proper interleaving
    const contentBlocks = effectiveAgentId
      ? state.agentContentBlocksMap.get(effectiveAgentId) || []
      : [];

    // Legacy: Get summaryContent (fallback if no content blocks)
    const summaryContent = effectiveAgentId
      ? state.agentSummaryAccumulators.get(effectiveAgentId) || undefined
      : undefined;

    // TASK_2025_102 FIX: Build interleaved children from content blocks
    // Content blocks preserve the original order: [text, tool_ref, text, tool_ref, ...]
    // We create text nodes for text blocks and find matching tool nodes for tool_ref blocks.
    let finalChildren: ExecutionNode[];

    // DIAGNOSTIC: Log buildAgentNode inputs
    console.log('[ExecutionTreeBuilder] buildAgentNode:', {
      agentStartId: agentStart.id,
      toolCallId,
      effectiveAgentId,
      agentMessageStartsCount: agentMessageStarts.length,
      agentChildrenCount: agentChildren.length,
      agentChildrenTypes: agentChildren.map((c) => c.type),
      contentBlocksCount: contentBlocks.length,
      contentBlockTypes: contentBlocks.map((b) => b.type),
      summaryContentLength: summaryContent?.length ?? 0,
    });

    if (contentBlocks.length > 0) {
      // Use structured content blocks for proper interleaving
      finalChildren = this.buildInterleavedChildren(
        agentStart.id,
        agentStart.timestamp,
        contentBlocks,
        agentChildren
      );
      // DIAGNOSTIC: Log interleaved result
      console.log('[ExecutionTreeBuilder] buildInterleavedChildren result:', {
        resultCount: finalChildren.length,
        resultTypes: finalChildren.map(
          (c) => `${c.type}${c.toolCallId ? ':' + c.toolCallId : ''}`
        ),
        textNodes: finalChildren.filter((c) => c.type === 'text').length,
        toolNodes: finalChildren.filter((c) => c.type === 'tool').length,
      });
    } else if (summaryContent && summaryContent.trim()) {
      // Fallback: Use legacy summaryContent as single text node at beginning
      finalChildren = [...agentChildren];
      const summaryTextNode = createExecutionNode({
        id: `${agentStart.id}-summary-text`,
        type: 'text',
        status: 'complete',
        content: summaryContent,
        children: [],
        startTime: agentStart.timestamp,
      });
      finalChildren.unshift(summaryTextNode);
    } else {
      // No summary content - just use tool children
      finalChildren = [...agentChildren];
    }

    // TASK_2025_132: Aggregate stats from child message events for this agent
    const stats = this.aggregateAgentStats(toolCallId, state);

    // BUGFIX: Determine agent status from Task tool_result, not children count.
    // Previously `finalChildren.length > 0 ? 'complete' : 'streaming'` caused agents
    // to be marked 'complete' as soon as they produced any output, which broke
    // auto-scroll in inline-agent-bubble (scheduleScroll bails when !isStreaming).
    const hasTaskToolResult = [...state.events.values()].some(
      (e) =>
        e.eventType === 'tool_result' &&
        (e as ToolResultEvent).toolCallId === toolCallId
    );

    // Create the AGENT node
    return createExecutionNode({
      id: agentStart.id,
      type: 'agent',
      status: hasTaskToolResult ? 'complete' : 'streaming',
      content: agentStart.agentDescription || '',
      children: finalChildren,
      startTime: agentStart.timestamp,
      agentType: agentStart.agentType,
      agentDescription: agentStart.agentDescription,
      toolCallId: agentStart.toolCallId,
      agentId: effectiveAgentId, // TASK_2025_099 FIX: Use effectiveAgentId (from hook if needed)
      ...stats, // TASK_2025_132: Spread agentModel, tokenUsage, cost, duration
      model: stats.agentModel, // TASK_2025_132: Also set model field for consistency
    });
  }

  /**
   * TASK_2025_102: Build interleaved children from structured content blocks
   *
   * Content blocks from the JSONL file preserve the original interleaving:
   * [text, tool_ref, text, tool_ref, ...]
   *
   * This method creates text nodes for text blocks and matches tool_ref blocks
   * to actual tool nodes from SDK events, producing properly interleaved children.
   *
   * @param agentId - Agent node ID for generating child IDs
   * @param baseTimestamp - Base timestamp for ordering
   * @param contentBlocks - Structured content blocks from file watcher
   * @param toolChildren - Tool nodes from SDK events
   * @returns Interleaved array of text and tool nodes
   */
  private buildInterleavedChildren(
    agentId: string,
    baseTimestamp: number,
    contentBlocks: Array<{
      type: 'text' | 'tool_ref';
      text?: string;
      toolUseId?: string;
      toolName?: string;
    }>,
    toolChildren: ExecutionNode[]
  ): ExecutionNode[] {
    const result: ExecutionNode[] = [];
    let textIndex = 0;

    // Create a map of toolUseId to tool nodes for quick lookup
    const toolMap = new Map<string, ExecutionNode>();
    for (const tool of toolChildren) {
      if (tool.toolCallId) {
        toolMap.set(tool.toolCallId, tool);
      }
    }

    // Track which tools have been added (to add remaining tools at the end)
    const addedToolIds = new Set<string>();

    for (const block of contentBlocks) {
      if (block.type === 'text' && block.text) {
        // Create text node for text block
        const textNode = createExecutionNode({
          id: `${agentId}-text-${textIndex++}`,
          type: 'text',
          status: 'complete',
          content: block.text,
          children: [],
          startTime: baseTimestamp + textIndex, // Increment for ordering
        });
        result.push(textNode);
      } else if (block.type === 'tool_ref' && block.toolUseId) {
        // Find matching tool node by toolUseId
        const toolNode = toolMap.get(block.toolUseId);
        if (toolNode) {
          result.push(toolNode);
          addedToolIds.add(block.toolUseId);
        } else {
          // Tool not found - this can happen if SDK events haven't arrived yet
          // Skip the tool_ref, the tool will be added from remaining tools
          console.debug(
            '[ExecutionTreeBuilder] tool_ref not found in toolChildren:',
            { toolUseId: block.toolUseId, toolName: block.toolName }
          );
        }
      }
    }

    // Add any remaining tools that weren't in content blocks
    // (e.g., tools that arrived via SDK but not yet in JSONL file)
    for (const tool of toolChildren) {
      if (tool.toolCallId && !addedToolIds.has(tool.toolCallId)) {
        result.push(tool);
      }
    }

    return result;
  }

  /**
   * Per-build-cycle cache for aggregateAgentStats results.
   * Cleared at the start of each buildTree() call to avoid stale data.
   * Prevents redundant full-event scans when the same toolCallId is
   * queried from multiple agent node creation sites within a single build.
   */
  private agentStatsCache = new Map<
    string,
    {
      agentModel?: string;
      tokenUsage?: { input: number; output: number };
      cost?: number;
      duration?: number;
    }
  >();

  /**
   * Aggregate model, token usage, cost, and duration from child message events.
   * Scans all message_complete events linked to this agent via parentToolUseId.
   * Results are cached per toolCallId within a single buildTree() cycle.
   *
   * TASK_2025_132: Populates agent nodes with aggregated stats from their child messages.
   *
   * @param toolCallId - The agent's parent tool call ID
   * @param state - Current streaming state
   * @returns Aggregated stats for the agent node
   */
  private aggregateAgentStats(
    toolCallId: string,
    state: StreamingState
  ): {
    agentModel?: string;
    tokenUsage?: { input: number; output: number };
    cost?: number;
    duration?: number;
  } {
    // Check per-build cache to avoid redundant scans
    const cached = this.agentStatsCache.get(toolCallId);
    if (cached) return cached;

    let model: string | undefined;
    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let totalCost = 0;
    let hasTokenData = false;
    let earliestStart: number | undefined;
    let latestEnd: number | undefined;

    for (const event of state.events.values()) {
      // Only look at events linked to this agent's tool call
      if (event.parentToolUseId !== toolCallId) continue;

      if (event.eventType === 'message_complete') {
        const complete = event as MessageCompleteEvent;

        // Capture model from first message_complete that has it
        if (!model && complete.model) {
          model = complete.model;
        }

        // Accumulate token usage
        if (complete.tokenUsage) {
          totalInputTokens += complete.tokenUsage.input;
          totalOutputTokens += complete.tokenUsage.output;
          hasTokenData = true;
        }

        // Accumulate cost
        if (complete.cost) {
          totalCost += complete.cost;
        }

        // Track latest timestamp for duration calculation
        if (!latestEnd || complete.timestamp > latestEnd) {
          latestEnd = complete.timestamp;
        }
      }

      if (event.eventType === 'message_start') {
        // Track earliest timestamp for duration calculation
        if (!earliestStart || event.timestamp < earliestStart) {
          earliestStart = event.timestamp;
        }
      }
    }

    const result = {
      agentModel: model,
      // Note: MessageCompleteEvent.tokenUsage only carries input/output.
      // Cache token fields (cacheRead, cacheCreation) are not available
      // at the per-message event level from the SDK.
      tokenUsage: hasTokenData
        ? {
            input: totalInputTokens,
            output: totalOutputTokens,
          }
        : undefined,
      cost: totalCost > 0 ? totalCost : undefined,
      duration:
        earliestStart && latestEnd && latestEnd > earliestStart
          ? latestEnd - earliestStart
          : undefined,
    };

    // Cache for subsequent calls within this build cycle
    this.agentStatsCache.set(toolCallId, result);
    return result;
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

        // TASK_2025_100 FIX: Only warn if JSON looks complete (ends with }).
        // During rapid tree rebuilds, tool_result may arrive before accumulator
        // has the complete JSON, causing noisy warnings for incomplete JSON.
        const trimmed = result.raw?.trim() || '';
        const looksComplete = trimmed.endsWith('}') || trimmed.endsWith(']');
        if (looksComplete) {
          console.warn(
            '[ExecutionTreeBuilderService] Tool input parse failed',
            {
              toolCallId: toolStart.toolCallId,
              error: result.error,
              raw: result.raw?.substring(0, 100), // Log first 100 chars
            }
          );
        }
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

    // For each agent, create an AGENT node containing its messages
    for (const agentStart of agentStarts) {
      // Find message_start events for this agent
      // TASK_2025_096 FIX: Only collect ASSISTANT messages, not user messages.
      // When SDK invokes an agent, it sends a user message with the prompt.
      // We don't want to display the agent's prompt as content inside the agent bubble.
      const agentMessageStarts = [...state.events.values()].filter(
        (e) =>
          e.eventType === 'message_start' &&
          e.parentToolUseId === toolCallId &&
          (e as MessageStartEvent).role === 'assistant'
      ) as MessageStartEvent[];

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
          // Push the message's children (text, tools, etc.) as agent's children
          agentChildren.push(...messageNode.children);
        }
      }

      // TASK_2025_099: Get summaryContent using agentId (stable key)
      // agentId is consistent across hook (UUID toolCallId) and complete (toolu_* toolCallId)
      //
      // TASK_2025_099 FIX: If agentStart doesn't have agentId (complete events often don't),
      // try to find a matching hook-based agent_start event by agentType and use its agentId.
      let effectiveAgentId = agentStart.agentId;

      if (!effectiveAgentId) {
        // Find hook-based agent_start with matching agentType.
        // BUGFIX: When multiple agents of the same type exist in a session,
        // we must find the CLOSEST hook agent_start by timestamp, not just the first.
        let bestHookMatch: AgentStartEvent | undefined;
        let bestTimeDiff = Infinity;

        for (const e of state.events.values()) {
          if (
            e.eventType === 'agent_start' &&
            e.source === 'hook' &&
            (e as AgentStartEvent).agentType === agentStart.agentType &&
            (e as AgentStartEvent).agentId
          ) {
            const timeDiff = Math.abs(e.timestamp - agentStart.timestamp);
            if (timeDiff < bestTimeDiff) {
              bestTimeDiff = timeDiff;
              bestHookMatch = e as AgentStartEvent;
            }
          }
        }

        if (bestHookMatch?.agentId) {
          effectiveAgentId = bestHookMatch.agentId;
        }
      }

      // TASK_2025_102: Get structured content blocks for proper interleaving
      const contentBlocks = effectiveAgentId
        ? state.agentContentBlocksMap.get(effectiveAgentId) || []
        : [];

      // Legacy: Get summaryContent (fallback if no content blocks)
      const agentSummaryContent = effectiveAgentId
        ? state.agentSummaryAccumulators.get(effectiveAgentId) || undefined
        : undefined;

      // TASK_2025_102 FIX: Build interleaved children from content blocks
      // Content blocks preserve the original order: [text, tool_ref, text, tool_ref, ...]
      // We create text nodes for text blocks and find matching tool nodes for tool_ref blocks.
      let finalAgentChildren: ExecutionNode[];

      if (contentBlocks.length > 0) {
        // Use structured content blocks for proper interleaving
        finalAgentChildren = this.buildInterleavedChildren(
          agentStart.id,
          agentStart.timestamp,
          contentBlocks,
          agentChildren
        );
      } else if (agentSummaryContent && agentSummaryContent.trim()) {
        // Fallback: Use legacy summaryContent as single text node at beginning
        finalAgentChildren = [...agentChildren];
        const summaryTextNode = createExecutionNode({
          id: `${agentStart.id}-summary-text`,
          type: 'text',
          status: 'complete',
          content: agentSummaryContent,
          children: [],
          startTime: agentStart.timestamp,
        });
        finalAgentChildren.unshift(summaryTextNode);
      } else {
        // No summary content - just use tool children
        finalAgentChildren = [...agentChildren];
      }

      // TASK_2025_132: Aggregate stats from child message events for this agent
      const toolChildStats = this.aggregateAgentStats(toolCallId, state);

      // BUGFIX: Determine agent status from Task tool_result, not children count.
      // Same fix as buildAgentNode - ensures auto-scroll works during streaming.
      const hasAgentToolResult = [...state.events.values()].some(
        (e) =>
          e.eventType === 'tool_result' &&
          (e as ToolResultEvent).toolCallId === toolCallId
      );

      // Create the AGENT node from agent_start event
      // This wraps the nested content in a proper agent bubble
      const agentNode = createExecutionNode({
        id: agentStart.id,
        type: 'agent',
        status: hasAgentToolResult ? 'complete' : 'streaming',
        content: agentStart.agentDescription || '',
        children: finalAgentChildren,
        startTime: agentStart.timestamp,
        agentType: agentStart.agentType,
        agentDescription: agentStart.agentDescription,
        toolCallId: agentStart.toolCallId,
        agentId: effectiveAgentId, // TASK_2025_099 FIX: Use effectiveAgentId (from hook if needed)
        // summaryContent no longer needed on node - it's now a child text node
        ...toolChildStats, // TASK_2025_132: Spread agentModel, tokenUsage, cost, duration
        model: toolChildStats.agentModel, // TASK_2025_132: Also set model field for consistency
      });

      children.push(agentNode);
    }

    return children;
  }

  /**
   * TASK_2025_096: Find message_start event for a given messageId.
   * Used to check if a message is nested (has parentToolUseId) before
   * deciding whether to render it as a root node.
   *
   * @param state - Streaming state
   * @param messageId - The messageId to search for
   * @returns The message_start event if found, undefined otherwise
   */
  private findMessageStartEvent(
    state: StreamingState,
    messageId: string
  ): MessageStartEvent | undefined {
    const messageEvents = state.eventsByMessage.get(messageId);
    if (!messageEvents) return undefined;

    return messageEvents.find((e) => e.eventType === 'message_start') as
      | MessageStartEvent
      | undefined;
  }
}
