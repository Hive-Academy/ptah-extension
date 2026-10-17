import type { Rect, SceneGeometry, StatusGroupKey } from './connector-geometry';

/** Supplied client rectangles and dimensions from one measurement frame. */
export interface SceneMeasurement {
  readonly stage: Rect;
  readonly streamViewport: Rect;
  readonly streamClientWidth: number;
  readonly streamPaddingLeft: number;
  readonly streamPaddingRight: number;
  readonly rows: Readonly<Record<string, Rect>>;
  readonly dial: Rect;
  readonly rootButton: Rect;
  readonly cards: Readonly<Record<StatusGroupKey, Rect>>;
}

function local(rect: Rect, stage: Rect): Rect {
  return { x: rect.x - stage.x, y: rect.y - stage.y, width: rect.width, height: rect.height };
}

/** Converts a single supplied DOM measurement into stage-local geometry. */
export function buildSceneGeometry(measurement: SceneMeasurement): SceneGeometry {
  const { stage, streamViewport, streamClientWidth, streamPaddingLeft, streamPaddingRight } = measurement;
  const rows: Record<string, Rect> = {};
  for (const [id, rect] of Object.entries(measurement.rows)) rows[id] = local(rect, stage);
  const cards: Record<StatusGroupKey, Rect> = {
    inProgress: local(measurement.cards.inProgress, stage),
    waiting: local(measurement.cards.waiting, stage),
    finished: local(measurement.cards.finished, stage),
    other: local(measurement.cards.other, stage),
  };
  return {
    stage: { x: 0, y: 0, width: stage.width, height: stage.height },
    streamViewport: local(streamViewport, stage),
    streamContent: {
      x: streamViewport.x - stage.x + streamPaddingLeft,
      y: streamViewport.y - stage.y,
      width: Math.max(0, streamClientWidth - streamPaddingLeft - streamPaddingRight),
      height: streamViewport.height,
    },
    rows,
    dial: local(measurement.dial, stage),
    rootButton: local(measurement.rootButton, stage),
    cards,
  };
}
