import { getConnectorPaths, segmentIntersectsRect, type Rect, type SceneGeometry } from './connector-geometry';

function snapshot(width: number): SceneGeometry {
  const wide = width >= 960;
  const compact = width < 680;
  const rowWidth = wide ? 280 : compact ? width - 72 : 280;
  const dialSize = wide ? 292 : compact ? 160 : 200;
  const dialX = wide ? Math.round(width * 0.43) : (width - dialSize) / 2;
  const dialY = wide ? 150 : 320;
  const cardWidth = wide ? 210 : compact ? (width - 56) / 2 : 240;
  const leftX = compact ? 16 : 100;
  const rightX = width - 16 - cardWidth;
  const cards = wide ? {
    inProgress: { x: width - 250, y: 80, width: cardWidth, height: 80 },
    waiting: { x: width - 250, y: 190, width: cardWidth, height: 80 },
    finished: { x: width - 250, y: 300, width: cardWidth, height: 80 },
    other: { x: width - 250, y: 410, width: cardWidth, height: 80 },
  } : {
    inProgress: { x: leftX, y: 540, width: cardWidth, height: 72 },
    waiting: { x: rightX, y: 540, width: cardWidth, height: 72 },
    finished: { x: leftX, y: 660, width: cardWidth, height: 72 },
    other: { x: rightX, y: 660, width: cardWidth, height: 72 },
  };
  const viewport = { x: 16, y: 70, width: rowWidth, height: 200 };
  return {
    stage: { x: 0, y: 0, width, height: 780 },
    streamViewport: viewport,
    streamContent: viewport,
    rows: {
      first: { x: 16, y: 80, width: rowWidth, height: 44 },
      second: { x: 16, y: 130, width: rowWidth, height: 44 },
      clipped: { x: 16, y: 250, width: rowWidth, height: 44 },
    },
    dial: { x: dialX, y: dialY, width: dialSize, height: dialSize },
    rootButton: { x: dialX + dialSize * 0.16, y: dialY + dialSize * 0.16, width: dialSize * 0.68, height: dialSize * 0.68 },
    cards,
  };
}

describe('connector geometry', () => {
  it.each([1440, 1100, 900, 400, 340])('routes visible rows and four distinct safe ribbons at %ipx', (width) => {
    const geometry = snapshot(width);
    const paths = getConnectorPaths(geometry);
    expect(paths.wires).toHaveLength(2);
    expect(paths.ribbons).toHaveLength(4);
    expect(new Set(paths.ribbons.map((ribbon) => `${ribbon.start.x},${ribbon.start.y}`)).size).toBe(4);
    for (const ribbon of paths.ribbons) {
      const foreign = Object.entries(geometry.cards)
        .filter(([key]) => key !== ribbon.key)
        .map(([, card]) => card as Rect);
      for (let i = 1; i < ribbon.points.length; i++) {
        for (const card of foreign) {
          expect(segmentIntersectsRect(ribbon.points[i - 1], ribbon.points[i], card)).toBe(false);
        }
      }
    }
  });

  it('clears paths without a measurable scene or below the decorative breakpoint', () => {
    expect(getConnectorPaths(null)).toEqual({ wires: [], ribbons: [] });
    expect(getConnectorPaths(snapshot(339))).toEqual({ wires: [], ribbons: [] });
  });
});
