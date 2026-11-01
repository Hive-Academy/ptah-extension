import { Injectable, computed, signal } from '@angular/core';
import type {
  BackgroundTaskSnapshotEntry,
  BackgroundTasksSnapshotEvent,
} from '@ptah-extension/shared';

/** SDK level signal for non-ambient work, scoped to the owning session. */
@Injectable({ providedIn: 'root' })
export class BackgroundTaskStore {
  private readonly snapshots = signal<ReadonlyMap<string, readonly BackgroundTaskSnapshotEntry[]>>(new Map());
  readonly sessions = computed(() => this.snapshots());

  tasksForSession(sessionId: string | null): readonly BackgroundTaskSnapshotEntry[] {
    return sessionId ? this.snapshots().get(sessionId) ?? [] : [];
  }

  replace(event: BackgroundTasksSnapshotEvent): void {
    const next = new Map(this.snapshots());
    if (event.tasks.length) next.set(event.sessionId, [...event.tasks]);
    else next.delete(event.sessionId);
    this.snapshots.set(next);
  }

  clearSession(sessionId: string): void {
    if (!this.snapshots().has(sessionId)) return;
    const next = new Map(this.snapshots());
    next.delete(sessionId);
    this.snapshots.set(next);
  }
}
