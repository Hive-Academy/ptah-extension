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

@Injectable({ providedIn: 'root' })
export class SessionLivenessRegistry {
  private readonly _statuses = signal<ReadonlyMap<string, LivenessStatus>>(
    new Map(),
  );

  private readonly _workspaces = signal<ReadonlyMap<string, string>>(new Map());

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
    return computed(() => this._statuses().get(sessionId));
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

  clear(sessionId: string): void {
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
    sessionId: string,
    status: LivenessStatus,
    workspacePath?: string,
  ): void {
    if (!sessionId) return;
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
