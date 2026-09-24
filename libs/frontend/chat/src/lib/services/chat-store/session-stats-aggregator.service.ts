import { Injectable, inject } from '@angular/core';
import {
  ConversationRegistry,
  SurfaceSessionStatsRegistry,
  TabManagerService,
  isValidSessionStatsSnapshot,
  type ClaudeSessionId,
} from '@ptah-extension/chat-state';
import { StreamRouter } from '@ptah-extension/chat-routing';
import { StreamingHandlerService } from '@ptah-extension/chat-streaming';
import type { TabState } from '@ptah-extension/chat-types';
import { SessionId, type SessionStatsEntry } from '@ptah-extension/shared';
import {
  deriveLiveModelStats,
  type TurnModelUsage,
} from './session-live-stats.util';
import { SessionLoaderService } from './session-loader.service';
import { CompactionLifecycleService } from './compaction-lifecycle.service';
import { MessageDispatchService } from './message-dispatch.service';

/**
 * A `session:stats` broadcast for one SDK result: the per-result footer fields
 * (forwarded unchanged to the streaming handler) plus, when the backend has
 * one, its session-lifetime snapshot.
 */
export interface SessionStatsResultEvent {
  readonly sessionId: string;
  readonly cost: number | null;
  readonly tokens: {
    readonly input: number;
    readonly output: number;
    readonly cacheRead?: number;
    readonly cacheCreation?: number;
  };
  readonly duration: number;
  readonly modelUsage?: TurnModelUsage[];
  /** Wire contract only: validated before it is installed. */
  readonly sessionStats?: SessionStatsEntry;
}

/**
 * A `session:stats` broadcast that carries only a session snapshot and no
 * per-turn footer fields. It is an accounting update, not a turn result.
 */
export interface SessionStatsSnapshotEvent {
  readonly sessionId: string;
  readonly sessionStats?: SessionStatsEntry;
  readonly cost?: undefined;
  readonly tokens?: undefined;
  readonly duration?: undefined;
  readonly modelUsage?: undefined;
}

/** One `session:stats` broadcast, as the webview receives it. */
export type SessionStatsEvent =
  SessionStatsResultEvent | SessionStatsSnapshotEvent;

/**
 * True when no per-turn footer field is present. A zero or `null` cost is a
 * present field; only an absent (`undefined`) one counts as missing.
 */
function isSnapshotOnly(
  stats: SessionStatsEvent,
): stats is SessionStatsSnapshotEvent {
  return (
    stats.cost === undefined &&
    stats.tokens === undefined &&
    stats.duration === undefined
  );
}

/**
 * SessionStatsAggregatorService - Process SESSION_STATS events from the backend.
 *
 * Responsibilities:
 * - Route incoming stats to the correct tab (or to a workflow surface)
 * - Derive the context badge (`liveModelStats`) from the turn's modelUsage:
 *   pick the primary model, use only its latest main-request context frame
 * - Validate and INSTALL the backend's session snapshot (`sessionStats`) —
 *   assignment only. Session totals are never added up here (TASK_2026_533).
 * - Forward the per-result footer fields to StreamingHandlerService unchanged
 * - Trigger sidebar refresh + auto-send re-steering
 *
 * A snapshot-only broadcast installs its snapshot and stops there: it is not a
 * turn result, so compaction clearing, footer forwarding (which would overwrite
 * a finalized message's cost/tokens/duration with `undefined`), the sidebar
 * refresh and queued-message handling do not run.
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
   * @param stats - Per-result footer fields plus the backend session snapshot
   */
  handleSessionStats(stats: SessionStatsEvent): void {
    let targetTabs: readonly TabState[] = this.tabManager.findTabsBySessionId(
      SessionId.from(stats.sessionId),
    );
    if (targetTabs.length === 0) {
      // `findTabsBySessionId` resolves active-workspace tabs only. A turn that
      // ends while its tab sits in a BACKGROUND workspace (user switched
      // folders mid-stream) still owns these stats. Every tab setter below
      // routes through the workspace-aware `updateTabInternal`, and
      // `streamingHandler.handleSessionStats` has its own background branch,
      // so the normal path is safe for a partitioned tab — mirrors
      // `TurnEndHandlerService` / `StreamingHandlerService`.
      const lookup = this.tabManager.findTabBySessionIdAcrossWorkspaces(
        stats.sessionId,
      );
      if (lookup) targetTabs = [lookup.tab];
    }
    const snapshot = this.snapshotFor(stats);
    if (isSnapshotOnly(stats)) {
      if (targetTabs.length === 0) {
        this.recordSurfaceStats(stats, snapshot);
      } else if (snapshot) {
        for (const t of targetTabs) {
          this.tabManager.installSessionStats(t.id, snapshot);
        }
      }
      return;
    }
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
      this.recordSurfaceStats(stats, snapshot);
      return;
    }
    if (snapshot) {
      for (const t of targetTabs) {
        this.tabManager.installSessionStats(t.id, snapshot);
      }
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

      if (derived) {
        for (const t of targetTabs) {
          this.tabManager.setLiveModelStats(t.id, derived.live);
        }
      }
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
  private recordSurfaceStats(
    stats: SessionStatsEvent,
    snapshot: SessionStatsEntry | null,
  ): void {
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
      snapshot,
    });
  }

  /**
   * The event's session snapshot, or null when it carries none, is malformed
   * (see `isValidSessionStatsSnapshot`), or names a different session than the
   * event itself (routing would install it on the wrong tab). A malformed
   * snapshot is rejected whole with one warning that names only the session.
   */
  private snapshotFor(stats: SessionStatsEvent): SessionStatsEntry | null {
    const snapshot: unknown = stats.sessionStats;
    if (snapshot === undefined || snapshot === null) return null;
    if (!isValidSessionStatsSnapshot(snapshot)) {
      console.warn(
        '[ChatStore] handleSessionStats: rejected a malformed session snapshot',
        { sessionId: stats.sessionId },
      );
      return null;
    }
    if (snapshot.sessionId !== stats.sessionId) {
      console.warn(
        '[ChatStore] handleSessionStats: session snapshot names a different session, ignoring it',
        { sessionId: stats.sessionId, snapshotSessionId: snapshot.sessionId },
      );
      return null;
    }
    return snapshot;
  }
}
