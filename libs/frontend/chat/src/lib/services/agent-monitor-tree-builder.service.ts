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
 *
 * @see ExecutionTreeBuilderService for the full chat-context version
 */

import { Injectable } from '@angular/core';
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
import { createExecutionNode } from '@ptah-extension/shared';

/** Maximum recursion depth for nested agent tree building */
const MAX_DEPTH = 10;

/**
 * Memoization cache entry for the tree builder.
 * Keyed by event/segment count -- invalidates when new events arrive.
 */
interface TreeCache {
  count: number;
  tree: ExecutionNode[];
}

@Injectable({ providedIn: 'root' })
export class AgentMonitorTreeBuilderService {
  /**
   * Per-agent cache maps. Keyed by a caller-provided agent ID to avoid
   * cache collision when multiple agents share this singleton service.
   */
  private readonly eventCacheMap = new Map<string, TreeCache>();
  private readonly segmentCacheMap = new Map<string, TreeCache>();

  /**
   * Build ExecutionNode tree from flat streaming events.
   *
   * @param agentId - Unique agent identifier for per-agent cache isolation
   * @param events - Flat array of streaming events from MonitoredAgent.streamEvents
   * @returns Array of root-level ExecutionNode objects
   */
  buildTree(
    agentId: string,
    events: readonly FlatStreamEventUnion[]
  ): ExecutionNode[] {
    const cached = this.eventCacheMap.get(agentId);
    if (cached && cached.count === events.length) {
      return cached.tree;
    }

    const tree = this.buildTreeInternal(events);
    this.eventCacheMap.set(agentId, { count: events.length, tree });
    return tree;
  }

  /**
   * Build ExecutionNode tree from flat CliOutputSegment[].
   *
   * Converts structured CLI output segments (from Copilot/Gemini SDK adapters)
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
    segments: readonly CliOutputSegment[]
  ): ExecutionNode[] {
    const cached = this.segmentCacheMap.get(agentId);
    if (cached && cached.count === segments.length) {
      return cached.tree;
    }

    const tree = this.buildTreeFromSegmentsInternal(segments);
    this.segmentCacheMap.set(agentId, { count: segments.length, tree });
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
    nodes: readonly ExecutionNode[]
  ): readonly ExecutionNode[] {
    let changed = false;
    const finalized = nodes.map((node) => {
      let updated = node;

      // Finalize orphaned tool nodes
      if (node.type === 'tool' && node.status === 'streaming') {
        updated = createExecutionNode({
          ...node,
          status: 'error',
          error: 'Tool execution interrupted — session ended before completion',
        });
        changed = true;
      }

      // Recurse into children
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
    this.eventCacheMap.delete(agentId);
    this.segmentCacheMap.delete(agentId);
  }

  /** Clear all caches */
  clearCache(): void {
    this.eventCacheMap.clear();
    this.segmentCacheMap.clear();
  }

  // ─────────────────────────────────────────────────────────
  // Segment-based tree building (Copilot / Gemini)
  // ─────────────────────────────────────────────────────────

