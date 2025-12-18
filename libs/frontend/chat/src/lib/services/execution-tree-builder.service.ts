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

/**
 * Maximum recursion depth for tool children to prevent stack overflow.
 * Real-world agent nesting rarely exceeds 3-4 levels.
 */
const MAX_DEPTH = 10;

/**
 * ParseResult - Result of safe JSON parsing with error tracking
 * TASK_2025_088 Batch 2 Task 2.1: Prevents data loss from silent parse failures
 */
interface ParseResult<T> {
  success: boolean;
  data?: T;
  error?: string;
  raw?: string;
}

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
   * @param depth - Current recursion depth (for preventing stack overflow)
   * @returns Complete message ExecutionNode
   */
  private buildMessageNode(
    messageId: string,
    state: StreamingState,
    depth = 0
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
      (e) => e.eventType === 'message_start'
    ) as MessageStartEvent | undefined;

    if (!startEvent) return null;

    // Find message_complete event (may not exist if streaming)
    const completeEvent = sortedEvents.find(
      (e) => e.eventType === 'message_complete'
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
    depth: number
  ): ExecutionNode[] {
    const children: ExecutionNode[] = [];

    // Collect text blocks (root level, no parentToolUseId)
    children.push(...this.collectTextBlocks(messageId, state));

    // Collect thinking blocks
    children.push(...this.collectThinkingBlocks(messageId, state));

    // Collect tools
    children.push(...this.collectTools(messageId, state, depth));

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

    // Get message events to find first text_delta for timestamp
    const messageEvents = state.eventsByMessage.get(messageId) || [];

    // Find all text block keys for this message
    for (const [key, accumulatedText] of state.textAccumulators) {
      if (key.startsWith(`${messageId}-block-`)) {
        const blockIndex = parseInt(key.split('-block-')[1], 10);

        // Find first text_delta event for this block to get timestamp
        const firstDelta = messageEvents.find(
          (e) =>
            e.eventType === 'text_delta' && (e.blockIndex ?? 0) === blockIndex
        );

        blocks.push(
          createExecutionNode({
            id: `${messageId}-text-${blockIndex}`,
            type: 'text',
            status: 'complete',
            content: accumulatedText,
            children: [],
            startTime: firstDelta?.timestamp || Date.now(),
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

    // Get message events to find first thinking_delta for timestamp
    const messageEvents = state.eventsByMessage.get(messageId) || [];

    for (const [key, accumulatedText] of state.textAccumulators) {
      if (key.startsWith(`${messageId}-thinking-`)) {
        const blockIndex = parseInt(key.split('-thinking-')[1], 10);

        // Find first thinking_delta event for this block to get timestamp
        const firstDelta = messageEvents.find(
          (e) =>
            e.eventType === 'thinking_delta' &&
            (e.blockIndex ?? 0) === blockIndex
        );

        blocks.push(
          createExecutionNode({
            id: `${messageId}-thinking-${blockIndex}`,
            type: 'thinking',
            status: 'complete',
            content: accumulatedText,
            children: [],
            startTime: firstDelta?.timestamp || Date.now(),
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
   * @param depth - Current recursion depth (propagate to tool nodes)
   * @returns Array of tool ExecutionNode objects
   */
  private collectTools(
    messageId: string,
    state: StreamingState,
    depth: number
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
      tools.push(this.buildToolNode(toolStart, state, depth));
    }

    return tools;
  }

  /**
   * Parse tool input JSON with error tracking
   * TASK_2025_088 Batch 2 Task 2.1: Safe JSON parser with error tracking
   *
   * @param input - Raw JSON string
   * @returns ParseResult with success/error state
   */
  private parseToolInput(input: string): ParseResult<Record<string, unknown>> {
    try {
      const parsed = JSON.parse(input);
      if (typeof parsed !== 'object' || parsed === null) {
        return { success: false, error: 'Not an object', raw: input };
      }
      return { success: true, data: parsed };
    } catch (e) {
      return { success: false, error: String(e), raw: input };
    }
  }

  /**
   * Build a single tool node with nested children (RECURSIVE)
   *
   * @param toolStart - Tool start event
   * @param state - Streaming state
   * @param depth - Current recursion depth (for preventing stack overflow)
   * @returns Tool ExecutionNode with nested execution
   */
  private buildToolNode(
    toolStart: ToolStartEvent,
    state: StreamingState,
    depth = 0
  ): ExecutionNode {
    // Get accumulated input
    const inputKey = `${toolStart.toolCallId}-input`;
    const inputString = state.toolInputAccumulators.get(inputKey) || '';

    // Parse JSON into toolInput field
    // TASK_2025_088 Batch 2 Task 2.2: Use safe parser instead of unsafe try/catch
    let toolInput: Record<string, unknown> | undefined;
    if (inputString) {
      const result = this.parseToolInput(inputString);
      if (result.success) {
        toolInput = result.data;
      } else {
        // CRITICAL FIX: Preserve parse error for UI display instead of silent failure
        toolInput = {
          __parseError: result.error,
          __raw: result.raw,
        } as Record<string, unknown>;
        console.warn('[ExecutionTreeBuilderService] Tool input parse failed', {
          toolCallId: toolStart.toolCallId,
          error: result.error,
          raw: result.raw?.substring(0, 100), // Log first 100 chars
        });
      }
    } else {
      toolInput = undefined;
    }

    // Find tool result
    const resultEvent = [...state.events.values()].find(
      (e) =>
        e.eventType === 'tool_result' && e.toolCallId === toolStart.toolCallId
    ) as ToolResultEvent | undefined;

    // Build nested children (RECURSIVE - sub-agent messages!)
    const children = this.buildToolChildren(toolStart.toolCallId, state, depth);

    return createExecutionNode({
      id: toolStart.id,
      type: 'tool',
      status: resultEvent ? 'complete' : 'streaming',
      content: null, // Content is null, not the JSON string
      toolInput, // Parsed JSON in correct field
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
   * @param depth - Current recursion depth (default 0)
   * @returns Array of nested ExecutionNode objects
   */
  private buildToolChildren(
    toolCallId: string,
    state: StreamingState,
    depth = 0
  ): ExecutionNode[] {
    // Early exit if max depth exceeded
    if (depth >= MAX_DEPTH) {
      console.warn(
        '[ExecutionTreeBuilderService] Max recursion depth exceeded',
        {
          toolCallId,
          depth,
          maxDepth: MAX_DEPTH,
        }
      );
      return [];
    }

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
        const messageNode = this.buildMessageNode(msgId, state, depth + 1);
        if (messageNode) {
          children.push(messageNode);
        } else {
          console.warn('[ExecutionTreeBuilderService] Message node dropped', {
            messageId: msgId,
            toolCallId,
            reason: 'buildMessageNode returned null',
          });
        }
      }
    }

    return children;
  }
}
