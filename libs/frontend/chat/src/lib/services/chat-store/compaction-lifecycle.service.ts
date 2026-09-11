import { Injectable, inject, signal } from '@angular/core';
import {
  calculateSessionCostSummary,
  SessionId,
  type SdkCompactionCompletePayload,
} from '@ptah-extension/shared';
import {
  ConversationRegistry,
  TabManagerService,
  TabSessionBinding,
  TabId,
  type ConversationId,
} from '@ptah-extension/chat-state';
import {
  SessionManager,
  ExecutionTreeBuilderService,
} from '@ptah-extension/chat-streaming';
import { SessionLoaderService } from './session-loader.service';

/**
 * CompactionLifecycleService - Owns the SDK session-compaction state machine.
 *
 * Responsibilities:
 * - Per-tab `isCompacting` flag management
 * - Compaction safety-fallback timeout (10 min) — dismisses banner if backend
 *   never sends `compaction_complete`
 * - Compaction-complete reload flow: tree-cache clear, preloadedStats
 *   snapshot, message clear, sidebar refresh, session re-switch
 */
@Injectable({ providedIn: 'root' })
export class CompactionLifecycleService {
  private readonly tabManager = inject(TabManagerService);
  private readonly sessionManager = inject(SessionManager);
  private readonly treeBuilder = inject(ExecutionTreeBuilderService);
  private readonly sessionLoader = inject(SessionLoaderService);
  /**
   * `ConversationRegistry` is the single source of truth for compaction state.
   * The lifecycle service writes through here instead of mutating per-tab
   * `isCompacting`, eliminating the registry/tab drift that left the banner
   * stuck on the safety timeout when StreamRouter had not registered the
   * conversation by `compaction_complete` time.
   */
  private readonly conversationRegistry = inject(ConversationRegistry);
  private readonly tabSessionBinding = inject(TabSessionBinding);

  /**
   * Recovery timers are owned by their compacting SDK session. A timer is UI
   * lifecycle cleanup only; it is not evidence that the backend is ready.
   *
   * Keeping the captured tabs and conversations with the handle prevents a
   * terminal path for session A from clearing the timer or banner state that
   * belongs to session B.
   */
  private readonly compactionRecoveryTimers = new Map<
    SessionId,
    {
      timeoutId: ReturnType<typeof setTimeout>;
      tabIds: readonly TabId[];
      conversationIds: readonly ConversationId[];
    }
  >();

  /**
   * Safety fallback timeout for compaction notification (milliseconds).
   * The banner is normally dismissed by the `compaction_complete` event.
   * This timeout is a safety net in case the complete event is lost.
   *
   * It is a LOST-EVENT NET, NOT A DEADLINE. Nothing about compaction is
   * cancelled when it fires — the callback only un-sticks the UI (resets the
   * fan-out tabs, drops `inFlight`, sets the session status back to `loaded`)
   * and logs a warning that reads as a failure. So the only cost of waiting
   * longer is a banner that stays up for a compaction that is merely slow,
   * while the cost of firing early is a *false* failure warning plus a full
   * duplicate reload when the genuine `compaction_complete` lands afterwards.
   *
   * The previous 120s ceiling sat BELOW the slowest legitimate compaction: a
   * manual `/compact` on a resumed 372-event / 333k-token session was measured
   * at ~2 minutes end to end and tripped it every time. Ten minutes sits far
   * above any compaction observed on a real session, which is the property
   * this constant needs — not tightness.
   */
  private static readonly COMPACTION_SAFETY_TIMEOUT_MS = 600000;

  /**
   * PostCompact is advisory: the SDK hook proves compaction finished, but only
   * the streamed compact_boundary carries authoritative token metadata. Give
   * that stream a short turn before recovering the visible transcript.
   */
  private static readonly POST_COMPACT_BOUNDARY_WAIT_MS = 250;

  /**
   * Tracks the independent PostCompact signal without inventing a boundary.
   * A late real boundary after the fallback may enrich marker metrics, but it
   * must never replay the destructive completion/reload a second time.
   */
  private readonly postCompactAdvisories = new Map<
    SessionId,
    {
      originTabId: TabId;
      timeoutId: ReturnType<typeof setTimeout> | null;
      fallbackApplied: boolean;
    }
  >();

