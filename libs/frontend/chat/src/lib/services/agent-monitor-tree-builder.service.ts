/**
 * AgentMonitorTreeBuilderService
 *
 * Lightweight service that builds ExecutionNode[] from a flat FlatStreamEventUnion[] array.
 * This is a simplified version of ExecutionTreeBuilderService tailored for the agent monitor
 * context -- no StreamingState Maps, no tab state, no deduplication, no background agent store.
 *
 * The agent monitor receives a single flat array of events per agent. This service:
 * 1. Indexes events by type/relationship IDs
 * 2. Builds text/thinking/tool-input accumulators
 * 3. Creates ExecutionNode tree from landmark events
 * 4. Returns root-level children (skips message wrapper since agent card provides its own chrome)
 *
 * PERFORMANCE: Memoized by events.length -- only rebuilds when new events arrive.
 * A per-agent entry is released when AgentMonitorStore drops that agent.
 *
 * @see ExecutionTreeBuilderService for the full chat-context version
 */

import { Injectable, computed, effect, inject } from '@angular/core';
import { AgentMonitorStore } from '@ptah-extension/chat-streaming';
import { fenceCodeBlock } from '@ptah-extension/chat-ui';
import type {
  ExecutionNode,
  FlatStreamEventUnion,
  MessageStartEvent,
  TextDeltaEvent,
  ThinkingDeltaEvent,
  ToolStartEvent,
  ToolDeltaEvent,
  ToolResultEvent,
  AgentStartEvent,
  CliOutputSegment,
} from '@ptah-extension/shared';
import {
  createExecutionNode,
  isAgentDispatchTool,
} from '@ptah-extension/shared';

function sameMembers(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  if (a.size !== b.size) return false;
  for (const id of a) if (!b.has(id)) return false;
  return true;
}

/** Maximum recursion depth for nested agent tree building */
const MAX_DEPTH = 10;

/** Header label for a result segment that arrived with no matching tool call. */
const ORPHAN_TOOL_LABELS: Record<
  'tool-result' | 'tool-result-error' | 'command' | 'file-change',
  string
> = {
  'tool-result': 'Tool result',
  'tool-result-error': 'Tool result',
  command: 'Command',
  'file-change': 'File change',
};

/**
 * Memoization cache entry for the segment tree builder.
 * Store updates replace the segment array, including coalesced text updates.
 */
interface TreeCache {
  segments: readonly CliOutputSegment[];
  count: number;
  tree: ExecutionNode[];
}

/**
 * Per-agent accumulators folded from the event stream. Persisted across
 * buildTree() calls so each delta only indexes the newly-arrived events
 * instead of re-scanning the whole array — turning the per-delta cost from
 * O(total events) into O(new events).
 *
 * The `*ByMessage` / `*ByTool` indexes are kept next to the accumulators so
 * the assembly reads each message's blocks directly instead of scanning every
 * accumulator per message: one assembly is O(total blocks), not
 * O(messages x blocks). The output is identical to a from-scratch build of
 * the same events.
 */
interface TreeAccumulators {
  /** Key `${messageId}-block-${blockIndex}` -> accumulated text. */
  textAccumulators: Map<string, string>;
  /** Key `${messageId}-thinking-${blockIndex}` -> accumulated thinking. */
  thinkingAccumulators: Map<string, string>;
  toolInputAccumulators: Map<string, string>;
  toolResults: Map<string, ToolResultEvent>;
  messageStarts: MessageStartEvent[];
  toolStarts: ToolStartEvent[];
  agentStarts: AgentStartEvent[];
  /** Text block indexes per messageId, in first-seen order. */
  textBlocksByMessage: Map<string, number[]>;
  /** Thinking block indexes per messageId, in first-seen order. */
  thinkingBlocksByMessage: Map<string, number[]>;
  /** Tool starts per messageId, in arrival order. */
  toolStartsByMessage: Map<string, ToolStartEvent[]>;
  /** Assistant message starts per parentToolUseId, in arrival order. */
  assistantMessagesByTool: Map<string, MessageStartEvent[]>;
  /**
   * Tool input resolved for a finished tool, per toolCallId. Reused while the
   * accumulated raw input string is unchanged, so each finished tool's input
   * is parsed once instead of on every assembly.
   */
  toolInputCache: Map<
    string,
    { raw: string; value: Record<string, unknown> | undefined }
  >;
}

