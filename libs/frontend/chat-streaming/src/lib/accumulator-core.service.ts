/**
 * StreamingAccumulatorCore — the pure-ish, tab-agnostic event-type switch
 * extracted from `StreamingHandlerService.processEventForTab`. Mutates a
 * `StreamingState` in place against a context bag of peer services (dedup,
 * batched, agent stores, session manager). Knows NOTHING about tabs,
 * surfaces, queued content, or `tabManager.*` — those concerns stay in the
 * per-consumer wrapper (chat: `StreamingHandlerService`; surfaces:
 * `StreamRouter.routeStreamEventForSurface`).
 *
 * Behavioural contract:
 *   - Conversation-level state (dedup keyed by sessionId, agent
 *     registration via SessionManager, BackgroundAgentStore writes) is
 *     idempotent under repeat calls. Calling for two tabs/surfaces bound
 *     to one session adds the dedup entry on the first call and no-ops
 *     on the second. This is the property that makes multi-surface
 *     fan-out safe.
 *   - `compaction_complete` does NOT mutate the passed-in state. Instead
 *     the result carries a `replacementState` so the wrapper can swap
 *     the state object via the appropriate path (`tabManager.setStreamingState`
 *     for chat, `surfaceAdapter.setState` for surfaces).
 *   - `agent_start` raises `agentStartFlushNeeded: true` so the wrapper
 *     can decide whether to force-flush the batched-update queue. Chat
 *     does; surfaces typically do not (they re-render from the same
 *     signal-backed state slot).
 *   - `message_complete` queued-content surfacing is NOT handled here.
 *     The wrapper (which knows whether the consumer has a queued-content
 *     concept at all) checks `result.eventType === 'message_complete'`
 *     and inspects its own state.
 *   - `detectAndMarkResumedAgent` is NOT called here (it reads
 *     `tab.messages`, which surfaces don't have). The wrapper supplies
 *     an optional `onAgentStart` hook that fires after dedup checks
 *     pass, so chat can run resume detection without tying the core to
 *     tab-shaped state.
 */

import { Injectable, inject } from '@angular/core';
import {
  ExecutionNode,
  FlatStreamEventUnion,
  assertNever,
} from '@ptah-extension/shared';
import {
  AccumulatorKeys,
  StreamingState,
  createEmptyStreamingState,
  setStreamingEventCapped,
} from '@ptah-extension/chat-types';

import { SessionManager } from './session-manager.service';
import { EventDeduplicationService } from './event-deduplication.service';
import { BatchedUpdateService } from './batched-update.service';
import { BackgroundAgentStore } from './background-agent.store';
import { AgentMonitorStore } from './agent-monitor.store';

/**
 * Peer services + optional hooks the accumulator needs to do its work.
 * Constructed by the wrapper (chat handler / stream router) and passed
 * per call so the core itself stays free of consumer-specific dependencies.
 */
export interface AccumulatorContext {
  readonly sessionManager: SessionManager;
  readonly deduplication: EventDeduplicationService;
  readonly batchedUpdate: BatchedUpdateService;
  readonly backgroundAgentStore: BackgroundAgentStore;
  readonly agentMonitorStore: AgentMonitorStore;
  /**
   * Optional callback invoked immediately after `agent_start` passes dedup
   * and the agent is registered with `SessionManager`. Chat uses this to
   * run `detectAndMarkResumedAgent`, which inspects the tab's finalized
   * messages — surface consumers (wizard/harness) have no finalized
   * messages and pass nothing.
   */
  readonly onAgentStart?: (
    event: FlatStreamEventUnion & { eventType: 'agent_start' },
  ) => void;
  /**
   * Optional notification fired after every successful state mutation.
   * Chat ignores it (it mutates `TabState.streamingState` directly via
   * the shared reference). Surfaces use it to push the new state through
   * the surface adapter's `setState` for downstream signal observers.
   */
  readonly onStateChanged?: (state: StreamingState) => void;
}

/**
 * What the wrapper needs to know after the core ran.
 *
 * The chat wrapper interprets these into the legacy
 * `{ tabId, queuedContent?, compactionSessionId?, compactionComplete? }`
 * return shape. Surface wrappers care about `replacementState` (to swap
 * their state slot on compaction_complete) and `stateMutated` (to push
 * through the adapter). All consumers honour `agentStartFlushNeeded` to
 * decide whether to force-flush the batched-update queue.
 */