  /**
   * Per-session compaction generations correlate the two independently ordered
   * completion signals. A boundary completing generation N suppresses a later
   * PostCompact for N; the next compaction start advances N and permits its own
   * advisory. This is bounded state, not a time-based grace window.
   */
  private readonly compactionGenerations = new Map<
    SessionId,
    { generation: number; authoritativeGeneration: number | null }
  >();
  private static readonly MAX_COMPACTION_GENERATION_SESSIONS = 256;

  /**
   * One-tick auto-animate suppression flag.
   *
   * After `applyCompactionComplete` clears `messages: []` and `switchSession`
   * reloads from JSONL, the FLIP-based `[auto-animate]` directive on the
   * message container animates the diff between the old (stale) bubble DOM
   * and the new tree. Combined with `position: sticky` headers in agent
   * message bubbles, stacking-context contention produces visible bubble
   * overlap and clipping.
   *
   * The lifecycle service flips this signal `true` synchronously right
   * before the message clear, then resets it on the next microtask so the
   * suppression spans exactly one Angular change-detection tick. The
   * chat-view consumes this via its `[autoAnimateDisabled]` binding.
   *
   * Microtask (not `setTimeout(0)`) is intentional: it runs after the
   * current synchronous work but before the browser's next paint, which
   * matches the lifetime of the OnPush diff we want to skip animating.
   */
  private readonly _suppressAnimateOnce = signal(false);
  readonly suppressAnimateOnce = this._suppressAnimateOnce.asReadonly();

  /**
   * Handle compaction start event from backend (SDK Session Compaction).
   *
   * Shows the compaction notification banner and sets auto-dismiss timeout.
   * Only activates if the sessionId matches the current active session.
   *
   * @param sessionId - The session ID where compaction is occurring
   */
  handleCompactionStart(sessionId: string): void {
    const compactionSid = SessionId.from(sessionId);
    const tabs = this.tabManager.findTabsBySessionId(compactionSid);
    if (tabs.length === 0) {
      console.warn(
        '[ChatStore] handleCompactionStart: no tab found for sessionId',
        { sessionId },
      );
      return;
    }
    this.clearCompactionRecoveryTimer(compactionSid);
    // A new compaction supersedes any advisory left by the previous one; a
    // retained `fallbackApplied` entry would otherwise turn this generation's
    // real boundary into a metrics-only merge and skip its reload.
    const staleAdvisory = this.postCompactAdvisories.get(compactionSid);
    if (staleAdvisory?.timeoutId) clearTimeout(staleAdvisory.timeoutId);
    this.postCompactAdvisories.delete(compactionSid);
    this.beginCompactionGeneration(compactionSid);
    const compactingConvIds = this.ensureConversationIdsForTabs(
      tabs.map((t) => t.id),
      compactionSid,
    );
    const startedAt = Date.now();
    for (const convId of compactingConvIds) {
      this.conversationRegistry.setCompactionState(convId, {
        inFlight: true,
        startedAt,
      });
    }
    const compactingTabIds = tabs.map((t) => t.id);
    const timeoutId = setTimeout(() => {
      const recovery = this.compactionRecoveryTimers.get(compactionSid);
      if (!recovery || recovery.timeoutId !== timeoutId) return;
      this.compactionRecoveryTimers.delete(compactionSid);

      const ownedConversationIds = new Set<ConversationId>();
      for (const tabId of recovery.tabIds) {
        const tab = this.tabManager
          .tabs()
          .find((candidate) => candidate.id === tabId);
        if (tab?.claudeSessionId !== compactionSid) continue;
        const conversationId = this.tabSessionBinding.conversationFor(tabId);
        if (!conversationId || !recovery.conversationIds.includes(conversationId)) {
          continue;
        }
        ownedConversationIds.add(conversationId);
        this.tabManager.applyCompactionTimeoutReset(tabId);
        this.tabManager.markTabIdle(tabId);
      }
      for (const conversationId of ownedConversationIds) {
        this.conversationRegistry.setCompactionState(conversationId, {
          inFlight: false,
        });
      }
      if (this.sessionManager.getCurrentSessionId() === compactionSid) {
        this.sessionManager.setStatus('loaded');
      }
      console.warn(
        '[ChatStore] Compaction safety timeout reached — compaction_complete event may have been lost',
      );
    }, CompactionLifecycleService.COMPACTION_SAFETY_TIMEOUT_MS);
    this.compactionRecoveryTimers.set(compactionSid, {
      timeoutId,
      tabIds: compactingTabIds,
      conversationIds: compactingConvIds,
    });
  }

