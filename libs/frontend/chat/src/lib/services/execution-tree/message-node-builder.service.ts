/**
 * MessageNodeBuilderService - Builds message ExecutionNodes (text + thinking blocks).
 *
 * Extracted from ExecutionTreeBuilderService (Wave C7f) — owns
 * `buildMessageNode`, `buildMessageChildren`, `collectTextBlocks`,
 * `collectThinkingBlocks`, `findMessageStartEvent`.
 *
 * Mutual recursion with ToolNodeBuilderService is resolved via Angular's
 * `inject()` (use-time resolution, not constructor-time).
 */

import { Injectable, inject } from '@angular/core';
import type {
  ExecutionNode,
  MessageCompleteEvent,
  MessageStartEvent,
} from '@ptah-extension/shared';
import { createExecutionNode } from '@ptah-extension/shared';
import type { StreamingState } from '../chat.types';
import { ToolNodeBuilderService } from './tool-node-builder.service';

@Injectable({ providedIn: 'root' })
export class MessageNodeBuilderService {
  private readonly toolBuilder = inject(ToolNodeBuilderService);

  /**
   * Build a single message node with all its children
   *
   * @param messageId - Root message ID
   * @param state - Streaming state
   * @param depth - Current recursion depth (for preventing stack overflow)
   * @returns Complete message ExecutionNode
   */
  buildMessageNode(
    messageId: string,
    state: StreamingState,
    depth = 0,
  ): ExecutionNode | null {
    // Use pre-indexed events for O(1) lookup (TASK_2025_084 Batch 1 Task 1.2)
    // TASK_2025_087: Defensive check - eventsByMessage might not be a Map if loaded from localStorage
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

    // Find message_start event
    const startEvent = sortedEvents.find(
      (e) => e.eventType === 'message_start',
    ) as MessageStartEvent | undefined;

    if (!startEvent) return null;

    // Find message_complete event (may not exist if streaming)
    const completeEvent = sortedEvents.find(
      (e) => e.eventType === 'message_complete',
    ) as MessageCompleteEvent | undefined;

    // Build children
    const children = this.buildMessageChildren(messageId, state, depth);

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
   * TASK_2025_096: Find message_start event for a given messageId.
   * Used to check if a message is nested (has parentToolUseId) before
   * deciding whether to render it as a root node.
   *
   * @param state - Streaming state
   * @param messageId - The messageId to search for
   * @returns The message_start event if found, undefined otherwise
   */
  findMessageStartEvent(
    state: StreamingState,
    messageId: string,
  ): MessageStartEvent | undefined {
    const messageEvents = state.eventsByMessage.get(messageId);
    if (!messageEvents) return undefined;

    return messageEvents.find((e) => e.eventType === 'message_start') as
      | MessageStartEvent
      | undefined;
  }

  /**
   * Build children for a message node (text, thinking, tools)
   *
   * @param messageId - Parent message ID
   * @param state - Streaming state
   * @param depth - Current recursion depth (propagate to children)
   * @returns Array of child nodes
   */
  private buildMessageChildren(
    messageId: string,
    state: StreamingState,
    depth: number,
  ): ExecutionNode[] {
    const children: ExecutionNode[] = [];

    // Collect text blocks (root level, no parentToolUseId)
    children.push(...this.collectTextBlocks(messageId, state));

    // Collect thinking blocks
    children.push(...this.collectThinkingBlocks(messageId, state));

    // Collect tools
    children.push(...this.toolBuilder.collectTools(messageId, state, depth));

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
    state: StreamingState,
  ): ExecutionNode[] {
    const blocks: ExecutionNode[] = [];

    // Get message events to find first text_delta for timestamp
    const messageEvents = state.eventsByMessage.get(messageId) || [];

    // Find all text block keys for this message
    for (const [key, accumulatedText] of state.textAccumulators) {
      if (key.startsWith(`${messageId}-block-`)) {
        const blockIndex = parseInt(key.split('-block-')[1], 10);

        // Find first text_delta event for this block to get timestamp
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

  /**
   * Collect and build thinking block nodes from thinking_delta events
   *
   * @param messageId - Parent message ID
   * @param state - Streaming state (for textAccumulators)
   * @returns Array of thinking ExecutionNode objects
   */
  private collectThinkingBlocks(
    messageId: string,
    state: StreamingState,
  ): ExecutionNode[] {
    const blocks: ExecutionNode[] = [];

    // Get message events to find first thinking_delta for timestamp
    const messageEvents = state.eventsByMessage.get(messageId) || [];

    for (const [key, accumulatedText] of state.textAccumulators) {
      if (key.startsWith(`${messageId}-thinking-`)) {
        const blockIndex = parseInt(key.split('-thinking-')[1], 10);

        // Find first thinking_delta event for this block to get timestamp
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
}
