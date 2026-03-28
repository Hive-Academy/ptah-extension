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
  UNKNOWN_AGENT_TOOL_CALL_ID,
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
import { PermissionHandlerService } from './permission-handler.service';
import { BackgroundAgentStore } from '../background-agent.store';
import { AgentMonitorStore } from '../agent-monitor.store';

@Injectable({ providedIn: 'root' })
export class StreamingHandlerService {
  private readonly tabManager = inject(TabManagerService);
  private readonly sessionManager = inject(SessionManager);

  // Child services
  private readonly deduplication = inject(EventDeduplicationService);
  private readonly batchedUpdate = inject(BatchedUpdateService);
  private readonly finalization = inject(MessageFinalizationService);
  private readonly permissionHandler = inject(PermissionHandlerService);
  private readonly backgroundAgentStore = inject(BackgroundAgentStore);
  private readonly agentMonitorStore = inject(AgentMonitorStore);

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
    sessionId?: string,
  ): {
    tabId: string;
    queuedContent?: string;
    compactionSessionId?: string;
    compactionComplete?: boolean;
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
            event.sessionId,
          );
          return null;
        }
      }

      // If tab doesn't have claudeSessionId yet, set it and ensure streaming status
      if (targetTab && sessionId && !targetTab.claudeSessionId) {
        this.tabManager.updateTab(targetTab.id, {
          claudeSessionId: sessionId,
          status: 'streaming', // Ensure tab is in streaming state when session starts
        });
      }

      // Initialize streaming state if null
      if (!targetTab.streamingState) {
        this.tabManager.updateTab(targetTab.id, {
          streamingState: createEmptyStreamingState(),
        });
        const refreshedTab = this.tabManager
          .tabs()
          .find((t) => t.id === targetTab?.id);
        if (refreshedTab) {
          targetTab = refreshedTab;
        }
      }

      const state = targetTab.streamingState as StreamingState;

      // Handle by event type
      switch (event.eventType) {
        case 'message_start': {
          const result = this.deduplication.handleDuplicateMessageStart(
            state,
            event,
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
          } else if (
            event.source === 'complete' ||
            event.source === 'history'
          ) {
            // REPLACEMENT: Complete/history message_start replacing a stream one.
            // Clear stale text and thinking accumulators for this messageId.
            // The stream path uses the Anthropic API's event.index (counting ALL
            // content blocks: thinking, text, tool_use) while the complete path
            // may have different indexes (SDK can strip thinking blocks from the
            // content array). Without clearing, both accumulator keys persist
            // and the tree builder creates duplicate text nodes.
            const prefix = `${event.messageId}-block-`;
            const thinkPrefix = `${event.messageId}-thinking-`;
            for (const key of state.textAccumulators.keys()) {
              if (key.startsWith(prefix) || key.startsWith(thinkPrefix)) {
                state.textAccumulators.delete(key);
              }
            }
          }

          state.events.set(event.id, event);
          this.indexEventByMessage(state, event);
          state.currentMessageId = event.messageId;

          // Backfill agent_start parentToolUseId when we see a subagent message_start
          // with a toolu_* format parentToolUseId. Hook-based agent_start events have
          // UUID-format toolCallId/parentToolUseId which doesn't match the tool_start's
          // toolCallId (toolu_* format). This causes the tree builder's primary matching
          // path to fail. By updating the agent_start with the correct toolu_* ID,
          // we fix the correlation at the source.
          if (
            event.parentToolUseId &&
            event.parentToolUseId.startsWith('toolu_')
          ) {
            this.backfillAgentStartToolId(state, event.parentToolUseId);
          }

          break;
        }

        case 'text_delta': {
          if (
            this.deduplication.isMessageAlreadyFinalized(
              event.sessionId,
              event.messageId,
              state,
            )
          ) {
            return null;
          }

          state.events.set(event.id, event);
          this.indexEventByMessage(state, event);

          const blockIndex = event.blockIndex ?? 0;
          const blockKey = AccumulatorKeys.textBlock(
            event.messageId,
            blockIndex,
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
              state,
            )
          ) {
            return null;
          }

          state.events.set(event.id, event);
          this.indexEventByMessage(state, event);

          const blockIndex = event.blockIndex ?? 0;
          const thinkKey = AccumulatorKeys.thinkingBlock(
            event.messageId,
            blockIndex,
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
              event.source,
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
          state.toolCallMap.get(event.toolCallId)?.push(event.id);
          break;
        }

        case 'tool_delta': {
          if (
            this.deduplication.isToolAlreadyFinalized(
              event.sessionId,
              event.toolCallId,
              state,
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
            event.delta,
          );
          break;
        }

        case 'tool_result': {
          const existingToolResult =
            this.deduplication.replaceStreamEventIfNeeded(
              state,
              event.toolCallId,
              'tool_result',
              event.source,
            );

          if (existingToolResult) {
            return null;
          }

          state.events.set(event.id, event);
          this.indexEventByMessage(state, event);
          break;
        }

        case 'agent_start': {
          // TASK_2025_126_FIX: Use agentId for deduplication (stable across hook and complete)
          // Hook sends UUID-format toolCallId, complete sends toolu_* format - they don't match!
          // agentId (e.g., "adcecb2") is stable and present in both sources.
          const existingByAgentId =
            this.deduplication.replaceAgentStartByAgentId(
              state,
              event.agentId,
              event.source,
            );

          if (existingByAgentId) {
            console.log(
              '[StreamingHandler] Skipping duplicate agent_start (by agentId):',
              {
                agentId: event.agentId,
                toolCallId: event.toolCallId,
                source: event.source,
              },
            );
            return null;
          }

          // Fallback: Also check by toolCallId for events without agentId
          const existingByToolCallId =
            this.deduplication.replaceStreamEventIfNeeded(
              state,
              event.toolCallId,
              'agent_start',
              event.source,
            );

          if (existingByToolCallId) {
            console.log(
              '[StreamingHandler] Skipping duplicate agent_start (by toolCallId):',
              {
                toolCallId: event.toolCallId,
                source: event.source,
              },
            );
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
            agentId: event.agentId,
            agentType: event.agentType,
          });

          // TASK_2025_211: Detect SDK subagent resume — if a new agent of the
          // same type as a previously interrupted agent is spawned, mark the old
          // agent type as "resumed" so inline bubbles update their badge.
          if (event.agentType) {
            this.detectAndMarkResumedAgent(event.agentType, targetTab);
          }

          const pendingDeltas = this.sessionManager.registerAgent(
            event.toolCallId,
            preliminaryAgentNode,
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
              event.toolCallId,
            );
          }
          break;
        }

        case 'message_complete': {
          state.events.set(event.id, event);
          this.indexEventByMessage(state, event);

          state.currentTokenUsage = event.tokenUsage || null;

          // Check for queued content to auto-send — but ONLY on root-level messages.
          // Sub-agent messages have parentToolUseId set; triggering re-steer on sub-agent
          // message_complete would immediately interrupt the sub-agent mid-execution.
          // Queued content should wait for the main agent's turn to complete (handled
          // either by a root message_complete or by handleSessionStats).
          if (!event.parentToolUseId) {
            const queuedContent = targetTab.queuedContent;
            if (queuedContent && queuedContent.trim()) {
              this.batchedUpdate.scheduleUpdate(targetTab.id, state);
              return { tabId: targetTab.id, queuedContent };
            }
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
            { sessionId: event.sessionId, trigger: event.trigger },
          );

          // Return compaction info for ChatStore to handle (avoid circular dependency)
          return { tabId: targetTab.id, compactionSessionId: event.sessionId };
        }

        case 'compaction_complete': {
          // Compaction finished: reset streaming state and deduplication for clean slate
          console.log(
            '[StreamingHandlerService] Compaction complete, resetting streaming state',
            {
              sessionId: event.sessionId,
              trigger: event.trigger,
              preTokens: event.preTokens,
            },
          );

          // Reset streaming state to fresh - pre-compaction events are stale
          this.tabManager.updateTab(targetTab.id, {
            streamingState: createEmptyStreamingState(),
          });

          // Clear deduplication state across compaction boundary
          this.deduplication.cleanupSession(event.sessionId);

          return {
            tabId: targetTab.id,
            compactionComplete: true,
            compactionSessionId: event.sessionId,
          };
        }

        case 'background_agent_started':
          this.backgroundAgentStore.onStarted(event);
          break;
        case 'background_agent_progress':
          this.backgroundAgentStore.onProgress(event);
          break;
        case 'background_agent_completed':
          this.backgroundAgentStore.onCompleted(event);
          break;
        case 'background_agent_stopped':
          this.backgroundAgentStore.onStopped(event);
          break;

        default:
          assertNever(
            event,
            `Unhandled event type: ${(event as FlatStreamEventUnion).eventType}`,
          );
      }

      // Schedule batched UI update
      this.batchedUpdate.scheduleUpdate(targetTab.id, state);

      // Structural events that change the execution tree layout must flush immediately.
      // In VS Code webviews, requestAnimationFrame can be throttled/delayed when the
      // webview isn't actively rendering. Without an immediate flush, agent_start events
      // stay invisible until an unrelated signal update (e.g. permission request) forces
      // Angular change detection.
      if (event.eventType === 'agent_start') {
        this.batchedUpdate.flushSync();
      }

      return null;
    } catch (error) {
      console.error(
        '[StreamingHandlerService] Error processing stream event:',
        error,
        event,
      );
      return null;
    }
  }

  /**
   * Backfill agent_start events with the correct toolu_* format parentToolUseId.
   *
   * Hook-based agent_start events arrive with UUID-format toolCallId/parentToolUseId
   * because the SDK SubagentStart hook only provides a UUID. When the first stream
   * message_start arrives from the subagent, it carries parentToolUseId in toolu_*
   * format (the actual Anthropic API tool_use ID). This method finds the corresponding
   * hook-based agent_start and replaces it with an updated copy carrying the correct ID.
   *
   * This fixes the tree builder's primary matching path:
   *   tool_start.toolCallId (toolu_*) === agent_start.parentToolUseId (toolu_*)
   */
  private backfillAgentStartToolId(
    state: StreamingState,
    tooluParentToolUseId: string,
  ): void {
    // Find a hook-based agent_start with UUID-format toolCallId (not toolu_*)
    // that hasn't been backfilled yet
    for (const [eventId, evt] of state.events) {
      if (
        evt.eventType === 'agent_start' &&
        evt.source === 'hook' &&
        evt.toolCallId &&
        !evt.toolCallId.startsWith('toolu_')
      ) {
        // Check if this agent_start has already been backfilled
        // (i.e., another message_start already updated it)
        const alreadyBackfilled = [...state.events.values()].some(
          (e) =>
            e.eventType === 'agent_start' &&
            e.parentToolUseId === tooluParentToolUseId,
        );
        if (alreadyBackfilled) {
          return; // Already have an agent_start with this toolu_* ID
        }

        // Replace the event with an updated copy carrying the correct toolu_* ID
        const updatedEvent = {
          ...evt,
          toolCallId: tooluParentToolUseId,
          parentToolUseId: tooluParentToolUseId,
        };
        state.events.set(eventId, updatedEvent as FlatStreamEventUnion);

        console.log(
          '[StreamingHandler] Backfilled agent_start with toolu_* ID:',
          {
            agentId: (evt as { agentId?: string }).agentId,
            oldToolCallId: evt.toolCallId,
            newToolCallId: tooluParentToolUseId,
          },
        );
        return; // Only backfill one agent_start per message_start
      }
    }
  }

  /**
   * Helper to index event by messageId for O(1) lookup.
   */
  private indexEventByMessage(
    state: StreamingState,
    event: FlatStreamEventUnion,
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
    delta: string,
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
   *
   * @param tabId - Tab ID to finalize
   * @param resumableSubagents - Optional array of resumable subagent records from backend (TASK_2025_103)
   */
  finalizeSessionHistory(
    tabId: string,
    resumableSubagents?: import('@ptah-extension/shared').SubagentRecord[],
  ): ExecutionChatMessage[] {
    return this.finalization.finalizeSessionHistory(tabId, resumableSubagents);
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
          '[StreamingHandlerService] No target tab found for session stats',
        );
        return null;
      }
    }

    const targetTabId = targetTab.id;

    // Finalize streaming tab when stats arrive
    // Also finalize if tab has streamingState but status is 'loaded' (race condition safety net:
    // when a session restarts on the same tab, status may not transition to 'streaming')
    if (
      targetTab.streamingState &&
      (targetTab.status === 'streaming' || targetTab.status === 'loaded')
    ) {
      const state = targetTab.streamingState;

      state.pendingStats = {
        cost: stats.cost,
        tokens: stats.tokens,
        duration: stats.duration,
      };

      const queuedContent = targetTab.queuedContent;

      // TASK_2025_213: Check if hard permission deny occurred — now returns specific toolUseIds
      const hardDenyToolUseIds =
        this.permissionHandler.consumeHardDenyToolUseIds();

      console.log(
        '[StreamingHandlerService] Finalizing streaming on stats received for tab:',
        targetTabId,
        { hardDenyToolUseIds: [...hardDenyToolUseIds] },
      );
      this.finalization.finalizeCurrentMessage(targetTabId);

      // For hard deny: the SDK sends all completion events before exiting,
      // so markStreamingNodesAsInterrupted (used by isAborted) finds nothing
      // to change. Instead, post-process the finalized message to mark the
      // specific denied agent node(s) as interrupted.
      if (hardDenyToolUseIds.size > 0) {
        if (hardDenyToolUseIds.has(UNKNOWN_AGENT_TOOL_CALL_ID)) {
          // Fallback: no specific agentToolCallId available, mark last agent (legacy behavior)
          this.finalization.markLastAgentAsInterrupted(targetTabId);
        }

        // Targeted: mark only the specific denied agent(s) by their toolCallIds (excluding sentinel)
        const specificIds = new Set(
          [...hardDenyToolUseIds].filter(
            (id) => id !== UNKNOWN_AGENT_TOOL_CALL_ID,
          ),
        );
        if (specificIds.size > 0) {
          this.finalization.markAgentsAsInterruptedByToolCallIds(
            targetTabId,
            specificIds,
          );
        }
      }

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
        '[StreamingHandlerService] Stats stored as pendingStats (tab has streamingState but no messages)',
      );
      return null;
    }

    if (messages.length === 0) {
      console.log(
        '[StreamingHandlerService] No messages in tab, stats discarded',
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
        '[StreamingHandlerService] No assistant message found, stats discarded',
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
      '[StreamingHandlerService] Stats applied to last assistant message',
    );
    return null;
  }

  /**
   * TASK_2025_211: Check if there's a previously interrupted agent of the same
   * agentType in the tab's finalized messages. If so, mark those SPECIFIC
   * agent node IDs as "resumed" in the AgentMonitorStore.
   *
   * Tracks by node ID (not agentType) to avoid false positives when multiple
   * agents of the same type exist — only the specific interrupted agent(s)
   * that were superseded show "Resumed", not newly interrupted ones.
   */
  private detectAndMarkResumedAgent(agentType: string, tab: TabState): void {
    const interruptedNodeIds: string[] = [];

    // Collect IDs of all interrupted agents of the same type in finalized messages
    for (const msg of tab.messages) {
      if (!msg.streamingState) continue;
      // msg.streamingState is an ExecutionNode tree (finalized)
      this.collectInterruptedAgentIds(
        msg.streamingState,
        agentType,
        interruptedNodeIds,
      );
    }

    if (interruptedNodeIds.length > 0) {
      this.agentMonitorStore.markAgentNodesResumed(interruptedNodeIds);
    }
  }

  /**
   * Recursively collect node IDs (id + toolCallId) of interrupted agents
   * matching the given agentType.
   */
  private collectInterruptedAgentIds(
    node: ExecutionNode,
    agentType: string,
    out: string[],
  ): void {
    if (
      node.type === 'agent' &&
      node.status === 'interrupted' &&
      node.agentType === agentType
    ) {
      out.push(node.id);
      if (node.toolCallId) out.push(node.toolCallId);
    }
    for (const child of node.children) {
      this.collectInterruptedAgentIds(child, agentType, out);
    }
  }
}
