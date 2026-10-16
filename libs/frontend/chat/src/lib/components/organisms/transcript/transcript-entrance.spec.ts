import { selectVisibleEntrance } from './transcript-entrance';

const rect = (top: number, bottom: number): DOMRectReadOnly =>
  DOMRectReadOnly.fromRect({ x: 0, y: top, width: 100, height: bottom - top });
const item = (id: string, top: number, bottom: number) => ({ id, rect: rect(top, bottom) });
const viewport = rect(0, 100);

describe('selectVisibleEntrance', () => {
  it('gives a tall final reply index zero', () => {
    expect(selectVisibleEntrance(viewport, [item('last', -300, 100), item('old', -400, -300)], 6))
      .toEqual(['last']);
  });

  it('orders fewer than six visible slots from oldest to newest', () => {
    expect(selectVisibleEntrance(viewport, [item('c', 60, 100), item('b', 20, 60), item('a', -20, 20)], 6))
      .toEqual(['a', 'b', 'c']);
  });

  it('caps the newest six', () => {
    const items = Array.from({ length: 10 }, (_, n) => item(String(9 - n), 90 - n * 10, 100 - n * 10));
    expect(selectVisibleEntrance(viewport, items, 6)).toEqual(['4', '5', '6', '7', '8', '9']);
  });

  it('includes a partly visible top slot and stops at the fully above slot', () => {
    const items = [item('bottom', 40, 80), item('top', -10, 40), item('above', -30, 0), item('older', -50, -30)];
    expect(selectVisibleEntrance(viewport, items, 6)).toEqual(['top', 'bottom']);
  });

  it('skips below viewport when scrolled up', () => {
    const items = [item('below', 100, 120), item('middle', 30, 70), item('top', -20, 30), item('above', -50, 0)];
    expect(selectVisibleEntrance(viewport, items, 6)).toEqual(['top', 'middle']);
  });

  it('does not spend a cap slot or an index on zero-height items', () => {
    const items = [item('new', 70, 90), item('empty', 60, 60), item('old', 40, 60)];
    expect(selectVisibleEntrance(viewport, items, 2)).toEqual(['old', 'new']);
  });

  it('returns empty for no items or a zero cap', () => {
    expect(selectVisibleEntrance(viewport, [], 6)).toEqual([]);
    expect(selectVisibleEntrance(viewport, [item('a', 0, 20)], 0)).toEqual([]);
  });

  it('does not read an item older than the first fully above slot', () => {
    const older = { id: 'older', get rect(): DOMRectReadOnly { throw new Error('read beyond stop'); } };
    expect(selectVisibleEntrance(viewport, [item('visible', 0, 10), item('above', -10, 0), older], 6))
      .toEqual(['visible']);
  });
});
