import type { Rect } from './connector-geometry';
import { buildSceneGeometry, type SceneMeasurement } from './scene-measurement';

const rect = (x: number, y: number, width: number, height: number): Rect => ({ x, y, width, height });

function measured(clientWidth: number, viewportWidth: number): SceneMeasurement {
  return {
    stage: rect(100, 50, 1056, 700),
    streamViewport: rect(120, 80, viewportWidth, 205),
    streamClientWidth: clientWidth,
    streamPaddingLeft: 7,
    streamPaddingRight: 7,
    rows: { first: rect(127, 90, 240, 44) },
    dial: rect(502, 140, 292, 292),
    rootButton: rect(555, 195, 180, 180),
    cards: {
      inProgress: rect(900, 90, 200, 80), waiting: rect(900, 180, 200, 80),
      finished: rect(900, 270, 200, 80), other: rect(900, 360, 200, 80),
    },
  };
}

describe('buildSceneGeometry', () => {
  it.each([
    [255, 270, 241], [262, 270, 248],
    [329, 344, 315], [269, 284, 255],
  ])('uses client width %i and viewport width %i to make a %i content box', (clientWidth, viewportWidth, expected) => {
    const geometry = buildSceneGeometry(measured(clientWidth, viewportWidth));
    expect(geometry.streamContent).toEqual(rect(27, 30, expected, 205));
    expect(geometry.streamViewport.width).toBe(viewportWidth);
  });

  it('translates every supplied rectangle into stage-local coordinates', () => {
    const geometry = buildSceneGeometry(measured(255, 270));
    expect(geometry.stage).toEqual(rect(0, 0, 1056, 700));
    expect(geometry.rows['first']).toEqual(rect(27, 40, 240, 44));
    expect(geometry.dial).toEqual(rect(402, 90, 292, 292));
    expect(geometry.rootButton).toEqual(rect(455, 145, 180, 180));
    expect(geometry.cards.inProgress).toEqual(rect(800, 40, 200, 80));
  });
});
