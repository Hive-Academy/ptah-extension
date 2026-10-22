/** Pure geometry and scale helpers for the daily stacked bar chart. */
interface Gridline { readonly y: number; readonly label: string; }
interface XLabel { readonly x: number; readonly label: string; }
interface DayColumn { readonly index: number; readonly x: number; readonly width: number; readonly day: string; readonly aria: string; }
interface ReadoutItem { readonly id: string; readonly label: string; readonly color: string; readonly valueLabel: string; }
export const VIEW_W = 640;
export const VIEW_H = 240;
export const PAD_L = 48;
const PAD_R = 8;
export const PAD_T = 10;
const PAD_B = 26;
export const PLOT_W = VIEW_W - PAD_L - PAD_R;
export const PLOT_H = VIEW_H - PAD_T - PAD_B;
export const SINGLE_DAY_BAR_W = 48;
const MAX_SERIES_VALUE = 1e15;
export function niceCeiling(value: number): number {
  if (value <= 0) return 1;
  const base = Math.pow(10, Math.floor(Math.log10(value)));
  for (const multiple of [1, 2, 5, 10]) {
    if (value <= multiple * base) return multiple * base;
  }
  return 10 * base;
}
export function sanitizeSeriesValue(value: number): number {
  return Number.isFinite(value) && value >= 0 ? Math.min(value, MAX_SERIES_VALUE) : 0;
}
export type { DayColumn, Gridline, ReadoutItem, XLabel };
