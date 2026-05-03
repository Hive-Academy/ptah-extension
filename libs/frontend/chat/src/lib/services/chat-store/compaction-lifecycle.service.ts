import { Injectable, inject, signal } from '@angular/core';
import { calculateSessionCostSummary } from '@ptah-extension/shared';
import {
  ConversationRegistry,
  TabManagerService,
  TabSessionBinding,
  type ConversationId,
  type TabId,
} from '@ptah-extension/chat-state';
import {
  SessionManager,
  ExecutionTreeBuilderService,
} from '@ptah-extension/chat-streaming';
import { SessionLoaderService } from './session-loader.service';

/**
 * CompactionLifecycleService - Owns the SDK session-compaction state machine.
 *
 * Responsibilities (carved from ChatStore in Wave C7g):
 * - Per-tab `isCompacting` flag management
 * - Compaction safety-fallback timeout (120s) â€” dismisses banner if backend
 *   never sends `compaction_complete`
 * - Compaction-complete reload flow: tree-cache clear, preloadedStats
 *   snapshot, message clear, sidebar refresh, session re-switch
 *
 * @see TASK_2025_098 â€” SDK Session Compaction
 */
@Injectable({ providedIn: 'root' })
export class CompactionLifecycleService {
  private readonly tabManager = inject(TabManagerService);
  private readonly sessionManager = inject(SessionManager);
  private readonly treeBuilder = inject(ExecutionTreeBuilderService);
  private readonly sessionLoader = inject(SessionLoaderService);
  /**
   * TASK_2026_109 C1 — `ConversationRegistry` is the single source of truth
   * for compaction state. The lifecycle service writes through here instead
   * of mutating per-tab `isCompacting`, eliminating the registry/tab drift
   * that left the banner stuck on the safety timeout when StreamRouter had
   * not registered the conversation by `compaction_complete` time.
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
   * @see TASK_2025_098
   */
  private compactionTimeoutId: ReturnType<typeof setTimeout> | null = null;

  /**
   * Safety fallback timeout for compaction notification (milliseconds).
   * The banner is normally dismissed by the `compaction_complete` event.
   * This timeout is a safety net in case the complete event is lost.
   * @see TASK_2025_098
   */
  private static readonly COMPACTION_SAFETY_TIMEOUT_MS = 120000;

