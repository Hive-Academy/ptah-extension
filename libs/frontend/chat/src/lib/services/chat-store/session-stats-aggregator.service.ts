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
import {
  SessionId,
  type ResultStatsPayload,
  type SessionBudgetState,
  type SessionHandoverState,
  type SessionStatsEntry,
  type SessionStatsLiveWire,
} from '@ptah-extension/shared';
import {
  deriveLiveModelStats,
  type TurnModelUsage,
} from './session-live-stats.util';
import { SessionLoaderService } from './session-loader.service';
import { CompactionLifecycleService } from './compaction-lifecycle.service';
import { MessageDispatchService } from './message-dispatch.service';
import { SessionHandoverClientService } from '../session-handover-client.service';

/**
 * A `session:stats` broadcast for one SDK result, as the webview receives it.
 *
 * Derived from the shared wire type so a rename of any footer field on
 * `ResultStatsPayload` fails typecheck here instead of silently reading
 * `undefined` (TASK_2026_575, R2). `turnCost` is that turn's own spend
 * (`null` = unknown), forwarded unchanged to the streaming handler for the
 * message footer; `sessionStats` is the backend's session-lifetime snapshot,
 * validated and installed as-is for the header. The two are never combined.
 *
 * Two fields are narrowed for the webview: `sessionId` is the raw wire string
 * (routing parses it), and `modelUsage` uses {@link TurnModelUsage}, the shape
 * the context-badge derivation reads. Its `costUSD` keeps the wire's `null`
 * for an unpriced model; it is forwarded unchanged, never coerced to 0.
 */
export type SessionStatsResultEvent = Omit<
  ResultStatsPayload,
  'sessionId' | 'modelUsage'
> & {
  readonly sessionId: string;
  readonly modelUsage?: TurnModelUsage[];
  readonly handover?: SessionHandoverState;
};

/**
 * A `session:stats` broadcast that carries only a session snapshot and no
 * per-turn footer fields. It is an accounting update, not a turn result.
 */
export interface SessionStatsSnapshotEvent {
  readonly sessionId: string;
  readonly sessionStats?: SessionStatsEntry;
  /** `null` clears known-absent state; `undefined` keeps the last budget. */
  readonly budget?: SessionBudgetState | null;
  /** Revisioned coordinator state; it may arrive before terminal turn_state. */
  readonly handover?: SessionHandoverState;
  readonly turnCost?: undefined;
  readonly tokens?: undefined;
  readonly duration?: undefined;
  readonly modelUsage?: undefined;
}

/** One `session:stats` broadcast, as the webview receives it. */
export type SessionStatsEvent =
  SessionStatsResultEvent | SessionStatsSnapshotEvent;

/**
 * True when no per-turn footer field is present. A zero or `null` turn cost is
 * a present field; only an absent (`undefined`) one counts as missing.
 */
