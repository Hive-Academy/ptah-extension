import {
  Component,
  ChangeDetectionStrategy,
  inject,
  input,
  effect,
  computed,
  viewChild,
} from '@angular/core';
import { GridStackOptions } from 'gridstack';
import {
  GridstackComponent,
  GridstackItemComponent,
} from 'gridstack/dist/angular';
import { CanvasStore } from './canvas.store';
import { CanvasLayoutService } from './canvas-layout.service';
import { CanvasTileComponent } from './canvas-tile.component';

/** Which gesture just ended, latched before Gridstack's `change` fires. */
type GestureKind = 'drag' | 'resize';

/** Fallback item geometry for a grid that has not been measured yet. */
const UNMEASURED_ITEM = { x: 0, y: 0, w: 12, h: 6 } as const;

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
 *
 * This is the only place in the lib that talks to Gridstack. Geometry flows one
 * way — `CanvasStore` intent -> `CanvasLayoutService` -> `grid.update()` — and
 * finished gestures flow back as intent, never as coordinates.
 */
@Component({
  selector: 'ptah-canvas-workspace-grid',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [GridstackComponent, GridstackItemComponent, CanvasTileComponent],
  host: {
    // Single source of truth for keep-alive visibility. An inline style binding
    // beats Tailwind's `.hidden` utility AND any `:host { display }` rule no
    // matter the stylesheet order. The previous mechanism ([class.hidden] on the
    // parent fighting `:host { display: block }`) was an equal-specificity tie
    // resolved by source order — it silently flipped in the production bundle,
    // leaving every retained workspace grid visible at once (all workspaces'
    // sessions shown, stacked). `display:none` hides the grid without unmounting
    // its tiles/transcripts, so the keep-alive contract still holds.
    '[style.display]': "visible() ? 'block' : 'none'",
  },
  template: `
    <gridstack
      [options]="gsOptions"
      (changeCB)="onGridChange()"
      (dragStopCB)="onDragStop()"
      (resizeStopCB)="onResizeStop()"
    >
      @for (item of items(); track item.tabId) {
        <gridstack-item [options]="item.options">
          <ptah-canvas-tile
            data-testid="canvas-tile"
            [tabId]="item.tabId"
            [visible]="visible()"
            [focused]="canvasStore.focusedTabId() === item.tabId"
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
    // Gravity on: a dragged tile pushes its neighbours and the arrangement
    // compacts up-and-left, which is also what the derived layout produces —
    // so the projection and the live gesture agree.
    float: false,
    margin: 8,
    draggable: { handle: '.tile-header' },
    // Horizontal only: intent carries a width share, and rows must stay
    // height-aligned for the cellHeight scroll rule to hold. Vertical resize
    // has no field to write into, so its handles are not offered.
    resizable: { handles: 'e, w' },
    animate: true,
  };

  readonly tiles = computed(() =>
    this.canvasStore.tilesFor(this.workspacePath())(),
  );

  private readonly layout = computed(() => {
    this.layoutService.containerWidth();
    this.layoutService.containerHeight();
    return this.layoutService.computeLayout(this.tiles());
  });

  /** Template view-model: derived geometry keyed by tabId, never by index. */
  protected readonly items = computed(() => {
    const derived = new Map(this.layout().tiles.map((t) => [t.tabId, t]));
    return this.tiles().map((tile) => {
      const position = derived.get(tile.tabId) ?? UNMEASURED_ITEM;
      return {
        tabId: tile.tabId,
        options: {
          x: position.x,
          y: position.y,
          w: position.w,
          h: position.h,
          id: tile.tabId,
        },
      };
    });
  });

  /**
   * True for the synchronous window in which this component is writing derived
   * geometry into Gridstack. `batchUpdate(false)` itself emits `change`
   * (gridstack.js `_triggerChangeEvent`), so batching cannot suppress the
   * write-back — this flag can, because Gridstack dispatches its events
   * synchronously. Always cleared in a `finally`: a stuck flag would silently
   * ignore every future user gesture.
   */
  private _applyingLayout = false;

  /** Set by dragStop/resizeStop, consumed by the `change` that follows. */
  private _gesture: GestureKind | null = null;

  private _wasVisible = false;

  constructor() {
    // Responsive layout: project derived geometry into Gridstack. Skipped while
    // hidden so Gridstack never runs layout math against a 0-width display:none
    // grid, and while locked so a frozen arrangement stays frozen.
    effect(() => {
      if (!this.visible()) return;
      const { cellHeight, tiles: positioned } = this.layout();
      const gridComp = this.gridComp();
      if (!gridComp?.grid || positioned.length === 0) return;
      if (this.locked()) return;

      const grid = gridComp.grid;
      const derived = new Map(positioned.map((t) => [t.tabId, t]));

      this._applyingLayout = true;
      try {
        grid.batchUpdate(true);
        grid.cellHeight(cellHeight);

        for (const node of grid.engine.nodes) {
          if (typeof node.id !== 'string' || !node.el) continue;
          const target = derived.get(node.id);
          if (!target) continue;
          grid.update(node.el, {
            x: target.x,
            y: target.y,
            w: target.w,
            h: target.h,
          });
        }

        grid.batchUpdate(false);
      } finally {
        this._applyingLayout = false;
      }
    });

    // Re-measure geometry once when a hidden grid is shown again — display:none
    // leaves Gridstack with a stale 0-width column measurement. Wrapped in the
    // same flag: the re-measure is the other non-gesture `change` source.
    effect(() => {
      const visible = this.visible();
      const grid = this.gridComp()?.grid;
      if (visible && !this._wasVisible && grid) {
        this._applyingLayout = true;
        try {
          (grid as unknown as { onResize?: () => void }).onResize?.();
        } finally {
          this._applyingLayout = false;
        }
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

  /** Latch a finished drag so the `change` that follows means "reorder". */
  onDragStop(): void {
    this._gesture = 'drag';
  }

  /** Latch a finished resize so the `change` that follows means "reweight". */
  onResizeStop(): void {
    this._gesture = 'resize';
  }

  /**
   * Translate a finished gesture back into stored intent.
   *
   * Reads `grid.engine.nodes` rather than the event's `nodes`: with
   * `float: false` a drag pushes neighbours whose ids are filtered out of the
   * dirty set Gridstack reports. A `change` with no latched gesture has no
   * legitimate source, so it writes nothing rather than guessing.
   */
  onGridChange(): void {
    if (this._applyingLayout) return;
    if (this.locked()) return;

    const gesture = this._gesture;
    this._gesture = null;
    const grid = this.gridComp()?.grid;
    if (!gesture || !grid) return;

    const nodes = grid.engine.nodes.filter(
      (node): node is typeof node & { id: string } =>
        typeof node.id === 'string',
    );
    if (nodes.length === 0) return;

    if (gesture === 'drag') {
      const ordered = [...nodes].sort(
        (a, b) => coord(a.y) - coord(b.y) || coord(a.x) - coord(b.x),
      );
      this.canvasStore.reorderTiles(ordered.map((node) => node.id));
      return;
    }

    const weights = new Map<string, number>();
    for (const node of nodes) {
      const width = node.w;
      if (typeof width !== 'number' || !Number.isFinite(width) || width <= 0) {
        continue;
      }
      weights.set(node.id, width);
    }
    if (weights.size > 0) this.canvasStore.setTileWeights(weights);
  }
}

/** A grid coordinate that is safe to sort on. */
function coord(value: number | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}
