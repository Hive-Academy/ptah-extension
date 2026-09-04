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
 * ## Incremental rebuild (TASK_2026_323, R1/R3)
 *
 * The previous memo keyed on `events.size`, and every `text_delta` inserts a
 * new event — so the cache missed on EVERY streamed chunk and rebuilt the tree
 * for the whole conversation. The reuse pass that followed then
 * `JSON.stringify`d every tool input and output and concatenated child
 * fingerprint strings, making the per-chunk cost proportional to total
 * transcript bytes.
 *
 * Both are gone. The build is now driven by three layers:
 *
 * 1. **Derived indexes** — {@link StreamingIndexes} is built ONCE per state
 *    version and shared by every builder, replacing per-node
 *    `[...state.events.values()]` spreads.
 * 2. **Per-root-message digests** — a message's digest folds its own write
 *    revision and every DESCENDANT message's (subagent messages resolve to
 *    their root through the tool that spawned them). Only roots whose digest
 *    moved are handed to `buildMessageNode`; the rest are reused by reference.
 *    When no root moved, `buildTree` returns the previous array untouched.
 * 3. **Cheap structural fingerprints** — a 32-bit numeric hash per node,
 *    computed from bounded samples (never a full `JSON.stringify`), used to
 *    keep object identity stable for OnPush inside a rebuilt subtree.
 *
 * Owns:
 * - The memoization cache (treeCache + LRU eviction + node-map pruning)
 * - The per-cacheKey index memo
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
import {
  AgentStatsService,
  buildStreamingIndexes,
  type BuilderDeps,
  type StreamingIndexes,
  buildMessageNode as buildMessageNodeFn,
  findMessageStartEvent as findMessageStartEventFn,
  buildToolNode as buildToolNodeFn,
  buildToolChildren as buildToolChildrenFn,
  collectTools as collectToolsFn,
  buildAgentNode as buildAgentNodeFn,
  buildInterleavedChildren as buildInterleavedChildrenFn,
} from '@ptah-extension/chat-execution-tree';

/**
 * Memoized tree + everything needed to decide what may be reused next time.
 *
 * `nodesById` / `fingerprintsById` are LONG-LIVED and mutated in place across
 * builds rather than rebuilt: a subtree that was reused by reference is
 * byte-identical, so its previously recorded fingerprints are still valid and
 * re-walking it only to re-derive the same numbers would defeat the point. A
 * stale entry for a node that later disappears can never cause a wrong reuse —
 * reuse requires the fingerprint to match, and a matching fingerprint means the
 * node renders identically.
 *
 * They are, however, PRUNED — see
 * {@link ExecutionTreeBuilderService.pruneNodeMaps}. "Cannot cause a wrong
 * reuse" is not the same as "may be kept forever": every message evicted at
 * `STREAMING_EVENT_CAP` leaves its nodes behind in both maps, so a long session
 * accumulated one dead entry per node it had ever rendered while the tree
 * itself stayed capped.
 */
interface TreeCacheEntry {
  /** Fold of the state-wide inputs no per-message revision can observe. */
  globalEpoch: number;
  /** Root messageId → digest of its whole subtree at build time. */
  digestByRoot: Map<string, number>;
  /** Root messageId → the message node built for it (pre-merge). */
  nodeByRoot: Map<string, ExecutionNode>;
  /** Root message ids in render order, to detect insertions/removals. */
  rootOrder: string[];
  tree: ExecutionNode[];
  /** Every node id → its reference in the previously-built tree. */
  nodesById: Map<string, ExecutionNode>;
  /** Every node id → its structural fingerprint from the previous build. */
  fingerprintsById: Map<string, number>;
  /**
   * Number of nodes the tree actually held at the last prune. The next prune
   * is due once the maps have grown {@link NODE_MAP_PRUNE_GROWTH}× past it —
   * see {@link ExecutionTreeBuilderService.pruneNodeMaps}.
   */
  liveNodeCount: number;
  /** Derived indexes, valid while `indexState`/`indexVersion` still match. */
  indexes: StreamingIndexes | null;
  indexState: StreamingState | null;
  indexVersion: string;
}