  /**
   * TASK_2026_109 B4 — One-tick auto-animate suppression flag.
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
   * Handle compaction start event from backend
   * TASK_2025_098: SDK Session Compaction
   *
   * Shows the compaction notification banner and sets auto-dismiss timeout.
   * Only activates if the sessionId matches the current active session.
   *
   * @param sessionId - The session ID where compaction is occurring
   */
  handleCompactionStart(sessionId: string): void {
    // TASK_2026_106 Phase 4b — fan out to ALL tabs bound to this session.
    // Canvas-grid scenario: two tiles share a session; both must show the
    // banner. Legacy single-tab path used to silently freeze the other tile.
    const tabs = this.tabManager.findTabsBySessionId(sessionId);
    if (tabs.length === 0) {
      console.warn(
        '[ChatStore] handleCompactionStart: no tab found for sessionId',
        { sessionId },
      );
      return;
    }

    // Clear any existing timeout
    if (this.compactionTimeoutId) {
      clearTimeout(this.compactionTimeoutId);
      this.compactionTimeoutId = null;
    }

    // TASK_2026_109 C1 — write through to ConversationRegistry (the single
    // source of truth). Per-tab `isCompacting` is no longer mutated here;
    // banner UI in chat-view reads exclusively from the registry. Multiple
    // tabs may bind to the same conversation (canvas grid) — we still set
    // state once per unique conversation to avoid redundant writes.
    const compactingConvIds = this.collectConversationIdsForTabs(
      tabs.map((t) => t.id as TabId),
    );
    const startedAt = Date.now();
    for (const convId of compactingConvIds) {
      this.conversationRegistry.setCompactionState(convId, {
        inFlight: true,
        startedAt,
      });
    }

    // Safety fallback: dismiss if compaction_complete event is never received.
    // We snapshot the bound tab IDs at trigger time — tabs closed during the
    // 120s window are skipped via the per-tab existence check inside the
    // timeout callback. The session's first tab also drives sessionManager
    // status (legacy behavior) so single-tab callers see no change.
    const compactingTabIds = tabs.map((t) => t.id);
    this.compactionTimeoutId = setTimeout(() => {
      for (const tabId of compactingTabIds) {
        this.tabManager.applyCompactionTimeoutReset(tabId);
        this.tabManager.markTabIdle(tabId);
      }
      // Also clear the in-flight flag on the registry so the banner dismisses
      // even when the StreamRouter never observed `compaction_complete`.
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
   */
  handleCompactionComplete(result: {
    tabId: string;
    compactionSessionId: string;
  }): void {
    this.clearCompactionState(result.tabId);
    // TASK_2026_109 B4.1 — clear the execution-tree cache BEFORE messages are
    // cleared on the tab. OnPush change detection then sees an empty tree
    // first, eliminating the diff between stale pre-compaction nodes and the
    // post-reload tree that produced visible bubble overlap with sticky
    // agent-message headers.
    this.treeBuilder.clearCache();

    // Clear finalized messages for the tab - stale pre-compaction messages
    // Verify tab still exists before clearing (it may have been closed during compaction)
    const compactionTab = this.tabManager
      .tabs()
      .find((t) => t.id === result.tabId);
    if (compactionTab) {
      // TASK_2026_109 B2 — Split lifetime cost vs current context tokens.
      //
      // Per Claude Agent SDK semantics, `compact_boundary` resets the model's
      // context window: post-compaction usage starts from a fresh baseline.
      // Cumulative session cost ($) is what the user cares about and must be
      // preserved. Context-fill tokens (input/output/cacheRead/cacheCreation)
      // must NOT carry forward — otherwise the header double-counts (pre-
      // compaction tokens + new post-compaction tokens) and CTX % shows the
      // model context as if compaction never happened.
      //
      // After this reset, `SessionHistoryReaderService.aggregateUsageStats`
      // (which slices messages after the last `compact_boundary`) is the
      // source of truth via the `switchSession` reload below.
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

      // TASK_2026_109 B4.2 — Suppress `[auto-animate]` for the synchronous
      // tick that clears messages and the immediately-following reload.
      // queueMicrotask runs after this synchronous batch but before paint,
      // so the directive sees `[autoAnimateDisabled]=true` for exactly one
      // change-detection cycle and skips animating the stale→empty diff.
      this._suppressAnimateOnce.set(true);
      queueMicrotask(() => this._suppressAnimateOnce.set(false));

      // TASK_2025_COMPACT_FIX: Also clears any queued message so the
      // "Message queued (will send when Claude finishes)" banner disappears
      // and the next user message is sent fresh instead of draining a stale queue.
      this.tabManager.applyCompactionComplete(result.tabId, {
        preloadedStats,
        compactionCount: (compactionTab.compactionCount ?? 0) + 1,
      });

      // Also clear the visual streaming indicator and session manager state
      this.tabManager.markTabIdle(result.tabId);
      this.sessionManager.setStatus('loaded');

      // Reload session from disk to show the post-compaction state.
      // The SDK writes the compaction summary as a user message to the
      // session JSONL, but it's NOT emitted in the live stream. Without
      // this reload, the tab shows a clean slate until manually reopened.
      const reloadSessionId =
        compactionTab.claudeSessionId ?? result.compactionSessionId;
      if (reloadSessionId) {
        this.sessionLoader.switchSession(reloadSessionId).catch((err) => {
          console.warn(
            '[ChatStore] Failed to reload session after compaction:',
            err,
          );
        });
      }
    }
  }

  /**
   * Clear compaction state for a specific tab.
   * Public for use by ChatMessageHandler on CHAT_COMPLETE.
   *
   * TASK_2026_109 C1 — clears the in-flight flag on the conversation
   * registry (single source of truth). The legacy per-tab `isCompacting`
   * flag is no longer written; banner UI reads from the registry.
   */
  clearCompactionStateForTab(tabId: string): void {
    const convId = this.tabSessionBinding.conversationFor(tabId as TabId);
    if (convId) {
      this.conversationRegistry.setCompactionState(convId, { inFlight: false });
    }
  }

  /**
   * Clear compaction state for a specific tab, or all compacting tabs if no tabId given.
   * TASK_2025_098: SDK Session Compaction
   *
   * TASK_2026_109 C1 — sweeps the conversation registry instead of the tab
   * list. The "no tabId" path walks every conversation with `inFlight=true`
   * and clears it; this preserves the legacy "drop banners everywhere on
   * stale state" semantics without consulting `tab.isCompacting`.
   */
  clearCompactionState(tabId?: string): void {
    if (this.compactionTimeoutId) {
      clearTimeout(this.compactionTimeoutId);
      this.compactionTimeoutId = null;
    }
    if (tabId) {
      const convId = this.tabSessionBinding.conversationFor(tabId as TabId);
      if (convId) {
        this.conversationRegistry.setCompactionState(convId, {
          inFlight: false,
        });
      }
      return;
    }
    // Fallback sweep: clear inFlight on every conversation that has it set.
    for (const conv of this.conversationRegistry.conversations()) {
      if (conv.compactionInFlight) {
        this.conversationRegistry.setCompactionState(conv.id, {
          inFlight: false,
        });
      }
    }
  }
}
