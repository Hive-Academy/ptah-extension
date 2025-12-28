import { Injectable } from '@angular/core';
import { ExecutionNode, createExecutionNode } from '@ptah-extension/shared';

/**
 * Agent spawn information for creating agent nodes
 */
export interface AgentSpawnInfo {
  toolUseId: string;
  subagentType?: string;
  description?: string;
  prompt?: string;
  model?: string;
}

/**
 * ExecutionTreeBuilder - Builds and manipulates ExecutionNode trees
 *
 * Single Responsibility: Tree construction and manipulation only.
 *
 * This service provides PURE functions for building and transforming
 * ExecutionNode trees. All methods are immutable - they take a tree as
 * input and return a new tree, never mutating the original.
 *
 * Does NOT handle:
 * - State management (signals)
 * - JSONL parsing/routing
 * - Node map management (toolNodeMap, agentNodeMap)
 *
 * Architecture Pattern: Stateless Service
 * Complexity Level: 1 (Simple - pure functions, no internal state)
 *
 * @example
 * ```typescript
 * // Create a new message tree
 * let tree = builder.createMessageTree('msg_123');
 *
 * // Add content (immutable operations)
 * tree = builder.appendThinking(tree, 'Let me analyze this...');
 * tree = builder.appendText(tree, 'Here is my response.');
 * tree = builder.appendToolUse(tree, {
 *   id: 'tool_456',
 *   name: 'Read',
 *   input: { file_path: '/path/to/file' }
 * });
 * ```
 */
@Injectable({ providedIn: 'root' })
export class ExecutionTreeBuilder {
  /**
   * Create a new message tree root node
   *
   * This is the starting point for building an execution tree.
   * Creates a root node of type 'message' with streaming status.
   *
   * @param messageId - Unique identifier for the message
   * @returns Root ExecutionNode for the message tree
   *
   * @example
   * ```typescript
   * const tree = builder.createMessageTree('msg_abc123');
   * // Returns: { id: 'msg_abc123', type: 'message', status: 'streaming', children: [] }
   * ```
   */
  createMessageTree(messageId: string, model?: string): ExecutionNode {
    return createExecutionNode({
      id: messageId,
      type: 'message',
      status: 'streaming',
      model,
    });
  }

  /**
   * Append a thinking block to the tree
   *
   * Thinking blocks represent Claude's internal reasoning process.
   * They are collapsed by default to keep the UI compact.
   *
   * @param tree - Current execution tree
   * @param content - Thinking content text
   * @returns New tree with thinking node appended (immutable)
   *
   * @example
   * ```typescript
   * tree = builder.appendThinking(tree, 'I need to analyze the requirements...');
   * ```
   */
  appendThinking(tree: ExecutionNode, content: string): ExecutionNode {
    const thinkingNode = createExecutionNode({
      id: this.generateId(),
      type: 'thinking',
      status: 'complete',
      content,
      isCollapsed: true, // Collapsed by default
    });

    // Return new tree with appended child (immutable)
    return {
      ...tree,
      children: [...tree.children, thinkingNode],
    };
  }

  /**
   * Append a complete text node to the tree
   *
   * Text nodes represent Claude's response text that has been
   * fully received (not streaming).
   *
   * @param tree - Current execution tree
   * @param content - Text content
   * @returns New tree with text node appended (immutable)
   *
   * @example
   * ```typescript
   * tree = builder.appendText(tree, 'Here is my response.');
   * ```
   */
  appendText(tree: ExecutionNode, content: string): ExecutionNode {
    const textNode = createExecutionNode({
      id: this.generateId(),
      type: 'text',
      status: 'complete',
      content,
    });

    // Return new tree with appended child (immutable)
    return {
      ...tree,
      children: [...tree.children, textNode],
    };
  }

  /**
   * Append a text delta to the tree (streaming text)
   *
   * This method handles streaming text by either:
   * 1. Appending to the last streaming text node if one exists
   * 2. Creating a new streaming text node if none exists
   *
   * This enables efficient streaming UX where text appears character-by-character.
   *
   * @param tree - Current execution tree
   * @param delta - Text delta to append
   * @returns New tree with text delta appended (immutable)
   *
   * @example
   * ```typescript
   * // First delta creates new streaming text node
   * tree = builder.appendTextDelta(tree, 'Hello');
   * // Subsequent deltas append to existing streaming node
   * tree = builder.appendTextDelta(tree, ' world');
   * ```
   */
  appendTextDelta(tree: ExecutionNode, delta: string): ExecutionNode {
    // Find or create streaming text node
    const lastChild = tree.children[tree.children.length - 1];

    if (
      lastChild &&
      lastChild.type === 'text' &&
      lastChild.status === 'streaming'
    ) {
      // Append to existing streaming text node
      const updatedChild: ExecutionNode = {
        ...lastChild,
        content: (lastChild.content ?? '') + delta,
      };

      // Return new tree with updated last child (immutable)
      return {
        ...tree,
        children: [...tree.children.slice(0, -1), updatedChild],
      };
    } else {
      // Create new streaming text node
      const textNode = createExecutionNode({
        id: this.generateId(),
        type: 'text',
        status: 'streaming',
        content: delta,
      });

      // Return new tree with appended child (immutable)
      return {
        ...tree,
        children: [...tree.children, textNode],
      };
    }
  }