  private clearCompactionRecoveryTimer(sessionId: SessionId): void {
    const recovery = this.compactionRecoveryTimers.get(sessionId);
    if (!recovery) return;
    clearTimeout(recovery.timeoutId);
    this.compactionRecoveryTimers.delete(sessionId);
  }

  private clearCompactionRecoveryTimerForTab(tabId: TabId): void {
    const tab = this.tabManager.tabs().find((candidate) => candidate.id === tabId);
    if (!tab?.claudeSessionId) return;
    const sessionId = tab.claudeSessionId;
    const recovery = this.compactionRecoveryTimers.get(sessionId);
    if (!recovery || !recovery.tabIds.includes(tabId)) return;
    this.clearCompactionRecoveryTimer(sessionId);
  }

  private clearAllCompactionRecoveryTimers(): void {
    for (const recovery of this.compactionRecoveryTimers.values()) {
      clearTimeout(recovery.timeoutId);
    }
    this.compactionRecoveryTimers.clear();
    for (const advisory of this.postCompactAdvisories.values()) {
      if (advisory.timeoutId) clearTimeout(advisory.timeoutId);
    }
    this.postCompactAdvisories.clear();
    this.compactionGenerations.clear();
  }

  /**
   * READ-ONLY resolution: the set of unique conversation ids ALREADY bound to
   * the given tabs. Tabs with no binding are silently skipped — see the C1
   * fallback contract: `chat-view` reads exclusively from the registry, so an
   * unbound tab simply will not render a banner. The previous fallback to
   * `tab.isCompacting` is the bug that fix removed, and it STAYS removed: a
   * per-tab boolean is a second source of truth for compaction state and is
   * exactly the registry/tab drift the registry exists to eliminate.
   *
   * `ensureConversationIdsForTabs` is NOT a reintroduction of that fallback.
   * It never reads `tab.isCompacting` and never invents state — it mints a
   * real `ConversationRegistry` record and a real `TabSessionBinding` edge, so
   * afterwards this method resolves the tab through the ordinary path like any
   * router-bound tab. One is "guess from a stale tab flag"; the other is
   * "create the binding that was missing". Use this read-only variant on the
   * fan-out/teardown paths, where a tab that was never part of the compaction
   * must not acquire a conversation as a side effect of cleanup.
   */
  private collectConversationIdsForTabs(
    tabIds: readonly TabId[],
  ): readonly ConversationId[] {
    const seen = new Set<ConversationId>();
    const out: ConversationId[] = [];
    for (const tabId of tabIds) {
      const convId = this.tabSessionBinding.conversationFor(tabId);
      if (convId && !seen.has(convId)) {
        seen.add(convId);
        out.push(convId);
      }
    }
    return out;
  }

  /**
   * Resolve the unique conversation ids for the given tabs, ESTABLISHING a
   * binding for any tab that does not have one yet.
   *
   * `TabSessionBinding.bind` is called only by `StreamRouter`, and only once a
   * routed stream event carries an `originTabId`. Both compaction
   * notifications (`compaction_start` and the `PostCompact` push) arrive
   * BEFORE the first routed chunk of the turn, so on a freshly resumed session
   * every tab is still unbound at compaction time. Resolving read-only there
   * yielded an empty set, which silently dropped the `inFlight` write (no
   * banner source but the safety timer) and the marker summary stamp (the
   * compaction marker never got its recap text).
   *
   * Resolution order, most-authoritative first:
   *   1. an existing binding for the tab;
   *   2. the conversation that already contains `sessionId` anywhere in its
   *      history — a compaction never starts a new thread, so if the registry
   *      knows this session the tab belongs to that conversation;
   *   3. a new conversation seeded with `sessionId`.
   * The tab is bound to the resolved conversation in cases 2 and 3, so the
   * later fan-out and teardown paths — which stay read-only — now resolve it.
   */
  private ensureConversationIdsForTabs(
    tabIds: readonly TabId[],
    sessionId: SessionId,
  ): readonly ConversationId[] {
    const seen = new Set<ConversationId>();
    const out: ConversationId[] = [];
    for (const tabId of tabIds) {
      const convId = this.resolveOrCreateConversationForTab(tabId, sessionId);
      if (!seen.has(convId)) {
        seen.add(convId);
        out.push(convId);
      }
    }
    return out;
  }

