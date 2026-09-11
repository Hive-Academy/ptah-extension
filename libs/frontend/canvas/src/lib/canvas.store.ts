import { Injectable, Signal, computed, signal, inject } from '@angular/core';
import { TabManagerService } from '@ptah-extension/chat';
import { SessionId } from '@ptah-extension/shared';
import { DEFAULT_TILE_WEIGHT, type TileIntent } from './canvas-layout.service';
import {
  retainTilesInLogicalRows,
  type ColumnsPreference,
} from './canvas-layout-intent';

/**
 * A canvas tile is stored as intent only — where it sits in reading order and
 * how much width it claims relative to its row-mates. Concrete `x`/`y`/`w`/`h`
 * are derived by `CanvasLayoutService` on every layout pass and never stored,
 * so a container resize re-flows the grid without destroying the arrangement
 * the user chose.
 */
export type CanvasTile = TileIntent;

/**
 * Structural subset of TabState used for seeding tiles from active tabs.
 * Kept minimal so callers don't need a full TabState shape.
 */
export interface CanvasSeedTab {
  readonly id: string;
  readonly claudeSessionId: string | null;
  readonly name: string;
}

/**
 * Hard bound on the number of workspace grid sections kept mounted (keep-alive)
 * at once. Beyond this cap the least-recently-active non-active workspace drops
 * out of `workspacePaths` so its grid unmounts — its tile intent survives in
 * the partition map and is restored on return. Single constant so profiling can
 * dial it down without touching the eviction logic.
 */
export const RETAINED_WORKSPACE_CAP = 4;

const EMPTY_TILES: readonly CanvasTile[] = [];

/**
 * Sentinel workspace key used only when the host never reports an active
 * workspace path (e.g. a single-root shell that does not emit workspace:switch).
 * Tiles created before any real path arrives land under this key and are
 * migrated to the first real workspace on the initial switch.
 */
const IMPLICIT_WORKSPACE_PATH = '';

/**
 * CanvasStore — scoped per OrchestraCanvasComponent (not providedIn: 'root').
 *
 * Manages the set of tiles visible in the Orchestra Canvas panel. Each tile
 * corresponds to a tab in TabManagerService. Only tile *intent* (order and
 * weight) is tracked here — `CanvasLayoutService` derives grid coordinates from
 * it. Focus state updates the global active tab so message sending routes to
 * the correct session.
 *
 * The per-workspace partition is signal-backed so every retained workspace's
 * tiles stay reactive while its grid is hidden (keep-alive). `tiles` /
 * `focusedTabId` are computeds over the active workspace's map entry, preserving
 * the public API while background workspaces keep their own live tile state.
 */
@Injectable()
export class CanvasStore {
  private readonly tabManager = inject(TabManagerService);

  /**
   * Maximum number of tiles the orchestra canvas allows simultaneously.
   *
   * Caps the layout at a 3x3 grid — `CanvasLayoutService` clamps derived
   * columns at 3, and Gridstack's column packing stays readable up to nine
   * tiles before tiles get too small to host a usable chat surface.
   */
  static readonly MAX_TILES = 9;

  private readonly _workspaceTiles = signal<
    ReadonlyMap<string, readonly CanvasTile[]>
  >(new Map());
  private readonly _workspaceFocusedTabId = signal<
    ReadonlyMap<string, string | null>
  >(new Map());
  private readonly _activeWorkspacePath = signal<string | null>(null);
  private readonly _workspaceRevisions = signal<ReadonlyMap<string, number>>(
    new Map(),
  );
  private readonly _workspaceColumnsPreferences = signal<
    ReadonlyMap<string, ColumnsPreference>
  >(new Map());

  /** Insertion-ordered mounted workspaces (stable for `@for` track path). */
  private readonly _workspacePaths = signal<readonly string[]>([]);
  private readonly _workspaceRecency = new Map<string, number>();
  private _workspaceClock = 0;

  /** Memoized per-path tile signals so template calls keep a stable identity. */
  private readonly _tilesForCache = new Map<
    string,
    Signal<readonly CanvasTile[]>
  >();

