import { Injectable, inject } from '@angular/core';
import { TabManagerService } from '../tab-manager.service';
import { StreamingHandlerService } from './streaming-handler.service';
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
    // Resolve the target tab by sessionId first.
    // Fallback to activeTab() only as safety net — stats can't be dropped since
    // they're the only opportunity to record cost/token data for the turn.
    let targetTab = this.tabManager.findTabBySessionId(stats.sessionId);

    // TASK_2025_098: Clear compaction state when new message finishes
    // This indicates compaction (if any) has completed successfully
    this.compactionLifecycle.clearCompactionState(targetTab?.id);
    if (!targetTab) {
      targetTab = this.tabManager.activeTab();
      if (targetTab) {
        console.warn(
          '[ChatStore] handleSessionStats: findTabBySessionId failed, fell back to activeTab',
          { sessionId: stats.sessionId, activeTabId: targetTab.id },
        );
      }
    }

    // Process modelUsage to update liveModelStats for context display
    if (stats.modelUsage && stats.modelUsage.length > 0) {
      // Select the model with the highest cost as the user's primary model.
      // The live stream path sorts modelUsage[0] by initialModel match then
      // outputTokens, while the history path sorts by costUSD. As a unified
      // safety net we pick the highest-cost model, ensuring the user's main
      // model (e.g. Opus) is shown even when a cheaper subagent (e.g. Haiku)
      // produces more output tokens.
      const primaryModel =
        stats.modelUsage.length === 1
          ? stats.modelUsage[0]
          : stats.modelUsage.reduce((best, current) =>
              current.costUSD > best.costUSD ? current : best,
            );
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

      if (targetTab) {
        this.tabManager.updateTab(targetTab.id, {
          liveModelStats: {
            model: primaryModel.model,
            contextUsed,
            contextWindow: primaryModel.contextWindow,
            contextPercent,
          },
          modelUsageList: stats.modelUsage,
        });
      }
    }

    // Bug 2 fix: Accumulate preloadedStats with new turn data
    // When a loaded historical session gets new messages, the preloadedStats
    // must be updated so the stats summary shows the combined totals.
    if (targetTab?.preloadedStats) {
      this.tabManager.updateTab(targetTab.id, {
        preloadedStats: {
          ...targetTab.preloadedStats,
          totalCost: targetTab.preloadedStats.totalCost + stats.cost,
          tokens: {
            input: targetTab.preloadedStats.tokens.input + stats.tokens.input,
            output:
              targetTab.preloadedStats.tokens.output + stats.tokens.output,
            cacheRead:
              targetTab.preloadedStats.tokens.cacheRead +
              (stats.tokens.cacheRead ?? 0),
            cacheCreation:
              targetTab.preloadedStats.tokens.cacheCreation +
              (stats.tokens.cacheCreation ?? 0),
          },
          messageCount: targetTab.preloadedStats.messageCount + 1,
        },
      });
    }

    // StreamingHandler finalizes the message and returns queued content info
    const result = this.streamingHandler.handleSessionStats(stats);

    // Refresh sidebar so session's lastActiveAt timestamp is updated
    this.sessionLoader.loadSessions().catch((err) => {
      console.warn('[ChatStore] Failed to refresh sessions after stats:', err);
    });

    // TASK_2025_101: Handle auto-send of queued content here to avoid circular dependency
    // (StreamingHandler → MessageSender → SessionLoader → StreamingHandler)
    // TASK_2025_185: Use sendQueuedMessage for consistent error handling with queue restoration
    if (result && result.queuedContent && result.queuedContent.trim()) {
      this.messageDispatch.sendQueuedMessage(
        result.tabId,
        result.queuedContent,
      );
    }
  }
}