  /**
   * Resolve-or-create the conversation for a `(tabId, sessionId)` pair and
   * guarantee the tab is bound to it. See `ensureConversationIdsForTabs` for
   * the resolution order and why the compaction path needs it.
   */
  private resolveOrCreateConversationForTab(
    tabId: TabId,
    sessionId: SessionId,
  ): ConversationId {
    const bound = this.tabSessionBinding.conversationFor(tabId);
    if (bound) return bound;
    const containing =
      this.conversationRegistry.findContainingSession(sessionId);
    const convId =
      containing?.id ?? this.conversationRegistry.create(sessionId);
    this.tabSessionBinding.bind(tabId, convId);
    return convId;
  }

  /**
   * Handle compaction complete result from streaming-handler.
   *
   * Dismisses banner, clears tree-builder cache, snapshots preloadedStats,
   * clears messages on the tab, increments compactionCount, and reloads
   * the session from disk so the post-compaction state is visible.
   *
   * Symmetric fan-out. `handleCompactionStart`
   * fans out to every tab bound to the session, but the legacy complete
   * path only reset `result.tabId`. In canvas-grid scenarios with multiple
   * tiles sharing a conversation, sibling tiles kept a stale post-compaction
   * banner + stale messages until the user manually switched tabs. We now
   * resolve all tabs bound to the same `compactionSessionId` (or, fallback,
   * the same conversation as the originating tab) and apply the
   * preserved stats + `markTabIdle` to each. Every cleared tab is reloaded by
   * its explicit tab id so duplicate session representations recover in place.
   */
  handleCompactionComplete(result: {
    tabId: string;
    compactionSessionId: string;
    preTokens?: number;
    postTokens?: number;
    durationMs?: number;
    advisoryFallback?: boolean;
  }): void {
    const compactionSid = SessionId.from(result.compactionSessionId);
    if (!result.advisoryFallback) {
      this.markAuthoritativeCompactionGeneration(compactionSid);
      const advisory = this.postCompactAdvisories.get(compactionSid);
      if (advisory?.timeoutId) {
        clearTimeout(advisory.timeoutId);
        this.postCompactAdvisories.delete(compactionSid);
      } else if (advisory?.fallbackApplied) {
        this.mergeLateCompactionBoundary(compactionSid, result);
        this.postCompactAdvisories.delete(compactionSid);
        return;
      }
    }
    this.treeBuilder.clearCache();
    this.clearCompactionRecoveryTimer(compactionSid);
    const allTabs = this.tabManager.tabs();
    const originatingTab = allTabs.find((t) => t.id === result.tabId);
    const sessionTabs = this.tabManager.findTabsBySessionId(compactionSid);
    const fanoutMap = new Map<string, typeof originatingTab>();
    for (const t of sessionTabs) fanoutMap.set(t.id, t);
    if (originatingTab && !fanoutMap.has(originatingTab.id)) {
      fanoutMap.set(originatingTab.id, originatingTab);
    }

    // Widen the fan-out so EVERY tab representing the compacting
    // session/conversation is refreshed — robust to (a) canvas tiles that are
    // not bound in `TabSessionBinding` and (b) SDK session-id rotation. The
    // registry-driven `findTabsBySessionId` path can silently exclude such a
    // tile, leaving its `messages` frozen at the pre-compaction transcript
    // until the user closes + reopens it. Each addition below is idempotent.

    // (1) Direct claudeSessionId match. Catches unbound tiles whose live
    //     session equals the compacting session but which never entered the
    //     conversation registry.
    for (const t of allTabs) {
      if (t.claudeSessionId === compactionSid && !fanoutMap.has(t.id)) {
        fanoutMap.set(t.id, t);
      }
    }

    // (2) Conversation expansion. Resolve the conversation ids for the tabs
    //     collected so far plus the conversation that contains the compacting
    //     session, then expand each conversation back to all of its bound tabs.
    //     Catches tiles whose `claudeSessionId` has rotated away from
    //     `compactionSessionId` but that still belong to the same conversation.
    const convIds = new Set<ConversationId>();
    for (const t of fanoutMap.values()) {
      if (!t) continue;
      const convId = this.tabSessionBinding.conversationFor(t.id);
      if (convId) convIds.add(convId);
    }
    const containingConv =
      this.conversationRegistry.findContainingSession(compactionSid);
    if (containingConv) convIds.add(containingConv.id);
    for (const convId of convIds) {
      for (const boundTabId of this.tabSessionBinding.tabsFor(convId)) {
        if (fanoutMap.has(boundTabId)) continue;
        const boundTab = allTabs.find((t) => t.id === boundTabId);
        if (boundTab) fanoutMap.set(boundTabId, boundTab);
      }
    }

    // Only an originating tab that still owns the compacting session can
    // establish the fallback conversation. A tab rebound before this completion
    // is unrelated; using its new conversation here would contaminate it.
    const compactionConversationId =
      containingConv?.id ??
      (originatingTab?.claudeSessionId === compactionSid
        ? this.tabSessionBinding.conversationFor(originatingTab.id)
        : null);
    const sourceSessionByTab = new Map(
      Array.from(fanoutMap.values())
        .filter((tab): tab is NonNullable<typeof originatingTab> => tab != null)
        .map((tab) => [tab.id, tab.claudeSessionId]),
    );
    // A direct compacting-session match in the initial lookup proves the
    // completion belonged to this origin at dispatch time. If its current owner
    // has since changed, it must be excluded rather than admitted by the
    // session-rotation fallback. Older notifications whose initial lookup did
    // not identify the origin retain the existing fallback behavior.
    const originatingSnapshotOwnsCompactionSession = sessionTabs.some(
      (tab) => tab.id === result.tabId && tab.claudeSessionId === compactionSid,
    );
    const fanoutTabs = Array.from(fanoutMap.values()).filter(
      (t): t is NonNullable<typeof originatingTab> => {
        if (!t) return false;
        // Re-read the tab's ownership immediately before mutating it. A
        // compaction completion can race with a targeted rebind; only the
        // compacting session itself, its still-bound conversation, or an
        // unchanged snapshot owner may receive the reset, marker, seed, and
        // reload. The last case preserves legitimate SDK session rotation.
        const current = this.tabManager.tabs().find((tab) => tab.id === t.id);
        if (!current) return false;
        if (
          t.id === result.tabId &&
          originatingSnapshotOwnsCompactionSession &&
          current.claudeSessionId !== compactionSid
        ) {
          return false;
        }
        if (current.claudeSessionId === compactionSid) return true;
        if (
          current.claudeSessionId === sourceSessionByTab.get(t.id) &&
          (t.id !== result.tabId || !originatingSnapshotOwnsCompactionSession)
        ) {
          return true;
        }
        return (
          compactionConversationId != null &&
          this.tabSessionBinding.conversationFor(current.id) ===
            compactionConversationId
        );
      },
    );

    // [compaction-diag] TEMPORARY — remove after the 2-tile stale-transcript
    // repro is confirmed. Snapshots the fan-out DECISION: every open tab, the
    // event's originating tab/session, and exactly which tabs were selected to
    // clear + reload. If the visible-but-stale tile is missing from
    // `fanoutTabs` here, the bug is in fan-out SELECTION; if it is present but
    // still stale, the bug is in the RELOAD target (see session-loader diag).
    console.warn('[compaction-diag] handleCompactionComplete decision', {
      resultTabId: result.tabId,
      compactionSessionId: result.compactionSessionId,
      originatingTabFound: !!originatingTab,
      allTabs: allTabs.map((t) => ({
        id: t.id,
        claudeSessionId: t.claudeSessionId ?? null,
        messages: t.messages.length,
      })),
      fanoutTabs: fanoutTabs.map((t) => ({
        id: t.id,
        claudeSessionId: t.claudeSessionId ?? null,
        messages: t.messages.length,
      })),
    });

    const completedAt = Date.now();
    for (const convId of this.collectConversationIdsForTabs(
      fanoutTabs.map((t) => t.id),
    )) {
      this.conversationRegistry.setCompactionMarkerTokens(convId, {
        preTokens: result.preTokens ?? null,
        postTokens: result.postTokens ?? null,
        durationMs: result.durationMs ?? null,
        completedAt,
      });
    }
    const compactionTab = originatingTab;
    if (compactionTab) {
      this._suppressAnimateOnce.set(true);
      queueMicrotask(() => this._suppressAnimateOnce.set(false));
      for (const t of fanoutTabs) {
        const liveSummary =
          !t.preloadedStats && t.messages.length > 0
            ? calculateSessionCostSummary([...t.messages])
            : null;
        const preloadedStats =
          t.preloadedStats ??
          (liveSummary
            ? {
                totalCost: liveSummary.totalCost,
                tokens: {
                  input: liveSummary.totalTokens.input,
                  output: liveSummary.totalTokens.output,
                  cacheRead: liveSummary.totalTokens.cacheRead ?? 0,
                  cacheCreation: liveSummary.totalTokens.cacheCreation ?? 0,
                },
                messageCount: liveSummary.messageCount,
              }
            : null);
        this.tabManager.applyCompactionComplete(t.id, {
          preloadedStats,
          compactionCount: (t.compactionCount ?? 0) + 1,
          postCompactionContextTokens: result.postTokens,
        });
        this.tabManager.markTabIdle(t.id);
      }
      if (this.sessionManager.getCurrentSessionId() === compactionSid) {
        this.sessionManager.setStatus('loaded');
      }
      const reloadTargets = fanoutTabs.map((tab) => ({
        tabId: tab.id,
        sessionId: tab.claudeSessionId ?? compactionSid,
      }));

      // [compaction-diag] TEMPORARY — retain visibility into the explicit
      // session/tab pairs until the 2-tile stale-transcript repro is confirmed.
      console.warn('[compaction-diag] reload plan', {
        reloadSessionIds: reloadTargets.map((target) => target.sessionId),
        fanoutTabIds: fanoutTabs.map((t) => t.id),
      });

      if (reloadTargets.length === 0) {
        this.clearCompactionStateForFanout(fanoutTabs);
        return;
      }
      let pending = reloadTargets.length;
      const onSettle = (): void => {
        pending -= 1;
        if (pending > 0) return;
        this.clearCompactionStateForFanout(fanoutTabs);
      };
      for (const target of reloadTargets) {
        this.sessionLoader
          .switchSession(target.sessionId, {
            reason: 'compaction',
            targetTabId: target.tabId,
          })
          .catch((err) => {
            console.warn(
              '[ChatStore] Failed to reload session after compaction:',
              err,
            );
          })
          .finally(onSettle);
      }
    } else {
      this.clearCompactionState(TabId.from(result.tabId));
    }
  }

