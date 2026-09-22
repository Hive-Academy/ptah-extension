import {
  Injectable,
  DestroyRef,
  inject,
  signal,
  effect,
  afterRenderEffect,
} from '@angular/core';
import {
  FULL_TILE_HEIGHT_UNITS,
  projectTileGeometry,
  totalExtentOf,
  type TileIntent,
  type TileViewConstraints,
} from './canvas-layout-intent';

import { SURFACE_ACTIVE } from '@ptah-extension/core';

const MARGIN = 8;
const MIN_CELL_HEIGHT = 20;
/**
 * Each session tile is kept at least this fraction of the viewport height.
 * When tiles span multiple rows the canvas scrolls vertically instead of
 * shrinking every tile to fit, so a 4-tile layout stays readable.
 */
const MIN_TILE_VIEWPORT_RATIO = 0.9;

/**
 * Narrowest a chat tile may get before the column count drops. Columns are
 * derived from this rather than from pixel breakpoints, so opening the editor
 * panel (which narrows the canvas to ~1180 px) moves 3 columns down to 2
 * instead of squeezing three ~380 px tiles into the same space.
 */
export const MIN_TILE_WIDTH = 480;
/** Upper clamp on derived columns. Tiles past the third wrap into a new row. */
export const MAX_COLUMNS = 3;

export interface TileLayout {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A derived position, keyed by tabId rather than by array index. */
export type PositionedTile = TileLayout & { tabId: string };

export interface CanvasLayout {
  cellHeight: number;
  columns: number;
  tiles: PositionedTile[];
}

@Injectable()
export class CanvasLayoutService {
  private readonly destroyRef = inject(DestroyRef);
  /** The always-mounted wrapper owns router and layout-mode activity. */
  readonly active = inject(SURFACE_ACTIVE);
  private wasActive = this.active();
  private element: HTMLElement | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private rafId: number | null = null;
  private frameGeneration = 0;

  private readonly _containerWidth = signal(0);
  private readonly _containerHeight = signal(0);

  readonly containerWidth = this._containerWidth.asReadonly();
  readonly containerHeight = this._containerHeight.asReadonly();

  constructor() {
    effect(() => {
      if (!this.active()) this.cancelFrame();
    });
    afterRenderEffect(() => {
      const active = this.active();
      if (active && !this.wasActive && this.element && this.resizeObserver) {
        // Re-observation requests fresh content-box geometry after unhide,
        // even when the visible dimensions match the last delivered entry.
        this.resizeObserver.disconnect();
        this.resizeObserver.observe(this.element);
      }
      this.wasActive = active;
    });
    this.destroyRef.onDestroy(() => this.disconnect());
  }

  observe(element: HTMLElement): void {
    this.disconnect();
    this.element = element;
    this.resizeObserver = new ResizeObserver((entries) => {
      const entry = entries[0];
      // Discard BEFORE cancelling. Hiding the grid delivers a 0x0 entry, and
      // cancelling first meant that entry revoked a good measurement still
      // pending in a frame and then scheduled nothing to replace it — the
      // container dimensions stayed stale at whatever they were an update ago.
      // Each callback captures its own `entry`, so a pending frame left alone
      // still applies the good size it was scheduled with.
      if (
        !this.active() ||
        !entry ||
        entry.contentRect.width <= 0 ||
        entry.contentRect.height <= 0
      )
        return;
      this.cancelFrame();
      const generation = this.frameGeneration;
      this.rafId = requestAnimationFrame(() => {
        if (generation !== this.frameGeneration) return;
        if (this.active()) {
          this._containerWidth.set(Math.floor(entry.contentRect.width));
          this._containerHeight.set(Math.floor(entry.contentRect.height));
        }
        this.rafId = null;
      });
    });
    this.resizeObserver.observe(element);
  }

  /**
   * Column count for a measured container width.
   *
   * `n` tiles of `MIN_TILE_WIDTH` need `n * T + (n + 1) * M` pixels, so
   * `n <= (W + M) / (T + M)`. Clamped to 1..`MAX_COLUMNS`.
   */
  columnsFor(width: number): number {
    if (!Number.isFinite(width) || width <= 0) return 1;
    const fit = Math.floor((width + MARGIN) / (MIN_TILE_WIDTH + MARGIN));
    return Math.min(MAX_COLUMNS, Math.max(1, fit));
  }

  /**
   * Derive concrete Gridstack geometry from tile intent plus the measured
   * container. The optional layout-focus tile renders alone at full width.
   * Transient view constraints select the compact height tier per tile;
   * absent constraints keep the full-only behaviour. Callers may supply a
   * frozen measurement pair when projecting a view-only change under lock.
   * Total function: no throws, no side effects, safe to call from a `computed`.
   */
  computeLayout(
    tiles: readonly TileIntent[],
    layoutFocusTabId: string | null = null,
    viewConstraints: TileViewConstraints = [],
    measurements?: Readonly<{ width: number; height: number }>,
  ): CanvasLayout {
    const width = measurements?.width ?? this._containerWidth();
    const height = measurements?.height ?? this._containerHeight();

    if (tiles.length === 0 || width === 0 || height === 0) {
      return { cellHeight: 120, columns: 1, tiles: [] };
    }

    const columns = this.columnsFor(width);
    const projected = projectTileGeometry(
      tiles,
      columns,
      layoutFocusTabId,
      viewConstraints,
    );

    const positioned: PositionedTile[] = projected.map((tile) => ({
      tabId: tile.tabId,
      x: tile.x,
      y: tile.y,
      w: tile.w,
      h: tile.h,
    }));
    const totalExtent = totalExtentOf(projected);
    const hasFullTile = projected.some(
      (tile) => tile.h === FULL_TILE_HEIGHT_UNITS,
    );

    return {
      cellHeight: cellHeightFor(height, totalExtent, hasFullTile),
      columns,
      tiles: positioned,
    };
  }

  private cancelFrame(): void {
    this.frameGeneration++;
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }

  private disconnect(): void {
    this.cancelFrame();
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.element = null;
  }
}

/**
 * Fit cell height to the projected vertical extent. `totalExtent` is
 * `max(y + h)` over the skyline, so a compact tile's freed space shrinks the
 * scroll length instead of stretching the rows. The 90%-viewport floor
 * protects full (six-unit) tiles only; all-compact layouts fit their true
 * extent, and a compact singleton never stretches its two units back to full
 * viewport height because the fit denominator is `max(totalExtent, 6)`.
 */
function cellHeightFor(
  height: number,
  totalExtent: number,
  hasFullTile: boolean,
): number {
  const bands = Math.ceil(totalExtent / FULL_TILE_HEIGHT_UNITS);
  const totalMargins = (bands + 1) * MARGIN;
  const fitCellHeight = Math.floor(
    (height - totalMargins) / Math.max(totalExtent, FULL_TILE_HEIGHT_UNITS),
  );
  const fullFloorCellHeight = hasFullTile
    ? Math.floor((height * MIN_TILE_VIEWPORT_RATIO) / FULL_TILE_HEIGHT_UNITS)
    : 0;
  return Math.max(MIN_CELL_HEIGHT, fitCellHeight, fullFloorCellHeight);
}
