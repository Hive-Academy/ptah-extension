import { Injectable, Signal, computed, signal } from '@angular/core';

export type LivenessStatus =
  | 'streaming'
  | 'awaiting-background'
  | 'idle'
  | 'failed';

const LIVE_STATUSES: ReadonlySet<LivenessStatus> = new Set([
  'streaming',
  'awaiting-background',
]);

/**
 * Session liveness, keyed by the CANONICAL session id.
 *
 * A brand-new session streams under a placeholder id (its tab id) for the
 * whole life of the stream, while `session:id-resolved`, `session:turnEnded`
 * and `session:stats` carry the real SDK uuid. Without an alias the two ids
 * are two entries: chunks keep the placeholder `'streaming'` forever and the
 * terminal events mark a different key idle — the workspace "Session running"
 * dot then never clears once the owning tab is backgrounded. `rekey()` folds
 * the placeholder into the real id and every later mark under either id lands
 * on the same entry.
 */
@Injectable({ providedIn: 'root' })
export class SessionLivenessRegistry {
  private readonly _statuses = signal<ReadonlyMap<string, LivenessStatus>>(
    new Map(),
  );

  private readonly _workspaces = signal<ReadonlyMap<string, string>>(new Map());

  /** placeholder id → canonical id. Plain map: aliases never drive rendering. */
  private readonly _aliases = new Map<string, string>();

  readonly statuses = this._statuses.asReadonly();

  readonly liveWorkspaces: Signal<ReadonlySet<string>> = computed(() => {
    const statuses = this._statuses();
    const workspaces = this._workspaces();
    const live = new Set<string>();
    for (const [sessionId, status] of statuses) {
      if (!LIVE_STATUSES.has(status)) continue;
      const ws = workspaces.get(sessionId);
      if (ws) live.add(ws);
    }
    return live;
  });

  status(sessionId: string): Signal<LivenessStatus | undefined> {
    return computed(() => this._statuses().get(this.canonical(sessionId)));
  }

  /**
   * Fold `placeholderId` into `realId`. The placeholder's status and workspace
   * move onto the real id (the real id's own values win when both exist), the
   * placeholder entry is dropped, and every later mark under the placeholder
   * resolves to the real id. Idempotent; a self-alias is a no-op.
   */
  rekey(placeholderId: string, realId: string): void {
    if (!placeholderId || !realId || placeholderId === realId) return;
    const from = this.canonical(placeholderId);
    if (from === realId) return;
    this._aliases.set(placeholderId, realId);
    // Re-point aliases that resolved to the old canonical id.
    for (const [alias, target] of this._aliases) {
      if (target === from) this._aliases.set(alias, realId);
    }
    this._statuses.update((prev) => {
      const moved = prev.get(from);
      if (moved === undefined) return prev;
      const next = new Map(prev);
      next.delete(from);
      if (!next.has(realId)) next.set(realId, moved);
      return next;
    });
    this._workspaces.update((prev) => {
      const moved = prev.get(from);
      if (moved === undefined) return prev;
      const next = new Map(prev);
      next.delete(from);
      if (!next.has(realId)) next.set(realId, moved);
      return next;
    });
  }

  private canonical(sessionId: string): string {
    return this._aliases.get(sessionId) ?? sessionId;
  }

  markStreaming(sessionId: string, workspacePath?: string): void {
    this.set(sessionId, 'streaming', workspacePath);
  }

  markAwaitingBackground(sessionId: string, workspacePath?: string): void {
    this.set(sessionId, 'awaiting-background', workspacePath);
  }

  markIdle(sessionId: string, workspacePath?: string): void {
    this.set(sessionId, 'idle', workspacePath);
  }

  markFailed(sessionId: string, workspacePath?: string): void {
    this.set(sessionId, 'failed', workspacePath);
  }

  clear(rawSessionId: string): void {
    const sessionId = this.canonical(rawSessionId);
    for (const [alias, target] of this._aliases) {
      if (target === sessionId) this._aliases.delete(alias);
    }
    this._statuses.update((prev) => {
      if (!prev.has(sessionId)) return prev;
      const next = new Map(prev);
      next.delete(sessionId);
      return next;
    });
    this._workspaces.update((prev) => {
      if (!prev.has(sessionId)) return prev;
      const next = new Map(prev);
      next.delete(sessionId);
      return next;
    });
  }

  private set(
    rawSessionId: string,
    status: LivenessStatus,
    workspacePath?: string,
  ): void {
    if (!rawSessionId) return;
    const sessionId = this.canonical(rawSessionId);
    this._statuses.update((prev) => {
      if (prev.get(sessionId) === status) return prev;
      const next = new Map(prev);
      next.set(sessionId, status);
      return next;
    });
    if (workspacePath) {
      this._workspaces.update((prev) => {
        if (prev.get(sessionId) === workspacePath) return prev;
        const next = new Map(prev);
        next.set(sessionId, workspacePath);
        return next;
      });
    }
  }
}
