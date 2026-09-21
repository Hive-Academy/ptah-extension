import {
  COMPACT_TILE_HEIGHT_UNITS,
  COMPACT_TALL_TILE_HEIGHT_UNITS,
  FULL_TILE_HEIGHT_UNITS,
  heightUnitsFor,
  logicalRows,
  packRows,
  projectDragIntent,
  projectPreset,
  projectTileGeometry,
  retainTilesInLogicalRows,
  snapSpan,
  totalExtentOf,
  viewConstraintsFingerprint,
  type TileIntent,
  type TilePositionObservation,
  type TileViewConstraints,
  type TileWidthIntent,
} from './canvas-layout-intent';

const auto = (weight = 1): TileWidthIntent => ({ kind: 'auto', weight });
const span = (value: 'third' | 'half' | 'two-thirds' | 'full'): TileWidthIntent => ({
  kind: 'span',
  span: value,
});
const tiles = (...rows: readonly (readonly [string, TileWidthIntent][])[]): TileIntent[] =>
  rows.flatMap((row, rowIndex) => row.map(([tabId, width], index) => ({
    tabId,
    order: 0,
    width,
    rowBreakBefore: rowIndex > 0 && index === 0,
  }))).map((tile, order) => ({ ...tile, order }));
const rowIds = (intent: readonly TileIntent[]): readonly string[][] =>
  logicalRows(intent).map((row) => row.map((tile) => tile.tabId));
const compactConstraint = (tabId: string): TileViewConstraints => [
  { tabId, heightTier: 'compact' },
];
/** Projected boxes as `[tabId, x, y, w, h]` rows for exact assertions. */
const boxes = (
  intent: readonly TileIntent[],
  capacity: number,
  layoutFocusTabId: string | null = null,
  viewConstraints: TileViewConstraints = [],
) =>
  projectTileGeometry(intent, capacity, layoutFocusTabId, viewConstraints).map(
    ({ tabId, x, y, w, h }) => [tabId, x, y, w, h],
  );
const extentOf = (
  intent: readonly TileIntent[],
  capacity: number,
  viewConstraints: TileViewConstraints = [],
) => totalExtentOf(projectTileGeometry(intent, capacity, null, viewConstraints));

