import type { CanvasLayout } from './canvas-layout.service';

export interface CanvasDetailGeometry {
  /** First grid row below the opened tile's row. */
  readonly rowEnd: number;
  readonly topPx: number;
  readonly heightPx: number;
  /** Horizontal notch position under the opened tile, in percent. */
  readonly notchPct: number;
  /** Tiles that move down below the detail slot. */
  readonly belowIds: ReadonlySet<string>;
}

/** Pixel placement for the detail slot without adding a Gridstack node. */
export function canvasDetailGeometry(
  tabId: string | null,
  layout: CanvasLayout,
  containerHeight: number,
): CanvasDetailGeometry | null {
  if (!tabId) return null;
  const { tiles, cellHeight } = layout;
  const selected = tiles.find((tile) => tile.tabId === tabId);
  if (!selected) return null;
  let rowEnd = selected.y + selected.h;
  let previousEnd: number;
  do {
    previousEnd = rowEnd;
    for (const tile of tiles) {
      if (tile.y < rowEnd && tile.y + tile.h > rowEnd) {
        rowEnd = tile.y + tile.h;
      }
    }
  } while (rowEnd !== previousEnd);
  const heightPx = Math.max(
    Math.round(containerHeight * 0.7),
    containerHeight - selected.h * cellHeight - 16,
  );
  return {
    rowEnd,
    topPx: rowEnd * cellHeight,
    heightPx,
    notchPct: ((selected.x + selected.w / 2) / 12) * 100,
    belowIds: new Set(
      tiles.filter((tile) => tile.y >= rowEnd).map((tile) => tile.tabId),
    ),
  };
}
