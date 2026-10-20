/**
 * Pure geometry helpers for the usage stacked-area chart (TASK_2026_707
 * PR 2): view constants, the nice-ceiling scale, the Fritsch–Carlson monotone
 * cubic path builder and the single value-sanitization boundary. No Angular
 * imports — every function is pure.
 */

export interface Point {
  readonly x: number;
  readonly y: number;
}

interface Gridline {
  readonly y: number;
  readonly label: string;
}

interface XLabel {
  readonly x: number;
  readonly label: string;
}

interface DayColumn {
  readonly index: number;
  readonly x: number;
  readonly width: number;
  readonly day: string;
  readonly aria: string;
}

interface ReadoutItem {
  readonly id: string;
  readonly label: string;
  readonly color: string;
  readonly valueLabel: string;
}

export const VIEW_W = 640;
export const VIEW_H = 240;
export const PAD_L = 48;
export const PAD_R = 8;
export const PAD_T = 10;
export const PAD_B = 26;
export const PLOT_W = VIEW_W - PAD_L - PAD_R;
export const PLOT_H = VIEW_H - PAD_T - PAD_B;
/** Width of the single bar drawn for a one-day range. */
export const SINGLE_DAY_BAR_W = 48;
/**
 * Cap on one plotted value. Real usage never approaches it, and with it no
 * sum over any realistic series x day count can reach Infinity.
 */
export const MAX_SERIES_VALUE = 1e15;

/** Smallest value >= `value` of the form 1/2/5 x 10^k, for gridline labels. */
export function niceCeiling(value: number): number {
  if (value <= 0) return 1;
  const base = Math.pow(10, Math.floor(Math.log10(value)));
  for (const multiple of [1, 2, 5, 10]) {
    if (value <= multiple * base) return multiple * base;
  }
  return 10 * base;
}

/**
 * Fritsch–Carlson monotone cubic segments through `points` (without the
 * initial `M`): no segment overshoots, so stacked areas stay ordered.
 */
export function monotoneSegments(points: readonly Point[]): string {
  const n = points.length;
  if (n < 2) return '';
  const steps: number[] = [];
  const slopes: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    const p0 = points[i]!;
    const p1 = points[i + 1]!;
    const h = p1.x - p0.x;
    steps.push(h);
    slopes.push(h === 0 ? 0 : (p1.y - p0.y) / h);
  }
  const tangents: number[] = new Array<number>(n).fill(0);
  tangents[0] = slopes[0]!;
  tangents[n - 1] = slopes[n - 2]!;
  for (let i = 1; i < n - 1; i++) {
    tangents[i] =
      slopes[i - 1]! * slopes[i]! <= 0
        ? 0
        : (slopes[i - 1]! + slopes[i]!) / 2;
  }
  for (let i = 0; i < n - 1; i++) {
    const slope = slopes[i]!;
    if (slope === 0) {
      tangents[i] = 0;
      tangents[i + 1] = 0;
      continue;
    }
    const a = tangents[i]! / slope;
    const b = tangents[i + 1]! / slope;
    const s = a * a + b * b;
    if (s > 9) {
      const t = 3 / Math.sqrt(s);
      tangents[i] = t * a * slope;
      tangents[i + 1] = t * b * slope;
    }
  }
  let d = '';
  for (let i = 0; i < n - 1; i++) {
    const p0 = points[i]!;
    const p1 = points[i + 1]!;
    const h = steps[i]!;
    d += ` C ${(p0.x + h / 3).toFixed(2)} ${(p0.y + (tangents[i]! * h) / 3).toFixed(2)} ${(p1.x - h / 3).toFixed(2)} ${(p1.y - (tangents[i + 1]! * h) / 3).toFixed(2)} ${p1.x} ${p1.y}`;
  }
  return d;
}

/** Closed area between a smooth `top` boundary and a smooth `bottom` one. */
export function areaPath(top: readonly Point[], bottom: readonly Point[]): string {
  if (top.length < 2 || bottom.length < 2) return '';
  const first = top[0]!;
  const lastTop = top[top.length - 1]!;
  const lastBottom = bottom[bottom.length - 1]!;
  const reversedBottom = [...bottom].reverse();
  return (
    `M ${first.x} ${first.y}` +
    monotoneSegments(top) +
    ` L ${lastTop.x} ${lastBottom.y}` +
    monotoneSegments(reversedBottom) +
    ' Z'
  );
}

/**
 * The single boundary every plotted number passes: a value that is not a
 * finite non-negative number becomes 0, and any value is capped so sums can
 * never overflow into NaN or Infinity geometry or labels.
 */
export function sanitizeSeriesValue(value: number): number {
  return Number.isFinite(value) && value >= 0
    ? Math.min(value, MAX_SERIES_VALUE)
    : 0;
}

export type { DayColumn, Gridline, ReadoutItem, XLabel };