export type CanvasBoardMode = 'rail' | 'grid';
export type CanvasRailDensity = 'comfortable' | 'dense';

export interface CanvasBoardState {
  readonly mode: CanvasBoardMode;
  readonly railCollapsed: boolean;
  readonly railDensity: CanvasRailDensity;
  readonly railScrollTop: number;
}

export const DEFAULT_BOARD_STATE: CanvasBoardState = {
  mode: 'rail',
  railCollapsed: false,
  railDensity: 'comfortable',
  railScrollTop: 0,
};

export function railWidthBand(width: number): 'xl' | 'lg' | 'md' | 'sm' {
  if (width >= 1760) return 'xl';
  if (width >= 1280) return 'lg';
  if (width >= 1120) return 'md';
  return 'sm';
}
