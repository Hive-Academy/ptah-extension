/**
 * StreamingHandlerService - Flat Event Storage and Processing
 *
 * Refactored to delegate to child services for better maintainability:
 * - EventDeduplicationService: Source priority and duplicate checking
 * - BatchedUpdateService: RAF-based batched UI updates
 * - MessageFinalizationService: Finalize streaming messages to chat messages
 *
 * This service handles:
 * - Processing flat streaming events from SDK
 * - Storing events in StreamingState maps
 * - Coordinating between child services
 */

import { Injectable, inject } from '@angular/core';
import {
  ExecutionNode,
  FlatStreamEventUnion,
  assertNever,
  ExecutionChatMessage,
} from '@ptah-extension/shared';
import { TabManagerService } from '../tab-manager.service';
import { SessionManager } from '../session-manager.service';
import {
  TabState,
  createEmptyStreamingState,
  StreamingState,
  AccumulatorKeys,
} from '../chat.types';

// Child services
import { EventDeduplicationService } from './event-deduplication.service';
import { BatchedUpdateService } from './batched-update.service';
import { MessageFinalizationService } from './message-finalization.service';

@Injectable({ providedIn: 'root' })
export class StreamingHandlerService {
  private readonly tabManager = inject(TabManagerService);
  private readonly sessionManager = inject(SessionManager);

  // Child services
  private readonly deduplication = inject(EventDeduplicationService);
  private readonly batchedUpdate = inject(BatchedUpdateService);
  private readonly finalization = inject(MessageFinalizationService);

  /**
   * Clean up deduplication state for a session.
   * MUST be called when closing/deleting a session to prevent memory leaks.
   */
  cleanupSessionDeduplication(sessionId: string): void {
    this.deduplication.cleanupSession(sessionId);
  }

  /**
   * Force immediate flush of pending updates
   * Use when you need the UI to update immediately (e.g., before finalization)
   */
  flushUpdatesSync(): void {
    this.batchedUpdate.flushSync();
  }

