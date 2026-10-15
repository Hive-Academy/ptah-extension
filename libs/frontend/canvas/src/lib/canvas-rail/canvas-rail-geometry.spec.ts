import { COMPACT_RAIL_CARD_HEIGHT } from '@ptah-extension/chat-ui';
import { checkRailGeometry, railAnchorScrollTop, railCardHeight } from './canvas-rail-geometry';

describe('rail geometry', () => {
  it('anchors a card above, below or inside the viewport', () => {
    expect(railAnchorScrollTop(0, 96, 200, 100)).toBe(0);
    expect(railAnchorScrollTop(3, 96, 200, 0)).toBe(208);
    expect(railAnchorScrollTop(1, 96, 200, 0)).toBe(0);
  });

  it('uses the shared heights and collapsed height', () => {
    expect(railCardHeight('comfortable', false)).toBe(COMPACT_RAIL_CARD_HEIGHT.comfortable);
    expect(railCardHeight('dense', false)).toBe(COMPACT_RAIL_CARD_HEIGHT.dense);
    expect(railCardHeight('dense', true)).toBe(56);
  });

  it('resets on a new key and counts reordered or incorrectly sized cards', () => {
    const initial = { key: 'dense|false', order: ['a', 'b'], heights: [96, 96] };
    const first = checkRailGeometry(null, initial, 96);
    expect(first.shifts).toBe(0);
    expect(checkRailGeometry(first.baseline, initial, 96).shifts).toBe(0);
    expect(checkRailGeometry(first.baseline, { ...initial, order: ['b', 'a'], heights: [96, 95] }, 96).shifts).toBe(2);
    expect(checkRailGeometry(first.baseline, { ...initial, key: 'comfortable|false' }, 176).shifts).toBe(0);
  });
});