  /**
   * Append a tool use node to the tree
   *
   * Tool use nodes represent Claude calling a tool (Read, Write, Bash, etc.).
   * They are collapsed by default and marked as 'pending' until results arrive.
   *
   * @param tree - Current execution tree
   * @param block - Tool use block from JSONL (contains id, name, input)
   * @returns New tree with tool node appended (immutable)
   *
   * @example
   * ```typescript
   * tree = builder.appendToolUse(tree, {
   *   id: 'tool_123',
   *   name: 'Read',
   *   input: { file_path: '/path/to/file' }
   * });
   * ```
   */
  appendToolUse(tree: ExecutionNode, block: any): ExecutionNode {
    const toolNode = createExecutionNode({
      id: block.id || this.generateId(),
      type: 'tool',
      status: 'pending',
      toolName: block.name,
      toolInput: block.input,
      toolCallId: block.id,
      isCollapsed: true, // Collapsed by default
    });

    // Return new tree with appended child (immutable)
    return {
      ...tree,
      children: [...tree.children, toolNode],
    };
  }

  /**
   * Append an agent execution node to the tree
   *
   * Agent nodes represent nested agent invocations (via Task tool).
   * They are expanded by default to show nested execution.
   *
   * @param tree - Current execution tree
   * @param agentInfo - Agent spawn information
   * @returns New tree with agent node appended (immutable)
   *
   * @example
   * ```typescript
   * tree = builder.appendAgent(tree, {
   *   toolUseId: 'task_456',
   *   subagentType: 'backend-developer',
   *   description: 'Implement user service',
   *   model: 'claude-3-5-sonnet-20241022'
   * });
   * ```
   */
  appendAgent(tree: ExecutionNode, agentInfo: AgentSpawnInfo): ExecutionNode {
    const agentNode = createExecutionNode({
      id: agentInfo.toolUseId,
      type: 'agent',
      status: 'streaming',
      agentType: agentInfo.subagentType,
      agentModel: agentInfo.model,
      agentDescription: agentInfo.description,
      agentPrompt: agentInfo.prompt,
      toolCallId: agentInfo.toolUseId,
      startTime: Date.now(),
      isCollapsed: false, // Expanded by default (show nested execution)
    });

    // Return new tree with appended child (immutable)
    return {
      ...tree,
      children: [...tree.children, agentNode],
    };
  }

  /**
   * Replace a node in the tree (immutable deep update)
   *
   * This method recursively searches the tree for a node with the given ID
   * and replaces it with the updated node. Returns a completely new tree
   * without mutating the original.
   *
   * Used for updating nodes after they receive results, change status, etc.
   *
   * @param tree - Current execution tree
   * @param nodeId - ID of the node to replace
   * @param updatedNode - New node to replace with
   * @returns New tree with node replaced (immutable)
   *
   * @example
   * ```typescript
   * // Update a tool node with results
   * const toolNode = findNode(tree, 'tool_123');
   * const updatedTool = { ...toolNode, status: 'complete', toolOutput: 'results...' };
   * tree = builder.replaceNode(tree, 'tool_123', updatedTool);
   * ```
   */
  replaceNode(
    tree: ExecutionNode,
    nodeId: string,
    updatedNode: ExecutionNode
  ): ExecutionNode {
    // Recursively search and replace, returning a new tree
    const replaceInChildren = (
      children: readonly ExecutionNode[]
    ): readonly ExecutionNode[] => {
      return children.map((child) => {
        if (child.id === nodeId) {
          return updatedNode;
        }
        if (child.children.length > 0) {
          return {
            ...child,
            children: replaceInChildren(child.children),
          };
        }
        return child;
      });
    };

    // Return a new tree with updated children (immutable)
    return {
      ...tree,
      children: replaceInChildren(tree.children),
    };
  }

  /**
   * Generate a unique ID for nodes
   *
   * Uses timestamp + random string for uniqueness.
   * Format: `node_${timestamp}_${random7chars}`
   *
   * @returns Unique node ID string
   *
   * @example
   * ```typescript
   * const id = builder.generateId();
   * // Returns: 'node_1702345678901_a3f9d2k'
   * ```
   */
  generateId(): string {
    return `node_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  }
}
