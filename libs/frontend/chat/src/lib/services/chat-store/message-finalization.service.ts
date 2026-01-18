/**
 * MessageFinalizationService - Finalize streaming messages to chat messages
 *
 * Extracted from StreamingHandlerService to handle:
 * - Finalizing current streaming message
 * - Finalizing session history (all messages)
 * - Building ExecutionNode trees from StreamingState
 * - Extracting text content for messages
 *
 * Part of StreamingHandlerService refactoring for better maintainability.
 */

import { Injectable, inject } from '@angular/core';
import {
  ExecutionNode,
  createExecutionChatMessage,
  MessageCompleteEvent,
  MessageStartEvent,
  ExecutionChatMessage,
} from '@ptah-extension/shared';
import { TabManagerService } from '../tab-manager.service';
import { SessionManager } from '../session-manager.service';
import { ExecutionTreeBuilderService } from '../execution-tree-builder.service';
import { BatchedUpdateService } from './batched-update.service';
import type { StreamingState } from '../chat.types';

@Injectable({ providedIn: 'root' })
export class MessageFinalizationService {
  private readonly tabManager = inject(TabManagerService);
  private readonly sessionManager = inject(SessionManager);
  private readonly treeBuilder = inject(ExecutionTreeBuilderService);
  private readonly batchedUpdate = inject(BatchedUpdateService);

  /**
   * Finalize the current streaming message
   *
   * Builds final ExecutionNode tree from StreamingState using ExecutionTreeBuilderService.
   * Extracts metadata from message_complete event.
   * Uses per-tab currentMessageId for proper multi-tab streaming support.
   *
   * @param tabId - Optional tab ID to finalize. Falls back to active tab if not provided.
   * @param isAborted - If true, marks nodes as 'interrupted' instead of 'complete' (TASK_2025_098)
   */
  finalizeCurrentMessage(tabId?: string, isAborted = false): void {
    // PERFORMANCE: Flush any pending batched updates before finalization
    // This ensures we have the complete streaming state before building final tree
    this.batchedUpdate.flushSync();

    // Use provided tabId or fall back to active tab
    const targetTabId = tabId ?? this.tabManager.activeTabId();
    if (!targetTabId) return;

    // Get the target tab (by ID if provided, otherwise active)
    const targetTab = tabId
      ? this.tabManager.tabs().find((t) => t.id === tabId)
      : this.tabManager.activeTab();

    const streamingState = targetTab?.streamingState;
    // TASK_2025_087 FIX: Read currentMessageId from streamingState, not targetTab
    const messageId = streamingState?.currentMessageId;

    if (!streamingState || !messageId) return;

    // Deep-copy state to prevent race condition (TASK_2025_084 Batch 1 Task 1.3)
    const stateCopy = this.deepCopyStreamingState(streamingState);

    // Build final tree using ExecutionTreeBuilderService (TASK_2025_082 Batch 6)
    // PERFORMANCE: Use unique cache key for finalization to avoid stale cache
    const cacheKey = `finalize-${targetTabId}-${Date.now()}`;
    let finalTree = this.treeBuilder.buildTree(stateCopy, cacheKey);

    // TASK_2025_098 FIX: Mark all 'streaming' nodes as 'interrupted' when aborted
    if (isAborted) {
      finalTree = finalTree.map((tree) =>
        this.markStreamingNodesAsInterrupted(tree)
      );
    }

    // Find message_complete event for metadata
    const completeEvent = [...streamingState.events.values()].find(
      (e) => e.eventType === 'message_complete' && e.messageId === messageId
    ) as MessageCompleteEvent | undefined;

    // Extract metadata from message_complete event
    let tokens:
      | { input: number; output: number; cacheHit?: number }
      | undefined;
    let cost: number | undefined;
    let duration: number | undefined;

    if (completeEvent?.tokenUsage) {
      tokens = {
        input: completeEvent.tokenUsage.input,
        output: completeEvent.tokenUsage.output,
      };
      cost = completeEvent.cost;
      duration = completeEvent.duration;
    }

    // Apply pendingStats if message_complete event wasn't found but we have stored stats
    const pendingStats = stateCopy.pendingStats;
    const finalTokens =
      tokens ?? (pendingStats ? pendingStats.tokens : undefined);
    const finalCost = cost ?? (pendingStats ? pendingStats.cost : undefined);
    const finalDuration =
      duration ?? (pendingStats ? pendingStats.duration : undefined);

    const assistantMessage = createExecutionChatMessage({
      id: messageId,
      role: 'assistant',
      streamingState: finalTree[0] || null, // Single root message
      sessionId: targetTab?.claudeSessionId ?? undefined,
      tokens: finalTokens,
      cost: finalCost,
      duration: finalDuration,
    });

    // Add to target tab's messages and clear streaming state
    this.tabManager.updateTab(targetTabId, {
      messages: [...(targetTab?.messages ?? []), assistantMessage],
      streamingState: null,
      status: 'loaded',
      currentMessageId: null,
    });

    // Update SessionManager status
    this.sessionManager.setStatus('loaded');
  }

