export interface SparkBar {
  readonly index: number;
  readonly value: number;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  /** The last point: drawn in the highlight (or failing) fill. */
  readonly latest: boolean;
}

/** Bar height and slot in viewBox units; at natural size one unit is one CSS pixel. */
export const SPARK_HEIGHT = 30;
const SLOT = 13;
const BAR_WIDTH = 10;
/** Every bar stays visible, so the smallest point never reads as "missing". */
const MIN_BAR_HEIGHT = 4;

/**
 * Fixed SVG coordinates for an inline bar sparkline; attributes only, with no
 * DOM or style dependencies. Bars rise from the bottom edge, scaled over the
 * range that includes zero (as in `chartGeometry`), so a negative point is a
 * shorter bar, never an inverted one.
 */
export function sparklineGeometry(points: readonly number[]) {
  const minY = Math.min(0, ...points);
  const maxY = Math.max(0, ...points);
  // Divide first so finite contract values near Number.MAX_VALUE cannot overflow.
  const scale = Math.max(Math.abs(minY), Math.abs(maxY), 1);
  const ratio = (value: number) => minY === maxY ? 0.5 : (value / scale - minY / scale) / (maxY / scale - minY / scale);
  const bars = points.map((value, index): SparkBar => {
    const height = MIN_BAR_HEIGHT + ratio(value) * (SPARK_HEIGHT - MIN_BAR_HEIGHT);
    return { index, value, x: index * SLOT + (SLOT - BAR_WIDTH) / 2, y: SPARK_HEIGHT - height,
      width: BAR_WIDTH, height, latest: index === points.length - 1 };
  });
  return { width: Math.max(points.length, 1) * SLOT, height: SPARK_HEIGHT, bars };
}
