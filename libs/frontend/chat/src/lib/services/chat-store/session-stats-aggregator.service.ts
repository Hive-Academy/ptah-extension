import { Injectable, inject } from '@angular/core';
import {
  ConversationRegistry,
  TabManagerService,
  TabSessionBinding,
  type TabId,
} from '@ptah-extension/chat-state';
import { StreamingHandlerService } from '@ptah-extension/chat-streaming';
import type { TabState } from '@ptah-extension/chat-types';
import { pickPrimaryModel, type ModelUsageEntry } from '@ptah-extension/shared';
import { SessionLoaderService } from './session-loader.service';
import { CompactionLifecycleService } from './compaction-lifecycle.service';
import { MessageDispatchService } from './message-dispatch.service';

/**
 * SessionStatsAggregatorService - Process SESSION_STATS events from the backend.
 *
 * Responsibilities (carved from ChatStore in Wave C7g):
 * - Route incoming stats to the correct tab (with active-tab fallback)
 * - Process modelUsage array: pick primary model by highest cost,
 *   compute context-fill (lastTurnContextTokens preferred over cumulative)
 * - Update `liveModelStats` and `modelUsageList` per tab
 * - Accumulate `preloadedStats` for loaded sessions getting new turns
 * - Trigger sidebar refresh + auto-send re-steering
 */
@Injectable({ providedIn: 'root' })
export class SessionStatsAggregatorService {
  private readonly tabManager = inject(TabManagerService);
  private readonly streamingHandler = inject(StreamingHandlerService);
  private readonly sessionLoader = inject(SessionLoaderService);
  private readonly compactionLifecycle = inject(CompactionLifecycleService);
  private readonly messageDispatch = inject(MessageDispatchService);
  /**
   * TASK_2026_109 C1 — `isLateAfterCompaction` now sources compaction
   * status from the `ConversationRegistry` instead of the per-tab
   * `isCompacting` flag, eliminating the dual-source-of-truth race that
   * dropped or double-counted late SESSION_STATS events.
   */
  private readonly conversationRegistry = inject(ConversationRegistry);
  private readonly tabSessionBinding = inject(TabSessionBinding);

