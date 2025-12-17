/**
 * StreamingHandlerService - Flat Event Storage and Finalization
 *
 * Extracted from ChatStore to handle streaming-related operations:
 * - Processing flat streaming events from SDK
 * - Storing events in StreamingState maps
 * - Finalizing streaming messages to chat messages
 *
 * Part of ChatStore refactoring (Facade pattern) - ChatStore delegates here.
 */

import { Injectable, inject } from '@angular/core';
import {
  ExecutionNode,
  FlatStreamEventUnion,
  createExecutionChatMessage,
  calculateMessageCost,
  createExecutionNode,
} from '@ptah-extension/shared';
import { TabManagerService } from '../tab-manager.service';
import { SessionManager } from '../session-manager.service';
import {
  TabState,
  createEmptyStreamingState,
  StreamingState,
} from '../chat.types';

@Injectable({ providedIn: 'root' })
export class StreamingHandlerService {
  private readonly tabManager = inject(TabManagerService);
  private readonly sessionManager = inject(SessionManager);

  /**
   * Process flat streaming event from SDK
   *
   * Stores events in flat Maps instead of building ExecutionNode trees.
   * Tree building is deferred to render time.
   */
  processStreamEvent(event: FlatStreamEventUnion): void {
    try {
      // 1. Find target tab by event.sessionId
      const targetTab = this.tabManager.findTabBySessionId(event.sessionId);
      if (!targetTab) {
        console.warn(
          '[StreamingHandlerService] No target tab for event',
          event.sessionId
        );
        return;
      }

      // 2. Initialize streaming state if null
      if (!targetTab.streamingState) {
        this.tabManager.updateTab(targetTab.id, {
          streamingState: createEmptyStreamingState(),
        });
      }

      const state = targetTab.streamingState!;

      // 3. Store event by ID
      state.events.set(event.id, event);

      // 4. Handle by event type
      switch (event.eventType) {
        case 'message_start':
          state.messageEventIds.push(event.messageId);
          state.currentMessageId = event.messageId;
          break;

        case 'text_delta': {
          const blockKey = `${event.messageId}-block-${event.blockIndex}`;
          const current = state.textAccumulators.get(blockKey) || '';
          state.textAccumulators.set(blockKey, current + event.delta);
          break;
        }

        case 'thinking_delta': {
          const thinkKey = `${event.messageId}-thinking-${event.blockIndex}`;
          const current = state.textAccumulators.get(thinkKey) || '';
          state.textAccumulators.set(thinkKey, current + event.delta);
          break;
        }

        case 'tool_start':
          if (!state.toolCallMap.has(event.toolCallId)) {
            state.toolCallMap.set(event.toolCallId, []);
          }
          state.toolCallMap.get(event.toolCallId)!.push(event.id);
          break;

        case 'tool_delta': {
          const inputKey = `${event.toolCallId}-input`;
          const current = state.toolInputAccumulators.get(inputKey) || '';
          state.toolInputAccumulators.set(inputKey, current + event.delta);
          break;
        }

        case 'message_complete':
          state.currentTokenUsage = event.tokenUsage || null;
          break;
      }

      // 5. Trigger reactivity by updating tab
      this.tabManager.updateTab(targetTab.id, {
        streamingState: { ...state },
      });
    } catch (error) {
      console.error(
        '[StreamingHandlerService] Error processing stream event:',
        error,
        event
      );
    }
  }

  /**
   * Finalize the current streaming message
   *
   * Creates a minimal ExecutionNode stub from StreamingState.
   * Full tree building will be done at render time (Batch 5).
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

    const state = targetTab?.streamingState;
    const messageId = targetTab?.currentMessageId;

    if (!state || !messageId) return;

    // Extract token usage and calculate cost from streaming state
    let tokens:
      | { input: number; output: number; cacheHit?: number }
      | undefined;
    let cost: number | undefined;
    let duration: number | undefined;

    console.log(
      '[StreamingHandlerService] 📊 Finalizing message - streaming state:',
      {
        hasTokenUsage: !!state.currentTokenUsage,
        tokenUsage: state.currentTokenUsage,
        eventCount: state.events.size,
      }
    );

    if (state.currentTokenUsage) {
      tokens = {
        input: state.currentTokenUsage.input,
        output: state.currentTokenUsage.output,
      };
      // Use default model for now (model selection handled elsewhere)
      try {
        const modelId = 'default';
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
        '[StreamingHandlerService] ⚠️ No tokenUsage found in streaming state!'
      );
    }

    // Build minimal ExecutionNode stub (full tree building in Batch 5)
    const stubNode = this.buildStubExecutionNode(state, messageId);

    // Create chat message with stub node and token/cost metadata
    const assistantMessage = createExecutionChatMessage({
      id: messageId,
      role: 'assistant',
      streamingState: stubNode,
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
      streamingState: null,
      status: 'loaded',
      currentMessageId: null,
    });

    // Update SessionManager status
    this.sessionManager.setStatus('loaded');
  }

  /**
   * Build a minimal ExecutionNode stub from StreamingState
   * TEMPORARY: Full tree building will be done at render time in Batch 5
   */
  private buildStubExecutionNode(
    state: StreamingState,
    messageId: string
  ): ExecutionNode {
    // Accumulate all text deltas
    const textContent = Array.from(state.textAccumulators.values()).join('');

    return createExecutionNode({
      id: messageId,
      type: 'message',
      status: 'complete',
      content: textContent,
      tokenUsage: state.currentTokenUsage || undefined,
    });
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
      console.warn('[StreamingHandlerService] No tab found for session', {
        sessionId: stats.sessionId,
      });
      return;
    }

    // Find the last assistant message in the tab
    const messages = targetTab.messages;
    if (messages.length === 0) {
      console.warn(
        '[StreamingHandlerService] No messages in tab for stats update',
        {
          sessionId: stats.sessionId,
          tabId: targetTab.id,
        }
      );
      return;
    }

    // ASSUMPTION: Stats correspond to the most recent assistant response
    // This assumes single-threaded conversation flow (one message at a time)
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
        '[StreamingHandlerService] No assistant message found for stats update',
        {
          sessionId: stats.sessionId,
          tabId: targetTab.id,
          messageCount: messages.length,
          lastMessageRole: messages[messages.length - 1]?.role,
        }
      );
      return;
    }

    console.log('[StreamingHandlerService] Found target message for stats', {
      sessionId: stats.sessionId,
      messageIndex: lastAssistantIndex,
      messageCount: messages.length,
    });

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