  readonly activeWorkspacePath = this._activeWorkspacePath.asReadonly();
  readonly workspacePaths = this._workspacePaths.asReadonly();

  readonly tiles = computed<readonly CanvasTile[]>(() => {
    const path = this._activeWorkspacePath();
    return path !== null
      ? (this._workspaceTiles().get(path) ?? EMPTY_TILES)
      : EMPTY_TILES;
  });
  readonly focusedTabId = computed<string | null>(() => {
    const path = this._activeWorkspacePath();
    return path !== null
      ? (this._workspaceFocusedTabId().get(path) ?? null)
      : null;
  });
  readonly tileCount = computed(() => this.tiles().length);
  readonly canAddTile = computed(
    () => this.tiles().length < CanvasStore.MAX_TILES,
  );

  /**
   * Reactive tile list for an arbitrary workspace path — used by each hidden
   * workspace grid to render its own tiles independently of the active one.
   * The returned signal has a stable identity per path so repeated template
   * evaluation never creates new reactive nodes.
   */
  tilesFor(path: string): Signal<readonly CanvasTile[]> {
    let sig = this._tilesForCache.get(path);
    if (!sig) {
      sig = computed(() => this._workspaceTiles().get(path) ?? EMPTY_TILES);
      this._tilesForCache.set(path, sig);
    }
    return sig;
  }

  workspaceRevision(path: string): number {
    return this._workspaceRevisions().get(path) ?? 0;
  }

  columnsPreferenceFor(path: string): ColumnsPreference {
    return this._workspaceColumnsPreferences().get(path) ?? 'auto';
  }

  setColumnsPreference(preference: ColumnsPreference): void {
    const path = this.ensureActivePath();
    if (this.columnsPreferenceFor(path) === preference) return;
    this._workspaceColumnsPreferences.update((map) =>
      new Map(map).set(path, preference),
    );
    this.bumpRevision(path);
  }

  /**
   * Add a tile for an existing session. If a tile for this session already
   * exists, focuses it instead of creating a duplicate.
   * @returns The tabId, or null if the tile cap is reached.
   */
  addTileFromSession(sessionId: SessionId, name?: string): string | null {
    if (this.tiles().length >= CanvasStore.MAX_TILES) return null;

    const existingTile = this.tiles().find((t) => {
      const tab = this.tabManager.tabs().find((tab) => tab.id === t.tabId);
      return tab?.claudeSessionId === sessionId;
    });
    if (existingTile) {
      this.focusTile(existingTile.tabId);
      return existingTile.tabId;
    }

    const tabId = this.tabManager.openSessionTab(sessionId, name);
    this.appendTile(tabId);
    return tabId;
  }

  /**
   * Create a new tab and add a corresponding tile to the canvas.
   * Auto-computes a grid position based on the current tile count.
   * Guards against duplicate tabIds and enforces MAX_TILES cap.
   * @param name Optional display name for the new tab.
   * @returns The tabId of the newly created tab, or null if cap reached.
   */
  addTile(name?: string): string | null {
    if (this.tiles().length >= CanvasStore.MAX_TILES) return null;

    const tabId = this.tabManager.createTab(name);
    if (this.tiles().some((t) => t.tabId === tabId)) return tabId;

    this.appendTile(tabId);
    return tabId;
  }

  /**
   * Adopt an existing tab from TabManagerService as a canvas tile.
   * Used during restoration to create tiles for tabs that already exist
   * (e.g., restored from localStorage) without creating duplicate tabs.
   * @param tabId The pre-existing tab ID to adopt.
   * @returns The tabId, or null if the tile cap is reached.
   */
  adoptTab(tabId: string): string | null {
    if (this.tiles().length >= CanvasStore.MAX_TILES) return null;
    if (this.tiles().some((t) => t.tabId === tabId)) return tabId;

    this.appendTile(tabId);
    return tabId;
  }

