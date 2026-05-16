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
  ExecutionChatMessage,
  SessionId,
  UNKNOWN_AGENT_TOOL_CALL_ID,
} from '@ptah-extension/shared';
import { TabManagerService } from '@ptah-extension/chat-state';
import { SessionManager } from './session-manager.service';
import {
  TabState,
  createEmptyStreamingState,
  StreamingState,
} from '@ptah-extension/chat-types';

// Child services
import { EventDeduplicationService } from './event-deduplication.service';
import { BatchedUpdateService } from './batched-update.service';
import { MessageFinalizationService } from './message-finalization.service';
import { PermissionHandlerService } from './permission-handler.service';
import { BackgroundAgentStore } from './background-agent.store';
import { AgentMonitorStore } from './agent-monitor.store';
import {
  StreamingAccumulatorCore,
  type AccumulatorContext,
} from './accumulator-core.service';

@Injectable({ providedIn: 'root' })
export class StreamingHandlerService {
  // TabManager is eagerly injected — the lazy `Injector.get(TabManagerService)`
  // band-aid is gone because the STREAMING_CONTROL inversion that caused the
  // cycle has been removed. TabManager no longer reaches back into streaming/
  // agent code, so the `StreamingHandler → TabManager` arrow is now a
  // single-direction edge and DI bootstrap completes without NG0200.
  private readonly tabManager = inject(TabManagerService);
  private readonly sessionManager = inject(SessionManager);

  /**
   * Tracks session IDs that have already been warned about missing target tab
   * to avoid repeated console.warn spam during streaming rebuilds.
   */
  private readonly warnedNoTargetSessions = new Set<string>();

  // Child services
  private readonly deduplication = inject(EventDeduplicationService);
  private readonly batchedUpdate = inject(BatchedUpdateService);
  private readonly finalization = inject(MessageFinalizationService);
  private readonly permissionHandler = inject(PermissionHandlerService);
  private readonly backgroundAgentStore = inject(BackgroundAgentStore);
  private readonly agentMonitorStore = inject(AgentMonitorStore);
  // The event-type switch lives in the core. The wrapper retains the
  // chat-shaped tab fan-out, queued-content surfacing, and batched-update
  // scheduling.
  private readonly accumulatorCore = inject(StreamingAccumulatorCore);

