/**
 * ExecutionTreeBuilderService - Builds ExecutionNode tree from flat streaming events.
 *
 * ARCHITECTURE:
 * - Backend emits flat events with relationship IDs (messageId, toolCallId, parentToolUseId)
 * - Frontend stores flat events in Map (no tree building during streaming)
 * - This service builds ExecutionNode tree AT RENDER TIME from flat events
 *
 * Cycle remediation: the four sibling builder services were collapsed into
 * pure functions under `./execution-tree/builders/` because cross-service
 * `inject()` between MessageNode/ToolNode/AgentNode produced an Angular DI
 * cycle (NG0200) and a madge module cycle. Recursion now goes through a
 * callback-only {@link BuilderDeps} bag wired here.
 *
 * Owns:
 * - The memoization cache (treeCache + LRU eviction)
 * - The streaming-rebuild dedup Set for unmatched-Task warnings
 * - The assistant-message merge loop in {@link buildTree}
 * - Per-build cache reset of {@link AgentStatsService}
 */

import { Injectable, inject, isDevMode } from '@angular/core';
import type {
  AgentStartEvent,
  ExecutionNode,
  MessageStartEvent,
  ToolStartEvent,
} from '@ptah-extension/shared';
import type { StreamingState } from '@ptah-extension/chat-types';
import { BackgroundAgentStore } from './background-agent.store';
// Pure execution-tree helpers extracted to
// `@ptah-extension/chat-execution-tree`. The orchestrating service +
// BackgroundAgentStore stay here.
import {
  AgentStatsService,
  type BuilderDeps,
  buildMessageNode as buildMessageNodeFn,
  findMessageStartEvent as findMessageStartEventFn,
  buildToolNode as buildToolNodeFn,
  buildToolChildren as buildToolChildrenFn,
  collectTools as collectToolsFn,
  buildAgentNode as buildAgentNodeFn,
  buildInterleavedChildren as buildInterleavedChildrenFn,
} from '@ptah-extension/chat-execution-tree';

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
   * Total length (not just map size) so cache invalidates when content is
   * appended to existing agents.
   */
  agentSummaryTotalLength: number;
  /**
   * Total content blocks count so cache invalidates when new content blocks
   * are added for interleaving.
   */
  agentContentBlocksCount: number;
  backgroundAgentCount: number;
  tree: ExecutionNode[];
  /**
   * Map of every node id → reference in the previously-built tree, indexed
   * for the structural-reuse pass that runs on each non-trivial rebuild.
   */
  nodesById: Map<string, ExecutionNode>;
  /**
   * Structural fingerprint per node id from the previous build, computed
   * bottom-up. A new build's node is replaced by the previous reference
   * whenever its fingerprint matches.
   */
  fingerprintsById: Map<string, string>;
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
   *    (SDK sends multiple assistant messages per turn)
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

    // Clear per-build aggregation cache to avoid stale stats
    this.agentStats.resetPerBuildCache();

    const rootNodes: ExecutionNode[] = [];

    // Merge consecutive assistant messages into one root.
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

    // Structural reuse pass + diagnostic.
    // Walk the freshly-built tree bottom-up; for each node compute a content
    // fingerprint (id + key fields + children fingerprints). If the previous
    // build had a node at the same id with an identical fingerprint, reuse
    // the previous reference. This eliminates the OnPush re-render cascade in
    // unchanged subtrees (the highest-impact identity-churn fix).
    const reuseStats = { reused: 0, fresh: 0 };
    const newNodesById = new Map<string, ExecutionNode>();
    const newFingerprintsById = new Map<string, string>();
    const reuseRoots = rootNodes.map((root) =>
      this.reuseUnchangedSubtree(
        root,
        cached?.nodesById,
        cached?.fingerprintsById,
        newNodesById,
        newFingerprintsById,
        reuseStats,
      ),
    );

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
      tree: reuseRoots,
      nodesById: newNodesById,
      fingerprintsById: newFingerprintsById,
    });

    // Diagnostic: dev-only identity-churn log.
    // Useful to catch identity-churn regressions. Off in production.
    if (isDevMode()) {
      console.debug(
        `[TreeBuilder] reused: ${reuseStats.reused} / new: ${reuseStats.fresh} nodes (key: ${cacheKey})`,
      );
    }

    return reuseRoots;
  }

  /**
   * Recursively walk a freshly-built node, compute its structural
   * fingerprint, and either return the previous build's
   * node-at-same-id (when fingerprint matches) or the fresh node (with its
   * new children potentially reused).
   *
   * Children are processed first so the parent fingerprint can incorporate
   * children fingerprints — guarantees that identity-stable children imply
   * an identity-stable parent only when nothing else in the parent changed.
   */
  private reuseUnchangedSubtree(
    node: ExecutionNode,
    prevNodesById: Map<string, ExecutionNode> | undefined,
    prevFingerprintsById: Map<string, string> | undefined,
    outNodesById: Map<string, ExecutionNode>,
    outFingerprintsById: Map<string, string>,
    stats: { reused: number; fresh: number },
  ): ExecutionNode {
    const incomingChildren = node.children;
    let childrenChanged = false;
    const reusedChildren: ExecutionNode[] = new Array(incomingChildren.length);
    for (let i = 0; i < incomingChildren.length; i++) {
      const reusedChild = this.reuseUnchangedSubtree(
        incomingChildren[i],
        prevNodesById,
        prevFingerprintsById,
        outNodesById,
        outFingerprintsById,
        stats,
      );
      if (reusedChild !== incomingChildren[i]) childrenChanged = true;
      reusedChildren[i] = reusedChild;
    }

    // Use freshly-built node, but with reused children if any swapped.
    const candidate: ExecutionNode = childrenChanged
      ? { ...node, children: reusedChildren }
      : node;

    const fingerprint = this.fingerprintNode(candidate, outFingerprintsById);
    const prevFingerprint = prevFingerprintsById?.get(candidate.id);
    const prev = prevNodesById?.get(candidate.id);

    if (prev && prevFingerprint === fingerprint) {
      // Structurally equal — reuse the previous reference. Cache it under
      // its id and propagate the (identical) fingerprint forward.
      outNodesById.set(prev.id, prev);
      outFingerprintsById.set(prev.id, fingerprint);
      stats.reused++;
      return prev;
    }

    outNodesById.set(candidate.id, candidate);
    outFingerprintsById.set(candidate.id, fingerprint);
    stats.fresh++;
    return candidate;
  }

  /**
   * Compute a structural fingerprint for a node. Combines the discriminating
   * scalar fields with the (already-computed) fingerprints of its children.
   * Two nodes with the same fingerprint render identically and can share a
   * reference safely under OnPush change detection.
   */
  private fingerprintNode(
    node: ExecutionNode,
    fingerprintsById: Map<string, string>,
  ): string {
    const childFps: string[] = new Array(node.children.length);
    for (let i = 0; i < node.children.length; i++) {
      const child = node.children[i];
      const fp = fingerprintsById.get(child.id);
      // Children are visited first, so their fingerprint is always populated.
      childFps[i] = fp ?? `${child.id}:?`;
    }

    // Hash key surface area: fields that affect rendering. Stringify only
    // primitives/small payloads; nested children are represented by their ids
    // + fingerprints (already content-addressable).
    return [
      node.id,
      node.type,
      node.status,
      node.content ?? '',
      node.toolName ?? '',
      node.toolCallId ?? '',
      node.agentType ?? '',
      node.agentId ?? '',
      node.agentDescription ?? '',
      node.model ?? '',
      node.cost ?? 0,
      node.duration ?? 0,
      node.error ?? '',
      node.isPermissionRequest ? 1 : 0,
      node.isBackground ? 1 : 0,
      node.toolInput ? JSON.stringify(node.toolInput) : '',
      node.toolOutput !== undefined ? JSON.stringify(node.toolOutput) : '',
      node.tokenUsage
        ? `${node.tokenUsage.input}/${node.tokenUsage.output}`
        : '',
      childFps.join('|'),
    ].join('§');
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
