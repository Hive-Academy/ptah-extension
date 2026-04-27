/**
 * Tool-node pure builders — extracted from ToolNodeBuilderService and
 * ToolTaskDispatchService. The streaming "placeholder agent" branch is
 * now `tryBuildPlaceholderAgent` below.
 *
 * Recurses via `deps.buildAgentNode` and `deps.buildMessageNode`. No
 * direct imports of the other .fn modules — recursion is callback-driven
 * through {@link BuilderDeps} to keep file-level imports acyclic.
 */

import type {
  AgentStartEvent,
  ExecutionNode,
  MessageStartEvent,
  ToolResultEvent,
  ToolStartEvent,
} from '@ptah-extension/shared';
import {
  createExecutionNode,
  isAgentDispatchTool,
} from '@ptah-extension/shared';
import type { StreamingState } from '@ptah-extension/chat-types';
import { MAX_DEPTH } from '../execution-tree.constants';
import type { BuilderDeps } from './builder-deps';

/** Result of safe JSON parsing with error tracking (TASK_2025_088 Batch 2). */
interface ParseResult<T> {
  success: boolean;
  data?: T;
  error?: string;
  raw?: string;
}

export function collectTools(
  deps: BuilderDeps,
  messageId: string,
  state: StreamingState,
  depth: number,
): ExecutionNode[] {
  const tools: ExecutionNode[] = [];

  // TASK_2025_095 FIX: Collect tools based on messageId AND context depth
  const toolStarts = [...state.events.values()].filter((e) => {
    if (e.eventType !== 'tool_start') return false;
    if (e.messageId !== messageId) return false;
    if (depth === 0 && e.parentToolUseId) return false;
    return true;
  }) as ToolStartEvent[];

  // Track used agent event IDs to prevent duplicate agent nodes for parallel
  // same-type agents.
  const usedAgentEventIds = new Set<string>();
  const usedToolCallIds = new Set<string>();

  for (const toolStart of toolStarts) {
    // TASK_2025_211 Bug 6: Broaden detection to handle dispatch_agent /
    // dispatch_subagent and data-driven detection via subagent_type.
    let isAgentDispatch =
      toolStart.isTaskTool || isAgentDispatchTool(toolStart.toolName);

    if (!isAgentDispatch) {
      const inputKey = `${toolStart.toolCallId}-input`;
      const inputString = state.toolInputAccumulators.get(inputKey) || '';
      if (
        inputString.includes('"subagent_type"') ||
        inputString.includes('"subagentType"')
      ) {
        isAgentDispatch = true;
      }
    }

    if (isAgentDispatch) {
      // TASK_2025_128 FIX: parentToolUseId may use UUID vs toolu_* mismatch.
      let agentStarts = [...state.events.values()].filter(
        (e) =>
          e.eventType === 'agent_start' &&
          e.parentToolUseId === toolStart.toolCallId,
      ) as AgentStartEvent[];

      if (agentStarts.length === 0) {
        const inputKey = `${toolStart.toolCallId}-input`;
        const inputString = state.toolInputAccumulators.get(inputKey) || '';
        const typeMatch = inputString.match(/"subagent_type"\s*:\s*"([^"]+)"/);

        if (typeMatch) {
          const agentType = typeMatch[1];
          agentStarts = [...state.events.values()].filter(
            (e) =>
              e.eventType === 'agent_start' &&
              (e as AgentStartEvent).agentType === agentType &&
              (!e.parentToolUseId ||
                e.parentToolUseId === toolStart.toolCallId ||
                !e.parentToolUseId.startsWith('toolu_')),
          ) as AgentStartEvent[];

          // BUGFIX: Sort by timestamp proximity to the tool_start.
          agentStarts.sort(
            (a, b) =>
              Math.abs(a.timestamp - toolStart.timestamp) -
              Math.abs(b.timestamp - toolStart.timestamp),
          );
        }
      }

      if (agentStarts.length > 0) {
        let matchedAgent: AgentStartEvent | null = null;

        for (const agentStart of agentStarts) {
          if (usedAgentEventIds.has(agentStart.id)) continue;
          if (agentStart.agentId && usedAgentEventIds.has(agentStart.agentId)) {
            continue;
          }
          matchedAgent = agentStart;
          break;
        }

        if (matchedAgent) {
          usedAgentEventIds.add(matchedAgent.id);
          if (matchedAgent.agentId) {
            usedAgentEventIds.add(matchedAgent.agentId);
          }
          usedToolCallIds.add(toolStart.toolCallId);

          const agentNode = deps.buildAgentNode(
            matchedAgent,
            toolStart.toolCallId,
            state,
            depth,
          );
          if (agentNode) {
            tools.push(agentNode);
          }
        }
        continue;
      } else {
        if (!deps.loggedUnmatchedToolCallIds.has(toolStart.toolCallId)) {
          deps.loggedUnmatchedToolCallIds.add(toolStart.toolCallId);
          console.debug(
            '[ExecutionTreeBuilder] No agent_start match for Task tool:',
            {
              toolCallId: toolStart.toolCallId,
              toolSource: toolStart.source,
            },
          );
        }
        // TASK_2025_099 FIX: streaming placeholder when no agent_start yet.
        const dispatchResult = tryBuildPlaceholderAgent(
          deps,
          toolStart,
          state,
          depth,
          usedAgentEventIds,
          usedToolCallIds,
        );
        if (dispatchResult.kind === 'placeholder') {
          tools.push(dispatchResult.node);
          continue;
        }
        if (dispatchResult.kind === 'skip') {
          continue;
        }
        // 'fallthrough' — tool already has a result; build normal tool node.
      }
    }

    tools.push(buildToolNode(deps, toolStart, state, depth));
  }

  return tools;
}