  /**
   * Handle session stats update from backend
   * Delegates to StreamingHandlerService
   *
   * @param stats - Session statistics (cost, tokens, duration, modelUsage)
   */
  handleSessionStats(stats: {
    sessionId: string;
    cost: number;
    tokens: {
      input: number;
      output: number;
      cacheRead?: number;
      cacheCreation?: number;
    };
    duration: number;
    modelUsage?: Array<{
      model: string;
      inputTokens: number;
      outputTokens: number;
      contextWindow: number;
      costUSD: number;
      cacheReadInputTokens?: number;
      lastTurnContextTokens?: number;
    }>;
  }): void {
    // TASK_2026_106 Phase 4b — fan out to ALL tabs bound to this session.
    // Canvas grid: every tile bound to the session needs its `liveModelStats`
    // and `preloadedStats` updated. Stats are accurate per-tab because
    // `setLiveModelStatsAndUsageList` and `setPreloadedStats` are idempotent
    // overwrites (not accumulators) — applying the same stats N times still
    // yields the correct final value.
    let targetTabs: readonly TabState[] = this.tabManager.findTabsBySessionId(
      stats.sessionId,
    );

    // TASK_2026_109 B3 — Reject late SESSION_STATS events that were emitted
    // for the last pre-compaction turn but arrive after `compaction_complete`.
    // Without this gate the event would (a) prematurely dismiss the banner via
    // `clearCompactionState` below, and (b) accumulate pre-compaction tokens
    // into the just-reset `preloadedStats`, causing double-counting and a
    // banner flicker.
    //
    // The SDK does not stamp epochs on stats events cross-process, so we use
    // a pragmatic receiver-side heuristic: drop events whose target tab is
    // either currently compacting OR finished a compaction within the grace
    // window (in-flight events ride out the boundary). Tabs that never
    // compacted (lastCompactionAt == null) are unaffected.
    const filteredTabs = targetTabs.filter(
      (t) => !this.isLateAfterCompaction(t),
    );
    if (filteredTabs.length === 0 && targetTabs.length > 0) {
      // Every bound tab considers this event late. Drop it entirely so
      // banners do not flicker and stats do not double-count.
      console.warn(
        '[ChatStore] handleSessionStats: dropped late event after compaction',
        { sessionId: stats.sessionId },
      );
      return;
    }
    targetTabs = filteredTabs;

    // TASK_2025_098: Clear compaction state when new message finishes
    // This indicates compaction (if any) has completed successfully.
    // Clear on every bound tab; legacy single-tab behavior is the loop-of-1.
    for (const t of targetTabs) {
      this.compactionLifecycle.clearCompactionState(t.id);
    }
    if (targetTabs.length === 0) {
      const activeTab = this.tabManager.activeTab();
      if (activeTab) {
        console.warn(
          '[ChatStore] handleSessionStats: findTabBySessionId failed, fell back to activeTab',
          { sessionId: stats.sessionId, activeTabId: activeTab.id },
        );
        targetTabs = [activeTab];
        // Mirror legacy behaviour: clearCompactionState was also called for the
        // fallback tab.
        this.compactionLifecycle.clearCompactionState(activeTab.id);
      } else {
        // Fallback path with no targets — keep legacy clearCompactionState(undefined) call.
        this.compactionLifecycle.clearCompactionState(undefined);
      }
    }
    // Process modelUsage to update liveModelStats for context display
    if (stats.modelUsage && stats.modelUsage.length > 0) {
      // TASK_2026_109 C3 — delegate primary-model selection to the shared
      // `pickPrimaryModel` helper so the live stream path and the history
      // reload path agree byte-for-byte. Without this, ties on `costUSD`
      // resolved differently across paths and the displayed model name
      // could flip between Opus / Haiku / Sonnet after compaction reload.
      const entries: ModelUsageEntry[] = stats.modelUsage.map((m) => ({
        model: m.model,
        totalCost: m.costUSD,
        tokens: {
          input: m.inputTokens,
          output: m.outputTokens,
          cacheRead: m.cacheReadInputTokens,
        },
      }));
      const primaryModelName = pickPrimaryModel(entries);
      const primaryModel =
        stats.modelUsage.find((m) => m.model === primaryModelName) ??
        stats.modelUsage[0];
      // Context usage: use last turn's actual prompt size (= real context fill),
      // NOT cumulative tokens across all turns. The SDK's modelUsage tokens are
      // summed across all API calls, but the context window only holds the current
      // conversation state. lastTurnContextTokens captures the last message_start's
      // input + cache_read, which IS the real context window fill level.
      // Falls back to cumulative tokens for backward compat (loaded sessions).
      const contextUsed =
        primaryModel.lastTurnContextTokens != null
          ? primaryModel.lastTurnContextTokens
          : primaryModel.inputTokens +
            (primaryModel.cacheReadInputTokens ?? 0) +
            primaryModel.outputTokens;
      const contextPercent =
        primaryModel.contextWindow > 0
          ? Math.round((contextUsed / primaryModel.contextWindow) * 1000) / 10
          : 0;

      // TASK_2026_106 Phase 4b — fan out liveModelStats to every bound tab.
      // Stats are an idempotent overwrite, so applying to the same value N
      // times converges; canvas-grid tiles see the same stats as the legacy
      // single-tab caller.
      for (const t of targetTabs) {
        this.tabManager.setLiveModelStatsAndUsageList(
          t.id,
          {
            model: primaryModel.model,
            contextUsed,
            contextWindow: primaryModel.contextWindow,
            contextPercent,
          },
          stats.modelUsage,
        );
      }
    }

    // Bug 2 fix: Accumulate preloadedStats with new turn data
    // When a loaded historical session gets new messages, the preloadedStats
    // must be updated so the stats summary shows the combined totals.
    //
    // TASK_2026_106 Phase 4b — fan out preloadedStats accumulation. Each tab
    // tracks its own preloadedStats (carried from the SDK session it was
    // loaded from) so we accumulate per-tab. For bound canvas-grid tiles
    // sharing one session this WILL double-count if both tiles have a
    // non-null preloadedStats — but in practice both tiles either inherit
    // the same preloaded baseline (one accumulation per tile, identical
    // result) or one is null and only the other is touched. We accept the
    // remaining edge case (both populated, same baseline) as correct because
    // each tile is a separate user-visible accounting surface.
    for (const t of targetTabs) {
      if (!t.preloadedStats) continue;
      this.tabManager.setPreloadedStats(t.id, {
        ...t.preloadedStats,
        totalCost: t.preloadedStats.totalCost + stats.cost,
        tokens: {
          input: t.preloadedStats.tokens.input + stats.tokens.input,
          output: t.preloadedStats.tokens.output + stats.tokens.output,
          cacheRead:
            t.preloadedStats.tokens.cacheRead + (stats.tokens.cacheRead ?? 0),
          cacheCreation:
            t.preloadedStats.tokens.cacheCreation +
            (stats.tokens.cacheCreation ?? 0),
        },
        messageCount: t.preloadedStats.messageCount + 1,
      });
    }

    // StreamingHandler finalizes the message and returns queued content info
    const result = this.streamingHandler.handleSessionStats(stats);

    // Refresh sidebar so session's lastActiveAt timestamp is updated
    this.sessionLoader.loadSessions().catch((err) => {
      console.warn('[ChatStore] Failed to refresh sessions after stats:', err);
    });

    // TASK_2025_101: Handle auto-send of queued content here to avoid circular dependency
    // (StreamingHandler â†’ MessageSender â†’ SessionLoader â†’ StreamingHandler)
    // TASK_2025_185: Use sendQueuedMessage for consistent error handling with queue restoration
    if (result && result.queuedContent && result.queuedContent.trim()) {
      this.messageDispatch.sendQueuedMessage(
        result.tabId,
        result.queuedContent,
      );
    }
  }

