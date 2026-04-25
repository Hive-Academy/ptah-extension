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
 * Wave C7f: Coordinator-only after the node-builder split. Owns the
 * memoization cache, fingerprint computation, LRU eviction, and the
 * assistant-message merge loop. Delegates node construction to four
 * sub-services under `./execution-tree/`.
 *
 * @example
 * ```typescript
 * // In computed signal
 * const tree = treeBuilder.buildTree(streamingState);
 * ```
 */

import { Injectable, inject } from '@angular/core';
import type { ExecutionNode } from '@ptah-extension/shared';
import type { StreamingState } from './chat.types';
import { BackgroundAgentStore } from './background-agent.store';
import { MessageNodeBuilderService } from './execution-tree/message-node-builder.service';
import { ToolNodeBuilderService } from './execution-tree/tool-node-builder.service';
import { AgentStatsService } from './execution-tree/agent-stats.service';

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
  /** Background agent count for cache invalidation when agents are registered */
  backgroundAgentCount: number;
  tree: ExecutionNode[];
}

@Injectable({ providedIn: 'root' })
export class ExecutionTreeBuilderService {
  private readonly backgroundAgentStore = inject(BackgroundAgentStore);
  private readonly messageBuilder = inject(MessageNodeBuilderService);
  private readonly toolBuilder = inject(ToolNodeBuilderService);
  private readonly agentStats = inject(AgentStatsService);

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
    cacheKey = 'default',
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
    // Background agent count: invalidate cache when agents are registered as background
    const backgroundAgentCount =
      this.backgroundAgentStore.backgroundToolCallIds().size;

    // Check cache for existing tree with matching fingerprint
    const cached = this.treeCache.get(cacheKey);
    if (
      cached &&
      cached.eventCount === eventCount &&
      cached.messageEventIdsLength === messageEventIdsLength &&
      cached.textAccumulatorsSize === textAccumulatorsSize &&
      cached.toolInputAccumulatorsSize === toolInputAccumulatorsSize &&
      cached.agentSummaryTotalLength === agentSummaryTotalLength &&
      cached.agentContentBlocksCount === agentContentBlocksCount &&
      cached.backgroundAgentCount === backgroundAgentCount
    ) {
      // Cache hit - return existing tree without rebuilding
      return cached.tree;
    }

    // Cache miss - build new tree
    // TASK_2025_132: Clear per-build aggregation cache to avoid stale stats
    this.agentStats.resetPerBuildCache();

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
      const msgStartEvent = this.messageBuilder.findMessageStartEvent(
        streamingState,
        messageId,
      );
      if (msgStartEvent?.parentToolUseId) {
        // Skip nested messages - they'll be rendered inside agent bubbles
        continue;
      }

      const messageNode = this.messageBuilder.buildMessageNode(
        messageId,
        streamingState,
      );
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
      backgroundAgentCount,
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
      this.toolBuilder.clearLoggedUnmatched();
    }
  }
}