export interface AccumulatorResult {
  /**
   * True iff the core wrote anything to the state object. False on a
   * dedup-skip (e.g. duplicate `tool_start` from `complete` source) or
   * an early-return finalized-message guard. Wrappers may use this to
   * skip an unnecessary `setState`/signal write on the surface adapter.
   */
  readonly stateMutated: boolean;
  /**
   * True after a successful `agent_start` ingestion. The chat wrapper
   * force-flushes the batched-update queue so the new agent node is
   * visible immediately (RAF can be throttled in VS Code webviews when
   * the panel isn't actively rendering — see comment at the original
   * line 619-626).
   */
  readonly agentStartFlushNeeded: boolean;
  /**
   * Set to a fresh empty state on `compaction_complete`. The wrapper
   * MUST swap its state object reference to this value (chat:
   * `tabManager.setStreamingState`; surface: `adapter.setState`) and
   * surface the compaction-complete signal upstream.
   */
  readonly replacementState: StreamingState | null;
  /**
   * True iff the event was `compaction_start`. The chat wrapper turns
   * this into the legacy `{ compactionSessionId }` return.
   */
  readonly compactionStart: boolean;
  /**
   * True iff the event was `compaction_complete`. The chat wrapper turns
   * this into the legacy `{ compactionComplete: true, compactionSessionId }`
   * return after applying `replacementState`.
   */
  readonly compactionComplete: boolean;
  /**
   * The eventType that ran. Wrappers inspect this to decide
   * follow-up work (e.g. chat checks `message_complete` for queued
   * content; nothing else). Always echoed even on dedup-skip so the
   * wrapper can branch reliably.
   */
  readonly eventType: FlatStreamEventUnion['eventType'];
}

/** Convenience: a no-op result for dedup-skipped events. */
function skip(eventType: FlatStreamEventUnion['eventType']): AccumulatorResult {
  return {
    stateMutated: false,
    agentStartFlushNeeded: false,
    replacementState: null,
    compactionStart: false,
    compactionComplete: false,
    eventType,
  };
}

@Injectable({ providedIn: 'root' })
export class StreamingAccumulatorCore {
  // Peer services are injected by `inject()` so the accumulator can also be
  // instantiated standalone in tests via `TestBed.inject(StreamingAccumulatorCore)`.
  // Wrappers may pass their OWN instances via `AccumulatorContext` (the chat
  // handler today injects all peers itself); the ctx parameter wins so the
  // core remains a pure function of (state, event, ctx).
  private readonly defaultSessionManager = inject(SessionManager);
  private readonly defaultDeduplication = inject(EventDeduplicationService);
  private readonly defaultBatchedUpdate = inject(BatchedUpdateService);
  private readonly defaultBackgroundAgentStore = inject(BackgroundAgentStore);
  private readonly defaultAgentMonitorStore = inject(AgentMonitorStore);

  /**
   * Tracks messageIds where text accumulators need clearing on next
   * complete-source `text_delta`. Split from thinking to prevent
   * cross-type clearing — see the comment block at the original
   * line 295-306 of `streaming-handler.service.ts`.
   *
   * Kept on the core (root-provided) because messageId is globally
   * unique across surfaces; sharing the set across consumers is correct.
   */
  private readonly pendingTextClear = new Set<string>();

  /**
   * Tracks messageIds where thinking accumulators need clearing on next
   * complete-source `thinking_delta`. See above.
   */
  private readonly pendingThinkingClear = new Set<string>();

