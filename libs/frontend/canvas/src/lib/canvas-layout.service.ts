import { Injectable, DestroyRef, inject, signal } from '@angular/core';
import {
  effectiveCapacity,
  logicalRows,
  type ColumnsPreference,
} from './canvas-layout-intent';

const GRID_COLUMNS = 12;
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
/** Floor on a tile's apportioned width, in Gridstack units (of `GRID_COLUMNS`). */
export const MIN_TILE_UNITS = 2;

/** Default relative width share for a tile the user has never resized. */
export const DEFAULT_TILE_WEIGHT = 1;

/**
 * Stored tile intent: where a tile sits in reading order and how much width it
 * claims relative to its row-mates. Concrete `x`/`y`/`w`/`h` are derived from
 * this — never stored.
 */
export interface TileIntent {
  readonly tabId: string;
  readonly order: number;
  readonly weight: number;
  readonly rowBreakBefore: boolean;
}

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
   * container. Total function: no throws, no side effects, safe to call from a
   * `computed`.
   */
  computeLayout(
    tiles: readonly TileIntent[],
    preference: ColumnsPreference = 'auto',
  ): CanvasLayout {
    const width = this._containerWidth();
    const height = this._containerHeight();

    if (tiles.length === 0 || width === 0 || height === 0) {
      return { cellHeight: 120, columns: 1, tiles: [] };
    }

    const columns = effectiveCapacity(this.columnsFor(width), preference);
    const rows = logicalRows(tiles).flatMap((row) => {
      const chunks: TileIntent[][] = [];
      for (let index = 0; index < row.length; index += columns) {
        chunks.push(row.slice(index, index + columns));
      }
      return chunks;
    });

    const positioned: PositionedTile[] = [];
    for (let row = 0; row < rows.length; row++) {
      const rowTiles = rows[row];
      const widths = apportionRow(
        rowTiles.map((t) => normalizeWeight(t.weight)),
      );
      let x = 0;
      for (let i = 0; i < rowTiles.length; i++) {
        positioned.push({
          tabId: rowTiles[i].tabId,
          x,
          y: row * TILE_HEIGHT_UNITS,
          w: widths[i],
          h: TILE_HEIGHT_UNITS,
        });
        x += widths[i];
      }
    }

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

/** A weight that never reaches the apportionment as `NaN`, `0` or negative. */
function normalizeWeight(weight: number): number {
  return Number.isFinite(weight) && weight > 0 ? weight : DEFAULT_TILE_WEIGHT;
}

/**
 * Largest-remainder apportionment of `GRID_COLUMNS` units across one row.
 * Every returned row sums to exactly `GRID_COLUMNS` and no entry is below
 * `MIN_TILE_UNITS`. Both correction loops are bounded by the deficit/surplus,
 * which is itself bounded because `row.length * MIN_TILE_UNITS <= GRID_COLUMNS`.
 */
function apportionRow(weights: readonly number[]): number[] {
  const n = weights.length;
  if (n === 0) return [];

  const total = weights.reduce((sum, w) => sum + w, 0);
  const raw =
    total > 0
      ? weights.map((w) => (GRID_COLUMNS * w) / total)
      : weights.map(() => GRID_COLUMNS / n);

  const units = raw.map((r) => Math.max(MIN_TILE_UNITS, Math.floor(r)));
  let diff = GRID_COLUMNS - units.reduce((sum, u) => sum + u, 0);

  if (diff > 0) {
    // Hand the leftover units to the largest fractional remainders first.
    const byRemainder = raw
      .map((r, i) => ({ i, frac: r - Math.floor(r) }))
      .sort((a, b) => b.frac - a.frac || a.i - b.i);
    for (let k = 0; k < diff; k++) {
      units[byRemainder[k % n].i] += 1;
    }
    diff = 0;
  }

  // A very lopsided weight vector can push the floored+clamped units past 12
  // (e.g. weights 10/1/1 -> 10+2+2). Take the surplus back from the widest
  // tile that is still above the floor.
  for (let k = 0; k < -diff; k++) {
    let widest = -1;
    for (let i = 0; i < n; i++) {
      if (units[i] <= MIN_TILE_UNITS) continue;
      if (widest === -1 || units[i] > units[widest]) widest = i;
    }
    if (widest === -1) break;
    units[widest] -= 1;
  }

  return units;
}
