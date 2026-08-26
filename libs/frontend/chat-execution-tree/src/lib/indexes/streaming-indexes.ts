/**
 * Secondary indexes over `StreamingState.events`, derived in ONE pass.
 *
 * Why this exists (TASK_2026_323, renderer findings R1/R2): every builder used
 * to answer its relational questions with `[...state.events.values()].filter(…)`
 * or `.find(…)`. That spreads the whole events Map — up to
 * `STREAMING_EVENT_CAP` (5 000) entries — once PER NODE, so a conversation with
 * `n` nodes cost `O(n × events)` per rebuild, and a rebuild happened on every
 * streamed chunk. Building the same answers once per state version turns that
 * into `O(events + n)`.
 *
 * Purity contract: this is a pure derivation of `state`. It caches nothing —
 * memoization is the orchestrator's job (`ExecutionTreeBuilderService` in
 * `@ptah-extension/chat-streaming`), per this lib's guideline 2.
 *
 * Ordering contract: every bucket preserves `state.events` insertion order, and
 * every `*By*Id` single-value map keeps the FIRST match. That is exactly what
 * the `.filter` / `.find` scans it replaces produced, so node ids, child order
 * and statuses are unchanged.
 */

import type {
  AgentStartEvent,
  FlatStreamEventUnion,
  MessageCompleteEvent,
  MessageStartEvent,
  ToolResultEvent,
  ToolStartEvent,
} from '@ptah-extension/shared';
import type { StreamingState } from '@ptah-extension/chat-types';

/** Separator for composite index keys. Not legal inside an SDK id. */
const KEY_SEP = '\u0000';

/** Composite key for {@link StreamingIndexes.firstDeltaByBlock}. */
export function blockDeltaKey(
  messageId: string,
  kind: 'text' | 'thinking',
  blockIndex: number,
): string {
  return `${messageId}${KEY_SEP}${kind}${KEY_SEP}${blockIndex}`;
}

/**
 * One `textAccumulators` entry that belongs to a message.
 *
 * Deliberately carries the KEY, not the accumulated content: content changes on
 * every single delta, and an index that mirrored it could never be reused
 * across a streamed chunk. Readers pull the current value out of
 * `state.textAccumulators` at build time instead.
 */
export interface AccumulatedBlock {
  /** The `textAccumulators` key this block was found under. */
  readonly key: string;
  /** Parsed block index (`NaN` never escapes — unparseable keys are skipped). */
  readonly blockIndex: number;
}

/**
 * Derived lookup tables for one version of a {@link StreamingState}.
 *
 * Every field answers a question a builder used to answer with a full scan.
 * All maps are read-only; callers copy before sorting.
 */
export interface StreamingIndexes {
  /** `tool_start` events grouped by owning `messageId`. */
  readonly toolStartsByMessage: ReadonlyMap<string, readonly ToolStartEvent[]>;
  /** First `tool_start` seen per `toolCallId` (parent-chain resolution). */
  readonly toolStartByCallId: ReadonlyMap<string, ToolStartEvent>;
  /** First `tool_result` seen per `toolCallId`. */
  readonly toolResultByCallId: ReadonlyMap<string, ToolResultEvent>;
  /** `agent_start` events grouped by `parentToolUseId`. */
  readonly agentStartsByParent: ReadonlyMap<string, readonly AgentStartEvent[]>;
  /** `agent_start` events grouped by `agentType` (subagent_type fallback). */
  readonly agentStartsByType: ReadonlyMap<string, readonly AgentStartEvent[]>;
  /** `source: 'hook'` `agent_start` events grouped by `agentType`. */
  readonly hookAgentStartsByType: ReadonlyMap<
    string,
    readonly AgentStartEvent[]
  >;
  /** Assistant `message_start` events grouped by `parentToolUseId`. */
  readonly assistantMessageStartsByParent: ReadonlyMap<
    string,
    readonly MessageStartEvent[]
  >;
  /** Every event grouped by `parentToolUseId` (per-agent stat aggregation). */
  readonly eventsByParent: ReadonlyMap<string, readonly FlatStreamEventUnion[]>;
  /** First `message_start` per `messageId`. */
  readonly messageStartByMessageId: ReadonlyMap<string, MessageStartEvent>;
  /** First `message_complete` per `messageId`. */
  readonly messageCompleteByMessageId: ReadonlyMap<
    string,
    MessageCompleteEvent
  >;
  /** `${messageId}-block-*` accumulator entries grouped by `messageId`. */
  readonly textBlocksByMessage: ReadonlyMap<
    string,
    readonly AccumulatedBlock[]
  >;
  /** `${messageId}-thinking-*` accumulator entries grouped by `messageId`. */
  readonly thinkingBlocksByMessage: ReadonlyMap<
    string,
    readonly AccumulatedBlock[]
  >;
  /** First delta event per {@link blockDeltaKey} — the block's `startTime`. */
  readonly firstDeltaByBlock: ReadonlyMap<string, FlatStreamEventUnion>;
  /**
   * Every known `messageId` mapped to the ROOT message whose rendered subtree
   * contains it. A nested subagent message resolves through
   * `message_start.parentToolUseId → tool_start.messageId`, transitively. Used
   * by the incremental rebuild to decide which root message subtrees are dirty.
   */
  readonly rootMessageIdByMessageId: ReadonlyMap<string, string>;
}

