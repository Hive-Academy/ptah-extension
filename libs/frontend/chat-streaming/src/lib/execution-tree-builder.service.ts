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
 *    Inside a rebuilt root, each agent node is memoized on its TOOL digest
 *    (the same fold, per tool call), so a delta in one sub-agent rebuilds
 *    that agent's path and hands its siblings back by reference
 *    (TASK_2026_628).
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
import {
  HASH_SEED,
  agentMemoKey,
  agentMemoKeyBase,
  agentMemoSlot,
  computeTreeDigests,
  identityOf,
  mixNumber,
  pruneAgentMemo,
  sameStateIdentity,
  type ActiveAgentBuild,
  type AgentMemoEntry,
  type StreamingStateIdentity,
} from './execution-tree-cache';

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
  /** Derived indexes, valid while `indexIdentity`/`indexVersion` still match. */
  indexes: StreamingIndexes | null;
  /**
   * The containers the entry's digests were read from. Gates every reuse —
   * see {@link sameStateIdentity}.
   */
  indexIdentity: StreamingStateIdentity | null;
  indexVersion: string;
  /**
   * Per-agent memo, keyed by {@link agentMemoSlot}. Lets a rebuilt root hand
   * back an unchanged sibling agent's node without building its messages.
   * Belongs to `indexIdentity`: a new identity starts an empty memo.
   */
  agentNodeByToolCall: Map<string, AgentMemoEntry>;
}

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
   * Agent memo context the current {@link buildTree} call installed. `null`
   * outside a build, which makes the memoized `buildAgentNode` a plain build.
   */
  private activeAgentBuild: ActiveAgentBuild | null = null;

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
    ) => this.buildAgentNodeMemoized(agentStart, toolCallId, state, depth),
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
   *    (SDK sends multiple assistant messages per turn). A user root ends the
   *    merge and is not emitted — the tree holds assistant output only
   * 6. Stabilise object identity inside rebuilt subtrees via cheap fingerprints
   *
   * @param streamingState - Flat event storage
   * @param cacheKey - Optional cache key (defaults to 'default')
   */
  buildTree(
    streamingState: StreamingState,
    cacheKey = 'default',
    options?: { rootParentToolUseId?: string },
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
        options,
      );
    } finally {
      this.activeIndexes = null;
      this.activeAgentBuild = null;
    }
  }

  private buildTreeWithIndexes(
    streamingState: StreamingState,
    cacheKey: string,
    cached: TreeCacheEntry | undefined,
    indexes: StreamingIndexes,
    options?: { rootParentToolUseId?: string },
  ): ExecutionNode[] {
    const digests = computeTreeDigests(streamingState, indexes);
    const digestByRoot = digests.digestByRoot;
    const globalEpoch = this.computeGlobalEpoch(
      streamingState,
      digests.unattributedAgentContent,
    );

    const rootOrder: string[] = [];
    const startByRoot = new Map<string, MessageStartEvent | undefined>();
    for (const messageId of streamingState.messageEventIds) {
      const msgStartEvent = this.deps.findMessageStartEvent(
        streamingState,
        messageId,
      );
      if (options?.rootParentToolUseId !== undefined) {
        if (msgStartEvent?.parentToolUseId !== options.rootParentToolUseId) {
          continue;
        }
      } else if (msgStartEvent?.parentToolUseId) {
        continue;
      }
      rootOrder.push(messageId);
      startByRoot.set(messageId, msgStartEvent);
    }

    /**
     * Reuse — whole-tree below, per-root and per-agent inside the loop —
     * additionally requires the SAME STATE IDENTITY: the same `events`,
     * `eventsByMessage` and `messageRevisions` containers the cached digests
     * were read from (see {@link sameStateIdentity}). {@link resolveIndexes}
     * puts the same guard on its index memo.
     *
     * Every other input to the decision (the epoch, the digests, the root
     * order) is folded from CONTENT, and every counter feeding them restarts at
     * 1 for a new state. `applyResumingSession` installs a brand-new
     * `createEmptyStreamingState()` onto a tab that keeps its id, while the
     * cache key is `tab-${tabId}` — so a fresh state meets a cache entry whose
     * folds were computed from the state it replaced, and matching numbers no
     * longer mean matching content (TASK_2026_336). A fresh state has fresh
     * containers, so the identity check fails and nothing is reused — also
     * when it arrives as a flush copy, because the copy shares the FRESH
     * state's containers, not the old ones.
     *
     * Why containers and not the object: `BatchedUpdateService` publishes a
     * shallow `{ ...state }` copy on every flush. Keying on the object made
     * every flush a cache miss. The copy shares all three containers, and
     * every digest input (`messageRevisions.get`, bucket length) is read from
     * them, so two states with the same containers have comparable digests.
     * The streaming path mutates those containers IN PLACE (see the lib's
     * `CLAUDE.md`); every replacement producer (a resume, a fork that resets
     * to `null`, `compaction_complete`'s `replacementState`, the finalization
     * rebuild's `new Map(state.events)`) builds new ones.
     *
     * Residual risk: a future writer that `clear()`s these containers and
     * restarts the counters on the SAME objects would defeat this check, as it
     * would have defeated the object check. Replace the containers instead.
     */
    const sameIdentity =
      cached !== undefined &&
      sameStateIdentity(cached.indexIdentity, streamingState);
    const epochUnchanged = sameIdentity && cached?.globalEpoch === globalEpoch;
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

    const agentMemo =
      sameIdentity && cached
        ? cached.agentNodeByToolCall
        : new Map<string, AgentMemoEntry>();
    const activeAgentBuild: ActiveAgentBuild = {
      state: streamingState,
      memo: agentMemo,
      digestByToolCall: digests.digestByToolCall,
      keyBase: agentMemoKeyBase(streamingState, globalEpoch),
      built: [],
    };
    this.activeAgentBuild = activeAgentBuild;

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
      const role = startByRoot.get(messageId)?.role;
      // A user root — a mid-turn prompt boundary, or the SDK's echo of a
      // prompt — ends the assistant merge but is never a node. The prompt
      // renders from `messages`, and every consumer of this tree turns a root
      // into an ASSISTANT bubble.
      if (role === 'user') {
        lastAssistantNode = null;
        continue;
      }

      const reusable =
        cached && epochUnchanged
          ? this.reusableRootNode(cached, digestByRoot, messageId)
          : undefined;

      const messageNode =
        reusable ?? this.deps.buildMessageNode(messageId, streamingState);
      if (!messageNode) continue;
      nodeByRoot.set(messageId, messageNode);
      if (reusable) reusedRoots.add(reusable);

      const isAssistant = role === 'assistant';

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
    const postReuseAgents = new Map<ExecutionNode, ExecutionNode>();
    const reuseRoots = rootNodes.map((root) =>
      // A root that came straight out of the previous build is already the
      // post-reuse node and its fingerprints are already recorded — walking it
      // would only re-derive identical numbers.
      reusedRoots.has(root)
        ? root
        : this.reuseUnchangedSubtree(
            root,
            nodesById,
            fingerprintsById,
            postReuseAgents,
          ),
    );

    for (let i = 0; i < reuseRoots.length; i++) {
      const owner = ownerByRootIndex[i];
      if (owner) nodeByRoot.set(owner, reuseRoots[i]);
    }

    // Same write-back as `nodeByRoot`: a memo hit on the next build must hand
    // back the object the tree is rendering, so the reuse walk can stop there.
    for (const entry of activeAgentBuild.built) {
      entry.node = postReuseAgents.get(entry.node) ?? entry.node;
    }
    pruneAgentMemo(agentMemo, streamingState);

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
      indexIdentity: identityOf(streamingState),
      indexVersion: indexVersionOf(streamingState),
      agentNodeByToolCall: agentMemo,
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
   * Memoized per cacheKey on state identity ({@link sameStateIdentity}) PLUS
   * {@link indexVersionOf} — identity alone would go stale on in-place
   * mutation (the accumulator mutates `StreamingState` in place by design),
   * and the version alone would collide across two different states.
   */
  private resolveIndexes(
    streamingState: StreamingState,
    cached: TreeCacheEntry | undefined,
  ): StreamingIndexes {
    const version = indexVersionOf(streamingState);
    if (
      cached?.indexes &&
      sameStateIdentity(cached.indexIdentity, streamingState) &&
      cached.indexVersion === version
    ) {
      return cached.indexes;
    }
    return buildStreamingIndexes(streamingState);
  }

  /**
   * Fold the state-wide inputs that no per-message revision can observe: the
   * agent summary/content-block content NO ROOT could be shown to own, and the
   * background-agent flag set.
   *
   * Accumulator map sizes are folded in too so this subsumes every field the
   * pre-TASK_2026_323 memo fingerprint checked. A SIZE is a legitimate fold
   * only where a size-preserving change is impossible or is already visible
   * through another input:
   *
   * - `agentSummaryAccumulators` / `agentContentBlocksMap` (written by the
   *   agent file watcher, keyed by agentId, not by message) fold content
   *   length and block count, not size, and their only writer appends — so an
   *   in-place change always moves the number. An agent that
   *   {@link foldAgentContent} can trace to the tool that renders it is folded
   *   into that tool's digest and its root's digest instead, so one agent's
   *   summary chunk rebuilds only its own root (TASK_2026_628). Only the
   *   untraceable remainder arrives here as `unattributedAgentContent`, which
   *   keeps the pre-628 behaviour (rebuild everything) for exactly those.
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
  private computeGlobalEpoch(
    streamingState: StreamingState,
    unattributedAgentContent: number,
  ): number {
    let hash = HASH_SEED;
    hash = mixNumber(hash, unattributedAgentContent);
    hash = mixNumber(hash, streamingState.textAccumulators.size);
    hash = mixNumber(hash, streamingState.toolInputAccumulators.size);
    hash = mixNumber(hash, this.backgroundAgentStore.revision());
    return hash;
  }

  /**
   * `deps.buildAgentNode`, memoized per agent for the current build.
   *
   * The key folds everything the agent subtree reads that its tool digest does
   * not already cover:
   * - the tool digest: every message under the tool, at any depth, plus the
   *   agent content traced to it or to a tool below it;
   * - `structuralRevision`: bumped by every `message_start`, `tool_start`,
   *   `tool_result`, `agent_start`, `message_complete`, eviction and text
   *   block key change, i.e. everything that can change agent matching,
   *   status, stats or the hook-fallback agentId (`agent-node.fn.ts`);
   * - the global epoch: untraced agent content, accumulator sizes and the
   *   background-agent revision;
   * - this agent's own summary length and block count, and the depth.
   *
   * Bypassed (always built) when there is no active build for `state`, the
   * state is untracked, the tool has no digest, or the agent has no agentId —
   * the hook-match path, whose agentId depends on other agents' events.
   */
  private buildAgentNodeMemoized(
    agentStart: AgentStartEvent,
    toolCallId: string,
    state: StreamingState,
    depth: number,
  ): ExecutionNode | null {
    const build = this.activeAgentBuild;
    const key =
      build && build.state === state && agentStart.agentId
        ? agentMemoKey(build, agentStart.agentId, toolCallId, state, depth)
        : undefined;
    if (!build || key === undefined) {
      return buildAgentNodeFn(this.deps, agentStart, toolCallId, state, depth);
    }

    const slot = agentMemoSlot(toolCallId, agentStart.id);
    const hit = build.memo.get(slot);
    if (hit && hit.key === key && hit.agentStart === agentStart) {
      return hit.node;
    }

    const node = buildAgentNodeFn(
      this.deps,
      agentStart,
      toolCallId,
      state,
      depth,
    );
    if (!node) {
      build.memo.delete(slot);
      return null;
    }
    const entry: AgentMemoEntry = { key, agentStart, node };
    build.memo.set(slot, entry);
    build.built.push(entry);
    return node;
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
   *
   * A node that IS the object recorded for its id (a memoized agent node
   * handed back unchanged) is returned without a walk: nodes are immutable,
   * and `nodesById` / `fingerprintsById` are always written as a pair, so its
   * recorded fingerprint still describes it — the same reasoning that lets a
   * reused root skip this walk entirely.
   *
   * `postReuseAgents` records, for every agent node walked, the object that
   * replaced it, so the agent memo can store what the tree actually renders.
   */
  private reuseUnchangedSubtree(
    node: ExecutionNode,
    nodesById: Map<string, ExecutionNode>,
    fingerprintsById: Map<string, number>,
    postReuseAgents?: Map<ExecutionNode, ExecutionNode>,
  ): ExecutionNode {
    if (nodesById.get(node.id) === node && fingerprintsById.has(node.id)) {
      return node;
    }
    const result = this.reuseWalk(
      node,
      nodesById,
      fingerprintsById,
      postReuseAgents,
    );
    if (postReuseAgents && node.type === 'agent') {
      postReuseAgents.set(node, result);
    }
    return result;
  }

  private reuseWalk(
    node: ExecutionNode,
    nodesById: Map<string, ExecutionNode>,
    fingerprintsById: Map<string, number>,
    postReuseAgents?: Map<ExecutionNode, ExecutionNode>,
  ): ExecutionNode {
    const incomingChildren = node.children;
    let childrenChanged = false;
    const reusedChildren: ExecutionNode[] = new Array(incomingChildren.length);
    for (let i = 0; i < incomingChildren.length; i++) {
      const reusedChild = this.reuseUnchangedSubtree(
        incomingChildren[i],
        nodesById,
        fingerprintsById,
        postReuseAgents,
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
   *
   * ## What is deliberately NOT folded
   *
   * - **`startTime` / `endTime`.** A `complete` or `history` event legitimately
   *   supersedes a `stream` event under the same node id with a fresh
   *   timestamp, so folding either would invalidate node identity on every
   *   history replay and force exactly the whole-tree re-render the incremental
   *   rebuild exists to avoid (TASK_2026_323 Phase 3). Nothing renders them on
   *   their own — `duration`, which does render, IS folded. Leave them out.
   * - **`isCollapsed` / `isHighlighted`.** View state, and not this tree's:
   *   every renderer owns its own collapse signal locally
   *   (`tool-call-item`, `message-bubble`, `inline-agent-bubble`,
   *   `thinking-block`) and nothing reads either field off the node. A reuse
   *   key must not carry state the builder neither writes nor renders.
   *
   * `summaryContent` and `toolCount` were in neither category — both render on
   * an agent card, and both were simply missing, so a node whose summary or
   * tool count moved while every folded field stayed put kept its cached object
   * and rendered stale (TASK_2026_337).
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
    hash = mixString(hash, node.summaryContent ?? '');
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
    hash = mixNumber(hash, node.toolCount ?? -1);
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
    entry.indexIdentity = null;
    entry.agentNodeByToolCall.clear();
  }

  clearForTab(tabId: string): void {
    this.clearCache(`tab-${tabId}`);
  }

  /**
   * Release every memo a CLOSED tab can own: its `tab-${tabId}` entry (shared
   * by the main panel and any canvas tile of the tab) and its older-history
   * page entry (`history-page-${tabId}`, SessionHistoryReplayer). Close-only —
   * `clearForTab` keeps the history page because it also runs on finalization
   * and transcript-retention eviction while the tab is still open.
   */
  clearForClosedTab(tabId: string): void {
    this.clearForTab(tabId);
    this.clearCache(`history-page-${tabId}`);
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
