import {
  Component,
  ChangeDetectionStrategy,
  OnInit,
  OnDestroy,
  inject,
  effect,
  untracked,
} from '@angular/core';
import { GridStackOptions } from 'gridstack';
import {
  GridstackComponent,
  GridstackItemComponent,
  nodesCB,
} from 'gridstack/dist/angular';
import { AppStateManager } from '@ptah-extension/core';
import { TabManagerService } from '@ptah-extension/chat';
import { CanvasStore } from './canvas.store';
import { CanvasTileComponent } from './canvas-tile.component';

/**
 * OrchestraCanvasComponent — top-level panel for the Orchestra Canvas view.
 *
 * Each instance owns its own CanvasStore (via providers array), ensuring full
 * isolation between multiple canvas panels opened simultaneously.
 *
 * Layout: Gridstack.js drag-and-resize grid with one CanvasTileComponent per tile.
 *
 * Gridstack API (v12.5.0):
 * - Component selector: <gridstack>
 * - Item selector: <gridstack-item [options]="{ x, y, w, h, id }">
 * - Change event: (changeCB) — fires after drag/resize; nodes carry updated positions
 * - Imports: GridstackComponent + GridstackItemComponent from 'gridstack/dist/angular'
 *
 * TASK_2025_271: Simplified — toolbar removed, session management delegated to shared
 * sidebar in AppShellComponent. Signal bridge effects watch for session requests from
 * AppStateManager and route them to CanvasStore.
 *
 * TASK_2025_265 Batch 3 (original)
 */
@Component({
  selector: 'ptah-orchestra-canvas',
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [CanvasStore],
  imports: [GridstackComponent, GridstackItemComponent, CanvasTileComponent],
  template: `
    <div class="flex flex-col h-full bg-base-100">
      <!-- Gridstack drag-and-resize grid (no toolbar — shared header provides controls) -->
      <div class="flex-1 overflow-auto">
        <gridstack [options]="gsOptions" (changeCB)="onGridChange($event)">
          @for (tile of canvasStore.tiles(); track tile.tabId) {
            <gridstack-item
              [options]="{
                x: tile.position.x,
                y: tile.position.y,
                w: tile.position.w,
                h: tile.position.h,
                id: tile.tabId,
              }"
            >
              <ptah-canvas-tile
                [tabId]="tile.tabId"
                [focused]="canvasStore.focusedTabId() === tile.tabId"
                (focusRequested)="canvasStore.focusTile($event)"
                (closeRequested)="canvasStore.removeTile($event)"
              />
            </gridstack-item>
          }
        </gridstack>
      </div>
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
        height: 100%;
      }

      gridstack {
        min-height: 200px;
      }
    `,
  ],
})
export class OrchestraCanvasComponent implements OnInit, OnDestroy {
  readonly canvasStore = inject(CanvasStore);
  private readonly appState = inject(AppStateManager);
  private readonly tabManager = inject(TabManagerService);

  /**
   * Gridstack grid configuration.
   * - column: 12-column grid (standard dashboard grid)
   * - cellHeight: 80px per row unit
   * - float: true allows free placement without auto-compaction
   * - margin: gap between tiles
   */
  readonly gsOptions: GridStackOptions = {
    column: 12,
    cellHeight: 80,
    float: true,
    margin: 8,
    resizable: { handles: 'e, se, s, sw, w' },
    animate: true,
  };

  constructor() {
    // Signal bridge: watch for session load requests from shared sidebar
    effect(() => {
      const req = this.appState.canvasSessionRequest();
      if (req) {
        this.canvasStore.addTileFromSession(req.sessionId, req.name);
        this.appState.clearCanvasSessionRequest();
      }
    });

    // Signal bridge: watch for new session requests from shared header
    effect(() => {
      const name = this.appState.newCanvasSessionRequest();
      if (name !== null) {
        this.canvasStore.addTile(name);
        this.appState.clearNewCanvasSessionRequest();
      }
    });

    // Reactive cleanup: remove orphaned tiles whose backing tab no longer exists.
    // This handles the case where a session is deleted from the sidebar, which
    // closes the tab via TabManagerService but leaves the canvas tile stale.
    // Uses untracked() for tiles read to prevent re-triggering when removeTileOnly
    // updates the _tiles signal.
    effect(() => {
      const tabs = this.tabManager.tabs(); // reactive dependency
      const tabIds = new Set(tabs.map((t) => t.id));
      const tiles = untracked(() => this.canvasStore.tiles());
      for (const tile of tiles) {
        if (!tabIds.has(tile.tabId)) {
          this.canvasStore.removeTileOnly(tile.tabId);
        }
      }
    });
  }

  ngOnInit(): void {
    // Seed one tile when the canvas opens empty so the user sees something immediately.
    if (this.canvasStore.tileCount() === 0) {
      this.canvasStore.addTile();
    }
  }

  /**
   * Close all tiles on destroy to prevent orphaned tabs in the root TabManagerService.
   * CanvasStore is scoped per component instance, so its tabs must be cleaned up here.
   *
   * Uses forceCloseTab (no confirmation dialog) since the component is being destroyed
   * — either the app is shutting down or the canvas is being fully removed from the DOM.
   * The async removeTile() would show spurious confirmation dialogs during teardown.
   */
  ngOnDestroy(): void {
    const tiles = this.canvasStore.tiles();
    for (const tile of tiles) {
      this.tabManager.forceCloseTab(tile.tabId);
    }
  }

  /**
   * Called by Gridstack whenever tiles are moved or resized.
   * Persists the new position into CanvasStore so positions survive re-renders.
   *
   * GridStackNode.id is set to tile.tabId in the item options above, so we can
   * correlate each changed node back to the correct CanvasTile.
   */
  onGridChange(data: nodesCB): void {
    for (const node of data.nodes) {
      if (node.id == null) continue;
      this.canvasStore.updateTilePosition(node.id, {
        x: node.x ?? 0,
        y: node.y ?? 0,
        w: node.w ?? 4,
        h: node.h ?? 6,
      });
    }
  }
}
