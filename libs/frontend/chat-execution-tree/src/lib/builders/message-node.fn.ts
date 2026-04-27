/**
 * Message-node pure builders — extracted from MessageNodeBuilderService.
 *
 * Recurses into tools via `deps.collectTools`. No direct imports of
 * tool-node.fn / agent-node.fn — recursion is callback-driven through
 * {@link BuilderDeps} to keep file-level imports acyclic.
 */

import type {
  ExecutionNode,
  MessageCompleteEvent,
  MessageStartEvent,
} from '@ptah-extension/shared';
import { createExecutionNode } from '@ptah-extension/shared';
import type { StreamingState } from '@ptah-extension/chat-types';
import type { BuilderDeps } from './builder-deps';

export function buildMessageNode(
  deps: BuilderDeps,
  messageId: string,
  state: StreamingState,
  depth = 0,
): ExecutionNode | null {
  // Use pre-indexed events for O(1) lookup (TASK_2025_084 Batch 1 Task 1.2)
  // TASK_2025_087: Defensive check — eventsByMessage might not be a Map if loaded from localStorage
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

  const startEvent = sortedEvents.find(
    (e) => e.eventType === 'message_start',
  ) as MessageStartEvent | undefined;
  if (!startEvent) return null;

  const completeEvent = sortedEvents.find(
    (e) => e.eventType === 'message_complete',
  ) as MessageCompleteEvent | undefined;

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
 * TASK_2025_096: Find message_start event for a given messageId.
 * Used to check if a message is nested (has parentToolUseId) before
 * deciding whether to render it as a root node.
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
  children.push(...collectTextBlocks(messageId, state));
  children.push(...collectThinkingBlocks(messageId, state));
  children.push(...deps.collectTools(messageId, state, depth));
  return children.sort((a, b) => (a.startTime || 0) - (b.startTime || 0));
}

function collectTextBlocks(
  messageId: string,
  state: StreamingState,
): ExecutionNode[] {
  const blocks: ExecutionNode[] = [];
  const messageEvents = state.eventsByMessage.get(messageId) || [];

  for (const [key, accumulatedText] of state.textAccumulators) {
    if (key.startsWith(`${messageId}-block-`)) {
      const blockIndex = parseInt(key.split('-block-')[1], 10);
      const firstDelta = messageEvents.find(
        (e) =>
          e.eventType === 'text_delta' && (e.blockIndex ?? 0) === blockIndex,
      );

      blocks.push(
        createExecutionNode({
          id: `${messageId}-text-${blockIndex}`,
          type: 'text',
          status: 'complete',
          content: accumulatedText,
          children: [],
          startTime: firstDelta?.timestamp || Date.now(),
        }),
      );
    }
  }

  return blocks.sort((a, b) => {
    const aIndex = parseInt(a.id.split('-text-')[1], 10) || 0;
    const bIndex = parseInt(b.id.split('-text-')[1], 10) || 0;
    return aIndex - bIndex;
  });
}

function collectThinkingBlocks(
  messageId: string,
  state: StreamingState,
): ExecutionNode[] {
  const blocks: ExecutionNode[] = [];
  const messageEvents = state.eventsByMessage.get(messageId) || [];

  for (const [key, accumulatedText] of state.textAccumulators) {
    if (key.startsWith(`${messageId}-thinking-`)) {
      const blockIndex = parseInt(key.split('-thinking-')[1], 10);
      const firstDelta = messageEvents.find(
        (e) =>
          e.eventType === 'thinking_delta' &&
          (e.blockIndex ?? 0) === blockIndex,
      );

      blocks.push(
        createExecutionNode({
          id: `${messageId}-thinking-${blockIndex}`,
          type: 'thinking',
          status: 'complete',
          content: accumulatedText,
          children: [],
          startTime: firstDelta?.timestamp || Date.now(),
        }),
      );
    }
  }

  return blocks.sort((a, b) => {
    const aIndex = parseInt(a.id.split('-thinking-')[1], 10) || 0;
    const bIndex = parseInt(b.id.split('-thinking-')[1], 10) || 0;
    return aIndex - bIndex;
  });
}
