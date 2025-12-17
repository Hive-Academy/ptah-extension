/**
 * ExecutionTreeBuilderService - Builds ExecutionNode tree from flat streaming events
 *
 * ARCHITECTURE (TASK_2025_082):
 * - Backend emits flat events with relationship IDs (messageId, toolCallId, parentToolUseId)
 * - Frontend stores flat events in Map (no tree building during streaming)
 * - This service builds ExecutionNode tree AT RENDER TIME from flat events
 *
 * This eliminates state corruption from interleaved sub-agent streams.
 *
 * @example
 * ```typescript
 * // In computed signal
 * const tree = treeBuilder.buildTree(streamingState);
 * ```
 */

import { Injectable } from '@angular/core';
import type {
  ExecutionNode,
  FlatStreamEventUnion,
  MessageStartEvent,
  MessageCompleteEvent,
  TextDeltaEvent,
  ThinkingDeltaEvent,
  ToolStartEvent,
  ToolResultEvent,
  AgentStartEvent,
} from '@ptah-extension/shared';
import { createExecutionNode } from '@ptah-extension/shared';
import type { StreamingState } from './chat.types';

@Injectable({ providedIn: 'root' })
export class ExecutionTreeBuilderService {
  /**
   * Build ExecutionNode tree from flat events at render time
   *
   * Algorithm:
   * 1. Group events by messageId (root messages)
   * 2. For each message, build tree using parentToolUseId for nesting
   * 3. Use toolCallId to link tool_result to tool_start
   * 4. Use blockIndex for ordering text/thinking blocks
   * 5. Accumulate text deltas into full content
   *
   * @param streamingState - Flat event storage
   * @returns Array of root ExecutionNode objects
   */
  buildTree(streamingState: StreamingState): ExecutionNode[] {
    const rootNodes: ExecutionNode[] = [];

    for (const messageId of streamingState.messageEventIds) {
      const messageNode = this.buildMessageNode(messageId, streamingState);
      if (messageNode) {
        rootNodes.push(messageNode);
      }
    }

    return rootNodes;
  }

  /**
   * Build a single message node with all its children
   *
   * @param messageId - Root message ID
   * @param state - Streaming state
   * @returns Complete message ExecutionNode
   */
  private buildMessageNode(
    messageId: string,
    state: StreamingState
  ): ExecutionNode | null {
    // Find message_start event
    const startEvent = [...state.events.values()].find(
      (e) => e.eventType === 'message_start' && e.messageId === messageId
    ) as MessageStartEvent | undefined;

    if (!startEvent) return null;

    // Find message_complete event (may not exist if streaming)
    const completeEvent = [...state.events.values()].find(
      (e) => e.eventType === 'message_complete' && e.messageId === messageId
    ) as MessageCompleteEvent | undefined;

    // Build children
    const children = this.buildMessageChildren(messageId, state);

    return createExecutionNode({
      id: startEvent.id,
      type: 'message',
      status: completeEvent ? 'complete' : 'streaming',
      content: '', // Content is in children
      children,
      startTime: startEvent.timestamp,
      tokenUsage: completeEvent?.tokenUsage,
      cost: completeEvent?.cost,
      duration: completeEvent?.duration,
    });
  }

  /**
   * Build children for a message node (text, thinking, tools)
   *
   * @param messageId - Parent message ID
   * @param state - Streaming state
   * @returns Array of child nodes
   */
  private buildMessageChildren(
    messageId: string,
    state: StreamingState
  ): ExecutionNode[] {
    const children: ExecutionNode[] = [];

    // Collect text blocks (root level, no parentToolUseId)
    children.push(...this.collectTextBlocks(messageId, state));

    // Collect thinking blocks
    children.push(...this.collectThinkingBlocks(messageId, state));

    // Collect tools
    children.push(...this.collectTools(messageId, state));

    // Sort by timestamp
    return children.sort((a, b) => (a.startTime || 0) - (b.startTime || 0));
  }

  /**
   * Collect and build text block nodes from text_delta events
   *
   * @param messageId - Parent message ID
   * @param state - Streaming state (for textAccumulators)
   * @returns Array of text ExecutionNode objects
   */
  private collectTextBlocks(
    messageId: string,
    state: StreamingState
  ): ExecutionNode[] {
    const blocks: ExecutionNode[] = [];

    // Find all text block keys for this message
    for (const [key, accumulatedText] of state.textAccumulators) {
      if (key.startsWith(`${messageId}-block-`)) {
        const blockIndex = parseInt(key.split('-block-')[1], 10);
        blocks.push(
          createExecutionNode({
            id: `${messageId}-text-${blockIndex}`,
            type: 'text',
            status: 'complete',
            content: accumulatedText,
            children: [],
            startTime: Date.now(), // Will be sorted with others
          })
        );
      }
    }

    return blocks.sort((a, b) => {
      const aIndex = parseInt(a.id.split('-text-')[1], 10) || 0;
      const bIndex = parseInt(b.id.split('-text-')[1], 10) || 0;
      return aIndex - bIndex;
    });
  }

