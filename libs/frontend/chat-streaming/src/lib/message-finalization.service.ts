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
   *
   * Workspace-aware: when a `tabId` is supplied it is resolved via
   * `findTabByIdAcrossWorkspaces`, NOT the active-only `tabs()` signal, so a
   * turn that ends while its tab is backgrounded still promotes its reply into
   * the persisted `messages` array (via the workspace-aware `applyFinalizedTurn`
   * / `clearStreamingForLoaded` write paths). Resolving against `tabs()` here
   * silently no-op'd for background tabs, stranding the reply in
   * `streamingState`, which the reload sanitize then nulled — a silent data loss
   * (TASK_2026_154 Wave 2 revision).
   */
  finalizeCurrentMessage(tabId?: string, isAborted = false): void {
    this.batchedUpdate.flushSync();
    const targetTabId = tabId ?? this.tabManager.activeTabId();
    if (!targetTabId) return;
    const targetTab = tabId
      ? this.tabManager.findTabByIdAcrossWorkspaces(tabId)?.tab
      : this.tabManager.activeTab();

    const streamingState = targetTab?.streamingState;
    const messageId = streamingState?.currentMessageId;

    if (!streamingState || !messageId) return;
    const stateCopy = this.deepCopyStreamingState(streamingState);
    const cacheKey = `tab-${targetTabId}`;
    let finalTree = this.treeBuilder.buildTree(stateCopy, cacheKey);
    if (isAborted) {
      finalTree = finalTree.map((tree) =>
        this.markStreamingNodesAsInterrupted(tree),
      );
    }
    const completeEvent = [...streamingState.events.values()].find(
      (e) => e.eventType === 'message_complete' && e.messageId === messageId,
    ) as MessageCompleteEvent | undefined;
    const pendingStats = stateCopy.pendingStats;
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
    const existingMessages = targetTab?.messages ?? [];
    const existingIds = new Set(existingMessages.map((m) => m.id));

    const newMessages: ExecutionChatMessage[] = [];

    if (finalTree.length === 0) {
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
      const lastIdx = finalTree.length - 1;
      for (let i = 0; i < finalTree.length; i++) {
        const tree = finalTree[i];
        if (existingIds.has(tree.id)) {
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
      this.tabManager.clearStreamingForLoaded(targetTabId);
      return;
    }
    this.tabManager.applyFinalizedTurn(targetTabId, [
      ...existingMessages,
      ...newMessages,
    ]);
    // `SessionManager` status is a global singleton scoped to the active
    // conversation. Only reflect 'loaded' when finalizing the ACTIVE tab —
    // finalizing a background tab must not flip the foreground UI's status.
    if (this.tabManager.activeTabId() === targetTabId) {
      this.sessionManager.setStatus('loaded');
    }
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
    this.batchedUpdate.flushSync();

    const targetTab = this.tabManager.tabs().find((t) => t.id === tabId);
    const streamingState = targetTab?.streamingState;

    if (!streamingState || streamingState.messageEventIds.length === 0) {
      return [];
    }
    const stateCopy = this.deepCopyStreamingState(streamingState);
    const cacheKey = `tab-${tabId}`;
    let allTrees = this.treeBuilder.buildTree(stateCopy, cacheKey);
    if (resumableSubagents && resumableSubagents.length > 0) {
      const resumableToolCallIds = new Set(
        resumableSubagents.map((s) => s.toolCallId),
      );
      allTrees = allTrees.map((tree) =>
        this.markResumableAgentsAsInterrupted(tree, resumableToolCallIds),
      );
    }

    const messages: ExecutionChatMessage[] = [];
    const usedTreeNodeIds = new Set<string>();
    for (const messageId of stateCopy.messageEventIds) {
      const messageStartEvent = [...stateCopy.events.values()].find(
        (e) => e.eventType === 'message_start' && e.messageId === messageId,
      ) as MessageStartEvent | undefined;

      if (!messageStartEvent) {
        continue;
      }
      if (messageStartEvent.parentToolUseId) {
        continue;
      }

      const role = messageStartEvent.role;
      const treeNode = allTrees.find(
        (node) => node.id === messageStartEvent.id,
      );
      const completeEvent = [...stateCopy.events.values()].find(
        (e) => e.eventType === 'message_complete' && e.messageId === messageId,
      ) as MessageCompleteEvent | undefined;
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
        if (!treeNode) {
          continue;
        }

        if (usedTreeNodeIds.has(treeNode.id)) {
          continue;
        }

        usedTreeNodeIds.add(treeNode.id);
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
    const updatedChildren = node.children.map((child) =>
      this.markStreamingNodesAsInterrupted(child),
    );
    if (node.status === 'streaming') {
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
   * Safety net for historical session replay. Marks any agent nodes still in
   * 'streaming' status as 'interrupted' on history finalization. Required for
   * JSONL replay where no live Stop or SubagentStop event fires — orphaned
   * streaming agent nodes from prior sessions would otherwise render stuck
   * forever. Idempotent for live sessions where SubagentStop already marked
   * nodes complete.
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
    let childrenChanged = false;
    const updatedChildren = node.children.map((child) => {
      const updated = this.markMatchingAgentsAsInterrupted(child, toolCallIds);
      if (updated !== child) childrenChanged = true;
      return updated;
    });
    if (
      node.type === 'agent' &&
      node.status !== 'interrupted' &&
      node.status !== 'resumed' &&
      node.toolCallId &&
      toolCallIds.has(node.toolCallId)
    ) {
      return {
        ...node,
        status: 'interrupted',
        children: childrenChanged ? updatedChildren : node.children,
      };
    }
    if (childrenChanged) {
      return { ...node, children: updatedChildren };
    }
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
    const updatedChildren = node.children.map((child) =>
      this.markResumableAgentsAsInterrupted(child, resumableToolCallIds),
    );
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
    if (updatedChildren !== node.children) {
      return {
        ...node,
        children: updatedChildren,
      };
    }
    return node;
  }

  /**
   * Extract accumulated text content for a specific message
   */
  extractTextForMessage(state: StreamingState, messageId: string): string {
    const textParts: { blockIndex: number; text: string }[] = [];
    for (const [key, text] of state.textAccumulators.entries()) {
      if (key.startsWith(`${messageId}-block-`)) {
        const blockIndex = parseInt(key.split('-block-')[1], 10) || 0;
        textParts.push({ blockIndex, text });
      }
    }
    textParts.sort((a, b) => a.blockIndex - b.blockIndex);
    return textParts.map((p) => p.text).join('\n');
  }
}
