import {
  Injectable,
  Signal,
  WritableSignal,
  computed,
  signal,
  inject,
} from '@angular/core';
import { TabManagerService } from '@ptah-extension/chat';
import { SessionId } from '@ptah-extension/shared';
import {
  DEFAULT_TILE_WIDTH,
  MAX_CANVAS_TILES,
  TILE_SPANS,
  projectPreset,
  reconcileIntent,
  retainTilesInLogicalRows,
  sameWidth,
  type CanvasLayoutPreset,
  type TileIntent,
  type TileSpan,
} from './canvas-layout-intent';
import { CanvasLayoutPersistenceService } from './canvas-layout-persistence.service';

/**
 * A canvas tile is stored as intent only — where it sits in reading order, how
 * wide it wants to be and whether it starts a row. Concrete `x`/`y`/`w`/`h`
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
 * migrated to the first real workspace on the initial switch. Never persisted.
 */
const IMPLICIT_WORKSPACE_PATH = '';

/**
 * CanvasStore — scoped per OrchestraCanvasComponent (not providedIn: 'root').
 *
 * Manages the set of tiles visible in the Orchestra Canvas panel. Each tile
 * corresponds to a tab in TabManagerService. Only tile *intent* (order, width
 * and row breaks) is tracked here — `CanvasLayoutService` derives grid
 * coordinates from it. Focus state updates the global active tab so message
 * sending routes to the correct session. Layout focus is a separate, transient
 * per-workspace overlay that renders one tile full width without touching
 * intent. Storage is delegated to `CanvasLayoutPersistenceService`.
 *
 * The per-workspace partition is signal-backed so every retained workspace's
 * tiles stay reactive while its grid is hidden (keep-alive). `tiles` /
 * `focusedTabId` are computeds over the active workspace's map entry, preserving
 * the public API while background workspaces keep their own live tile state.
 */
@Injectable()
export class CanvasStore {
  private readonly tabManager = inject(TabManagerService);
  private readonly persistence = inject(CanvasLayoutPersistenceService);

  /**
   * Maximum number of tiles the orchestra canvas allows simultaneously.
   *
   * Caps the layout at a 3x3 grid — `CanvasLayoutService` clamps derived
   * columns at 3, and Gridstack's column packing stays readable up to nine
   * tiles before tiles get too small to host a usable chat surface.
   */
  static readonly MAX_TILES = MAX_CANVAS_TILES;

  private readonly _workspaceTiles = signal<
    ReadonlyMap<string, readonly CanvasTile[]>
  >(new Map());
  private readonly _workspaceFocusedTabId = signal<
    ReadonlyMap<string, string | null>
  >(new Map());
  private readonly _workspaceLayoutFocus = signal<
    ReadonlyMap<string, string | null>
  >(new Map());
  private readonly _activeWorkspacePath = signal<string | null>(null);
  private readonly _workspaceRevisions = signal<ReadonlyMap<string, number>>(
    new Map(),
  );
  private readonly _layoutLocked = signal(false);
  private readonly _hydratedPaths = new Set<string>();

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
  /** Panel-wide lock: no layout intent or projection changes while true. */
  readonly layoutLocked = this._layoutLocked.asReadonly();

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

  /** Transient layout-focus tile for a workspace; never persisted. */
  layoutFocusTabIdFor(path: string): string | null {
    return this._workspaceLayoutFocus().get(path) ?? null;
  }