  /**
   * Remove a tile from the canvas WITHOUT closing its underlying tab.
   * Used for reactive cleanup when a tab has already been closed externally
   * (e.g., session deletion from sidebar). Prevents double-close and
   * avoids showing a confirmation dialog for an already-closed tab.
   * @param tabId The tabId of the orphaned tile to remove.
   */
  removeTileOnly(tabId: string): void {
    this.updateActiveTiles((tiles) => dropTile(tiles, tabId));
    this.clearFocusIf(tabId);
  }

  /**
   * Remove a tile from the canvas and close its underlying tab.
   * Awaits closeTab() so tiles are only removed after the user confirms
   * (or when no confirmation is required). Clears focused state if removed tile was focused.
   * @param tabId The tabId of the tile to remove.
   */
  async removeTile(tabId: string): Promise<void> {
    await this.tabManager.closeTab(tabId);
    this.updateActiveTiles((tiles) => dropTile(tiles, tabId));
    this.clearFocusIf(tabId);
  }

  /**
   * Rewrite reading order from a finished drag gesture. Order is assigned
   * densely in the given sequence; unknown ids are ignored and any stored tile
   * missing from the argument keeps its relative order after the listed ones,
   * so a partial node list can never silently drop a tile.
   *
   * Returns the tile array unchanged (same reference) when nothing moved, so
   * the signal does not notify and a stray write-back cannot loop.
   */
  reorderTiles(orderedTabIds: readonly string[]): void {
    this.updateActiveTiles((tiles) => {
      if (tiles.length === 0) return tiles;

      const known = new Set(tiles.map((t) => t.tabId));
      const placed = new Set<string>();
      const sequence: string[] = [];
      for (const tabId of orderedTabIds) {
        if (!known.has(tabId) || placed.has(tabId)) continue;
        placed.add(tabId);
        sequence.push(tabId);
      }
      for (const tile of sortByOrder(tiles)) {
        if (placed.has(tile.tabId)) continue;
        placed.add(tile.tabId);
        sequence.push(tile.tabId);
      }

      const rank = new Map(sequence.map((tabId, i) => [tabId, i]));
      let changed = false;
      const next = tiles.map((tile) => {
        const order = rank.get(tile.tabId) ?? tile.order;
        if (order === tile.order) return tile;
        changed = true;
        return { ...tile, order };
      });
      return changed ? sortByOrder(next) : tiles;
    });
  }

  /** Atomically commit a complete drag projection to its captured workspace. */
  commitDragIntent(
    workspacePath: string,
    expectedRevision: number,
    projected: readonly CanvasTile[],
  ): boolean {
    if (this.workspaceRevision(workspacePath) !== expectedRevision) return false;
    const current = this._workspaceTiles().get(workspacePath) ?? EMPTY_TILES;
    if (!sameIdsExactly(current, projected)) return false;
    const normalized = projected.map((tile, order) => ({
      ...tile,
      order,
      rowBreakBefore: order > 0 && tile.rowBreakBefore,
    }));
    if (sameIntent(current, normalized)) return true;
    this.setWorkspaceTiles(workspacePath, normalized);
    return true;
  }

  /**
   * Rewrite relative width shares from a finished resize gesture. Tiles absent
   * from the map keep their weight; a non-finite or non-positive weight is
   * coerced to the default rather than stored. Returns the same array reference
   * when nothing changed.
   */
  setTileWeights(weights: ReadonlyMap<string, number>): void {
    this.updateActiveTiles((tiles) => {
      let changed = false;
      const next = tiles.map((tile) => {
        if (!weights.has(tile.tabId)) return tile;
        const raw = weights.get(tile.tabId) ?? DEFAULT_TILE_WEIGHT;
        const weight =
          Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_TILE_WEIGHT;
        if (weight === tile.weight) return tile;
        changed = true;
        return { ...tile, weight };
      });
      return changed ? next : tiles;
    });
  }

