import { Injectable, DestroyRef, inject, signal } from '@angular/core';

const GRID_COLUMNS = 12;
const MARGIN = 8;
const TILE_HEIGHT_UNITS = 6;
const MIN_CELL_HEIGHT = 20;

const BREAKPOINT_NARROW = 500;
const BREAKPOINT_MEDIUM = 900;

export interface TileLayout {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface CanvasLayout {
  cellHeight: number;
  tiles: TileLayout[];
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

  computeLayout(tileCount: number): CanvasLayout {
    const width = this._containerWidth();
    const height = this._containerHeight();

    if (tileCount === 0 || width === 0 || height === 0) {
      return { cellHeight: 120, tiles: [] };
    }

    let maxPerRow: number;
    if (width < BREAKPOINT_NARROW) maxPerRow = 1;
    else if (width < BREAKPOINT_MEDIUM) maxPerRow = 2;
    else maxPerRow = 3;

    const tilesPerRow = Math.min(maxPerRow, tileCount);
    const tileW = Math.floor(GRID_COLUMNS / tilesPerRow);
    const rows = Math.ceil(tileCount / tilesPerRow);

    const totalMargins = (rows + 1) * MARGIN;
    const availableHeight = height - totalMargins;
    const cellHeight = Math.max(
      MIN_CELL_HEIGHT,
      Math.floor(availableHeight / (rows * TILE_HEIGHT_UNITS)),
    );

    const tiles: TileLayout[] = [];
    for (let i = 0; i < tileCount; i++) {
      tiles.push({
        x: (i % tilesPerRow) * tileW,
        y: Math.floor(i / tilesPerRow) * TILE_HEIGHT_UNITS,
        w: tileW,
        h: TILE_HEIGHT_UNITS,
      });
    }

    return { cellHeight, tiles };
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