function pushGrouped<T>(map: Map<string, T[]>, key: string, value: T): void {
  const group = map.get(key);
  if (group) group.push(value);
  else map.set(key, [value]);
}

interface AgentBuildState extends TreeAccumulators {
  /** Number of events already folded into the accumulators. */
  processedCount: number;
  /** Last assembled tree — returned as-is when no new events have arrived. */
  lastTree: ExecutionNode[] | null;
}

@Injectable({ providedIn: 'root' })
export class AgentMonitorTreeBuilderService {
  /**
   * Per-agent incremental build state. Keyed by a caller-provided agent ID to
   * avoid collision when multiple agents share this singleton service.
   */
  private readonly eventStateMap = new Map<string, AgentBuildState>();
  private readonly segmentCacheMap = new Map<string, TreeCache>();

  private readonly agentStore = inject(AgentMonitorStore);

  /**
   * Ids of the agents the store currently holds. Equal by membership, so
   * output deltas (which replace the agent list on every chunk) don't wake the
   * release effect — only spawn, eviction and session teardown do.
   */
  private readonly storeAgentIds = computed(
    () => new Set(this.agentStore.agentsById().keys()),
    { equal: sameMembers },
  );

  constructor() {
    // Release an agent's accumulated text/thinking/tool state once the store
    // drops it (completed-agent eviction, tab close, clear). Only ids that left
    // the store are released: ids never seen there, and agents still held —
    // running or finished — keep their cache, so hiding a tile never costs a
    // rebuild.
    let previous: ReadonlySet<string> = new Set();
    effect(() => {
      const current = this.storeAgentIds();
      for (const id of previous) {
        if (!current.has(id)) this.clearAgentCache(id);
      }
      previous = current;
    });
  }

  /**
   * Build ExecutionNode tree from flat streaming events.
   *
   * Incremental: only events past the last processed index are folded into the
   * agent's persistent accumulators; the tree is then reassembled from them.
   * When no new events have arrived the previously-assembled tree is returned
   * by reference. A shrunken array (agent reset/replaced) restarts the state.
   *
   * @param agentId - Unique agent identifier for per-agent state isolation
   * @param events - Flat array of streaming events from MonitoredAgent.streamEvents
   * @returns Array of root-level ExecutionNode objects
   */
  buildTree(
    agentId: string,
    events: readonly FlatStreamEventUnion[],
  ): ExecutionNode[] {
    let state = this.eventStateMap.get(agentId);
    if (!state || events.length < state.processedCount) {
      state = this.createBuildState();
      this.eventStateMap.set(agentId, state);
    }
    if (state.lastTree && events.length === state.processedCount) {
      return state.lastTree;
    }
    for (let i = state.processedCount; i < events.length; i++) {
      this.indexEvent(events[i], state);
    }
    state.processedCount = events.length;
    const tree = this.assembleTree(state);
    state.lastTree = tree;
    return tree;
  }

  /**
   * Build ExecutionNode tree from flat CliOutputSegment[].
   *
   * Converts structured CLI output segments (from Copilot/Codex SDK adapters)
   * into ExecutionNode[] suitable for rendering by ExecutionNodeComponent.
   *
   * Algorithm:
   * 1. Walk segments sequentially
   * 2. text → merge consecutive into a single text ExecutionNode
   * 3. thinking → merge consecutive into a single thinking ExecutionNode
   * 4. tool-call → create tool ExecutionNode (status: streaming), index by toolCallId
   * 5. tool-result / tool-result-error / command / file-change → pair with tool node via toolCallId (FIFO fallback)
   * 6. error → text node with error content
   * 7. info → text node with muted content
   *
   * @param agentId - Unique agent identifier for per-agent cache isolation
   * @param segments - Flat array of structured segments from MonitoredAgent.segments
   * @returns Array of root-level ExecutionNode objects
   */
  buildTreeFromSegments(
    agentId: string,
    segments: readonly CliOutputSegment[],
  ): ExecutionNode[] {
    const cached = this.segmentCacheMap.get(agentId);
    if (
      cached &&
      cached.segments === segments &&
      cached.count === segments.length
    ) {
      return cached.tree;
    }

    const tree = this.buildTreeFromSegmentsInternal(segments);
    this.segmentCacheMap.set(agentId, {
      segments,
      count: segments.length,
      tree,
    });
    return tree;
  }