  /** Atomically commit resize weights to the workspace captured at start. */
  commitResizeWeights(
    workspacePath: string,
    expectedRevision: number,
    weights: ReadonlyMap<string, number>,
  ): boolean {
    if (this.workspaceRevision(workspacePath) !== expectedRevision) return false;
    const current = this._workspaceTiles().get(workspacePath) ?? EMPTY_TILES;
    if (weights.size !== current.length) return false;
    let valid = true;
    let changed = false;
    const next = current.map((tile) => {
      const weight = weights.get(tile.tabId);
      if (weight === undefined || !Number.isFinite(weight) || weight <= 0) {
        valid = false;
        return tile;
      }
      if (weight === tile.weight) return tile;
      changed = true;
      return { ...tile, weight };
    });
    if (!valid) return false;
    if (changed) this.setWorkspaceTiles(workspacePath, next);
    return true;
  }

  /**
   * Set the focused tile and update the global active tab in TabManagerService,
   * so that message sending routes to this tile's session.
   * @param tabId The tabId of the tile receiving focus.
   */
  focusTile(tabId: string): void {
    const path = this.ensureActivePath();
    this._workspaceFocusedTabId.update((map) => new Map(map).set(path, tabId));
    this.tabManager.switchTab(tabId);
  }

  /**
   * Swap tile state for a workspace switch. With the signal-backed partition the
   * active workspace's tiles already live in the map, so switching only flips the
   * active path and seeds the target the first time it is visited.
   */
  switchWorkspaceTiles(
    newPath: string,
    activeTabs: readonly CanvasSeedTab[],
  ): void {
    const prev = this._activeWorkspacePath();
    if (prev === newPath) return;

    this.setActivePath(newPath);

    if (this._workspaceTiles().has(newPath)) return;

    // First real workspace after bootstrap: migrate implicit tiles instead of
    // seeding, so tiles created before any path arrived aren't orphaned.
    if (
      prev === IMPLICIT_WORKSPACE_PATH &&
      (this._workspaceTiles().get(IMPLICIT_WORKSPACE_PATH)?.length ?? 0) > 0
    ) {
      const migratedTiles =
        this._workspaceTiles().get(IMPLICIT_WORKSPACE_PATH) ?? EMPTY_TILES;
      const migratedFocus =
        this._workspaceFocusedTabId().get(IMPLICIT_WORKSPACE_PATH) ?? null;
      this._workspaceTiles.update((map) => {
        const next = new Map(map);
        next.set(newPath, migratedTiles);
        next.delete(IMPLICIT_WORKSPACE_PATH);
        return next;
      });
      this._workspaceFocusedTabId.update((map) => {
        const next = new Map(map);
        next.set(newPath, migratedFocus);
        next.delete(IMPLICIT_WORKSPACE_PATH);
        return next;
      });
      const implicitRevision = this.workspaceRevision(IMPLICIT_WORKSPACE_PATH);
      this._workspaceRevisions.update((map) => {
        const next = new Map(map);
        next.set(newPath, implicitRevision);
        next.delete(IMPLICIT_WORKSPACE_PATH);
        return next;
      });
      const implicitPreference = this.columnsPreferenceFor(
        IMPLICIT_WORKSPACE_PATH,
      );
      this._workspaceColumnsPreferences.update((map) => {
        const next = new Map(map);
        next.set(newPath, implicitPreference);
        next.delete(IMPLICIT_WORKSPACE_PATH);
        return next;
      });
      this.unmount(IMPLICIT_WORKSPACE_PATH);
      return;
    }

    const seeded: CanvasTile[] = [];
    for (const tab of activeTabs) {
      if (seeded.length >= CanvasStore.MAX_TILES) break;
      seeded.push({
        tabId: tab.id,
        order: seeded.length,
        weight: DEFAULT_TILE_WEIGHT,
        rowBreakBefore: false,
      });
    }
    this._workspaceTiles.update((map) => new Map(map).set(newPath, seeded));
    this._workspaceFocusedTabId.update((map) =>
      new Map(map).set(newPath, null),
    );
    this._workspaceRevisions.update((map) => new Map(map).set(newPath, 0));
  }