/** Append `value` to the bucket for `key`, creating it on first use. */
function push<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const bucket = map.get(key);
  if (bucket) {
    bucket.push(value);
  } else {
    map.set(key, [value]);
  }
}

/** Record `value` under `key` only if nothing is there yet (first wins). */
function setFirst<K, V>(map: Map<K, V>, key: K, value: V): void {
  if (!map.has(key)) map.set(key, value);
}

const TEXT_BLOCK_MARKER = '-block-';
const THINKING_BLOCK_MARKER = '-thinking-';

/**
 * Split an accumulator key into its owning messageId and block index, using the
 * FIRST marker occurrence — the exact inverse of the
 * `key.startsWith(`${messageId}${marker}`)` + `key.split(marker)[1]` pair the
 * message builder used.
 */
function splitBlockKey(
  key: string,
  marker: string,
): { messageId: string; blockIndex: number } | null {
  const at = key.indexOf(marker);
  if (at <= 0) return null;
  const blockIndex = parseInt(key.slice(at + marker.length), 10);
  if (Number.isNaN(blockIndex)) return null;
  return { messageId: key.slice(0, at), blockIndex };
}

/** Depth cap for parent-chain walks — mirrors the builders' MAX_DEPTH intent. */
const MAX_ROOT_RESOLUTION_HOPS = 32;

/**
 * Build every secondary index for `state` in a single pass over `events` plus
 * one pass over `textAccumulators`.
 *
 * Cost: `O(events + accumulator keys + messages)`. Call it ONCE per state
 * version and share the result across the whole tree build.
 */
