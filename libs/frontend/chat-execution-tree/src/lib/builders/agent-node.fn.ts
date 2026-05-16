/**
 * Agent-node pure builders.
 *
 * Recurses into messages via `deps.buildMessageNode`. No direct imports of
 * message-node.fn / tool-node.fn — recursion is callback-driven through
 * {@link BuilderDeps} to keep file-level imports acyclic.
 *
 * Critical invariants:
 * - MAX_DEPTH early exit + console.warn string byte-identical.
 * - effectiveAgentId hook-fallback closest-by-timestamp tie-break (NOT first-by-iteration).
 * - Status from `tool_result` presence, not children-count.
 * - Field-spread order: ...stats then explicit `model: stats.agentModel`.
 */

import type {
  AgentStartEvent,
  ExecutionNode,
  MessageStartEvent,
  ToolResultEvent,
} from '@ptah-extension/shared';
import { createExecutionNode } from '@ptah-extension/shared';
import type { StreamingState } from '@ptah-extension/chat-types';
import { MAX_DEPTH } from '../execution-tree.constants';
import type { BuilderDeps } from './builder-deps';

export function buildAgentNode(
  deps: BuilderDeps,
  agentStart: AgentStartEvent,
  toolCallId: string,
  state: StreamingState,
  depth: number,
): ExecutionNode | null {
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

  // Only collect ASSISTANT messages, not user messages.
  const agentMessageStarts = [...state.events.values()].filter(
    (e) =>
      e.eventType === 'message_start' &&
      e.parentToolUseId === toolCallId &&
      (e as MessageStartEvent).role === 'assistant',
  ) as MessageStartEvent[];

  const agentChildren: ExecutionNode[] = [];
  for (const msgStart of agentMessageStarts) {
    const messageNode = deps.buildMessageNode(
      msgStart.messageId,
      state,
      depth + 1,
    );
    if (messageNode) {
      // Unwrap message node — agent shows its content directly
      agentChildren.push(...messageNode.children);
    }
  }

  // If agentStart doesn't have agentId (complete events often don't),
  // try to find a matching hook-based agent_start event by agentType and use its agentId.
  let effectiveAgentId = agentStart.agentId;

  if (!effectiveAgentId) {
    // BUGFIX: When multiple agents of the same type exist in a session,
    // we must find the CLOSEST hook agent_start by timestamp, not just the first.
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

  // Get structured content blocks for proper interleaving
  const contentBlocks = effectiveAgentId
    ? state.agentContentBlocksMap.get(effectiveAgentId) || []
    : [];

  // Legacy: Get summaryContent (fallback if no content blocks)
  const summaryContent = effectiveAgentId
    ? state.agentSummaryAccumulators.get(effectiveAgentId) || undefined
    : undefined;

  // Use a stable id derived from toolCallId for the agent node itself AND
  // as the prefix for child text-block ids. Without this, the placeholder
  // agent (`agent-placeholder-${toolCallId}`) and the real agent
  // (`agentStart.id`, an event uuid) would have different ids, forcing a
  // full remount when `agent_start` arrived. Sharing `agent:${toolCallId}`
  // makes streaming → real a stable in-place update, and child text ids
  // `${stableAgentId}-text-${i}` stay stable across builds.
  const stableAgentId = `agent:${toolCallId}`;

  let finalChildren: ExecutionNode[];

  if (contentBlocks.length > 0) {
    finalChildren = buildInterleavedChildren(
      stableAgentId,
      agentStart.timestamp,
      contentBlocks,
      agentChildren,
    );
  } else if (summaryContent && summaryContent.trim()) {
    // Fallback: Use legacy summaryContent as single text node at beginning
    finalChildren = [...agentChildren];
    const summaryTextNode = createExecutionNode({
      id: `${stableAgentId}-summary-text`,
      type: 'text',
      status: 'complete',
      content: summaryContent,
      children: [],
      startTime: agentStart.timestamp,
    });
    finalChildren.unshift(summaryTextNode);
  } else {
    finalChildren = [...agentChildren];
  }

  // Aggregate stats from child message events for this agent
  const stats = deps.agentStats.aggregateAgentStats(toolCallId, state);

  // BUGFIX: Determine agent status from Task tool_result, not children count.
  const hasTaskToolResult = [...state.events.values()].some(
    (e) =>
      e.eventType === 'tool_result' &&
      (e as ToolResultEvent).toolCallId === toolCallId,
  );

  const isBackground = deps.backgroundAgentStore.isBackgroundAgent(toolCallId);

  return createExecutionNode({
    id: stableAgentId,
    type: 'agent',
    status: hasTaskToolResult ? 'complete' : 'streaming',
    content: agentStart.agentDescription || '',
    children: finalChildren,
    startTime: agentStart.timestamp,
    agentType: agentStart.agentType,
    agentDescription: agentStart.agentDescription,
    toolCallId: agentStart.toolCallId,
    agentId: effectiveAgentId,
    ...stats,
    model: stats.agentModel,
    ...(isBackground ? { isBackground: true } : {}),
  });
}

/**
 * Build interleaved children from structured content blocks.
 * Content blocks preserve original order: [text, tool_ref, text, tool_ref, ...]
 */
export function buildInterleavedChildren(
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

  const toolMap = new Map<string, ExecutionNode>();
  for (const tool of toolChildren) {
    if (tool.toolCallId) {
      toolMap.set(tool.toolCallId, tool);
    }
  }

  const addedToolIds = new Set<string>();

  for (const block of contentBlocks) {
    if (block.type === 'text' && block.text) {
      const textNode = createExecutionNode({
        id: `${agentId}-text-${textIndex++}`,
        type: 'text',
        status: 'complete',
        content: block.text,
        children: [],
        startTime: baseTimestamp + textIndex,
      });
      result.push(textNode);
    } else if (block.type === 'tool_ref' && block.toolUseId) {
      const toolNode = toolMap.get(block.toolUseId);
      if (toolNode) {
        result.push(toolNode);
        addedToolIds.add(block.toolUseId);
      } else {
        console.debug(
          '[ExecutionTreeBuilder] tool_ref not found in toolChildren:',
          { toolUseId: block.toolUseId, toolName: block.toolName },
        );
      }
    }
  }

  // Add any remaining tools that weren't in content blocks
  for (const tool of toolChildren) {
    if (tool.toolCallId && !addedToolIds.has(tool.toolCallId)) {
      result.push(tool);
    }
  }

  return result;
}
