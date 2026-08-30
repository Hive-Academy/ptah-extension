/**
 * Message-node pure builders.
 *
 * Recurses into tools via `deps.collectTools`. No direct imports of
 * tool-node.fn / agent-node.fn — recursion is callback-driven through
 * {@link BuilderDeps} to keep file-level imports acyclic.
 *
 * TASK_2026_323 (R2): this file used to `slice().sort()` the whole
 * `eventsByMessage` bucket — every delta of the message — on every rebuild, and
 * then scan the ENTIRE `textAccumulators` map twice per message to find that
 * message's blocks. Both are gone: the accumulator now keeps buckets in
 * timestamp order on append, and block lookups go through
 * {@link BuilderDeps.getIndexes}.
 */

import type {
  ExecutionNode,
  MessageCompleteEvent,
  MessageStartEvent,
} from '@ptah-extension/shared';
import { createExecutionNode } from '@ptah-extension/shared';
import type { StreamingState } from '@ptah-extension/chat-types';
import type { AccumulatedBlock } from '../indexes/streaming-indexes';
import { blockDeltaKey } from '../indexes/streaming-indexes';
import type { BuilderDeps } from './builder-deps';

export function buildMessageNode(
  deps: BuilderDeps,
  messageId: string,
  state: StreamingState,
  depth = 0,
): ExecutionNode | null {
  const indexes = deps.getIndexes(state);

  const startEvent = findMessageStartEvent(state, messageId);
  if (!startEvent) return null;

  const completeEvent = indexes.messageCompleteByMessageId.get(messageId) as
    | MessageCompleteEvent
    | undefined;

  const children = buildMessageChildren(deps, messageId, state, depth);

  return createExecutionNode({
    id: startEvent.id,
    type: 'message',
    status: completeEvent ? 'complete' : 'streaming',
    content: '',
    children,
    startTime: startEvent.timestamp,
    tokenUsage: completeEvent?.tokenUsage,
    cost: completeEvent?.cost,
    duration: completeEvent?.duration,
  });
}

/**
 * Find message_start event for a given messageId.
 * Used to check if a message is nested (has parentToolUseId) before
 * deciding whether to render it as a root node.
 *
 * Reads `eventsByMessage`, which the accumulator keeps in non-descending
 * timestamp order — a message's `message_start` is therefore at (or very near)
 * the head of its bucket, so this is O(1) in practice even for a message with
 * thousands of deltas.
 */
export function findMessageStartEvent(
  state: StreamingState,
  messageId: string,
): MessageStartEvent | undefined {
  const messageEvents = state.eventsByMessage.get(messageId);
  if (!messageEvents) return undefined;

  return messageEvents.find((e) => e.eventType === 'message_start') as
    | MessageStartEvent
    | undefined;
}

function buildMessageChildren(
  deps: BuilderDeps,
  messageId: string,
  state: StreamingState,
  depth: number,
): ExecutionNode[] {
  const children: ExecutionNode[] = [];
  children.push(...collectTextBlocks(deps, messageId, state));
  children.push(...collectThinkingBlocks(deps, messageId, state));
  children.push(...deps.collectTools(messageId, state, depth));
  return children.sort((a, b) => (a.startTime || 0) - (b.startTime || 0));
}

function collectTextBlocks(
  deps: BuilderDeps,
  messageId: string,
  state: StreamingState,
): ExecutionNode[] {
  const indexes = deps.getIndexes(state);
  return buildBlockNodes(
    indexes.textBlocksByMessage.get(messageId),
    messageId,
    'text',
    state,
    (blockIndex) =>
      indexes.firstDeltaByBlock.get(
        blockDeltaKey(messageId, 'text', blockIndex),
      )?.timestamp,
  );
}

function collectThinkingBlocks(
  deps: BuilderDeps,
  messageId: string,
  state: StreamingState,
): ExecutionNode[] {
  const indexes = deps.getIndexes(state);
  return buildBlockNodes(
    indexes.thinkingBlocksByMessage.get(messageId),
    messageId,
    'thinking',
    state,
    (blockIndex) =>
      indexes.firstDeltaByBlock.get(
        blockDeltaKey(messageId, 'thinking', blockIndex),
      )?.timestamp,
  );
}

/**
 * Turn accumulated text/thinking blocks into nodes, ordered by block index.
 *
 * `startTime` falls back to `Date.now()` when no anchoring delta event survives
 * — unchanged from the original, and the reason the sort below keys off the
 * block index rather than the timestamp.
 */
function buildBlockNodes(
  blocks: readonly AccumulatedBlock[] | undefined,
  messageId: string,
  kind: 'text' | 'thinking',
  state: StreamingState,
  startTimeFor: (blockIndex: number) => number | undefined,
): ExecutionNode[] {
  if (!blocks || blocks.length === 0) return [];

  const nodes = blocks.map((block) =>
    createExecutionNode({
      id: `${messageId}-${kind}-${block.blockIndex}`,
      type: kind,
      status: 'complete',
      content: state.textAccumulators.get(block.key) ?? '',
      children: [],
      startTime: startTimeFor(block.blockIndex) || Date.now(),
    }),
  );

  return nodes.sort((a, b) => {
    const aIndex = parseInt(a.id.split(`-${kind}-`)[1], 10) || 0;
    const bIndex = parseInt(b.id.split(`-${kind}-`)[1], 10) || 0;
    return aIndex - bIndex;
  });
}
