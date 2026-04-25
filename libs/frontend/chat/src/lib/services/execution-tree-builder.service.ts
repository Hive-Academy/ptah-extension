/**
 * ExecutionTreeBuilderService - Builds ExecutionNode tree from flat streaming events
 *
 * ARCHITECTURE (TASK_2025_082):
 * - Backend emits flat events with relationship IDs (messageId, toolCallId, parentToolUseId)
 * - Frontend stores flat events in Map (no tree building during streaming)
 * - This service builds ExecutionNode tree AT RENDER TIME from flat events
 *
 * Cycle remediation (post-Wave-C7f): the four sibling builder services were
 * collapsed into pure functions under `./execution-tree/builders/` because
 * cross-service `inject()` between MessageNode/ToolNode/AgentNode produced
 * an Angular DI cycle (NG0200) and a madge module cycle. Recursion now goes
 * through a callback-only {@link BuilderDeps} bag wired here.
 *
 * Owns:
 * - The memoization cache (treeCache + LRU eviction)
 * - The streaming-rebuild dedup Set for unmatched-Task warnings
 * - The assistant-message merge loop in {@link buildTree}
 * - Per-build cache reset of {@link AgentStatsService}
 */

import { Injectable, inject } from '@angular/core';
import type {
  AgentStartEvent,
  ExecutionNode,
  MessageStartEvent,
  ToolStartEvent,
} from '@ptah-extension/shared';
import type { StreamingState } from '@ptah-extension/chat-types';
import { BackgroundAgentStore } from './background-agent.store';
import { AgentStatsService } from './execution-tree/agent-stats.service';
import type { BuilderDeps } from './execution-tree/builders/builder-deps';
import {
  buildMessageNode as buildMessageNodeFn,
  findMessageStartEvent as findMessageStartEventFn,
} from './execution-tree/builders/message-node.fn';
import {
  buildToolNode as buildToolNodeFn,
  buildToolChildren as buildToolChildrenFn,
  collectTools as collectToolsFn,
} from './execution-tree/builders/tool-node.fn';
import {
  buildAgentNode as buildAgentNodeFn,
  buildInterleavedChildren as buildInterleavedChildrenFn,
} from './execution-tree/builders/agent-node.fn';

/**
 * PERFORMANCE OPTIMIZATION: Cache entry for memoized tree building.
 * Stores the built tree along with the event count used to build it.
 */
interface TreeCacheEntry {
  eventCount: number;
  messageEventIdsLength: number;
  textAccumulatorsSize: number;
  toolInputAccumulatorsSize: number;
  /**
   * TASK_2025_099: Total length (not just map size) so cache invalidates
   * when content is appended to existing agents.
   */
  agentSummaryTotalLength: number;
  /**
   * TASK_2025_102: Total content blocks count so cache invalidates when
   * new content blocks are added for interleaving.
   */
  agentContentBlocksCount: number;
  backgroundAgentCount: number;
  tree: ExecutionNode[];
}

@Injectable({ providedIn: 'root' })
export class ExecutionTreeBuilderService {
  private readonly backgroundAgentStore = inject(BackgroundAgentStore);
  private readonly agentStats = inject(AgentStatsService);

  /**
   * Memoization cache for tree building. Key: cacheKey (typically session-scoped).
   * Reduces tree building from 100+/sec to only when data actually changes.
   */
  private readonly treeCache = new Map<string, TreeCacheEntry>();

  /** Max cache entries before LRU-style eviction. */
  private readonly MAX_CACHE_SIZE = 50;

  /**
   * Tracks toolCallIds already logged as "unmatched" — keeps console.debug
   * from spamming hundreds of times during streaming rebuilds. Cleared by
   * {@link clearCache}() when called without a key.
   */
  private readonly loggedUnmatchedToolCallIds = new Set<string>();

