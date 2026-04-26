/**
 * StreamRouter — TASK_2026_106 Phase 3 (AUTHORITATIVE).
 *
 * The single service that knows both sides of the routing relation:
 * `ConversationRegistry` (conversation ↔ session) on one side and
 * `TabSessionBinding` (tab ↔ conversation) on the other. Phase 3 cuts
 * the router over from shadow to authoritative mode:
 *
 *   1. `routeStreamEvent` is the primary entry point — `ChatMessageHandler`
 *      calls it (no try/catch, no shadow-mode fallback).
 *   2. The router subscribes to `TabManagerService.closedTab` via `effect()`
 *      and performs the per-session cleanup that used to live inside
 *      `TabManager.closeTab` / `forceCloseTab` via the deleted
 *      `STREAMING_CONTROL` inversion. This removes the
 *      `TabManager → STREAMING_CONTROL → StreamingHandler/AgentMonitor →
 *      TabManager` NG0200 cycle.
 *   3. On bootstrap (constructor), the router migrates persisted
 *      `tab.claudeSessionId` values from `TabManagerService` into the
 *      registry/binding. This ensures rehydrated tabs participate in
 *      routing without requiring an explicit `onTabCreated` call.
 *
 * Cleanup ownership (Phase 3):
 *   - `close`       → cleanupSessionDeduplication + clearSessionAgents
 *                     (full teardown, mirrors legacy `closeTab`)
 *   - `forceClose`  → cleanupSessionDeduplication only
 *                     (pop-out transfer, agents stay alive for the target
 *                     panel — mirrors legacy `forceCloseTab`)
 *
 * Both paths additionally unbind the tab from its conversation and remove
 * the conversation from the registry if no other tab still references it.
 */

import { Injectable, effect, inject } from '@angular/core';
import {
  ConversationId,
  ConversationRegistry,
  TabId,
  TabManagerService,
  TabSessionBinding,
  type ClaudeSessionId,
  type ClosedTabEvent,
} from '@ptah-extension/chat-state';
import {
  AgentMonitorStore,
  StreamingHandlerService,
} from '@ptah-extension/chat-streaming';
import type { FlatStreamEventUnion } from '@ptah-extension/shared';

@Injectable({ providedIn: 'root' })
export class StreamRouter {
  private readonly registry = inject(ConversationRegistry);
  private readonly binding = inject(TabSessionBinding);
  private readonly tabManager = inject(TabManagerService);
  private readonly streamingHandler = inject(StreamingHandlerService);
  private readonly agentMonitorStore = inject(AgentMonitorStore);

  constructor() {
    // Bootstrap migration: hydrate registry/binding from any tabs that were
    // rehydrated from localStorage before this service was constructed.
    // Idempotent — `onTabCreated` no-ops when the tab is already bound.
    this.migratePersistedTabs();

    // Authoritative cleanup hook. Replaces the old TabManager → STREAMING_CONTROL
    // push. `tabManager.closedTab` is a signal that emits a `ClosedTabEvent`
    // every time `closeTab`/`forceCloseTab` runs; the effect reacts and the
    // router (which owns the routing graph) decides what to clean up.
    effect(() => {
      const evt = this.tabManager.closedTab();
      if (!evt) return;
      this.handleTabClosed(evt);
    });
  }

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
   * Phase 3: this method is preserved for explicit-call sites and tests.
   * The runtime path now flows through the `closedTab` effect — see
   * `handleTabClosed` below for the full cleanup sequence.
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
   * appends the session if it is new for the tab's conversation.
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
        // containing this session. Phase 3 surfaces the divergence via the
        // returned convId; we deliberately leave the binding alone because
        // the legacy chat path (chat.store.processStreamEvent) is still the
        // user-visible source of truth for content. Fan-out across multiple
        // conversations is a Phase 6+ concern.
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
   * Phase 3 alias retained for back-compat with any caller still using the
   * shadow-mode name. Prefer `routeStreamEvent`. Will be removed once all
   * call sites are confirmed migrated (Phase 4 sweep).
   *
   * @deprecated Use `routeStreamEvent` directly.
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
   * Compaction lifecycle is owned by the conversation, not the tab. The
   * router updates the registry flags so consumers observing the registry
   * (Phase 4+ banner UI) can see them populated.
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

  /**
   * Bootstrap-time migration. After persisted tabs are rehydrated from
   * localStorage, walk the tab list and seed `ConversationRegistry` +
   * `TabSessionBinding` from each tab's `claudeSessionId`. Idempotent.
   *
   * Persistence stays working (per spec): we DO NOT mutate the tab — we
   * only read its already-persisted `claudeSessionId`. Phase 6 will
   * migrate readers off `tab.claudeSessionId` entirely.
   */
  private migratePersistedTabs(): void {
    const tabs = this.tabManager.tabs();
    for (const tab of tabs) {
      const tabId = TabId.safeParse(tab.id);
      if (!tabId) continue;
      const sessionId = tab.claudeSessionId
        ? (tab.claudeSessionId as ClaudeSessionId)
        : undefined;
      this.onTabCreated(tabId, sessionId);
    }
  }

  /**
   * Reactive cleanup driven by `TabManagerService.closedTab`.
   *
   * Replaces the legacy direct-call path that ran inside `closeTab` /
   * `forceCloseTab` via `STREAMING_CONTROL`. Performs:
   *   - cleanupSessionDeduplication (always, when sessionId present)
   *   - clearSessionAgents (only on `kind === 'close'` — pop-out transfers
   *     keep agents alive in the target panel)
   *   - unbind the tab from its conversation
   *   - remove the conversation if no other tab still references it
   *
   * Wrapped in try/catch so a single defect can't wedge the effect runner
   * for subsequent close events.
   */
  private handleTabClosed(evt: ClosedTabEvent): void {
    try {
      if (evt.sessionId) {
        const sid = evt.sessionId as ClaudeSessionId;
        this.streamingHandler.cleanupSessionDeduplication(sid);
        if (evt.kind === 'close') {
          this.agentMonitorStore.clearSessionAgents(sid);
        }
      }

      const tabId = TabId.safeParse(evt.tabId);
      if (tabId) {
        this.onTabClosed(tabId);
      }
    } catch (err) {
      console.warn(
        '[StreamRouter] handleTabClosed failed:',
        err,
        'event:',
        evt,
      );
    }
  }
}
