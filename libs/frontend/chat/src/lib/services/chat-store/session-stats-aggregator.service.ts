import { Injectable, inject } from '@angular/core';
import {
  ConversationRegistry,
  SurfaceSessionStatsRegistry,
  TabManagerService,
  type ClaudeSessionId,
} from '@ptah-extension/chat-state';
import { StreamRouter } from '@ptah-extension/chat-routing';
import { StreamingHandlerService } from '@ptah-extension/chat-streaming';
import type { TabState } from '@ptah-extension/chat-types';
import { SessionId } from '@ptah-extension/shared';
import {
  deriveLiveModelStats,
  type TurnModelUsage,
} from './session-live-stats.util';
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
  private readonly streamRouter = inject(StreamRouter);
  private readonly conversationRegistry = inject(ConversationRegistry);
  private readonly surfaceStats = inject(SurfaceSessionStatsRegistry);
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
    const targetTabs: readonly TabState[] = this.tabManager.findTabsBySessionId(
      SessionId.from(stats.sessionId),
    );
    for (const t of targetTabs) {
      this.compactionLifecycle.clearCompactionState(t.id);
    }
    if (targetTabs.length === 0) {
      // A workflow surface — New Project / harness builder / a wizard analysis
      // phase — owns sessions that have no tab BY DESIGN, so every one of its
      // turns used to land here and be discarded as "dropping event". Nothing
      // below applies (there is no `TabState` to write), but the stats
      // themselves are perfectly good: record them session-keyed so the
      // surface can render the same header a tab gets.
      this.recordSurfaceStats(stats);
      return;
    }
    if (stats.modelUsage && stats.modelUsage.length > 0) {
      const stickyModelName = ((): string | null => {
        for (const t of targetTabs) {
          if (t.sessionModel) return t.sessionModel;
        }
        return null;
      })();
      const derived = deriveLiveModelStats(stats.modelUsage, {
        stickyModel: stickyModelName,
        hasCompacted: targetTabs.some(
          (t) =>
            (t.lastCompactionAt ?? null) !== null ||
            (t.compactionCount ?? 0) > 0,
        ),
      });

      if (derived && derived.live) {
        for (const t of targetTabs) {
          this.tabManager.setLiveModelStatsAndUsageList(
            t.id,
            derived.live,
            stats.modelUsage,
          );
        }
      } else if (derived) {
        for (const t of targetTabs) {
          this.tabManager.setModelUsageList(t.id, stats.modelUsage);
        }
        console.warn(
          '[ChatStore] handleSessionStats: suppressed context-fill update (cumulative fallback over window/post-compaction); preserved per-model breakdown',
          {
            sessionId: stats.sessionId,
            model: derived.primaryModel.model,
            inputTokens: derived.primaryModel.inputTokens,
          },
        );
      }
    }
    for (const t of targetTabs) {
      if (!t.preloadedStats) continue;
      const prevCost = t.preloadedStats.totalCost;
      const turnCost = stats.cost;
      const nextCost =
        turnCost === null ? prevCost : (prevCost ?? 0) + turnCost;
      this.tabManager.setPreloadedStats(t.id, {
        ...t.preloadedStats,
        totalCost: nextCost,
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
   * Fold a turn's stats into the surface registry for a session with no tab.
   *
   * Uses the same {@link deriveLiveModelStats} the tab path does, so the New
   * Project panel and a chat tab cannot report different context fills for the
   * same turn. `hasCompacted` comes from the conversation record rather than a
   * `TabState`, which is the only part that legitimately differs.
   *
   * A session the router knows nothing about is still a genuine drop and still
   * warns — that case means routing lost the event, which is a bug.
   */
  private recordSurfaceStats(stats: {
    sessionId: string;
    cost: number;
    tokens: {
      input: number;
      output: number;
      cacheRead?: number;
      cacheCreation?: number;
    };
    modelUsage?: TurnModelUsage[];
  }): void {
    const sessionId = stats.sessionId as ClaudeSessionId;
    if (this.streamRouter.surfacesForSession(sessionId).length === 0) {
      console.warn(
        '[ChatStore] handleSessionStats: no tab bound to sessionId, dropping event',
        { sessionId: stats.sessionId },
      );
      return;
    }

    const conversation =
      this.conversationRegistry.findContainingSession(sessionId);
    const derived = stats.modelUsage?.length
      ? deriveLiveModelStats(stats.modelUsage, {
          // The conversation record is the surface's equivalent of a tab's
          // `lastCompactionAt` / `compactionCount` pair.
          hasCompacted: (conversation?.lastCompactionAt ?? null) !== null,
        })
      : null;

    this.surfaceStats.record(stats.sessionId, {
      live: derived?.live ?? null,
      modelUsage: stats.modelUsage ?? null,
      cost: stats.cost,
      tokens: stats.tokens,
    });
  }
}
