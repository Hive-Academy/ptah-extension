import {
  Component,
  ChangeDetectionStrategy,
  inject,
  input,
  effect,
  computed,
  viewChild,
  OnDestroy,
} from '@angular/core';
import {
  GridStackOptions,
  type GridStackNode,
  type GridStackWidget,
} from 'gridstack';
import {
  GridstackComponent,
  GridstackItemComponent,
  type elementCB,
} from 'gridstack/dist/angular';
import { CanvasStore } from './canvas.store';
import { CanvasLayoutService } from './canvas-layout.service';
import { CanvasTileComponent } from './canvas-tile.component';
import {
  effectiveCapacity,
  projectDragIntent,
  type TilePositionObservation,
} from './canvas-layout-intent';
import { CanvasRenderMetricsService } from './canvas-render-metrics.service';

/** Which gesture just ended, latched before Gridstack's `change` fires. */
type GestureKind = 'drag' | 'resize';

interface GestureSnapshot {
  readonly kind: GestureKind;
  readonly workspacePath: string;
  readonly draggedId: string;
  readonly workspaceRevision: number;
  readonly effectiveCapacity: number;
  readonly expectedTabIds: readonly string[];
  lastDraggedPosition: TilePositionObservation;
}

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
    '[attr.data-canvas-measured-width]': 'layoutService.containerWidth()',
    '[attr.data-canvas-layout-computations]': "metric('layoutComputations')",
    '[attr.data-canvas-apply-checks]': "metric('applyChecks')",
    '[attr.data-canvas-apply-passes]': "metric('applyPasses')",
    '[attr.data-canvas-grid-updates]': "metric('gridUpdates')",
    '[attr.data-canvas-gesture-commits]': "metric('acceptedGestures')",
  },
  template: `
    <gridstack
      [options]="gsOptions"
      [class.singleton]="isSingleton()"
      (changeCB)="onGridChange()"
      (dragStartCB)="onGestureStart('drag', $event)"
      (dragCB)="onGestureMove($event)"
      (resizeStartCB)="onGestureStart('resize', $event)"
      (dragStopCB)="onGestureStop('drag', $event)"
      (resizeStopCB)="onGestureStop('resize', $event)"
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
        height: 100%;
      }

      gridstack.singleton {
        height: 100% !important;
      }

      gridstack.singleton > gridstack-item {
        top: 0 !important;
        left: 0 !important;
        width: 100% !important;
        height: 100% !important;
      }

      gridstack.singleton .ui-resizable-handle {
        display: none !important;
      }

      gridstack.singleton .tile-header {
        cursor: default !important;
      }
    `,
  ],
})
export class CanvasWorkspaceGridComponent implements OnDestroy {
  /** The workspace path this grid renders tiles for. */
  readonly workspacePath = input.required<string>();
  /** Whether this grid's workspace is the active (on-screen) one. */
  readonly visible = input.required<boolean>();
  /** Canvas-wide lock: freezes layout and disables drag/resize when true. */
  readonly locked = input<boolean>(false);

  readonly canvasStore = inject(CanvasStore);
  protected readonly layoutService = inject(CanvasLayoutService);
  protected readonly metrics = inject(CanvasRenderMetricsService);

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

  readonly isSingleton = computed(() => this.tiles().length === 1);

  private readonly capacity = computed(() =>
    effectiveCapacity(
      this.layoutService.columnsFor(this.layoutService.containerWidth()),
      this.canvasStore.columnsPreferenceFor(this.workspacePath()),
    ),
  );

  private readonly layout = computed(() => {
    this.layoutService.containerWidth();
    this.layoutService.containerHeight();
    // Count only cache misses: this callback runs when layout is actually
    // recomputed, unlike readers of the cached computed value.
    this.metrics.increment('layoutComputations', 1, false);
    return this.layoutService.computeLayout(
      this.tiles(),
      this.canvasStore.columnsPreferenceFor(this.workspacePath()),
    );
  });

