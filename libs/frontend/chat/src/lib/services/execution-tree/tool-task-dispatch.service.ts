/**
 * ToolTaskDispatchService - Builds the streaming "placeholder" agent node
 * shown when a Task tool has no matching agent_start yet.
 *
 * Extracted from ToolNodeBuilderService (Wave C7f, fallback split per design)
 * because the placeholder-agent branch of `collectTools` (~120 LOC) pushed
 * the tool builder over the 500-LOC ceiling.
 *
 * The method mutates the caller-provided `usedAgentEventIds` and
 * `usedToolCallIds` Sets to dedupe across parallel same-type agents — this
 * matches the original in-line code path exactly.
 */

import { Injectable, inject } from '@angular/core';
import type {
  AgentStartEvent,
  ExecutionNode,
  MessageStartEvent,
  ToolStartEvent,
} from '@ptah-extension/shared';
import { createExecutionNode } from '@ptah-extension/shared';
import type { StreamingState } from '../chat.types';
import { BackgroundAgentStore } from '../background-agent.store';
import { AgentNodeBuilderService } from './agent-node-builder.service';
import { AgentStatsService } from './agent-stats.service';
import { MessageNodeBuilderService } from './message-node-builder.service';

@Injectable({ providedIn: 'root' })
export class ToolTaskDispatchService {
  private readonly backgroundAgentStore = inject(BackgroundAgentStore);
  private readonly agentBuilder = inject(AgentNodeBuilderService);
  private readonly agentStats = inject(AgentStatsService);
  private readonly messageBuilder = inject(MessageNodeBuilderService);

  /**
   * Build a streaming agent placeholder node from accumulated tool input.
   *
   * Returns one of three discriminated outcomes:
   * - `{ kind: 'fallthrough' }` — the tool already completed (a tool_result
   *   event exists). Caller should fall through and build the normal tool node.
   * - `{ kind: 'skip' }` — this toolCallId already has a placeholder/agent
   *   (`usedToolCallIds` already contains it). Caller should `continue` the
   *   outer loop without pushing anything.
   * - `{ kind: 'placeholder', node }` — a streaming placeholder agent was
   *   built. Caller should push the node and `continue` the outer loop.
   *
   * Mutates `usedAgentEventIds` (with the matched hook agent_start) and
   * `usedToolCallIds` (with `toolStart.toolCallId`) only on the `placeholder`
   * outcome — preserving the original in-line code path's mutation semantics.
   *
   * @param toolStart - The Task tool_start event without an agent_start match
   * @param state - Current streaming state
   * @param depth - Current recursion depth
   * @param usedAgentEventIds - Caller-owned dedup Set for parallel same-type agents
   * @param usedToolCallIds - Caller-owned dedup Set for tool-call placeholders
   */
  tryBuildPlaceholderAgent(
    toolStart: ToolStartEvent,
    state: StreamingState,
    depth: number,
    usedAgentEventIds: Set<string>,
    usedToolCallIds: Set<string>,
  ):
    | { kind: 'fallthrough' }
    | { kind: 'skip' }
    | { kind: 'placeholder'; node: ExecutionNode } {
    // TASK_2025_099 FIX: Create streaming agent placeholder when no agent_start yet.
    // During streaming, agent_start events only arrive when the complete message comes.
    // Create a placeholder agent node from accumulated tool input to show the agent is working.
    const toolResult = [...state.events.values()].find(
      (e) =>
        e.eventType === 'tool_result' && e.toolCallId === toolStart.toolCallId,
    );

    // Only create placeholder if tool is still streaming (no result yet)
    if (toolResult) {
      return { kind: 'fallthrough' };
    }

    // Try to extract agent info from accumulated tool input
    const inputKey = `${toolStart.toolCallId}-input`;
    const inputString = state.toolInputAccumulators.get(inputKey) || '';

    // Skip if this specific toolCallId already has an agent node or placeholder
    if (usedToolCallIds.has(toolStart.toolCallId)) {
      return { kind: 'skip' };
    }

    // Extract agent type and description from partial JSON
    // The JSON may be incomplete, so we use regex to extract fields
    let agentType = 'Task';
    let agentDescription = 'Agent working...';

    // Try to extract subagent_type from partial JSON
    const typeMatch = inputString.match(/"subagent_type"\s*:\s*"([^"]+)"/);
    if (typeMatch) {
      agentType = typeMatch[1];
    }

