import { Injectable, inject } from '@angular/core';
import {
  createExecutionChatMessage,
  type ExecutionChatMessage,
  type ExecutionNode,
  type FlatStreamEventUnion,
  type MessageCompleteEvent,
  type MessageStartEvent,
  type SubagentRecord,
} from '@ptah-extension/shared';
import {
  createEmptyStreamingState,
  type StreamingState,
} from '@ptah-extension/chat-types';
import { AgentMonitorStore } from './agent-monitor.store';
import { BackgroundAgentStore } from './background-agent.store';
import { BatchedUpdateService } from './batched-update.service';
import { EventDeduplicationService } from './event-deduplication.service';
import { ExecutionTreeBuilderService } from './execution-tree-builder.service';
import { capFinalizedTree } from './execution-tree-retention';
import { SessionManager } from './session-manager.service';
import {
  StreamingAccumulatorCore,
  type AccumulatorContext,
} from './accumulator-core.service';

export interface HistoryMessageBuildOptions {
  readonly cacheKey: string;
  /** Whether `build` releases this cache entry in its `finally` block. */
  readonly releaseCacheAfterBuild: boolean;
  readonly sessionId?: string;
  readonly resumableSubagents?: readonly SubagentRecord[];
}

interface MessageBoundaries {
  start?: MessageStartEvent;
  complete?: MessageCompleteEvent;
}

function indexMessageBoundaries(
  events: StreamingState['events'],
): Map<string, MessageBoundaries> {
  const byMessage = new Map<string, MessageBoundaries>();
  for (const event of events.values()) {
    if (
      event.eventType !== 'message_start' &&
      event.eventType !== 'message_complete'
    ) {
      continue;
    }
    let entry = byMessage.get(event.messageId);
    if (!entry) {
      entry = {};
      byMessage.set(event.messageId, entry);
    }
    if (event.eventType === 'message_start') {
      entry.start ??= event;
    } else {
      entry.complete ??= event;
    }
  }
  return byMessage;
}

function indexTreesById(
  trees: readonly ExecutionNode[],
): Map<string, ExecutionNode> {
  const byId = new Map<string, ExecutionNode>();
  for (const tree of trees) {
    if (!byId.has(tree.id)) byId.set(tree.id, tree);
  }
  return byId;
}

export function extractHistoryTextForMessage(
  state: StreamingState,
  messageId: string,
): string {
  const textParts: { blockIndex: number; text: string }[] = [];
  for (const [key, text] of state.textAccumulators.entries()) {
    if (key.startsWith(`${messageId}-block-`)) {
      const blockIndex = parseInt(key.split('-block-')[1], 10) || 0;
      textParts.push({ blockIndex, text });
    }
  }
  textParts.sort((a, b) => a.blockIndex - b.blockIndex);
  return textParts.map((part) => part.text).join('\n');
}

@Injectable({ providedIn: 'root' })
export class HistoryMessageBuilder {
  private readonly accumulator = inject(StreamingAccumulatorCore);
  private readonly sessionManager = inject(SessionManager);
  private readonly deduplication = inject(EventDeduplicationService);
  private readonly batchedUpdate = inject(BatchedUpdateService);
  private readonly backgroundAgentStore = inject(BackgroundAgentStore);
  private readonly agentMonitorStore = inject(AgentMonitorStore);
  private readonly treeBuilder = inject(ExecutionTreeBuilderService);

  createPageState(): StreamingState {
    return createEmptyStreamingState();
  }

  /**
   * Release a scratch cache when accumulation fails before `build` runs.
   * Successful builds use `releaseCacheAfterBuild` for their own `finally`.
   */
  clearCache(cacheKey: string): void {
    this.treeBuilder.clearCache(cacheKey);
  }

  /**
   * Accumulate history into caller-owned scratch state without scheduling a
   * tab update. Stores still receive agent lifecycle events through the real
   * accumulator context, and their reducers make repeated events idempotent.
   */
  accumulate(
    state: StreamingState,
    events: readonly FlatStreamEventUnion[],
    sessionId: string,
  ): StreamingState {
    const context: AccumulatorContext = {
      sessionManager: this.sessionManager,
      deduplication: this.deduplication,
      batchedUpdate: this.batchedUpdate,
      backgroundAgentStore: this.backgroundAgentStore,
      agentMonitorStore: this.agentMonitorStore,
    };

    let accumulated = state;
    for (const event of events) {
      const scopedEvent = event.sessionId
        ? event
        : ({ ...event, sessionId } as FlatStreamEventUnion);
      const result = this.accumulator.process(
        accumulated,
        scopedEvent,
        context,
      );
      if (result.replacementState) accumulated = result.replacementState;
    }
    return accumulated;
  }