  /**
   * Process flat streaming event from SDK
   *
   * Stores events in flat Maps instead of building ExecutionNode trees.
   * Tree building is deferred to render time.
   *
   * @param event - The flat streaming event from SDK
   * @param tabId - Optional tab ID for direct routing (preferred)
   * @param sessionId - Optional real SDK UUID for session linking
   * @returns Event result info for ChatStore to handle, null otherwise
   */
  processStreamEvent(
    event: FlatStreamEventUnion,
    tabId?: string,
    sessionId?: string
  ): {
    tabId: string;
    queuedContent?: string;
    compactionSessionId?: string;
  } | null {
    try {
      // Find target tab
      let targetTab: TabState | undefined;

      // Primary: Use tabId for direct routing
      if (tabId) {
        targetTab = this.tabManager.tabs().find((t) => t.id === tabId);
      }

      // Fallback: Find target tab by event.sessionId
      if (!targetTab) {
        targetTab =
          this.tabManager.findTabBySessionId(event.sessionId) ?? undefined;
      }

      // If no tab found, check if active tab needs session ID initialization
      if (!targetTab) {
        const activeTab = this.tabManager.activeTab();

        if (
          activeTab &&
          !activeTab.claudeSessionId &&
          (activeTab.status === 'fresh' ||
            activeTab.status === 'streaming' ||
            activeTab.status === 'draft')
        ) {
          const realSessionId = sessionId || event.sessionId;

          this.tabManager.updateTab(activeTab.id, {
            claudeSessionId: realSessionId,
            status: 'streaming',
          });

          this.sessionManager.setSessionId(realSessionId);
          this.sessionManager.setStatus('streaming');

          targetTab = this.tabManager.activeTab() ?? undefined;
        }

        if (!targetTab) {
          console.warn(
            '[StreamingHandlerService] No target tab for event',
            event.sessionId
          );
          return null;
        }
      }

      // If tab doesn't have claudeSessionId yet, set it
      if (targetTab && sessionId && !targetTab.claudeSessionId) {
        this.tabManager.updateTab(targetTab.id, { claudeSessionId: sessionId });
      }

      // Initialize streaming state if null
      if (!targetTab.streamingState) {
        this.tabManager.updateTab(targetTab.id, {
          streamingState: createEmptyStreamingState(),
        });
        targetTab = this.tabManager.tabs().find((t) => t.id === targetTab!.id)!;
      }

      const state = targetTab.streamingState!;

      // Handle by event type
      switch (event.eventType) {
        case 'message_start': {
          const result = this.deduplication.handleDuplicateMessageStart(
            state,
            event
          );

          if (result.skip) {
            state.currentMessageId = event.messageId;
            return null;
          }

          if (!result.existingEvent) {
            // First message_start for this messageId
            this.deduplication
              .getProcessedMessageIds(event.sessionId)
              .add(event.messageId);
            state.messageEventIds.push(event.messageId);
          }

          state.events.set(event.id, event);
          this.indexEventByMessage(state, event);
          state.currentMessageId = event.messageId;
          break;
        }

        case 'text_delta': {
          if (
            this.deduplication.isMessageAlreadyFinalized(
              event.sessionId,
              event.messageId,
              state
            )
          ) {
            return null;
          }

          state.events.set(event.id, event);
          this.indexEventByMessage(state, event);

          const blockIndex = event.blockIndex ?? 0;
          const blockKey = AccumulatorKeys.textBlock(
            event.messageId,
            blockIndex
          );

          if (event.source === 'complete' || event.source === 'history') {
            state.textAccumulators.set(blockKey, event.delta);
          } else {
            this.accumulateDelta(state.textAccumulators, blockKey, event.delta);
          }
          break;
        }

        case 'thinking_start': {
          state.events.set(event.id, event);
          this.indexEventByMessage(state, event);
          break;
        }

        case 'thinking_delta': {
          if (
            this.deduplication.isMessageAlreadyFinalized(
              event.sessionId,
              event.messageId,
              state
            )
          ) {
            return null;
          }

          state.events.set(event.id, event);
          this.indexEventByMessage(state, event);

          const blockIndex = event.blockIndex ?? 0;
          const thinkKey = AccumulatorKeys.thinkingBlock(
            event.messageId,
            blockIndex
          );

          if (event.source === 'complete' || event.source === 'history') {
            state.textAccumulators.set(thinkKey, event.delta);
          } else {
            this.accumulateDelta(state.textAccumulators, thinkKey, event.delta);
          }
          break;
        }

        case 'tool_start': {
          const existingToolStart =
            this.deduplication.replaceStreamEventIfNeeded(
              state,
              event.toolCallId,
              'tool_start',
              event.source
            );

          if (existingToolStart) {
            return null;
          }

          state.events.set(event.id, event);
          this.indexEventByMessage(state, event);

          this.deduplication
            .getProcessedToolCallIds(event.sessionId)
            .add(event.toolCallId);

          if (!state.toolCallMap.has(event.toolCallId)) {
            state.toolCallMap.set(event.toolCallId, []);
          }
          state.toolCallMap.get(event.toolCallId)!.push(event.id);
          break;
        }

        case 'tool_delta': {
          if (
            this.deduplication.isToolAlreadyFinalized(
              event.sessionId,
              event.toolCallId,
              state
            )
          ) {
            return null;
          }

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
          const existingToolResult =
            this.deduplication.replaceStreamEventIfNeeded(
              state,
              event.toolCallId,
              'tool_result',
              event.source
            );

          if (existingToolResult) {
            return null;
          }

          state.events.set(event.id, event);
          this.indexEventByMessage(state, event);
          break;
        }

        case 'agent_start': {
          const existingAgentStart =
            this.deduplication.replaceStreamEventIfNeeded(
              state,
              event.toolCallId,
              'agent_start',
              event.source
            );

          if (existingAgentStart) {
            return null;
          }

          state.events.set(event.id, event);
          this.indexEventByMessage(state, event);

          // Register agent with SessionManager
          const preliminaryAgentNode: ExecutionNode = {
            id: event.id,
            type: 'agent',
            status: 'streaming',
            content: event.agentDescription || '',
            children: [],
            agentType: event.agentType,
            agentDescription: event.agentDescription,
            toolCallId: event.toolCallId,
            startTime: event.timestamp,
            isCollapsed: false,
          };

          console.log('[StreamingHandler] Registering agent node:', {
            eventType: event.eventType,
            eventSource: event.source,
            toolCallId: event.toolCallId,
            agentType: event.agentType,
          });

          const pendingDeltas = this.sessionManager.registerAgent(
            event.toolCallId,
            preliminaryAgentNode
          );

          if (pendingDeltas.length > 0) {
            const summaryContent = pendingDeltas.join('');
            const updatedNode: ExecutionNode = {
              ...preliminaryAgentNode,
              summaryContent,
            };
            this.sessionManager.registerAgent(event.toolCallId, updatedNode);
            console.log(
              `[StreamingHandler] Applied ${pendingDeltas.length} pending chunks to agent:`,
              event.toolCallId
            );
          }
          break;
        }

        case 'message_complete': {
          state.events.set(event.id, event);
          this.indexEventByMessage(state, event);

          state.currentTokenUsage = event.tokenUsage || null;

          // Check for queued content to auto-send
          const queuedContent = targetTab.queuedContent;
          if (queuedContent && queuedContent.trim()) {
            this.batchedUpdate.scheduleUpdate(targetTab.id, state);
            return { tabId: targetTab.id, queuedContent };
          }
          break;
        }

        case 'message_delta': {
          state.events.set(event.id, event);
          this.indexEventByMessage(state, event);
          state.currentTokenUsage = event.tokenUsage;
          break;
        }

        case 'signature_delta': {
          state.events.set(event.id, event);
          this.indexEventByMessage(state, event);
          break;
        }

        case 'compaction_start': {
          // TASK_2025_098: Unified compaction flow
          // Compaction events now flow through CHAT_CHUNK (same as all streaming events)
          // Return compaction info so ChatStore can call handleCompactionStart()
          console.log(
            '[StreamingHandlerService] Compaction event received via streaming path',
            { sessionId: event.sessionId, trigger: event.trigger }
          );

          // Return compaction info for ChatStore to handle (avoid circular dependency)
          return { tabId: targetTab.id, compactionSessionId: event.sessionId };
        }

        default:
          assertNever(
            event,
            `Unhandled event type: ${(event as FlatStreamEventUnion).eventType}`
          );
      }

      // Schedule batched UI update
      this.batchedUpdate.scheduleUpdate(targetTab.id, state);
      return null;
    } catch (error) {
      console.error(
        '[StreamingHandlerService] Error processing stream event:',
        error,
        event
      );
      return null;
    }
  }

