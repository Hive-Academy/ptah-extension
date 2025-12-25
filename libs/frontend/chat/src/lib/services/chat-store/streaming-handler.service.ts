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
  MessageCompleteEvent,
  assertNever,
} from '@ptah-extension/shared';
import { TabManagerService } from '../tab-manager.service';
import { SessionManager } from '../session-manager.service';
import { ExecutionTreeBuilderService } from '../execution-tree-builder.service';
import {
  TabState,
  createEmptyStreamingState,
  StreamingState,
  AccumulatorKeys,
} from '../chat.types';

@Injectable({ providedIn: 'root' })
export class StreamingHandlerService {
  private readonly tabManager = inject(TabManagerService);
  private readonly sessionManager = inject(SessionManager);
  private readonly treeBuilder = inject(ExecutionTreeBuilderService);

  /**
   * Tracks active session IDs to early-exit for deleted sessions.
   * Prevents wasted CPU on events for closed tabs.
   */
  private activeSessionIds = new Set<string>();

  /**
   * Tracks processed messageIds per session to prevent duplicate message_start events.
   * TASK_2025_085: SDK sends both streaming events AND complete messages - we must deduplicate.
   * Map key = sessionId, value = Set of processed messageIds.
   */
  private processedMessageIds = new Map<string, Set<string>>();

  /**
   * Tracks processed toolCallIds per session to prevent duplicate tool_start events.
   * TASK_2025_085: Prevents duplicate agent cards.
   * Map key = sessionId, value = Set of processed toolCallIds.
   */
  private processedToolCallIds = new Map<string, Set<string>>();

  /**
   * Register a session as active.
   * Call when creating a new tab/session or loading an existing session.
   *
   * @param sessionId - Session ID to register
   */
  registerActiveSession(sessionId: string): void {
    this.activeSessionIds.add(sessionId);
  }

  /**
   * Unregister a session as active.
   * Call when deleting a tab or closing a session.
   * Also cleans up deduplication tracking state.
   *
   * @param sessionId - Session ID to unregister
   */
  unregisterActiveSession(sessionId: string): void {
    this.activeSessionIds.delete(sessionId);
    // TASK_2025_085: Clean up deduplication state to prevent memory leaks
    this.processedMessageIds.delete(sessionId);
    this.processedToolCallIds.delete(sessionId);
  }

