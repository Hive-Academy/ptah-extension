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
 * - Compaction safety-fallback timeout (120s) — dismisses banner if backend
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
   * Timeout ID for compaction safety fallback.
   *
   * DESIGN NOTE: This is intentionally stored as a class property rather than
   * a signal because:
   * 1. The timeout ID is not UI state - it's an internal cleanup mechanism
   * 2. setTimeout returns a number/NodeJS.Timeout, not a serializable value
   * 3. We only need to clear it, never read it in templates
   *
   * The associated `isCompacting` per-tab field IS the UI state that components observe.
   */
  private compactionTimeoutId: ReturnType<typeof setTimeout> | null = null;

  /**
   * Safety fallback timeout for compaction notification (milliseconds).
   * The banner is normally dismissed by the `compaction_complete` event.
   * This timeout is a safety net in case the complete event is lost.
   */
  private static readonly COMPACTION_SAFETY_TIMEOUT_MS = 120000;

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
    const tabs = this.tabManager.findTabsBySessionId(SessionId.from(sessionId));
    if (tabs.length === 0) {
      console.warn(
        '[ChatStore] handleCompactionStart: no tab found for sessionId',
        { sessionId },
      );
      return;
    }
    if (this.compactionTimeoutId) {
      clearTimeout(this.compactionTimeoutId);
      this.compactionTimeoutId = null;
    }
    const compactingConvIds = this.collectConversationIdsForTabs(
      tabs.map((t) => t.id),
    );
    const startedAt = Date.now();
    for (const convId of compactingConvIds) {
      this.conversationRegistry.setCompactionState(convId, {
        inFlight: true,
        startedAt,
      });
    }
    const compactingTabIds = tabs.map((t) => t.id);
    this.compactionTimeoutId = setTimeout(() => {
      for (const tabId of compactingTabIds) {
        this.tabManager.applyCompactionTimeoutReset(tabId);
        this.tabManager.markTabIdle(tabId);
      }
      for (const convId of compactingConvIds) {
        this.conversationRegistry.setCompactionState(convId, {
          inFlight: false,
        });
      }
      this.sessionManager.setStatus('loaded');
      this.compactionTimeoutId = null;
      console.warn(
        '[ChatStore] Compaction safety timeout reached â€” compaction_complete event may have been lost',
      );
    }, CompactionLifecycleService.COMPACTION_SAFETY_TIMEOUT_MS);
  }

  /**
   * Resolve the set of unique conversation ids bound to the given tabs. Tabs
   * with no binding (pre-router-hydration legacy path) are silently skipped —
   * see C1 fallback contract: `chat-view` reads exclusively from the registry,
   * so an unbound tab simply will not render a banner. The previous fallback
   * to `tab.isCompacting` is the bug this fix is removing.
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
   * preloadedStats reset + `markTabIdle` to each. The disk reload via
   * `switchSession` is fired once per unique `claudeSessionId` to avoid
   * redundant JSONL re-reads.
   */
  handleCompactionComplete(result: {
    tabId: string;
    compactionSessionId: string;
  }): void {
    if (this.compactionTimeoutId) {
      clearTimeout(this.compactionTimeoutId);
      this.compactionTimeoutId = null;
    }
    this.treeBuilder.clearCache();
    const originatingTab = this.tabManager
      .tabs()
      .find((t) => t.id === result.tabId);
    const sessionTabs = this.tabManager.findTabsBySessionId(
      SessionId.from(result.compactionSessionId),
    );
    const fanoutMap = new Map<string, typeof originatingTab>();
    for (const t of sessionTabs) fanoutMap.set(t.id, t);
    if (originatingTab && !fanoutMap.has(originatingTab.id)) {
      fanoutMap.set(originatingTab.id, originatingTab);
    }
    const fanoutTabs = Array.from(fanoutMap.values()).filter(
      (t): t is NonNullable<typeof originatingTab> => t != null,
    );
    const compactionTab = originatingTab;
    if (compactionTab) {
      const priorPreloaded = compactionTab.preloadedStats ?? null;
      const livePreCompactionSnapshot =
        !priorPreloaded && compactionTab.messages.length > 0
          ? calculateSessionCostSummary([...compactionTab.messages])
          : null;

      const lifetimeCost =
        priorPreloaded?.totalCost ?? livePreCompactionSnapshot?.totalCost ?? 0;
      const priorMessageCount =
        priorPreloaded?.messageCount ??
        livePreCompactionSnapshot?.messageCount ??
        0;

      const preloadedStats = {
        totalCost: lifetimeCost,
        tokens: {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheCreation: 0,
        },
        messageCount: priorMessageCount,
      };
      this._suppressAnimateOnce.set(true);
      queueMicrotask(() => this._suppressAnimateOnce.set(false));
      for (const t of fanoutTabs) {
        this.tabManager.applyCompactionComplete(t.id, {
          preloadedStats,
          compactionCount: (t.compactionCount ?? 0) + 1,
        });
        this.tabManager.markTabIdle(t.id);
      }
      this.sessionManager.setStatus('loaded');
      const reloadIds = new Set<SessionId>();
      for (const t of fanoutTabs) {
        const id =
          t.claudeSessionId ?? SessionId.safeParse(result.compactionSessionId);
        if (id) reloadIds.add(id);
      }
      if (reloadIds.size === 0) {
        this.clearCompactionStateForFanout(fanoutTabs);
        return;
      }
      let pending = reloadIds.size;
      const onSettle = (): void => {
        pending -= 1;
        if (pending > 0) return;
        this.clearCompactionStateForFanout(fanoutTabs);
      };
      for (const sid of reloadIds) {
        this.sessionLoader
          .switchSession(sid)
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
   */
  handleCompactionCompleteNotification(
    payload: SdkCompactionCompletePayload,
  ): void {
    const tabs = this.tabManager.findTabsBySessionId(
      SessionId.from(payload.sessionId),
    );
    if (tabs.length === 0) {
      console.warn(
        '[ChatStore] handleCompactionCompleteNotification: no tab bound to sessionId',
        { sessionId: payload.sessionId },
      );
      return;
    }
    const convIds = this.collectConversationIdsForTabs(tabs.map((t) => t.id));
    if (convIds.length === 0) {
      console.warn(
        '[ChatStore] handleCompactionCompleteNotification: no conversation bound to tabs',
        { sessionId: payload.sessionId },
      );
      return;
    }
    for (const convId of convIds) {
      try {
        this.conversationRegistry.markCompactionComplete(
          convId,
          payload.timestamp,
        );
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
    const convId = this.tabSessionBinding.conversationFor(tabId);
    if (convId) {
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
    if (this.compactionTimeoutId) {
      clearTimeout(this.compactionTimeoutId);
      this.compactionTimeoutId = null;
    }
    if (tabId) {
      const convId = this.tabSessionBinding.conversationFor(tabId);
      if (convId) {
        this.conversationRegistry.setCompactionState(convId, {
          inFlight: false,
        });
      }
      return;
    }
    for (const conv of this.conversationRegistry.conversations()) {
      if (conv.compactionInFlight) {
        this.conversationRegistry.setCompactionState(conv.id, {
          inFlight: false,
        });
      }
    }
  }
}
