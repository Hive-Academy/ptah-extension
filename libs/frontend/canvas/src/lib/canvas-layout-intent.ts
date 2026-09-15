/** Gridstack column units in one rendered row. */
export const GRID_COLUMNS = 12;

/** Hard tile cap shared by the store and the persistence boundary. */
export const MAX_CANVAS_TILES = 9;

export const TILE_SPANS = ['third', 'half', 'two-thirds', 'full'] as const;
export type TileSpan = (typeof TILE_SPANS)[number];

/** Exact Gridstack units a named span claims at full responsive capacity. */
export const SPAN_UNITS: Readonly<Record<TileSpan, number>> = {
  third: 4,
  half: 6,
  'two-thirds': 8,
  full: 12,
};

const UNIT_STEPS = [4, 6, 8, 12] as const;

/**
 * A tile either carries a named span chosen by the user, or an `auto` width
 * that fills whatever its row leaves over, shared by relative weight. `auto`
 * keeps untouched tiles on the even-fill behaviour and lets a legacy weighted
 * record migrate without rounding.
 */
export type TileWidthIntent =
  | { readonly kind: 'span'; readonly span: TileSpan }
  | { readonly kind: 'auto'; readonly weight: number };

export const DEFAULT_TILE_WIDTH: TileWidthIntent = { kind: 'auto', weight: 1 };

/**
 * Stored tile intent: where a tile sits in reading order, how wide it wants to
 * be and whether it starts a logical row. Concrete `x`/`y`/`w`/`h` are derived
 * from this — never stored.
 */
export interface TileIntent {
  readonly tabId: string;
  readonly order: number;
  readonly width: TileWidthIntent;
  readonly rowBreakBefore: boolean;
}

export type CanvasLayoutPreset = 'even-grid' | 'one-plus-two' | 'focus-plus-stack';

export interface PackedTile {
  readonly tabId: string;
  readonly units: number;
}

export interface TilePositionObservation {
  readonly tabId: string;
  readonly x: number;
  readonly y: number;
}

export function sameWidth(a: TileWidthIntent, b: TileWidthIntent): boolean {
  if (a.kind === 'span' && b.kind === 'span') return a.span === b.span;
  if (a.kind === 'auto' && b.kind === 'auto') return a.weight === b.weight;
  return false;
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

/** Dense order, with the first tile never carrying a row break. */
function densify(tiles: readonly TileIntent[]): TileIntent[] {
  return tiles.map((tile, order) => ({
    ...tile,
    order,
    rowBreakBefore: order > 0 && tile.rowBreakBefore,
  }));
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
  return densify(
    survivingRows.flatMap((row, rowIndex) =>
      row.map((tile, index) => ({
        ...tile,
        rowBreakBefore: rowIndex > 0 && index === 0,
      })),
    ),
  );
}

/**
 * Reconcile stored intent with the exact authoritative tab ids: unknown tiles
 * drop out row-preservingly, and authoritative ids without intent append as
 * default auto tiles, bounded by `maxTiles`.
 */
export function reconcileIntent(
  stored: readonly TileIntent[],
  authoritativeIds: readonly string[],
  maxTiles: number,
): readonly TileIntent[] {
  const authoritative = new Set(authoritativeIds);
  const retained = retainTilesInLogicalRows(stored, authoritative).slice(
    0,
    maxTiles,
  );
  const present = new Set(retained.map((tile) => tile.tabId));
  const appended: TileIntent[] = [];
  for (const tabId of authoritative) {
    if (retained.length + appended.length >= maxTiles) break;
    if (present.has(tabId)) continue;
    appended.push({
      tabId,
      order: 0,
      width: DEFAULT_TILE_WIDTH,
      rowBreakBefore: false,
    });
  }
  return densify([...retained, ...appended]);
}

function clampCapacity(capacity: number): number {
  return Number.isFinite(capacity)
    ? Math.min(3, Math.max(1, Math.trunc(capacity)))
    : 1;
}

/** Narrowest unit count that still keeps `MIN_TILE_WIDTH` at this capacity. */
export function minimumUnitsFor(capacity: number): number {
  return Math.ceil(GRID_COLUMNS / clampCapacity(capacity));
}

/**
 * Units a width claims while packing. A named span is promoted to the next
 * step that respects the responsive minimum; stored intent never changes, so
 * widening the container restores the original span.
 */
export function effectiveUnits(
  width: TileWidthIntent,
  capacity: number,
): number {
  const minimum = minimumUnitsFor(capacity);
  if (width.kind === 'auto') return minimum;
  const desired = Math.max(SPAN_UNITS[width.span], minimum);
  return UNIT_STEPS.find((units) => units >= desired) ?? GRID_COLUMNS;
}

/** Nearest named span to an observed Gridstack width; ties choose the wider. */
export function snapSpan(units: number): TileSpan {
  let best: TileSpan = 'third';
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const span of TILE_SPANS) {
    const distance = Math.abs(SPAN_UNITS[span] - units);
    if (distance <= bestDistance) {
      best = span;
      bestDistance = distance;
    }
  }
  return best;
}

