import { canvasGridItems } from './canvas-grid-items';

describe('canvasGridItems detail live budget', () => {
  const tiles = ['a', 'b', 'c'].map((tabId, order) => ({
    tabId,
    order,
    width: { kind: 'auto' as const, weight: 1 },
    rowBreakBefore: false,
  })) as Parameters<typeof canvasGridItems>[0];
  const layout = tiles.map((tile, x) => ({
    tabId: tile.tabId,
    x,
    y: 0,
    w: 1,
    h: 2,
  })) as Parameters<typeof canvasGridItems>[1];

  it('turns the focused tile into a card while detail is open', () => {
    const options = new Map();
    const previous = new Map<string, boolean>();
    const items = (detailOpen: boolean) =>
      canvasGridItems(
        tiles,
        layout,
        options,
        new Set(),
        'b',
        detailOpen,
        previous,
        true,
        false,
        () => undefined,
      );
    expect(items(false).map((item) => item.autoCard)).toEqual([
      true,
      false,
      true,
    ]);
    expect(items(true).map((item) => item.autoCard)).toEqual([
      true,
      true,
      true,
    ]);
  });
});