  /**
   * Remove a tile for `tabId` from whichever workspace partition holds it.
   * Used for cross-workspace cleanup when a tab is closed in a background
   * workspace (the active-workspace prune effect can't see those tiles).
   */
  removeTileFromAnyWorkspace(tabId: string): void {
    const changedPaths: string[] = [];
    this._workspaceTiles.update((map) => {
      let changed = false;
      const next = new Map(map);
      for (const [path, tiles] of map) {
        if (tiles.some((t) => t.tabId === tabId)) {
          next.set(path, dropTile(tiles, tabId));
          changedPaths.push(path);
          changed = true;
        }
      }
      return changed ? next : map;
    });
    changedPaths.forEach((path) => this.bumpRevision(path));
    this._workspaceFocusedTabId.update((map) => {
      let changed = false;
      const next = new Map(map);
      for (const [path, focused] of map) {
        if (focused === tabId) {
          next.set(path, null);
          changed = true;
        }
      }
      return changed ? next : map;
    });
  }

  /**
   * Every tabId across all retained workspace partitions. Used at teardown so
   * `ngOnDestroy` force-closes tabs from background workspaces too, not just the
   * active one.
   */
  allTabIds(): readonly string[] {
    const ids: string[] = [];
    for (const tiles of this._workspaceTiles().values()) {
      for (const tile of tiles) {
        ids.push(tile.tabId);
      }
    }
    return ids;
  }

  /**
   * Drop saved tile state for a removed workspace; clears the active path when
   * the removed workspace is the currently active one.
   */
  removeWorkspaceTileState(workspacePath: string): void {
    this._workspaceTiles.update((map) => {
      if (!map.has(workspacePath)) return map;
      const next = new Map(map);
      next.delete(workspacePath);
      return next;
    });
    this._workspaceRevisions.update((map) => {
      if (!map.has(workspacePath)) return map;
      const next = new Map(map);
      next.delete(workspacePath);
      return next;
    });
    this._workspaceColumnsPreferences.update((map) => {
      if (!map.has(workspacePath)) return map;
      const next = new Map(map);
      next.delete(workspacePath);
      return next;
    });
    this._workspaceFocusedTabId.update((map) => {
      if (!map.has(workspacePath)) return map;
      const next = new Map(map);
      next.delete(workspacePath);
      return next;
    });
    this._tilesForCache.delete(workspacePath);
    this.unmount(workspacePath);
    if (this._activeWorkspacePath() === workspacePath) {
      this._activeWorkspacePath.set(null);
    }
  }

  /**
   * Append a tile for the given tabId at the end of the reading order with the
   * default width share. Position is derived from that intent, not stored.
   */
  private appendTile(tabId: string): void {
    this.updateActiveTiles((tiles) => [
      ...tiles,
      {
        tabId,
        order: tiles.length,
        weight: DEFAULT_TILE_WEIGHT,
        rowBreakBefore: false,
      },
    ]);
  }

  /**
   * Apply an immutable transform to the active workspace's tile array. Seeds the
   * active path lazily so tiles created before the first workspace switch still
   * land in a mounted bucket. A transform that returns the same array reference
   * is a no-op and does not touch the signal.
   */
  private updateActiveTiles(
    fn: (tiles: readonly CanvasTile[]) => readonly CanvasTile[],
  ): void {
    const path = this.ensureActivePath();
    this._workspaceTiles.update((map) => {
      const current = map.get(path) ?? EMPTY_TILES;
      const updated = fn(current);
      if (updated === current) return map;
      this.bumpRevision(path);
      return new Map(map).set(path, updated);
    });
  }

  private setWorkspaceTiles(
    workspacePath: string,
    tiles: readonly CanvasTile[],
  ): void {
    this._workspaceTiles.update((map) => new Map(map).set(workspacePath, tiles));
    this.bumpRevision(workspacePath);
  }

  private bumpRevision(workspacePath: string): void {
    this._workspaceRevisions.update((map) =>
      new Map(map).set(workspacePath, (map.get(workspacePath) ?? 0) + 1),
    );
  }