function isSnapshotOnly(
  stats: SessionStatsEvent,
): stats is SessionStatsSnapshotEvent {
  return (
    stats.turnCost === undefined &&
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
 * - Install `session:stats-live` snapshots on the header only
 *   ({@link SessionStatsAggregatorService.handleLiveSessionStats})
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
  private readonly handoverClient = inject(SessionHandoverClientService);

  /**
   * Handle session stats update from backend
   * Delegates to StreamingHandlerService
   *
   * @param stats - Per-result footer fields plus the backend session snapshot
   */
  handleSessionStats(stats: SessionStatsEvent): void {
    if (stats.handover) {
      this.handoverClient.record(stats.sessionId, stats.handover);
    }
    const targetTabs = this.tabsForSession(SessionId.from(stats.sessionId));
    const snapshot = this.snapshotFor(stats, 'handleSessionStats');
    if (isSnapshotOnly(stats)) {
      if (targetTabs.length === 0) {
        this.recordSurfaceStats(stats, snapshot);
      } else if (snapshot) {
        for (const t of targetTabs) {
          this.tabManager.installSessionStats(t.id, snapshot, stats.budget);
        }
      }
      return;
    }
    for (const t of targetTabs) {
      this.compactionLifecycle.clearCompactionState(t.id);
      // The live stage was an estimate for this turn; the result ends it.
      this.tabManager.setLiveBudgetStage(t.id, stats.sessionId, null);
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
        this.tabManager.installSessionStats(t.id, snapshot, stats.budget);
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
   * Apply one `session:stats-live` update to the header (TASK_2026_626).
   *
   * The same for a provisional estimate and for an authoritative snapshot
   * (agent-count update, settle): `provisional` only changes the header
   * marker. This is never a turn result, so none of the `session:stats`
   * result-path effects run here — no compaction clearing, no footer or
   * `pendingStats` write (`streamingHandler.handleSessionStats`), no sidebar
   * refresh, no queued send, no handover record and no `setLiveModelStats`.
   * Turn finalization stays with `turn_state`.
   *
   * Every bound tab, in any workspace, installs through `installSessionStats`
   * with the event's context, which admits the snapshot
   * and applies the context reading in one update, so a snapshot the revision
   * floor rejects carries no context with it. The display-only
   * `liveBudgetStage` follows the same admission (TASK_2026_627 D25); the
   * turn's result clears it in {@link handleSessionStats}. A session with no tab records
   * only the snapshot on its surface (`live: null` keeps the stored reading);
   * an unknown session is dropped without a warning, because live events for
   * a session being torn down are expected.
   */
  handleLiveSessionStats(event: SessionStatsLiveWire): void {
    const sessionId = SessionId.safeParse(event.sessionId);
    if (!sessionId) {
      console.warn(
        '[ChatStore] handleLiveSessionStats: dropped an update with a malformed session id',
        { sessionId: event.sessionId },
      );
      return;
    }
    const snapshot = this.snapshotFor(event, 'handleLiveSessionStats');
    if (!snapshot) return;
    const targetTabs = this.tabsForSession(sessionId);
    if (targetTabs.length === 0) {
      if (this.streamRouter.surfacesForSession(sessionId).length === 0) return;
      this.surfaceStats.record(event.sessionId, { live: null, snapshot });
      return;
    }
    const liveStage = event.liveBudgetStage;
    for (const t of targetTabs) {
      // `undefined` budget keeps each tab's last budget; each tab runs its own
      // admission, and the context is applied only for a provisional snapshot.
      const accepted = this.tabManager.installSessionStats(
        t.id,
        snapshot,
        undefined,
        event.context,
      );
      // D25: an absent stage keeps the shown one; `null` clears it; a value
      // sets it. Only a payload the revision floor accepted may change it.
      if (accepted && liveStage !== undefined) {
        this.tabManager.setLiveBudgetStage(t.id, event.sessionId, liveStage);
      }
    }
  }

  /**
   * Every tab bound to a session, in the active workspace AND every
   * background workspace.
   *
   * `findTabsBySessionId` resolves active-workspace tabs only. A session open
   * in several tabs can have some of them in a BACKGROUND workspace (user
   * switched folders mid-stream); each still shows the session's stats, so
   * each must receive the update, or it keeps stale figures or an estimate
   * marker. Every tab setter routes through the workspace-aware
   * `updateTabInternal`, each install runs its own revision admission, and
   * `streamingHandler.handleSessionStats` has its own background branch, so
   * the normal path is safe for a partitioned tab. Deduplicated by id because
   * the active lookup's unbound fallback can itself return a background tab.
   */
  private tabsForSession(sessionId: SessionId): readonly TabState[] {
    const tabs = [...this.tabManager.findTabsBySessionId(sessionId)];
    const seen = new Set(tabs.map((t) => t.id));
    for (const t of this.tabManager.findBackgroundTabsBySessionId(sessionId)) {
      if (!seen.has(t.id)) {
        seen.add(t.id);
        tabs.push(t);
      }
    }
    return tabs;
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
  private snapshotFor(
    stats: {
      readonly sessionId: string;
      readonly sessionStats?: SessionStatsEntry;
    },
    handler: 'handleSessionStats' | 'handleLiveSessionStats',
  ): SessionStatsEntry | null {
    const snapshot: unknown = stats.sessionStats;
    if (snapshot === undefined || snapshot === null) return null;
    if (!isValidSessionStatsSnapshot(snapshot)) {
      console.warn(
        `[ChatStore] ${handler}: rejected a malformed session snapshot`,
        { sessionId: stats.sessionId },
      );
      return null;
    }
    if (snapshot.sessionId !== stats.sessionId) {
      console.warn(
        `[ChatStore] ${handler}: session snapshot names a different session, ignoring it`,
        { sessionId: stats.sessionId, snapshotSessionId: snapshot.sessionId },
      );
      return null;
    }
    return snapshot;
  }
}
