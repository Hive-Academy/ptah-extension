import { isCompactViewMode } from '@ptah-extension/chat-types';
import { assertNever } from '@ptah-extension/shared';

/** Gridstack column units in one rendered row. */
export const GRID_COLUMNS = 12;

/**
 * Hard tile cap shared by the store and the persistence boundary.
 *
 * Raised from 9 to 20 (TASK_2026_471). Columns are still capped at 3
 * (`MAX_COLUMNS`), so the grid grows downward into more rows rather than
 * wider. A record written at this cap is rejected by an older client, whose
 * schema still caps at 9 — that client reports `writable: false` and declines
 * to overwrite, so the record survives rather than being truncated.
 */
export const MAX_CANVAS_TILES = 20;

/** Gridstack row units a full tile occupies. */
export const FULL_TILE_HEIGHT_UNITS = 6;

/** Gridstack row units a compact tile occupies. */
export const COMPACT_TILE_HEIGHT_UNITS = 2;

/** Gridstack row units a compact tall tile occupies. */
export const COMPACT_TALL_TILE_HEIGHT_UNITS = 3;

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

export type CanvasLayoutPreset =
  | 'even-grid'
  | 'one-plus-two'
  | 'focus-plus-stack';

/**
 * Transient height tier for one tile, derived from the owning tab's view mode
 * in `TabManagerService`. Never stored in `TileIntent` or persistence.
 */
export type TileHeightTier = 'full' | 'compact' | 'compact-tall';

/** Exact height for each transient tier; layout focus overrides this to full. */
export function heightUnitsFor(tier: TileHeightTier): number {
  switch (tier) {
    case 'full':
      return FULL_TILE_HEIGHT_UNITS;
    case 'compact':
      return COMPACT_TILE_HEIGHT_UNITS;
    case 'compact-tall':
      return COMPACT_TALL_TILE_HEIGHT_UNITS;
    default:
      return assertNever(tier);
  }
}

/** One tile's transient view constraint: id and height tier only. */
export interface TileViewConstraint {
  readonly tabId: string;
  readonly heightTier: TileHeightTier;
}

/** Ordered transient view constraints; absent ids project as full. */
export type TileViewConstraints = readonly TileViewConstraint[];

/**
 * Stable fingerprint for an ordered constraint list: length-prefixed id and
 * tier. Gestures compare this string to detect a mid-gesture compact/full
 * change without depending on object identity.
 */
export function viewConstraintsFingerprint(
  constraints: TileViewConstraints,
): string {
  return constraints
    .map((c) => `${c.tabId.length}:${c.tabId}=${c.heightTier}`)
    .join('|');
}

export interface PackedTile {
  readonly tabId: string;
  readonly units: number;
}

