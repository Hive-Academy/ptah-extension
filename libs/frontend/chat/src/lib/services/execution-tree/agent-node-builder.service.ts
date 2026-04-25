/**
 * AgentNodeBuilderService - Builds agent ExecutionNodes.
 *
 * Extracted from ExecutionTreeBuilderService (Wave C7f) — owns
 * `buildAgentNode` and `buildInterleavedChildren`. Mutual recursion with
 * MessageNodeBuilderService is resolved via Angular's `inject()` (use-time
 * resolution, not constructor-time).
 *
 * Critical preservation:
 * - MAX_DEPTH early exit + console.warn string byte-identical.
 * - effectiveAgentId hook-fallback closest-by-timestamp tie-break (NOT first-by-iteration).
 * - Status from `tool_result` presence, not children-count.
 * - Field-spread order: ...stats then explicit `model: stats.agentModel`.
 */

import { Injectable, inject } from '@angular/core';
import type {
  AgentStartEvent,
  ExecutionNode,
  MessageStartEvent,
  ToolResultEvent,
} from '@ptah-extension/shared';
import { createExecutionNode } from '@ptah-extension/shared';
import type { StreamingState } from '../chat.types';
import { BackgroundAgentStore } from '../background-agent.store';
import { MessageNodeBuilderService } from './message-node-builder.service';
import { AgentStatsService } from './agent-stats.service';
import { MAX_DEPTH } from './execution-tree.constants';

@Injectable({ providedIn: 'root' })
export class AgentNodeBuilderService {
  private readonly backgroundAgentStore = inject(BackgroundAgentStore);
  private readonly messageBuilder = inject(MessageNodeBuilderService);
  private readonly agentStats = inject(AgentStatsService);

  /**
   * Build an agent node directly (for Task tools that spawn agents)
   * TASK_2025_095: Used to show agent bubble without Task tool wrapper
   *
   * @param agentStart - Agent start event
   * @param toolCallId - Parent tool call ID (for finding nested messages)
   * @param state - Streaming state
   * @param depth - Current recursion depth
   * @returns Agent ExecutionNode or null
   */
  buildAgentNode(
    agentStart: AgentStartEvent,
    toolCallId: string,
    state: StreamingState,
    depth: number,
  ): ExecutionNode | null {
    // Early exit if max depth exceeded
    if (depth >= MAX_DEPTH) {
      console.warn(
        '[ExecutionTreeBuilderService] Max recursion depth exceeded in buildAgentNode',
        {
          toolCallId,
          depth,
          maxDepth: MAX_DEPTH,
        },
      );
      return null;
    }

    // Find message_start events for this agent (linked via parentToolUseId)
    // TASK_2025_096 FIX: Only collect ASSISTANT messages, not user messages.
    // When SDK invokes an agent, it sends a user message with the prompt.
    // We don't want to display the agent's prompt as content inside the agent bubble.
    const agentMessageStarts = [...state.events.values()].filter(
      (e) =>
        e.eventType === 'message_start' &&
        e.parentToolUseId === toolCallId &&
        (e as MessageStartEvent).role === 'assistant',
    ) as MessageStartEvent[];

    // Build children for the agent node (the nested message content)
    const agentChildren: ExecutionNode[] = [];

    for (const msgStart of agentMessageStarts) {
      const messageNode = this.messageBuilder.buildMessageNode(
        msgStart.messageId,
        state,
        depth + 1,
      );
      if (messageNode) {
        // Unwrap message node - agent shows its content directly
        agentChildren.push(...messageNode.children);
      }
    }

    // TASK_2025_099: Get summaryContent and contentBlocks from maps
    // The key is agentId (e.g., "adcecb2"), NOT toolCallId, because:
    // - Hook sends UUID-format toolCallId
    // - Complete message sends toolu_* format toolCallId
    // - agentId is stable and consistent across both sources
    //
    // TASK_2025_099 FIX: If agentStart doesn't have agentId (complete events often don't),
    // try to find a matching hook-based agent_start event by agentType and use its agentId.
    let effectiveAgentId = agentStart.agentId;

    if (!effectiveAgentId) {
      // Find hook-based agent_start with matching agentType.
      // BUGFIX: When multiple agents of the same type exist in a session,
      // we must find the CLOSEST hook agent_start by timestamp, not just the first.
      // Using .find() returned the first (oldest) match, which was wrong.
      let bestHookMatch: AgentStartEvent | undefined;
      let bestTimeDiff = Infinity;

      for (const e of state.events.values()) {
        if (
          e.eventType === 'agent_start' &&
          e.source === 'hook' &&
          (e as AgentStartEvent).agentType === agentStart.agentType &&
          (e as AgentStartEvent).agentId
        ) {
          const timeDiff = Math.abs(e.timestamp - agentStart.timestamp);
          if (timeDiff < bestTimeDiff) {
            bestTimeDiff = timeDiff;
            bestHookMatch = e as AgentStartEvent;
          }
        }
      }

      if (bestHookMatch?.agentId) {
        effectiveAgentId = bestHookMatch.agentId;
      }
    }

    // TASK_2025_102: Get structured content blocks for proper interleaving
    const contentBlocks = effectiveAgentId
      ? state.agentContentBlocksMap.get(effectiveAgentId) || []
      : [];

    // Legacy: Get summaryContent (fallback if no content blocks)
    const summaryContent = effectiveAgentId
      ? state.agentSummaryAccumulators.get(effectiveAgentId) || undefined
      : undefined;

    // TASK_2025_102 FIX: Build interleaved children from content blocks
    // Content blocks preserve the original order: [text, tool_ref, text, tool_ref, ...]
    // We create text nodes for text blocks and find matching tool nodes for tool_ref blocks.
    let finalChildren: ExecutionNode[];

    if (contentBlocks.length > 0) {
      // Use structured content blocks for proper interleaving
      finalChildren = this.buildInterleavedChildren(
        agentStart.id,
        agentStart.timestamp,
        contentBlocks,
        agentChildren,
      );
    } else if (summaryContent && summaryContent.trim()) {
      // Fallback: Use legacy summaryContent as single text node at beginning
      finalChildren = [...agentChildren];
      const summaryTextNode = createExecutionNode({
        id: `${agentStart.id}-summary-text`,
        type: 'text',
        status: 'complete',
        content: summaryContent,
        children: [],
        startTime: agentStart.timestamp,
      });
      finalChildren.unshift(summaryTextNode);
    } else {
      // No summary content - just use tool children
      finalChildren = [...agentChildren];
    }

    // TASK_2025_132: Aggregate stats from child message events for this agent
    const stats = this.agentStats.aggregateAgentStats(toolCallId, state);

    // BUGFIX: Determine agent status from Task tool_result, not children count.
    // Previously `finalChildren.length > 0 ? 'complete' : 'streaming'` caused agents
    // to be marked 'complete' as soon as they produced any output, which broke
    // auto-scroll in inline-agent-bubble (scheduleScroll bails when !isStreaming).
    const hasTaskToolResult = [...state.events.values()].some(
      (e) =>
        e.eventType === 'tool_result' &&
        (e as ToolResultEvent).toolCallId === toolCallId,
    );

    // Create the AGENT node
    const isBackground =
      this.backgroundAgentStore.isBackgroundAgent(toolCallId);

    return createExecutionNode({
      id: agentStart.id,
      type: 'agent',
      status: hasTaskToolResult ? 'complete' : 'streaming',
      content: agentStart.agentDescription || '',
      children: finalChildren,
      startTime: agentStart.timestamp,
      agentType: agentStart.agentType,
      agentDescription: agentStart.agentDescription,
      toolCallId: agentStart.toolCallId,
      agentId: effectiveAgentId, // TASK_2025_099 FIX: Use effectiveAgentId (from hook if needed)
      ...stats, // TASK_2025_132: Spread agentModel, tokenUsage, cost, duration
      model: stats.agentModel, // TASK_2025_132: Also set model field for consistency
      ...(isBackground ? { isBackground: true } : {}),
    });
  }

