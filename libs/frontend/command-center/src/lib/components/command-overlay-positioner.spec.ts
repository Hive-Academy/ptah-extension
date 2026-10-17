import type { SceneGeometry } from '../scene/connector-geometry';
import { CommandOverlayPositioner } from './command-overlay-positioner';

const geometry: SceneGeometry = {
  stage: { x: 0, y: 0, width: 1056, height: 620 },
  streamViewport: { x: 20, y: 80, width: 270, height: 500 },
  streamContent: { x: 27, y: 80, width: 241, height: 500 },
  rows: { a: { x: 27, y: 100, width: 241, height: 44 } },
  dial: { x: 340, y: 120, width: 292, height: 292 },
  rootButton: { x: 380, y: 160, width: 212, height: 212 },
  cards: {
    inProgress: { x: 784, y: 80, width: 252, height: 100 },
    waiting: { x: 784, y: 190, width: 252, height: 100 },
    finished: { x: 784, y: 300, width: 252, height: 100 },
    other: { x: 784, y: 410, width: 252, height: 100 },
  },
};

describe('CommandOverlayPositioner', () => {
  const positioner = new CommandOverlayPositioner();
  it('places a pinned stream plate directly after its row within content width', () => {
    const placed = positioner.pinned(geometry, 'a', 'stream', 160);
    expect(placed?.plate.y).toBe(152);
    expect(placed?.plate.width).toBe(241);
    expect(placed?.reservation.inlineSlotHeight).toBeGreaterThan(0);
  });
  it('places a root pin below the dial and suppresses stacked previews', () => {
    expect(positioner.pinned(geometry, 'root', 'root', 100)?.plate.y).toBe(420);
    expect(positioner.preview({ ...geometry, stage: { ...geometry.stage, width: 680 } }, 'a', 40, 'stream')).toBeNull();
  });
});
