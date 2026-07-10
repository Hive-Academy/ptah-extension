import {
  Component,
  ChangeDetectionStrategy,
  inject,
  input,
  effect,
  computed,
  untracked,
  viewChild,
} from '@angular/core';
import { GridStackOptions } from 'gridstack';
import {
  GridstackComponent,
  GridstackItemComponent,
  nodesCB,
} from 'gridstack/dist/angular';
import { CanvasStore } from './canvas.store';
import { CanvasLayoutService } from './canvas-layout.service';
import { CanvasTileComponent } from './canvas-tile.component';

/**
 * CanvasWorkspaceGridComponent — one Gridstack container per workspace.
 *
 * Each workspace keeps its own grid mounted (keep-alive); the parent toggles
 * `[class.hidden]` so switching workspaces hides the outgoing grid instead of
 * destroying its tiles (and their transcript DOM). A shared grid can't be used
 * because Gridstack's engine keeps logical nodes for hidden items, so layout
 * math would run across every workspace's tiles at once. Per-workspace grids
 * keep the layout engine isolated.
 *
 * Layout math is skipped while hidden (0-width container) and re-applied when
 * the grid becomes visible again.
 */
@Component({
  selector: 'ptah-canvas-workspace-grid',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [GridstackComponent, GridstackItemComponent, CanvasTileComponent],
  template: `
    <gridstack [options]="gsOptions" (changeCB)="onGridChange($event)">
      @for (tile of tiles(); track tile.tabId) {
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
            data-testid="canvas-tile"
            [tabId]="tile.tabId"
            [visible]="visible()"
            [focused]="canvasStore.focusedTabId() === tile.tabId"
            (focusRequested)="canvasStore.focusTile($event)"
            (closeRequested)="canvasStore.removeTile($event)"
          />
        </gridstack-item>
      }
    </gridstack>
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
export class CanvasWorkspaceGridComponent {
  /** The workspace path this grid renders tiles for. */
  readonly workspacePath = input.required<string>();
  /** Whether this grid's workspace is the active (on-screen) one. */
  readonly visible = input.required<boolean>();
  /** Canvas-wide lock: freezes layout and disables drag/resize when true. */
  readonly locked = input<boolean>(false);

  readonly canvasStore = inject(CanvasStore);
  private readonly layoutService = inject(CanvasLayoutService);

  private readonly gridComp = viewChild(GridstackComponent);

  readonly gsOptions: GridStackOptions = {
    column: 12,
    cellHeight: 120,
    float: true,
    margin: 8,
    draggable: { handle: '.tile-header' },
    resizable: { handles: 'e, se, s, sw, w' },
    animate: true,
  };

  readonly tiles = computed(() =>
    this.canvasStore.tilesFor(this.workspacePath())(),
  );

  private readonly layout = computed(() => {
    this.layoutService.containerWidth();
    this.layoutService.containerHeight();
    return this.layoutService.computeLayout(this.tiles().length);
  });

  private _wasVisible = false;

  constructor() {
    // Responsive layout: keep tiles sized to the container. Skipped while hidden
    // so Gridstack never runs layout math against a 0-width display:none grid.
    effect(() => {
      if (!this.visible()) return;
      const { cellHeight, tiles: tileLayouts } = this.layout();
      const gridComp = this.gridComp();
      if (!gridComp?.grid || tileLayouts.length === 0) return;
      if (this.locked()) return;

      const grid = gridComp.grid;
      const tiles = untracked(() => this.tiles());

      grid.batchUpdate(true);
      grid.cellHeight(cellHeight);

      for (const node of grid.engine.nodes) {
        const idx = tiles.findIndex((t) => t.tabId === node.id);
        if (idx >= 0 && tileLayouts[idx] && node.el) {
          grid.update(node.el, tileLayouts[idx]);
        }
      }

      grid.batchUpdate(false);
    });

    // Re-measure geometry once when a hidden grid is shown again — display:none
    // leaves Gridstack with a stale 0-width column measurement.
    effect(() => {
      const visible = this.visible();
      const grid = this.gridComp()?.grid;
      if (visible && !this._wasVisible && grid) {
        (grid as unknown as { onResize?: () => void }).onResize?.();
      }
      this._wasVisible = visible;
    });

    // Apply the canvas-wide lock to this grid's Gridstack instance.
    effect(() => {
      const locked = this.locked();
      const grid = this.gridComp()?.grid;
      grid?.setStatic(locked);
    });
  }

  /**
   * Persist Gridstack drag/resize changes into CanvasStore. Only the visible
   * (active) grid can emit changes, so writing the active workspace's tiles is
   * always correct.
   */
  onGridChange(data: nodesCB): void {
    for (const node of data.nodes) {
      if (typeof node.id !== 'string') continue;
      this.canvasStore.updateTilePosition(node.id, {
        x: node.x ?? 0,
        y: node.y ?? 0,
        w: node.w ?? 4,
        h: node.h ?? 6,
      });
    }
  }
}