/**
 * FNV-1a offset basis — the seed for every fingerprint in this file. Kept in
 * the signed 32-bit range for the same reason {@link mixNumber} is signed.
 */
const HASH_SEED = 0x811c9dc5 | 0;

/** Max characters sampled from a string when folding it into a fingerprint. */
const STRING_SAMPLE_BUDGET = 64;

/** Max object keys / array entries folded into a fingerprint at one level. */
const VALUE_ENTRY_BUDGET = 24;

/** How deep {@link ExecutionTreeBuilderService.mixValue} descends. */
const VALUE_DEPTH_BUDGET = 2;

/**
 * Node-map size below which pruning is not worth a tree walk.
 *
 * A conversation this small is nowhere near the event cap, so it has nothing
 * dead in its maps yet; the floor keeps a short session from paying an O(nodes)
 * sweep on every single rebuild for entries that do not exist.
 */
const NODE_MAP_PRUNE_FLOOR = 512;

/**
 * How far past the live node count the maps may grow before a prune runs.
 *
 * The prune costs O(live nodes) and only fires once the maps have DOUBLED
 * relative to the last one, so its cost is amortized O(1) per node added —
 * the same slack-then-rebuild shape `AgentMonitorStore` uses for its stream
 * buffer. Pruning on every build instead would put a full tree walk back on
 * the hot path that the incremental rebuild exists to keep off it.
 */
