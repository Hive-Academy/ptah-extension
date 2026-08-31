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
  MessageStartEvent,
  SessionId,
  isTurnStateEvent,
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
import { BackgroundAgentStore } from './background-agent.store';
import { AgentMonitorStore } from './agent-monitor.store';
import {
  StreamingAccumulatorCore,
  type AccumulatorContext,
} from './accumulator-core.service';
import { TurnStateApplier } from './turn-state-applier.service';

@Injectable({ providedIn: 'root' })
export class StreamingHandlerService {
  private readonly tabManager = inject(TabManagerService);
  private readonly sessionManager = inject(SessionManager);

  /**
   * Tracks session IDs that have already been warned about missing target tab
   * to avoid repeated console.warn spam during streaming rebuilds.
   *
   * `undefined` is a real key here, not a gap: an event with no session is
   * exactly the case worth warning about once, and every such event is the same
   * unattributable case, so one shared bucket is correct. It is never evicted by
   * `cleanupSessionDeduplication`, which only ever names a real session.
   */
  private readonly warnedNoTargetSessions = new Set<string | undefined>();
  private readonly deduplication = inject(EventDeduplicationService);
  private readonly batchedUpdate = inject(BatchedUpdateService);
  private readonly finalization = inject(MessageFinalizationService);
  private readonly backgroundAgentStore = inject(BackgroundAgentStore);
  private readonly agentMonitorStore = inject(AgentMonitorStore);
  private readonly accumulatorCore = inject(StreamingAccumulatorCore);
  private readonly turnStateApplier = inject(TurnStateApplier);

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
      // The backend turn state is intercepted BEFORE dedup and before the
      // accumulator: it drives status / spinner / liveness and is never stored
      // in `StreamingState` (TASK_2026_360).
      if (isTurnStateEvent(event)) {
        this.turnStateApplier.apply(event, tabId);
        return null;
      }
      // `SessionId.from` THROWS on a non-UUID, and an event can arrive with no
      // session at all while the SDK session is still resolving. The fan-out
      // lookup below runs unconditionally — AFTER `processEventForTab` has
      // already mutated state — so a throw there was swallowed by the catch and
      // turned into `null`, silently dropping the compaction / queued-content
      // dispatch that `chat.store.processStreamEvent` reads from the return
      // value. Never reach for `from` here. `safeParse` takes the absent case
      // itself (`undefined` → `null`), so every session lookup below is already
      // skipped when there is no session.
      const eventSession = SessionId.safeParse(event.sessionId);
      // Resolved ONCE per event and reused for the direct lookup, the
      // session-bound restriction and the fan-out membership test below. Each
      // of those used to re-read the signal and re-scan the array, so a single
      // delta cost up to three O(tabs) passes. Only MEMBERSHIP is read from it
      // after processing starts, and processing an event never adds or removes
      // a tab, so one snapshot is as correct as three.
      const activeTabs = this.tabManager.tabs();
      let primaryTab: TabState | undefined;
      if (tabId) {
        primaryTab = activeTabs.find((t) => t.id === tabId);
      }
      if (!primaryTab && eventSession) {
        const bound = this.tabManager.findTabsBySessionId(eventSession);
        // `findTabsBySessionId` can resolve a tab that lives in a BACKGROUND
        // workspace (via its cross-workspace fallback). The foreground
        // `processEventForTab` path is only valid for tabs in the active
        // `_tabs()` signal — a background tab writes the workspace PARTITION,
        // not the active signal, so its streaming state never materializes and
        // the accumulator dereferences a null state. Restrict to active-
        // workspace membership; if none qualify, leave `primaryTab` undefined so
        // the event falls through to `routeBackgroundEvent`.
        primaryTab = bound.find((t) => activeTabs.some((a) => a.id === t.id));
      }
      if (!primaryTab && !tabId) {
        const activeTab = this.tabManager.activeTab();
        // `attachSession` runs `SessionId.from` internally and throws the same
        // way, so the hijack only fires when we actually hold a session id.
        const realSessionId = SessionId.safeParse(sessionId) ?? eventSession;

        if (
          activeTab &&
          realSessionId &&
          !activeTab.claudeSessionId &&
          (activeTab.status === 'fresh' ||
            activeTab.status === 'streaming' ||
            activeTab.status === 'draft')
        ) {
          // Bind the session only. `status` is written by `applyTurnState`
          // from the backend `generating` event (TASK_2026_360).
          this.tabManager.attachSession(activeTab.id, realSessionId);
          this.sessionManager.setSessionId(realSessionId);

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
      const allBoundTabs = eventSession
        ? this.tabManager.findTabsBySessionId(eventSession)
        : [];
      if (allBoundTabs.length > 1) {
        for (const otherTab of allBoundTabs) {
          if (otherTab.id === primaryTab.id) continue;
          // Only fan out to tabs in the active `_tabs()` set. A background-
          // workspace tab surfaced here would hit the same null streaming-state
          // crash inside `processEventForTab`; its events reach it through the
          // `routeBackgroundEvent` → `updateBackgroundTab` partition path
          // instead. Canvas fan-out (multiple ACTIVE tabs bound to one session)
          // is unaffected — those are active tabs and still receive the event.
          if (!activeTabs.some((a) => a.id === otherTab.id)) continue;
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

    // Capture the SDK's real transcript UUID for the user's own turn — emitted
    // on the user `message_start` because `replay-user-messages` is enabled —
    // and stamp it onto the optimistic bubble so fork/rewind anchor on the real
    // id. Live turns only; history replay already carries real uuids as ids.
    if (
      !isReplay &&
      event.eventType === 'message_start' &&
      (event as MessageStartEvent).role === 'user'
    ) {
      this.tabManager.reconcileUserMessageNativeUuid(
        targetTab.id,
        event.messageId,
      );
    }

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
        .parentToolUseId &&
      (event as FlatStreamEventUnion & { eventType: 'message_complete' })
        .stopReason !== 'tool_use'
    ) {
      const queuedContent = targetTab.queuedContent;
      if (queuedContent && queuedContent.trim()) {
        this.batchedUpdate.scheduleUpdate(targetTab.id, state);
        return { tabId: targetTab.id, queuedContent };
      }
    }
    if (result.stateMutated) {
      // Content only. The spinner / `status` are NOT re-asserted from content
      // any more: a post-turn `agent_progress` used to re-light the stop
      // button with nothing left to clear it (TASK_2026_360, Defect 1). The
      // backend `generating` event is the one signal that a turn is running.
      this.batchedUpdate.scheduleUpdate(targetTab.id, state);
    }
    if (result.agentStartFlushNeeded) {
      // Origin-scoped: `agent_start` fires on every agent spawn, and the
      // un-scoped flush drained the deferred queue for EVERY tab — including
      // hidden ones the visibility gate had deliberately parked. The spawning
      // tab is the one that needs its agent node on screen now; the rest keep
      // waiting for their own visibility.
      this.batchedUpdate.flushSync(targetTab.id);
    }

    return null;
  }

  private routeBackgroundEvent(event: FlatStreamEventUnion): boolean {
    // A background tab is found BY its session id. With no session on the event
    // there is nothing to look up — report "not routed" and let the caller warn
    // and drop, rather than picking some tab that merely happens to be handy.
    if (!event.sessionId) return false;
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

    // Streaming state only. A cron- or gateway-triggered turn that starts on a
    // backgrounded tab gets its spinner and `status` from the backend
    // `generating` event through `applyTurnState`, which is workspace-aware
    // (TASK_2026_360).
    return this.tabManager.updateBackgroundTab(tab.id, {
      streamingState: state,
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
   * Stats are NOT a turn boundary (TASK_2026_360): the backend `turn_state`
   * event finalizes the turn through `TurnStateApplier`. This method only
   * decides where the numbers go:
   *   - the tab is still streaming (`streamingState` present) → stash them as
   *     `pendingStats`; finalization consumes them onto the final message;
   *   - the tab is already finalized → merge them onto the last assistant
   *     message and report the queued content for dispatch.
   */
  handleSessionStats(stats: {
    sessionId: string;
    cost: number;
    tokens: { input: number; output: number };
    duration: number;
  }): { tabId: string; queuedContent: string | null } | null {
    // Same non-throwing parse as `processStreamEvent`: this method has no
    // try/catch, so a `''` session id used to throw straight out of the
    // handler and abandon the whole turn-end stats merge.
    const statsSession = SessionId.safeParse(stats.sessionId);
    const boundTabs = statsSession
      ? this.tabManager.findTabsBySessionId(statsSession)
      : [];
    let primaryTab: TabState | undefined = boundTabs[0];
    if (!primaryTab) {
      // Before falling back to the active tab, resolve the owner across all
      // workspaces. A session that belongs to a BACKGROUND workspace must NOT
      // merge its stats onto the active tab — that renders another workspace's
      // turn onto the wrong session.
      const bgLookup = this.tabManager.findTabBySessionIdAcrossWorkspaces(
        stats.sessionId,
      );
      if (bgLookup) {
        const bgTab = bgLookup.tab;
        const bgState = bgTab.streamingState;
        if (bgState) {
          bgState.pendingStats = {
            cost: stats.cost,
            tokens: stats.tokens,
            duration: stats.duration,
          };
          this.tabManager.updateBackgroundTab(bgTab.id, {
            streamingState: { ...bgState },
          });
          return null;
        }
        this.mergeStatsOntoLastAssistant(bgTab, stats);
        return null;
      }

      const activeTab = this.tabManager.activeTab();

      if (
        activeTab &&
        statsSession &&
        !activeTab.claudeSessionId &&
        (activeTab.status === 'fresh' ||
          activeTab.status === 'streaming' ||
          activeTab.status === 'draft')
      ) {
        this.tabManager.attachSession(activeTab.id, statsSession);
        this.sessionManager.setSessionId(statsSession);
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
    if (primaryTab.streamingState) {
      // Still streaming (the `turn_state` that ends the turn is ordered after
      // the last chunk and usually lands after this push): stash for every
      // bound tab so finalization writes the numbers onto the final message.
      const streamingTabs =
        boundTabs.length > 0
          ? boundTabs.filter((t) => t.streamingState)
          : [primaryTab];
      for (const t of streamingTabs) {
        const state = t.streamingState;
        if (!state) continue;
        state.pendingStats = {
          cost: stats.cost,
          tokens: stats.tokens,
          duration: stats.duration,
        };
        this.batchedUpdate.scheduleUpdate(t.id, state);
      }
      return null;
    }

    // Already finalized: patch the last assistant message and hand the queued
    // follow-up to the dispatcher (the turn is over, so it can go now).
    this.mergeStatsOntoLastAssistant(primaryTab, stats);
    return {
      tabId: targetTabId,
      queuedContent: primaryTab.queuedContent ?? null,
    };
  }

  /**
   * Write a turn's stats onto the tab's last assistant message. Workspace-aware
   * through `setMessages` (routes to the partition for a background tab).
   */
  private mergeStatsOntoLastAssistant(
    tab: TabState,
    stats: {
      cost: number;
      tokens: { input: number; output: number };
      duration: number;
    },
  ): void {
    const messages = tab.messages;
    let lastAssistantIndex = -1;
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === 'assistant') {
        lastAssistantIndex = i;
        break;
      }
    }
    if (lastAssistantIndex === -1) return;

    const updatedMessages = [...messages];
    updatedMessages[lastAssistantIndex] = {
      ...messages[lastAssistantIndex],
      tokens: stats.tokens,
      cost: stats.cost,
      duration: stats.duration,
    };
    this.tabManager.setMessages(tab.id, updatedMessages);
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
