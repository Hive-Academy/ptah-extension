import type { TileIntent } from './canvas-layout.service';

export type ColumnsPreference = 'auto' | 1 | 2 | 3;

export interface TilePositionObservation {
  readonly tabId: string;
  readonly x: number;
  readonly y: number;
}

export function logicalRows(
  tiles: readonly TileIntent[],
): readonly (readonly TileIntent[])[] {
  const ordered = [...tiles].sort(
    (a, b) => a.order - b.order || a.tabId.localeCompare(b.tabId),
  );
  const rows: TileIntent[][] = [];
  for (const tile of ordered) {
    if (rows.length === 0 || tile.rowBreakBefore) rows.push([]);
    rows[rows.length - 1].push(tile);
  }
  return rows;
}

/**
 * Filter a complete intent snapshot while preserving its logical rows. If the
 * first tile in a row disappears, the boundary transfers to that row's first
 * survivor instead of disappearing with the removed tile.
 */
export function retainTilesInLogicalRows(
  tiles: readonly TileIntent[],
  retainedIds: ReadonlySet<string>,
): readonly TileIntent[] {
  const survivingRows = logicalRows(tiles)
    .map((row) => row.filter((tile) => retainedIds.has(tile.tabId)))
    .filter((row) => row.length > 0);
  return survivingRows.flatMap((row, rowIndex) =>
    row.map((tile, index) => ({
      ...tile,
      order: 0,
      rowBreakBefore: rowIndex > 0 && index === 0,
    })),
  ).map((tile, order) => ({ ...tile, order }));
}

export function effectiveCapacity(
  responsiveCapacity: number,
  preference: ColumnsPreference,
): number {
  const responsive = Math.min(3, Math.max(1, Math.trunc(responsiveCapacity)));
  return preference === 'auto' ? responsive : Math.min(responsive, preference);
}

/**
 * Translate a complete post-drag Gridstack observation back to logical intent.
 * Geometry supplies row intent only where it is unambiguous. At capacity one,
 * it may reorder within existing row blocks but cannot split or merge them.
 */
export function projectDragIntent(
  tiles: readonly TileIntent[],
  observations: readonly TilePositionObservation[],
  draggedId: string,
  capacity: number,
): readonly TileIntent[] | null {
  if (!Number.isInteger(capacity) || capacity < 1) return null;
  const orderedTiles = logicalRows(tiles).flat();
  const expected = new Set(orderedTiles.map((tile) => tile.tabId));
  if (!expected.has(draggedId) || observations.length !== expected.size) {
    return null;
  }

  const seen = new Set<string>();
  for (const observation of observations) {
    if (
      !expected.has(observation.tabId) ||
      seen.has(observation.tabId) ||
      !Number.isFinite(observation.x) ||
      !Number.isInteger(observation.y)
    ) {
      return null;
    }
    seen.add(observation.tabId);
  }

  const observed = [...observations].sort(
    (a, b) => a.y - b.y || a.x - b.x || a.tabId.localeCompare(b.tabId),
  );
  const priorWithoutDragged = orderedTiles
    .map((tile) => tile.tabId)
    .filter((tabId) => tabId !== draggedId);
  const observedWithoutDragged = observed
    .map((item) => item.tabId)
    .filter((tabId) => tabId !== draggedId);
  if (
    observedWithoutDragged.some(
      (tabId, index) => tabId !== priorWithoutDragged[index],
    )
  ) {
    return null;
  }
  const tileById = new Map(orderedTiles.map((tile) => [tile.tabId, tile]));
  const priorRows = logicalRows(tiles);
  const priorRowById = new Map<string, number>();
  priorRows.forEach((row, rowIndex) =>
    row.forEach((tile) => priorRowById.set(tile.tabId, rowIndex)),
  );

  if (capacity === 1) {
    const rowSequence = observed.map((item) => priorRowById.get(item.tabId));
    const collapsed = rowSequence.filter(
      (row, index) => index === 0 || row !== rowSequence[index - 1],
    );
    if (
      collapsed.length !== priorRows.length ||
      collapsed.some((row, index) => row !== index)
    ) {
      return null;
    }
    return observed.map((item, order) => ({
      ...(tileById.get(item.tabId) as TileIntent),
      order,
      rowBreakBefore:
        order > 0 && rowSequence[order] !== rowSequence[order - 1],
    }));
  }

  const groups: TilePositionObservation[][] = [];
  for (const item of observed) {
    const last = groups[groups.length - 1];
    if (!last || last[0].y !== item.y) groups.push([item]);
    else last.push(item);
  }

  const result: TileIntent[] = [];
  groups.forEach((group, groupIndex) => {
    const previous = groups[groupIndex - 1];
    const first = group[0];
    let breakBefore = groupIndex > 0 && (previous?.length ?? capacity) < capacity;
    if (groupIndex > 0 && previous?.length === capacity) {
      const previousId = previous[previous.length - 1].tabId;
      const previousRow = priorRowById.get(previousId);
      const currentRow = priorRowById.get(first.tabId);
      breakBefore = previousRow !== currentRow;
    }
    group.forEach((item, index) => {
      result.push({
        ...(tileById.get(item.tabId) as TileIntent),
        order: result.length,
        rowBreakBefore: index === 0 && breakBefore,
      });
    });
  });
  if (result.length > 0) result[0] = { ...result[0], rowBreakBefore: false };
  return result;
}
