import { Injectable, DestroyRef, inject, signal } from '@angular/core';
import { packRows, type TileIntent } from './canvas-layout-intent';

const MARGIN = 8;
const TILE_HEIGHT_UNITS = 6;
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
/** Upper clamp on derived columns — preserves the 3x3 / `MAX_TILES = 9` grid. */
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
  private resizeObserver: ResizeObserver | null = null;
  private rafId: number | null = null;

  private readonly _containerWidth = signal(0);
  private readonly _containerHeight = signal(0);

  readonly containerWidth = this._containerWidth.asReadonly();
  readonly containerHeight = this._containerHeight.asReadonly();

  constructor() {
    this.destroyRef.onDestroy(() => this.disconnect());
  }

  observe(element: HTMLElement): void {
    this.disconnect();
    this.resizeObserver = new ResizeObserver((entries) => {
      if (this.rafId !== null) cancelAnimationFrame(this.rafId);
      this.rafId = requestAnimationFrame(() => {
        const entry = entries[0];
        if (entry) {
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
   * Total function: no throws, no side effects, safe to call from a `computed`.
   */
  computeLayout(
    tiles: readonly TileIntent[],
    layoutFocusTabId: string | null = null,
  ): CanvasLayout {
    const width = this._containerWidth();
    const height = this._containerHeight();

    if (tiles.length === 0 || width === 0 || height === 0) {
      return { cellHeight: 120, columns: 1, tiles: [] };
    }

    const columns = this.columnsFor(width);
    const rows = packRows(tiles, columns, layoutFocusTabId);

    const positioned: PositionedTile[] = [];
    rows.forEach((row, rowIndex) => {
      let x = 0;
      for (const tile of row) {
        positioned.push({
          tabId: tile.tabId,
          x,
          y: rowIndex * TILE_HEIGHT_UNITS,
          w: tile.units,
          h: TILE_HEIGHT_UNITS,
        });
        x += tile.units;
      }
    });

    return {
      cellHeight: cellHeightFor(height, rows.length),
      columns,
      tiles: positioned,
    };
  }

  private disconnect(): void {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
  }
}

/**
 * Keep each tile at least `MIN_TILE_VIEWPORT_RATIO` of the viewport height;
 * once tiles wrap onto a second row the derived height exceeds the container
 * and the canvas host scrolls instead of shrinking every tile.
 */
function cellHeightFor(height: number, rows: number): number {
  const totalMargins = (rows + 1) * MARGIN;
  const availableHeight = height - totalMargins;
  const fitCellHeight = Math.floor(
    availableHeight / (rows * TILE_HEIGHT_UNITS),
  );
  const minTileCellHeight = Math.floor(
    (height * MIN_TILE_VIEWPORT_RATIO) / TILE_HEIGHT_UNITS,
  );
  return Math.max(MIN_CELL_HEIGHT, fitCellHeight, minTileCellHeight);
}