  /** Build finalized transcript messages in O(events + root messages). */
  build(
    state: StreamingState,
    options: HistoryMessageBuildOptions,
  ): ExecutionChatMessage[] {
    try {
      let allTrees = this.treeBuilder.buildTree(state, options.cacheKey);
      if (options.resumableSubagents?.length) {
        const resumableToolCallIds = new Set(
          options.resumableSubagents.map((subagent) => subagent.toolCallId),
        );
        allTrees = allTrees.map((tree) =>
          this.markResumableAgentsAsInterrupted(tree, resumableToolCallIds),
        );
      }

      const messages: ExecutionChatMessage[] = [];
      const usedTreeNodeIds = new Set<string>();
      const boundaries = indexMessageBoundaries(state.events);
      const treeById = indexTreesById(allTrees);
      for (const messageId of state.messageEventIds) {
        const messageStartEvent = boundaries.get(messageId)?.start;
        if (!messageStartEvent || messageStartEvent.parentToolUseId) continue;

        const treeNode = treeById.get(messageStartEvent.id);
        const completeEvent = boundaries.get(messageId)?.complete;
        let tokens:
          | { input: number; output: number; cacheHit?: number }
          | undefined;
        let cost: number | null | undefined;
        let duration: number | undefined;

        if (completeEvent?.tokenUsage) {
          tokens = {
            input: completeEvent.tokenUsage.input,
            output: completeEvent.tokenUsage.output,
          };
          cost = completeEvent.cost;
          duration = completeEvent.duration;
        }

        if (messageStartEvent.role === 'user') {
          messages.push(
            createExecutionChatMessage({
              id: messageId,
              role: 'user',
              rawContent: extractHistoryTextForMessage(state, messageId),
              sessionId: options.sessionId,
              timestamp: messageStartEvent.timestamp,
              ...(messageStartEvent.imageCount
                ? { imageCount: messageStartEvent.imageCount }
                : {}),
              ...(messageStartEvent.inboundPeer
                ? { inboundPeer: messageStartEvent.inboundPeer }
                : {}),
            }),
          );
          continue;
        }

        if (!treeNode || usedTreeNodeIds.has(treeNode.id)) continue;
        usedTreeNodeIds.add(treeNode.id);
        messages.push(
          createExecutionChatMessage({
            id: treeNode.id,
            role: 'assistant',
            streamingState: treeNode,
            sessionId: options.sessionId,
            tokens,
            cost,
            duration,
            timestamp: messageStartEvent.timestamp,
          }),
        );
      }

      return messages.map((message) => {
        if (message.role !== 'assistant' || !message.streamingState) {
          return message;
        }
        const cleaned = this.markStreamingAgentsAsInterrupted(
          message.streamingState,
        );
        const capped = capFinalizedTree(cleaned);
        return capped === message.streamingState
          ? message
          : { ...message, streamingState: capped };
      });
    } finally {
      if (options.releaseCacheAfterBuild) {
        this.treeBuilder.clearCache(options.cacheKey);
      }
    }
  }

  private markStreamingAgentsAsInterrupted(node: ExecutionNode): ExecutionNode {
    const updatedChildren = node.children.map((child) =>
      this.markStreamingAgentsAsInterrupted(child),
    );
    if (node.type === 'agent' && node.status === 'streaming') {
      return { ...node, status: 'interrupted', children: updatedChildren };
    }
    return updatedChildren !== node.children
      ? { ...node, children: updatedChildren }
      : node;
  }

  private markResumableAgentsAsInterrupted(
    node: ExecutionNode,
    resumableToolCallIds: ReadonlySet<string>,
  ): ExecutionNode {
    const updatedChildren = node.children.map((child) =>
      this.markResumableAgentsAsInterrupted(child, resumableToolCallIds),
    );
    if (
      node.type === 'agent' &&
      node.toolCallId &&
      resumableToolCallIds.has(node.toolCallId)
    ) {
      return { ...node, status: 'interrupted', children: updatedChildren };
    }
    return updatedChildren !== node.children
      ? { ...node, children: updatedChildren }
      : node;
  }
}
