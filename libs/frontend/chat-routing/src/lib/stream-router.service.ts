/**
 * StreamRouter — TASK_2026_106 Phase 2 (SHADOW MODE).
 *
 * The single service that knows both sides of the routing relation:
 * `ConversationRegistry` (conversation ↔ session) on one side and
 * `TabSessionBinding` (tab ↔ conversation) on the other. Phase 3 will
 * make this service authoritative for stream-event delivery; Phase 2
 * runs it strictly in *shadow* mode — it observes the existing event
 * flow, populates the registry/binding, and exposes lookup helpers,
 * but it must NEVER call `TabManager` mutators or `StreamingHandler`
 * cleanup methods.
 *
 * Wiring approach (shadow mode): rather than modifying
 * `StreamingHandlerService` to call into the router (which would be a
 * write-side change and a Phase 3 concern), the composition root calls
 * `StreamRouter.notifyEvent(event, originTabId?)` from the same site
 * that today routes events into `ChatStore.processStreamEvent` (i.e.
 * `ChatMessageHandler.handleChatChunk`). The router's effect on the
 * legacy code path is *zero* — its only outputs are the registry
 * mutations and binding mutations it owns directly.
 *
 * Race notes (per spec): if `notifyEvent` arrives before
 * `onTabCreated`, the event resolves whatever conversation it can
 * (binding lookup may return null) and silently no-ops on the binding
 * side. Phase 3 introduces an event queue + drain semantics; shadow
 * mode keeps the implementation deliberately simple so divergence
 * from production behaviour is observable but bounded.
 */

import { Injectable, inject } from '@angular/core';
import {
  ConversationId,
  ConversationRegistry,
  TabId,
  TabSessionBinding,
  type ClaudeSessionId,
} from '@ptah-extension/chat-state';
import type { FlatStreamEventUnion } from '@ptah-extension/shared';

@Injectable({ providedIn: 'root' })
export class StreamRouter {
  private readonly registry = inject(ConversationRegistry);
  private readonly binding = inject(TabSessionBinding);

  /**
   * Called when a tab is created. If the tab carries a legacy
   * `claudeSessionId`, mint a one-session conversation and bind. Otherwise
   * mint an empty conversation and bind (it will gain a session on the
   * first stream event for that tab).
   *
   * Returns the minted ConversationId so callers can correlate.
   */
  onTabCreated(
    tabId: TabId,
    existingSessionId?: ClaudeSessionId,
  ): ConversationId {
    // Re-entrant safety: if the tab is already bound, return the existing
    // conversation. Idempotency is a hard requirement — onTabCreated may
    // fire twice during persisted-state rehydration.
    const existingConv = this.binding.conversationFor(tabId);
    if (existingConv) {
      // If a session id is provided and the conversation has no sessions
      // yet, append it. This handles the rehydrate-then-discover-session
      // flow without creating a duplicate conversation.
      if (existingSessionId) {
        const record = this.registry.getRecord(existingConv);
        if (record && !record.sessions.includes(existingSessionId)) {
          this.registry.appendSession(existingConv, existingSessionId);
        }
      }
      return existingConv;
    }

    const convId = this.registry.create(existingSessionId);
    this.binding.bind(tabId, convId);
    return convId;
  }

  /**
   * Called when a tab is closed. Unbinds the tab. If no other tab references
   * the conversation, removes the conversation from the registry.
   *
   * In shadow mode, this only updates routing state — it does NOT call
   * `StreamingHandlerService.cleanupSessionDeduplication` (Phase 3 owns
   * that) and it does NOT call any `TabManager` mutator.
   */
  onTabClosed(tabId: TabId): void {
    const convId = this.binding.conversationFor(tabId);
    if (!convId) return;

    this.binding.unbind(tabId);

    if (!this.binding.hasBoundTabs(convId)) {
      this.registry.remove(convId);
    }
  }

  /**
   * Observe a stream event. Resolves `event.sessionId` → `ConversationId`
   * via the registry, ensures a binding exists for the originating tab,
   * appends the session if it is new for the tab's conversation. Does NOT
   * route to other tabs (Phase 3) and does NOT mutate `TabManager`.
   *
   * Returns the resolved ConversationId for telemetry/debug, or null if
   * the router could not resolve a tab/conversation for the event.
   */
  routeStreamEvent(
    event: FlatStreamEventUnion,
    originTabId?: TabId,
  ): ConversationId | null {
    const eventSessionId = event.sessionId as ClaudeSessionId;
    const containing = eventSessionId
      ? this.registry.findContainingSession(eventSessionId)
      : null;

    let convId: ConversationId | null = containing?.id ?? null;

    if (originTabId) {
      const boundConv = this.binding.conversationFor(originTabId);

      if (convId && !boundConv) {
        // Conversation exists (another tab opened it earlier); bind this
        // tab to the same conversation.
        this.binding.bind(originTabId, convId);
      } else if (convId && boundConv && boundConv !== convId) {
        // Tab is bound to a *different* conversation than the one
        // containing this session — leave the binding alone in shadow
        // mode (the legacy path still drives the user-visible state) and
        // surface the resolved conversation for debug.
        // Phase 3 will decide whether to rebind, fan out, or drop.
      } else if (!convId && boundConv) {
        // Unknown session, but the tab already has a conversation —
        // append the session to that conversation.
        if (eventSessionId) {
          this.registry.appendSession(boundConv, eventSessionId);
        }
        convId = boundConv;
      } else if (!convId && !boundConv) {
        // Brand-new tab + brand-new session: mint conversation seeded
        // with this session and bind.
        const seeded = eventSessionId ? eventSessionId : undefined;
        const newConv = this.registry.create(seeded);
        this.binding.bind(originTabId, newConv);
        convId = newConv;
      }
    }

    if (convId) {
      this.handleLifecycleEvents(event, convId);
    }

    return convId;
  }

  /**
   * Public alias for `routeStreamEvent` — the composition root calls this
   * from `ChatMessageHandler.handleChatChunk` so the router observes every
   * event without `StreamingHandlerService` having to know about the
   * router. The two methods are synonyms today; Phase 3 may diverge them
   * (notify = ingest, route = resolve+fan-out).
   */
  notifyEvent(
    event: FlatStreamEventUnion,
    originTabId?: TabId,
  ): ConversationId | null {
    return this.routeStreamEvent(event, originTabId);
  }

  /** Lookup helper used by Phase 3+ callers and tests. */
  conversationForTab(tabId: TabId): ConversationId | null {
    return this.binding.conversationFor(tabId);
  }

  /**
   * Lookup helper used by Phase 3+ callers and tests. Returns every tab
   * bound to any conversation that contains `sessionId`.
   */
  tabsForSession(sessionId: ClaudeSessionId): readonly TabId[] {
    const record = this.registry.findContainingSession(sessionId);
    if (!record) return [];
    return this.binding.tabsFor(record.id);
  }

  /**
   * Compaction lifecycle is owned by the conversation, not the tab. Even
   * in shadow mode the router updates the registry flags so consumers
   * observing the registry (Phase 3 banner UI) can see them populated
   * before cutover.
   */
  private handleLifecycleEvents(
    event: FlatStreamEventUnion,
    convId: ConversationId,
  ): void {
    if (event.eventType === 'compaction_start') {
      this.registry.markCompactionStart(convId);
    } else if (event.eventType === 'compaction_complete') {
      this.registry.markCompactionComplete(convId);
    }
  }
}
