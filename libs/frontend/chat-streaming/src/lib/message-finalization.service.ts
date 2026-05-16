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
  SubagentRecord,
} from '@ptah-extension/shared';
import { TabManagerService } from '@ptah-extension/chat-state';
import { SessionManager } from './session-manager.service';
import { ExecutionTreeBuilderService } from './execution-tree-builder.service';
import { BatchedUpdateService } from './batched-update.service';
import type { StreamingState } from '@ptah-extension/chat-types';

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
   * @param isAborted - If true, marks nodes as 'interrupted' instead of 'complete'
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
    // Read currentMessageId from streamingState, not targetTab
    const messageId = streamingState?.currentMessageId;

    if (!streamingState || !messageId) return;

    // Deep-copy state to prevent race condition
    const stateCopy = this.deepCopyStreamingState(streamingState);

    // Build final tree using ExecutionTreeBuilderService.
    // Reuse the streaming cache key (`tab-${tabId}`) so the fingerprint check
    // inside buildTree returns the memoized streaming tree when the underlying
    // state hasn't changed since the last streaming build. The previous
    // `finalize-${tabId}-${Date.now()}` salt forced a full rebuild on every
    // finalize, producing fresh node references for an identical structure
    // and triggering OnPush re-render cascades plus a perceptible "flicker"
    // between streaming and finalized.
    const cacheKey = `tab-${targetTabId}`;
    let finalTree = this.treeBuilder.buildTree(stateCopy, cacheKey);

    // Mark all 'streaming' nodes as 'interrupted' when aborted
    if (isAborted) {
      finalTree = finalTree.map((tree) =>
        this.markStreamingNodesAsInterrupted(tree),
      );
    }

    // Find message_complete event for metadata
    const completeEvent = [...streamingState.events.values()].find(
      (e) => e.eventType === 'message_complete' && e.messageId === messageId,
    ) as MessageCompleteEvent | undefined;

    // pendingStats comes from the SDK result message (session-end stats).
    // It contains authoritative session totals (including cache tokens) and is
    // ALWAYS more accurate than per-message message_complete tokenUsage, which
    // only reports non-cached tokens for a single API call.
    const pendingStats = stateCopy.pendingStats;

    // Extract metadata: pendingStats takes priority over message_complete
    let tokens:
      | { input: number; output: number; cacheHit?: number }
      | undefined;
    let cost: number | undefined;
    let duration: number | undefined;

    if (pendingStats) {
      tokens = pendingStats.tokens;
      cost = pendingStats.cost;
      duration = pendingStats.duration;
    } else if (completeEvent?.tokenUsage) {
      tokens = {
        input: completeEvent.tokenUsage.input,
        output: completeEvent.tokenUsage.output,
      };
      cost = completeEvent.cost;
      duration = completeEvent.duration;
    }

    const finalTokens = tokens;
    const finalCost = cost;
    const finalDuration = duration;

    // ID STABILITY FIX:
    // For each tree in finalTree, emit ONE finalized assistant message keyed
    // by `tree.id` (the `message_start` event id). The streaming side renders
    // each tree as a bubble keyed by the same `tree.id`, so when finalize
    // arrives the unified `@for` loop in chat-view reuses the existing
    // <ptah-message-bubble> instance for every tree (no remount, no FLIP).
    //
    // Cases handled:
    //  - 0 trees (e.g. abort with content collapsed, or finalize before any
    //    message_start arrived): we still emit ONE message keyed by
    //    `messageId` so abort metadata (tokens/cost/duration) isn't lost.
    //    There are no streaming bubbles in this case, so id collision with
    //    a streaming tree.id is impossible.
    //  - 1 tree (the common case): emit one message keyed by `tree.id`,
    //    matching the streaming bubble's id exactly.
    //  - N trees (multi-tree turn — e.g. assistant text → tools →
    //    assistant text again): emit N messages, each keyed by the
    //    corresponding `tree.id`. The streaming dedup set in `streamingMessages()`
    //    contains every finalized id, so every streaming tree is reliably
    //    excluded after finalize. Stats are attached only to the LAST tree
    //    (session-end totals belong to the final assistant turn).
    const existingMessages = targetTab?.messages ?? [];
    const existingIds = new Set(existingMessages.map((m) => m.id));

    const newMessages: ExecutionChatMessage[] = [];

    if (finalTree.length === 0) {
      // No trees built (abort/content-collapsed). Skip if a message with
      // this messageId already exists; otherwise emit a stats-only message.
      if (existingIds.has(messageId)) {
        this.tabManager.clearStreamingForLoaded(targetTabId);
        return;
      }
      newMessages.push(
        createExecutionChatMessage({
          id: messageId,
          role: 'assistant',
          streamingState: null,
          sessionId: targetTab?.claudeSessionId ?? undefined,
          tokens: finalTokens,
          cost: finalCost,
          duration: finalDuration,
        }),
      );
    } else {
      // One message per tree, keyed by tree.id for stable identity across
      // the streaming → finalized handoff. Stats land on the final tree.
      const lastIdx = finalTree.length - 1;
      for (let i = 0; i < finalTree.length; i++) {
        const tree = finalTree[i];
        if (existingIds.has(tree.id)) {
          // Already finalized (re-entrant finalize) — skip this tree.
          continue;
        }
        const isLast = i === lastIdx;
        newMessages.push(
          createExecutionChatMessage({
            id: tree.id,
            role: 'assistant',
            streamingState: tree,
            sessionId: targetTab?.claudeSessionId ?? undefined,
            ...(isLast
              ? {
                  tokens: finalTokens,
                  cost: finalCost,
                  duration: finalDuration,
                }
              : {}),
          }),
        );
      }
    }

    if (newMessages.length === 0) {
      // Every tree was already finalized — just clear streaming state.
      this.tabManager.clearStreamingForLoaded(targetTabId);
      return;
    }

    // Add to target tab's messages and clear streaming state
    this.tabManager.applyFinalizedTurn(targetTabId, [
      ...existingMessages,
      ...newMessages,
    ]);

    // Update SessionManager status
    this.sessionManager.setStatus('loaded');
  }

  /**
   * Finalize session history - builds messages for ALL messages in streaming state.
   *
   * Unlike finalizeCurrentMessage which only handles the current streaming
   * message, this method processes ALL messages from session history replay.
   *
   * Accepts optional resumableSubagents array to mark agent nodes as
   * 'interrupted' so the Resume button appears on loaded history.
   *
   * @param tabId - Tab ID to finalize
   * @param resumableSubagents - Optional array of resumable subagent records from backend
   * @returns Array of ExecutionChatMessage for all messages in history
   */
  finalizeSessionHistory(
    tabId: string,
    resumableSubagents?: SubagentRecord[],
  ): ExecutionChatMessage[] {
    // PERFORMANCE: Flush any pending batched updates before finalization
    this.batchedUpdate.flushSync();

    const targetTab = this.tabManager.tabs().find((t) => t.id === tabId);
    const streamingState = targetTab?.streamingState;

    if (!streamingState || streamingState.messageEventIds.length === 0) {
      return [];
    }

    // Deep-copy state to prevent race conditions
    const stateCopy = this.deepCopyStreamingState(streamingState);

    // Build full tree for all messages.
    // Reuse the streaming cache key so an identical state fingerprint hits
    // the memoized tree (no Date.now() salt).
    const cacheKey = `tab-${tabId}`;
    let allTrees = this.treeBuilder.buildTree(stateCopy, cacheKey);

    // Mark resumable agent nodes as 'interrupted'
    // so the Resume button appears when loading session from history
    if (resumableSubagents && resumableSubagents.length > 0) {
      const resumableToolCallIds = new Set(
        resumableSubagents.map((s) => s.toolCallId),
      );
      allTrees = allTrees.map((tree) =>
        this.markResumableAgentsAsInterrupted(tree, resumableToolCallIds),
      );
    }

    const messages: ExecutionChatMessage[] = [];

    // DEDUPLICATION FIX: Track which tree nodes have been used.
    // The tree builder MERGES consecutive assistant messages into ONE tree node.
    // Without this tracking, we'd create multiple messages pointing to the same tree,
    // or orphan messages with null streamingState when their tree was merged.
    const usedTreeNodeIds = new Set<string>();

    // Process each messageId to create appropriate message type
    for (const messageId of stateCopy.messageEventIds) {
      // Find message_start event to determine role
      const messageStartEvent = [...stateCopy.events.values()].find(
        (e) => e.eventType === 'message_start' && e.messageId === messageId,
      ) as MessageStartEvent | undefined;

      if (!messageStartEvent) {
        continue;
      }

      // Skip nested agent messages
      if (messageStartEvent.parentToolUseId) {
        continue;
      }

      const role = messageStartEvent.role;

      // Find corresponding tree node for this message
      const treeNode = allTrees.find(
        (node) => node.id === messageStartEvent.id,
      );

      // Find message_complete event for metadata
      const completeEvent = [...stateCopy.events.values()].find(
        (e) => e.eventType === 'message_complete' && e.messageId === messageId,
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
            ...(messageStartEvent.imageCount
              ? { imageCount: messageStartEvent.imageCount }
              : {}),
          }),
        );
      } else {
        // Assistant message: use execution tree
        // DEDUPLICATION FIX: Skip if this message's tree was already used
        // (happens when tree builder merges consecutive assistant messages)
        if (!treeNode) {
          // No tree node - this message was merged into another.
          // Skip to avoid creating an empty/duplicate message.
          continue;
        }

        if (usedTreeNodeIds.has(treeNode.id)) {
          // This tree was already used for another message. Skip.
          continue;
        }

        usedTreeNodeIds.add(treeNode.id);

        // Use tree node ID (event id) to match streamingMessages deduplication
        messages.push(
          createExecutionChatMessage({
            id: treeNode.id,
            role: 'assistant',
            streamingState: treeNode,
            sessionId: targetTab?.claudeSessionId ?? undefined,
            tokens,
            cost,
            duration,
            timestamp: messageStartEvent.timestamp,
          }),
        );
      }
    }

    // Safety net: Historical sessions can never have actively streaming agents.
    // Mark any remaining agent nodes with status 'streaming' as 'interrupted'.
    // This catches cases where correlation or tree building left stale streaming states.
    const finalMessages = messages.map((msg) => {
      if (msg.role === 'assistant' && msg.streamingState) {
        const cleaned = this.markStreamingAgentsAsInterrupted(
          msg.streamingState,
        );
        if (cleaned !== msg.streamingState) {
          return { ...msg, streamingState: cleaned };
        }
      }
      return msg;
    });

    // Update tab with finalized messages and clear streaming state
    this.tabManager.applyFinalizedHistory(tabId, finalMessages);

    return finalMessages;
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
        [...state.toolCallMap.entries()].map(([k, v]) => [k, [...v]]),
      ),
      textAccumulators: new Map(state.textAccumulators),
      toolInputAccumulators: new Map(state.toolInputAccumulators),
      agentSummaryAccumulators: new Map(state.agentSummaryAccumulators),
      agentContentBlocksMap: new Map(
        [...state.agentContentBlocksMap.entries()].map(([k, v]) => [k, [...v]]),
      ),
      currentMessageId: state.currentMessageId,
      currentTokenUsage: state.currentTokenUsage
        ? { ...state.currentTokenUsage }
        : null,
      eventsByMessage: new Map(
        [...state.eventsByMessage.entries()].map(([k, v]) => [k, [...v]]),
      ),
      pendingStats: state.pendingStats ? { ...state.pendingStats } : null,
    };
  }

  /**
   * Recursively mark all 'streaming' nodes as 'interrupted'.
   * Used when user aborts/interrupts a streaming message.
   */
  private markStreamingNodesAsInterrupted(node: ExecutionNode): ExecutionNode {
    // Recursively process children first
    const updatedChildren = node.children.map((child) =>
      this.markStreamingNodesAsInterrupted(child),
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
   * Safety net: Mark any agent nodes still in 'streaming' status as 'interrupted'.
   * Historical sessions can never have actively streaming agents â€” if a node is
   * still 'streaming' after history finalization, it means correlation failed to
   * properly resolve it. This prevents agents from being stuck as "Streaming" forever.
   */
  private markStreamingAgentsAsInterrupted(node: ExecutionNode): ExecutionNode {
    const updatedChildren = node.children.map((child) =>
      this.markStreamingAgentsAsInterrupted(child),
    );

    if (node.type === 'agent' && node.status === 'streaming') {
      return {
        ...node,
        status: 'interrupted',
        children: updatedChildren,
      };
    }

    if (updatedChildren !== node.children) {
      return {
        ...node,
        children: updatedChildren,
      };
    }

    return node;
  }

  /**
   * Post-process the last finalized message to mark the last agent as interrupted.
   *
   * Used after a hard permission deny: the SDK sends all completion events before
   * exiting gracefully, so all nodes are 'complete' and markStreamingNodesAsInterrupted
   * is a no-op. This method finds the last (deepest, rightmost) agent node and marks
   * it as 'interrupted' so the inline-agent-bubble shows the interrupted badge.
   */
  markLastAgentAsInterrupted(tabId: string): void {
    const tab = this.tabManager.tabs().find((t) => t.id === tabId);
    if (!tab || tab.messages.length === 0) return;

    // Find the last assistant message (just finalized)
    const messages = tab.messages;
    let lastAssistantIndex = -1;
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === 'assistant' && messages[i].streamingState) {
        lastAssistantIndex = i;
        break;
      }
    }
    if (lastAssistantIndex === -1) return;

    const msg = messages[lastAssistantIndex];
    const tree = msg.streamingState;
    if (!tree) return;

    const updatedTree = this.findAndMarkLastAgent(tree);
    if (updatedTree === tree) return; // No change

    const updatedMessages = [...messages];
    updatedMessages[lastAssistantIndex] = {
      ...msg,
      streamingState: updatedTree,
    };

    this.tabManager.setMessages(tabId, updatedMessages);
  }

  /**
   * Recursively find the last (deepest, rightmost) complete agent node and mark it interrupted.
   * Returns the same node reference if no change was needed.
   */
  private findAndMarkLastAgent(node: ExecutionNode): ExecutionNode {
    // Search children in reverse (rightmost = last active agent)
    const updatedChildren = [...node.children];
    let foundInChild = false;

    for (let i = updatedChildren.length - 1; i >= 0; i--) {
      const updated = this.findAndMarkLastAgent(updatedChildren[i]);
      if (updated !== updatedChildren[i]) {
        updatedChildren[i] = updated;
        foundInChild = true;
        break; // Only mark the last one
      }
    }

    if (foundInChild) {
      return { ...node, children: updatedChildren };
    }

    // This node itself is the last complete agent â€” mark it
    if (node.type === 'agent' && node.status === 'complete') {
      return { ...node, status: 'interrupted' };
    }

    return node;
  }

  /**
   * Mark specific agent nodes as interrupted by their toolCallIds.
   *
   * Used when a hard permission deny identifies the exact agent(s) that were denied.
   * More precise than markLastAgentAsInterrupted (which guesses the last one).
   * Handles multiple concurrent denies via Set-based toolCallIds.
   *
   * @param tabId - Tab containing the finalized message to update
   * @param toolCallIds - Set of toolCallIds (from permission deny toolUseIds) to match
   */
  markAgentsAsInterruptedByToolCallIds(
    tabId: string,
    toolCallIds: Set<string>,
  ): void {
    const tab = this.tabManager.tabs().find((t) => t.id === tabId);
    if (!tab || tab.messages.length === 0) return;

    // Find the last assistant message (just finalized)
    const messages = tab.messages;
    let lastAssistantIndex = -1;
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === 'assistant' && messages[i].streamingState) {
        lastAssistantIndex = i;
        break;
      }
    }
    if (lastAssistantIndex === -1) return;

    const msg = messages[lastAssistantIndex];
    const tree = msg.streamingState;
    if (!tree) return;

    const updatedTree = this.markMatchingAgentsAsInterrupted(tree, toolCallIds);
    if (updatedTree === tree) return; // No matching agents found

    const updatedMessages = [...messages];
    updatedMessages[lastAssistantIndex] = {
      ...msg,
      streamingState: updatedTree,
    };

    this.tabManager.setMessages(tabId, updatedMessages);
  }

  /**
   * Recursively find and mark agent nodes whose toolCallId matches any in the
   * provided set. Returns the same node reference if no change was needed.
   *
   * Unlike findAndMarkLastAgent (which stops at the first match), this marks ALL
   * matching agents â€” handling the case where multiple agents had permissions denied.
   */
  private markMatchingAgentsAsInterrupted(
    node: ExecutionNode,
    toolCallIds: Set<string>,
  ): ExecutionNode {
    // Recursively process children first
    let childrenChanged = false;
    const updatedChildren = node.children.map((child) => {
      const updated = this.markMatchingAgentsAsInterrupted(child, toolCallIds);
      if (updated !== child) childrenChanged = true;
      return updated;
    });

    // Check if THIS node is an agent that should be marked as interrupted
    if (
      node.type === 'agent' &&
      node.status === 'complete' &&
      node.toolCallId &&
      toolCallIds.has(node.toolCallId)
    ) {
      return {
        ...node,
        status: 'interrupted',
        children: childrenChanged ? updatedChildren : node.children,
      };
    }

    // If children changed, return new node with updated children
    if (childrenChanged) {
      return { ...node, children: updatedChildren };
    }

    // No changes needed
    return node;
  }

  /**
   * Recursively mark agent nodes with matching toolCallIds as 'interrupted'.
   *
   * When loading a session from history, the tree is rebuilt but the 'interrupted' status
   * is lost. This method uses the resumable subagent records from the backend registry
   * to re-apply the 'interrupted' status to matching agent nodes so the Resume button appears.
   *
   * @param node - ExecutionNode tree to process
   * @param resumableToolCallIds - Set of toolCallIds from resumable subagents
   * @returns Updated node with 'interrupted' status on matching agents
   */
  private markResumableAgentsAsInterrupted(
    node: ExecutionNode,
    resumableToolCallIds: Set<string>,
  ): ExecutionNode {
    // Recursively process children first
    const updatedChildren = node.children.map((child) =>
      this.markResumableAgentsAsInterrupted(child, resumableToolCallIds),
    );

    // Check if this is an agent node with a matching toolCallId
    if (
      node.type === 'agent' &&
      node.toolCallId &&
      resumableToolCallIds.has(node.toolCallId)
    ) {
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