  /**
   * Process a single flat-stream event against the given state object.
   *
   * Mutates `state` in place for every event type EXCEPT
   * `compaction_complete`, which leaves `state` untouched and returns a
   * fresh empty state via `result.replacementState` for the wrapper to
   * install.
   */
  process(
    state: StreamingState,
    event: FlatStreamEventUnion,
    ctx: AccumulatorContext,
  ): AccumulatorResult {
    const sessionManager = ctx.sessionManager ?? this.defaultSessionManager;
    const deduplication = ctx.deduplication ?? this.defaultDeduplication;
    const backgroundAgentStore =
      ctx.backgroundAgentStore ?? this.defaultBackgroundAgentStore;
    const agentMonitorStore =
      ctx.agentMonitorStore ?? this.defaultAgentMonitorStore;

    switch (event.eventType) {
      case 'message_start': {
        const dedupResult = deduplication.handleDuplicateMessageStart(
          state,
          event,
        );

        if (dedupResult.skip) {
          state.currentMessageId = event.messageId;
          // currentMessageId mutated — surface a state change so signal
          // observers re-evaluate. (Chat wrapper ignores; surface wrapper
          // pushes through adapter.)
          ctx.onStateChanged?.(state);
          return {
            stateMutated: true,
            agentStartFlushNeeded: false,
            replacementState: null,
            compactionStart: false,
            compactionComplete: false,
            eventType: event.eventType,
          };
        }

        if (!dedupResult.existingEvent) {
          // First message_start for this messageId
          deduplication
            .getProcessedMessageIds(event.sessionId)
            .add(event.messageId);
          state.messageEventIds.push(event.messageId);
        } else if (event.source === 'complete' || event.source === 'history') {
          // REPLACEMENT: Complete/history message_start replacing a previous one.
          // Mark for DEFERRED, TYPE-SPLIT accumulator clearing.
          //
          // text_delta clears only text keys (`*-block-*`), thinking_delta
          // clears only thinking keys (`*-thinking-*`). This prevents:
          // 1. Duplicate text (stream blockIndex=1 + complete blockIndex=0)
          // 2. Text/thinking LOSS when complete message omits that content type
          // 3. Cross-turn wipes on non-Anthropic models that reuse the same
          //    chatcmpl-* messageId across ALL turns
          this.pendingTextClear.add(event.messageId);
          this.pendingThinkingClear.add(event.messageId);
        }

        setStreamingEventCapped(state, event);
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

        ctx.onStateChanged?.(state);
        return this.mutated(event.eventType);
      }

      case 'text_delta': {
        if (
          deduplication.isMessageAlreadyFinalized(
            event.sessionId,
            event.messageId,
            state,
          )
        ) {
          return skip(event.eventType);
        }

        setStreamingEventCapped(state, event);
        this.indexEventByMessage(state, event);

        const blockIndex = event.blockIndex ?? 0;
        const blockKey = AccumulatorKeys.textBlock(event.messageId, blockIndex);

        if (event.source === 'complete' || event.source === 'history') {
          // Deferred TEXT clearing: on the first complete/history text_delta,
          // clear only text accumulator keys (`*-block-*`) for this messageId.
          // Thinking keys are left untouched — they're cleared separately by
          // thinking_delta. This prevents a complete thinking_delta from wiping
          // text and vice versa.
          if (this.pendingTextClear.has(event.messageId)) {
            this.clearTextAccumulators(state, event.messageId);
            this.pendingTextClear.delete(event.messageId);
          }
          state.textAccumulators.set(blockKey, event.delta);
        } else {
          this.accumulateDelta(state.textAccumulators, blockKey, event.delta);
        }

        ctx.onStateChanged?.(state);
        return this.mutated(event.eventType);
      }

      case 'thinking_start': {
        setStreamingEventCapped(state, event);
        this.indexEventByMessage(state, event);
        ctx.onStateChanged?.(state);
        return this.mutated(event.eventType);
      }

      case 'thinking_delta': {
        if (
          deduplication.isMessageAlreadyFinalized(
            event.sessionId,
            event.messageId,
            state,
          )
        ) {
          return skip(event.eventType);
        }

        setStreamingEventCapped(state, event);
        this.indexEventByMessage(state, event);

        const blockIndex = event.blockIndex ?? 0;
        const thinkKey = AccumulatorKeys.thinkingBlock(
          event.messageId,
          blockIndex,
        );

        if (event.source === 'complete' || event.source === 'history') {
          // Deferred THINKING clearing: on the first complete/history
          // thinking_delta, clear only thinking keys (`*-thinking-*`).
          // Text keys are left untouched.
          if (this.pendingThinkingClear.has(event.messageId)) {
            this.clearThinkingAccumulators(state, event.messageId);
            this.pendingThinkingClear.delete(event.messageId);
          }
          state.textAccumulators.set(thinkKey, event.delta);
        } else {
          this.accumulateDelta(state.textAccumulators, thinkKey, event.delta);
        }

        ctx.onStateChanged?.(state);
        return this.mutated(event.eventType);
      }

      case 'tool_start': {
        const existingToolStart = deduplication.replaceStreamEventIfNeeded(
          state,
          event.toolCallId,
          'tool_start',
          event.source,
        );

        if (existingToolStart) {
          return skip(event.eventType);
        }

        setStreamingEventCapped(state, event);
        this.indexEventByMessage(state, event);

        deduplication
          .getProcessedToolCallIds(event.sessionId)
          .add(event.toolCallId);

        if (!state.toolCallMap.has(event.toolCallId)) {
          state.toolCallMap.set(event.toolCallId, []);
        }
        state.toolCallMap.get(event.toolCallId)?.push(event.id);

        ctx.onStateChanged?.(state);
        return this.mutated(event.eventType);
      }

      case 'tool_delta': {
        if (
          deduplication.isToolAlreadyFinalized(
            event.sessionId,
            event.toolCallId,
            state,
          )
        ) {
          return skip(event.eventType);
        }

        setStreamingEventCapped(state, event);
        this.indexEventByMessage(state, event);

        const inputKey = AccumulatorKeys.toolInput(event.toolCallId);
        this.accumulateDelta(
          state.toolInputAccumulators,
          inputKey,
          event.delta,
        );

        ctx.onStateChanged?.(state);
        return this.mutated(event.eventType);
      }

      case 'tool_result': {
        const existingToolResult = deduplication.replaceStreamEventIfNeeded(
          state,
          event.toolCallId,
          'tool_result',
          event.source,
        );

        if (existingToolResult) {
          return skip(event.eventType);
        }

        setStreamingEventCapped(state, event);
        this.indexEventByMessage(state, event);

        ctx.onStateChanged?.(state);
        return this.mutated(event.eventType);
      }

      case 'agent_start': {
        // Use agentId for deduplication (stable across hook and complete).
        // Hook sends UUID-format toolCallId, complete sends toolu_* format - they don't match!
        // agentId (e.g., "adcecb2") is stable and present in both sources.
        const existingByAgentId = deduplication.replaceAgentStartByAgentId(
          state,
          event.agentId,
          event.source,
        );

        if (existingByAgentId) {
          return skip(event.eventType);
        }

        // Fallback: Also check by toolCallId for events without agentId
        const existingByToolCallId = deduplication.replaceStreamEventIfNeeded(
          state,
          event.toolCallId,
          'agent_start',
          event.source,
        );

        if (existingByToolCallId) {
          return skip(event.eventType);
        }

        setStreamingEventCapped(state, event);
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

        // detect-and-mark-resumed lives in the wrapper (it reads
        // `tab.messages` which surfaces don't have). Hand off via the
        // optional onAgentStart hook.
        ctx.onAgentStart?.(event);

        // Capture per-subagent record keyed by parentToolUseId so the
        // inline-agent-bubble can show progress/status updates and
        // dispatch send-message / stop RPCs.
        agentMonitorStore.onAgentStart(event);

        const pendingDeltas = sessionManager.registerAgent(
          event.toolCallId,
          preliminaryAgentNode,
        );

        if (pendingDeltas.length > 0) {
          const summaryContent = pendingDeltas.join('');
          const updatedNode: ExecutionNode = {
            ...preliminaryAgentNode,
            summaryContent,
          };
          sessionManager.registerAgent(event.toolCallId, updatedNode);
        }

        ctx.onStateChanged?.(state);
        return {
          stateMutated: true,
          agentStartFlushNeeded: true,
          replacementState: null,
          compactionStart: false,
          compactionComplete: false,
          eventType: event.eventType,
        };
      }

      case 'message_complete': {
        setStreamingEventCapped(state, event);
        this.indexEventByMessage(state, event);

        state.currentTokenUsage = event.tokenUsage || null;

        // Queued-content surfacing is intentionally a wrapper concern.
        // Surfaces (wizard/harness) have no queued-content concept. Chat
        // wrapper inspects `eventType === 'message_complete'` and the
        // tab's queuedContent in its own follow-up.

        ctx.onStateChanged?.(state);
        return this.mutated(event.eventType);
      }

      case 'message_delta': {
        setStreamingEventCapped(state, event);
        this.indexEventByMessage(state, event);
        state.currentTokenUsage = event.tokenUsage;
        ctx.onStateChanged?.(state);
        return this.mutated(event.eventType);
      }

      case 'signature_delta': {
        setStreamingEventCapped(state, event);
        this.indexEventByMessage(state, event);
        ctx.onStateChanged?.(state);
        return this.mutated(event.eventType);
      }

      case 'compaction_start': {
        // Unified compaction flow.
        // Compaction events flow through CHAT_CHUNK (same as all streaming events).
        // The wrapper translates `compactionStart: true` into the legacy
        // `{ compactionSessionId }` return shape. No state mutation.
        return {
          stateMutated: false,
          agentStartFlushNeeded: false,
          replacementState: null,
          compactionStart: true,
          compactionComplete: false,
          eventType: event.eventType,
        };
      }

      case 'compaction_complete': {
        // Reset streaming state to fresh — pre-compaction events are stale.
        // The wrapper installs `replacementState` via the appropriate path
        // (`tabManager.setStreamingState` for chat; `adapter.setState` for
        // surfaces). We also clear deduplication state across the boundary.
        deduplication.cleanupSession(event.sessionId);

        const fresh = createEmptyStreamingState();
        // Notify with the FRESH state so signal-backed observers see the
        // reset before the wrapper installs it.
        ctx.onStateChanged?.(fresh);
        return {
          stateMutated: true,
          agentStartFlushNeeded: false,
          replacementState: fresh,
          compactionStart: false,
          compactionComplete: true,
          eventType: event.eventType,
        };
      }

      case 'background_agent_started':
        backgroundAgentStore.onStarted(event);
        return this.mutated(event.eventType);
      case 'background_agent_progress':
        backgroundAgentStore.onProgress(event);
        return this.mutated(event.eventType);
      case 'background_agent_completed':
        backgroundAgentStore.onCompleted(event);
        return this.mutated(event.eventType);
      case 'background_agent_stopped':
        backgroundAgentStore.onStopped(event);
        return this.mutated(event.eventType);

      // SDK task_* surface — drives per-subagent records keyed by
      // parentToolUseId for the inline-agent-bubble UI.
      case 'agent_progress':
        agentMonitorStore.onAgentProgress(event);
        return this.mutated(event.eventType);
      case 'agent_status':
        agentMonitorStore.onAgentStatus(event);
        return this.mutated(event.eventType);
      case 'agent_completed':
        agentMonitorStore.onAgentCompleted(event);
        return this.mutated(event.eventType);

      default:
        assertNever(
          event,
          `Unhandled event type: ${(event as FlatStreamEventUnion).eventType}`,
        );
    }
  }