  private clearFocusIf(tabId: string): void {
    const path = this._activeWorkspacePath();
    if (path === null) return;
    if ((this._workspaceFocusedTabId().get(path) ?? null) === tabId) {
      this._workspaceFocusedTabId.update((map) => new Map(map).set(path, null));
    }
  }

  /**
   * Resolve the active workspace path, seeding it from TabManager (or the
   * implicit sentinel) when no switch has occurred yet.
   */
  private ensureActivePath(): string {
    const active = this._activeWorkspacePath();
    if (active !== null) return active;
    const resolved = this.readWorkspacePath() ?? IMPLICIT_WORKSPACE_PATH;
    this.setActivePath(resolved);
    return resolved;
  }

  private readWorkspacePath(): string | null {
    return this.tabManager.activeWorkspacePath$();
  }

  /** Flip the active path and (re)mount its grid section, refreshing recency. */
  private setActivePath(path: string): void {
    this._activeWorkspacePath.set(path);
    this._workspaceRecency.set(path, ++this._workspaceClock);
    if (!this._workspacePaths().includes(path)) {
      this._workspacePaths.update((paths) => [...paths, path]);
    }
    this.evictWorkspacesOverCap(path);
  }

  /** Remove a workspace from the mounted set (its map entry is left untouched). */
  private unmount(path: string): void {
    if (this._workspacePaths().includes(path)) {
      this._workspacePaths.update((paths) => paths.filter((p) => p !== path));
    }
    this._workspaceRecency.delete(path);
  }

  private evictWorkspacesOverCap(activePath: string): void {
    while (this._workspacePaths().length > RETAINED_WORKSPACE_CAP) {
      let lruPath: string | null = null;
      let lruTick = Number.POSITIVE_INFINITY;
      for (const path of this._workspacePaths()) {
        if (path === activePath) continue;
        const tick = this._workspaceRecency.get(path) ?? 0;
        if (tick < lruTick) {
          lruTick = tick;
          lruPath = path;
        }
      }
      if (lruPath === null) break;
      // Drop from the mounted set only — the map entry (tile intent) persists
      // so returning to the workspace restores its arrangement.
      const evicted = lruPath;
      this._workspacePaths.update((paths) =>
        paths.filter((p) => p !== evicted),
      );
      this._workspaceRecency.delete(evicted);
    }
  }
}

/** Tiles in reading order — the canonical sequence `order` encodes. */
function sortByOrder(tiles: readonly CanvasTile[]): CanvasTile[] {
  return [...tiles].sort(
    (a, b) => a.order - b.order || a.tabId.localeCompare(b.tabId),
  );
}

/**
 * Remove a tile and renumber the survivors densely, so a stored `order` is
 * always `0..n-1` and a closed tile never leaves a gap that later reads as a
 * different arrangement.
 */
function dropTile(
  tiles: readonly CanvasTile[],
  tabId: string,
): readonly CanvasTile[] {
  if (!tiles.some((t) => t.tabId === tabId)) return tiles;
  const retained = new Set(
    tiles.filter((tile) => tile.tabId !== tabId).map((tile) => tile.tabId),
  );
  return retainTilesInLogicalRows(tiles, retained);
}

function sameIdsExactly(
  left: readonly CanvasTile[],
  right: readonly CanvasTile[],
): boolean {
  if (left.length !== right.length) return false;
  const ids = new Set(left.map((tile) => tile.tabId));
  return (
    ids.size === left.length && right.every((tile) => ids.delete(tile.tabId))
  );
}

function sameIntent(
  left: readonly CanvasTile[],
  right: readonly CanvasTile[],
): boolean {
  if (left.length !== right.length) return false;
  return left.every((tile, index) => {
    const other = right[index];
    return (
      tile.tabId === other.tabId &&
      tile.order === other.order &&
      tile.weight === other.weight &&
      tile.rowBreakBefore === other.rowBreakBefore
    );
  });
}