  /**
   * Finalize orphaned tools in a tree: any tool still in 'streaming' status
   * is marked as 'error' with a descriptive message. This handles the case
   * where the SDK terminates (e.g. ExitPlanMode) before a tool finishes.
   *
   * Returns a new tree if changes were made, or the same reference if not.
   */
  finalizeOrphanedTools(
    nodes: readonly ExecutionNode[],
  ): readonly ExecutionNode[] {
    let changed = false;
    const finalized = nodes.map((node) => {
      let updated = node;
      if (node.type === 'tool' && node.status === 'streaming') {
        updated = createExecutionNode({
          ...node,
          status: 'error',
          error: 'Tool execution interrupted — session ended before completion',
        });
        changed = true;
      }
      if (node.children.length > 0) {
        const currentChildren = node.children;
        const newChildren = this.finalizeOrphanedTools(currentChildren);
        if (newChildren !== currentChildren) {
          updated =
            updated === node
              ? createExecutionNode({ ...node, children: newChildren })
              : createExecutionNode({ ...updated, children: newChildren });
          changed = true;
        }
      }

      return updated;
    });

    return changed ? finalized : nodes;
  }

  /** Clear caches for a specific agent (e.g., when agent is removed) */
  clearAgentCache(agentId: string): void {
    this.eventStateMap.delete(agentId);
    this.segmentCacheMap.delete(agentId);
  }

  /** Clear all caches */
  clearCache(): void {
    this.eventStateMap.clear();
    this.segmentCacheMap.clear();
  }

  private buildTreeFromSegmentsInternal(
    segments: readonly CliOutputSegment[],
  ): ExecutionNode[] {
    if (segments.length === 0) return [];

    const nodes: ExecutionNode[] = [];
    const toolCallIdToIndex = new Map<string, number>();
    const unresolvedToolIndices: number[] = [];

    let textBuffer = '';
    let textBufferStart = -1; // segment index where current text buffer started
    let thinkingBuffer = '';
    let thinkingBufferStart = -1;

    const flushText = (): void => {
      if (textBuffer.trim()) {
        nodes.push(
          createExecutionNode({
            id: `seg-text-${textBufferStart}`,
            type: 'text',
            status: 'complete',
            content: textBuffer,
          }),
        );
      }
      textBuffer = '';
      textBufferStart = -1;
    };

    const flushThinking = (): void => {
      if (thinkingBuffer.trim()) {
        nodes.push(
          createExecutionNode({
            id: `seg-thinking-${thinkingBufferStart}`,
            type: 'thinking',
            status: 'complete',
            content: thinkingBuffer,
          }),
        );
      }
      thinkingBuffer = '';
      thinkingBufferStart = -1;
    };

    for (let i = 0; i < segments.length; i++) {
      const segment = segments[i];

      switch (segment.type) {
        case 'text': {
          if (thinkingBuffer) flushThinking();
          if (textBufferStart === -1) textBufferStart = i;
          textBuffer += segment.content;
          break;
        }

        case 'thinking': {
          if (textBuffer) flushText();
          if (thinkingBufferStart === -1) thinkingBufferStart = i;
          thinkingBuffer += segment.content;
          break;
        }

        case 'tool-call': {
          if (textBuffer) flushText();
          if (thinkingBuffer) flushThinking();
          const toolInput = segment.toolInput
            ? this.normalizeToolInput(segment.toolName ?? '', segment.toolInput)
            : segment.toolArgs
              ? { __summary: segment.toolArgs }
              : undefined;

          const toolNode = createExecutionNode({
            id: `seg-tool-${i}`,
            type: 'tool',
            status: 'streaming',
            content: null,
            toolName: segment.toolName,
            toolInput,
          });

          const nodeIndex = nodes.length;
          nodes.push(toolNode);

          if (segment.toolCallId) {
            toolCallIdToIndex.set(segment.toolCallId, nodeIndex);
          }
          unresolvedToolIndices.push(nodeIndex);
          break;
        }

        case 'tool-result':
        case 'tool-result-error':
        case 'command':
        case 'file-change': {
          if (textBuffer) flushText();
          if (thinkingBuffer) flushThinking();
          let matchedIndex = -1;
          if (segment.toolCallId) {
            matchedIndex = toolCallIdToIndex.get(segment.toolCallId) ?? -1;
          }
          if (matchedIndex === -1 && unresolvedToolIndices.length > 0) {
            for (let j = 0; j < unresolvedToolIndices.length; j++) {
              if (nodes[unresolvedToolIndices[j]].status === 'streaming') {
                matchedIndex = unresolvedToolIndices[j];
                break;
              }
            }
          }

          if (matchedIndex >= 0) {
            const original = nodes[matchedIndex];
            nodes[matchedIndex] = createExecutionNode({
              ...original,
              status:
                segment.type === 'tool-result-error' ? 'error' : 'complete',
              toolOutput: segment.content,
              toolName: original.toolName || segment.toolName,
            });
          } else {
            nodes.push(
              createExecutionNode({
                id: `seg-orphan-${i}`,
                type: 'tool',
                status:
                  segment.type === 'tool-result-error' ? 'error' : 'complete',
                toolName: segment.toolName || ORPHAN_TOOL_LABELS[segment.type],
                toolOutput: segment.content,
                content: null,
              }),
            );
          }
          break;
        }

        case 'error': {
          if (textBuffer) flushText();
          if (thinkingBuffer) flushThinking();
          nodes.push(
            createExecutionNode({
              id: `seg-error-${i}`,
              type: 'text',
              status: 'complete',
              content: fenceCodeBlock(segment.content, 'text'),
              error: segment.content,
            }),
          );
          break;
        }

        case 'info': {
          if (textBuffer) flushText();
          if (thinkingBuffer) flushThinking();
          nodes.push(
            createExecutionNode({
              id: `seg-info-${i}`,
              type: 'text',
              status: 'complete',
              content: fenceCodeBlock(segment.content, 'text'),
            }),
          );
          break;
        }

        default:
          break;
      }
    }
    if (textBuffer) flushText();
    if (thinkingBuffer) flushThinking();

    return nodes;
  }