  /**
   * Public for `StreamingHandlerService` (chat wrapper) — clears the
   * deferred-clear sets when a session is being torn down. Surfaces clear
   * implicitly through the dedup service's `cleanupSession`.
   */
  clearPendingClears(): void {
    this.pendingTextClear.clear();
    this.pendingThinkingClear.clear();
  }

  // ---------------------------------------------------------------------
  // Internals (extracted verbatim from streaming-handler.service.ts).
  // ---------------------------------------------------------------------

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
   * Clear only TEXT accumulators (`*-block-*`) for a given messageId.
   * Thinking keys are left untouched.
   */
  private clearTextAccumulators(
    state: StreamingState,
    messageId: string,
  ): void {
    const prefix = `${messageId}-block-`;
    for (const key of state.textAccumulators.keys()) {
      if (key.startsWith(prefix)) {
        state.textAccumulators.delete(key);
      }
    }
  }

  /**
   * Clear only THINKING accumulators (`*-thinking-*`) for a given messageId.
   * Text keys are left untouched.
   */
  private clearThinkingAccumulators(
    state: StreamingState,
    messageId: string,
  ): void {
    const thinkPrefix = `${messageId}-thinking-`;
    for (const key of state.textAccumulators.keys()) {
      if (key.startsWith(thinkPrefix)) {
        state.textAccumulators.delete(key);
      }
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

  /** Convenience: a "successful mutation, no follow-up" result. */
  private mutated(
    eventType: FlatStreamEventUnion['eventType'],
  ): AccumulatorResult {
    return {
      stateMutated: true,
      agentStartFlushNeeded: false,
      replacementState: null,
      compactionStart: false,
      compactionComplete: false,
      eventType,
    };
  }
}
