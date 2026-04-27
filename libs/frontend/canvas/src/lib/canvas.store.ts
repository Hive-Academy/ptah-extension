import { Injectable, computed, signal, inject } from '@angular/core';
import { TabManagerService } from '@ptah-extension/chat';
import { CanvasLayoutService } from './canvas-layout.service';

export interface CanvasTile {
  tabId: string;
  position: { x: number; y: number; w: number; h: number };
}

/**
 * CanvasStore — scoped per OrchestraCanvasComponent (not providedIn: 'root').
 *
 * Manages the set of tiles visible in the Orchestra Canvas panel. Each tile
 * corresponds to a tab in TabManagerService. Tile positions are tracked here
 * for CSS Grid / Gridstack layout; focus state updates the global active tab
 * so message sending routes to the correct session.
 *
 * TASK_2025_265 Batch 2
 */
@Injectable()
export class CanvasStore {
  private readonly tabManager = inject(TabManagerService);
  private readonly layoutService = inject(CanvasLayoutService);

  /**
   * Maximum number of tiles the orchestra canvas allows simultaneously.
   *
   * Caps the layout at a 3x3 grid — `CanvasLayoutService` switches to that
   * arrangement at the largest breakpoint, and Gridstack's column packing
   * stays readable up to nine tiles before tiles get too small to host a
   * usable chat surface.
   */
  static readonly MAX_TILES = 9;

  private readonly _tiles = signal<CanvasTile[]>([]);
  private readonly _focusedTabId = signal<string | null>(null);

  readonly tiles = this._tiles.asReadonly();
  readonly focusedTabId = this._focusedTabId.asReadonly();
  readonly tileCount = computed(() => this._tiles().length);
  readonly canAddTile = computed(
    () => this._tiles().length < CanvasStore.MAX_TILES,
  );

  /**
   * Add a tile for an existing session. If a tile for this session already
   * exists, focuses it instead of creating a duplicate.
   * @returns The tabId, or null if the tile cap is reached.
   */
  addTileFromSession(sessionId: string, name?: string): string | null {
    if (this._tiles().length >= CanvasStore.MAX_TILES) return null;

    const existingTile = this._tiles().find((t) => {
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
    if (this._tiles().length >= CanvasStore.MAX_TILES) return null;

    const tabId = this.tabManager.createTab(name);

    // Guard against duplicate tabIds (defensive — createTab should always be unique)
    if (this._tiles().some((t) => t.tabId === tabId)) return tabId;

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
    if (this._tiles().length >= CanvasStore.MAX_TILES) return null;
    if (this._tiles().some((t) => t.tabId === tabId)) return tabId;

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
    this._tiles.update((tiles) => tiles.filter((t) => t.tabId !== tabId));
    if (this._focusedTabId() === tabId) {
      this._focusedTabId.set(null);
    }
  }

  /**
   * Remove a tile from the canvas and close its underlying tab.
   * Awaits closeTab() so tiles are only removed after the user confirms
   * (or when no confirmation is required). Clears focused state if removed tile was focused.
   * @param tabId The tabId of the tile to remove.
   */
  async removeTile(tabId: string): Promise<void> {
    await this.tabManager.closeTab(tabId);
    this._tiles.update((tiles) => tiles.filter((t) => t.tabId !== tabId));
    if (this._focusedTabId() === tabId) {
      this._focusedTabId.set(null);
    }
  }

  /**
   * Update the grid position of a tile (called after Gridstack drag/resize).
   * @param tabId The tabId of the tile to reposition.
   * @param pos  New grid position { x, y, w, h }.
   */
  updateTilePosition(tabId: string, pos: CanvasTile['position']): void {
    this._tiles.update((tiles) =>
      tiles.map((t) => (t.tabId === tabId ? { ...t, position: pos } : t)),
    );
  }

  /**
   * Set the focused tile and update the global active tab in TabManagerService,
   * so that message sending routes to this tile's session.
   * @param tabId The tabId of the tile receiving focus.
   */
  focusTile(tabId: string): void {
    this._focusedTabId.set(tabId);
    this.tabManager.switchTab(tabId);
  }

  // ============================================================================
  // PRIVATE HELPERS
  // ============================================================================

  /**
   * Append a tile for the given tabId at the next available grid position.
   * Centralizes the position calculation to avoid duplication.
   */
  private appendTile(tabId: string): void {
    const newCount = this._tiles().length + 1;
    const layout = this.layoutService.computeLayout(newCount);
    const position = layout.tiles[newCount - 1] ?? {
      x: 0,
      y: 0,
      w: 4,
      h: 6,
    };

    this._tiles.update((tiles) => [...tiles, { tabId, position }]);
  }
}