  /**
   * Handle the `MESSAGE_TYPES.SESSION_COMPACTION_COMPLETE` push notification
   * (backend `PostCompact` SDK hook). Edge-triggered stamp into the
   * `ConversationRegistry` so SESSION_STATS no longer needs a wall-clock
   * grace window to detect the post-compaction tail. Fans out to every tab
   * bound to the payload's session id and stamps each conversation once.
   * No-tab-bound case warns and no-ops (does NOT throw) so a stale RPC
   * delivery after tab close does not crash the webview.
   *
   * A tab that exists but has no conversation binding is NOT the no-op case.
   * This push routinely lands before `StreamRouter` has bound the tab, and
   * returning early there is what left the compaction marker without its
   * summary. `ensureConversationIdsForTabs` establishes the binding instead,
   * so the stamp always has somewhere to land.
   */
  handleCompactionCompleteNotification(
    payload: SdkCompactionCompletePayload,
  ): void {
    const compactionSid = SessionId.from(payload.sessionId);
    const tabs = this.tabManager.findTabsBySessionId(compactionSid);
    if (tabs.length === 0) {
      console.warn(
        '[ChatStore] handleCompactionCompleteNotification: no tab bound to sessionId',
        { sessionId: payload.sessionId },
      );
      return;
    }
    const convIds = this.ensureConversationIdsForTabs(
      tabs.map((t) => t.id),
      compactionSid,
    );
    for (const convId of convIds) {
      try {
        this.conversationRegistry.markCompactionComplete(
          convId,
          payload.timestamp,
        );
        this.conversationRegistry.setCompactionMarkerSummary(convId, {
          summary: payload.compactSummary,
          completedAt: payload.timestamp,
        });
      } catch (error: unknown) {
        console.warn(
          '[ChatStore] handleCompactionCompleteNotification: registry stamp failed',
          {
            convId,
            error: error instanceof Error ? error.message : String(error),
          },
        );
      }
    }

    // PostCompact is advisory. A compact_boundary may have completed this
    // generation first; do not let its later hook delivery replay completion.
    if (this.isAuthoritativelyCompletedGeneration(compactionSid)) {
      console.info(
        '[ChatStore] PostCompact advisory ignored; matching compact_boundary already completed',
        { sessionId: compactionSid },
      );
      return;
    }
    // Deduplicate repeated hook deliveries and let a real compact_boundary own
    // the normal authoritative completion path.
    if (this.postCompactAdvisories.has(compactionSid)) return;
    const timeoutId = setTimeout(() => {
      const advisory = this.postCompactAdvisories.get(compactionSid);
      if (!advisory || advisory.timeoutId !== timeoutId) return;
      advisory.timeoutId = null;

      // Re-read ownership immediately before fallback mutation. A closed or
      // rebound tab is no longer an owner and cannot be reloaded by this hook.
      const origin = this.tabManager
        .tabs()
        .find((tab) => tab.id === advisory.originTabId);
      if (origin?.claudeSessionId !== compactionSid) {
        this.postCompactAdvisories.delete(compactionSid);
        console.info(
          '[ChatStore] PostCompact advisory fallback skipped; originating tab no longer owns session',
          { sessionId: compactionSid, tabId: advisory.originTabId },
        );
        return;
      }

      advisory.fallbackApplied = true;
      console.info(
        '[ChatStore] PostCompact advisory fallback applying one targeted reload without boundary metrics',
        { sessionId: compactionSid, tabId: origin.id },
      );
      this.handleCompactionComplete({
        tabId: origin.id,
        compactionSessionId: compactionSid,
        advisoryFallback: true,
      });
      // Retain the record so a later boundary can merge metrics without a
      // second reload or another compaction-count increment.
      this.postCompactAdvisories.set(compactionSid, advisory);
    }, CompactionLifecycleService.POST_COMPACT_BOUNDARY_WAIT_MS);
    this.postCompactAdvisories.set(compactionSid, {
      originTabId: tabs[0].id,
      timeoutId,
      fallbackApplied: false,
    });
    console.info(
      '[ChatStore] PostCompact advisory received; waiting briefly for real compact_boundary',
      { sessionId: compactionSid },
    );
  }