  /**
   * Process flat streaming event from SDK
   *
   * Stores events in flat Maps instead of building ExecutionNode trees.
   * Tree building is deferred to render time.
   */
  processStreamEvent(event: FlatStreamEventUnion): void {
    // TASK_2025_087: Comprehensive diagnostic logging
    console.log('[StreamingHandlerService] processStreamEvent called:', {
      eventType: event.eventType,
      sessionId: event.sessionId,
      messageId: event.messageId,
    });

    try {
      // NOTE: Removed early exit check for activeSessionIds (TASK_2025_086)
      // The activeSessionIds mechanism was never properly integrated - registerActiveSession
      // is never called. For now, we rely on findTabBySessionId returning null as the filter.
      // TODO: Properly integrate registerActiveSession calls if optimization is needed.

      // 1. Find target tab by event.sessionId
      let targetTab = this.tabManager.findTabBySessionId(event.sessionId);
      console.log('[StreamingHandlerService] findTabBySessionId result:', {
        found: !!targetTab,
        sessionId: event.sessionId,
        targetTabId: targetTab?.id,
        targetTabClaudeSessionId: targetTab?.claudeSessionId,
      });

      // 2. If no tab found, check if active tab needs session ID initialization
      if (!targetTab) {
        const activeTab = this.tabManager.activeTab();

        // TASK_2025_087: Log active tab state for debugging
        console.log(
          '[StreamingHandlerService] No tab found, checking active tab:',
          {
            hasActiveTab: !!activeTab,
            activeTabId: activeTab?.id,
            activeTabStatus: activeTab?.status,
            activeTabClaudeSessionId: activeTab?.claudeSessionId,
            eventSessionId: event.sessionId,
          }
        );

        // Initialize session ID for new tab (first event received)
        // TASK_2025_087: Accept 'fresh', 'streaming', OR 'draft' status
        // - 'fresh': Tab just created (createTab)
        // - 'draft': New conversation started (startNewConversation sets draft before RPC)
        // - 'streaming': Status set by successful RPC result
        // The key condition is !claudeSessionId - that identifies a tab awaiting initialization.
        if (
          activeTab &&
          !activeTab.claudeSessionId &&
          (activeTab.status === 'fresh' ||
            activeTab.status === 'streaming' ||
            activeTab.status === 'draft')
        ) {
          console.log(
            '[StreamingHandlerService] INITIALIZING session ID for active tab:',
            {
              tabId: activeTab.id,
              sessionId: event.sessionId,
              tabStatus: activeTab.status,
            }
          );

          // Set the session ID and transition to streaming status
          this.tabManager.updateTab(activeTab.id, {
            claudeSessionId: event.sessionId,
            status: 'streaming',
          });

          // Update SessionManager
          this.sessionManager.setSessionId(event.sessionId);
          this.sessionManager.setStatus('streaming');

          // Retry finding tab - should succeed now
          targetTab = this.tabManager.findTabBySessionId(event.sessionId);
        }

        // If still not found, log warning and return
        if (!targetTab) {
          console.warn(
            '[StreamingHandlerService] No target tab for event',
            event.sessionId
          );
          return;
        }
      }

      // 2. Initialize streaming state if null
      if (!targetTab.streamingState) {
        this.tabManager.updateTab(targetTab.id, {
          streamingState: createEmptyStreamingState(),
        });
        // TASK_2025_086 FIX: Re-read tab after update - targetTab was stale!
        targetTab = this.tabManager.findTabBySessionId(event.sessionId)!;
      }

      const state = targetTab.streamingState!;

      // 3. Store event by ID
      state.events.set(event.id, event);

      // 3.1. Pre-index event by messageId for O(1) lookup (TASK_2025_084 Batch 1 Task 1.2)
      if (event.messageId) {
        const messageEvents = state.eventsByMessage.get(event.messageId) || [];
        messageEvents.push(event);
        state.eventsByMessage.set(event.messageId, messageEvents);
      }

      // 4. Handle by event type
      switch (event.eventType) {
        case 'message_start': {
          // TASK_2025_085: Deduplicate message_start events
          // SDK sends both streaming events AND complete messages - we must skip duplicates
          let sessionMessageIds = this.processedMessageIds.get(event.sessionId);
          if (!sessionMessageIds) {
            sessionMessageIds = new Set<string>();
            this.processedMessageIds.set(event.sessionId, sessionMessageIds);
          }

          if (sessionMessageIds.has(event.messageId)) {
            console.debug(
              '[StreamingHandlerService] Skipping duplicate message_start',
              { messageId: event.messageId, sessionId: event.sessionId }
            );
            return; // Skip duplicate - already processed this message
          }

          sessionMessageIds.add(event.messageId);
          state.messageEventIds.push(event.messageId);
          state.currentMessageId = event.messageId;
          break;
        }

        case 'text_delta': {
          // TASK_2025_085: Skip text_delta if this message was already finalized
          // This prevents "Hello worldHello world" duplication when complete message arrives after streaming
          const sessionMsgIds = this.processedMessageIds.get(event.sessionId);
          const alreadyProcessed =
            sessionMsgIds?.has(event.messageId) &&
            !state.messageEventIds.includes(event.messageId);

          if (alreadyProcessed) {
            console.debug(
              '[StreamingHandlerService] Skipping text_delta for finalized message',
              { messageId: event.messageId }
            );
            return;
          }

          const blockIndex = event.blockIndex ?? 0; // Default to 0
          const blockKey = AccumulatorKeys.textBlock(
            event.messageId,
            blockIndex
          );
          this.accumulateDelta(state.textAccumulators, blockKey, event.delta);
          break;
        }

        case 'thinking_start': {
          // Thinking block started - currently no action needed
          // Future: Could initialize thinking block state here
          break;
        }

        case 'thinking_delta': {
          // TASK_2025_085: Skip thinking_delta if this message was already finalized
          const sessionMsgIds2 = this.processedMessageIds.get(event.sessionId);
          const alreadyProcessed2 =
            sessionMsgIds2?.has(event.messageId) &&
            !state.messageEventIds.includes(event.messageId);

          if (alreadyProcessed2) {
            console.debug(
              '[StreamingHandlerService] Skipping thinking_delta for finalized message',
              { messageId: event.messageId }
            );
            return;
          }

          const blockIndex = event.blockIndex ?? 0; // Default to 0
          const thinkKey = AccumulatorKeys.thinkingBlock(
            event.messageId,
            blockIndex
          );
          this.accumulateDelta(state.textAccumulators, thinkKey, event.delta);
          break;
        }

        case 'tool_start': {
          // TASK_2025_085: Deduplicate tool_start events
          // Prevents duplicate agent cards when SDK sends both streaming and complete events
          let sessionToolCallIds = this.processedToolCallIds.get(
            event.sessionId
          );
          if (!sessionToolCallIds) {
            sessionToolCallIds = new Set<string>();
            this.processedToolCallIds.set(event.sessionId, sessionToolCallIds);
          }

          if (sessionToolCallIds.has(event.toolCallId)) {
            console.debug(
              '[StreamingHandlerService] Skipping duplicate tool_start',
              { toolCallId: event.toolCallId, sessionId: event.sessionId }
            );
            return; // Skip duplicate - already processed this tool
          }

          sessionToolCallIds.add(event.toolCallId);

          if (!state.toolCallMap.has(event.toolCallId)) {
            state.toolCallMap.set(event.toolCallId, []);
          }
          state.toolCallMap.get(event.toolCallId)!.push(event.id);
          break;
        }

        case 'tool_delta': {
          // TASK_2025_085: Skip tool_delta if this tool was already finalized
          const sessionToolIds = this.processedToolCallIds.get(event.sessionId);
          const toolAlreadyProcessed =
            sessionToolIds?.has(event.toolCallId) &&
            !state.toolCallMap.has(event.toolCallId);

          if (toolAlreadyProcessed) {
            console.debug(
              '[StreamingHandlerService] Skipping tool_delta for finalized tool',
              { toolCallId: event.toolCallId }
            );
            return;
          }

          const inputKey = AccumulatorKeys.toolInput(event.toolCallId);
          this.accumulateDelta(
            state.toolInputAccumulators,
            inputKey,
            event.delta
          );
          break;
        }

        case 'tool_result': {
          // Tool result received - stored in events map
          // Tree builder will construct final result from event data
          break;
        }

        case 'agent_start': {
          // Agent spawned via Task tool - stored in events map
          // Tree builder will construct agent node from event data
          break;
        }

        case 'message_complete': {
          state.currentTokenUsage = event.tokenUsage || null;
          break;
        }

        case 'message_delta': {
          // Cumulative token usage during streaming - update current usage
          state.currentTokenUsage = event.tokenUsage;
          break;
        }

        case 'signature_delta': {
          // Extended thinking signature verification - currently no action needed
          // Future: Could store signature for verification
          break;
        }

        default:
          // TASK_2025_090: Exhaustiveness check - compile-time error if new event type added but not handled
          assertNever(
            event,
            `Unhandled event type: ${(event as FlatStreamEventUnion).eventType}`
          );
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
   * Helper to accumulate delta into Map.
   * Reduces code duplication across text/thinking/tool delta handlers.
   *
   * @param map - Map to accumulate into
   * @param key - Key for the accumulator
   * @param delta - Delta text to append
   */
  private accumulateDelta(
    map: Map<string, string>,
    key: string,
    delta: string
  ): void {
    const current = map.get(key) || '';
    map.set(key, current + delta);
  }

  /**
   * Deep-copy StreamingState to prevent race condition between finalize and stream.
   * Creates new Map instances to ensure isolation.
   *
   * @param state - StreamingState to copy
   * @returns Deep copy of StreamingState
   */
  private deepCopyStreamingState(state: StreamingState): StreamingState {
    return {
      events: new Map(state.events),
      messageEventIds: [...state.messageEventIds],
      toolCallMap: new Map(
        [...state.toolCallMap.entries()].map(([k, v]) => [k, [...v]])
      ),
      textAccumulators: new Map(state.textAccumulators),
      toolInputAccumulators: new Map(state.toolInputAccumulators),
      currentMessageId: state.currentMessageId,
      currentTokenUsage: state.currentTokenUsage
        ? { ...state.currentTokenUsage }
        : null,
      eventsByMessage: new Map(
        [...state.eventsByMessage.entries()].map(([k, v]) => [k, [...v]])
      ),
    };
  }

  /**
   * Finalize the current streaming message
   *
   * Builds final ExecutionNode tree from StreamingState using ExecutionTreeBuilderService.
   * Extracts metadata from message_complete event.
   * Uses per-tab currentMessageId for proper multi-tab streaming support.
   *
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

    const streamingState = targetTab?.streamingState;
    // TASK_2025_087 FIX: Read currentMessageId from streamingState, not targetTab
    // processStreamEvent() sets state.currentMessageId (on StreamingState), not targetTab.currentMessageId
    const messageId = streamingState?.currentMessageId;

    if (!streamingState || !messageId) return;

    console.log(
      '[StreamingHandlerService] 📊 Finalizing message - streaming state:',
      {
        messageId,
        eventCount: streamingState.events.size,
        hasTokenUsage: !!streamingState.currentTokenUsage,
      }
    );

    // Deep-copy state to prevent race condition (TASK_2025_084 Batch 1 Task 1.3)
    const stateCopy = this.deepCopyStreamingState(streamingState);

    // Build final tree using ExecutionTreeBuilderService (TASK_2025_082 Batch 6)
    const finalTree = this.treeBuilder.buildTree(stateCopy);

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

      console.log('[StreamingHandlerService] ✅ Metadata extracted:', {
        tokens,
        cost,
        duration,
      });
    } else {
      console.warn(
        '[StreamingHandlerService] ⚠️ No message_complete event found!'
      );
    }

    // Create finalized chat message with tree
    const assistantMessage = createExecutionChatMessage({
      id: messageId,
      role: 'assistant',
      streamingState: finalTree[0] || null, // Single root message
      sessionId: targetTab?.claudeSessionId ?? undefined,
      tokens,
      cost,
      duration,
    });

    console.log('[StreamingHandlerService] 📝 Created assistant message:', {
      messageId,
      hasTree: !!assistantMessage.streamingState,
      treeNodeCount: finalTree.length,
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