  setLayoutLocked(locked: boolean): void {
    this._layoutLocked.set(locked);
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
   * Adopt an existing tab from TabManagerService as a canvas tile without
   * creating a duplicate tab.
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
   */
  removeTileOnly(tabId: string): void {
    this.updateActiveTiles((tiles) => dropTile(tiles, tabId));
    this.clearFocusIf(tabId);
  }

  /**
   * Remove a tile from the canvas and close its underlying tab.
   * Awaits closeTab() so tiles are only removed after the user confirms
   * (or when no confirmation is required).
   */
  async removeTile(tabId: string): Promise<void> {
    await this.tabManager.closeTab(tabId);
    this.updateActiveTiles((tiles) => dropTile(tiles, tabId));
    this.clearFocusIf(tabId);
  }

  /**
   * Rewrite reading order. Order is assigned densely in the given sequence;
   * unknown ids are ignored and any stored tile missing from the argument keeps
   * its relative order after the listed ones, so a partial list can never
   * silently drop a tile. Returns the same array reference when nothing moved.
   */
  reorderTiles(orderedTabIds: readonly string[]): void {
    this.updateActiveTiles((tiles) => {
      if (tiles.length === 0) return tiles;

      const known = new Set(tiles.map((t) => t.tabId));
      const sequence = [
        ...new Set([
          ...orderedTabIds.filter((tabId) => known.has(tabId)),
          ...sortByOrder(tiles).map((tile) => tile.tabId),
        ]),
      ];
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
    if (this._layoutLocked()) return false;
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
   * Atomically commit a snapped resize to the workspace captured at gesture
   * start. Only the dragged tile's width changes; neighbours, order and breaks
   * are untouched. Stale revisions, unknown ids and invalid spans are refused.
   */
  commitResizeSpan(
    workspacePath: string,
    expectedRevision: number,
    tabId: string,
    span: TileSpan,
  ): boolean {
    if (this.workspaceRevision(workspacePath) !== expectedRevision) return false;
    return this.setTileSpan(workspacePath, tabId, span);
  }

  /** Set one tile's named span. Returns false when locked or invalid. */
  setTileSpan(workspacePath: string, tabId: string, span: TileSpan): boolean {
    if (this._layoutLocked() || !TILE_SPANS.includes(span)) return false;
    const width = { kind: 'span', span } as const;
    return this.updateTile(workspacePath, tabId, (tile) =>
      sameWidth(tile.width, width) ? tile : { ...tile, width },
    );
  }

  /** Start a new logical row before a tile, or join it to the previous row. */
  toggleRowBreak(workspacePath: string, tabId: string): boolean {
    if (this._layoutLocked()) return false;
    const first = sortByOrder(this._workspaceTiles().get(workspacePath) ?? [])[0];
    if (first?.tabId === tabId) return false;
    return this.updateTile(workspacePath, tabId, (tile) => ({
      ...tile,
      rowBreakBefore: !tile.rowBreakBefore,
    }));
  }

  /**
   * Enter or exit transient layout focus for a tile. Never changes stored
   * intent, so exiting reproduces the exact prior layout.
   */
  toggleLayoutFocus(workspacePath: string, tabId: string): boolean {
    if (this._layoutLocked()) return false;
    const tiles = this._workspaceTiles().get(workspacePath) ?? EMPTY_TILES;
    if (!tiles.some((tile) => tile.tabId === tabId)) return false;
    const next = this.layoutFocusTabIdFor(workspacePath) === tabId ? null : tabId;
    setIn(this._workspaceLayoutFocus, workspacePath, next);
    return true;
  }

  /** Rewrite the active workspace's intent to a preset in one revision. */
  applyPreset(preset: CanvasLayoutPreset): boolean {
    const path = this._activeWorkspacePath();
    if (this._layoutLocked() || path === null) return false;
    const current = this._workspaceTiles().get(path) ?? EMPTY_TILES;
    if (current.length < 2) return false;
    const next = projectPreset(current, preset, this.focusedTabId());
    if (!sameIntent(current, next)) this.setWorkspaceTiles(path, next);
    return true;
  }

  /**
   * Set the focused tile and update the global active tab in TabManagerService,
   * so that message sending routes to this tile's session.
   */
  focusTile(tabId: string): void {
    const path = this.ensureActivePath();
    setIn(this._workspaceFocusedTabId, path, tabId);
    this.tabManager.switchTab(tabId);
  }

  /** Swap tile state for a workspace switch, hydrating a first visit. */
  switchWorkspaceTiles(
    newPath: string,
    activeTabs: readonly CanvasSeedTab[],
  ): void {
    if (this._activeWorkspacePath() === newPath) return;
    this.hydrateWorkspace(
      newPath,
      activeTabs.map((tab) => tab.id),
    );
  }

  /**
   * Activate a workspace and, on its first visit, publish persisted intent
   * reconciled against the exact authoritative tab ids in one transaction.
   * Authoritative ids without intent append as default tiles. Only then are
   * storage writes enabled for the partition. Never opens or loads a session.
   * A `null` path addresses the implicit in-memory partition.
   */
  hydrateWorkspace(
    workspacePath: string | null,
    authoritativeTabIds: readonly string[],
  ): void {
    const path = workspacePath ?? IMPLICIT_WORKSPACE_PATH;
    const prev = this._activeWorkspacePath();
    if (prev !== path) {
      this.setActivePath(path);
      if (
        prev === IMPLICIT_WORKSPACE_PATH &&
        path !== IMPLICIT_WORKSPACE_PATH &&
        !this._workspaceTiles().has(path) &&
        (this._workspaceTiles().get(IMPLICIT_WORKSPACE_PATH)?.length ?? 0) > 0
      ) {
        // First real workspace after bootstrap: carry implicit tiles over so
        // tiles created before any path arrived aren't orphaned.
        moveIn(this._workspaceTiles, IMPLICIT_WORKSPACE_PATH, path);
        moveIn(this._workspaceFocusedTabId, IMPLICIT_WORKSPACE_PATH, path);
        moveIn(this._workspaceLayoutFocus, IMPLICIT_WORKSPACE_PATH, path);
        moveIn(this._workspaceRevisions, IMPLICIT_WORKSPACE_PATH, path);
      }
      if (
        prev === IMPLICIT_WORKSPACE_PATH &&
        path !== IMPLICIT_WORKSPACE_PATH
      ) {
        deleteIn(this._workspaceTiles, IMPLICIT_WORKSPACE_PATH);
        deleteIn(this._workspaceFocusedTabId, IMPLICIT_WORKSPACE_PATH);
        deleteIn(this._workspaceLayoutFocus, IMPLICIT_WORKSPACE_PATH);
        deleteIn(this._workspaceRevisions, IMPLICIT_WORKSPACE_PATH);
        this.unmount(IMPLICIT_WORKSPACE_PATH);
      }
    }
    if (this._hydratedPaths.has(path)) return;
    this._hydratedPaths.add(path);

    const loaded = this.persistence.load(path);
    const existing = this._workspaceTiles().get(path) ?? EMPTY_TILES;
    const tiles = reconcileIntent(
      loaded.tiles ?? existing,
      authoritativeTabIds,
      CanvasStore.MAX_TILES,
    );
    const activeTabId = this.tabManager.activeTabId();
    const focused =
      this._workspaceFocusedTabId().get(path) ??
      (tiles.some((tile) => tile.tabId === activeTabId) ? activeTabId : null);

    setIn(this._workspaceTiles, path, tiles);
    setIn(this._workspaceFocusedTabId, path, focused);
    if (!this._workspaceRevisions().has(path)) {
      setIn(this._workspaceRevisions, path, 0);
    }
    this.persistence.markHydrated(path, loaded.writable);
    if (
      loaded.needsWrite ||
      !sameIntent(loaded.tiles ?? EMPTY_TILES, tiles)
    ) {
      this.schedulePersist(path);
    }
  }

  /**
   * Remove a tile for `tabId` from whichever workspace partition holds it.
   * Used for cross-workspace cleanup when a tab is closed in a background
   * workspace (the active-workspace prune effect can't see those tiles).
   */
  removeTileFromAnyWorkspace(tabId: string): void {
    for (const [path, tiles] of this._workspaceTiles()) {
      if (tiles.some((t) => t.tabId === tabId)) {
        this.setWorkspaceTiles(path, dropTile(tiles, tabId));
      }
      if (this._workspaceFocusedTabId().get(path) === tabId) {
        setIn(this._workspaceFocusedTabId, path, null);
      }
      if (this.layoutFocusTabIdFor(path) === tabId) {
        setIn(this._workspaceLayoutFocus, path, null);
      }
    }
  }

  /**
   * Drop saved tile state for a removed workspace, including its persisted
   * record; clears the active path when the removed workspace is active.
   */
  removeWorkspaceTileState(workspacePath: string): void {
    deleteIn(this._workspaceTiles, workspacePath);
    deleteIn(this._workspaceFocusedTabId, workspacePath);
    deleteIn(this._workspaceLayoutFocus, workspacePath);
    deleteIn(this._workspaceRevisions, workspacePath);
    this._hydratedPaths.delete(workspacePath);
    this.persistence.remove(workspacePath);
    this._tilesForCache.delete(workspacePath);
    this.unmount(workspacePath);
    if (this._activeWorkspacePath() === workspacePath) {
      this._activeWorkspacePath.set(null);
    }
  }

  /**
   * Append a tile for the given tabId at the end of the reading order with the
   * default width. Position is derived from that intent, not stored.
   */
  private appendTile(tabId: string): void {
    this.updateActiveTiles((tiles) => [
      ...tiles,
      {
        tabId,
        order: tiles.length,
        width: DEFAULT_TILE_WIDTH,
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
    const current = this._workspaceTiles().get(path) ?? EMPTY_TILES;
    const updated = fn(current);
    if (updated !== current) this.setWorkspaceTiles(path, updated);
  }

  /** Transform one tile of a workspace; false when the tile is unknown. */
  private updateTile(
    workspacePath: string,
    tabId: string,
    fn: (tile: CanvasTile) => CanvasTile,
  ): boolean {
    const current = this._workspaceTiles().get(workspacePath) ?? EMPTY_TILES;
    const index = current.findIndex((tile) => tile.tabId === tabId);
    if (index === -1) return false;
    const updated = fn(current[index]);
    if (updated !== current[index]) {
      this.setWorkspaceTiles(
        workspacePath,
        current.map((tile, i) => (i === index ? updated : tile)),
      );
    }
    return true;
  }

  private setWorkspaceTiles(
    workspacePath: string,
    tiles: readonly CanvasTile[],
  ): void {
    setIn(this._workspaceTiles, workspacePath, tiles);
    const focus = this.layoutFocusTabIdFor(workspacePath);
    if (focus !== null && !tiles.some((tile) => tile.tabId === focus)) {
      setIn(this._workspaceLayoutFocus, workspacePath, null);
    }
    setIn(
      this._workspaceRevisions,
      workspacePath,
      this.workspaceRevision(workspacePath) + 1,
    );
    this.schedulePersist(workspacePath);
  }

  private schedulePersist(workspacePath: string): void {
    this.persistence.schedule(
      workspacePath,
      () => this._workspaceTiles().get(workspacePath) ?? EMPTY_TILES,
    );
  }

  private clearFocusIf(tabId: string): void {
    const path = this._activeWorkspacePath();
    if (path === null) return;
    if ((this._workspaceFocusedTabId().get(path) ?? null) === tabId) {
      setIn(this._workspaceFocusedTabId, path, null);
    }
  }

  /**
   * Resolve the active workspace path, seeding it from TabManager (or the
   * implicit sentinel) when no switch has occurred yet.
   */
  private ensureActivePath(): string {
    const active = this._activeWorkspacePath();
    if (active !== null) return active;
    const resolved =
      this.tabManager.activeWorkspacePath$() ?? IMPLICIT_WORKSPACE_PATH;
    this.setActivePath(resolved);
    return resolved;
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
      this.unmount(lruPath);
    }
  }
}

function setIn<T>(
  map: WritableSignal<ReadonlyMap<string, T>>,
  key: string,
  value: T,
): void {
  map.update((current) => new Map(current).set(key, value));
}

function deleteIn<T>(
  map: WritableSignal<ReadonlyMap<string, T>>,
  key: string,
): void {
  map.update((current) => {
    if (!current.has(key)) return current;
    const next = new Map(current);
    next.delete(key);
    return next;
  });
}

function moveIn<T>(
  map: WritableSignal<ReadonlyMap<string, T>>,
  from: string,
  to: string,
): void {
  map.update((current) => {
    if (!current.has(from)) return current;
    const next = new Map(current);
    next.set(to, current.get(from) as T);
    next.delete(from);
    return next;
  });
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
      sameWidth(tile.width, other.width) &&
      tile.rowBreakBefore === other.rowBreakBefore
    );
  });
}
