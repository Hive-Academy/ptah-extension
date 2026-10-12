export const CANVAS_LIVE_BUDGET = 2;

export function isAutoCardTile(
  tileCount: number,
  focused: boolean,
  budget = CANVAS_LIVE_BUDGET,
): boolean {
  return tileCount > budget && !focused;
}
