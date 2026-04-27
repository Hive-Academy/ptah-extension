/**
 * Factory helpers for execution-node types.
 *
 * Extracted from execution-node.types.ts (TASK_2025_291 Wave C2) — zero behavior change.
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
