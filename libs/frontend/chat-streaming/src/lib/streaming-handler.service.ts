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

/**
 * Terminal reasons that mark a turn as user/SDK-aborted rather than cleanly
 * completed. After one of these, the SDK still emits a trailing
 * "[Request interrupted by user]" assistant message — that content must NOT
 * resurrect the visual streaming flag via the resume self-heal, or the stop
 * button reappears and the user has to click it twice to clear the spinner.
 * A clean turn-end (`completed`) or a background-task pause is unaffected, so
 * legitimate background resume still self-heals.
 */
const ABORTED_TERMINAL_REASONS: ReadonlySet<string> = new Set([
  'aborted_streaming',
  'aborted_tools',
]);

@Injectable({ providedIn: 'root' })
export class StreamingHandlerService {
  private readonly tabManager = inject(TabManagerService);
  private readonly sessionManager = inject(SessionManager);

  /**
   * Tracks session IDs that have already been warned about missing target tab
   * to avoid repeated console.warn spam during streaming rebuilds.
   */
  private readonly warnedNoTargetSessions = new Set<string>();
  private readonly deduplication = inject(EventDeduplicationService);
  private readonly batchedUpdate = inject(BatchedUpdateService);
  private readonly finalization = inject(MessageFinalizationService);
  private readonly permissionHandler = inject(PermissionHandlerService);
  private readonly backgroundAgentStore = inject(BackgroundAgentStore);
  private readonly agentMonitorStore = inject(AgentMonitorStore);
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
    options?: { isReplay?: boolean },
  ): {
    tabId: string;
    queuedContent?: string;
    compactionSessionId?: string;
    compactionComplete?: boolean;
    preTokens?: number;
    postTokens?: number;
    durationMs?: number;
  } | null {
    const isReplay = options?.isReplay ?? false;
    try {
      let primaryTab: TabState | undefined;
      if (tabId) {
        primaryTab = this.tabManager.tabs().find((t) => t.id === tabId);
      }
      if (!primaryTab) {
        const bound = this.tabManager.findTabsBySessionId(
          SessionId.from(event.sessionId),
        );
        primaryTab = bound.length > 0 ? bound[0] : undefined;
      }
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
          this.tabManager.attachSession(activeTab.id, realSessionId);
          this.tabManager.markStreaming(activeTab.id);

          this.sessionManager.setSessionId(realSessionId);
          this.sessionManager.setStatus('streaming');

          primaryTab = this.tabManager.activeTab() ?? undefined;
        }
      }

      if (!primaryTab) {
        if (this.routeBackgroundEvent(event)) {
          return null;
        }
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
      const primaryResult = this.processEventForTab(
        primaryTab,
        event,
        sessionId,
        isReplay,
      );
      const allBoundTabs = this.tabManager.findTabsBySessionId(
        SessionId.from(event.sessionId),
      );
      if (allBoundTabs.length > 1) {
        for (const otherTab of allBoundTabs) {
          if (otherTab.id === primaryTab.id) continue;
          this.processEventForTab(otherTab, event, sessionId, isReplay);
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
    isReplay = false,
  ): {
    tabId: string;
    queuedContent?: string;
    compactionSessionId?: string;
    compactionComplete?: boolean;
    preTokens?: number;
    postTokens?: number;
    durationMs?: number;
  } | null {
    let targetTab = initialTab;
    if (sessionId && !targetTab.claudeSessionId) {
      this.tabManager.attachSession(targetTab.id, sessionId);
      this.tabManager.markStreaming(targetTab.id);
    }
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
    const ctx: AccumulatorContext = {
      sessionManager: this.sessionManager,
      deduplication: this.deduplication,
      batchedUpdate: this.batchedUpdate,
      backgroundAgentStore: this.backgroundAgentStore,
      agentMonitorStore: this.agentMonitorStore,
      onAgentStart: (evt) => {
        if (evt.agentType) {
          this.detectAndMarkResumedAgent(evt.agentType, targetTab);
        }
      },
    };

    const result = this.accumulatorCore.process(state, event, ctx);
    if (result.compactionStart) {
      return { tabId: targetTab.id, compactionSessionId: event.sessionId };
    }
    if (result.compactionComplete && result.replacementState) {
      this.tabManager.setStreamingState(targetTab.id, result.replacementState);
      return {
        tabId: targetTab.id,
        compactionComplete: true,
        compactionSessionId: event.sessionId,
        preTokens: result.preTokens,
        postTokens: result.postTokens,
        durationMs: result.durationMs,
      };
    }
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
    if (result.stateMutated) {
      this.batchedUpdate.scheduleUpdate(targetTab.id, state);
      // Content is flowing, so the SDK is actively generating for this tab.
      // Re-assert the visual streaming flag if a turn-end (Stop hook, result,
      // or a background-task pause that flipped the tab to 'awaiting-background'
      // /'loaded') cleared it and the agent then resumed on its own. The next
      // real turn-end clears it again; the membership guard keeps steady-state
      // per-delta streaming a no-op.
      //
      // Exception: a user/SDK abort ends the turn and the SDK then emits a
      // trailing "[Request interrupted by user]" message. That content must
      // not self-heal the spinner back on, so skip the re-mark when the tab's
      // last turn ended in an aborted terminal reason.
      //
      // Exception: a historical replay (session opened from the sidebar)
      // pushes finalized events through this same path. Those mutate state but
      // must NOT light up the spinner — the replay has no live turn and no
      // terminal event to clear the flag again, so it would stick on `loaded`.
      const lastReason = targetTab.lastTerminalReason;
      const wasAborted =
        lastReason != null && ABORTED_TERMINAL_REASONS.has(lastReason);
      if (
        !isReplay &&
        !wasAborted &&
        !this.tabManager.isTabStreaming(targetTab.id)
      ) {
        this.tabManager.markTabStreaming(targetTab.id);
      }
    }
    if (result.agentStartFlushNeeded) {
      this.batchedUpdate.flushSync();
    }

    return null;
  }

  private routeBackgroundEvent(event: FlatStreamEventUnion): boolean {
    const lookup = this.tabManager.findTabBySessionIdAcrossWorkspaces(
      event.sessionId,
    );
    if (!lookup) return false;

    const { tab } = lookup;
    let state: StreamingState =
      tab.streamingState ?? createEmptyStreamingState();

    const ctx: AccumulatorContext = {
      sessionManager: this.sessionManager,
      deduplication: this.deduplication,
      batchedUpdate: this.batchedUpdate,
      backgroundAgentStore: this.backgroundAgentStore,
      agentMonitorStore: this.agentMonitorStore,
    };

    const result = this.accumulatorCore.process(state, event, ctx);
    if (result.compactionComplete && result.replacementState) {
      state = result.replacementState;
    }

    return this.tabManager.updateBackgroundTab(tab.id, {
      streamingState: state,
      status: 'streaming',
    });
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
   * @param resumableSubagents - Optional array of resumable subagent records from backend
   */
  finalizeSessionHistory(
    tabId: string,
    resumableSubagents?: import('@ptah-extension/shared').SubagentRecord[],
  ): ExecutionChatMessage[] {
    return this.finalization.finalizeSessionHistory(tabId, resumableSubagents);
  }

  /**
   * Handle session stats update from backend.
   *
   * Primary turn-end pivot moved to TurnEndHandlerService via Stop /
   * StopFailure hooks. This method now serves as:
   *   1. Safety-net finalization when Stop did not fire.
   *   2. Post-finalize stats merge when Stop has already finalized.
   */
  handleSessionStats(stats: {
    sessionId: string;
    cost: number;
    tokens: { input: number; output: number };
    duration: number;
  }): { tabId: string; queuedContent: string | null } | null {
    const boundTabs = this.tabManager.findTabsBySessionId(
      SessionId.from(stats.sessionId),
    );
    let primaryTab: TabState | undefined = boundTabs[0];
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
    const stopAlreadyObserved = primaryTab.lastTerminalReason !== undefined;
    if (
      !stopAlreadyObserved &&
      primaryTab.streamingState &&
      (primaryTab.status === 'streaming' || primaryTab.status === 'loaded')
    ) {
      const hardDenyToolUseIds =
        this.permissionHandler.consumeHardDenyToolUseIds();
      const queuedContent = primaryTab.queuedContent;
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
        if (hardDenyToolUseIds.size > 0) {
          if (hardDenyToolUseIds.has(UNKNOWN_AGENT_TOOL_CALL_ID)) {
            this.finalization.markLastAgentAsInterrupted(t.id);
          }
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
    for (const msg of tab.messages) {
      if (!msg.streamingState) continue;
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
