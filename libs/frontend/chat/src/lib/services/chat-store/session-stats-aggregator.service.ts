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
 * Responsibilities:
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
    let targetTabs: readonly TabState[] = this.tabManager.findTabsBySessionId(
      SessionId.from(stats.sessionId),
    );
    const filteredTabs = targetTabs.filter(
      (t) => !this.isLateAfterCompaction(t),
    );
    if (filteredTabs.length === 0 && targetTabs.length > 0) {
      console.warn(
        '[ChatStore] handleSessionStats: dropped late event after compaction',
        { sessionId: stats.sessionId },
      );
      return;
    }
    targetTabs = filteredTabs;
    for (const t of targetTabs) {
      this.compactionLifecycle.clearCompactionState(t.id);
    }
    if (targetTabs.length === 0) {
      console.warn(
        '[ChatStore] handleSessionStats: no tab bound to sessionId, dropping event',
        { sessionId: stats.sessionId },
      );
      return;
    }
    if (stats.modelUsage && stats.modelUsage.length > 0) {
      const entries: ModelUsageEntry[] = stats.modelUsage.map((m) => ({
        model: m.model,
        totalCost: m.costUSD,
        tokens: {
          input: m.inputTokens,
          output: m.outputTokens,
          cacheRead: m.cacheReadInputTokens,
        },
      }));
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
      const tabHasCompacted = targetTabs.some(
        (t) =>
          (t.lastCompactionAt ?? null) !== null || (t.compactionCount ?? 0) > 0,
      );
      const useCumulativeFallback = primaryModel.lastTurnContextTokens == null;
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
    const result = this.streamingHandler.handleSessionStats(stats);
    this.sessionLoader.loadSessions().catch((err) => {
      console.warn('[ChatStore] Failed to refresh sessions after stats:', err);
    });
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
    const lastAt = tab.lastCompactionAt ?? null;
    if (lastAt === null) return false;
    return (
      Date.now() - lastAt < SessionStatsAggregatorService.COMPACTION_GRACE_MS
    );
  }
}