  /**
   * Collect and build thinking block nodes from thinking_delta events
   *
   * @param messageId - Parent message ID
   * @param state - Streaming state (for textAccumulators)
   * @returns Array of thinking ExecutionNode objects
   */
  private collectThinkingBlocks(
    messageId: string,
    state: StreamingState
  ): ExecutionNode[] {
    const blocks: ExecutionNode[] = [];

    for (const [key, accumulatedText] of state.textAccumulators) {
      if (key.startsWith(`${messageId}-thinking-`)) {
        const blockIndex = parseInt(key.split('-thinking-')[1], 10);
        blocks.push(
          createExecutionNode({
            id: `${messageId}-thinking-${blockIndex}`,
            type: 'thinking',
            status: 'complete',
            content: accumulatedText,
            children: [],
            startTime: Date.now(),
          })
        );
      }
    }

    return blocks.sort((a, b) => {
      const aIndex = parseInt(a.id.split('-thinking-')[1], 10) || 0;
      const bIndex = parseInt(b.id.split('-thinking-')[1], 10) || 0;
      return aIndex - bIndex;
    });
  }

  /**
   * Collect and build tool nodes from tool_start events
   *
   * @param messageId - Parent message ID
   * @param state - Streaming state
   * @returns Array of tool ExecutionNode objects
   */
  private collectTools(
    messageId: string,
    state: StreamingState
  ): ExecutionNode[] {
    const tools: ExecutionNode[] = [];

    // Find all tool_start events for this message (root level, no parentToolUseId)
    const toolStarts = [...state.events.values()].filter(
      (e) =>
        e.eventType === 'tool_start' &&
        e.messageId === messageId &&
        !e.parentToolUseId
    ) as ToolStartEvent[];

    for (const toolStart of toolStarts) {
      tools.push(this.buildToolNode(toolStart, state));
    }

    return tools;
  }

  /**
   * Build a single tool node with nested children (RECURSIVE)
   *
   * @param toolStart - Tool start event
   * @param state - Streaming state
   * @returns Tool ExecutionNode with nested execution
   */
  private buildToolNode(
    toolStart: ToolStartEvent,
    state: StreamingState
  ): ExecutionNode {
    // Get accumulated input
    const inputKey = `${toolStart.toolCallId}-input`;
    const input = state.toolInputAccumulators.get(inputKey) || '';

    // Find tool result
    const resultEvent = [...state.events.values()].find(
      (e) =>
        e.eventType === 'tool_result' && e.toolCallId === toolStart.toolCallId
    ) as ToolResultEvent | undefined;

    // Build nested children (RECURSIVE - sub-agent messages!)
    const children = this.buildToolChildren(toolStart.toolCallId, state);

    return createExecutionNode({
      id: toolStart.id,
      type: 'tool',
      status: resultEvent ? 'complete' : 'streaming',
      content: input,
      children,
      startTime: toolStart.timestamp,
      toolName: toolStart.toolName,
      toolCallId: toolStart.toolCallId,
      toolOutput: resultEvent?.output,
      isPermissionRequest: resultEvent?.isPermissionRequest,
    });
  }

  /**
   * Build children for a tool node (nested messages for agents)
   * This is RECURSIVE - agent tools contain nested message nodes
   *
   * @param toolCallId - Parent tool call ID
   * @param state - Streaming state
   * @returns Array of nested ExecutionNode objects
   */
  private buildToolChildren(
    toolCallId: string,
    state: StreamingState
  ): ExecutionNode[] {
    const children: ExecutionNode[] = [];

    // Find all agent_start events where parentToolUseId = toolCallId
    const agentStarts = [...state.events.values()].filter(
      (e) => e.eventType === 'agent_start' && e.parentToolUseId === toolCallId
    ) as AgentStartEvent[];

    // For each agent, find its messages and build them (RECURSIVE!)
    for (const agentStart of agentStarts) {
      // Find message_start events for this agent
      const agentMessageIds = [...state.events.values()]
        .filter(
          (e) =>
            e.eventType === 'message_start' && e.parentToolUseId === toolCallId
        )
        .map((e) => e.messageId);

      for (const msgId of agentMessageIds) {
        const messageNode = this.buildMessageNode(msgId, state);
        if (messageNode) {
          children.push(messageNode);
        }
      }
    }

    return children;
  }
}
