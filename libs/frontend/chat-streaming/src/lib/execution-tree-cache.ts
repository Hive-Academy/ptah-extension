/**
 * Reuse keys for {@link ExecutionTreeBuilderService}'s tree cache
 * (TASK_2026_628, Batch 2): the state identity that gates every reuse, the
 * per-root and per-tool digests, and the per-agent memo key.
 *
 * Pure functions over a `StreamingState` and its derived indexes. The cache
 * itself (and every decision to reuse) stays in the service.
 */

import type { AgentStartEvent, ExecutionNode } from '@ptah-extension/shared';
import type { StreamingState } from '@ptah-extension/chat-types';
import type { StreamingIndexes } from '@ptah-extension/chat-execution-tree';

/**
 * FNV-1a offset basis — the seed for every digest, memo key and fingerprint of the tree cache. Kept in
 * the signed 32-bit range for the same reason {@link mixNumber} is signed.
 */
export const HASH_SEED = 0x811c9dc5 | 0;

/**
 * The three containers every digest input is read from. A flush copy
 * (`{ ...state }`) shares all three, so it has the same identity as the state
 * it copies; a replaced state (`createEmptyStreamingState()`, the finalization
 * rebuild) always has new ones.
 */
export interface StreamingStateIdentity {
  readonly events: StreamingState['events'];
  readonly eventsByMessage: StreamingState['eventsByMessage'];
  readonly messageRevisions: StreamingState['messageRevisions'];
}

/** One memoized agent node and the key it was built under. */
export interface AgentMemoEntry {
  key: number;
  /** The exact event the node was built from; a replacement misses. */
  agentStart: AgentStartEvent;
  /** The post-reuse node, i.e. the object the rendered tree holds. */
  node: ExecutionNode;
}

/** Per-build digests. All are read from live containers, never from copies. */
export interface TreeDigests {
  /** Root messageId → digest of its whole subtree. */
  digestByRoot: Map<string, number>;
  /**
   * Tool call id → digest of every message that renders under it (at any
   * depth). The agent memo key.
   */
  digestByToolCall: Map<string, number>;
}

/** Everything the memoized `buildAgentNode` needs during one build. */
export interface ActiveAgentBuild {
  state: StreamingState;
  memo: Map<string, AgentMemoEntry>;
  digestByToolCall: ReadonlyMap<string, number>;
  /** `null` when the state is untracked: the memo is bypassed. */
  keyBase: number | null;
  /** Entries written in this build, for the post-reuse write-back. */
  built: AgentMemoEntry[];
}

/** Hop cap for the parent-tool chain walk (mirrors the root index's cap). */
const MAX_ANCESTOR_HOPS = 32;

/** Shared empty chain, so a root message allocates nothing. */
const NO_TOOLS: readonly string[] = [];

/**
 * One digest per ROOT message and one per TOOL CALL, each folding every
 * message that renders inside it, in one pass over `eventsByMessage`.
 *
 * A subagent's events carry the subagent's own messageId, so its writes bump
 * a revision the root never sees; `rootMessageIdByMessageId` walks the
 * `message_start.parentToolUseId → tool_start.messageId` chain to attribute
 * them. The same chain, kept as a list ({@link ancestorToolCalls}), gives
 * the per-tool digests: a delta in agent A's message moves the digest of A's
 * tool and of every tool above it, and of no sibling. Bucket length is folded
 * alongside the revision so a state whose writes bypassed
 * `setStreamingEventCapped` (a frozen deep copy, a spec literal) still
 * invalidates on append instead of going stale.
 */
export function computeTreeDigests(
  streamingState: StreamingState,
  indexes: StreamingIndexes,
): TreeDigests {
  const revisions = streamingState.messageRevisions;
  const digestByRoot = new Map<string, number>();
  const digestByToolCall = new Map<string, number>();
  const ancestorMemo = new Map<string, readonly string[]>();

  for (const [messageId, bucket] of streamingState.eventsByMessage) {
    const revision = revisions?.get(messageId) ?? 0;
    const root = indexes.rootMessageIdByMessageId.get(messageId) ?? messageId;
    foldPair(digestByRoot, root, revision, bucket.length);
    for (const toolCallId of ancestorToolCalls(
      messageId,
      indexes,
      ancestorMemo,
    )) {
      foldPair(digestByToolCall, toolCallId, revision, bucket.length);
    }
  }

  return { digestByRoot, digestByToolCall };
}