  /**
   * BuilderDeps wired with closures back into this service. Each callback
   * forwards to the matching pure function with `this.deps` re-injected so
   * builders can recurse without importing each other at module level.
   *
   * Initialised once via class-field initializer — `this.agentStats` and
   * `this.backgroundAgentStore` are populated by `inject()` before this
   * runs, so the closures always see real refs.
   */
  private readonly deps: BuilderDeps = {
    backgroundAgentStore: this.backgroundAgentStore,
    agentStats: this.agentStats,
    loggedUnmatchedToolCallIds: this.loggedUnmatchedToolCallIds,
    buildMessageNode: (messageId: string, state: StreamingState, depth = 0) =>
      buildMessageNodeFn(this.deps, messageId, state, depth),
    findMessageStartEvent: (state: StreamingState, messageId: string) =>
      findMessageStartEventFn(state, messageId),
    buildToolNode: (
      toolStart: ToolStartEvent,
      state: StreamingState,
      depth = 0,
    ) => buildToolNodeFn(this.deps, toolStart, state, depth),
    buildToolChildren: (toolCallId: string, state: StreamingState, depth = 0) =>
      buildToolChildrenFn(this.deps, toolCallId, state, depth),
    collectTools: (messageId: string, state: StreamingState, depth: number) =>
      collectToolsFn(this.deps, messageId, state, depth),
    buildAgentNode: (
      agentStart: AgentStartEvent,
      toolCallId: string,
      state: StreamingState,
      depth: number,
    ) => buildAgentNodeFn(this.deps, agentStart, toolCallId, state, depth),
    buildInterleavedChildren: (
      agentId: string,
      baseTimestamp: number,
      contentBlocks: Array<{
        type: 'text' | 'tool_ref';
        text?: string;
        toolUseId?: string;
        toolName?: string;
      }>,
      toolChildren: ExecutionNode[],
    ) =>
      buildInterleavedChildrenFn(
        agentId,
        baseTimestamp,
        contentBlocks,
        toolChildren,
      ),
  };

  /**
   * Build ExecutionNode tree from flat events at render time.
   *
   * Memoized via cacheKey + state fingerprint (event count + accumulator
   * sizes + agent summary total length + content blocks count + background
   * agent count). Returns cached tree on fingerprint match.
   *
   * Algorithm:
   * 1. Compute fingerprint from streaming state + return cached tree on match
   * 2. Reset per-build aggregation cache
   * 3. Iterate messageEventIds, skipping nested messages
   * 4. Merge consecutive assistant messages into a single root node
   *    (TASK_2025_096 — SDK sends multiple assistant messages per turn)
   *
   * @param streamingState - Flat event storage
   * @param cacheKey - Optional cache key (defaults to 'default')
   */
  buildTree(
    streamingState: StreamingState,
    cacheKey = 'default',
  ): ExecutionNode[] {
    const eventCount = streamingState.events.size;
    const messageEventIdsLength = streamingState.messageEventIds.length;
    const textAccumulatorsSize = streamingState.textAccumulators.size;
    const toolInputAccumulatorsSize = streamingState.toolInputAccumulators.size;

    let agentSummaryTotalLength = 0;
    for (const content of streamingState.agentSummaryAccumulators.values()) {
      agentSummaryTotalLength += content.length;
    }

    let agentContentBlocksCount = 0;
    for (const blocks of streamingState.agentContentBlocksMap.values()) {
      agentContentBlocksCount += blocks.length;
    }

    const backgroundAgentCount =
      this.backgroundAgentStore.backgroundToolCallIds().size;

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
      return cached.tree;
    }

    // TASK_2025_132: Clear per-build aggregation cache to avoid stale stats
    this.agentStats.resetPerBuildCache();

    const rootNodes: ExecutionNode[] = [];

    // TASK_2025_096 FIX: Merge consecutive assistant messages into one root.
    let lastAssistantNode: ExecutionNode | null = null;

    for (const messageId of streamingState.messageEventIds) {
      const msgStartEvent = this.deps.findMessageStartEvent(
        streamingState,
        messageId,
      );
      if (msgStartEvent?.parentToolUseId) {
        // Nested messages render inside agent bubbles, not at root.
        continue;
      }

      const messageNode = this.deps.buildMessageNode(messageId, streamingState);
      if (!messageNode) continue;

      const isAssistant =
        (msgStartEvent as MessageStartEvent | undefined)?.role === 'assistant';

      if (isAssistant && lastAssistantNode) {
        // MERGE: append children to previous assistant node (immutable).
        if (messageNode.children && messageNode.children.length > 0) {
          const mergedChildren = [
            ...(lastAssistantNode.children || []),
            ...messageNode.children,
          ];
          const mergedNode: ExecutionNode = {
            ...lastAssistantNode,
            children: mergedChildren,
          };
          const lastIndex = rootNodes.length - 1;
          rootNodes[lastIndex] = mergedNode;
          lastAssistantNode = mergedNode;
        }
      } else {
        rootNodes.push(messageNode);
        lastAssistantNode = isAssistant ? messageNode : null;
      }
    }

    if (this.treeCache.size >= this.MAX_CACHE_SIZE) {
      const firstKey = this.treeCache.keys().next().value;
      if (firstKey) {
        this.treeCache.delete(firstKey);
      }
    }

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

  /** Clear cache for a specific key, or all entries (also resets unmatched log). */
  clearCache(cacheKey?: string): void {
    if (cacheKey) {
      this.treeCache.delete(cacheKey);
    } else {
      this.treeCache.clear();
      this.loggedUnmatchedToolCallIds.clear();
    }
  }
}