  /**
   * Normalize tool input fields across different CLI naming conventions.
   * Copilot uses 'path' where Claude SDK uses 'file_path', etc.
   */
  private normalizeToolInput(
    toolName: string,
    input: Record<string, unknown>,
  ): Record<string, unknown> {
    const normalized = { ...input };
    const name = toolName.toLowerCase();
    if (
      'path' in normalized &&
      !('file_path' in normalized) &&
      /read|write|edit|replace|create_file|patch_file/.test(name)
    ) {
      normalized['file_path'] = normalized['path'];
    }

    return normalized;
  }

  private createBuildState(): AgentBuildState {
    return {
      textAccumulators: new Map<string, string>(),
      thinkingAccumulators: new Map<string, string>(),
      toolInputAccumulators: new Map<string, string>(),
      toolResults: new Map<string, ToolResultEvent>(),
      messageStarts: [],
      toolStarts: [],
      agentStarts: [],
      textBlocksByMessage: new Map<string, number[]>(),
      thinkingBlocksByMessage: new Map<string, number[]>(),
      toolStartsByMessage: new Map<string, ToolStartEvent[]>(),
      assistantMessagesByTool: new Map<string, MessageStartEvent[]>(),
      toolInputCache: new Map(),
      processedCount: 0,
      lastTree: null,
    };
  }

  /** Fold a single event into the accumulators (incremental indexing step). */
  private indexEvent(event: FlatStreamEventUnion, acc: TreeAccumulators): void {
    switch (event.eventType) {
      case 'message_start': {
        const ms = event as MessageStartEvent;
        acc.messageStarts.push(ms);
        if (ms.parentToolUseId && ms.role === 'assistant') {
          pushGrouped(acc.assistantMessagesByTool, ms.parentToolUseId, ms);
        }
        break;
      }

      case 'text_delta': {
        const td = event as TextDeltaEvent;
        const blockIndex = td.blockIndex ?? 0;
        const key = `${td.messageId}-block-${blockIndex}`;
        const previous = acc.textAccumulators.get(key);
        if (previous === undefined) {
          pushGrouped(acc.textBlocksByMessage, td.messageId, blockIndex);
        }
        acc.textAccumulators.set(key, (previous ?? '') + td.delta);
        break;
      }

      case 'thinking_delta': {
        const thd = event as ThinkingDeltaEvent;
        const blockIndex = thd.blockIndex ?? 0;
        const key = `${thd.messageId}-thinking-${blockIndex}`;
        const previous = acc.thinkingAccumulators.get(key);
        if (previous === undefined) {
          pushGrouped(acc.thinkingBlocksByMessage, thd.messageId, blockIndex);
        }
        acc.thinkingAccumulators.set(key, (previous ?? '') + thd.delta);
        break;
      }

      case 'tool_start': {
        const ts = event as ToolStartEvent;
        acc.toolStarts.push(ts);
        pushGrouped(acc.toolStartsByMessage, ts.messageId, ts);
        break;
      }

      case 'tool_delta': {
        const tld = event as ToolDeltaEvent;
        const key = `${tld.toolCallId}-input`;
        acc.toolInputAccumulators.set(
          key,
          (acc.toolInputAccumulators.get(key) ?? '') + tld.delta,
        );
        break;
      }

      case 'tool_result': {
        const tr = event as ToolResultEvent;
        acc.toolResults.set(tr.toolCallId, tr);
        break;
      }

      case 'agent_start':
        acc.agentStarts.push(event as AgentStartEvent);
        break;
      default:
        break;
    }
  }

