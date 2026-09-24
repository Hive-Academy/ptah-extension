import { Injectable, Signal, computed, signal } from '@angular/core';
import type { SessionStatsEntry } from '@ptah-extension/shared';
import type { LiveModelStatsPayload } from './tab-state.types';
import {
  SessionStatsRevisionFloor,
  isValidSessionStatsSnapshot,
} from './session-stats-snapshot';

/** Everything a surface needs to render the same stats a tab shows. */
export interface SurfaceSessionStats {
  /** Primary model + context fill, or null when no window could be resolved. */
  readonly live: LiveModelStatsPayload | null;
  /**
   * The backend's session-lifetime accounting snapshot (TASK_2026_533), or
   * null before the first one arrives. Displayed as-is, never added to.
   */
  readonly snapshot: SessionStatsEntry | null;
}

/**
 * Session stats for consumers that are NOT tabs.
 *
 * A tab keeps its stats on its own `TabState`, which is the right home when one
 * exists. Workflow surfaces — New Project, the harness builder, a wizard
 * analysis phase — have no `TabState` by design, so every `session:stats` event
 * they produced had nowhere to land and was discarded. This is that home:
 * session-keyed, because a surface's identity (`SurfaceId`) is minted fresh on
 * every reload while the session it is bound to survives.
 *
 * Deliberately NOT a second source of truth for tabs. `record` is called only
 * on the no-tab branch of `SessionStatsAggregatorService`, so a session that
 * has a tab never appears here and the two can never disagree.
 */
@Injectable({ providedIn: 'root' })
export class SurfaceSessionStatsRegistry {
  private readonly _bySession = signal<
    ReadonlyMap<string, SurfaceSessionStats>
  >(new Map());

  /**
   * Revision floor per session, kept apart from the displayed snapshot so an
   * unrevisioned snapshot can neither win over nor erase it. Not cleared by
   * {@link clear}: a torn-down surface must not let an older snapshot back in.
   */
  private readonly floor = new SessionStatsRevisionFloor();

  /** Snapshot of every recorded session. Primarily for tests and debugging. */
  readonly sessions = computed<readonly string[]>(() =>
    Array.from(this._bySession().keys()),
  );

  /** Reactive accessor for one session's stats. */
  stats(sessionId: string): Signal<SurfaceSessionStats | null> {
    return computed(() => this._bySession().get(sessionId) ?? null);
  }

  /** Non-reactive read, for callers already inside a computed of their own. */
  peek(sessionId: string): SurfaceSessionStats | null {
    return this._bySession().get(sessionId) ?? null;
  }

  /**
   * Record one turn's stats for a session.
   *
   * Both halves REPLACE, mirroring the tab path (`setLiveModelStats` and
   * `installSessionStats`): `live` describes the context as of this turn and
   * `snapshot` is the backend's whole-session accounting. A turn without one
   * keeps the last one. A malformed snapshot, one for another session, or one
   * the per-session revision floor refuses (see `SessionStatsRevisionFloor`)
   * is ignored and the stored snapshot kept.
   */
  record(
    sessionId: string,
    turn: {
      readonly live: LiveModelStatsPayload | null;
      readonly snapshot: SessionStatsEntry | null;
    },
  ): void {
    if (!sessionId) return;
    const accepted = this.accepts(sessionId, turn.snapshot)
      ? turn.snapshot
      : null;
    this._bySession.update((prev) => {
      const existing = prev.get(sessionId);
      const next = new Map(prev);
      next.set(sessionId, {
        live: turn.live ?? existing?.live ?? null,
        snapshot: accepted ?? existing?.snapshot ?? null,
      });
      return next;
    });
  }

  private accepts(
    sessionId: string,
    snapshot: SessionStatsEntry | null,
  ): snapshot is SessionStatsEntry {
    return (
      snapshot !== null &&
      isValidSessionStatsSnapshot(snapshot) &&
      snapshot.sessionId === sessionId &&
      this.floor.admit(snapshot)
    );
  }

  /** Drop a session's record. Called when its surface is torn down. */
  clear(sessionId: string): void {
    this._bySession.update((prev) => {
      if (!prev.has(sessionId)) return prev;
      const next = new Map(prev);
      next.delete(sessionId);
      return next;
    });
  }
}
