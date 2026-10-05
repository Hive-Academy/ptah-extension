import { Injectable, signal } from '@angular/core';

/** Expansion key: session id plus a stable tile id, never a render index. */
export function statsTileKey(sessionId: string, tileId: string): string {
  return `${sessionId}::${tileId}`;
}

/**
 * Open/closed state of the stats-grid tiles (TASK_2026_596, Component 15;
 * design §3.3 A3).
 *
 * View-scoped on purpose — NOT `providedIn: 'root'`. The chat view lists it
 * in its own `providers`, so each view has one instance, released with the
 * view; activity in another view can never touch this one. The stats summary
 * injects it optionally and otherwise keeps a component-local instance.
 *
 * Every tile starts closed. Only open tiles are stored, so closing a tile
 * deletes its entry. There is no cap and no eviction: entries of other
 * sessions shown earlier in the same view stay until the view is destroyed,
 * bounded by the sessions visited times their tiles. Nothing here reacts to a
 * snapshot push, a usage delta or a re-render, so those never reset a choice.
 */
@Injectable()
export class StatsTileExpansionState {
  private readonly open = signal<ReadonlySet<string>>(new Set());

  /** Whether the tile is open; reactive when read in a template or computed. */
  isOpen(sessionId: string, tileId: string): boolean {
    return this.open().has(statsTileKey(sessionId, tileId));
  }

  toggle(sessionId: string, tileId: string): void {
    this.setOpen(sessionId, tileId, !this.isOpen(sessionId, tileId));
  }

  setOpen(sessionId: string, tileId: string, open: boolean): void {
    const key = statsTileKey(sessionId, tileId);
    this.open.update((current) => {
      if (current.has(key) === open) return current;
      const next = new Set(current);
      if (open) next.add(key);
      else next.delete(key);
      return next;
    });
  }
}
