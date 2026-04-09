import { Injectable, computed, signal, inject } from '@angular/core';
import { TabManagerService } from '@ptah-extension/chat';

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

  private readonly _tiles = signal<CanvasTile[]>([]);
  private readonly _focusedTabId = signal<string | null>(null);

  readonly tiles = this._tiles.asReadonly();
  readonly focusedTabId = this._focusedTabId.asReadonly();
  readonly tileCount = computed(() => this._tiles().length);

  /**
   * Create a new tab and add a corresponding tile to the canvas.
   * Auto-computes a grid position based on the current tile count.
   * @param name Optional display name for the new tab.
   * @returns The tabId of the newly created tab.
   */
  addTile(name?: string): string {
    const tabId = this.tabManager.createTab(name);
    const existing = this._tiles();
    const col = existing.length % 3;
    const row = Math.floor(existing.length / 3);
    this._tiles.update((tiles) => [
      ...tiles,
      { tabId, position: { x: col * 4, y: row * 6, w: 4, h: 6 } },
    ]);
    return tabId;
  }

  /**
   * Remove a tile from the canvas and close its underlying tab.
   * Clears focused state if the removed tile was focused.
   * @param tabId The tabId of the tile to remove.
   */
  removeTile(tabId: string): void {
    this._tiles.update((tiles) => tiles.filter((t) => t.tabId !== tabId));
    if (this._focusedTabId() === tabId) {
      this._focusedTabId.set(null);
    }
    // closeTab is async (may show confirmation dialog for streaming/dirty tabs)
    this.tabManager.closeTab(tabId);
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