  private mergeLateCompactionBoundary(
    sessionId: SessionId,
    result: {
      preTokens?: number;
      postTokens?: number;
      durationMs?: number;
    },
  ): void {
    const ownedTabs = this.tabManager
      .findTabsBySessionId(sessionId)
      .filter((tab) => tab.claudeSessionId === sessionId);
    for (const tab of ownedTabs) {
      this.tabManager.seedPostCompactionContext(tab.id, result.postTokens);
    }
    const completedAt = Date.now();
    for (const convId of this.collectConversationIdsForTabs(
      ownedTabs.map((tab) => tab.id),
    )) {
      this.conversationRegistry.setCompactionMarkerTokens(convId, {
        preTokens: result.preTokens ?? null,
        postTokens: result.postTokens ?? null,
        durationMs: result.durationMs ?? null,
        completedAt,
      });
    }
    console.info(
      '[ChatStore] Late compact_boundary merged verified metrics after PostCompact fallback without reload',
      { sessionId, ownedTabCount: ownedTabs.length },
    );
  }

  private beginCompactionGeneration(sessionId: SessionId): void {
    const prior = this.compactionGenerations.get(sessionId);
    this.compactionGenerations.delete(sessionId);
    this.compactionGenerations.set(sessionId, {
      generation: (prior?.generation ?? 0) + 1,
      authoritativeGeneration: null,
    });
    this.trimCompactionGenerations();
  }

