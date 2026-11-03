export type CanvasBoardMode = 'rail';
export type CanvasRailDensity = 'comfortable' | 'dense';
/** `recent`: newest activity first within each group. `manual`: the stored tile order. */
export type CanvasRailSort = 'recent' | 'manual';

export interface CanvasBoardState {
  readonly mode: CanvasBoardMode;
  readonly railCollapsed: boolean;
  readonly railDensity: CanvasRailDensity;
  readonly railSort: CanvasRailSort;
  readonly railScrollTop: number;
}

export const DEFAULT_BOARD_STATE: CanvasBoardState = {
  mode: 'rail',
  railCollapsed: false,
  railDensity: 'dense',
  railSort: 'recent',
  railScrollTop: 0,
};

export function railWidthBand(width: number): 'xl' | 'lg' | 'md' | 'sm' {
  if (width >= 1760) return 'xl';
  if (width >= 1280) return 'lg';
  if (width >= 1120) return 'md';
  return 'sm';
}

/**
 * Rendered rail width (px) for `collapsed` and `band`. Mirrors the literal
 * `w-[…px]` classes of `CanvasRailComponent` (Tailwind needs literals); the
 * rail spec pins the two together.
 */
export function railWidthPx(
  collapsed: boolean,
  band: 'xl' | 'lg' | 'md' | 'sm',
): number {
  if (collapsed) return 56;
  if (band === 'xl' || band === 'lg') return 304;
  if (band === 'md') return 288;
  return 272;
}
