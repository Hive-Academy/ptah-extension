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
      agentChildren.push(...messageNode.children);
    }
  }
  let effectiveAgentId = agentStart.agentId;

  if (!effectiveAgentId) {
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
  const contentBlocks = effectiveAgentId
    ? state.agentContentBlocksMap.get(effectiveAgentId) || []
    : [];
  const summaryContent = effectiveAgentId
    ? state.agentSummaryAccumulators.get(effectiveAgentId) || undefined
    : undefined;
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
  const stats = deps.agentStats.aggregateAgentStats(toolCallId, state);
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
  for (const tool of toolChildren) {
    if (tool.toolCallId && !addedToolIds.has(tool.toolCallId)) {
      result.push(tool);
    }
  }

  return result;
}