/**
 * Pack ordered intent into rendered rows of at most `GRID_COLUMNS` units.
 * Explicit breaks and span overflow start a new row. The layout-focus tile, if
 * any, renders alone at full width without touching stored intent. Auto tiles
 * share whatever a row's named spans leave over; a row of named spans alone
 * keeps its deliberate trailing gap.
 */
export function packRows(
  tiles: readonly TileIntent[],
  capacity: number,
  layoutFocusTabId: string | null = null,
): readonly (readonly PackedTile[])[] {
  const minimum = minimumUnitsFor(capacity);
  const rows: (readonly PackedTile[])[] = [];
  let current: TileIntent[] = [];
  let used = 0;
  const flush = (): void => {
    if (current.length > 0) rows.push(finishRow(current, capacity, minimum));
    current = [];
    used = 0;
  };

  for (const tile of logicalRows(tiles).flat()) {
    if (tile.tabId === layoutFocusTabId) {
      flush();
      rows.push([{ tabId: tile.tabId, units: GRID_COLUMNS }]);
      continue;
    }
    const units = effectiveUnits(tile.width, capacity);
    if (
      current.length > 0 &&
      (tile.rowBreakBefore || used + units > GRID_COLUMNS)
    ) {
      flush();
    }
    current.push(tile);
    used += units;
    if (used >= GRID_COLUMNS) flush();
  }
  flush();
  return rows;
}

function finishRow(
  row: readonly TileIntent[],
  capacity: number,
  minimum: number,
): readonly PackedTile[] {
  const autoWeights: number[] = [];
  let explicitUnits = 0;
  for (const tile of row) {
    if (tile.width.kind === 'auto') {
      autoWeights.push(normalizeWeight(tile.width.weight));
    } else {
      explicitUnits += effectiveUnits(tile.width, capacity);
    }
  }
  const autoUnits = apportion(
    autoWeights,
    GRID_COLUMNS - explicitUnits,
    minimum,
  );
  let autoIndex = 0;
  return row.map((tile) => ({
    tabId: tile.tabId,
    units:
      tile.width.kind === 'auto'
        ? autoUnits[autoIndex++]
        : effectiveUnits(tile.width, capacity),
  }));
}

/** A weight that never reaches the apportionment as `NaN`, `0` or negative. */
function normalizeWeight(weight: number): number {
  return Number.isFinite(weight) && weight > 0 ? weight : 1;
}

/**
 * Largest-remainder apportionment of `total` units by weight. Every entry is
 * at least `floor`; packing guarantees `weights.length * floor <= total`, so
 * both correction loops are bounded and the result sums to `total`.
 */
