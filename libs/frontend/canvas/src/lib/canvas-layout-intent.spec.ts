import {
  logicalRows,
  packRows,
  projectDragIntent,
  projectPreset,
  retainTilesInLogicalRows,
  snapSpan,
  type TileIntent,
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

  it('creates a drag break only when the boundary was not forced by overflow', () => {
    const source = tiles([['A', span('third')], ['B', span('third')], ['C', span('third')]]);
    const deliberate = projectDragIntent(source, [
      { tabId: 'A', x: 0, y: 0 }, { tabId: 'B', x: 4, y: 0 }, { tabId: 'C', x: 0, y: 6 },
    ], 'C', 3);
    expect(deliberate && rowIds(deliberate)).toEqual([['A', 'B'], ['C']]);

    const overflowSource = tiles([['A', span('two-thirds')], ['B', span('half')]]);
    const overflow = projectDragIntent(overflowSource, [
      { tabId: 'A', x: 0, y: 0 }, { tabId: 'B', x: 0, y: 6 },
    ], 'B', 3);
    expect(overflow?.[1].rowBreakBefore).toBe(false);
  });

  it('keeps a dropped third auto tile below two auto tiles at capacity three', () => {
    const source = tiles([['A', auto()], ['B', auto()], ['C', auto()]]);
    const projected = projectDragIntent(source, [
      { tabId: 'A', x: 0, y: 0 }, { tabId: 'B', x: 4, y: 0 }, { tabId: 'C', x: 0, y: 6 },
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
      { tabId: 'A', x: 0, y: 0 }, { tabId: 'B', x: 6, y: 0 }, { tabId: 'C', x: 0, y: 6 },
    ], 'C', 2);
    expect(projected?.[2].rowBreakBefore).toBe(true);
    expect(packRows(projected ?? [], 2)).toEqual([
      [{ tabId: 'A', units: 6 }, { tabId: 'B', units: 6 }],
      [{ tabId: 'C', units: 12 }],
    ]);
  });

  it('preserves logical rows on deletion and rejects invalid observations', () => {
    const source = tiles([['A', auto()]], [['B', auto()], ['C', auto()]]);
    expect(rowIds(retainTilesInLogicalRows(source, new Set(['A', 'C'])))).toEqual([['A'], ['C']]);
    expect(projectDragIntent(source, [{ tabId: 'A', x: 0, y: 0 }], 'A', 3)).toBeNull();
  });

  it('rejects capacity-one interleaving of old logical rows', () => {
    const source = tiles([['A', auto()], ['B', auto()]], [['C', auto()]]);
    expect(projectDragIntent(source, [
      { tabId: 'A', x: 0, y: 0 }, { tabId: 'C', x: 0, y: 6 }, { tabId: 'B', x: 0, y: 12 },
    ], 'C', 1)).toBeNull();
  });
});
