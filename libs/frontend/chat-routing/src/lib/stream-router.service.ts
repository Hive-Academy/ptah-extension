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
  SurfaceId,
  TabId,
  TabManagerService,
  TabSessionBinding,
  type ClaudeSessionId,
  type ClosedTabEvent,
} from '@ptah-extension/chat-state';
import {
  AgentMonitorStore,
  BackgroundAgentStore,
  BatchedUpdateService,
  EventDeduplicationService,
  PermissionHandlerService,
  SessionManager,
  StreamingAccumulatorCore,
  StreamingHandlerService,
  type AccumulatorContext,
} from '@ptah-extension/chat-streaming';
import type {
  FlatStreamEventUnion,
  PermissionRequest,
} from '@ptah-extension/shared';
import { StreamingSurfaceRegistry } from './streaming-surface-registry.service';

@Injectable({ providedIn: 'root' })
export class StreamRouter {
  private readonly registry = inject(ConversationRegistry);
  private readonly binding = inject(TabSessionBinding);
  private readonly tabManager = inject(TabManagerService);
  private readonly streamingHandler = inject(StreamingHandlerService);
  private readonly agentMonitorStore = inject(AgentMonitorStore);
  private readonly permissionHandler = inject(PermissionHandlerService);
  // TASK_2026_107 Phase 2 — surface routing dependencies. The router
  // assembles the AccumulatorContext directly here so the chat-streaming
  // layer doesn't need to know about surfaces (one-way dependency:
  // chat-routing → chat-streaming).
  private readonly surfaceRegistry = inject(StreamingSurfaceRegistry);
  private readonly accumulatorCore = inject(StreamingAccumulatorCore);
  private readonly sessionManager = inject(SessionManager);
  private readonly deduplication = inject(EventDeduplicationService);
  private readonly batchedUpdate = inject(BatchedUpdateService);
  private readonly backgroundAgentStore = inject(BackgroundAgentStore);

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

