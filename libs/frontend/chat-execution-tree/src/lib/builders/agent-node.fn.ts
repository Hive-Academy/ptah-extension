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
 *
 * TASK_2026_323 (R1): the three `[...state.events.values()]` scans that used to
 * run PER AGENT NODE now read {@link BuilderDeps.getIndexes}. The hook-fallback
 * bucket preserves events insertion order, so the strict `<` tie-break still
 * picks the same event.
 */

import type { AgentStartEvent, ExecutionNode } from '@ptah-extension/shared';
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
  const indexes = deps.getIndexes(state);
  const agentMessageStarts =
    indexes.assistantMessageStartsByParent.get(toolCallId) ?? [];

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

    for (const e of indexes.hookAgentStartsByType.get(agentStart.agentType) ??
      []) {
      if (e.agentId) {
        const timeDiff = Math.abs(e.timestamp - agentStart.timestamp);
        if (timeDiff < bestTimeDiff) {
          bestTimeDiff = timeDiff;
          bestHookMatch = e;
        }
      }
    }

    if (bestHookMatch?.agentId) {
      effectiveAgentId = bestHookMatch.agentId;
    }
  }
  const stableAgentId = `agent:${toolCallId}`;
  const stats = deps.agentStats.aggregateAgentStats(toolCallId, state, indexes);
  const hasTaskToolResult = indexes.toolResultByCallId.has(toolCallId);

  const isBackground = deps.backgroundAgentStore.isBackgroundAgent(toolCallId);

  return createExecutionNode({
    id: stableAgentId,
    type: 'agent',
    status: hasTaskToolResult ? 'complete' : 'streaming',
    content: agentStart.agentDescription || '',
    children: [...agentChildren],
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