export function buildToolNode(
  deps: BuilderDeps,
  toolStart: ToolStartEvent,
  state: StreamingState,
  depth = 0,
): ExecutionNode {
  const resultEvent = [...state.events.values()].find(
    (e) =>
      e.eventType === 'tool_result' && e.toolCallId === toolStart.toolCallId,
  ) as ToolResultEvent | undefined;

  const inputKey = `${toolStart.toolCallId}-input`;
  const inputString = state.toolInputAccumulators.get(inputKey) || '';

  // FIX: Defer JSON parsing until tool_result arrives (incomplete JSON during
  // streaming would otherwise cause ~15+ SyntaxError warnings per tool call).
  let toolInput: Record<string, unknown> | undefined;
  if (inputString && resultEvent) {
    const result = parseToolInput(inputString);
    if (result.success) {
      toolInput = result.data;
    } else if (
      toolStart.toolInput &&
      Object.keys(toolStart.toolInput).length > 0
    ) {
      // FIX: Accumulator partial/corrupt — fall back to 'complete' source toolInput.
      toolInput = toolStart.toolInput;
    } else {
      toolInput = {
        __parseError: result.error,
        __raw: result.raw,
      } as Record<string, unknown>;

      // TASK_2025_100 FIX: Only warn if JSON looks complete.
      const trimmed = result.raw?.trim() || '';
      const looksComplete = trimmed.endsWith('}') || trimmed.endsWith(']');
      if (looksComplete) {
        console.warn('[ExecutionTreeBuilderService] Tool input parse failed', {
          toolCallId: toolStart.toolCallId,
          error: result.error,
          raw: result.raw?.substring(0, 100),
        });
      }
    }
  } else if (inputString) {
    toolInput = {
      __streaming: true,
      __rawSnippet:
        inputString.substring(0, 50) + (inputString.length > 50 ? '...' : ''),
    } as Record<string, unknown>;
  } else if (
    toolStart.toolInput &&
    Object.keys(toolStart.toolInput).length > 0
  ) {
    // Fallback to toolStart.toolInput for historical sessions.
    toolInput = toolStart.toolInput;
  } else {
    toolInput = undefined;
  }

  const children = buildToolChildren(deps, toolStart.toolCallId, state, depth);

  return createExecutionNode({
    id: toolStart.id,
    type: 'tool',
    status: resultEvent ? 'complete' : 'streaming',
    content: null,
    toolInput,
    children,
    startTime: toolStart.timestamp,
    toolName: toolStart.toolName,
    toolCallId: toolStart.toolCallId,
    toolOutput: resultEvent?.output,
    isPermissionRequest: resultEvent?.isPermissionRequest,
  });
}

export function buildToolChildren(
  deps: BuilderDeps,
  toolCallId: string,
  state: StreamingState,
  depth = 0,
): ExecutionNode[] {
  if (depth >= MAX_DEPTH) {
    console.warn('[ExecutionTreeBuilderService] Max recursion depth exceeded', {
      toolCallId,
      depth,
      maxDepth: MAX_DEPTH,
    });
    return [];
  }

  const children: ExecutionNode[] = [];

  const agentStarts = [...state.events.values()].filter(
    (e) => e.eventType === 'agent_start' && e.parentToolUseId === toolCallId,
  ) as AgentStartEvent[];

  for (const agentStart of agentStarts) {
    const agentNode = deps.buildAgentNode(agentStart, toolCallId, state, depth);
    if (agentNode) {
      children.push(agentNode);
    }
  }

  return children;
}