/** The containers of `state` that gate reuse. */
export function identityOf(state: StreamingState): StreamingStateIdentity {
  return {
    events: state.events,
    eventsByMessage: state.eventsByMessage,
    messageRevisions: state.messageRevisions,
  };
}

/**
 * Whether `state` holds the exact containers `identity` recorded, including
 * `messageRevisions` being absent on both sides. A missing identity never
 * matches, so a released or new entry always rebuilds.
 */
export function sameStateIdentity(
  identity: StreamingStateIdentity | null,
  state: StreamingState,
): boolean {
  return (
    identity !== null &&
    identity.events === state.events &&
    identity.eventsByMessage === state.eventsByMessage &&
    identity.messageRevisions === state.messageRevisions
  );
}

/**
 * Tool call ids above `messageId`, nearest first: its
 * `message_start.parentToolUseId`, then the parent of the message that owns
 * that tool, and so on. Memoized per build; hop-capped like the root index.
 */
function ancestorToolCalls(
  messageId: string,
  indexes: StreamingIndexes,
  memo: Map<string, readonly string[]>,
): readonly string[] {
  const known = memo.get(messageId);
  if (known) return known;

  let chain: string[] | null = null;
  let current = messageId;
  for (let hop = 0; hop < MAX_ANCESTOR_HOPS; hop++) {
    const parent =
      indexes.messageStartByMessageId.get(current)?.parentToolUseId;
    if (!parent) break;
    if (chain === null) chain = [];
    chain.push(parent);
    const owner = indexes.toolStartByCallId.get(parent);
    if (!owner || owner.messageId === current) break;
    current = owner.messageId;
  }

  const result = chain ?? NO_TOOLS;
  memo.set(messageId, result);
  return result;
}

/** Fold `(a, b)` into the digest stored under `key`. */
function foldPair(
  digests: Map<string, number>,
  key: string,
  a: number,
  b: number,
): void {
  digests.set(key, mixNumber(mixNumber(digests.get(key) ?? HASH_SEED, a), b));
}

/**
 * The state-wide part of every agent memo key, or `null` when the state is
 * untracked (no `structuralRevision` or no `messageRevisions`): then nothing
 * proves an agent unchanged and the memo is bypassed.
 */
export function agentMemoKeyBase(
  state: StreamingState,
  globalEpoch: number,
): number | null {
  if (
    state.structuralRevision === undefined ||
    state.messageRevisions === undefined
  ) {
    return null;
  }
  return mixNumber(mixNumber(HASH_SEED, globalEpoch), state.structuralRevision);
}

/** The memo key for one agent node, or `undefined` to bypass the memo. */
export function agentMemoKey(
  build: ActiveAgentBuild,
  toolCallId: string,
  depth: number,
): number | undefined {
  if (build.keyBase === null) return undefined;
  const digest = build.digestByToolCall.get(toolCallId);
  if (digest === undefined) return undefined;
  return mixNumber(mixNumber(build.keyBase, digest), depth);
}

/** Memo slot: one tool can carry several `agent_start` events. */
export function agentMemoSlot(
  toolCallId: string,
  agentStartId: string,
): string {
  return `${toolCallId}\u0000${agentStartId}`;
}

/**
 * Drop memo entries whose `agent_start` is no longer the live event for its
 * id (evicted at the cap, or replaced by a backfill). O(memo size) per
 * rebuild, which is O(agents).
 */
export function pruneAgentMemo(
  memo: Map<string, AgentMemoEntry>,
  state: StreamingState,
): void {
  for (const [slot, entry] of memo) {
    if (state.events.get(entry.agentStart.id) !== entry.agentStart) {
      memo.delete(slot);
    }
  }
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
export function mixNumber(hash: number, value: number): number {
  let next = Math.imul((hash ^ (value | 0)) | 0, HASH_PRIME) | 0;
  if (!Number.isInteger(value)) {
    // Fold the fraction so costs like 0.0031 are not all equal to 0.
    next =
      Math.imul((next ^ (Math.round(value * 1e6) | 0)) | 0, HASH_PRIME) | 0;
  }
  return next;
}