  /**
   * Helper to index event by messageId for O(1) lookup.
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
   * Finalize the current streaming message
   * Delegates to MessageFinalizationService
   */
  finalizeCurrentMessage(tabId?: string, isAborted = false): void {
    this.finalization.finalizeCurrentMessage(tabId, isAborted);
  }

  /**
   * Finalize session history - builds messages for ALL messages in streaming state
   * Delegates to MessageFinalizationService
   */
  finalizeSessionHistory(tabId: string): ExecutionChatMessage[] {
    return this.finalization.finalizeSessionHistory(tabId);
  }

  /**
   * Handle session stats update from backend
   *
   * TASK_2025_101: SESSION_STATS is the authoritative signal that streaming has completed.
   */
  handleSessionStats(stats: {
    sessionId: string;
    cost: number;
    tokens: { input: number; output: number };
    duration: number;
  }): { tabId: string; queuedContent: string | null } | null {
    console.log('[StreamingHandlerService] Session stats received:', stats);

    let targetTab = this.tabManager.findTabBySessionId(stats.sessionId);

    // Fallback to active tab if no tab found
    if (!targetTab) {
      const activeTab = this.tabManager.activeTab();

      if (
        activeTab &&
        !activeTab.claudeSessionId &&
        (activeTab.status === 'fresh' ||
          activeTab.status === 'streaming' ||
          activeTab.status === 'draft')
      ) {
        this.tabManager.updateTab(activeTab.id, {
          claudeSessionId: stats.sessionId,
        });
        this.sessionManager.setSessionId(stats.sessionId);
        targetTab = activeTab;
      } else if (
        activeTab &&
        (activeTab.status === 'streaming' || activeTab.status === 'loaded')
      ) {
        targetTab = activeTab;
      }

      if (!targetTab) {
        console.warn(
          '[StreamingHandlerService] No target tab found for session stats'
        );
        return null;
      }
    }

    const targetTabId = targetTab.id;

    // Finalize streaming tab when stats arrive
    if (targetTab.streamingState && targetTab.status === 'streaming') {
      const state = targetTab.streamingState;

      state.pendingStats = {
        cost: stats.cost,
        tokens: stats.tokens,
        duration: stats.duration,
      };

      const queuedContent = targetTab.queuedContent;

      console.log(
        '[StreamingHandlerService] Finalizing streaming on stats received for tab:',
        targetTabId
      );
      this.finalization.finalizeCurrentMessage(targetTabId);

      this.tabManager.markTabIdle(targetTabId);

      return { tabId: targetTabId, queuedContent: queuedContent ?? null };
    }

    // Handle stats for tabs that are already loaded
    const messages = targetTab.messages;

    if (messages.length === 0 && targetTab.streamingState) {
      const state = targetTab.streamingState;
      state.pendingStats = {
        cost: stats.cost,
        tokens: stats.tokens,
        duration: stats.duration,
      };
      this.batchedUpdate.scheduleUpdate(targetTab.id, state);
      console.log(
        '[StreamingHandlerService] Stats stored as pendingStats (tab has streamingState but no messages)'
      );
      return null;
    }

    if (messages.length === 0) {
      console.log(
        '[StreamingHandlerService] No messages in tab, stats discarded'
      );
      return null;
    }

    // Find the last assistant message
    let lastAssistantIndex = -1;
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === 'assistant') {
        lastAssistantIndex = i;
        break;
      }
    }

    if (lastAssistantIndex === -1) {
      console.log(
        '[StreamingHandlerService] No assistant message found, stats discarded'
      );
      return null;
    }

    // Update the assistant message with stats
    const updatedMessages = [...messages];
    updatedMessages[lastAssistantIndex] = {
      ...messages[lastAssistantIndex],
      tokens: stats.tokens,
      cost: stats.cost,
      duration: stats.duration,
    };

    this.tabManager.updateTab(targetTab.id, {
      messages: updatedMessages,
    });

    console.log(
      '[StreamingHandlerService] Stats applied to last assistant message'
    );
    return null;
  }
}
