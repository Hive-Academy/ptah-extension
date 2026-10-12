import { CANVAS_LIVE_BUDGET, isAutoCardTile } from './canvas-live-budget';

describe('isAutoCardTile', () => {
  it.each([1, 2, 3])('applies the default budget to %i tiles', (count) => {
    expect(isAutoCardTile(count, true)).toBe(false);
    expect(isAutoCardTile(count, false)).toBe(count > CANVAS_LIVE_BUDGET);
  });

  it('accepts a different live budget', () => {
    expect(isAutoCardTile(3, false, 3)).toBe(false);
    expect(isAutoCardTile(4, false, 3)).toBe(true);
    expect(isAutoCardTile(4, true, 3)).toBe(false);
  });
});
