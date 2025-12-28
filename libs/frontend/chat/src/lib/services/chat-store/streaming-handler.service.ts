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
  MessageStartEvent,
  assertNever,
  ExecutionChatMessage,
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
   * Clean up deduplication state for a session.
   * MUST be called when closing/deleting a session to prevent memory leaks.
   * TASK_2025_090: Integrated cleanup into tab close flow.
   *
   * @param sessionId - Session ID to clean up
   */
  cleanupSessionDeduplication(sessionId: string): void {
    this.processedMessageIds.delete(sessionId);
    this.processedToolCallIds.delete(sessionId);
    console.log(
      '[StreamingHandlerService] Cleaned up deduplication state for session:',
      sessionId
    );
  }

  /**
   * Process flat streaming event from SDK
   *
   * Stores events in flat Maps instead of building ExecutionNode trees.
   * Tree building is deferred to render time.
   *
   * TASK_2025_092: Now accepts tabId for routing and sessionId (real SDK UUID)
   * - tabId: Used to find the correct tab to route the event to
   * - sessionId: Real SDK UUID to store on the tab for future resume
   *
   * @param event - The flat streaming event from SDK
   * @param tabId - Optional tab ID for direct routing (preferred)
   * @param sessionId - Optional real SDK UUID for session linking
   */
  processStreamEvent(
    event: FlatStreamEventUnion,
    tabId?: string,
    sessionId?: string
  ): void {
    // TASK_2025_087: Comprehensive diagnostic logging
    console.log('[StreamingHandlerService] processStreamEvent called:', {
      eventType: event.eventType,
      sessionId: event.sessionId,
      messageId: event.messageId,
      tabId,
      providedSessionId: sessionId,
    });

    try {
      // TASK_2025_090: Removed dead activeSessionIds tracking (never used).
      // We rely on findTabBySessionId returning null for closed/unknown sessions.

      // TASK_2025_092: Use provided tabId for direct routing (primary), fall back to sessionId lookup
      let targetTab: TabState | undefined;

      // Primary: Use tabId for direct routing
      if (tabId) {
        targetTab = this.tabManager.tabs().find((t) => t.id === tabId);
        console.log('[StreamingHandlerService] findTabByTabId result:', {
          found: !!targetTab,
          tabId,
          targetTabClaudeSessionId: targetTab?.claudeSessionId,
        });
      }

      // Fallback: Find target tab by event.sessionId
      if (!targetTab) {
        targetTab =
          this.tabManager.findTabBySessionId(event.sessionId) ?? undefined;
        console.log('[StreamingHandlerService] findTabBySessionId result:', {
          found: !!targetTab,
          sessionId: event.sessionId,
          targetTabId: targetTab?.id,
          targetTabClaudeSessionId: targetTab?.claudeSessionId,
        });
      }

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
            providedTabId: tabId,
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
          // TASK_2025_092: Use the real SDK sessionId if provided, otherwise fall back to event.sessionId
          const realSessionId = sessionId || event.sessionId;

          console.log(
            '[StreamingHandlerService] INITIALIZING session ID for active tab:',
            {
              tabId: activeTab.id,
              sessionId: realSessionId,
              tabStatus: activeTab.status,
            }
          );

          // Set the session ID and transition to streaming status
          this.tabManager.updateTab(activeTab.id, {
            claudeSessionId: realSessionId,
            status: 'streaming',
          });

          // Update SessionManager
          this.sessionManager.setSessionId(realSessionId);
          this.sessionManager.setStatus('streaming');

          // Use the active tab as target
          targetTab = this.tabManager.activeTab() ?? undefined;
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

      // TASK_2025_092: If tab doesn't have claudeSessionId yet, set it with real SDK UUID
      if (targetTab && sessionId && !targetTab.claudeSessionId) {
        console.log(
          '[StreamingHandlerService] Setting claudeSessionId from event:',
          {
            tabId: targetTab.id,
            sessionId,
          }
        );
        this.tabManager.updateTab(targetTab.id, { claudeSessionId: sessionId });
      }

      // 2. Initialize streaming state if null
      if (!targetTab.streamingState) {
        this.tabManager.updateTab(targetTab.id, {
          streamingState: createEmptyStreamingState(),
        });
        // TASK_2025_092 FIX: Re-read tab by its own ID, not event.sessionId
        // After session:id-resolved, tab's claudeSessionId is real UUID but
        // event.sessionId may still be temp ID, so findTabBySessionId fails.
        // Using tab's own ID is reliable since we already found it above.
        targetTab = this.tabManager.tabs().find((t) => t.id === targetTab!.id)!;
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
          // TASK_2025_091: Handle duplicate message_start by CLEARING accumulators
          // SDK sends both streaming events AND complete assistant messages.
          // When assistant complete arrives after streaming, its message_start
          // should RESET the accumulated content so the complete content replaces
          // the streamed content. This is the systematic deduplication solution.
          let sessionMessageIds = this.processedMessageIds.get(event.sessionId);
          if (!sessionMessageIds) {
            sessionMessageIds = new Set<string>();
            this.processedMessageIds.set(event.sessionId, sessionMessageIds);
          }

          if (sessionMessageIds.has(event.messageId)) {
            // TASK_2025_091: Clear accumulators for this messageId to allow replacement
            // This handles the case where SDK sends streaming events followed by
            // a complete assistant message with the same messageId
            console.debug(
              '[StreamingHandlerService] Duplicate message_start - clearing accumulators for replacement',
              { messageId: event.messageId, sessionId: event.sessionId }
            );

            // Clear text accumulators for this messageId (all block indices)
            // FIX: Use correct key format matching AccumulatorKeys.textBlock/thinkingBlock
            // Old format was "text:msgId:" but actual keys are "msgId-block-N" and "msgId-thinking-N"
            for (const key of state.textAccumulators.keys()) {
              if (
                key.startsWith(`${event.messageId}-block-`) ||
                key.startsWith(`${event.messageId}-thinking-`)
              ) {
                state.textAccumulators.delete(key);
              }
            }

            // Don't return - continue processing to update currentMessageId
          } else {
            sessionMessageIds.add(event.messageId);
            state.messageEventIds.push(event.messageId);
          }

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
      pendingStats: state.pendingStats ? { ...state.pendingStats } : null,
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
    // Apply pendingStats if message_complete event wasn't found but we have stored stats
    const pendingStats = stateCopy.pendingStats;
    const finalTokens =
      tokens ?? (pendingStats ? pendingStats.tokens : undefined);
    const finalCost = cost ?? (pendingStats ? pendingStats.cost : undefined);
    const finalDuration =
      duration ?? (pendingStats ? pendingStats.duration : undefined);

    if (pendingStats && !tokens) {
      console.log('[StreamingHandlerService] ✅ Applied pending stats:', {
        tokens: pendingStats.tokens,
        cost: pendingStats.cost,
        duration: pendingStats.duration,
      });
    }

    const assistantMessage = createExecutionChatMessage({
      id: messageId,
      role: 'assistant',
      streamingState: finalTree[0] || null, // Single root message
      sessionId: targetTab?.claudeSessionId ?? undefined,
      tokens: finalTokens,
      cost: finalCost,
      duration: finalDuration,
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
   * Finalize session history - builds messages for ALL messages in streaming state
   *
   * TASK_2025_092 FIX: Unlike finalizeCurrentMessage which only handles the
   * current streaming message, this method processes ALL messages from session
   * history replay. It handles both user and assistant messages, building
   * execution trees for assistant messages that include tool calls.
   *
   * @param tabId - Tab ID to finalize
   * @returns Array of ExecutionChatMessage for all messages in history
   */
  finalizeSessionHistory(tabId: string): ExecutionChatMessage[] {
    const targetTab = this.tabManager.tabs().find((t) => t.id === tabId);
    const streamingState = targetTab?.streamingState;

    if (!streamingState || streamingState.messageEventIds.length === 0) {
      console.warn(
        '[StreamingHandlerService] No streaming state or messages for history finalization',
        { tabId }
      );
      return [];
    }

    console.log('[StreamingHandlerService] Finalizing session history', {
      tabId,
      messageCount: streamingState.messageEventIds.length,
      eventCount: streamingState.events.size,
    });

    // Deep-copy state to prevent race conditions
    const stateCopy = this.deepCopyStreamingState(streamingState);

    // Build full tree for all messages
    const allTrees = this.treeBuilder.buildTree(stateCopy);

    const messages: ExecutionChatMessage[] = [];

    // Process each messageId to create appropriate message type
    for (const messageId of stateCopy.messageEventIds) {
      // Find message_start event to determine role
      const messageStartEvent = [...stateCopy.events.values()].find(
        (e) => e.eventType === 'message_start' && e.messageId === messageId
      ) as MessageStartEvent | undefined;

      if (!messageStartEvent) {
        console.warn(
          '[StreamingHandlerService] No message_start event for messageId',
          { messageId }
        );
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

    console.log('[StreamingHandlerService] Session history finalized', {
      tabId,
      totalMessages: messages.length,
      userMessages: messages.filter((m) => m.role === 'user').length,
      assistantMessages: messages.filter((m) => m.role === 'assistant').length,
    });

    // Update tab with finalized messages and clear streaming state
    this.tabManager.updateTab(tabId, {
      messages,
      streamingState: null,
      status: 'loaded',
    });

    return messages;
  }

  /**
   * Extract accumulated text content for a specific message
   *
   * @param state - Streaming state
   * @param messageId - Message ID to extract text for
   * @returns Accumulated text content
   */
  private extractTextForMessage(
    state: StreamingState,
    messageId: string
  ): string {
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
    let targetTab = this.tabManager.findTabBySessionId(stats.sessionId);

    // TASK_2025_092: If no tab found by sessionId, use active tab as fallback
    // This handles cases where:
    // 1. Stats arrive before session ID was set on tab
    // 2. Stats have temp ID but tab has real UUID (legacy edge case)
    // 3. Single-conversation flow where active tab is the stats target
    if (!targetTab) {
      const activeTab = this.tabManager.activeTab();

      console.log(
        '[StreamingHandlerService] No tab found for stats, checking active tab:',
        {
          hasActiveTab: !!activeTab,
          activeTabId: activeTab?.id,
          activeTabStatus: activeTab?.status,
          activeTabClaudeSessionId: activeTab?.claudeSessionId,
          statsSessionId: stats.sessionId,
        }
      );

      // Initialize session ID for active tab if it's awaiting initialization
      if (
        activeTab &&
        !activeTab.claudeSessionId &&
        (activeTab.status === 'fresh' ||
          activeTab.status === 'streaming' ||
          activeTab.status === 'draft')
      ) {
        console.log(
          '[StreamingHandlerService] INITIALIZING session ID from stats for active tab:',
          {
            tabId: activeTab.id,
            sessionId: stats.sessionId,
            tabStatus: activeTab.status,
          }
        );

        // Set the session ID (keep current status - streaming event will set 'streaming' if needed)
        this.tabManager.updateTab(activeTab.id, {
          claudeSessionId: stats.sessionId,
        });

        // Update SessionManager
        this.sessionManager.setSessionId(stats.sessionId);

        targetTab = activeTab;
      } else if (
        activeTab &&
        (activeTab.status === 'streaming' || activeTab.status === 'loaded')
      ) {
        // TASK_2025_092: Use active tab as fallback for stats in single-conversation flow
        // Active tab already has a session ID, and stats belong to current conversation
        console.log(
          '[StreamingHandlerService] Using active tab as fallback for stats:',
          {
            tabId: activeTab.id,
            activeTabClaudeSessionId: activeTab.claudeSessionId,
            statsSessionId: stats.sessionId,
          }
        );
        targetTab = activeTab;
      }

      // If still not found after fallback attempts, log warning and return
      if (!targetTab) {
        console.warn('[StreamingHandlerService] No tab found for session', {
          sessionId: stats.sessionId,
        });
        return;
      }
    }

    // Check if streaming is still in progress
    // If so, store stats as pendingStats to be applied during finalization
    if (targetTab.streamingState && targetTab.status === 'streaming') {
      console.log(
        '[StreamingHandlerService] Streaming still in progress, storing pending stats',
        {
          sessionId: stats.sessionId,
          tabId: targetTab.id,
        }
      );

      const state = targetTab.streamingState;
      state.pendingStats = {
        cost: stats.cost,
        tokens: stats.tokens,
        duration: stats.duration,
      };

      // Trigger reactivity
      this.tabManager.updateTab(targetTab.id, {
        streamingState: { ...state },
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
