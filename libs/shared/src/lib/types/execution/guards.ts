/**
 * Type guards for ExecutionNode / JSONLMessage.
 */

import { isAgentDispatchTool } from '../../type-guards/guards/exec';

import type { ExecutionNode, JSONLMessage } from './node';

/**
 * Check if node is an agent (contains nested execution)
 */
export function isAgentNode(node: ExecutionNode): boolean {
  return node.type === 'agent';
}

/**
 * Check if node is a tool execution
 */
export function isToolNode(node: ExecutionNode): boolean {
  return node.type === 'tool';
}

/**
 * Check if node has children
 */
export function hasChildren(node: ExecutionNode): boolean {
  return node.children.length > 0;
}

/**
 * Check if node is still streaming
 */
export function isStreaming(node: ExecutionNode): boolean {
  return node.status === 'streaming';
}

/**
 * Check if JSONL message is a Task/Agent tool (agent spawn)
 */
export function isTaskToolMessage(msg: JSONLMessage): boolean {
  return msg.type === 'tool' && isAgentDispatchTool(msg.tool ?? '');
}

/**
 * Check if JSONL message is nested under an agent
 */
export function isNestedToolMessage(msg: JSONLMessage): boolean {
  return !!msg.parent_tool_use_id;
}
