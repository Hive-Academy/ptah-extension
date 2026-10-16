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
  private readonly hosts = new WeakMap<object, { sessionId: string | null; key: string }>();
  private readonly pendingAliases = new Map<string, Set<string>>();
  private nextPendingId = 0;

  /** Resolve a component's session key, preserving its pending tiles on first ID assignment. */
  sessionKey(host: object, sessionId: string | null): string {
    const previous = this.hosts.get(host);
    if (previous?.sessionId === sessionId) return previous.key;

    const key = sessionId ?? `\0pending:${++this.nextPendingId}`;
    if (previous?.sessionId === null && sessionId !== null) {
      const aliases = this.pendingAliases.get(key) ?? new Set<string>();
      aliases.add(previous.key);
      this.pendingAliases.set(key, aliases);
    }
    this.hosts.set(host, { sessionId, key });
    return key;
  }

  /** Whether the tile is open; reactive when read in a template or computed. */
  isOpen(sessionId: string, tileId: string): boolean {
    const current = this.open();
    if (current.has(statsTileKey(sessionId, tileId))) return true;
    for (const alias of this.pendingAliases.get(sessionId) ?? []) {
      if (current.has(statsTileKey(alias, tileId))) return true;
    }
    return false;
  }

  toggle(sessionId: string, tileId: string): void {
    this.setOpen(sessionId, tileId, !this.isOpen(sessionId, tileId));
  }

  setOpen(sessionId: string, tileId: string, open: boolean): void {
    const key = statsTileKey(sessionId, tileId);
    const aliases = this.pendingAliases.get(sessionId);
    this.open.update((current) => {
      const next = new Set(current);
      for (const alias of aliases ?? []) {
        const prefix = `${alias}::`;
        for (const entry of current) {
          if (!entry.startsWith(prefix)) continue;
          next.delete(entry);
          next.add(statsTileKey(sessionId, entry.slice(prefix.length)));
        }
      }
      if (open) next.add(key);
      else next.delete(key);
      if (next.size === current.size && [...next].every((entry) => current.has(entry))) return current;
      return next;
    });
    if (aliases) this.pendingAliases.delete(sessionId);
  }
}