function apportion(
  weights: readonly number[],
  total: number,
  floor: number,
): number[] {
  const n = weights.length;
  if (n === 0) return [];
  const sum = weights.reduce((acc, weight) => acc + weight, 0);
  const raw = weights.map((weight) => (total * weight) / sum);
  const units = raw.map((value) => Math.max(floor, Math.floor(value)));
  const diff = total - units.reduce((acc, value) => acc + value, 0);

  if (diff > 0) {
    // Hand the leftover units to the largest fractional remainders first.
    const byRemainder = raw
      .map((value, i) => ({ i, frac: value - Math.floor(value) }))
      .sort((a, b) => b.frac - a.frac || a.i - b.i);
    for (let k = 0; k < diff; k++) units[byRemainder[k % n].i] += 1;
  }
  // The floor can push the total past `total`; take the surplus back from the
  // widest entry still above the floor.
  for (let k = 0; k < -diff; k++) {
    let widest = -1;
    for (let i = 0; i < n; i++) {
      if (units[i] <= floor) continue;
      if (widest === -1 || units[i] > units[widest]) widest = i;
    }
    if (widest === -1) break;
    units[widest] -= 1;
  }
  return units;
}

/**
 * Rewrite width, order and row breaks for a durable preset. `focusedTabId`
 * selects the lead tile of `focus-plus-stack`; the first tile leads otherwise.
 */
export function projectPreset(
  tiles: readonly TileIntent[],
  preset: CanvasLayoutPreset,
  focusedTabId: string | null,
): readonly TileIntent[] {
  const ordered = logicalRows(tiles).flat();
  if (ordered.length === 0) return ordered;
  if (preset === 'even-grid') {
    return densify(
      ordered.map((tile, index) => ({
        ...tile,
        width: DEFAULT_TILE_WIDTH,
        rowBreakBefore: index % 3 === 0,
      })),
    );
  }
  const lead =
    (preset === 'focus-plus-stack'
      ? ordered.find((tile) => tile.tabId === focusedTabId)
      : undefined) ?? ordered[0];
  const rest = ordered.filter((tile) => tile !== lead);
  const full: TileWidthIntent = { kind: 'span', span: 'full' };
  const half: TileWidthIntent = { kind: 'span', span: 'half' };
  return densify([
    { ...lead, width: full, rowBreakBefore: false },
    ...rest.map((tile, index) => ({
      ...tile,
      width: index % 2 === 0 && index === rest.length - 1 ? full : half,
      rowBreakBefore: index % 2 === 0,
    })),
  ]);
}

/**
 * Translate a complete post-drag Gridstack observation back to logical intent.
 * Geometry supplies row intent only where it is unambiguous. An observed row
 * boundary with room left for the next tile is a deliberate break; a boundary
 * forced by span overflow keeps the prior logical-row membership. At capacity
 * one, it may reorder within existing row blocks but cannot split or merge them.
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
  const intentOf = (tabId: string): TileIntent =>
    tileById.get(tabId) as TileIntent;
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
      ...intentOf(item.tabId),
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

  const unitsOf = (tabId: string): number =>
    effectiveUnits(intentOf(tabId).width, capacity);
  const result: TileIntent[] = [];
  groups.forEach((group, groupIndex) => {
    let breakBefore = false;
    const previous = groups[groupIndex - 1];
    if (previous) {
      const used = previous.reduce((sum, item) => sum + unitsOf(item.tabId), 0);
      // Mirror packRows' minimum-unit accounting so a dropped row stays put.
      if (used + unitsOf(group[0].tabId) <= GRID_COLUMNS) {
        breakBefore = true;
      } else {
        const previousId = [...previous]
          .reverse()
          .find((item) => item.tabId !== draggedId)?.tabId;
        const currentId = group.find((item) => item.tabId !== draggedId)?.tabId;
        const previousRow = previousId
          ? priorRowById.get(previousId)
          : undefined;
        const currentRow = priorRowById.get(currentId ?? draggedId);
        breakBefore =
          previousRow !== undefined &&
          currentRow !== undefined &&
          previousRow !== currentRow;
      }
    }
    group.forEach((item, index) => {
      result.push({
        ...intentOf(item.tabId),
        order: result.length,
        rowBreakBefore: index === 0 && breakBefore,
      });
    });
  });
  return densify(result);
}