export function buildStreamingIndexes(state: StreamingState): StreamingIndexes {
  const toolStartsByMessage = new Map<string, ToolStartEvent[]>();
  const toolStartByCallId = new Map<string, ToolStartEvent>();
  const toolResultByCallId = new Map<string, ToolResultEvent>();
  const agentStartsByParent = new Map<string, AgentStartEvent[]>();
  const agentStartsByType = new Map<string, AgentStartEvent[]>();
  const hookAgentStartsByType = new Map<string, AgentStartEvent[]>();
  const assistantMessageStartsByParent = new Map<string, MessageStartEvent[]>();
  const eventsByParent = new Map<string, FlatStreamEventUnion[]>();
  const messageStartByMessageId = new Map<string, MessageStartEvent>();
  const messageCompleteByMessageId = new Map<string, MessageCompleteEvent>();
  const firstDeltaByBlock = new Map<string, FlatStreamEventUnion>();

  for (const event of state.events.values()) {
    if (event.parentToolUseId) {
      push(eventsByParent, event.parentToolUseId, event);
    }

    switch (event.eventType) {
      case 'tool_start': {
        const toolStart = event as ToolStartEvent;
        push(toolStartsByMessage, toolStart.messageId, toolStart);
        setFirst(toolStartByCallId, toolStart.toolCallId, toolStart);
        break;
      }
      case 'tool_result': {
        const toolResult = event as ToolResultEvent;
        setFirst(toolResultByCallId, toolResult.toolCallId, toolResult);
        break;
      }
      case 'agent_start': {
        const agentStart = event as AgentStartEvent;
        if (agentStart.parentToolUseId) {
          push(agentStartsByParent, agentStart.parentToolUseId, agentStart);
        }
        push(agentStartsByType, agentStart.agentType, agentStart);
        if (agentStart.source === 'hook') {
          push(hookAgentStartsByType, agentStart.agentType, agentStart);
        }
        break;
      }
      case 'message_start': {
        const messageStart = event as MessageStartEvent;
        setFirst(messageStartByMessageId, messageStart.messageId, messageStart);
        if (messageStart.parentToolUseId && messageStart.role === 'assistant') {
          push(
            assistantMessageStartsByParent,
            messageStart.parentToolUseId,
            messageStart,
          );
        }
        break;
      }
      case 'message_complete': {
        const complete = event as MessageCompleteEvent;
        setFirst(messageCompleteByMessageId, complete.messageId, complete);
        break;
      }
      case 'text_delta':
        setFirst(
          firstDeltaByBlock,
          blockDeltaKey(event.messageId, 'text', event.blockIndex ?? 0),
          event,
        );
        break;
      case 'thinking_delta':
        setFirst(
          firstDeltaByBlock,
          blockDeltaKey(event.messageId, 'thinking', event.blockIndex ?? 0),
          event,
        );
        break;
      default:
        break;
    }
  }

  const textBlocksByMessage = new Map<string, AccumulatedBlock[]>();
  const thinkingBlocksByMessage = new Map<string, AccumulatedBlock[]>();
  for (const key of state.textAccumulators.keys()) {
    const text = splitBlockKey(key, TEXT_BLOCK_MARKER);
    if (text) {
      push(textBlocksByMessage, text.messageId, {
        key,
        blockIndex: text.blockIndex,
      });
      continue;
    }
    const thinking = splitBlockKey(key, THINKING_BLOCK_MARKER);
    if (thinking) {
      push(thinkingBlocksByMessage, thinking.messageId, {
        key,
        blockIndex: thinking.blockIndex,
      });
    }
  }

  return {
    toolStartsByMessage,
    toolStartByCallId,
    toolResultByCallId,
    agentStartsByParent,
    agentStartsByType,
    hookAgentStartsByType,
    assistantMessageStartsByParent,
    eventsByParent,
    messageStartByMessageId,
    messageCompleteByMessageId,
    textBlocksByMessage,
    thinkingBlocksByMessage,
    firstDeltaByBlock,
    rootMessageIdByMessageId: buildRootMessageIndex(
      state,
      messageStartByMessageId,
      toolStartByCallId,
    ),
  };
}

/**
 * Resolve every message to the ROOT message whose subtree renders it.
 *
 * A subagent's `message_start` carries `parentToolUseId`; that id belongs to a
 * `tool_start` owned by some other message, which may itself be nested. Walking
 * that chain (memoized, hop-capped) partitions every message under exactly one
 * root — which is what lets the builder mark only the affected roots dirty when
 * a nested agent streams.
 */
function buildRootMessageIndex(
  state: StreamingState,
  messageStartByMessageId: ReadonlyMap<string, MessageStartEvent>,
  toolStartByCallId: ReadonlyMap<string, ToolStartEvent>,
): ReadonlyMap<string, string> {
  const rootByMessage = new Map<string, string>();

  const resolve = (messageId: string): string => {
    const known = rootByMessage.get(messageId);
    if (known) return known;

    const chain: string[] = [];
    let current = messageId;
    let root = messageId;
    for (let hop = 0; hop <= MAX_ROOT_RESOLUTION_HOPS; hop++) {
      const cached = rootByMessage.get(current);
      if (cached) {
        root = cached;
        break;
      }
      chain.push(current);
      const parentToolUseId =
        messageStartByMessageId.get(current)?.parentToolUseId;
      if (!parentToolUseId) {
        root = current;
        break;
      }
      const owner = toolStartByCallId.get(parentToolUseId);
      // Orphan nesting (no owning tool_start yet): treat the message as its own
      // root. `buildTree` skips it anyway — it has a parentToolUseId — so this
      // only affects which digest bucket it lands in.
      if (!owner || owner.messageId === current) {
        root = current;
        break;
      }
      current = owner.messageId;
      root = current;
    }

    for (const id of chain) rootByMessage.set(id, root);
    return root;
  };

  for (const messageId of state.eventsByMessage.keys()) resolve(messageId);
  for (const messageId of messageStartByMessageId.keys()) resolve(messageId);

  return rootByMessage;
}
