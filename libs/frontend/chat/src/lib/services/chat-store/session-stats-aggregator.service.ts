import { Injectable, inject } from '@angular/core';
import {
  ConversationRegistry,
  TabManagerService,
  TabSessionBinding,
} from '@ptah-extension/chat-state';
import { StreamingHandlerService } from '@ptah-extension/chat-streaming';
import type { TabState } from '@ptah-extension/chat-types';
import {
  pickPrimaryModel,
  SessionId,
  type ModelUsageEntry,
} from '@ptah-extension/shared';
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
   * `isLateAfterCompaction` sources compaction status from the
   * `ConversationRegistry` instead of the per-tab `isCompacting` flag,
   * eliminating the dual-source-of-truth race that dropped or double-counted
   * late SESSION_STATS events.
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
    // Fan out to ALL tabs bound to this session.
    // Canvas grid: every tile bound to the session needs its `liveModelStats`
    // and `preloadedStats` updated. Stats are accurate per-tab because
    // `setLiveModelStatsAndUsageList` and `setPreloadedStats` are idempotent
    // overwrites (not accumulators) — applying the same stats N times still
    // yields the correct final value.
    let targetTabs: readonly TabState[] = this.tabManager.findTabsBySessionId(
      SessionId.from(stats.sessionId),
    );

    // Reject late SESSION_STATS events that were emitted
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

    // Clear compaction state when new message finishes.
    // This indicates compaction (if any) has completed successfully.
    // Clear on every bound tab; legacy single-tab behavior is the loop-of-1.
    for (const t of targetTabs) {
      this.compactionLifecycle.clearCompactionState(t.id);
    }
    if (targetTabs.length === 0) {
      // Drop the active-tab fallback. When tab
      // switching during a stream, falling back to `activeTab()` would
      // pollute the foreground tab with another session's stats (wrong
      // model name, wrong context %, wrong cumulative cost) and trigger a
      // stale `clearCompactionState` on the wrong conversation. The correct
      // behaviour is to drop the event: the originating session no longer
      // has a tab, so no UI surface needs to update. Downstream
      // `streamingHandler.handleSessionStats` and `loadSessions` are
      // intentionally skipped too — `handleSessionStats` operates on the
      // resolved tab id and would also pollute, and the sidebar refresh is
      // pointless without a tab to re-time.
      console.warn(
        '[ChatStore] handleSessionStats: no tab bound to sessionId, dropping event',
        { sessionId: stats.sessionId },
      );
      return;
    }
    // Process modelUsage to update liveModelStats for context display
    if (stats.modelUsage && stats.modelUsage.length > 0) {
      // Delegate primary-model selection to the shared
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
      // Sticky primary model by sessionModel.
      // The cost-based `pickPrimaryModel` heuristic will flip to whichever
      // model billed the most tokens this turn — a Haiku subagent burst
      // can briefly out-cost the user's chosen Opus and the header model
      // name will visibly switch. The user picked their model and expects
      // it to remain the displayed primary as long as it is still in
      // `modelUsage`. Pick the first sessionModel match across all target
      // tabs; only fall back to the cost heuristic when no target tab has
      // a sessionModel that appears in this stats payload.
      const stickyModelName = ((): string | null => {
        for (const t of targetTabs) {
          const sm = t.sessionModel;
          if (sm && stats.modelUsage.some((m) => m.model === sm)) return sm;
        }
        return null;
      })();
      const primaryModelName = stickyModelName ?? pickPrimaryModel(entries);
      const primaryModel =
        stats.modelUsage.find((m) => m.model === primaryModelName) ??
        stats.modelUsage[0];
      // Context usage: use last turn's actual prompt size (= real context fill),
      // NOT cumulative tokens across all turns. The SDK's modelUsage tokens are
      // summed across all API calls, but the context window only holds the current
      // conversation state. lastTurnContextTokens captures the last message_start's
      // input + cache_read, which IS the real context window fill level.
      //
      // When `lastTurnContextTokens` is missing AND
      // any target tab has compacted at least once, the cumulative fallback
      // (input + cacheRead + output) over-counts pre-compaction tokens that
      // are no longer in the context window — producing the 1118%-style
      // banner the user reported. In that case, suppress this stats update
      // entirely and let the next `message_start` repopulate liveModelStats
      // with a real per-turn measurement. The header keeps its prior value
      // (or stays cleared after compaction reset) instead of flashing a
      // garbage cumulative number.
      const tabHasCompacted = targetTabs.some(
        (t) =>
          (t.lastCompactionAt ?? null) !== null || (t.compactionCount ?? 0) > 0,
      );
      const useCumulativeFallback = primaryModel.lastTurnContextTokens == null;
      // Also skip when the cumulative fallback
      // exceeds the model's contextWindow. This catches long sessions on
      // third-party providers (OpenRouter, Moonshot, Ollama) that never
      // emit `lastTurnContextTokens`: the cumulative sum across all turns
      // can climb past the contextWindow size, producing 1000%+ CTX badges.
      // A single turn's context fill is structurally bounded by the window,
      // so cumulative > window means the value is unusable as a
      // contextPercent. Better to skip than display garbage. The next
      // `message_start` (where the SDK does provide a real per-turn count)
      // will repopulate liveModelStats with a valid measurement.
      const cumulativeFallback =
        primaryModel.inputTokens +
        (primaryModel.cacheReadInputTokens ?? 0) +
        primaryModel.outputTokens;
      const cumulativeExceedsWindow =
        primaryModel.contextWindow > 0 &&
        cumulativeFallback > primaryModel.contextWindow;
      const skipLiveStatsUpdate =
        useCumulativeFallback && (tabHasCompacted || cumulativeExceedsWindow);

      if (!skipLiveStatsUpdate) {
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

        // Fan out liveModelStats to every bound tab.
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
      } else {
        console.warn(
          '[ChatStore] handleSessionStats: skipped post-compaction cumulative-fallback update',
          {
            sessionId: stats.sessionId,
            model: primaryModel.model,
            inputTokens: primaryModel.inputTokens,
          },
        );
      }
    }

    // Bug 2 fix: Accumulate preloadedStats with new turn data
    // When a loaded historical session gets new messages, the preloadedStats
    // must be updated so the stats summary shows the combined totals.
    //
    // Fan out preloadedStats accumulation. Each tab
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

    // Handle auto-send of queued content here to avoid circular dependency
    // (StreamingHandler → MessageSender → SessionLoader → StreamingHandler).
    // Use sendQueuedMessage for consistent error handling with queue restoration.
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
   */
  private static readonly COMPACTION_GRACE_MS = 2000;

  /**
   * Returns true when a SESSION_STATS event arriving for `tab` should be
   * treated as a late, pre-compaction straggler. The tab is "still settling"
   * if its conversation is currently compacting OR completed a compaction
   * within the grace window. Tabs/conversations that have never compacted
   * return false.
   *
   * Reads compaction state from `ConversationRegistry` via
   * `TabSessionBinding`. The legacy path consulted `tab.isCompacting`
   * which could drift from the registry when StreamRouter and lifecycle
   * service raced. If the tab has no conversation binding yet we fall back
   * to the locally-stamped `lastCompactionAt` on the tab so the grace window
   * still works for unbound, post-complete tail events.
   */
  private isLateAfterCompaction(tab: TabState): boolean {
    const convId = this.tabSessionBinding.conversationFor(tab.id);
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
    // `lastCompactionAt` stamp so the post-complete grace window
    // still suppresses tail events for tabs that predate router hydration.
    const lastAt = tab.lastCompactionAt ?? null;
    if (lastAt === null) return false;
    return (
      Date.now() - lastAt < SessionStatsAggregatorService.COMPACTION_GRACE_MS
    );
  }
}