    // Try to extract description from partial JSON
    const descMatch = inputString.match(/"description"\s*:\s*"([^"]+)"/);
    if (descMatch) {
      agentDescription = descMatch[1];
    }

    // TASK_2025_100 FIX: Build children from sub-agent messages even during streaming.
    // Previously, placeholder had empty children: []. This caused sub-agent's text and
    // tool content to not display until agent_start arrived (only with complete messages).
    // Now we collect children the same way buildAgentNode does.
    const agentMessageStarts = [...state.events.values()].filter(
      (e) =>
        e.eventType === 'message_start' &&
        e.parentToolUseId === toolStart.toolCallId &&
        (e as MessageStartEvent).role === 'assistant',
    ) as MessageStartEvent[];

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

    // Try to find matching hook-based agent_start to get agentId.
    // Hook-based agent_start events have agentId for stable summary lookup.
    // Filter out already-consumed agent_starts to handle parallel agents of same type.
    // BUGFIX: Use timestamp proximity instead of .find() to avoid matching
    // historical agents when multiple agents of the same type exist.
    // BUGFIX: Only match hooks whose parentToolUseId matches THIS tool_start's
    // toolCallId (or is not yet backfilled). Without this check, when the same
    // agent type is spawned in multiple batches, a new placeholder would match
    // the previous batch's hook and render its stale accumulated summary content.
    let hookAgentStart: AgentStartEvent | undefined;
    let bestPlaceholderTimeDiff = Infinity;
    for (const e of state.events.values()) {
      if (
        e.eventType === 'agent_start' &&
        e.source === 'hook' &&
        (e as AgentStartEvent).agentType === agentType &&
        !usedAgentEventIds.has(e.id) &&
        (!(e as AgentStartEvent).agentId ||
          !usedAgentEventIds.has((e as AgentStartEvent).agentId ?? '')) &&
        // Only match hooks that belong to THIS tool or aren't yet correlated
        (!e.parentToolUseId || e.parentToolUseId === toolStart.toolCallId)
      ) {
        const timeDiff = Math.abs(e.timestamp - toolStart.timestamp);
        if (timeDiff < bestPlaceholderTimeDiff) {
          bestPlaceholderTimeDiff = timeDiff;
          hookAgentStart = e as AgentStartEvent;
        }
      }
    }

    // Mark this hook agent_start as consumed for parallel agent dedup
    if (hookAgentStart) {
      usedAgentEventIds.add(hookAgentStart.id);
      if (hookAgentStart.agentId) {
        usedAgentEventIds.add(hookAgentStart.agentId);
      }
    }

    // Get summaryContent using agentId if available
    // Fallback to toolCallId for backward compatibility
    const placeholderAgentId = hookAgentStart?.agentId;

    // TASK_2025_102: Get structured content blocks for proper interleaving
    const placeholderContentBlocks = placeholderAgentId
      ? state.agentContentBlocksMap.get(placeholderAgentId) || []
      : [];

    // Legacy: Get summaryContent (fallback if no content blocks)
    const placeholderSummaryContent = placeholderAgentId
      ? state.agentSummaryAccumulators.get(placeholderAgentId) || undefined
      : state.agentSummaryAccumulators.get(toolStart.toolCallId) || undefined;

    // TASK_2025_102 FIX: Build interleaved children from content blocks
    let finalPlaceholderChildren: ExecutionNode[];

    if (placeholderContentBlocks.length > 0) {
      // Use structured content blocks for proper interleaving
      finalPlaceholderChildren = this.agentBuilder.buildInterleavedChildren(
        `agent-placeholder-${toolStart.toolCallId}`,
        toolStart.timestamp,
        placeholderContentBlocks,
        agentChildren,
      );
    } else if (placeholderSummaryContent && placeholderSummaryContent.trim()) {
      // Fallback: Use legacy summaryContent as single text node at beginning
      finalPlaceholderChildren = [...agentChildren];
      const summaryTextNode = createExecutionNode({
        id: `agent-placeholder-${toolStart.toolCallId}-summary-text`,
        type: 'text',
        status: 'complete',
        content: placeholderSummaryContent,
        children: [],
        startTime: toolStart.timestamp,
      });
      finalPlaceholderChildren.unshift(summaryTextNode);
    } else {
      // No summary content - just use tool children
      finalPlaceholderChildren = [...agentChildren];
    }

    // TASK_2025_132: Aggregate stats from child message events for this placeholder agent
    const placeholderStats = this.agentStats.aggregateAgentStats(
      toolStart.toolCallId,
      state,
    );

    const isPlaceholderBackground = this.backgroundAgentStore.isBackgroundAgent(
      toolStart.toolCallId,
    );

    const placeholderAgent = createExecutionNode({
      id: `agent-placeholder-${toolStart.toolCallId}`,
      type: 'agent',
      status: 'streaming',
      content: agentDescription,
      children: finalPlaceholderChildren, // Now includes summary as text child
      startTime: toolStart.timestamp,
      agentType: agentType,
      agentDescription: agentDescription,
      toolCallId: toolStart.toolCallId,
      agentId: placeholderAgentId, // TASK_2025_099: From hook if available
      // summaryContent no longer needed on node - it's now a child text node
      ...placeholderStats, // TASK_2025_132: Spread agentModel, tokenUsage, cost, duration
      model: placeholderStats.agentModel, // TASK_2025_132: Also set model field for consistency
      ...(isPlaceholderBackground ? { isBackground: true } : {}),
    });

    // Mark this toolCallId as used to prevent duplicates
    usedToolCallIds.add(toolStart.toolCallId);

    return { kind: 'placeholder', node: placeholderAgent };
  }
}