  /**
   * Grace window (ms) after `compaction_complete` during which incoming
   * SESSION_STATS events are presumed to be late stragglers from the last
   * pre-compaction turn. 2s covers the worst-case in-flight RPC latency.
   * @see TASK_2026_109 B3
   */
  private static readonly COMPACTION_GRACE_MS = 2000;

  /**
   * Returns true when a SESSION_STATS event arriving for `tab` should be
   * treated as a late, pre-compaction straggler. The tab is "still settling"
   * if its conversation is currently compacting OR completed a compaction
   * within the grace window. Tabs/conversations that have never compacted
   * return false.
   *
   * TASK_2026_109 C1 — reads compaction state from `ConversationRegistry`
   * via `TabSessionBinding`. The legacy path consulted `tab.isCompacting`
   * which could drift from the registry when StreamRouter and lifecycle
   * service raced. If the tab has no conversation binding yet we fall back
   * to the locally-stamped `lastCompactionAt` (Wave 1) on the tab so the
   * grace window still works for unbound, post-complete tail events.
   */
  private isLateAfterCompaction(tab: TabState): boolean {
    const convId = this.tabSessionBinding.conversationFor(tab.id as TabId);
    if (convId) {
      const state = this.conversationRegistry.compactionStateFor(convId);
      if (state) {
        if (state.inFlight) return true;
        const lastAt = state.lastCompactionAt;
        if (lastAt === null) return false;
        return (
          Date.now() - lastAt <
          SessionStatsAggregatorService.COMPACTION_GRACE_MS
        );
      }
    }
    // Tab without a conversation binding — fall back to the per-tab
    // `lastCompactionAt` stamp (Wave 1) so the post-complete grace window
    // still suppresses tail events for tabs that predate router hydration.
    const lastAt = tab.lastCompactionAt ?? null;
    if (lastAt === null) return false;
    return (
      Date.now() - lastAt < SessionStatsAggregatorService.COMPACTION_GRACE_MS
    );
  }
}