  private markAuthoritativeCompactionGeneration(sessionId: SessionId): void {
    const prior = this.compactionGenerations.get(sessionId);
    this.compactionGenerations.delete(sessionId);
    const generation = prior?.generation ?? 1;
    this.compactionGenerations.set(sessionId, {
      generation,
      authoritativeGeneration: generation,
    });
    this.trimCompactionGenerations();
  }

  private isAuthoritativelyCompletedGeneration(sessionId: SessionId): boolean {
    const state = this.compactionGenerations.get(sessionId);
    return state != null && state.authoritativeGeneration === state.generation;
  }

  private trimCompactionGenerations(): void {
    while (
      this.compactionGenerations.size >
      CompactionLifecycleService.MAX_COMPACTION_GENERATION_SESSIONS
    ) {
      const oldestSessionId = this.compactionGenerations.keys().next().value;
      if (!oldestSessionId) return;
      this.compactionGenerations.delete(oldestSessionId);
    }
  }

  /**
   * Clear conversation-level inFlight for the union of conversations covered
   * by the fan-out tab list. The conversation registry is the single source
   * of truth, so de-duping by conversation id (not tab id) avoids redundant
   * writes when multiple tiles share the same conversation binding.
   */
  private clearCompactionStateForFanout(
    fanoutTabs: ReadonlyArray<{ id: TabId }>,
  ): void {
    const convIds = this.collectConversationIdsForTabs(
      fanoutTabs.map((t) => t.id),
    );
    if (convIds.length === 0) {
      for (const t of fanoutTabs) this.clearCompactionState(t.id);
      return;
    }
    for (const convId of convIds) {
      this.conversationRegistry.setCompactionState(convId, { inFlight: false });
    }
  }