  private readonly creationOptions = new Map<string, GridStackWidget>();

  /** Template view-model: derived geometry keyed by tabId, never by index. */
  protected readonly items = computed(() => {
    const derived = new Map(this.layout().tiles.map((t) => [t.tabId, t]));
    const liveIds = new Set(this.tiles().map((tile) => tile.tabId));
    for (const tabId of this.creationOptions.keys()) {
      if (!liveIds.has(tabId)) this.creationOptions.delete(tabId);
    }
    const isSingleton = this.isSingleton();
    return this.tiles().map((tile) => {
      const position = derived.get(tile.tabId) ?? UNMEASURED_ITEM;
      let options = this.creationOptions.get(tile.tabId);
      if (!options) {
        options = {
          x: position.x,
          y: position.y,
          w: position.w,
          h: position.h,
          id: tile.tabId,
          noMove: isSingleton,
          noResize: isSingleton,
        };
        this.creationOptions.set(tile.tabId, options);
        this.metrics.increment('creationOptionWrites', 1, false);
      } else {
        options.noMove = isSingleton;
        options.noResize = isSingleton;
      }
      return {
        tabId: tile.tabId,
        options,
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

  /** Captured at gesture start, consumed by the following `change`. */
  private _gesture: GestureSnapshot | null = null;
  private _gestureStopped = false;

  private _wasVisible = false;

  constructor() {
    // Responsive layout: project derived geometry into Gridstack. Skipped while
    // hidden so Gridstack never runs layout math against a 0-width display:none
    // grid, and while locked so a frozen arrangement stays frozen.
    effect(() => {
      if (!this.visible()) return;
      if (this.locked()) return;
      this.applyAuthoritativeGeometry();
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

    // For singleton session, suppress drag and resize handles on engine nodes
    // without forcing locked=true. For multi-session, restore handles unless locked.
    effect(() => {
      const grid = this.gridComp()?.grid;
      if (!grid) return;
      const isSingleton = this.isSingleton();
      const locked = this.locked();
      const canMove = !isSingleton && !locked;
      const canResize = !isSingleton && !locked;
      for (const node of grid.engine?.nodes ?? []) {
        if (node.el) {
          (
            grid as unknown as {
              movable?: (el: HTMLElement, val: boolean) => void;
            }
          ).movable?.(node.el, canMove);
          (
            grid as unknown as {
              resizable?: (el: HTMLElement, val: boolean) => void;
            }
          ).resizable?.(node.el, canResize);
        }
      }
    });

    effect(() => {
      const visible = this.visible();
      const locked = this.locked();
      const workspacePath = this.workspacePath();
      const capacity = this.capacity();
      const revision = this.canvasStore.workspaceRevision(workspacePath);
      const gesture = this._gesture;
      if (
        gesture &&
        (!visible ||
          locked ||
          gesture.workspacePath !== workspacePath ||
          gesture.effectiveCapacity !== capacity ||
          gesture.workspaceRevision !== revision)
      ) {
        this.cancelGesture();
      }
    });
  }

  onGestureStart(kind: GestureKind, event: elementCB): void {
    this.cancelGesture();
    if (!this.visible() || this.locked() || this.isSingleton()) return;
    const draggedId = event.el.gridstackNode?.id;
    if (typeof draggedId !== 'string') {
      this.metrics.increment('rejectedGestures');
      return;
    }
    const workspacePath = this.workspacePath();
    const tiles = this.tiles();
    this._gesture = {
      kind,
      workspacePath,
      draggedId,
      workspaceRevision: this.canvasStore.workspaceRevision(workspacePath),
      effectiveCapacity: this.capacity(),
      expectedTabIds: tiles.map((tile) => tile.tabId),
      lastDraggedPosition: this.positionFromElement(event.el, draggedId),
    };
    this._gestureStopped = false;
  }

  onGestureMove(event: elementCB): void {
    const gesture = this._gesture;
    if (!gesture || gesture.kind !== 'drag') return;
    gesture.lastDraggedPosition = this.positionFromElement(
      event.el,
      gesture.draggedId,
    );
  }

  onGestureStop(kind: GestureKind, event: elementCB): void {
    if (this._gesture?.kind !== kind) {
      this.cancelGesture();
      return;
    }
    this._gesture.lastDraggedPosition = this.positionFromElement(
      event.el,
      this._gesture.draggedId,
    );
    this._gestureStopped = true;
    queueMicrotask(() => {
      if (this._gestureStopped) this.cancelGesture();
    });
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
    this.metrics.increment('changeCallbacks');
    if (this._applyingLayout) return;
    if (this.locked() || !this.visible()) {
      this.cancelGesture();
      return;
    }
    const gesture = this._gesture;
    const grid = this.gridComp()?.grid;
    if (!gesture || !this._gestureStopped || !grid) return;
    this._gesture = null;
    this._gestureStopped = false;

    if (
      gesture.workspacePath !== this.workspacePath() ||
      gesture.workspaceRevision !==
        this.canvasStore.workspaceRevision(gesture.workspacePath) ||
      gesture.effectiveCapacity !== this.capacity()
    ) {
      this.metrics.increment('rejectedGestures');
      this.reconcileGesture(gesture);
      return;
    }

    const nodes = this.readCompleteNodes(grid.engine.nodes, gesture);
    if (!nodes) {
      this.metrics.increment('rejectedGestures');
      this.reconcileGesture(gesture);
      return;
    }

    if (gesture.kind === 'drag') {
      const projected = projectDragIntent(
        this.tiles(),
        nodes,
        gesture.draggedId,
        gesture.effectiveCapacity,
      );
      if (
        !projected ||
        !this.canvasStore.commitDragIntent(
          gesture.workspacePath,
          gesture.workspaceRevision,
          projected,
        )
      ) {
        this.metrics.increment('rejectedGestures');
        this.reconcileGesture(gesture);
        return;
      }
      this.metrics.increment('acceptedGestures');
      // A successful commit may still be a semantic no-op. Reconcile now
      // because an unchanged store revision would not retrigger the effect.
      this.reconcileGesture(gesture);
      return;
    }

    const weights = new Map<string, number>();
    for (const node of nodes) {
      const gridNode = grid.engine.nodes.find(
        (candidate) => candidate.id === node.tabId,
      );
      const width = gridNode?.w;
      if (typeof width !== 'number' || !Number.isFinite(width) || width <= 0) {
        this.metrics.increment('rejectedGestures');
        this.reconcileGesture(gesture);
        return;
      }
      weights.set(node.tabId, width);
    }
    if (
      this.canvasStore.commitResizeWeights(
        gesture.workspacePath,
        gesture.workspaceRevision,
        weights,
      )
    ) {
      this.metrics.increment('acceptedGestures');
    } else {
      this.metrics.increment('rejectedGestures');
    }
    this.reconcileGesture(gesture);
  }

  private readCompleteNodes(
    nodes: readonly GridStackNode[],
    gesture: GestureSnapshot,
  ): readonly TilePositionObservation[] | null {
    if (nodes.length !== gesture.expectedTabIds.length) return null;
    const expected = new Set(gesture.expectedTabIds);
    const seen = new Set<string>();
    const observations: TilePositionObservation[] = [];
    for (const node of nodes) {
      if (
        typeof node.id !== 'string' ||
        !expected.has(node.id) ||
        seen.has(node.id) ||
        typeof node.x !== 'number' ||
        !Number.isFinite(node.x) ||
        typeof node.y !== 'number' ||
        !Number.isInteger(node.y)
      ) {
        return null;
      }
      seen.add(node.id);
      observations.push(
        gesture.kind === 'drag' && node.id === gesture.draggedId
          ? gesture.lastDraggedPosition
          : { tabId: node.id, x: node.x, y: node.y },
      );
    }
    return seen.size === expected.size ? observations : null;
  }

  private cancelGesture(reconcile = true): void {
    const gesture = this._gesture;
    if (gesture) this.metrics.increment('cancelledGestures');
    this._gesture = null;
    this._gestureStopped = false;
    if (reconcile && gesture) this.reconcileGesture(gesture);
  }

  private reconcileGesture(gesture: GestureSnapshot): void {
    // A component input change invalidates the old grid/workspace association.
    // Never project a rejected old-workspace gesture through the new partition.
    if (gesture.workspacePath !== this.workspacePath()) return;
    this.applyAuthoritativeGeometry(true);
  }

  /**
   * Project the current workspace's authoritative intent into existing engine
   * nodes. `force` is used only to settle a gesture the engine already moved;
   * unknown or removed nodes are skipped, so reconciliation cannot resurrect a
   * tile or address another workspace. Equal workspace revisions guarantee the
   * path-scoped tile membership read here is the membership captured at start,
   * because every intent mutation advances that partition's revision.
   */
  private applyAuthoritativeGeometry(force = false): void {
    if (!force && (!this.visible() || this.locked())) return;
    const { cellHeight, tiles: positioned } = this.layout();
    this.metrics.increment('applyChecks');
    const grid = this.gridComp()?.grid;
    if (!grid || positioned.length === 0) return;

    const derived = new Map(positioned.map((tile) => [tile.tabId, tile]));
    const changed: Array<{
      node: GridStackNode & { el: HTMLElement };
      target: { x: number; y: number; w: number; h: number };
    }> = [];
    for (const node of grid.engine.nodes) {
      if (typeof node.id !== 'string' || !node.el) continue;
      const target = derived.get(node.id);
      if (!target) continue;
      if (
        node.x !== target.x ||
        node.y !== target.y ||
        node.w !== target.w ||
        node.h !== target.h
      ) {
        changed.push({
          node: node as GridStackNode & { el: HTMLElement },
          target,
        });
      }
    }

    this._applyingLayout = true;
    try {
      if (changed.length > 0) {
        this.metrics.increment('applyPasses');
        grid.batchUpdate(true);
        grid.cellHeight(cellHeight);
        for (const { node, target } of changed) {
          grid.update(node.el, target);
          this.metrics.increment('gridUpdates');
        }
        grid.batchUpdate(false);
      } else if (grid.getCellHeight() !== cellHeight) {
        grid.cellHeight(cellHeight);
      }
      const isSingleton = this.isSingleton();
      const locked = this.locked();
      const canMove = !isSingleton && !locked;
      const canResize = !isSingleton && !locked;
      for (const node of grid.engine?.nodes ?? []) {
        if (node.el) {
          (
            grid as unknown as {
              movable?: (el: HTMLElement, val: boolean) => void;
            }
          ).movable?.(node.el, canMove);
          (
            grid as unknown as {
              resizable?: (el: HTMLElement, val: boolean) => void;
            }
          ).resizable?.(node.el, canResize);
        }
      }
    } finally {
      this._applyingLayout = false;
      // Publishes layout-computation increments that intentionally avoided a
      // signal write from inside the computed callback.
      this.metrics.publish();
    }
  }

  protected metric(
    name: keyof ReturnType<CanvasRenderMetricsService['snapshot']>,
  ): number {
    this.metrics.version();
    return this.metrics.snapshot()[name];
  }

  private positionFromElement(
    element: elementCB['el'],
    tabId: string,
  ): TilePositionObservation {
    const node = element.gridstackNode;
    return {
      tabId,
      x: typeof node?.x === 'number' && Number.isFinite(node.x) ? node.x : 0,
      y: typeof node?.y === 'number' && Number.isInteger(node.y) ? node.y : 0,
    };
  }

  ngOnDestroy(): void {
    this.cancelGesture(false);
  }
}
