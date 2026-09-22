import {
  Component,
  ChangeDetectionStrategy,
  inject,
  input,
  effect,
  afterRenderEffect,
  linkedSignal,
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
import {
  CanvasLayoutService,
  type CanvasLayout,
} from './canvas-layout.service';
import { CanvasTileComponent } from './canvas-tile.component';
import {
  effectiveUnits,
  projectDragIntent,
  snapSpan,
  viewConstraintsFingerprint,
  type TilePositionObservation,
  type TileSpan,
  type TileViewConstraint,
  type TileViewConstraints,
  type TileWidthIntent,
} from './canvas-layout-intent';
import { CanvasRenderMetricsService } from './canvas-render-metrics.service';
import { TabManagerService } from '@ptah-extension/chat';
import { isCompactViewMode } from '@ptah-extension/chat-types';

interface CanvasGridItem {
  tabId: string;
  width: TileWidthIntent;
  rowBreakBefore: boolean;
  firstInOrder: boolean;
  options: GridStackWidget;
}

/** Which gesture just ended, latched before Gridstack's `change` fires. */
type GestureKind = 'drag' | 'resize';

interface GestureSnapshot {
  readonly kind: GestureKind;
  readonly workspacePath: string;
  readonly draggedId: string;
  readonly workspaceRevision: number;
  readonly responsiveCapacity: number;
  readonly layoutFocusTabId: string | null;
  readonly viewFingerprint: string;
  readonly expectedTabIds: readonly string[];
  lastDraggedPosition: TilePositionObservation;
}

interface LayoutMeasurements {
  readonly width: number;
  readonly height: number;
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
 * way — `CanvasStore` intent -> `CanvasLayoutService` -> `grid.load()` — and
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
      [class.singleton-expanded]="isSingletonExpanded()"
      [style.--ptah-compact-singleton-height]="compactSingletonHeight()"
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
            [visible]="active()"
            [focused]="canvasStore.focusedTabId() === item.tabId"
            [widthIntent]="item.width"
            [rowBreakBefore]="item.rowBreakBefore"
            [firstInOrder]="item.firstInOrder"
            [layoutFocused]="layoutFocusTabId() === item.tabId"
            [layoutLocked]="locked()"
            (focusRequested)="canvasStore.focusTile($event)"
            (closeRequested)="canvasStore.removeTile($event)"
            (spanRequested)="onSpanRequested(item.tabId, $event)"
            (layoutFocusToggled)="onLayoutFocusToggled(item.tabId)"
            (rowBreakToggled)="onRowBreakToggled(item.tabId)"
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

      /* Only a full or layout-focused singleton fills the canvas; a compact
         singleton keeps its projected tier height instead of stretching. */
      gridstack.singleton-expanded > gridstack-item {
        top: 0 !important;
        left: 0 !important;
        width: 100% !important;
        height: 100% !important;
      }

      /* Gridstack 12's calculated compact inline height is not resolved by the
         Electron renderer, leaving the item at its content-driven full height.
         Publish the already-computed pixel height as a calculation-free CSS
         variable for the only non-expanded singleton tier. */
      gridstack.singleton:not(.singleton-expanded) > gridstack-item {
        height: var(--ptah-compact-singleton-height) !important;
      }

      :host ::ng-deep gridstack.singleton .ui-resizable-handle,
      :host
        ::ng-deep
        gridstack-item.ui-resizable-disabled
        > .ui-resizable-handle {
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
  private readonly tabManager = inject(TabManagerService);
  protected readonly layoutService = inject(CanvasLayoutService);
  protected readonly metrics = inject(CanvasRenderMetricsService);

  protected readonly active = computed(
    () => this.layoutService.active() && this.visible(),
  );

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
    // Horizontal only: intent carries a named span, and rows must stay
    // height-aligned for the cellHeight scroll rule to hold. Vertical resize
    // has no field to write into, so its handles are not offered.
    resizable: { handles: 'e, w' },
    animate: true,
  };

  readonly tiles = computed(() =>
    this.canvasStore.tilesFor(this.workspacePath())(),
  );

  readonly isSingleton = computed(() => this.tiles().length === 1);

  /**
   * Transient per-tile height tiers, derived from `TabManagerService` view
   * mode in reading order. Missing tabs or missing `viewMode` project as
   * full. Structural equality over `(tabId, heightTier)` keeps unrelated
   * `TabState` writes (streaming, status) from producing layout work.
   */
  readonly viewConstraints = computed<TileViewConstraints>(
    () => {
      const tabs = this.tabManager.tabs();
      const byId = new Map(tabs.map((tab) => [tab.id as string, tab]));
      return [...this.tiles()]
        .sort((a, b) => a.order - b.order || a.tabId.localeCompare(b.tabId))
        .map((tile): TileViewConstraint => ({
          tabId: tile.tabId,
          heightTier: byId.get(tile.tabId)?.viewMode ?? 'full',
        }));
    },
    {
      equal: (a, b) =>
        a.length === b.length &&
        a.every(
          (constraint, index) =>
            constraint.tabId === b[index].tabId &&
            constraint.heightTier === b[index].heightTier,
        ),
    },
  );

  /** Structural fingerprint of the current view constraints. */
  readonly viewFingerprint = computed(() =>
    viewConstraintsFingerprint(this.viewConstraints()),
  );

  private readonly compactTabIds = computed(
    () =>
      new Set(
        this.viewConstraints()
          .filter((constraint) => isCompactViewMode(constraint.heightTier))
          .map((constraint) => constraint.tabId),
      ),
  );

  /** A singleton fills the canvas only when full or layout-focused. */
  protected readonly isSingletonExpanded = computed(() => {
    if (!this.isSingleton()) return false;
    if (this.layoutFocusTabId() !== null) return true;
    const constraints = this.viewConstraints();
    return !(
      constraints.length === 1 && isCompactViewMode(constraints[0].heightTier)
    );
  });

  /** Responsive column capacity; spans promote against it at render time. */
  private readonly capacity = computed(() =>
    this.layoutService.columnsFor(this.layoutService.containerWidth()),
  );

  /** Transient layout focus for this workspace; move/resize pause while set. */
  protected readonly layoutFocusTabId = computed(() =>
    this.canvasStore.layoutFocusTabIdFor(this.workspacePath()),
  );

  private readonly layout = linkedSignal<boolean, CanvasLayout>({
    source: this.active,
    computation: (active, previous) => {
      if (!active)
        return previous?.value ?? { cellHeight: 120, columns: 1, tiles: [] };
      this.layoutService.containerWidth();
      this.layoutService.containerHeight();
      // Count only cache misses: this callback runs when layout is actually
      // recomputed, unlike readers of the cached computed value.
      this.metrics.increment('layoutComputations', 1, false);
      return this.layoutService.computeLayout(
        this.tiles(),
        this.layoutFocusTabId(),
        this.viewConstraints(),
      );
    },
  });

  protected readonly compactSingletonHeight = linkedSignal<boolean, string>({
    source: this.active,
    computation: (active, previous) => {
      if (!active) return previous?.value ?? '0px';
      const measurements = this.locked()
        ? (this._lockedMeasurements ??
          this._lastAppliedMeasurements ??
          this.currentMeasurements())
        : this.currentMeasurements();
      const layout = this.layoutService.computeLayout(
        this.tiles(),
        this.layoutFocusTabId(),
        this.viewConstraints(),
        measurements,
      );
      return `${layout.cellHeight * (layout.tiles[0]?.h ?? 0)}px`;
    },
  });

  private readonly creationOptions = new Map<string, GridStackWidget>();

  /** Template view-model: derived geometry keyed by tabId, never by index. */
  protected readonly items = linkedSignal<boolean, CanvasGridItem[]>({
    source: this.active,
    computation: (active, previous) => {
      if (!active) return previous?.value ?? [];
      const derived = new Map(this.layout().tiles.map((t) => [t.tabId, t]));
      const liveIds = new Set(this.tiles().map((tile) => tile.tabId));
      for (const tabId of this.creationOptions.keys()) {
        if (!liveIds.has(tabId)) this.creationOptions.delete(tabId);
      }
      const frozen = this.isSingleton() || this.layoutFocusTabId() !== null;
      const compactIds = this.compactTabIds();
      const firstId = firstByOrder(this.tiles());
      return this.tiles().map((tile) => {
        const position = derived.get(tile.tabId) ?? UNMEASURED_ITEM;
        // Compact width is derived, not stored: a resize handle would write a
        // hidden span the user cannot see until returning to full mode.
        const noResize = frozen || compactIds.has(tile.tabId);
        let options = this.creationOptions.get(tile.tabId);
        if (!options) {
          options = {
            x: position.x,
            y: position.y,
            w: position.w,
            h: position.h,
            id: tile.tabId,
            noMove: frozen,
            noResize,
          };
          this.creationOptions.set(tile.tabId, options);
          this.metrics.increment('creationOptionWrites', 1, false);
        } else {
          options.noMove = frozen;
          options.noResize = noResize;
        }
        return {
          tabId: tile.tabId,
          width: tile.width,
          rowBreakBefore: tile.rowBreakBefore,
          firstInOrder: tile.tabId === firstId,
          options,
        };
      });
    },
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
  private _needsReconcile = false;

  /**
   * View fingerprint this grid last applied to Gridstack. While locked, an
   * ordinary layout effect run is forbidden, but a tab-owned view-mode change
   * is not a layout-intent mutation: a differing fingerprint is the one
   * application a locked grid may still perform. Hidden locked grids keep the
   * pending difference and apply it when they become visible again.
   */
  private _appliedViewFingerprint: string | null = null;
  private _lastAppliedMeasurements: LayoutMeasurements | null = null;
  private _lockedMeasurements: LayoutMeasurements | null = null;

  constructor() {
    // Responsive layout: project derived geometry into Gridstack. Skipped while
    // hidden so Gridstack never runs layout math against a 0-width display:none
    // grid, and while locked so a frozen arrangement stays frozen — except the
    // view-mode exception below.
    afterRenderEffect(() => {
      const active = this.active();
      const grid = this.gridComp()?.grid;
      if (!active) {
        this._wasVisible = false;
        return;
      }
      this.layoutService.containerWidth();
      this.layoutService.containerHeight();
      if (!grid) return;
      if (!this._wasVisible) {
        this._applyingLayout = true;
        try {
          grid.onResize();
        } finally {
          this._applyingLayout = false;
        }
        this._wasVisible = true;
      }
      if (this.locked()) {
        this._lockedMeasurements ??=
          this._lastAppliedMeasurements ?? this.currentMeasurements();
        if (
          this._needsReconcile ||
          this.viewFingerprint() !== this._appliedViewFingerprint
        ) {
          // A locked grid can project view-mode changes or settle a gesture
          // cancelled while hidden. Freeze measurements so a pending responsive
          // reflow cannot hitchhike on either exception.
          this.applyAuthoritativeGeometry(true, this._lockedMeasurements);
        }
        return;
      }
      this._lockedMeasurements = null;
      this.applyAuthoritativeGeometry();
    });

    // Apply the canvas-wide lock to this grid's Gridstack instance.
    effect(() => {
      if (!this.active()) return;
      const locked = this.locked();
      const grid = this.gridComp()?.grid;
      grid?.setStatic(locked);
    });

    // For singleton session, suppress drag and resize handles on engine nodes
    // without forcing locked=true. For multi-session, restore handles unless locked.
    effect(() => {
      if (!this.active()) return;
      const grid = this.gridComp()?.grid;
      if (!grid) return;
      this.applyNodeInteractionState(grid);
    });

    effect(() => {
      const visible = this.active();
      const locked = this.locked();
      const workspacePath = this.workspacePath();
      const capacity = this.capacity();
      const layoutFocusTabId = this.layoutFocusTabId();
      const viewFingerprint = this.viewFingerprint();
      const revision = this.canvasStore.workspaceRevision(workspacePath);
      const gesture = this._gesture;
      if (
        gesture &&
        (!visible ||
          locked ||
          gesture.workspacePath !== workspacePath ||
          gesture.responsiveCapacity !== capacity ||
          gesture.layoutFocusTabId !== layoutFocusTabId ||
          gesture.viewFingerprint !== viewFingerprint ||
          gesture.workspaceRevision !== revision)
      ) {
        this.cancelGesture();
      }
    });
  }

  onGestureStart(kind: GestureKind, event: elementCB): void {
    this.cancelGesture();
    if (
      !this.active() ||
      this.locked() ||
      this.isSingleton() ||
      this.layoutFocusTabId() !== null
    ) {
      return;
    }
    const draggedId = event.el.gridstackNode?.id;
    if (typeof draggedId !== 'string') {
      this.metrics.increment('rejectedGestures');
      return;
    }
    // Compact width is derived from the responsive capacity, so a resize has
    // no durable value to write. Refuse a stale handle event defensively.
    if (kind === 'resize' && this.compactTabIds().has(draggedId)) {
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
      responsiveCapacity: this.capacity(),
      layoutFocusTabId: this.layoutFocusTabId(),
      viewFingerprint: this.viewFingerprint(),
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
    if (this.locked() || !this.active()) {
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
      gesture.responsiveCapacity !== this.capacity() ||
      gesture.layoutFocusTabId !== this.layoutFocusTabId() ||
      gesture.viewFingerprint !== this.viewFingerprint()
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
        gesture.responsiveCapacity,
        this.viewConstraints(),
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

    // Resize writes only the dragged tile's snapped span; neighbours the engine
    // pushed are settled back from authoritative intent below.
    const width = grid.engine.nodes.find(
      (candidate) => candidate.id === gesture.draggedId,
    )?.w;
    let accepted = false;
    if (typeof width === 'number' && Number.isFinite(width) && width > 0) {
      const snappedSpan = snapSpan(width);
      const currentWidth = this.canvasStore
        .tilesFor(gesture.workspacePath)()
        .find((tile) => tile.tabId === gesture.draggedId)?.width;
      const keepsResponsiveNamedSpan =
        currentWidth?.kind === 'span' &&
        effectiveUnits(currentWidth, gesture.responsiveCapacity) ===
          effectiveUnits(
            { kind: 'span', span: snappedSpan },
            gesture.responsiveCapacity,
          );
      accepted =
        keepsResponsiveNamedSpan ||
        this.canvasStore.commitResizeSpan(
          gesture.workspacePath,
          gesture.workspaceRevision,
          gesture.draggedId,
          snappedSpan,
        );
    }
    if (accepted) {
      this.metrics.increment('acceptedGestures');
    } else {
      this.metrics.increment('rejectedGestures');
    }
    this.reconcileGesture(gesture);
  }

  /** Tile-menu actions: lock refuses them here as well as in the store. */
  protected onSpanRequested(tabId: string, span: TileSpan): void {
    if (this.locked()) return;
    this.canvasStore.setTileSpan(this.workspacePath(), tabId, span);
  }

  protected onLayoutFocusToggled(tabId: string): void {
    if (this.locked()) return;
    this.cancelGesture();
    this.canvasStore.toggleLayoutFocus(this.workspacePath(), tabId);
  }

  protected onRowBreakToggled(tabId: string): void {
    if (this.locked()) return;
    this.canvasStore.toggleRowBreak(this.workspacePath(), tabId);
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
        !Number.isInteger(node.y) ||
        typeof node.w !== 'number' ||
        !Number.isFinite(node.w) ||
        typeof node.h !== 'number' ||
        !Number.isInteger(node.h)
      ) {
        return null;
      }
      seen.add(node.id);
      observations.push(
        gesture.kind === 'drag' && node.id === gesture.draggedId
          ? gesture.lastDraggedPosition
          : { tabId: node.id, x: node.x, y: node.y, w: node.w, h: node.h },
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
    if (!this.active()) {
      this._needsReconcile = true;
      return;
    }
    this.applyAuthoritativeGeometry(
      true,
      this.locked() ? (this._lockedMeasurements ?? undefined) : undefined,
    );
  }

  /**
   * Project the current workspace's authoritative intent into existing engine
   * nodes. `force` is used only to settle a gesture the engine already moved;
   * unknown or removed nodes are skipped, so reconciliation cannot resurrect a
   * tile or address another workspace. Equal workspace revisions guarantee the
   * path-scoped tile membership read here is the membership captured at start,
   * because every intent mutation advances that partition's revision.
   */
  private applyAuthoritativeGeometry(
    force = false,
    frozenMeasurements?: LayoutMeasurements,
  ): void {
    if (!this.active() || (!force && this.locked())) return;
    const measurements = frozenMeasurements ?? this.currentMeasurements();
    const { cellHeight, tiles: positioned } = frozenMeasurements
      ? this.layoutService.computeLayout(
          this.tiles(),
          this.layoutFocusTabId(),
          this.viewConstraints(),
          frozenMeasurements,
        )
      : this.layout();
    this.metrics.increment('applyChecks');
    const viewFingerprint = this.viewFingerprint();
    if (positioned.length === 0) {
      this._needsReconcile = false;
      this._appliedViewFingerprint = viewFingerprint;
      this._lastAppliedMeasurements = measurements;
      return;
    }
    const grid = this.gridComp()?.grid;
    if (!grid) return;

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
    const restoreStatic = this.locked();
    try {
      // Gridstack may ignore programmatic updates while static. Suspend static
      // mode only inside the guarded authoritative write, then restore it in
      // `finally` before re-applying per-node interaction state.
      if (restoreStatic) grid.setStatic(false);
      if (changed.length > 0) {
        this.metrics.increment('applyPasses');
        grid.cellHeight(cellHeight);
        // Gridstack's documented all-node path removes matching engine nodes
        // before re-adding the collision-free authoritative snapshot. Unlike
        // sequential update(), a growing tile cannot push or swap a neighbour
        // whose target is being applied later in the same pass.
        grid.load(
          positioned.map(({ tabId, x, y, w, h }) => ({
            id: tabId,
            x,
            y,
            w,
            h,
          })),
          false,
        );
        this.metrics.increment('gridUpdates', changed.length);
      } else if (grid.getCellHeight() !== cellHeight) {
        grid.cellHeight(cellHeight);
      }
      this._needsReconcile = false;
      this._appliedViewFingerprint = viewFingerprint;
      this._lastAppliedMeasurements = measurements;
      if (!restoreStatic) this.applyNodeInteractionState(grid);
    } finally {
      try {
        if (restoreStatic) {
          grid.setStatic(true);
          // setStatic() can reset node-level movable/resizable overrides.
          this.applyNodeInteractionState(grid);
        }
      } finally {
        this._applyingLayout = false;
        // Publishes layout-computation increments that intentionally avoided a
        // signal write from inside the computed callback.
        this.metrics.publish();
      }
    }
  }

  private currentMeasurements(): LayoutMeasurements {
    return {
      width: this.layoutService.containerWidth(),
      height: this.layoutService.containerHeight(),
    };
  }

  private applyNodeInteractionState(grid: {
    engine?: { nodes?: readonly GridStackNode[] };
    movable?: (el: HTMLElement, val: boolean) => void;
    resizable?: (el: HTMLElement, val: boolean) => void;
  }): void {
    const movable =
      !this.isSingleton() && !this.locked() && this.layoutFocusTabId() === null;
    const compactIds = this.compactTabIds();
    for (const node of grid.engine?.nodes ?? []) {
      if (!node.el) continue;
      // Compact tiles stay movable but never resizable: their width is a
      // projection of the responsive capacity, not stored intent.
      const resizable =
        movable && !(typeof node.id === 'string' && compactIds.has(node.id));
      grid.movable?.(node.el, movable);
      grid.resizable?.(node.el, resizable);
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
      w: typeof node?.w === 'number' && Number.isFinite(node.w) ? node.w : 0,
      h: typeof node?.h === 'number' && Number.isInteger(node.h) ? node.h : 0,
    };
  }

  ngOnDestroy(): void {
    this.cancelGesture(false);
  }
}

function firstByOrder(
  tiles: readonly { tabId: string; order: number }[],
): string | undefined {
  return [...tiles].sort(
    (a, b) => a.order - b.order || a.tabId.localeCompare(b.tabId),
  )[0]?.tabId;
}