  /**
   * Clean up deduplication state for a session.
   * MUST be called when closing/deleting a session to prevent memory leaks.
   */
  cleanupSessionDeduplication(sessionId: string): void {
    this.deduplication.cleanupSession(sessionId);
    this.accumulatorCore.clearPendingClears();
    this.warnedNoTargetSessions.delete(sessionId);
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
      // Resolve the primary target tab (and any additional bound tabs for
      // multi-tab fan-out).
      let primaryTab: TabState | undefined;

      // Primary: Use tabId for direct routing
      if (tabId) {
        primaryTab = this.tabManager.tabs().find((t) => t.id === tabId);
      }

      // Fallback: Find target tab by event.sessionId.
      // Use the plural lookup so streaming updates fan out to all tabs
      // bound to the conversation (canvas-grid scenario).
      // The plural method falls back to the legacy singular result when no
      // conversation binding exists yet, so the not-yet-migrated path stays
      // identical. The first bound tab is used as `primaryTab` to preserve
      // the legacy return-value semantics; the multi-tab fan-out below
      // (using `findTabsBySessionId` again at line ~191) then visits every
      // bound tab including secondaries.
      if (!primaryTab) {
        const bound = this.tabManager.findTabsBySessionId(
          SessionId.from(event.sessionId),
        );
        primaryTab = bound.length > 0 ? bound[0] : undefined;
      }

      // If no tab found and no tabId was provided, initialize active empty tab.
      // Only do this when tabId is absent (legitimate first event for a brand-new session).
      // If tabId WAS provided but the tab wasn't found, don't hijack an unrelated empty tab.
      if (!primaryTab && !tabId) {
        const activeTab = this.tabManager.activeTab();

        if (
          activeTab &&
          !activeTab.claudeSessionId &&
          (activeTab.status === 'fresh' ||
            activeTab.status === 'streaming' ||
            activeTab.status === 'draft')
        ) {
          const realSessionId = sessionId || event.sessionId;

          // `adoptStreamingSession` retired.
          // Same effect, narrower contract: attach the session id, then
          // transition status to `streaming`. The StreamRouter (which
          // observes the upstream `routeStreamEvent` call) is responsible
          // for binding this tab to the conversation containing
          // `realSessionId`.
          this.tabManager.attachSession(activeTab.id, realSessionId);
          this.tabManager.markStreaming(activeTab.id);

          this.sessionManager.setSessionId(realSessionId);
          this.sessionManager.setStatus('streaming');

          primaryTab = this.tabManager.activeTab() ?? undefined;
        }
      }

      if (!primaryTab) {
        if (!this.warnedNoTargetSessions.has(event.sessionId)) {
          this.warnedNoTargetSessions.add(event.sessionId);
          console.warn(
            '[StreamingHandlerService] No target tab for event',
            event.sessionId,
            tabId ? `(tabId: ${tabId} not found)` : '(no tabId provided)',
          );
        }
        return null;
      }

      // Multi-tab fan-out.
      //
      // Once the primary tab has its claudeSessionId attached (via the
      // attachSession + markStreaming block above for fresh tabs, or via
      // prior routing for already-bound tabs), look up every OTHER tab
      // bound to the same conversation and fan the event out to each.
      //
      // We process the primary tab first to preserve the legacy single-tab
      // return-value semantics (queuedContent / compaction signals come from
      // the primary tab; secondary tabs' state still updates but their
      // signals are dropped — the chat store handles conversation-level
      // signals exactly once).
      const primaryResult = this.processEventForTab(
        primaryTab,
        event,
        sessionId,
      );

      // Find additional tabs bound to the same session (excluding primary).
      // findTabsBySessionId uses the conversation registry; it falls back to
      // the legacy single-tab lookup when no binding exists yet, so the
      // returned array always includes the primary tab in well-formed cases.
      const allBoundTabs = this.tabManager.findTabsBySessionId(
        SessionId.from(event.sessionId),
      );
      if (allBoundTabs.length > 1) {
        for (const otherTab of allBoundTabs) {
          if (otherTab.id === primaryTab.id) continue;
          // Process for the secondary tab. Discard the result — conversation-
          // level signals (queuedContent, compaction) are already captured
          // from the primary tab. The per-tab state writes still happen,
          // which is the whole point of fan-out.
          this.processEventForTab(otherTab, event, sessionId);
        }
      }

      return primaryResult;
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
   * Process a single stream event against ONE target tab's streaming state.
   *
   * Extracted from `processStreamEvent` so the outer method can fan an
   * incoming event out to every tab bound to the
   * same conversation (canvas-grid scenario). All per-tab side effects
   * (state writes, batched-update scheduling, tabManager state mutations)
   * happen here; the caller decides which tabs get visited and which return
   * value to surface.
   *
   * Conversation-level state (deduplication keyed by sessionId, agent
   * registration, background-agent store) is intentionally still mutated
   * inside this method. It is per-session by design and idempotent under
   * repeated calls — calling for two tabs bound to one session adds the
   * dedup entry on the first call and no-ops on the second.
   */
  private processEventForTab(
    initialTab: TabState,
    event: FlatStreamEventUnion,
    sessionId?: string,
  ): {
    tabId: string;
    queuedContent?: string;
    compactionSessionId?: string;
    compactionComplete?: boolean;
  } | null {
    let targetTab = initialTab;

    // If tab doesn't have claudeSessionId yet, set it and ensure streaming status.
    // `adoptStreamingSession` retired in favour of narrower `attachSession`
    // + `markStreaming` calls. Same observable effect; behavior unchanged.
    if (sessionId && !targetTab.claudeSessionId) {
      this.tabManager.attachSession(targetTab.id, sessionId);
      this.tabManager.markStreaming(targetTab.id);
    }

    // Initialize streaming state if null
    if (!targetTab.streamingState) {
      this.tabManager.setStreamingState(
        targetTab.id,
        createEmptyStreamingState(),
      );
      const refreshedTab = this.tabManager
        .tabs()
        .find((t) => t.id === targetTab.id);
      if (refreshedTab) {
        targetTab = refreshedTab;
      }
    }

    const state = targetTab.streamingState as StreamingState;

    // Delegate the event-type switch to the core.
    // The wrapper handles the chat-shaped tail (queued-content surfacing on
    // `message_complete`, compaction-state replacement on
    // `compaction_complete`, batched-update scheduling, agent_start
    // force-flush) below.
    const ctx: AccumulatorContext = {
      sessionManager: this.sessionManager,
      deduplication: this.deduplication,
      batchedUpdate: this.batchedUpdate,
      backgroundAgentStore: this.backgroundAgentStore,
      agentMonitorStore: this.agentMonitorStore,
      // Chat reads `tab.messages` to detect resumed agents of the same
      // agentType. Surfaces have no finalized messages; the hook is
      // supplied by chat only.
      onAgentStart: (evt) => {
        if (evt.agentType) {
          this.detectAndMarkResumedAgent(evt.agentType, targetTab);
        }
      },
    };

    const result = this.accumulatorCore.process(state, event, ctx);

    // Compaction lifecycle: the core surfaces both edges via flags so the
    // chat wrapper can return its legacy { compactionSessionId, ... } shape
    // without re-implementing the switch.
    if (result.compactionStart) {
      // Unified compaction flow — caller consumes compactionSessionId
      // to invoke handleCompactionStart on ChatStore.
      return { tabId: targetTab.id, compactionSessionId: event.sessionId };
    }
    if (result.compactionComplete && result.replacementState) {
      // The core cleared dedup; we install the replacement state via the
      // tab manager so signal observers see the swap.
      this.tabManager.setStreamingState(targetTab.id, result.replacementState);
      return {
        tabId: targetTab.id,
        compactionComplete: true,
        compactionSessionId: event.sessionId,
      };
    }

    // Queued-content surfacing on root-level `message_complete`. Sub-agent
    // messages have parentToolUseId set; triggering re-steer on a sub-agent
    // would interrupt the sub-agent mid-execution. Queued content waits for
    // the main agent's turn to complete (via root message_complete or
    // handleSessionStats).
    if (
      result.eventType === 'message_complete' &&
      !(event as FlatStreamEventUnion & { eventType: 'message_complete' })
        .parentToolUseId
    ) {
      const queuedContent = targetTab.queuedContent;
      if (queuedContent && queuedContent.trim()) {
        this.batchedUpdate.scheduleUpdate(targetTab.id, state);
        return { tabId: targetTab.id, queuedContent };
      }
    }

    // Schedule batched UI update for any state mutation.
    if (result.stateMutated) {
      this.batchedUpdate.scheduleUpdate(targetTab.id, state);
    }

    // Structural events that change the execution tree layout must flush
    // immediately. In VS Code webviews, requestAnimationFrame can be
    // throttled/delayed when the webview isn't actively rendering. Without
    // an immediate flush, agent_start events stay invisible until an
    // unrelated signal update (e.g. permission request) forces Angular
    // change detection.
    if (result.agentStartFlushNeeded) {
      this.batchedUpdate.flushSync();
    }

    return null;
  }

  // (Pure event-type dispatch + per-event helpers moved to
  // StreamingAccumulatorCore.)

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
   * @param resumableSubagents - Optional array of resumable subagent records from backend
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
   * SESSION_STATS is the authoritative signal that streaming has completed.
   */
  handleSessionStats(stats: {
    sessionId: string;
    cost: number;
    tokens: { input: number; output: number };
    duration: number;
  }): { tabId: string; queuedContent: string | null } | null {
    // Multi-tab fan-out.
    //
    // Resolve every tab bound to the conversation containing this session.
    // Each tab carries its own streamingState and must be finalized
    // independently (canvas-grid scenario: two tiles bound to one session
    // both need their pendingStats / finalization / markTabIdle path run).
    //
    // The primary tab is the first match (preserving legacy single-tab
    // return semantics) — its `queuedContent` is the one we surface back
    // to the caller for auto-send. Secondary tabs are processed for state
    // writes only; their queuedContent is ignored to avoid sending the
    // queued message N times.
    const boundTabs = this.tabManager.findTabsBySessionId(
      SessionId.from(stats.sessionId),
    );
    let primaryTab: TabState | undefined = boundTabs[0];

    // Fallback to active tab if no bound tab found
    if (!primaryTab) {
      const activeTab = this.tabManager.activeTab();

      if (
        activeTab &&
        !activeTab.claudeSessionId &&
        (activeTab.status === 'fresh' ||
          activeTab.status === 'streaming' ||
          activeTab.status === 'draft')
      ) {
        this.tabManager.attachSession(activeTab.id, stats.sessionId);
        this.sessionManager.setSessionId(stats.sessionId);
        primaryTab = activeTab;
      } else if (
        activeTab &&
        (activeTab.status === 'streaming' || activeTab.status === 'loaded')
      ) {
        primaryTab = activeTab;
      }

      if (!primaryTab) {
        console.warn(
          '[StreamingHandlerService] No target tab found for session stats',
        );
        return null;
      }
    }

    const targetTabId = primaryTab.id;

    // Finalize streaming tab when stats arrive
    // Also finalize if tab has streamingState but status is 'loaded' (race condition safety net:
    // when a session restarts on the same tab, status may not transition to 'streaming')
    if (
      primaryTab.streamingState &&
      (primaryTab.status === 'streaming' || primaryTab.status === 'loaded')
    ) {
      // Hard permission deny is per-session — consume ONCE and apply to
      // each fanned-out tab.
      const hardDenyToolUseIds =
        this.permissionHandler.consumeHardDenyToolUseIds();
      const queuedContent = primaryTab.queuedContent;

      // Tabs we actually finalize: every bound tab whose streamingState
      // exists and whose status matches the streaming/loaded predicate.
      // For tabs that don't qualify (e.g. fresh tab in fan-out), the
      // legacy fallback paths below still run for the PRIMARY tab only.
      const finalizableTabs =
        boundTabs.length > 0
          ? boundTabs.filter(
              (t) =>
                t.streamingState &&
                (t.status === 'streaming' || t.status === 'loaded'),
            )
          : [primaryTab];

      for (const t of finalizableTabs) {
        const state = t.streamingState;
        if (!state) continue;
        state.pendingStats = {
          cost: stats.cost,
          tokens: stats.tokens,
          duration: stats.duration,
        };

        this.finalization.finalizeCurrentMessage(t.id);

        // For hard deny: the SDK sends all completion events before exiting,
        // so markStreamingNodesAsInterrupted (used by isAborted) finds nothing
        // to change. Instead, post-process the finalized message to mark the
        // specific denied agent node(s) as interrupted.
        if (hardDenyToolUseIds.size > 0) {
          if (hardDenyToolUseIds.has(UNKNOWN_AGENT_TOOL_CALL_ID)) {
            // Fallback: no specific agentToolCallId available, mark last agent (legacy behavior)
            this.finalization.markLastAgentAsInterrupted(t.id);
          }

          // Targeted: mark only the specific denied agent(s) by their toolCallIds (excluding sentinel)
          const specificIds = new Set(
            [...hardDenyToolUseIds].filter(
              (id) => id !== UNKNOWN_AGENT_TOOL_CALL_ID,
            ),
          );
          if (specificIds.size > 0) {
            this.finalization.markAgentsAsInterruptedByToolCallIds(
              t.id,
              specificIds,
            );
          }
        }

        this.tabManager.markTabIdle(t.id);
      }

      return { tabId: targetTabId, queuedContent: queuedContent ?? null };
    }

    // Handle stats for tabs that are already loaded
    const messages = primaryTab.messages;

    if (messages.length === 0 && primaryTab.streamingState) {
      const state = primaryTab.streamingState;
      state.pendingStats = {
        cost: stats.cost,
        tokens: stats.tokens,
        duration: stats.duration,
      };
      this.batchedUpdate.scheduleUpdate(primaryTab.id, state);
      return null;
    }

    if (messages.length === 0) {
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

    this.tabManager.setMessages(targetTabId, updatedMessages);

    return null;
  }

  /**
   * Check if there's a previously interrupted agent of the same agentType in
   * the tab's finalized messages. If so, mark those SPECIFIC
   * agent node IDs as "resumed" in the AgentMonitorStore.
   *
   * Tracks by node ID (not agentType) to avoid false positives when multiple
   * agents of the same type exist â€” only the specific interrupted agent(s)
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