  private buildTreeFromSegmentsInternal(
    segments: readonly CliOutputSegment[]
  ): ExecutionNode[] {
    if (segments.length === 0) return [];

    const nodes: ExecutionNode[] = [];

    // Two-pass approach: first pass collects tool-call/result pairings,
    // second pass builds the final immutable nodes.
    // We use a mutable intermediate map for tool nodes that need result pairing.

    // Index: toolCallId → index into nodes array (for replacement on result)
    const toolCallIdToIndex = new Map<string, number>();
    // FIFO queue of tool-node indices without toolCallId (fallback matching)
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
          })
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
          })
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

          // Prefer raw toolInput (structured object) over summary string.
          // Normalize field names so existing type guards work across CLIs
          // (e.g. Copilot uses 'path' while Claude SDK uses 'file_path').
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

          // Find matching tool node by toolCallId or FIFO fallback
          let matchedIndex = -1;
          if (segment.toolCallId) {
            matchedIndex = toolCallIdToIndex.get(segment.toolCallId) ?? -1;
          }
          if (matchedIndex === -1 && unresolvedToolIndices.length > 0) {
            // FIFO: walk forward to find first unresolved tool node
            for (let j = 0; j < unresolvedToolIndices.length; j++) {
              if (nodes[unresolvedToolIndices[j]].status === 'streaming') {
                matchedIndex = unresolvedToolIndices[j];
                break;
              }
            }
          }

          if (matchedIndex >= 0) {
            const original = nodes[matchedIndex];
            // Create a new node with result data (immutable replacement)
            nodes[matchedIndex] = createExecutionNode({
              ...original,
              status:
                segment.type === 'tool-result-error' ? 'error' : 'complete',
              toolOutput: segment.content,
              toolName: original.toolName || segment.toolName,
            });
          } else {
            // Orphan result — render as standalone text
            nodes.push(
              createExecutionNode({
                id: `seg-orphan-${i}`,
                type: 'text',
                status: 'complete',
                content: segment.content,
              })
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
              content: segment.content,
              error: segment.content,
            })
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
              content: segment.content,
            })
          );
          break;
        }

        default:
          break;
      }
    }

    // Flush remaining buffers
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
    input: Record<string, unknown>
  ): Record<string, unknown> {
    const normalized = { ...input };
    const name = toolName.toLowerCase();

    // Normalize 'path' → 'file_path' for read/write/edit tools
    if (
      'path' in normalized &&
      !('file_path' in normalized) &&
      /read|write|edit|replace|create_file|patch_file/.test(name)
    ) {
      normalized['file_path'] = normalized['path'];
    }

    return normalized;
  }

  // ─────────────────────────────────────────────────────────
  // Internal tree building (FlatStreamEventUnion-based)
  // ─────────────────────────────────────────────────────────

  private buildTreeInternal(
    events: readonly FlatStreamEventUnion[]
  ): ExecutionNode[] {
    if (events.length === 0) return [];

    // Step 1: Build accumulators from delta events
    const textAccumulators = new Map<string, string>();
    const thinkingAccumulators = new Map<string, string>();
    const toolInputAccumulators = new Map<string, string>();

    // Step 2: Index landmark events for lookup
    const messageStarts: MessageStartEvent[] = [];
    const toolStarts: ToolStartEvent[] = [];
    const toolResults = new Map<string, ToolResultEvent>();
    const agentStarts: AgentStartEvent[] = [];

    for (const event of events) {
      switch (event.eventType) {
        case 'message_start':
          messageStarts.push(event as MessageStartEvent);
          break;

        case 'text_delta': {
          const td = event as TextDeltaEvent;
          const key = `${td.messageId}-block-${td.blockIndex ?? 0}`;
          const existing = textAccumulators.get(key) ?? '';
          textAccumulators.set(key, existing + td.delta);
          break;
        }

        case 'thinking_delta': {
          const thd = event as ThinkingDeltaEvent;
          const key = `${thd.messageId}-thinking-${thd.blockIndex ?? 0}`;
          const existing = thinkingAccumulators.get(key) ?? '';
          thinkingAccumulators.set(key, existing + thd.delta);
          break;
        }

        case 'tool_start':
          toolStarts.push(event as ToolStartEvent);
          break;

        case 'tool_delta': {
          const tld = event as ToolDeltaEvent;
          const key = `${tld.toolCallId}-input`;
          const existing = toolInputAccumulators.get(key) ?? '';
          toolInputAccumulators.set(key, existing + tld.delta);
          break;
        }

        case 'tool_result': {
          const tr = event as ToolResultEvent;
          toolResults.set(tr.toolCallId, tr);
          break;
        }

        case 'agent_start':
          agentStarts.push(event as AgentStartEvent);
          break;

        // Skip non-structural events: message_delta, signature_delta,
        // compaction_start/complete, background_agent_* events
        // They don't contribute to the ExecutionNode tree structure
        default:
          break;
      }
    }

    // Step 3: Build tree from root messages
    // Root messages have no parentToolUseId.
    // For sub-agent cards (e.g., Explore/Task spawned by ptah-cli), ALL messages
    // have parentToolUseId set because they're nested under the parent's tool call.
    // In that case, treat all messages as roots since the card IS the sub-agent context.
    let rootMessageStarts = messageStarts.filter((ms) => !ms.parentToolUseId);

    if (rootMessageStarts.length === 0) {
      // Fallback: use all messages as roots (sub-agent card context)
      rootMessageStarts = messageStarts;
    }

    if (rootMessageStarts.length === 0) {
      // No messages at all — return empty tree
      // This can happen early in streaming before message_start arrives
      return [];
    }

    const rootNodes: ExecutionNode[] = [];

    for (const msgStart of rootMessageStarts) {
      const children = this.buildMessageChildren(
        msgStart.messageId,
        msgStart.timestamp,
        textAccumulators,
        thinkingAccumulators,
        toolStarts,
        toolInputAccumulators,
        toolResults,
        agentStarts,
        messageStarts,
        0
      );

      // Skip empty messages
      if (children.length === 0) continue;

      // Return root children directly (unwrap the message container).
      // The agent card already provides its own header/chrome, so we don't
      // need a 'message' wrapper node.
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
    textAccumulators: Map<string, string>,
    thinkingAccumulators: Map<string, string>,
    toolStarts: ToolStartEvent[],
    toolInputAccumulators: Map<string, string>,
    toolResults: Map<string, ToolResultEvent>,
    agentStarts: AgentStartEvent[],
    messageStarts: MessageStartEvent[],
    depth: number
  ): ExecutionNode[] {
    const children: ExecutionNode[] = [];

    // Collect text blocks
    for (const [key, text] of textAccumulators) {
      if (key.startsWith(`${messageId}-block-`)) {
        const blockIndex = parseInt(key.split('-block-')[1], 10);
        children.push(
          createExecutionNode({
            id: `${messageId}-text-${blockIndex}`,
            type: 'text',
            status: 'complete',
            content: text,
            children: [],
            startTime: messageTimestamp + blockIndex, // Order by block index
          })
        );
      }
    }

    // Collect thinking blocks
    for (const [key, text] of thinkingAccumulators) {
      if (key.startsWith(`${messageId}-thinking-`)) {
        const blockIndex = parseInt(key.split('-thinking-')[1], 10);
        children.push(
          createExecutionNode({
            id: `${messageId}-thinking-${blockIndex}`,
            type: 'thinking',
            status: 'complete',
            content: text,
            children: [],
            startTime: messageTimestamp + blockIndex,
          })
        );
      }
    }

    // Collect tools belonging to this message.
    // Each message has a unique ID, so messageId alone is sufficient.
    // Do NOT also filter by !parentToolUseId — subagent messages have
    // parentToolUseId set (pointing to the Task tool that spawned them),
    // and excluding those would leave subagent tool nodes empty.
    const messageTools = toolStarts.filter((ts) => ts.messageId === messageId);

    for (const toolStart of messageTools) {
      const toolNode = this.buildToolNode(
        toolStart,
        toolInputAccumulators,
        toolResults,
        agentStarts,
        messageStarts,
        textAccumulators,
        thinkingAccumulators,
        toolStarts,
        depth
      );
      children.push(toolNode);
    }

    // Sort by startTime for correct ordering
    return children.sort((a, b) => (a.startTime ?? 0) - (b.startTime ?? 0));
  }

  /**
   * Build a tool ExecutionNode with potential nested agent children.
   * For Task tools that spawn agents, the tool node becomes an agent node.
   */
  private buildToolNode(
    toolStart: ToolStartEvent,
    toolInputAccumulators: Map<string, string>,
    toolResults: Map<string, ToolResultEvent>,
    agentStarts: AgentStartEvent[],
    messageStarts: MessageStartEvent[],
    textAccumulators: Map<string, string>,
    thinkingAccumulators: Map<string, string>,
    allToolStarts: ToolStartEvent[],
    depth: number
  ): ExecutionNode {
    const resultEvent = toolResults.get(toolStart.toolCallId);

    // Get accumulated tool input
    const inputKey = `${toolStart.toolCallId}-input`;
    const inputString = toolInputAccumulators.get(inputKey) ?? '';

    // Parse tool input JSON (only when tool is complete to avoid parse errors on partial JSON)
    let toolInput: Record<string, unknown> | undefined;
    if (inputString && resultEvent) {
      try {
        const parsed = JSON.parse(inputString);
        if (typeof parsed === 'object' && parsed !== null) {
          toolInput = parsed;
        }
      } catch {
        // Parse failure -- show raw snippet
        toolInput = {
          __parseError: true,
          __raw: inputString.substring(0, 100),
        };
      }
    } else if (inputString) {
      // Still streaming -- show raw snippet
      toolInput = {
        __streaming: true,
        __rawSnippet:
          inputString.substring(0, 50) + (inputString.length > 50 ? '...' : ''),
      };
    } else if (
      toolStart.toolInput &&
      Object.keys(toolStart.toolInput).length > 0
    ) {
      toolInput = toolStart.toolInput;
    }

    // Check if this is a Task tool (agent spawn)
    if (toolStart.isTaskTool || toolStart.toolName === 'Task') {
      const agentNode = this.buildAgentNodeFromTool(
        toolStart,
        toolInput,
        resultEvent,
        agentStarts,
        messageStarts,
        textAccumulators,
        thinkingAccumulators,
        allToolStarts,
        toolInputAccumulators,
        toolResults,
        depth
      );
      if (agentNode) return agentNode;
      // Fall through to normal tool if no agent found
    }

    // Normal tool node
    return createExecutionNode({
      id: toolStart.id,
      type: 'tool',
      status: resultEvent ? 'complete' : 'streaming',
      content: null,
      toolInput,
      toolName: toolStart.toolName,
      toolCallId: toolStart.toolCallId,
      toolOutput: resultEvent?.output,
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
    agentStarts: AgentStartEvent[],
    messageStarts: MessageStartEvent[],
    textAccumulators: Map<string, string>,
    thinkingAccumulators: Map<string, string>,
    allToolStarts: ToolStartEvent[],
    toolInputAccumulators: Map<string, string>,
    toolResults: Map<string, ToolResultEvent>,
    depth: number
  ): ExecutionNode | null {
    if (depth >= MAX_DEPTH) return null;

    // Find matching agent_start event
    let matchedAgent = agentStarts.find(
      (as) => as.parentToolUseId === toolStart.toolCallId
    );

    // Fallback: match by agentType from tool input
    if (!matchedAgent) {
      const inputKey = `${toolStart.toolCallId}-input`;
      const inputString = toolInputAccumulators.get(inputKey) ?? '';
      const typeMatch = inputString.match(/"subagent_type"\s*:\s*"([^"]+)"/);

      if (typeMatch) {
        const agentType = typeMatch[1];
        // Find closest agent_start by timestamp
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

    // Extract agent info from tool input or toolStart
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

    // Find nested assistant messages (children of this agent)
    const agentMessageStarts = messageStarts.filter(
      (ms) =>
        ms.parentToolUseId === toolStart.toolCallId && ms.role === 'assistant'
    );

    // Build children for the agent (from nested messages)
    const agentChildren: ExecutionNode[] = [];
    for (const msgStart of agentMessageStarts) {
      const msgChildren = this.buildMessageChildren(
        msgStart.messageId,
        msgStart.timestamp,
        textAccumulators,
        thinkingAccumulators,
        allToolStarts,
        toolInputAccumulators,
        toolResults,
        agentStarts,
        messageStarts,
        depth + 1
      );
      // Unwrap message node -- agent shows content directly
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
