/**
 * Factory helpers for execution-node types.
 */

import type { ExecutionChatMessage } from './agent';
import type { ExecutionNode } from './node';

/**
 * Create a new ExecutionNode with default values
 */
export function createExecutionNode(
  partial: Partial<ExecutionNode> & Pick<ExecutionNode, 'id' | 'type'>,
): ExecutionNode {
  return {
    status: 'pending',
    content: null,
    children: [],
    isCollapsed: false,
    ...partial,
  };
}

/**
 * Create a new ExecutionChatMessage
 *
 * The partial is spread whole: only `timestamp` and `streamingState` are
 * defaulted, so every optional field — `imageCount`, `inboundPeer` — passes
 * through untouched, and a field the caller omitted stays ABSENT rather than
 * becoming `undefined`. Callers rely on that (`'inboundPeer' in message` is a
 * meaningful test); do not add per-field assignments here.
 */
export function createExecutionChatMessage(
  partial: Partial<ExecutionChatMessage> &
    Pick<ExecutionChatMessage, 'id' | 'role'>,
): ExecutionChatMessage {
  return {
    timestamp: Date.now(),
    streamingState: null,
    ...partial,
  };
}
