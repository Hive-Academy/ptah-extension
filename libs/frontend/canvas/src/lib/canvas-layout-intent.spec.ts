import type { TileIntent } from './canvas-layout.service';
import {
  effectiveCapacity,
  logicalRows,
  projectDragIntent,
  retainTilesInLogicalRows,
} from './canvas-layout-intent';

const tiles = (...rows: readonly (readonly string[])[]): TileIntent[] =>
  rows.flatMap((row, rowIndex) =>
    row.map((tabId, index) => ({
      tabId,
      order: 0,
      weight: 1,
      rowBreakBefore: rowIndex > 0 && index === 0,
    })),
  ).map((tile, order) => ({ ...tile, order }));

const rowIds = (intent: readonly TileIntent[]): readonly string[][] =>
  logicalRows(intent).map((row) => row.map((tile) => tile.tabId));

describe('canvas layout intent', () => {
  it('transfers a removed row-start boundary to the next survivor', () => {
    const before = tiles(['A', 'B'], ['C', 'D']);
    const after = retainTilesInLogicalRows(before, new Set(['A', 'B', 'D']));
    expect(rowIds(after)).toEqual([['A', 'B'], ['D']]);
    expect(after.map((tile) => tile.rowBreakBefore)).toEqual([false, false, true]);
  });

  it('derives Auto/1/2/3 capacity without exceeding responsive capacity', () => {
    expect(effectiveCapacity(3, 'auto')).toBe(3);
    expect(effectiveCapacity(3, 2)).toBe(2);
    expect(effectiveCapacity(1, 3)).toBe(1);
  });

  it('projects a wide three-tile drag into durable 2+1 intent', () => {
    const projected = projectDragIntent(
      tiles(['A', 'B', 'C']),
      [
        { tabId: 'A', x: 0, y: 0 },
        { tabId: 'B', x: 6, y: 0 },
        { tabId: 'C', x: 0, y: 6 },
      ],
      'C',
      3,
    );
    expect(projected && rowIds(projected)).toEqual([['A', 'B'], ['C']]);
  });

  it('allows capacity-one reorder only inside existing logical row blocks', () => {
    const before = tiles(['A', 'B'], ['C', 'D']);
    const valid = projectDragIntent(
      before,
      ['A', 'B', 'D', 'C'].map((tabId, y) => ({ tabId, x: 0, y })),
      'D',
      1,
    );
    expect(valid && rowIds(valid)).toEqual([['A', 'B'], ['D', 'C']]);

    const invalid = projectDragIntent(
      before,
      ['A', 'D', 'B', 'C'].map((tabId, y) => ({ tabId, x: 0, y })),
      'D',
      1,
    );
    expect(invalid).toBeNull();
  });

  it('rejects missing, duplicate, unknown and invalid observations', () => {
    const before = tiles(['A', 'B']);
    expect(projectDragIntent(before, [{ tabId: 'A', x: 0, y: 0 }], 'A', 2)).toBeNull();
    expect(projectDragIntent(before, [
      { tabId: 'A', x: 0, y: 0 },
      { tabId: 'A', x: 1, y: 0 },
    ], 'A', 2)).toBeNull();
    expect(projectDragIntent(before, [
      { tabId: 'A', x: 0, y: 0 },
      { tabId: 'ghost', x: 1, y: 0 },
    ], 'A', 2)).toBeNull();
    expect(projectDragIntent(before, [
      { tabId: 'A', x: Number.NaN, y: 0 },
      { tabId: 'B', x: 1, y: 0 },
    ], 'A', 2)).toBeNull();
  });

  it('rejects a projection that interleaves non-dragged logical-row members', () => {
    expect(projectDragIntent(
      tiles(['A', 'B'], ['C', 'D']),
      [
        { tabId: 'A', x: 0, y: 0 },
        { tabId: 'D', x: 6, y: 0 },
        { tabId: 'C', x: 0, y: 6 },
        { tabId: 'B', x: 6, y: 6 },
      ],
      'D',
      2,
    )).toBeNull();
  });
});
