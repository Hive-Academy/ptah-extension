/**
 * StreamingHandlerService - ExecutionNode Processing and Finalization
 *
 * Extracted from ChatStore to handle streaming-related operations:
 * - Processing ExecutionNode updates from SDK
 * - Merging nodes into execution tree
 * - Finalizing streaming messages to chat messages
 *
 * Part of ChatStore refactoring (Facade pattern) - ChatStore delegates here.
 */

import { Injectable, inject } from '@angular/core';
import {
  ExecutionNode,
  createExecutionChatMessage,
  calculateMessageCost,
} from '@ptah-extension/shared';
import { TabManagerService } from '../tab-manager.service';
import { SessionManager } from '../session-manager.service';
import { TabState } from '../chat.types';

@Injectable({ providedIn: 'root' })
export class StreamingHandlerService {
  private readonly tabManager = inject(TabManagerService);
  private readonly sessionManager = inject(SessionManager);

  /**
   * Process ExecutionNode directly from SDK
   *
   * SDK returns clean ExecutionNode objects - no CLI formatting to strip.
   */
  processExecutionNode(node: ExecutionNode, sessionId?: string): void {
    try {
      // 1. Find target tab by session ID
      let targetTab: TabState | null = null;
      let targetTabId: string | null = null;

      if (sessionId) {
        targetTab = this.tabManager.findTabBySessionId(sessionId);
        if (targetTab) {
          targetTabId = targetTab.id;
        }
      }

      // Fall back to active tab
      if (!targetTab) {
        targetTabId = this.tabManager.activeTabId();
        targetTab = this.tabManager.activeTab();
      }

      if (!targetTabId || !targetTab) {
        console.warn(
          '[StreamingHandlerService] No target tab for ExecutionNode processing'
        );
        return;
      }

      // 2. Merge node into execution tree
      const currentTree = targetTab.executionTree;
      const updatedTree = this.mergeExecutionNode(currentTree, node);

      // 3. Update tab state
      this.tabManager.updateTab(targetTabId, {
        executionTree: updatedTree,
      });

      // 4. Register in SessionManager for agent/tool correlation
      if (node.type === 'agent' && node.id) {
        this.sessionManager.registerAgent(node.id, node);
      } else if (node.type === 'tool' && node.toolCallId) {
        this.sessionManager.registerTool(node.toolCallId, node);
      }

      // 5. Track streaming state
      if (node.status === 'streaming' && !targetTab.currentMessageId) {
        this.tabManager.updateTab(targetTabId, {
          currentMessageId: node.id,
        });
      }
    } catch (error) {
      console.error(
        '[StreamingHandlerService] Error processing ExecutionNode:',
        error,
        node
      );
    }
  }

  /**
   * Merge ExecutionNode into existing tree
   */
  mergeExecutionNode(
    currentTree: ExecutionNode | null,
    node: ExecutionNode
  ): ExecutionNode {
    if (!currentTree) {
      // First node becomes the root
      return node;
    }

    // Check if this node should replace an existing node (by ID)
    const existingNode = this.findNodeInTree(currentTree, node.id);
    if (existingNode) {
      // Replace existing node (update scenario)
      return this.replaceNodeInTree(currentTree, node.id, node);
    }

    // Append as new child
    return {
      ...currentTree,
      children: [...currentTree.children, node],
    };
  }

  /**
   * Find node by ID in tree (recursive)
   */
  findNodeInTree(tree: ExecutionNode, id: string): ExecutionNode | null {
    if (tree.id === id) return tree;
    for (const child of tree.children) {
      const found = this.findNodeInTree(child, id);
      if (found) return found;
    }
    return null;
  }

  /**
   * Recursively replace a node in the execution tree by ID
   */
  replaceNodeInTree(
    tree: ExecutionNode,
    nodeId: string,
    replacement: ExecutionNode
  ): ExecutionNode {
    if (tree.id === nodeId) {
      return replacement;
    }

    return {
      ...tree,
      children: tree.children.map((child) =>
        this.replaceNodeInTree(child, nodeId, replacement)
      ),
    };
  }

