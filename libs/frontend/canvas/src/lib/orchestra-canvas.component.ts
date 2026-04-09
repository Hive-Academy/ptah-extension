import {
  Component,
  ChangeDetectionStrategy,
  OnInit,
  inject,
} from '@angular/core';
import { GridStackOptions, GridStackNode } from 'gridstack';
import {
  GridstackComponent,
  GridstackItemComponent,
  nodesCB,
} from 'gridstack/dist/angular';
import { CanvasStore } from './canvas.store';
import { CanvasTileComponent } from './canvas-tile.component';

/**
 * OrchestraCanvasComponent — top-level panel for the Orchestra Canvas view.
 *
 * Each instance owns its own CanvasStore (via providers array), ensuring full
 * isolation between multiple canvas panels opened simultaneously.
 *
 * Layout: Gridstack.js drag-and-resize grid with one CanvasTileComponent per tile.
 * Fallback: If Gridstack encounters issues, the CSS Grid fallback (below) can be
 * restored; the architectural tile + store wiring remains identical.
 *
 * Gridstack API (v12.5.0):
 * - Component selector: <gridstack>
 * - Item selector: <gridstack-item [options]="{ x, y, w, h, id }">
 * - Change event: (changeCB) — fires after drag/resize; nodes carry updated positions
 * - Imports: GridstackComponent + GridstackItemComponent from 'gridstack/dist/angular'
 *
 * Risk 1 Mitigation: Each <ptah-canvas-tile> emits (focusRequested) which this
 * component routes to canvasStore.focusTile(). focusTile() calls
 * tabManager.switchTab(), updating global activeTabId BEFORE any message send.
 *
 * TASK_2025_265 Batch 3
 */
@Component({
  selector: 'ptah-orchestra-canvas',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [CanvasStore],
  imports: [GridstackComponent, GridstackItemComponent, CanvasTileComponent],
  template: `
    <div class="flex flex-col h-full bg-base-100">
      <!-- Toolbar -->
      <div
        class="flex items-center gap-2 px-3 py-2 border-b border-base-300 bg-base-200 shrink-0"
      >
        <span class="font-semibold text-sm text-base-content"
          >Orchestra Canvas</span
        >
        <span class="badge badge-sm badge-primary">{{
          canvasStore.tileCount()
        }}</span>
        <button
          class="btn btn-xs btn-ghost ml-auto gap-1"
          (click)="addSession()"
          aria-label="Add session tile"
        >
          + Add Session
        </button>
      </div>

      <!-- Gridstack drag-and-resize grid -->
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
export class OrchestraCanvasComponent implements OnInit {
  readonly canvasStore = inject(CanvasStore);

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

  ngOnInit(): void {
    // Seed one tile when the canvas opens empty so the user sees something immediately.
    if (this.canvasStore.tileCount() === 0) {
      this.canvasStore.addTile();
    }
  }

  addSession(): void {
    this.canvasStore.addTile();
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