  /**
   * TASK_2025_102: Build interleaved children from structured content blocks
   *
   * Content blocks from the JSONL file preserve the original interleaving:
   * [text, tool_ref, text, tool_ref, ...]
   *
   * This method creates text nodes for text blocks and matches tool_ref blocks
   * to actual tool nodes from SDK events, producing properly interleaved children.
   *
   * @param agentId - Agent node ID for generating child IDs
   * @param baseTimestamp - Base timestamp for ordering
   * @param contentBlocks - Structured content blocks from file watcher
   * @param toolChildren - Tool nodes from SDK events
   * @returns Interleaved array of text and tool nodes
   */
  buildInterleavedChildren(
    agentId: string,
    baseTimestamp: number,
    contentBlocks: Array<{
      type: 'text' | 'tool_ref';
      text?: string;
      toolUseId?: string;
      toolName?: string;
    }>,
    toolChildren: ExecutionNode[],
  ): ExecutionNode[] {
    const result: ExecutionNode[] = [];
    let textIndex = 0;

    // Create a map of toolUseId to tool nodes for quick lookup
    const toolMap = new Map<string, ExecutionNode>();
    for (const tool of toolChildren) {
      if (tool.toolCallId) {
        toolMap.set(tool.toolCallId, tool);
      }
    }

    // Track which tools have been added (to add remaining tools at the end)
    const addedToolIds = new Set<string>();

    for (const block of contentBlocks) {
      if (block.type === 'text' && block.text) {
        // Create text node for text block
        const textNode = createExecutionNode({
          id: `${agentId}-text-${textIndex++}`,
          type: 'text',
          status: 'complete',
          content: block.text,
          children: [],
          startTime: baseTimestamp + textIndex, // Increment for ordering
        });
        result.push(textNode);
      } else if (block.type === 'tool_ref' && block.toolUseId) {
        // Find matching tool node by toolUseId
        const toolNode = toolMap.get(block.toolUseId);
        if (toolNode) {
          result.push(toolNode);
          addedToolIds.add(block.toolUseId);
        } else {
          // Tool not found - this can happen if SDK events haven't arrived yet
          // Skip the tool_ref, the tool will be added from remaining tools
          console.debug(
            '[ExecutionTreeBuilder] tool_ref not found in toolChildren:',
            { toolUseId: block.toolUseId, toolName: block.toolName },
          );
        }
      }
    }

    // Add any remaining tools that weren't in content blocks
    // (e.g., tools that arrived via SDK but not yet in JSONL file)
    for (const tool of toolChildren) {
      if (tool.toolCallId && !addedToolIds.has(tool.toolCallId)) {
        result.push(tool);
      }
    }

    return result;
  }
}