const NODE_MAP_PRUNE_GROWTH = 2;

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
   * Index resolver handed to the builders. Reads the memo slot the current
   * {@link buildTree} call installed; falls back to deriving fresh indexes so a
   * builder invoked outside a build (or against a different state) is still
   * correct rather than silently stale.
   */
  private activeIndexes: {
    state: StreamingState;
    indexes: StreamingIndexes;
  } | null = null;

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
    getIndexes: (state: StreamingState) =>
      this.activeIndexes?.state === state
        ? this.activeIndexes.indexes
        : buildStreamingIndexes(state),
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
   * Algorithm:
   * 1. Resolve (and memoize) the derived event indexes for this state version
   * 2. Compute the global epoch + one digest per root message
   * 3. Return the previous tree untouched when nothing moved
   * 4. Rebuild ONLY the root messages whose digest moved; reuse the rest
   * 5. Merge consecutive assistant messages into a single root node
   *    (SDK sends multiple assistant messages per turn)
   * 6. Stabilise object identity inside rebuilt subtrees via cheap fingerprints
   *
   * @param streamingState - Flat event storage
   * @param cacheKey - Optional cache key (defaults to 'default')
   */
  buildTree(
    streamingState: StreamingState,
    cacheKey = 'default',
  ): ExecutionNode[] {
    const cached = this.treeCache.get(cacheKey);
    const indexes = this.resolveIndexes(streamingState, cached);
    this.activeIndexes = { state: streamingState, indexes };
    try {
      return this.buildTreeWithIndexes(
        streamingState,
        cacheKey,
        cached,
        indexes,
      );
    } finally {
      this.activeIndexes = null;
    }
  }

  private buildTreeWithIndexes(
    streamingState: StreamingState,
    cacheKey: string,
    cached: TreeCacheEntry | undefined,
    indexes: StreamingIndexes,
  ): ExecutionNode[] {
    const globalEpoch = this.computeGlobalEpoch(streamingState);
    const digestByRoot = this.computeRootDigests(streamingState, indexes);

    const rootOrder: string[] = [];
    const startByRoot = new Map<string, MessageStartEvent | undefined>();
    for (const messageId of streamingState.messageEventIds) {
      const msgStartEvent = this.deps.findMessageStartEvent(
        streamingState,
        messageId,
      );
      if (msgStartEvent?.parentToolUseId) continue;
      rootOrder.push(messageId);
      startByRoot.set(messageId, msgStartEvent);
    }

    const epochUnchanged = cached?.globalEpoch === globalEpoch;
    if (
      cached &&
      epochUnchanged &&
      sameOrder(cached.rootOrder, rootOrder) &&
      rootOrder.every(
        (id) => cached.digestByRoot.get(id) === digestByRoot.get(id),
      )
    ) {
      return cached.tree;
    }

    this.agentStats.resetPerBuildCache();

    const nodeByRoot = new Map<string, ExecutionNode>();
    const reusedRoots = new Set<ExecutionNode>();
    const rootNodes: ExecutionNode[] = [];
    /**
     * `rootNodes[i]` → the message that owns it, or `null` once a merge has
     * replaced that slot with a combined node. Lets the post-reuse identities
     * be written back into `nodeByRoot`, so a message reused on the NEXT build
     * hands back the same object the tree is already rendering.
     */
    const ownerByRootIndex: Array<string | null> = [];
    let lastAssistantNode: ExecutionNode | null = null;

    for (const messageId of rootOrder) {
      const reusable =
        cached && epochUnchanged
          ? this.reusableRootNode(cached, digestByRoot, messageId)
          : undefined;

      const messageNode =
        reusable ?? this.deps.buildMessageNode(messageId, streamingState);
      if (!messageNode) continue;
      nodeByRoot.set(messageId, messageNode);
      if (reusable) reusedRoots.add(reusable);

      const isAssistant = startByRoot.get(messageId)?.role === 'assistant';

      if (isAssistant && lastAssistantNode) {
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
          ownerByRootIndex[lastIndex] = null;
          lastAssistantNode = mergedNode;
        }
      } else {
        rootNodes.push(messageNode);
        ownerByRootIndex.push(messageId);
        lastAssistantNode = isAssistant ? messageNode : null;
      }
    }

    const nodesById = cached?.nodesById ?? new Map<string, ExecutionNode>();
    const fingerprintsById =
      cached?.fingerprintsById ?? new Map<string, number>();
    const reuseRoots = rootNodes.map((root) =>
      // A root that came straight out of the previous build is already the
      // post-reuse node and its fingerprints are already recorded — walking it
      // would only re-derive identical numbers.
      reusedRoots.has(root)
        ? root
        : this.reuseUnchangedSubtree(root, nodesById, fingerprintsById),
    );

    for (let i = 0; i < reuseRoots.length; i++) {
      const owner = ownerByRootIndex[i];
      if (owner) nodeByRoot.set(owner, reuseRoots[i]);
    }

    const liveNodeCount = this.pruneNodeMaps(
      reuseRoots,
      nodesById,
      fingerprintsById,
      cached?.liveNodeCount ?? 0,
    );

    if (!cached && this.treeCache.size >= this.MAX_CACHE_SIZE) {
      const firstKey = this.treeCache.keys().next().value;
      if (firstKey) {
        this.treeCache.delete(firstKey);
      }
    }

    this.treeCache.set(cacheKey, {
      globalEpoch,
      digestByRoot,
      nodeByRoot,
      rootOrder,
      tree: reuseRoots,
      nodesById,
      fingerprintsById,
      liveNodeCount,
      indexes,
      indexState: streamingState,
      indexVersion: indexVersionOf(streamingState),
    });

    return reuseRoots;
  }

  /**
   * Drop `nodesById` / `fingerprintsById` entries whose node id is no longer
   * anywhere in the rebuilt tree, and return the live node count.
   *
   * ## Why the maps needed a bound at all
   *
   * They are keyed by node id and written on every rebuilt subtree, but nothing
   * ever removed a key. `StreamingState.events` is capped at
   * `STREAMING_EVENT_CAP`, and the cap's cascade drops the evicted message from
   * `messageEventIds` — so the TREE shrinks while these two maps keep the
   * nodes that tree no longer contains. Over a long session that is one dead
   * entry (plus one retained `ExecutionNode`, with its `toolInput` and
   * `toolOutput` payloads) per node ever rendered: the exact unbounded growth
   * the event cap exists to prevent, moved one layer down.
   *
   * ## Why it is amortized, not every build
   *
   * Collecting live ids is O(nodes in tree) — precisely the whole-tree walk the
   * incremental rebuild is built to avoid on the streaming hot path. So the
   * walk runs only once the maps have grown {@link NODE_MAP_PRUNE_GROWTH}×
   * past the live count measured at the previous prune (and never below
   * {@link NODE_MAP_PRUNE_FLOOR}). Each prune therefore pays for at least as
   * many map insertions as it costs, leaving the maps bounded by a constant
   * multiple of the live tree instead of by the session's whole history.
   *
   * Deleting during `Map` key iteration is well-defined: entries already
   * visited or being visited may be removed without disturbing the walk.
   */
  private pruneNodeMaps(
    tree: readonly ExecutionNode[],
    nodesById: Map<string, ExecutionNode>,
    fingerprintsById: Map<string, number>,
    liveNodeCount: number,
  ): number {
    const threshold = Math.max(
      NODE_MAP_PRUNE_FLOOR,
      liveNodeCount * NODE_MAP_PRUNE_GROWTH,
    );
    if (nodesById.size < threshold && fingerprintsById.size < threshold) {
      return liveNodeCount;
    }

    const live = new Set<string>();
    collectNodeIds(tree, live);

    for (const id of nodesById.keys()) {
      if (!live.has(id)) nodesById.delete(id);
    }
    for (const id of fingerprintsById.keys()) {
      if (!live.has(id)) fingerprintsById.delete(id);
    }

    return live.size;
  }

  /**
   * The previously built node for `messageId`, when its subtree provably did
   * not change. `undefined` means "rebuild it".
   */
  private reusableRootNode(
    cached: TreeCacheEntry,
    digestByRoot: ReadonlyMap<string, number>,
    messageId: string,
  ): ExecutionNode | undefined {
    const previous = cached.nodeByRoot.get(messageId);
    if (!previous) return undefined;
    const before = cached.digestByRoot.get(messageId);
    if (before === undefined) return undefined;
    return before === digestByRoot.get(messageId) ? previous : undefined;
  }

  /**
   * Derive (or reuse) the secondary indexes for `streamingState`.
   *
   * Memoized per cacheKey on object identity PLUS `${events.size}:${revision}`
   * — identity alone would go stale on in-place mutation (the accumulator
   * mutates `StreamingState` in place by design), and the version alone would
   * collide across two different states of equal size.
   */
  private resolveIndexes(
    streamingState: StreamingState,
    cached: TreeCacheEntry | undefined,
  ): StreamingIndexes {
    const version = indexVersionOf(streamingState);
    if (
      cached?.indexes &&
      cached.indexState === streamingState &&
      cached.indexVersion === version
    ) {
      return cached.indexes;
    }
    return buildStreamingIndexes(streamingState);
  }

  /**
   * Fold the state-wide inputs that no per-message revision can observe:
   * agent summary/content-block content (written by the agent file watcher,
   * keyed by agentId, not by message) and the background-agent flag set.
   *
   * Accumulator map sizes are folded in too so this subsumes every field the
   * pre-TASK_2026_323 memo fingerprint checked. A SIZE is a legitimate fold
   * only where a size-preserving change is impossible or is already visible
   * through another input:
   *
   * - `agentSummaryAccumulators` / `agentContentBlocksMap` fold total content
   *   length and total block count, not size, and their only writer appends —
   *   so an in-place change always moves the number.
   * - `textAccumulators` / `toolInputAccumulators` fold size, and their
   *   content DOES change in place — but every writer of both also routes the
   *   event through `setStreamingEventCapped`, so the owning message's digest
   *   moves and the epoch does not have to see it.
   * - the background-agent set folded its SIZE and had neither property: its
   *   membership decides `isBackground` (read live per node), the
   *   `background_agent_*` events write no streaming event at all, and a
   *   member can be swapped for another within one frame at constant
   *   cardinality. It now folds `BackgroundAgentStore.revision` — a monotonic
   *   per-mutation counter — which is O(1) and cannot be defeated by a
   *   size-preserving swap (TASK_2026_333).
   */
  private computeGlobalEpoch(streamingState: StreamingState): number {
    let agentSummaryTotalLength = 0;
    for (const content of streamingState.agentSummaryAccumulators.values()) {
      agentSummaryTotalLength += content.length;
    }

    let agentContentBlocksCount = 0;
    for (const blocks of streamingState.agentContentBlocksMap.values()) {
      agentContentBlocksCount += blocks.length;
    }

    let hash = HASH_SEED;
    hash = mixNumber(hash, agentSummaryTotalLength);
    hash = mixNumber(hash, agentContentBlocksCount);
    hash = mixNumber(hash, streamingState.textAccumulators.size);
    hash = mixNumber(hash, streamingState.toolInputAccumulators.size);
    hash = mixNumber(hash, this.backgroundAgentStore.revision());
    return hash;
  }

  /**
   * One digest per ROOT message, folding every message that renders inside it.
   *
   * A subagent's events carry the subagent's own messageId, so its writes bump
   * a revision the root never sees; `rootMessageIdByMessageId` walks the
   * `message_start.parentToolUseId → tool_start.messageId` chain to attribute
   * them. Bucket length is folded alongside the revision so a state whose
   * writes bypassed `setStreamingEventCapped` (a frozen deep copy, a spec
   * literal) still invalidates on append instead of going stale.
   */
  private computeRootDigests(
    streamingState: StreamingState,
    indexes: StreamingIndexes,
  ): Map<string, number> {
    const revisions = streamingState.messageRevisions;
    const digestByRoot = new Map<string, number>();

    for (const [messageId, bucket] of streamingState.eventsByMessage) {
      const root = indexes.rootMessageIdByMessageId.get(messageId) ?? messageId;
      let hash = digestByRoot.get(root) ?? HASH_SEED;
      hash = mixNumber(hash, revisions?.get(messageId) ?? 0);
      hash = mixNumber(hash, bucket.length);
      digestByRoot.set(root, hash);
    }

    return digestByRoot;
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
   *
   * `nodesById` / `fingerprintsById` are read AND written: a child overwrites
   * its own entry before the parent reads the parent's own (still previous)
   * entry, so a single pair of maps is enough.
   */
  private reuseUnchangedSubtree(
    node: ExecutionNode,
    nodesById: Map<string, ExecutionNode>,
    fingerprintsById: Map<string, number>,
  ): ExecutionNode {
    const incomingChildren = node.children;
    let childrenChanged = false;
    const reusedChildren: ExecutionNode[] = new Array(incomingChildren.length);
    for (let i = 0; i < incomingChildren.length; i++) {
      const reusedChild = this.reuseUnchangedSubtree(
        incomingChildren[i],
        nodesById,
        fingerprintsById,
      );
      if (reusedChild !== incomingChildren[i]) childrenChanged = true;
      reusedChildren[i] = reusedChild;
    }
    const candidate: ExecutionNode = childrenChanged
      ? { ...node, children: reusedChildren }
      : node;

    const previous = nodesById.get(candidate.id);
    const previousFingerprint = fingerprintsById.get(candidate.id);
    const fingerprint = this.fingerprintNode(candidate, fingerprintsById);

    if (previous && previousFingerprint === fingerprint) {
      nodesById.set(previous.id, previous);
      fingerprintsById.set(previous.id, fingerprint);
      return previous;
    }

    nodesById.set(candidate.id, candidate);
    fingerprintsById.set(candidate.id, fingerprint);
    return candidate;
  }

  /**
   * Compute a structural fingerprint for a node: the discriminating scalar
   * fields folded with the (already-computed) fingerprints of its children.
   * Two nodes with the same fingerprint render identically and can share a
   * reference safely under OnPush change detection.
   *
   * Every fold is bounded — long strings are stride-sampled, `toolInput` /
   * `toolOutput` are described structurally to a fixed depth and key budget.
   * The predecessor of this method `JSON.stringify`d both payloads and joined
   * child fingerprint STRINGS, which made one rebuild cost a pass over the
   * whole transcript (TASK_2026_323 R3).
   */
  private fingerprintNode(
    node: ExecutionNode,
    fingerprintsById: ReadonlyMap<string, number>,
  ): number {
    let hash = HASH_SEED;
    hash = mixString(hash, node.id);
    hash = mixString(hash, node.type);
    hash = mixString(hash, node.status);
    hash = mixString(hash, node.content ?? '');
    hash = mixString(hash, node.toolName ?? '');
    hash = mixString(hash, node.toolCallId ?? '');
    hash = mixString(hash, node.agentType ?? '');
    hash = mixString(hash, node.agentId ?? '');
    hash = mixString(hash, node.agentDescription ?? '');
    hash = mixString(hash, node.model ?? '');
    hash = mixNumber(hash, node.cost ?? 0);
    hash = mixNumber(hash, node.duration ?? 0);
    hash = mixString(hash, node.error ?? '');
    hash = mixNumber(hash, node.isPermissionRequest ? 1 : 0);
    hash = mixNumber(hash, node.isBackground ? 1 : 0);
    hash = this.mixValue(hash, node.toolInput, VALUE_DEPTH_BUDGET);
    hash = this.mixValue(hash, node.toolOutput, VALUE_DEPTH_BUDGET);
    hash = mixNumber(hash, node.tokenUsage?.input ?? -1);
    hash = mixNumber(hash, node.tokenUsage?.output ?? -1);
    for (const child of node.children) {
      hash = mixNumber(hash, fingerprintsById.get(child.id) ?? HASH_SEED);
    }
    return hash;
  }

  /**
   * Fold an arbitrary tool payload into `hash` in bounded time: strings are
   * stride-sampled, containers contribute their size plus the first
   * {@link VALUE_ENTRY_BUDGET} entries, and recursion stops at `depth === 0`
   * (where a container contributes only its size).
   */
  private mixValue(hash: number, value: unknown, depth: number): number {
    if (value === undefined) return mixNumber(hash, 0);
    if (value === null) return mixNumber(hash, 1);

    switch (typeof value) {
      case 'string':
        return mixString(mixNumber(hash, 2), value);
      case 'number':
        return mixNumber(mixNumber(hash, 3), value);
      case 'boolean':
        return mixNumber(hash, value ? 4 : 5);
      case 'object':
        break;
      default:
        return mixNumber(hash, 6);
    }

    if (Array.isArray(value)) {
      let next = mixNumber(mixNumber(hash, 7), value.length);
      if (depth === 0) return next;
      const limit = Math.min(value.length, VALUE_ENTRY_BUDGET);
      for (let i = 0; i < limit; i++) {
        next = this.mixValue(next, value[i], depth - 1);
      }
      return next;
    }

    const entries = Object.entries(value as Record<string, unknown>);
    let next = mixNumber(mixNumber(hash, 8), entries.length);
    if (depth === 0) return next;
    const limit = Math.min(entries.length, VALUE_ENTRY_BUDGET);
    for (let i = 0; i < limit; i++) {
      next = mixString(next, entries[i][0]);
      next = this.mixValue(next, entries[i][1], depth - 1);
    }
    return next;
  }

  /** Clear cache for a specific key, or all entries (also resets unmatched log). */
  clearCache(cacheKey?: string): void {
    if (cacheKey) {
      const entry = this.treeCache.get(cacheKey);
      if (entry) {
        this.releaseEntry(entry);
        this.treeCache.delete(cacheKey);
      }
    } else {
      for (const entry of this.treeCache.values()) {
        this.releaseEntry(entry);
      }
      this.treeCache.clear();
      this.loggedUnmatchedToolCallIds.clear();
    }
  }

  private releaseEntry(entry: TreeCacheEntry): void {
    entry.nodesById.clear();
    entry.fingerprintsById.clear();
    entry.nodeByRoot.clear();
    entry.digestByRoot.clear();
    entry.indexes = null;
    entry.indexState = null;
  }

  clearForTab(tabId: string): void {
    this.clearCache(`tab-${tabId}`);
  }

  clearForSession(sessionId: string): void {
    this.clearCache(`session-${sessionId}`);
    this.clearCache(sessionId);
  }
}

