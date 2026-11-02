import { Injectable, computed, signal } from '@angular/core';
import type {
  BackgroundTaskSnapshotEntry,
  BackgroundTasksSnapshotEvent,
} from '@ptah-extension/shared';

/** SDK level signal for non-ambient work, scoped to the owning session. */
@Injectable({ providedIn: 'root' })
export class BackgroundTaskStore {
  private readonly snapshots = signal<
    ReadonlyMap<string, readonly BackgroundTaskSnapshotEntry[]>
  >(new Map());
  private readonly firstSeen = signal<
    ReadonlyMap<string, ReadonlyMap<string, number>>
  >(new Map());
  readonly sessions = computed(() => this.snapshots());

  tasksForSession(
    sessionId: string | null,
  ): readonly BackgroundTaskSnapshotEntry[] {
    return sessionId ? (this.snapshots().get(sessionId) ?? []) : [];
  }

  firstSeenAt(sessionId: string | null, taskId: string): number | null {
    return sessionId
      ? (this.firstSeen().get(sessionId)?.get(taskId) ?? null)
      : null;
  }

  replace(event: BackgroundTasksSnapshotEvent): void {
    const next = new Map(this.snapshots());
    const nextFirstSeen = new Map(this.firstSeen());
    if (event.tasks.length) {
      next.set(event.sessionId, [...event.tasks]);
      const prior = this.firstSeen().get(event.sessionId);
      const observedAt = Date.now();
      nextFirstSeen.set(
        event.sessionId,
        new Map(
          event.tasks.map((task) => [
            task.taskId,
            prior?.get(task.taskId) ?? observedAt,
          ]),
        ),
      );
    } else {
      next.delete(event.sessionId);
      nextFirstSeen.delete(event.sessionId);
    }
    this.firstSeen.set(nextFirstSeen);
    this.snapshots.set(next);
  }

  clearSession(sessionId: string): void {
    if (!this.snapshots().has(sessionId)) return;
    const next = new Map(this.snapshots());
    next.delete(sessionId);
    const nextFirstSeen = new Map(this.firstSeen());
    nextFirstSeen.delete(sessionId);
    this.firstSeen.set(nextFirstSeen);
    this.snapshots.set(next);
  }
}
