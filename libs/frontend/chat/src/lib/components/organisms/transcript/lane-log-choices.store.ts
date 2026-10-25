import { Injectable, signal } from '@angular/core';

/** Lanes whose choices are kept; the oldest lane is dropped past this. */
const MAX_LANES = 100;

const NO_CHOICES: ReadonlyMap<string, boolean> = new Map();

/**
 * The user's work-log open choice per lane turn, kept in memory for the
 * session the same way the main transcript keeps it. A lane's component is
 * destroyed on a tab switch, so its choices live here instead.
 */
@Injectable({ providedIn: 'root' })
export class LaneLogChoicesStore {
  private readonly lanes = signal<
    ReadonlyMap<string, ReadonlyMap<string, boolean>>
  >(new Map());

  choicesFor(laneId: string): ReadonlyMap<string, boolean> {
    return this.lanes().get(laneId) ?? NO_CHOICES;
  }

  set(laneId: string, turnId: string, open: boolean): void {
    this.lanes.update((lanes) => {
      const next = new Map(lanes);
      const choices = new Map(next.get(laneId) ?? NO_CHOICES).set(
        turnId,
        open,
      );
      // Re-insert so the most recently used lane is last.
      next.delete(laneId);
      next.set(laneId, choices);
      while (next.size > MAX_LANES) next.delete(next.keys().next().value!);
      return next;
    });
  }
}