  /** Assemble the root-level ExecutionNode tree from indexed accumulators. */
  private assembleTree(acc: TreeAccumulators): ExecutionNode[] {
    let rootMessageStarts = acc.messageStarts.filter(
      (ms) => !ms.parentToolUseId,
    );

    if (rootMessageStarts.length === 0) {
      rootMessageStarts = acc.messageStarts;
    }

    if (rootMessageStarts.length === 0) {
      return [];
    }

    const rootNodes: ExecutionNode[] = [];

    for (const msgStart of rootMessageStarts) {
      const children = this.buildMessageChildren(
        msgStart.messageId,
        msgStart.timestamp,
        acc,
        0,
      );
      if (children.length === 0) continue;
      rootNodes.push(...children);
    }

    return rootNodes;
  }

  /**
   * Build children for a message: text blocks, thinking blocks, and tool nodes.
   * Sorted by timestamp for correct display order.
   */
  private buildMessageChildren(
    messageId: string,
    messageTimestamp: number,
    acc: TreeAccumulators,
    depth: number,
  ): ExecutionNode[] {
    const children: ExecutionNode[] = [];
    for (const blockIndex of acc.textBlocksByMessage.get(messageId) ?? []) {
      children.push(
        createExecutionNode({
          id: `${messageId}-text-${blockIndex}`,
          type: 'text',
          status: 'complete',
          content:
            acc.textAccumulators.get(`${messageId}-block-${blockIndex}`) ?? '',
          children: [],
          startTime: messageTimestamp + blockIndex, // Order by block index
        }),
      );
    }
    for (const blockIndex of acc.thinkingBlocksByMessage.get(messageId) ??
      []) {
      children.push(
        createExecutionNode({
          id: `${messageId}-thinking-${blockIndex}`,
          type: 'thinking',
          status: 'complete',
          content:
            acc.thinkingAccumulators.get(
              `${messageId}-thinking-${blockIndex}`,
            ) ?? '',
          children: [],
          startTime: messageTimestamp + blockIndex,
        }),
      );
    }
    for (const toolStart of acc.toolStartsByMessage.get(messageId) ?? []) {
      children.push(this.buildToolNode(toolStart, acc, depth));
    }
    return children.sort((a, b) => (a.startTime ?? 0) - (b.startTime ?? 0));
  }

  /**
   * Resolve a tool's input for display. A finished tool's input is final, so
   * its resolution (parsed JSON or the parse-failure fallback) is cached per
   * toolCallId and reused while the raw string is unchanged.
   */
  private resolveToolInput(
    toolStart: ToolStartEvent,
    hasResult: boolean,
    acc: TreeAccumulators,
  ): Record<string, unknown> | undefined {
    const inputString =
      acc.toolInputAccumulators.get(`${toolStart.toolCallId}-input`) ?? '';
    if (inputString && hasResult) {
      const cached = acc.toolInputCache.get(toolStart.toolCallId);
      if (cached && cached.raw === inputString) return cached.value;
      let toolInput: Record<string, unknown> | undefined;
      try {
        const parsed = JSON.parse(inputString);
        if (typeof parsed === 'object' && parsed !== null) {
          toolInput = parsed;
        }
      } catch {
        if (
          toolStart.toolInput &&
          Object.keys(toolStart.toolInput).length > 0
        ) {
          toolInput = toolStart.toolInput;
        } else {
          toolInput = {
            __parseError: true,
            __raw: inputString.substring(0, 100),
          };
        }
      }
      acc.toolInputCache.set(toolStart.toolCallId, {
        raw: inputString,
        value: toolInput,
      });
      return toolInput;
    }
    if (inputString) {
      return {
        __streaming: true,
        __rawSnippet:
          inputString.substring(0, 50) + (inputString.length > 50 ? '...' : ''),
      };
    }
    if (toolStart.toolInput && Object.keys(toolStart.toolInput).length > 0) {
      return toolStart.toolInput;
    }
    return undefined;
  }