  /**
   * Clear compaction state for a specific tab.
   * Public for use by ChatMessageHandler on CHAT_COMPLETE.
   *
   * Clears the in-flight flag on the conversation registry (single source
   * of truth). The legacy per-tab `isCompacting` flag is no longer written;
   * banner UI reads from the registry.
   */
  clearCompactionStateForTab(tabId: TabId): void {
    const tab = this.tabManager.tabs().find((candidate) => candidate.id === tabId);
    if (tab?.claudeSessionId) {
      this.compactionGenerations.delete(tab.claudeSessionId);
      const advisory = this.postCompactAdvisories.get(tab.claudeSessionId);
      if (advisory?.originTabId === tabId && advisory.timeoutId) {
        clearTimeout(advisory.timeoutId);
        this.postCompactAdvisories.delete(tab.claudeSessionId);
      }
    }
    const convId = this.tabSessionBinding.conversationFor(tabId);
    if (convId) {
      this.clearCompactionRecoveryTimerForTab(tabId);
      this.conversationRegistry.setCompactionState(convId, { inFlight: false });
    }
  }

  /**
   * Clear compaction state for a specific tab, or all compacting tabs if no tabId given.
   *
   * Sweeps the conversation registry instead of the tab list. The "no tabId"
   * path walks every conversation with `inFlight=true` and clears it; this
   * preserves the "drop banners everywhere on stale state" semantics without
   * consulting `tab.isCompacting`.
   */
  clearCompactionState(tabId?: TabId): void {
    if (tabId) {
      const convId = this.tabSessionBinding.conversationFor(tabId);
      if (convId) {
        this.clearCompactionRecoveryTimerForTab(tabId);
        this.conversationRegistry.setCompactionState(convId, {
          inFlight: false,
        });
      }
      return;
    }
    this.clearAllCompactionRecoveryTimers();
    for (const conv of this.conversationRegistry.conversations()) {
      if (conv.compactionInFlight) {
        this.conversationRegistry.setCompactionState(conv.id, {
          inFlight: false,
        });
      }
    }
  }
}