describe('canvas layout intent', () => {
  it('packs mixed named spans and leaves deliberate gaps', () => {
    expect(packRows(tiles([['A', span('two-thirds')], ['B', span('third')]]), 3))
      .toEqual([[{ tabId: 'A', units: 8 }, { tabId: 'B', units: 4 }]]);
    expect(packRows(tiles([['A', span('third')]]), 3)).toEqual([
      [{ tabId: 'A', units: 4 }],
    ]);
  });

  it('apportions auto remainder by weight without rounding away 5/7', () => {
    expect(packRows(tiles([['A', auto(5)], ['B', auto(7)]]), 3)).toEqual([
      [{ tabId: 'A', units: 5 }, { tabId: 'B', units: 7 }],
    ]);
  });

  it('honours the responsive floor for skewed 10/1/1 auto weights', () => {
    expect(packRows(tiles([['A', auto(10)], ['B', auto()], ['C', auto()]]), 3)).toEqual([
      [{ tabId: 'A', units: 4 }, { tabId: 'B', units: 4 }, { tabId: 'C', units: 4 }],
    ]);
  });

  it('promotes spans responsively without mutating intent', () => {
    const intent = tiles([['A', span('third')], ['B', span('half')]]);
    const before = JSON.stringify(intent);
    expect(packRows(intent, 2).map((row) => row.map((tile) => tile.units))).toEqual([[6, 6]]);
    expect(packRows(intent, 1).map((row) => row.map((tile) => tile.units))).toEqual([[12], [12]]);
    expect(JSON.stringify(intent)).toBe(before);
  });

  it('focus flushes before and after the target without changing intent', () => {
    const intent = tiles([['A', span('third')], ['B', span('third')], ['C', span('third')]]);
    const before = JSON.stringify(intent);
    expect(packRows(intent, 3, 'B')).toEqual([
      [{ tabId: 'A', units: 4 }],
      [{ tabId: 'B', units: 12 }],
      [{ tabId: 'C', units: 4 }],
    ]);
    expect(JSON.stringify(intent)).toBe(before);
  });

  it('projects every preset to exact dense width and break intent', () => {
    const source = tiles([['A', auto()], ['B', auto()], ['C', auto()], ['D', auto()]]);
    expect(projectPreset(source, 'even-grid', null).map((t) => [t.order, t.width, t.rowBreakBefore])).toEqual([
      [0, auto(), false], [1, auto(), false], [2, auto(), false], [3, auto(), true],
    ]);
    expect(projectPreset(source, 'one-plus-two', null).map((t) => [t.tabId, t.width, t.rowBreakBefore])).toEqual([
      ['A', span('full'), false], ['B', span('half'), true], ['C', span('half'), false], ['D', span('full'), true],
    ]);
    expect(projectPreset(source, 'focus-plus-stack', 'C').map((t) => [t.tabId, t.width, t.rowBreakBefore])).toEqual([
      ['C', span('full'), false], ['A', span('half'), true], ['B', span('half'), false], ['D', span('full'), true],
    ]);
  });

  it('snaps to named spans with wider tie-breaking', () => {
    expect([4, 6, 8, 12].map(snapSpan)).toEqual(['third', 'half', 'two-thirds', 'full']);
    expect(snapSpan(5)).toBe('half');
    expect(snapSpan(7)).toBe('two-thirds');
    expect(snapSpan(10)).toBe('full');
  });

  it('exposes the six, two and three unit height tiers', () => {
    expect(FULL_TILE_HEIGHT_UNITS).toBe(6);
    expect(COMPACT_TILE_HEIGHT_UNITS).toBe(2);
    expect(COMPACT_TALL_TILE_HEIGHT_UNITS).toBe(3);
    expect((['full', 'compact', 'compact-tall'] as const).map((tier) =>
      heightUnitsFor(tier),
    )).toEqual([6, 2, 3]);
  });

  it('fingerprints view constraints structurally', () => {
    const constraints: TileViewConstraints = [
      { tabId: 'A', heightTier: 'full' },
      { tabId: 'B', heightTier: 'compact' },
    ];
    const equal: TileViewConstraints = [
      { tabId: 'A', heightTier: 'full' },
      { tabId: 'B', heightTier: 'compact' },
    ];
    const different: TileViewConstraints = [
      { tabId: 'A', heightTier: 'compact' },
      { tabId: 'B', heightTier: 'compact' },
    ];
    expect(viewConstraintsFingerprint(constraints)).toBe(viewConstraintsFingerprint(equal));
    expect(viewConstraintsFingerprint(constraints)).not.toBe(viewConstraintsFingerprint(different));
    expect(viewConstraintsFingerprint(constraints)).not.toBe(viewConstraintsFingerprint([
      { tabId: 'A', heightTier: 'full' },
      { tabId: 'B', heightTier: 'compact-tall' },
    ]));
  });

  it('packs three height tiers into the skyline and fills the two-unit hole first', () => {
    const intent = tiles([
      ['A', span('full')], ['B', auto()], ['C', span('third')],
      ['D', span('third')], ['E', span('third')],
    ]);
    const constraints: TileViewConstraints = [
      { tabId: 'A', heightTier: 'compact-tall' },
      { tabId: 'B', heightTier: 'compact' },
    ];
    const before = JSON.stringify(intent);
    expect(boxes(intent, 3, null, constraints)).toEqual([
      ['A', 0, 0, 4, 3], ['B', 4, 0, 4, 2], ['C', 8, 0, 4, 6],
      ['D', 4, 2, 4, 6], ['E', 0, 3, 4, 6],
    ]);
    expect(extentOf(intent, 3, constraints)).toBe(9);
    expect(JSON.stringify(intent)).toBe(before);
  });

  it('projects compact tall at responsive minimum widths and restores the stored span', () => {
    const intent = tiles([['A', span('full')]]);
    const constraints: TileViewConstraints = [{ tabId: 'A', heightTier: 'compact-tall' }];
    expect(boxes(intent, 3, null, constraints)).toEqual([['A', 0, 0, 4, 3]]);
    expect(boxes(intent, 2, null, constraints)).toEqual([['A', 0, 0, 6, 3]]);
    expect(boxes(intent, 1, null, constraints)).toEqual([['A', 0, 0, 12, 3]]);
    expect(boxes(intent, 3, 'A', constraints)).toEqual([['A', 0, 0, 12, 6]]);
    expect(boxes(intent, 3)).toEqual([['A', 0, 0, 12, 6]]);
  });

  it('validates compact tall drag height and unmoved auto width strictly', () => {
    const intent = tiles([['A', auto()], ['B', auto()], ['C', auto()]]);
    const constraints: TileViewConstraints = [{ tabId: 'B', heightTier: 'compact-tall' }];
    const observations = projectTileGeometry(intent, 3, null, constraints);
    expect(projectDragIntent(intent, observations, 'A', 3, constraints)).not.toBeNull();
    expect(projectDragIntent(intent, observations.map((tile) =>
      tile.tabId === 'B' ? { ...tile, h: 2 } : tile,
    ), 'A', 3, constraints)).toBeNull();
    expect(projectDragIntent(intent, observations.map((tile) =>
      tile.tabId === 'B' ? { ...tile, w: 5 } : tile,
    ), 'A', 3, constraints)).toBeNull();
  });

  it('projects a compact tile to the responsive minimum width and two-unit height', () => {
    const intent = tiles([['A', span('full')]]);
    const before = JSON.stringify(intent);
    expect(boxes(intent, 3, null, compactConstraint('A'))).toEqual([['A', 0, 0, 4, 2]]);
    expect(boxes(intent, 2, null, compactConstraint('A'))).toEqual([['A', 0, 0, 6, 2]]);
    expect(boxes(intent, 1, null, compactConstraint('A'))).toEqual([['A', 0, 0, 12, 2]]);
    expect(JSON.stringify(intent)).toBe(before);
  });

  it('fills the hole under a compact tile with the next full tile', () => {
    const intent = tiles([
      ['A', span('third')], ['B', span('third')], ['C', span('third')], ['D', span('third')],
    ]);
    const constraints = compactConstraint('B');
    expect(boxes(intent, 3, null, constraints)).toEqual([
      ['A', 0, 0, 4, 6],
      ['B', 4, 0, 4, 2],
      ['C', 8, 0, 4, 6],
      ['D', 4, 2, 4, 6],
    ]);
    expect(extentOf(intent, 3, constraints)).toBe(8);
  });

  it('ignores a compact tile stored span and keeps the skyline to eight units', () => {
    const intent = tiles([
      ['A', span('half')], ['B', span('half')], ['C', span('third')],
    ]);
    const constraints = compactConstraint('B');
    expect(boxes(intent, 3, null, constraints)).toEqual([
      ['A', 0, 0, 6, 6],
      ['B', 6, 0, 4, 2],
      ['C', 6, 2, 4, 6],
    ]);
    expect(extentOf(intent, 3, constraints)).toBe(8);
  });

  it('bands nine compact auto tiles into three two-unit rows', () => {
    const intent = tiles([
      ['A', auto()], ['B', auto()], ['C', auto()],
      ['D', auto()], ['E', auto()], ['F', auto()],
      ['G', auto()], ['H', auto()], ['I', auto()],
    ]);
    const constraints: TileViewConstraints = intent.map((tile) => ({
      tabId: tile.tabId,
      heightTier: 'compact',
    }));
    expect(boxes(intent, 3, null, constraints)).toEqual([
      ['A', 0, 0, 4, 2], ['B', 4, 0, 4, 2], ['C', 8, 0, 4, 2],
      ['D', 0, 2, 4, 2], ['E', 4, 2, 4, 2], ['F', 8, 2, 4, 2],
      ['G', 0, 4, 4, 2], ['H', 4, 4, 4, 2], ['I', 8, 4, 4, 2],
    ]);
    expect(extentOf(intent, 3, constraints)).toBe(6);
  });

  it('treats an explicit row break as a hard skyline fence', () => {
    const intent = tiles([
      ['A', span('third')], ['B', span('third')], ['C', span('third')],
    ], [['D', span('third')]]);
    const constraints = compactConstraint('B');
    expect(boxes(intent, 3, null, constraints)).toEqual([
      ['A', 0, 0, 4, 6],
      ['B', 4, 0, 4, 2],
      ['C', 8, 0, 4, 6],
      ['D', 0, 6, 4, 6],
    ]);
  });

  it('lets a full auto tile contract only to fill an earlier compact hole', () => {
    const intent = tiles([
      ['A', auto()], ['B', auto()], ['C', auto()], ['D', auto()],
    ]);
    const constraints = compactConstraint('C');
    expect(boxes(intent, 3, null, constraints)).toEqual([
      ['A', 0, 0, 4, 6],
      ['B', 4, 0, 4, 6],
      ['C', 8, 0, 4, 2],
      ['D', 8, 2, 4, 6],
    ]);
    expect(extentOf(intent, 3, constraints)).toBe(8);
    // Exiting compact mode removes the hole and restores the preferred width.
    expect(boxes(intent, 3)[3]).toEqual(['D', 0, 6, 12, 6]);
    expect(extentOf(intent, 3)).toBe(12);
  });

  it('renders the layout-focus tile 12x6 even when its view tier is compact', () => {
    const intent = tiles([['A', span('third')], ['B', span('third')], ['C', span('third')]]);
    const before = JSON.stringify(intent);
    expect(boxes(intent, 3, 'B', compactConstraint('B'))).toEqual([
      ['A', 0, 0, 4, 6],
      ['B', 0, 6, 12, 6],
      ['C', 0, 12, 4, 6],
    ]);
    expect(JSON.stringify(intent)).toBe(before);
  });

  it('produces identical geometry for repeated and shuffled input', () => {
    const intent = tiles([
      ['A', span('third')], ['B', span('third')], ['C', span('third')], ['D', span('third')],
    ]);
    const constraints = compactConstraint('B');
    const first = boxes(intent, 3, null, constraints);
    expect(boxes(intent, 3, null, constraints)).toEqual(first);
    const shuffled = [intent[2], intent[0], intent[3], intent[1]];
    expect(boxes(shuffled, 3, null, constraints)).toEqual(first);
  });

  it('creates a drag break only when the boundary was not forced by overflow', () => {
    const source = tiles([['A', span('third')], ['B', span('third')], ['C', span('third')]]);
    const deliberate = projectDragIntent(source, [
      { tabId: 'A', x: 0, y: 0, w: 4, h: 6 },
      { tabId: 'B', x: 4, y: 0, w: 4, h: 6 },
      { tabId: 'C', x: 0, y: 6, w: 4, h: 6 },
    ], 'C', 3);
    expect(deliberate && rowIds(deliberate)).toEqual([['A', 'B'], ['C']]);

    const overflowSource = tiles([['A', span('two-thirds')], ['B', span('half')]]);
    const overflow = projectDragIntent(overflowSource, [
      { tabId: 'A', x: 0, y: 0, w: 8, h: 6 },
      { tabId: 'B', x: 0, y: 6, w: 6, h: 6 },
    ], 'B', 3);
    expect(overflow?.[1].rowBreakBefore).toBe(false);
  });

  it('keeps a dropped third auto tile below two auto tiles at capacity three', () => {
    const source = tiles([['A', auto()], ['B', auto()], ['C', auto()]]);
    // Realistic mid-gesture observation: Gridstack leaves the untouched tiles
    // at their pre-drag 4-unit widths, so only the relaxed y/h match accepts.
    const projected = projectDragIntent(source, [
      { tabId: 'A', x: 0, y: 0, w: 4, h: 6 },
      { tabId: 'B', x: 4, y: 0, w: 4, h: 6 },
      { tabId: 'C', x: 0, y: 6, w: 4, h: 6 },
    ], 'C', 3);
    expect(projected?.[2].rowBreakBefore).toBe(true);
    expect(packRows(projected ?? [], 3)).toEqual([
      [{ tabId: 'A', units: 6 }, { tabId: 'B', units: 6 }],
      [{ tabId: 'C', units: 12 }],
    ]);
  });

  it('keeps a dropped third auto tile below two auto tiles at capacity two', () => {
    const source = tiles([['A', auto()], ['B', auto()]], [['C', auto()]]);
    const projected = projectDragIntent(source, [
      { tabId: 'A', x: 0, y: 0, w: 6, h: 6 },
      { tabId: 'B', x: 6, y: 0, w: 6, h: 6 },
      { tabId: 'C', x: 0, y: 6, w: 12, h: 6 },
    ], 'C', 2);
    expect(projected?.[2].rowBreakBefore).toBe(true);
    expect(packRows(projected ?? [], 2)).toEqual([
      [{ tabId: 'A', units: 6 }, { tabId: 'B', units: 6 }],
      [{ tabId: 'C', units: 12 }],
    ]);
  });

  it('accepts a named tile dropped into an occupied explicit row after Gridstack pushes its sibling down', () => {
    const source = tiles(
      [
        ['A', span('third')],
        ['B', auto()],
      ],
      [['C', auto()]],
    );
    const projected = projectDragIntent(source, [
      { tabId: 'B', x: 0, y: 0, w: 8, h: 6 },
      // The dragged named tile keeps Gridstack's transient horizontal slot.
      { tabId: 'A', x: 4, y: 6, w: 4, h: 6 },
      // float:false pushes the full-width row occupant below the drop.
      { tabId: 'C', x: 0, y: 12, w: 12, h: 6 },
    ], 'A', 3);

    expect(projected?.map((tile) => [tile.tabId, tile.rowBreakBefore])).toEqual([
      ['B', false],
      ['A', true],
      ['C', true],
    ]);
  });

  it('keeps a full auto hole tile in its hole while another auto tile is dragged below', () => {
    // Steady skyline: A(0,0,8,6), C compact(8,0,4,2), and full-auto D
    // contracted into the hole at (8,2,4,6). B remains below the hard fence.
    // A wrong mask lifts D out of the hole, so its strict projected y rejects
    // that candidate even though full-auto x/w are deliberately relaxed.
    const source = tiles(
      [
        ['A', span('two-thirds')],
        ['C', auto()],
        ['D', auto()],
      ],
      [['B', auto()]],
    );
    const constraints = compactConstraint('C');
    const projected = projectDragIntent(source, [
      { tabId: 'A', x: 0, y: 0, w: 8, h: 6 },
      { tabId: 'B', x: 0, y: 8, w: 4, h: 6 },
      { tabId: 'C', x: 8, y: 0, w: 4, h: 2 },
      { tabId: 'D', x: 8, y: 2, w: 4, h: 6 },
    ], 'B', 3, constraints);
    expect(projected?.map((tile) => [tile.tabId, tile.rowBreakBefore])).toEqual([
      ['A', false], ['C', false], ['D', false], ['B', true],
    ]);
    // Re-projecting the committed intent keeps D contracted into the hole.
    expect(boxes(projected ?? [], 3, null, constraints)).toEqual([
      ['A', 0, 0, 8, 6],
      ['C', 8, 0, 4, 2],
      ['D', 8, 2, 4, 6],
      ['B', 0, 8, 12, 6],
    ]);
  });

  it('accepts a mixed-height reorder across a compact hole', () => {
    const source = tiles([['A', span('third')], ['B', span('third')], ['C', span('third')]]);
    const projected = projectDragIntent(source, [
      { tabId: 'B', x: 0, y: 0, w: 4, h: 2 },
      { tabId: 'C', x: 4, y: 0, w: 4, h: 6 },
      { tabId: 'A', x: 8, y: 0, w: 4, h: 6 },
    ], 'A', 3, compactConstraint('B'));
    expect(projected?.map((tile) => [tile.tabId, tile.rowBreakBefore])).toEqual([
      ['B', false], ['C', false], ['A', false],
    ]);
  });

  it('recovers the minimum-change break mask when a break is geometrically redundant', () => {
    const source = tiles(
      [['A', span('full')]],
      [['B', span('third')], ['C', span('third')]],
    );
    const projected = projectDragIntent(source, [
      { tabId: 'A', x: 0, y: 0, w: 12, h: 6 },
      { tabId: 'B', x: 0, y: 6, w: 4, h: 6 },
      { tabId: 'C', x: 4, y: 6, w: 4, h: 6 },
    ], 'C', 3);
    expect(projected && rowIds(projected)).toEqual([['A'], ['B', 'C']]);
  });

  it('rejects observations with overlaps, bad integers or a wrong height tier', () => {
    const source = tiles([['A', span('third')], ['B', span('third')]]);
    expect(projectDragIntent(source, [
      { tabId: 'A', x: 0, y: 0, w: 4, h: 6 },
      { tabId: 'B', x: 2, y: 0, w: 4, h: 6 },
    ], 'B', 3)).toBeNull();
    expect(projectDragIntent(source, [
      { tabId: 'A', x: 0.5, y: 0, w: 4, h: 6 },
      { tabId: 'B', x: 4, y: 0, w: 4, h: 6 },
    ], 'B', 3)).toBeNull();
    expect(projectDragIntent(source, [
      { tabId: 'A', x: 0, y: 0, w: 4, h: 6 },
      { tabId: 'B', x: 4, y: 0, w: 4, h: 6 },
    ], 'B', 3, compactConstraint('B'))).toBeNull();
  });

  it('rejects nonpositive, negative and horizontally out-of-bounds rectangles', () => {
    const source = tiles([['A', auto()], ['B', auto()]]);
    const observe = (a: TilePositionObservation): readonly TilePositionObservation[] => [
      a,
      { tabId: 'B', x: 6, y: 0, w: 6, h: 6 },
    ];

    expect(projectDragIntent(source, observe({
      tabId: 'A', x: 0, y: 0, w: 0, h: 6,
    }), 'A', 3)).toBeNull();
    expect(projectDragIntent(source, observe({
      tabId: 'A', x: 0, y: 0, w: 6, h: 0,
    }), 'A', 3)).toBeNull();
    expect(projectDragIntent(source, observe({
      tabId: 'A', x: -1, y: 0, w: 6, h: 6,
    }), 'A', 3)).toBeNull();
    expect(projectDragIntent(source, observe({
      tabId: 'A', x: 0, y: -1, w: 6, h: 6,
    }), 'A', 3)).toBeNull();
    expect(projectDragIntent(source, observe({
      tabId: 'A', x: 10, y: 0, w: 3, h: 6,
    }), 'A', 3)).toBeNull();
  });

  it('preserves logical rows on deletion and rejects invalid observations', () => {
    const source = tiles([['A', auto()]], [['B', auto()], ['C', auto()]]);
    expect(rowIds(retainTilesInLogicalRows(source, new Set(['A', 'C'])))).toEqual([['A'], ['C']]);
    expect(projectDragIntent(source, [
      { tabId: 'A', x: 0, y: 0, w: 4, h: 6 },
    ], 'A', 3)).toBeNull();
    expect(projectDragIntent(source, [
      { tabId: 'A', x: 0, y: 0, w: 4, h: 6 },
      { tabId: 'A', x: 4, y: 0, w: 4, h: 6 },
      { tabId: 'C', x: 8, y: 0, w: 4, h: 6 },
    ], 'A', 3)).toBeNull();
  });

  it('rejects capacity-one interleaving of old logical rows', () => {
    const source = tiles([['A', auto()], ['B', auto()]], [['C', auto()]]);
    expect(projectDragIntent(source, [
      { tabId: 'A', x: 0, y: 0, w: 12, h: 6 },
      { tabId: 'C', x: 0, y: 6, w: 12, h: 6 },
      { tabId: 'B', x: 0, y: 12, w: 12, h: 6 },
    ], 'C', 1)).toBeNull();
  });

  it('accepts capacity-one reordering inside an existing row block', () => {
    const source = tiles([['A', auto()], ['B', auto()]], [['C', auto()]]);
    const projected = projectDragIntent(source, [
      { tabId: 'B', x: 0, y: 0, w: 12, h: 6 },
      { tabId: 'A', x: 0, y: 6, w: 12, h: 6 },
      { tabId: 'C', x: 0, y: 12, w: 12, h: 6 },
    ], 'B', 1);
    expect(projected?.map((tile) => [tile.tabId, tile.rowBreakBefore])).toEqual([
      ['B', false], ['A', false], ['C', true],
    ]);
  });
});