export interface TilePositionObservation {
  readonly tabId: string;
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/** Complete projected geometry for one tile; concrete values are never stored. */
export interface ProjectedTileGeometry {
  readonly tabId: string;
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
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
 * Preferred width of every tile under the existing row packing, with compact
 * tiles as fixed participants at the responsive minimum and excluded from
 * auto-weight remainder sharing. Row membership follows `rowBreakBefore`,
 * span overflow and the layout-focus flush, exactly as `packRows`.
 */
function resolvePreferredWidths(
  tiles: readonly TileIntent[],
  capacity: number,
  layoutFocusTabId: string | null,
  tierById: ReadonlyMap<string, TileHeightTier>,
): ReadonlyMap<string, number> {
  const minimum = minimumUnitsFor(capacity);
  const widths = new Map<string, number>();
  let current: TileIntent[] = [];
  let used = 0;
  const flush = (): void => {
    if (current.length > 0) {
      finishPreferredRow(current, capacity, minimum, tierById, widths);
    }
    current = [];
    used = 0;
  };

  for (const tile of logicalRows(tiles).flat()) {
    if (tile.tabId === layoutFocusTabId) {
      flush();
      widths.set(tile.tabId, GRID_COLUMNS);
      continue;
    }
    const units =
      isCompactViewMode(tierById.get(tile.tabId))
        ? minimum
        : effectiveUnits(tile.width, capacity);
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
  return widths;
}

function finishPreferredRow(
  row: readonly TileIntent[],
  capacity: number,
  minimum: number,
  tierById: ReadonlyMap<string, TileHeightTier>,
  widths: Map<string, number>,
): void {
  const autoWeights: number[] = [];
  let explicitUnits = 0;
  for (const tile of row) {
    if (isCompactViewMode(tierById.get(tile.tabId))) {
      explicitUnits += minimum;
    } else if (tile.width.kind === 'auto') {
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
  for (const tile of row) {
    if (isCompactViewMode(tierById.get(tile.tabId))) {
      widths.set(tile.tabId, minimum);
    } else if (tile.width.kind === 'auto') {
      widths.set(tile.tabId, autoUnits[autoIndex++]);
    } else {
      widths.set(tile.tabId, effectiveUnits(tile.width, capacity));
    }
  }
}

/**
 * Deterministic 12-column skyline placement. Reading order is `(order, tabId)`.
 * A nondecreasing `readingFloorY` lets a later tile fill a hole under an
 * earlier compact tile but never jump visually above it. `rowBreakBefore` is a
 * hard fence: it raises the floor to the current maximum skyline. A full auto
 * tile may contract from its preferred width down to the responsive minimum to
 * occupy an earlier hole; candidates tie-break by earliest `y`, then widest
 * width, then lowest `x`, so the same inputs always produce the same output.
 */
export function projectTileGeometry(
  tiles: readonly TileIntent[],
  capacity: number,
  layoutFocusTabId: string | null = null,
  viewConstraints: TileViewConstraints = [],
): readonly ProjectedTileGeometry[] {
  const ordered = [...tiles].sort(
    (a, b) => a.order - b.order || a.tabId.localeCompare(b.tabId),
  );
  const tierById = new Map(viewConstraints.map((c) => [c.tabId, c.heightTier]));
  const preferred = resolvePreferredWidths(
    ordered,
    capacity,
    layoutFocusTabId,
    tierById,
  );
  const minimum = minimumUnitsFor(capacity);

  const skyline: number[] = new Array<number>(GRID_COLUMNS).fill(0);
  let readingFloorY = 0;
  const positioned: ProjectedTileGeometry[] = [];

  for (const tile of ordered) {
    if (tile.tabId === layoutFocusTabId) {
      readingFloorY = Math.max(readingFloorY, ...skyline);
      positioned.push({
        tabId: tile.tabId,
        x: 0,
        y: readingFloorY,
        w: GRID_COLUMNS,
        h: FULL_TILE_HEIGHT_UNITS,
      });
      skyline.fill(readingFloorY + FULL_TILE_HEIGHT_UNITS);
      readingFloorY += FULL_TILE_HEIGHT_UNITS;
      continue;
    }
    if (tile.rowBreakBefore) {
      readingFloorY = Math.max(readingFloorY, ...skyline);
    }
    const tier = tierById.get(tile.tabId) ?? 'full';
    const compact = isCompactViewMode(tier);
    const h = heightUnitsFor(tier);
    let candidates: readonly number[];
    if (compact) {
      candidates = [minimum];
    } else if (tile.width.kind === 'span') {
      candidates = [effectiveUnits(tile.width, capacity)];
    } else {
      const preferredWidth = preferred.get(tile.tabId) ?? minimum;
      const contraction: number[] = [];
      for (let w = preferredWidth; w >= minimum; w--) contraction.push(w);
      candidates = contraction;
    }

    let bestX = 0;
    let bestY = 0;
    let bestW = 0;
    let found = false;
    for (const w of candidates) {
      for (let x = 0; x + w <= GRID_COLUMNS; x++) {
        let y = readingFloorY;
        for (let c = x; c < x + w; c++) {
          if (skyline[c] > y) y = skyline[c];
        }
        // Lexicographic (y, -w, x): lower y, then wider, then lower x.
        if (
          !found ||
          y < bestY ||
          (y === bestY && (w > bestW || (w === bestW && x < bestX)))
        ) {
          found = true;
          bestX = x;
          bestY = y;
          bestW = w;
        }
      }
    }
    positioned.push({ tabId: tile.tabId, x: bestX, y: bestY, w: bestW, h });
    for (let c = bestX; c < bestX + bestW; c++) skyline[c] = bestY + h;
    readingFloorY = bestY;
  }
  return positioned;
}

/** Vertical extent of a projection: `max(y + h)`, `0` when empty. */
export function totalExtentOf(
  positioned: readonly ProjectedTileGeometry[],
): number {
  return positioned.reduce((max, tile) => Math.max(max, tile.y + tile.h), 0);
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
 * Observations carry full `(x, y, w, h)`; each `h` must match the tile's
 * projected height tier. Equal `y` no longer identifies a logical row, so at
 * capacity 2/3 the break mask is reconstructed by bounded enumeration: every
 * candidate `rowBreakBefore` mask over the observed `(y, x, tabId)` order is
 * run through the same pure skyline projector. Gridstack does not
 * re-apportion untouched tiles mid-gesture, so a full-tier auto tile matches
 * the candidate projection on `y` and `h` only — its `x`/`w` are re-derived
 * when the committed intent is projected again. Named spans and compact
 * tiles keep the exact `(x, y, w, h)` match, and every tile's `y` is always
 * strict, so a mask that would move a tile to another row can never match.
 * The mask with the minimum
 * Hamming distance from existing break ownership wins; ties choose the
 * lexicographically smallest mask (false before true). No match rejects the
 * gesture. At capacity one, every width is 12 and row-break geometry is
 * ambiguous, so the existing logical-row-block contiguity rule is preserved.
 */
export function projectDragIntent(
  tiles: readonly TileIntent[],
  observations: readonly TilePositionObservation[],
  draggedId: string,
  capacity: number,
  viewConstraints: TileViewConstraints = [],
): readonly TileIntent[] | null {
  if (!Number.isInteger(capacity) || capacity < 1) return null;
  const orderedTiles = logicalRows(tiles).flat();
  const expected = new Set(orderedTiles.map((tile) => tile.tabId));
  if (!expected.has(draggedId) || observations.length !== expected.size) {
    return null;
  }

  const tierById = new Map(viewConstraints.map((c) => [c.tabId, c.heightTier]));
  const expectedHeightOf = (tabId: string): number =>
    heightUnitsFor(tierById.get(tabId) ?? 'full');

  const seen = new Set<string>();
  for (const observation of observations) {
    if (
      !expected.has(observation.tabId) ||
      seen.has(observation.tabId) ||
      !Number.isInteger(observation.x) ||
      !Number.isInteger(observation.y) ||
      !Number.isInteger(observation.w) ||
      !Number.isInteger(observation.h) ||
      observation.x < 0 ||
      observation.y < 0 ||
      observation.w <= 0 ||
      observation.h <= 0 ||
      observation.x + observation.w > 12 ||
      observation.h !== expectedHeightOf(observation.tabId)
    ) {
      return null;
    }
    seen.add(observation.tabId);
  }
  for (let index = 0; index < observations.length; index++) {
    const a = observations[index];
    for (
      let otherIndex = index + 1;
      otherIndex < observations.length;
      otherIndex++
    ) {
      const b = observations[otherIndex];
      if (
        a.x < b.x + b.w &&
        a.x + a.w > b.x &&
        a.y < b.y + b.h &&
        a.y + a.h > b.y
      ) {
        return null;
      }
    }
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

  const count = observed.length;
  const priorBreaks = observed.map(
    (item) => intentOf(item.tabId).rowBreakBefore,
  );
  const observedByTabId = new Map(observed.map((item) => [item.tabId, item]));
  let bestBreaks: boolean[] | null = null;
  let bestHamming = 0;

  for (let mask = 0; mask < 1 << (count - 1); mask++) {
    const candidate: TileIntent[] = observed.map((item, order) => ({
      ...intentOf(item.tabId),
      order,
      rowBreakBefore: order > 0 && ((mask >> (order - 1)) & 1) === 1,
    }));
    const projected = projectTileGeometry(
      candidate,
      capacity,
      null,
      viewConstraints,
    );
    if (projected.length !== observed.length) continue;
    let exact = true;
    for (const geometry of projected) {
      const item = observedByTabId.get(geometry.tabId);
      if (!item || item.y !== geometry.y || item.h !== geometry.h) {
        exact = false;
        break;
      }
      // Gridstack leaves untouched auto tiles at their pre-drag widths, so a
      // Full-tier auto tiles and the actively dragged tile match on row
      // placement only; Gridstack may retain a transient x/w for either until
      // committed intent is projected again. Unmoved named/compact tiles keep
      // exact x/w, and y/h are strict for every tile.
      const horizontalPositionIsTransient =
        geometry.tabId === draggedId ||
        (intentOf(geometry.tabId).width.kind === 'auto' &&
          !isCompactViewMode(tierById.get(geometry.tabId)));
      if (
        !horizontalPositionIsTransient &&
        (item.x !== geometry.x || item.w !== geometry.w)
      ) {
        exact = false;
        break;
      }
    }
    if (!exact) continue;

    let hamming = 0;
    for (let i = 1; i < count; i++) {
      if (candidate[i].rowBreakBefore !== priorBreaks[i]) hamming++;
    }
    if (bestBreaks === null || hamming < bestHamming) {
      bestBreaks = candidate.map((tile) => tile.rowBreakBefore);
      bestHamming = hamming;
      continue;
    }
    if (hamming === bestHamming) {
      // Same cost: keep the lexicographically smaller break array.
      for (let i = 1; i < count; i++) {
        const candidateBreak = candidate[i].rowBreakBefore;
        if (candidateBreak !== bestBreaks[i]) {
          if (!candidateBreak) {
            bestBreaks = candidate.map((tile) => tile.rowBreakBefore);
          }
          break;
        }
      }
    }
  }
  if (bestBreaks === null) return null;
  return observed.map((item, order) => ({
    ...intentOf(item.tabId),
    order,
    rowBreakBefore: bestBreaks[order],
  }));
}
