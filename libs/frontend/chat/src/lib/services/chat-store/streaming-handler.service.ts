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
  EventSource,
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
   * PERFORMANCE OPTIMIZATION: Batched UI updates using requestAnimationFrame
   * Instead of updating TabManager 100+ times/sec, we batch updates and flush once per frame.
   * This dramatically reduces signal updates and change detection cycles.
   */
  private pendingTabUpdates = new Map<string, StreamingState>();
  private rafId: number | null = null;

  /**
   * TASK_2025_095: Source priority for event deduplication.
   * Higher priority sources should replace lower priority sources.
   * - 'history': Loaded from JSONL files (highest priority - definitive)
   * - 'complete': From complete assistant/user messages (high priority - definitive)
   * - 'stream': From streaming events (low priority - preview only)
   */
  private getSourcePriority(source: EventSource | undefined): number {
    switch (source) {
      case 'history':
        return 3;
      case 'complete':
        return 2;
      case 'stream':
        return 1;
      default:
        return 0;
    }
  }

  /**
   * TASK_2025_095: Check if new event should replace existing event based on source priority.
   * Returns true if new event has higher or equal priority.
   */
  private shouldReplaceEvent(
    existingSource: EventSource | undefined,
    newSource: EventSource | undefined
  ): boolean {
    return (
      this.getSourcePriority(newSource) >=
      this.getSourcePriority(existingSource)
    );
  }

  /**
   * TASK_2025_095: Replace stream events with higher priority events for the same toolCallId.
   * When a 'complete' or 'history' source event arrives, it should replace any existing
   * 'stream' source events for the same tool call.
   *
   * TASK_2025_096: Extended to support agent_start events to prevent duplicate agents.
   *
   * @param state - The streaming state to update
   * @param toolCallId - The tool call ID to match
   * @param eventType - The event type to match ('tool_start', 'tool_result', or 'agent_start')
   * @param newSource - The source of the new event
   * @returns The existing event if it should NOT be replaced, undefined if new event should be stored
   */
  private replaceStreamEventIfNeeded(
    state: StreamingState,
    toolCallId: string,
    eventType: 'tool_start' | 'tool_result' | 'agent_start',
    newSource: EventSource | undefined
  ): FlatStreamEventUnion | undefined {
    // Find existing event with same toolCallId and eventType
    let existingEvent: FlatStreamEventUnion | undefined;

    for (const event of state.events.values()) {
      if (
        event.eventType === eventType &&
        'toolCallId' in event &&
        event.toolCallId === toolCallId
      ) {
        existingEvent = event;
        break;
      }
    }

    if (!existingEvent) {
      // No existing event, new event should be stored
      return undefined;
    }

    const existingSource = (
      existingEvent as FlatStreamEventUnion & { source?: EventSource }
    ).source;

    if (this.shouldReplaceEvent(existingSource, newSource)) {
      // New event has higher priority, remove old event
      state.events.delete(existingEvent.id);
      console.debug(
        '[StreamingHandlerService] TASK_2025_095: Replacing stream event with higher priority event',
        {
          toolCallId,
          eventType,
          oldSource: existingSource,
          newSource,
          oldEventId: existingEvent.id,
        }
      );
      return undefined; // Allow new event to be stored
    }

    // Existing event has higher priority, skip new event
    console.debug(
      '[StreamingHandlerService] TASK_2025_095: Skipping lower priority event',
      {
        toolCallId,
        eventType,
        existingSource,
        newSource,
      }
    );
    return existingEvent;
  }

  /**
   * TASK_2025_096: Find existing message_start event for a given messageId.
   * Used to check for duplicates before storing a new message_start event.
   *
   * @param state - The streaming state to search
   * @param messageId - The messageId to search for
   * @returns The existing message_start event if found, undefined otherwise
   */
  private findMessageStartEvent(
    state: StreamingState,
    messageId: string
  ): FlatStreamEventUnion | undefined {
    // Search in eventsByMessage for efficiency
    const messageEvents = state.eventsByMessage.get(messageId);
    if (!messageEvents) return undefined;

    return messageEvents.find((e) => e.eventType === 'message_start');
  }

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
   * PERFORMANCE OPTIMIZATION: Schedule batched UI update
   * Instead of calling tabManager.updateTab() on every event (100+/sec),
   * we accumulate changes and flush once per animation frame (~60/sec max).
   *
   * @param tabId - Tab ID to update
   * @param state - Current streaming state (will be cloned on flush)
   */
  private scheduleTabUpdate(tabId: string, state: StreamingState): void {
    // Store reference to current state (we'll clone it on flush)
    this.pendingTabUpdates.set(tabId, state);

    // Schedule flush if not already scheduled
    if (this.rafId === null) {
      this.rafId = requestAnimationFrame(() => this.flushPendingUpdates());
    }
  }

  /**
   * PERFORMANCE OPTIMIZATION: Flush all pending tab updates
   * Called once per animation frame to batch multiple streaming events
   * into a single signal update.
   */
  private flushPendingUpdates(): void {
    this.rafId = null;

    // Process all pending updates
    for (const [tabId, state] of this.pendingTabUpdates) {
      // Create shallow copy of state to trigger signal change detection
      // This happens once per frame instead of 100+ times per frame
      this.tabManager.updateTab(tabId, {
        streamingState: { ...state },
      });
    }

    // Clear pending updates
    this.pendingTabUpdates.clear();
  }

  /**
   * Force immediate flush of pending updates
   * Use when you need the UI to update immediately (e.g., before finalization)
   */
  flushUpdatesSync(): void {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    this.flushPendingUpdates();
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

      // 3. Handle by event type
      // TASK_2025_095 FIX: For tool_start and tool_result, check for duplicates BEFORE storing
      // to prevent the bug where we find and delete the event we just stored.
      switch (event.eventType) {
        case 'message_start': {
          // DIAGNOSTIC: Log message_start with parentToolUseId info (JSON.stringify for log file visibility)
          const msgStartEvent = event as MessageStartEvent;
          console.log(
            '[StreamingHandlerService] MESSAGE_START received!',
            JSON.stringify({
              id: event.id,
              messageId: event.messageId,
              parentToolUseId: msgStartEvent.parentToolUseId,
              isNestedAgentMessage: !!msgStartEvent.parentToolUseId,
              role: msgStartEvent.role,
              sessionId: event.sessionId,
              source: event.source,
            })
          );

          // TASK_2025_096 FIX: Track processed messageIds with source priority
          // Check for duplicates BEFORE storing to prevent multiple message_start events
          // for the same messageId, which causes empty message bubbles.
          let sessionMessageIds = this.processedMessageIds.get(event.sessionId);
          if (!sessionMessageIds) {
            sessionMessageIds = new Set<string>();
            this.processedMessageIds.set(event.sessionId, sessionMessageIds);
          }

          // Check if we already have a message_start for this messageId
          const existingMsgStart = this.findMessageStartEvent(
            state,
            event.messageId
          );

          if (existingMsgStart) {
            // We have an existing message_start for this messageId
            // Check if new event should replace it based on source priority
            const existingSource = (
              existingMsgStart as FlatStreamEventUnion & {
                source?: EventSource;
              }
            ).source;

            if (this.shouldReplaceEvent(existingSource, event.source)) {
              // New event has higher priority - remove old, store new
              state.events.delete(existingMsgStart.id);
              // Remove from eventsByMessage (replace array entry)
              const msgEvents =
                state.eventsByMessage.get(event.messageId) || [];
              const filtered = msgEvents.filter(
                (e) => e.id !== existingMsgStart.id
              );
              state.eventsByMessage.set(event.messageId, filtered);

              console.log(
                '[StreamingHandlerService] TASK_2025_096: Replacing message_start with higher priority',
                {
                  oldId: existingMsgStart.id,
                  newId: event.id,
                  messageId: event.messageId,
                  oldSource: existingSource,
                  newSource: event.source,
                }
              );

              // Store new event
              state.events.set(event.id, event);
              this.indexEventByMessage(state, event);
            } else {
              // Existing has higher priority - skip this event
              console.debug(
                '[StreamingHandlerService] TASK_2025_096: Skipping duplicate message_start (lower priority)',
                {
                  messageId: event.messageId,
                  existingSource,
                  newSource: event.source,
                }
              );
              // Still update currentMessageId for streaming continuity
              state.currentMessageId = event.messageId;
              return; // DON'T store this event
            }
          } else {
            // First message_start for this messageId - store it
            sessionMessageIds.add(event.messageId);
            state.messageEventIds.push(event.messageId);

            state.events.set(event.id, event);
            this.indexEventByMessage(state, event);
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

          // Store event
          state.events.set(event.id, event);
          this.indexEventByMessage(state, event);

          const blockIndex = event.blockIndex ?? 0; // Default to 0
          const blockKey = AccumulatorKeys.textBlock(
            event.messageId,
            blockIndex
          );

          // TASK_2025_096 FIX: For 'complete' or 'history' sources, REPLACE text instead of appending.
          // The SDK sends complete assistant messages that should replace streamed content.
          // Previously, duplicate message_start would clear accumulators, but when multiple
          // complete messages arrive with the same messageId (some with text, some without),
          // the tool-only message would clear text that was just added.
          // Now we handle replacement at the text_delta level instead.
          if (event.source === 'complete' || event.source === 'history') {
            // Replace: clear existing and set new value
            state.textAccumulators.set(blockKey, event.delta);
          } else {
            // Stream: append delta
            this.accumulateDelta(state.textAccumulators, blockKey, event.delta);
          }
          break;
        }

        case 'thinking_start': {
          // Store event
          state.events.set(event.id, event);
          this.indexEventByMessage(state, event);
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

          // Store event
          state.events.set(event.id, event);
          this.indexEventByMessage(state, event);

          const blockIndex = event.blockIndex ?? 0; // Default to 0
          const thinkKey = AccumulatorKeys.thinkingBlock(
            event.messageId,
            blockIndex
          );

          // TASK_2025_096 FIX: Same as text_delta - replace instead of append for complete/history
          if (event.source === 'complete' || event.source === 'history') {
            state.textAccumulators.set(thinkKey, event.delta);
          } else {
            this.accumulateDelta(state.textAccumulators, thinkKey, event.delta);
          }
          break;
        }

        case 'tool_start': {
          // DIAGNOSTIC: Log tool_start for Task tools especially (JSON.stringify for log file visibility)
          console.log(
            '[StreamingHandlerService] TOOL_START received!',
            JSON.stringify({
              id: event.id,
              toolName: event.toolName,
              toolCallId: event.toolCallId,
              messageId: event.messageId,
              parentToolUseId: event.parentToolUseId,
              isTaskTool: event.toolName === 'Task',
              isTaskToolFlag: event.isTaskTool,
              sessionId: event.sessionId,
              source: event.source,
            })
          );

          // TASK_2025_095 FIX: Check for duplicates BEFORE storing
          // Previously, the event was stored first, then replaceStreamEventIfNeeded
          // would find and DELETE the event we just stored!
          const existingToolStart = this.replaceStreamEventIfNeeded(
            state,
            event.toolCallId,
            'tool_start',
            event.source
          );

          if (existingToolStart) {
            // Existing event has higher priority, skip this one entirely
            return;
          }

          // NOW store the event (after duplicate check passed)
          state.events.set(event.id, event);
          this.indexEventByMessage(state, event);

          // TASK_2025_085: Deduplicate tool_start events
          // Prevents duplicate agent cards when SDK sends both streaming and complete events
          let sessionToolCallIds = this.processedToolCallIds.get(
            event.sessionId
          );
          if (!sessionToolCallIds) {
            sessionToolCallIds = new Set<string>();
            this.processedToolCallIds.set(event.sessionId, sessionToolCallIds);
          }

          // TASK_2025_095: Only skip if same source priority or lower
          // Allow higher priority sources to replace existing
          if (sessionToolCallIds.has(event.toolCallId)) {
            // Already processed - but we passed the source check above, so this is a replacement
            console.debug(
              '[StreamingHandlerService] Replacing tool_start with higher priority source',
              { toolCallId: event.toolCallId, source: event.source }
            );
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

          // Store event
          state.events.set(event.id, event);
          this.indexEventByMessage(state, event);

          const inputKey = AccumulatorKeys.toolInput(event.toolCallId);
          this.accumulateDelta(
            state.toolInputAccumulators,
            inputKey,
            event.delta
          );
          break;
        }

        case 'tool_result': {
          // DIAGNOSTIC: Log tool_result event reception
          console.log('[StreamingHandlerService] TOOL_RESULT received!', {
            toolCallId: event.toolCallId,
            messageId: event.messageId,
            sessionId: event.sessionId,
            outputLength:
              typeof event.output === 'string' ? event.output.length : 0,
            isError: event.isError,
            source: event.source,
          });

          // TASK_2025_095 FIX: Check for duplicates BEFORE storing
          // Same fix as tool_start - previously the event was stored first,
          // then replaceStreamEventIfNeeded would find and DELETE it!
          const existingToolResult = this.replaceStreamEventIfNeeded(
            state,
            event.toolCallId,
            'tool_result',
            event.source
          );

          if (existingToolResult) {
            // Existing event has higher priority, skip this one entirely
            return;
          }

          // NOW store the event (after duplicate check passed)
          state.events.set(event.id, event);
          this.indexEventByMessage(state, event);
          break;
        }

        case 'agent_start': {
          // TASK_2025_096 FIX: Check for duplicates BEFORE storing
          // This prevents duplicate agents (e.g., one with 'unknown' type from streaming,
          // another with correct type from complete message)
          const existingAgentStart = this.replaceStreamEventIfNeeded(
            state,
            event.toolCallId,
            'agent_start',
            event.source
          );

          if (existingAgentStart) {
            // Existing event has higher priority, skip this one entirely
            console.log(
              '[StreamingHandlerService] AGENT_START skipped (duplicate):',
              {
                skippedId: event.id,
                existingId: existingAgentStart.id,
                toolCallId: event.toolCallId,
                agentType: event.agentType,
              }
            );
            return;
          }

          // NOW store the event (after duplicate check passed)
          state.events.set(event.id, event);
          this.indexEventByMessage(state, event);

          // Agent spawned via Task tool
          // Tree builder will construct agent node from event data
          console.log('[StreamingHandlerService] AGENT_START received!', {
            id: event.id,
            toolCallId: event.toolCallId,
            parentToolUseId: event.parentToolUseId,
            agentType: event.agentType,
            sessionId: event.sessionId,
          });
          break;
        }

        case 'message_complete': {
          // Store event
          state.events.set(event.id, event);
          this.indexEventByMessage(state, event);

          state.currentTokenUsage = event.tokenUsage || null;
          break;
        }

        case 'message_delta': {
          // Store event
          state.events.set(event.id, event);
          this.indexEventByMessage(state, event);

          // Cumulative token usage during streaming - update current usage
          state.currentTokenUsage = event.tokenUsage;
          break;
        }

        case 'signature_delta': {
          // Store event
          state.events.set(event.id, event);
          this.indexEventByMessage(state, event);

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

      // 5. PERFORMANCE OPTIMIZATION: Schedule batched UI update
      // Instead of updating TabManager 100+ times/sec, we batch updates
      // and flush once per animation frame (~60/sec max).
      // This dramatically reduces signal updates and change detection cycles.
      this.scheduleTabUpdate(targetTab.id, state);
    } catch (error) {
      console.error(
        '[StreamingHandlerService] Error processing stream event:',
        error,
        event
      );
    }
  }

  /**
   * Helper to index event by messageId for O(1) lookup.
   * TASK_2025_095: Extracted to share across all event handlers.
   *
   * @param state - Streaming state
   * @param event - Event to index
   */
  private indexEventByMessage(
    state: StreamingState,
    event: FlatStreamEventUnion
  ): void {
    if (event.messageId) {
      const messageEvents = state.eventsByMessage.get(event.messageId) || [];
      messageEvents.push(event);
      state.eventsByMessage.set(event.messageId, messageEvents);
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
    // PERFORMANCE: Flush any pending batched updates before finalization
    // This ensures we have the complete streaming state before building final tree
    this.flushUpdatesSync();

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
    // PERFORMANCE: Use unique cache key for finalization to avoid stale cache
    const cacheKey = `finalize-${targetTabId}-${Date.now()}`;
    const finalTree = this.treeBuilder.buildTree(stateCopy, cacheKey);

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
    // PERFORMANCE: Flush any pending batched updates before finalization
    // This ensures we have the complete streaming state before building final tree
    this.flushUpdatesSync();

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
    // PERFORMANCE: Use unique cache key for history finalization
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
        console.warn(
          '[StreamingHandlerService] No message_start event for messageId',
          { messageId }
        );
        continue;
      }

      // TASK_2025_093 FIX: Skip nested agent messages - they're already inside parent tool's tree
      // Messages with parentToolUseId are sub-agent messages nested within Task tool nodes.
      // They're already rendered as children of the tool node, so adding them as root
      // messages causes duplicate empty bubbles.
      if (messageStartEvent.parentToolUseId) {
        console.debug(
          '[StreamingHandlerService] Skipping nested agent message',
          {
            messageId,
            parentToolUseId: messageStartEvent.parentToolUseId,
          }
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

      // PERFORMANCE: Use batched update for pending stats during streaming
      // Stats updates during streaming don't need immediate UI feedback
      this.scheduleTabUpdate(targetTab.id, state);
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
