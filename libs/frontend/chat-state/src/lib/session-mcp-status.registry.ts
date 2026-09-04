import { Injectable, Signal, computed, signal } from '@angular/core';
import type {
  SessionMcpNotice,
  SessionMcpServerEntry,
} from '@ptah-extension/shared';

/** One session's MCP picture, as the backend last reported it. */
export interface SessionMcpStatus {
  readonly servers: readonly SessionMcpServerEntry[];
  readonly notices: readonly SessionMcpNotice[];
}

/**
 * Upper bound for the map; the least-recently-written session is evicted.
 *
 * Matches `SurfaceSessionStatsRegistry`'s sibling concern rather than any
 * backend constant: one entry is a session id plus a handful of short strings,
 * and the webview outlives many sessions. Losing an entry costs the chip its
 * contents until the next `session:status` read, never a wrong answer.
 */
export const MCP_STATUS_MAP_LIMIT = 128;

const EMPTY: SessionMcpStatus = { servers: [], notices: [] };

/**
 * Per-session MCP status for the chat header chip (TASK_2026_375 B4.4).
 *
 * Session-keyed rather than tab-keyed, and deliberately so: a canvas tile and
 * the main panel can show the same session, and the backend's own record is
 * session-keyed too. It follows `SurfaceSessionStatsRegistry`, which is the
 * pattern this lib already uses for `session:stats` state that outlives any one
 * surface.
 *
 * ## Two keys for one session, on purpose
 *
 * A fresh session streams under its tabId until the SDK reports the real UUID.
 * The backend re-keys its own record when that happens, but a push that already
 * reached the webview under the tabId stays under the tabId here. `statusFor`
 * therefore takes both ids and answers on the first that has a record, newest
 * write first. Cheaper and more honest than mirroring the backend's re-key
 * across a channel that carries no re-key event.
 */
@Injectable({ providedIn: 'root' })
export class SessionMcpStatusRegistry {
  private readonly _bySession = signal<ReadonlyMap<string, SessionMcpStatus>>(
    new Map(),
  );

  /** Snapshot of every recorded session. Primarily for tests and debugging. */
  readonly sessions = computed<readonly string[]>(() =>
    Array.from(this._bySession().keys()),
  );

  /**
   * Reactive accessor for one session, falling back to a second id.
   *
   * Pass the SDK session id first and the tabId second: the SDK id is the one
   * the backend settles on, so it wins whenever both hold a record.
   */
  statusFor(
    sessionId: string | null,
    fallbackId?: string | null,
  ): Signal<SessionMcpStatus | null> {
    return computed(() => {
      const map = this._bySession();
      if (sessionId) {
        const hit = map.get(sessionId);
        if (hit) return hit;
      }
      if (fallbackId) {
        const hit = map.get(fallbackId);
        if (hit) return hit;
      }
      return null;
    });
  }

  /** Non-reactive read, for callers already inside a computed of their own. */
  peek(sessionId: string): SessionMcpStatus | null {
    return this._bySession().get(sessionId) ?? null;
  }

  /**
   * Replace one session's status.
   *
   * REPLACE, not merge: the backend already folds its two producers into one
   * record and pushes the whole thing, so a merge here would be a second,
   * divergent copy of that rule.
   */
  record(sessionId: string, status: SessionMcpStatus): void {
    if (!sessionId) return;
    const next = new Map(this._bySession());
    next.delete(sessionId);
    if (next.size >= MCP_STATUS_MAP_LIMIT) {
      const oldest = next.keys().next().value;
      if (oldest !== undefined) next.delete(oldest);
    }
    next.set(sessionId, {
      servers: status.servers ?? EMPTY.servers,
      notices: status.notices ?? EMPTY.notices,
    });
    this._bySession.set(next);
  }

  /** Forget one session. */
  clear(sessionId: string): void {
    if (!this._bySession().has(sessionId)) return;
    const next = new Map(this._bySession());
    next.delete(sessionId);
    this._bySession.set(next);
  }
}
