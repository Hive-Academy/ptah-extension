import { Injectable, computed, signal, inject } from '@angular/core';
import { TabManagerService } from '@ptah-extension/chat';

export interface CanvasTile {
  tabId: string;
  position: { x: number; y: number; w: number; h: number };
}

// FIX 11: Named constants for canvas grid layout (replaces magic numbers)
const CANVAS_COLS_PER_ROW = 3;
const CANVAS_TILE_W = 4; // 12-column grid ÷ 3 tiles per row
const CANVAS_TILE_H = 6;

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

  // FIX 6: Maximum tiles cap to prevent UI overload
  private readonly MAX_TILES = 9;

  private readonly _tiles = signal<CanvasTile[]>([]);
  private readonly _focusedTabId = signal<string | null>(null);

  readonly tiles = this._tiles.asReadonly();
  readonly focusedTabId = this._focusedTabId.asReadonly();
  readonly tileCount = computed(() => this._tiles().length);

  /**
   * Create a new tab and add a corresponding tile to the canvas.
   * Auto-computes a grid position based on the current tile count.
   * Guards against duplicate tabIds and enforces MAX_TILES cap.
   * @param name Optional display name for the new tab.
   * @returns The tabId of the newly created tab, or null if cap reached.
   */
  addTile(name?: string): string | null {
    // FIX 6: Enforce maximum tile count
    if (this._tiles().length >= this.MAX_TILES) return null;

    const tabId = this.tabManager.createTab(name);

    // FIX 7: Guard against duplicate tabIds (defensive — createTab should always be unique)
    if (this._tiles().some((t) => t.tabId === tabId)) return tabId;

    const existing = this._tiles();
    const col = existing.length % CANVAS_COLS_PER_ROW;
    const row = Math.floor(existing.length / CANVAS_COLS_PER_ROW);
    this._tiles.update((tiles) => [
      ...tiles,
      {
        tabId,
        position: {
          x: col * CANVAS_TILE_W,
          y: row * CANVAS_TILE_H,
          w: CANVAS_TILE_W,
          h: CANVAS_TILE_H,
        },
      },
    ]);
    return tabId;
  }

  /**
   * Remove a tile from the canvas and close its underlying tab.
   * Awaits closeTab() so tiles are only removed after the user confirms
   * (or when no confirmation is required). Clears focused state if removed tile was focused.
   * @param tabId The tabId of the tile to remove.
   */
  async removeTile(tabId: string): Promise<void> {
    // FIX 4: Await closeTab() before removing the tile — prevents premature removal
    // when closeTab shows a confirmation dialog for streaming/dirty tabs.
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
}