  /**
   * Finalize session history - builds messages for ALL messages in streaming state
   *
   * TASK_2025_092 FIX: Unlike finalizeCurrentMessage which only handles the
   * current streaming message, this method processes ALL messages from session
   * history replay.
   *
   * @param tabId - Tab ID to finalize
   * @returns Array of ExecutionChatMessage for all messages in history
   */
  finalizeSessionHistory(tabId: string): ExecutionChatMessage[] {
    // PERFORMANCE: Flush any pending batched updates before finalization
    this.batchedUpdate.flushSync();

    const targetTab = this.tabManager.tabs().find((t) => t.id === tabId);
    const streamingState = targetTab?.streamingState;

    if (!streamingState || streamingState.messageEventIds.length === 0) {
      return [];
    }

    // Deep-copy state to prevent race conditions
    const stateCopy = this.deepCopyStreamingState(streamingState);

    // Build full tree for all messages
    const cacheKey = `history-${tabId}-${Date.now()}`;
    const allTrees = this.treeBuilder.buildTree(stateCopy, cacheKey);

    const messages: ExecutionChatMessage[] = [];

    // Process each messageId to create appropriate message type
    for (const messageId of stateCopy.messageEventIds) {
      // Find message_start event to determine role
      const messageStartEvent = [...stateCopy.events.values()].find(
        (e) => e.eventType === 'message_start' && e.messageId === messageId
      ) as MessageStartEvent | undefined;

      if (!messageStartEvent) {
        continue;
      }

      // TASK_2025_093 FIX: Skip nested agent messages
      if (messageStartEvent.parentToolUseId) {
        continue;
      }

      const role = messageStartEvent.role;

      // Find corresponding tree node for this message
      const treeNode = allTrees.find(
        (node) => node.id === messageStartEvent.id
      );

      // Find message_complete event for metadata
      const completeEvent = [...stateCopy.events.values()].find(
        (e) => e.eventType === 'message_complete' && e.messageId === messageId
      ) as MessageCompleteEvent | undefined;

      // Extract tokens/cost/duration from complete event
      let tokens:
        | { input: number; output: number; cacheHit?: number }
        | undefined;
      let cost: number | undefined;
      let duration: number | undefined;

      if (completeEvent?.tokenUsage) {
        tokens = {
          input: completeEvent.tokenUsage.input,
          output: completeEvent.tokenUsage.output,
        };
        cost = completeEvent.cost;
        duration = completeEvent.duration;
      }

      if (role === 'user') {
        // User message: extract accumulated text content
        const textContent = this.extractTextForMessage(stateCopy, messageId);

        messages.push(
          createExecutionChatMessage({
            id: messageId,
            role: 'user',
            rawContent: textContent,
            sessionId: targetTab?.claudeSessionId ?? undefined,
            timestamp: messageStartEvent.timestamp,
          })
        );
      } else {
        // Assistant message: use execution tree
        messages.push(
          createExecutionChatMessage({
            id: messageId,
            role: 'assistant',
            streamingState: treeNode || null,
            sessionId: targetTab?.claudeSessionId ?? undefined,
            tokens,
            cost,
            duration,
            timestamp: messageStartEvent.timestamp,
          })
        );
      }
    }

    // Update tab with finalized messages and clear streaming state
    this.tabManager.updateTab(tabId, {
      messages,
      streamingState: null,
      status: 'loaded',
    });

    return messages;
  }

  /**
   * Deep-copy StreamingState to prevent race condition between finalize and stream.
   * Creates new Map instances to ensure isolation.
   */
  deepCopyStreamingState(state: StreamingState): StreamingState {
    return {
      events: new Map(state.events),
      messageEventIds: [...state.messageEventIds],
      toolCallMap: new Map(
        [...state.toolCallMap.entries()].map(([k, v]) => [k, [...v]])
      ),
      textAccumulators: new Map(state.textAccumulators),
      toolInputAccumulators: new Map(state.toolInputAccumulators),
      agentSummaryAccumulators: new Map(state.agentSummaryAccumulators),
      agentContentBlocksMap: new Map(
        [...state.agentContentBlocksMap.entries()].map(([k, v]) => [k, [...v]])
      ),
      currentMessageId: state.currentMessageId,
      currentTokenUsage: state.currentTokenUsage
        ? { ...state.currentTokenUsage }
        : null,
      eventsByMessage: new Map(
        [...state.eventsByMessage.entries()].map(([k, v]) => [k, [...v]])
      ),
      pendingStats: state.pendingStats ? { ...state.pendingStats } : null,
    };
  }

  /**
   * TASK_2025_098 FIX: Recursively mark all 'streaming' nodes as 'interrupted'
   * Used when user aborts/interrupts a streaming message.
   */
  private markStreamingNodesAsInterrupted(node: ExecutionNode): ExecutionNode {
    // Recursively process children first
    const updatedChildren = node.children.map((child) =>
      this.markStreamingNodesAsInterrupted(child)
    );

    // If this node is streaming, mark it as interrupted
    if (node.status === 'streaming') {
      return {
        ...node,
        status: 'interrupted',
        children: updatedChildren,
      };
    }

    // If children changed, return new node with updated children
    if (updatedChildren !== node.children) {
      return {
        ...node,
        children: updatedChildren,
      };
    }

    // No changes needed
    return node;
  }

  /**
   * Extract accumulated text content for a specific message
   */
  extractTextForMessage(state: StreamingState, messageId: string): string {
    const textParts: { blockIndex: number; text: string }[] = [];

    // Find all text accumulator entries for this message
    for (const [key, text] of state.textAccumulators.entries()) {
      if (key.startsWith(`${messageId}-block-`)) {
        const blockIndex = parseInt(key.split('-block-')[1], 10) || 0;
        textParts.push({ blockIndex, text });
      }
    }

    // Sort by block index and join
    textParts.sort((a, b) => a.blockIndex - b.blockIndex);
    return textParts.map((p) => p.text).join('\n');
  }
}