/**
 * Cheap identity of the state version the derived indexes were built from.
 *
 * Prefers `structuralRevision`, which a plain `text_delta` does NOT bump — that
 * is what lets a burst of deltas share one O(events) index pass instead of
 * paying for a fresh one per chunk. A state that never received a tracked write
 * has no counter, so it falls back to the conservative size+revision key and
 * simply re-derives.
 */
function indexVersionOf(state: StreamingState): string {
  return state.structuralRevision !== undefined
    ? `s${state.structuralRevision}`
    : `f${state.events.size}:${state.revision ?? -1}`;
}

/** Collect every node id in `nodes` and their descendants into `into`. */
function collectNodeIds(
  nodes: readonly ExecutionNode[],
  into: Set<string>,
): void {
  for (const node of nodes) {
    into.add(node.id);
    collectNodeIds(node.children, into);
  }
}

function sameOrder(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

/** FNV-1a prime, applied via `Math.imul` so the product stays 32-bit. */
const HASH_PRIME = 0x01000193;

/**
 * FNV-1a style 32-bit mix of a numeric value.
 *
 * Deliberately SIGNED (`| 0`, not `>>> 0`): an unsigned fold produces values
 * above 2^31, which leave V8's small-integer range and box every intermediate
 * as a heap number. Measured on the 5 000-delta guard in this lib's spec, that
 * boxing alone made the fingerprint pass several times more expensive than
 * building the nodes it exists to let us skip. Sign is irrelevant here — the
 * result is only ever compared for equality.
 */
function mixNumber(hash: number, value: number): number {
  let next = Math.imul((hash ^ (value | 0)) | 0, HASH_PRIME) | 0;
  if (!Number.isInteger(value)) {
    // Fold the fraction so costs like 0.0031 are not all equal to 0.
    next =
      Math.imul((next ^ (Math.round(value * 1e6) | 0)) | 0, HASH_PRIME) | 0;
  }
  return next;
}

/**
 * Fold a string in O(1): its length plus at most
 * {@link STRING_SAMPLE_BUDGET} stride-sampled character codes.
 *
 * Bounded on purpose — an assistant message grows by a few characters per
 * streamed chunk, and hashing the whole thing on every rebuild is exactly the
 * byte-proportional cost this rewrite removes. Length alone already separates
 * every append; the samples separate same-length replacements.
 */
function mixString(hash: number, value: string): number {
  let next = mixNumber(hash, value.length);
  if (value.length === 0) return next;
  const stride = Math.max(1, Math.ceil(value.length / STRING_SAMPLE_BUDGET));
  for (let i = 0; i < value.length; i += stride) {
    next = mixNumber(next, value.charCodeAt(i));
  }
  // The tail is never sampled by a stride walk when length % stride !== 1.
  return mixNumber(next, value.charCodeAt(value.length - 1));
}