function parseToolInput(input: string): ParseResult<Record<string, unknown>> {
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
 * Build a streaming agent placeholder when a Task tool has no matching
 * agent_start yet. Mutates `usedAgentEventIds` (matched hook agent_start)
 * and `usedToolCallIds` (`toolStart.toolCallId`) only on the 'placeholder'
 * outcome — preserves original in-line code path's mutation semantics.
 */
function tryBuildPlaceholderAgent(
  deps: BuilderDeps,
  toolStart: ToolStartEvent,
  state: StreamingState,
  depth: number,
  usedAgentEventIds: Set<string>,
  usedToolCallIds: Set<string>,
):
  | { kind: 'fallthrough' }
  | { kind: 'skip' }
  | { kind: 'placeholder'; node: ExecutionNode } {
  // TASK_2025_099 FIX: only create placeholder if tool is still streaming.
  const toolResult = [...state.events.values()].find(
    (e) =>
      e.eventType === 'tool_result' && e.toolCallId === toolStart.toolCallId,
  );
  if (toolResult) {
    return { kind: 'fallthrough' };
  }

  const inputKey = `${toolStart.toolCallId}-input`;
  const inputString = state.toolInputAccumulators.get(inputKey) || '';

  if (usedToolCallIds.has(toolStart.toolCallId)) {
    return { kind: 'skip' };
  }

  let agentType = 'Task';
  let agentDescription = 'Agent working...';

  const typeMatch = inputString.match(/"subagent_type"\s*:\s*"([^"]+)"/);
  if (typeMatch) {
    agentType = typeMatch[1];
  }

  const descMatch = inputString.match(/"description"\s*:\s*"([^"]+)"/);
  if (descMatch) {
    agentDescription = descMatch[1];
  }

  // TASK_2025_100 FIX: Build children from sub-agent messages even during streaming.
  const agentMessageStarts = [...state.events.values()].filter(
    (e) =>
      e.eventType === 'message_start' &&
      e.parentToolUseId === toolStart.toolCallId &&
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

  // BUGFIX: Use timestamp proximity instead of .find() to avoid matching
  // historical agents when multiple agents of the same type exist.
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
      (!e.parentToolUseId || e.parentToolUseId === toolStart.toolCallId)
    ) {
      const timeDiff = Math.abs(e.timestamp - toolStart.timestamp);
      if (timeDiff < bestPlaceholderTimeDiff) {
        bestPlaceholderTimeDiff = timeDiff;
        hookAgentStart = e as AgentStartEvent;
      }
    }
  }

  if (hookAgentStart) {
    usedAgentEventIds.add(hookAgentStart.id);
    if (hookAgentStart.agentId) {
      usedAgentEventIds.add(hookAgentStart.agentId);
    }
  }

  const placeholderAgentId = hookAgentStart?.agentId;

  // TASK_2025_102: structured content blocks for proper interleaving.
  const placeholderContentBlocks = placeholderAgentId
    ? state.agentContentBlocksMap.get(placeholderAgentId) || []
    : [];

  const placeholderSummaryContent = placeholderAgentId
    ? state.agentSummaryAccumulators.get(placeholderAgentId) || undefined
    : state.agentSummaryAccumulators.get(toolStart.toolCallId) || undefined;

  let finalPlaceholderChildren: ExecutionNode[];

  if (placeholderContentBlocks.length > 0) {
    finalPlaceholderChildren = deps.buildInterleavedChildren(
      `agent-placeholder-${toolStart.toolCallId}`,
      toolStart.timestamp,
      placeholderContentBlocks,
      agentChildren,
    );
  } else if (placeholderSummaryContent && placeholderSummaryContent.trim()) {
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
    finalPlaceholderChildren = [...agentChildren];
  }

  // TASK_2025_132: Aggregate stats from child message events.
  const placeholderStats = deps.agentStats.aggregateAgentStats(
    toolStart.toolCallId,
    state,
  );

  const isPlaceholderBackground = deps.backgroundAgentStore.isBackgroundAgent(
    toolStart.toolCallId,
  );

  const placeholderAgent = createExecutionNode({
    id: `agent-placeholder-${toolStart.toolCallId}`,
    type: 'agent',
    status: 'streaming',
    content: agentDescription,
    children: finalPlaceholderChildren,
    startTime: toolStart.timestamp,
    agentType,
    agentDescription,
    toolCallId: toolStart.toolCallId,
    agentId: placeholderAgentId,
    ...placeholderStats,
    model: placeholderStats.agentModel,
    ...(isPlaceholderBackground ? { isBackground: true } : {}),
  });

  usedToolCallIds.add(toolStart.toolCallId);

  return { kind: 'placeholder', node: placeholderAgent };
}