  /**
   * Build a tool ExecutionNode with potential nested agent children.
   * For Task tools that spawn agents, the tool node becomes an agent node.
   */
  private buildToolNode(
    toolStart: ToolStartEvent,
    acc: TreeAccumulators,
    depth: number,
  ): ExecutionNode {
    const resultEvent = acc.toolResults.get(toolStart.toolCallId);
    const toolInput = this.resolveToolInput(toolStart, !!resultEvent, acc);
    if (toolStart.isTaskTool || isAgentDispatchTool(toolStart.toolName)) {
      const agentNode = this.buildAgentNodeFromTool(
        toolStart,
        toolInput,
        resultEvent,
        acc,
        depth,
      );
      if (agentNode) return agentNode;
    }
    return createExecutionNode({
      id: toolStart.id,
      type: 'tool',
      status: resultEvent?.isError
        ? 'error'
        : resultEvent
          ? 'complete'
          : 'streaming',
      content: null,
      toolInput,
      toolName: toolStart.toolName,
      toolCallId: toolStart.toolCallId,
      toolOutput: resultEvent?.output,
      isError: resultEvent?.isError,
      isPermissionRequest: resultEvent?.isPermissionRequest,
      children: [],
      startTime: toolStart.timestamp,
    });
  }

  /**
   * Build an agent ExecutionNode from a Task tool start.
   * Finds the matching agent_start event and collects nested message children.
   */
  private buildAgentNodeFromTool(
    toolStart: ToolStartEvent,
    toolInput: Record<string, unknown> | undefined,
    resultEvent: ToolResultEvent | undefined,
    acc: TreeAccumulators,
    depth: number,
  ): ExecutionNode | null {
    if (depth >= MAX_DEPTH) return null;
    const agentStarts = acc.agentStarts;
    let matchedAgent = agentStarts.find(
      (as) => as.parentToolUseId === toolStart.toolCallId,
    );
    if (!matchedAgent) {
      const inputKey = `${toolStart.toolCallId}-input`;
      const inputString = acc.toolInputAccumulators.get(inputKey) ?? '';
      const typeMatch = inputString.match(/"subagent_type"\s*:\s*"([^"]+)"/);

      if (typeMatch) {
        const agentType = typeMatch[1];
        let bestMatch: AgentStartEvent | undefined;
        let bestDiff = Infinity;
        for (const as of agentStarts) {
          if (as.agentType === agentType) {
            const diff = Math.abs(as.timestamp - toolStart.timestamp);
            if (diff < bestDiff) {
              bestDiff = diff;
              bestMatch = as;
            }
          }
        }
        matchedAgent = bestMatch;
      }
    }
    const agentType =
      matchedAgent?.agentType ??
      toolStart.agentType ??
      (toolInput?.['subagent_type'] as string) ??
      'Task';
    const agentDescription =
      matchedAgent?.agentDescription ??
      toolStart.agentDescription ??
      (toolInput?.['description'] as string) ??
      'Agent working...';
    const agentChildren: ExecutionNode[] = [];
    const agentMessages =
      acc.assistantMessagesByTool.get(toolStart.toolCallId) ?? [];
    for (const msgStart of agentMessages) {
      const msgChildren = this.buildMessageChildren(
        msgStart.messageId,
        msgStart.timestamp,
        acc,
        depth + 1,
      );
      agentChildren.push(...msgChildren);
    }

    return createExecutionNode({
      id: matchedAgent?.id ?? `agent-${toolStart.toolCallId}`,
      type: 'agent',
      status: resultEvent ? 'complete' : 'streaming',
      content: agentDescription,
      children: agentChildren,
      startTime: matchedAgent?.timestamp ?? toolStart.timestamp,
      agentType,
      agentDescription,
      agentId: matchedAgent?.agentId,
      toolCallId: toolStart.toolCallId,
    });
  }
}
