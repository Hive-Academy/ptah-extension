/** Number of tiles kept live before background tiles become cards. */
export const CANVAS_LIVE_BUDGET = 2;

/** Whether a tile should use the summary card at the current live budget. */
export function isAutoCardTile(
  tileCount: number,
  focused: boolean,
  budget = CANVAS_LIVE_BUDGET,
): boolean {
  return tileCount > budget && !focused;
}