  /**
   * Finalize the current streaming message
   *
   * Converts the execution tree to a chat message and adds it to the target tab's messages.
   * Uses per-tab currentMessageId for proper multi-tab streaming support.
   * @param tabId - Optional tab ID to finalize. Falls back to active tab if not provided.
   */
  finalizeCurrentMessage(tabId?: string): void {
    // Use provided tabId or fall back to active tab
    const targetTabId = tabId ?? this.tabManager.activeTabId();
    if (!targetTabId) return;

    // Get the target tab (by ID if provided, otherwise active)
    const targetTab = tabId
      ? this.tabManager.tabs().find((t) => t.id === tabId)
      : this.tabManager.activeTab();

    const tree = targetTab?.executionTree;
    const messageId = targetTab?.currentMessageId;

    if (!tree || !messageId) return;

    // Mark all streaming nodes as complete
    const finalizeNode = (node: ExecutionNode): ExecutionNode => ({
      ...node,
      status: node.status === 'streaming' ? 'complete' : node.status,
      children: node.children.map(finalizeNode),
    });

    const finalTree = finalizeNode(tree);

    // Extract token usage and calculate cost from finalized tree
    let tokens:
      | { input: number; output: number; cacheHit?: number }
      | undefined;
    let cost: number | undefined;
    let duration: number | undefined;

    console.log(
      '[StreamingHandlerService] 📊 Finalizing message - tree data:',
      {
        hasTokenUsage: !!finalTree.tokenUsage,
        tokenUsage: finalTree.tokenUsage,
        model: finalTree.model,
        duration: finalTree.duration,
      }
    );

    if (finalTree.tokenUsage) {
      tokens = {
        input: finalTree.tokenUsage.input,
        output: finalTree.tokenUsage.output,
      };
      // Use model from tree root (set during init) for accurate pricing
      try {
        const modelId = finalTree.model ?? 'default';
        cost = calculateMessageCost(modelId, tokens);
        console.log('[StreamingHandlerService] ✅ Cost calculated:', {
          modelId,
          tokens,
          cost,
        });
      } catch (error) {
        console.error(
          '[StreamingHandlerService] Cost calculation failed',
          error
        );
        cost = undefined;
      }
    } else {
      console.warn(
        '[StreamingHandlerService] ⚠️ No tokenUsage found on finalized tree!'
      );
    }

    if (finalTree.duration !== undefined) {
      duration = finalTree.duration;
    }

    // Create chat message with execution tree and token/cost metadata
    const assistantMessage = createExecutionChatMessage({
      id: messageId,
      role: 'assistant',
      executionTree: finalTree,
      sessionId: targetTab?.claudeSessionId ?? undefined,
      tokens,
      cost,
      duration,
    });

    console.log('[StreamingHandlerService] 📝 Created assistant message:', {
      messageId,
      hasTokens: !!assistantMessage.tokens,
      tokens: assistantMessage.tokens,
      cost: assistantMessage.cost,
      duration: assistantMessage.duration,
    });

    // Add to target tab's messages and clear streaming state
    this.tabManager.updateTab(targetTabId, {
      messages: [...(targetTab?.messages ?? []), assistantMessage],
      executionTree: null,
      status: 'loaded',
      currentMessageId: null,
    });

    // Update SessionManager status
    this.sessionManager.setStatus('loaded');
  }

  /**
   * Handle session stats update from backend
   *
   * Updates the most recent assistant message with cost/token/duration data.
   * Called when backend sends `session:stats` message after completion.
   *
   * @param stats - Session statistics from backend
   */
  handleSessionStats(stats: {
    sessionId: string;
    cost: number;
    tokens: { input: number; output: number };
    duration: number;
  }): void {
    console.log('[StreamingHandlerService] Received session stats:', stats);

    // Find the target tab by session ID
    const targetTab = this.tabManager.findTabBySessionId(stats.sessionId);
    if (!targetTab) {
      console.warn(
        '[StreamingHandlerService] No tab found for session:',
        stats.sessionId
      );
      return;
    }

    // Find the last assistant message in the tab
    const messages = targetTab.messages;
    if (messages.length === 0) {
      console.warn(
        '[StreamingHandlerService] No messages found in tab for stats update'
      );
      return;
    }

    // Find the last assistant message (iterate backwards)
    let lastAssistantIndex = -1;
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === 'assistant') {
        lastAssistantIndex = i;
        break;
      }
    }

    if (lastAssistantIndex === -1) {
      console.warn(
        '[StreamingHandlerService] No assistant message found for stats update'
      );
      return;
    }

    // Update the assistant message with stats
    const updatedMessages = [...messages];
    updatedMessages[lastAssistantIndex] = {
      ...messages[lastAssistantIndex],
      tokens: stats.tokens,
      cost: stats.cost,
      duration: stats.duration,
    };

    // Update the tab with the new messages array
    this.tabManager.updateTab(targetTab.id, {
      messages: updatedMessages,
    });

    console.log('[StreamingHandlerService] Updated message with stats:', {
      messageIndex: lastAssistantIndex,
      tokens: stats.tokens,
      cost: stats.cost,
      duration: stats.duration,
    });
  }
}
