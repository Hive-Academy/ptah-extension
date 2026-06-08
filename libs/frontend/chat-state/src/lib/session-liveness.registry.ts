import { Injectable, Signal, computed, signal } from '@angular/core';

export type LivenessStatus =
  | 'streaming'
  | 'awaiting-background'
  | 'idle'
  | 'failed';

@Injectable({ providedIn: 'root' })
export class SessionLivenessRegistry {
  private readonly _statuses = signal<ReadonlyMap<string, LivenessStatus>>(
    new Map(),
  );

  readonly statuses = this._statuses.asReadonly();

  status(sessionId: string): Signal<LivenessStatus | undefined> {
    return computed(() => this._statuses().get(sessionId));
  }

  markStreaming(sessionId: string): void {
    this.set(sessionId, 'streaming');
  }

  markAwaitingBackground(sessionId: string): void {
    this.set(sessionId, 'awaiting-background');
  }

  markIdle(sessionId: string): void {
    this.set(sessionId, 'idle');
  }

  markFailed(sessionId: string): void {
    this.set(sessionId, 'failed');
  }

  clear(sessionId: string): void {
    this._statuses.update((prev) => {
      if (!prev.has(sessionId)) return prev;
      const next = new Map(prev);
      next.delete(sessionId);
      return next;
    });
  }

  private set(sessionId: string, status: LivenessStatus): void {
    if (!sessionId) return;
    this._statuses.update((prev) => {
      if (prev.get(sessionId) === status) return prev;
      const next = new Map(prev);
      next.set(sessionId, status);
      return next;
    });
  }
}