    // TASK_2026_106 Phase 6a — permission decision broadcast.
    //
    // PermissionHandler exposes a one-way `decisionPulse` signal that
    // bumps each time `handlePermissionResponse` resolves a prompt. The
    // router watches it (effect) and fans cancellation out to every
    // OTHER bound tab via `cancelPendingPromptOnOtherTabs`. Layering
    // direction stays one-way: chat-routing → chat-streaming. Permission
    // handler does not import the router.
    effect(() => {
      const pulse = this.permissionHandler.decisionPulse();
      if (!pulse) return;
      this.cancelPendingPromptOnOtherTabs(
        pulse.promptId,
        pulse.decidingTabId
          ? (TabId.safeParse(pulse.decidingTabId) ?? null)
          : null,
      );
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

  // =========================================================================
  // TASK_2026_107 Phase 2 — Surface routing (additive, shadow mode).
  //
  // Sibling APIs to onTabCreated/onTabClosed/routeStreamEvent/tabsForSession,
  // keyed by SurfaceId. Wizard (Phase 3) and harness (Phase 4) wire in later;
  // chat is unaffected. Permission-prompt routing is intentionally NOT
  // extended — wizard/harness run in full-auto background mode.
  // =========================================================================

  /**
   * Called when a non-tab surface (wizard analysis phase, harness operation)
   * is created. Sibling of `onTabCreated`.
   *
   * If `existingSessionId` resolves to a known conversation (rehydration
   * path), reuse it; otherwise mint a fresh conversation seeded with the
   * session. Returns the bound `ConversationId`.
   *
   * Idempotent: re-registering an already-bound surface returns the same
   * conversation id and does not duplicate sessions.
   */
  onSurfaceCreated(
    surfaceId: SurfaceId,
    existingSessionId?: ClaudeSessionId,
  ): ConversationId {
    // Re-entrant safety: if the surface is already bound, return the existing
    // conversation. Mirror onTabCreated's idempotency contract — surface
    // registration may fire twice during component re-mount (wizard panel
    // close + reopen mid-analysis).
    const existingConv = this.binding.conversationForSurface(surfaceId);
    if (existingConv) {
      if (existingSessionId) {
        const record = this.registry.getRecord(existingConv);
        if (record && !record.sessions.includes(existingSessionId)) {
          this.registry.appendSession(existingConv, existingSessionId);
        }
      }
      return existingConv;
    }

    // If the session is already known to a conversation (e.g. a chat tab
    // already opened it — unusual for wizard/harness but possible in
    // theory), reuse that conversation and bind the surface alongside.
    if (existingSessionId) {
      const containing = this.registry.findContainingSession(existingSessionId);
      if (containing) {
        this.binding.bindSurface(surfaceId, containing.id);
        return containing.id;
      }
    }

    const convId = this.registry.create(existingSessionId);
    this.binding.bindSurface(surfaceId, convId);
    return convId;
  }

  /**
   * Called when a non-tab surface is closed. Sibling of `onTabClosed`.
   *
   * Mirrors `handleTabClosed`'s cleanup semantics with one difference: the
   * "last consumer" check considers BOTH tabs and surfaces (because chat
   * tabs may still be bound to the same conversation as a wizard surface
   * in theory). Cleanup runs only when the surface being closed is the
   * final consumer of the conversation:
   *   - `streamingHandler.cleanupSessionDeduplication(sid)` — for every
   *     session in the conversation (mirrors handleTabClosed but extended
   *     to cover compaction-spanning conversations).
   *   - `agentMonitorStore.clearSessionAgents(sid)` — same.
   *   - `binding.unbindSurface` — always.
   *   - `registry.remove(convId)` — only if no tabs OR surfaces remain.
   *
   * Wrapped in try/catch like `handleTabClosed` so a single defect can't
   * wedge the cleanup path.
   */
  onSurfaceClosed(surfaceId: SurfaceId): void {
    try {
      const convId = this.binding.conversationForSurface(surfaceId);
      if (!convId) {
        // Idempotent: unbinding an unbound surface is a no-op. Also drop
        // from the surface adapter registry in case the caller forgot.
        this.surfaceRegistry.unregister(surfaceId);
        return;
      }

      // Snapshot sessions BEFORE we unbind so we can run per-session
      // cleanup if this is the last consumer.
      const record = this.registry.getRecord(convId);
      const sessions = record?.sessions ?? [];

      this.binding.unbindSurface(surfaceId);
      this.surfaceRegistry.unregister(surfaceId);

      const tabsRemain = this.binding.tabsFor(convId).length > 0;
      const surfacesRemain = this.binding.surfacesFor(convId).length > 0;

      if (!tabsRemain && !surfacesRemain) {
        // Last consumer — clean up dedup + agent state for every session
        // the conversation ever spanned, then drop the conversation.
        for (const sid of sessions) {
          this.streamingHandler.cleanupSessionDeduplication(sid);
          this.agentMonitorStore.clearSessionAgents(sid);
        }
        this.registry.remove(convId);
      }
    } catch (err) {
      console.warn(
        '[StreamRouter] onSurfaceClosed failed:',
        err,
        'surfaceId:',
        surfaceId,
      );
    }
  }

  /**
   * Stream-event ingestion for a surface. Sibling of `routeStreamEvent`.
   *
   * Resolves the conversation, ensures the binding exists, appends the
   * session to the conversation if it is new, then invokes
   * `StreamingAccumulatorCore.process` against the surface adapter's
   * state slot. The accumulator mutates the state in place; on
   * `compaction_complete` it returns a `replacementState` which we
   * install via `adapter.setState`.
   *
   * Returns the resolved `ConversationId`, or `null` if either the
   * surface is not registered or no session/conversation could be
   * resolved (the event is silently dropped — surface lifecycle
   * mismatches should never wedge the stream).
   */
  routeStreamEventForSurface(
    event: FlatStreamEventUnion,
    surfaceId: SurfaceId,
  ): ConversationId | null {
    const adapter = this.surfaceRegistry.getAdapter(surfaceId);
    if (!adapter) {
      // Caller registered a surface and then unregistered it before the
      // stream drained. Drop silently — Phase 3/4 cleanup will route any
      // residual events to the void.
      return null;
    }

    let convId = this.binding.conversationForSurface(surfaceId);
    if (!convId) {
      // Lazy bind: if the caller forgot to call onSurfaceCreated first,
      // mint a conversation now seeded with the event's session id (if
      // any). Mirrors the lazy-bind path in routeStreamEvent for tabs.
      const seeded = event.sessionId
        ? (event.sessionId as ClaudeSessionId)
        : undefined;
      convId = this.registry.create(seeded);
      this.binding.bindSurface(surfaceId, convId);
    }

    // Append the session to the conversation if new for it (e.g. the
    // surface was created with no session and the first event carries one).
    if (event.sessionId) {
      const sid = event.sessionId as ClaudeSessionId;
      const record = this.registry.getRecord(convId);
      if (record && !record.sessions.includes(sid)) {
        this.registry.appendSession(convId, sid);
      }
    }

    // Mutate the surface's state via the accumulator core. The adapter's
    // setState is invoked only on compaction_complete (where the core
    // returns a fresh replacement state); for in-place mutations the
    // signal-backed adapter's getter is already pointing at the mutated
    // object. Surfaces that need to notify on every mutation can supply
    // their own onStateChanged hook by registering a wrapping adapter.
    const ctx: AccumulatorContext = {
      sessionManager: this.sessionManager,
      deduplication: this.deduplication,
      batchedUpdate: this.batchedUpdate,
      backgroundAgentStore: this.backgroundAgentStore,
      agentMonitorStore: this.agentMonitorStore,
      // No onAgentStart hook — surfaces have no `tab.messages` to read for
      // resumed-agent detection, and wizard/harness don't surface a
      // resumed badge in their UI anyway.
    };

    const result = this.accumulatorCore.process(adapter.getState(), event, ctx);

    // Install replacement state on compaction_complete — the only path
    // where the core hands us a brand-new state object reference.
    if (result.replacementState) {
      adapter.setState(result.replacementState);
    }

    // Lifecycle (compaction flags on the conversation record).
    this.handleLifecycleEvents(event, convId);

    return convId;
  }

  /**
   * Lookup helper. Sibling of `tabsForSession`. Returns every surface
   * bound to any conversation that contains `sessionId`.
   *
   * Used by the Phase 5 defensive guard in `PermissionHandlerService` to
   * detect a "permission prompt arrived for a surface-only conversation"
   * regression in the SDK auto-allow policy.
   */
  surfacesForSession(sessionId: ClaudeSessionId): readonly SurfaceId[] {
    const record = this.registry.findContainingSession(sessionId);
    if (!record) return [];
    return this.binding.surfacesFor(record.id);
  }

  /**
   * TASK_2026_106 Phase 6a — permission prompt fan-out routing.
   *
   * Resolves the prompt's `sessionId` to the conversation that contains
   * it, then returns every tab currently bound to that conversation.
   * Side-effect: stores the resolved tab ids on the PermissionHandler so
   * downstream surfaces (canvas grid tiles, pop-out panels) can read
   * them without redoing the resolution.
   *
   * Returns an empty array when:
   *   - prompt has no sessionId, or
   *   - sessionId is unknown to the registry (router didn't see the
   *     binding event yet — fall back to global visibility), or
   *   - no tab is bound to the conversation.
   *
   * The caller (typically the message handler that just dispatched the
   * prompt to PermissionHandler) is responsible for actually dispatching
   * the prompt; this method only computes routing metadata.
   *
   * TASK_2026_107 Phase 5 — defensive guard.
   *
   * Wizard and harness surfaces run in full-auto background mode and must
   * never receive permission prompts (auto-allow is enforced at the SDK
   * layer). If a prompt arrives for a `sessionId` whose conversation is
   * bound to surfaces ONLY (no tabs), this is an SDK regression — silent
   * hangs on a surface-only flow are far worse than an explicit deny.
   *
   * Action: emit a structured `prompt.received.no-tab-surface-only` warning
   * carrying `{ promptId, sessionId, conversationId, surfaceCount }`, then
   * auto-deny via `permissionHandler.handlePermissionResponse` so the
   * backend unblocks immediately and the queue is cleared. Returns the
   * empty `TabId[]` (matching the no-bound-tabs return path) so the public
   * signature is byte-unchanged.
   */
  routePermissionPrompt(prompt: PermissionRequest): readonly TabId[] {
    if (!prompt.sessionId) return [];
    const sessionId = prompt.sessionId as ClaudeSessionId;
    const tabs = this.tabsForSession(sessionId);
    if (tabs.length > 0) {
      this.permissionHandler.attachPromptTargets(prompt.id, tabs);
      return tabs;
    }

    // No tabs resolved. Check whether the conversation has SURFACES bound
    // (wizard/harness) — that's the regression case the guard catches.
    // If the session is unknown to the registry entirely, fall through to
    // the legacy global-visibility return (empty array, no warning).
    const containing = this.registry.findContainingSession(sessionId);
    if (containing) {
      const surfaces = this.binding.surfacesFor(containing.id);
      if (surfaces.length > 0) {
        // Structured warning — payload mirrors the existing "warned" pattern
        // (see PermissionHandlerService for similar high-latency warnings).
        console.warn('prompt.received.no-tab-surface-only', {
          promptId: prompt.id,
          sessionId: prompt.sessionId,
          conversationId: containing.id,
          surfaceCount: surfaces.length,
        });
        // Auto-deny: route a deny response so the backend unblocks and the
        // prompt is removed from the queue. Reusing handlePermissionResponse
        // (rather than cancelPrompt) ensures the SDK is told the prompt was
        // resolved — cancelPrompt only mutates UI queue state.
        this.permissionHandler.handlePermissionResponse({
          id: prompt.id,
          decision: 'deny',
          reason: 'auto-deny: prompt arrived for surface-only conversation',
        });
      }
    }

    return tabs;
  }

  /**
   * TASK_2026_106 Phase 6a — fan a "prompt resolved" signal out to every
   * other bound tab. Today the prompt list is global, so cancellation is
   * a no-op once the deciding tab has already removed the entry from
   * `_permissionRequests` (PermissionHandler.handlePermissionResponse
   * already does that). This method is the architectural seam for the
   * future per-tab queue model — when prompts move into per-tab queues,
   * this method drops the queued copy on every tab except the one that
   * decided.
   *
   * Idempotent on repeat calls for the same prompt id (PermissionHandler.
   * cancelPrompt is itself a no-op when the prompt is already gone).
   */
  cancelPendingPromptOnOtherTabs(
    promptId: string,
    decidingTabId: TabId | null,
  ): readonly TabId[] {
    const tabs = this.permissionHandler.targetTabsFor(promptId);
    const cancelOn: TabId[] = [];
    for (const id of tabs) {
      const tabId = TabId.safeParse(id);
      if (!tabId) continue;
      if (decidingTabId && tabId === decidingTabId) continue;
      cancelOn.push(tabId);
    }
    // Today the prompt list is global. Calling cancelPrompt removes any
    // residual entry for the prompt id (the deciding tab already removed
    // it via handlePermissionResponse, so this is defensive). The
    // exceptTabId arg is reserved for the future per-tab queue.
    if (cancelOn.length > 0 || tabs.length > 0) {
      this.permissionHandler.cancelPrompt(
        promptId,
        decidingTabId ? (decidingTabId as string) : null,
      );
    }
    return cancelOn;
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
      // TASK_2026_109 C1 — persist trigger/preTokens/startedAt so consumers
      // (header freeze, late-event filter) can read full compaction context
      // from the registry without threading new params through call sites.
      this.registry.setCompactionState(convId, {
        inFlight: true,
        trigger: event.trigger,
        preTokens: event.preTokens,
        startedAt: Date.now(),
      });
    } else if (event.eventType === 'compaction_complete') {
      this.registry.setCompactionState(convId, { inFlight: false });
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
