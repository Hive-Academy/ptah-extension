import type { GridStackWidget } from 'gridstack';
import type { TileIntent } from './canvas-layout-intent';
import { firstTileIdByOrder } from './canvas-layout-intent';
import type { CanvasLayoutService } from './canvas-layout.service';
import { CANVAS_LIVE_BUDGET, isAutoCardTile } from './canvas-live-budget';

const UNMEASURED_ITEM = { x: 0, y: 0, w: 12, h: 6 } as const;

/** Build tile bindings while preserving each Gridstack creation option object. */
export function canvasGridItems(
  tiles: readonly TileIntent[],
  layoutTiles: ReturnType<CanvasLayoutService['computeLayout']>['tiles'],
  creationOptions: Map<string, GridStackWidget>,
  compactIds: ReadonlySet<string>,
  focusedTabId: string | null,
  detailOpen: boolean,
  previousAutoCards: Map<string, boolean>,
  visible: boolean,
  frozen: boolean,
  onOptionCreated: () => void,
) {
  const derived = new Map(layoutTiles.map((tile) => [tile.tabId, tile]));
  const liveIds = new Set(tiles.map((tile) => tile.tabId));
  for (const tabId of creationOptions.keys()) {
    if (!liveIds.has(tabId)) creationOptions.delete(tabId);
  }
  for (const tabId of previousAutoCards.keys()) {
    if (!liveIds.has(tabId)) previousAutoCards.delete(tabId);
  }
  const noMove = frozen || tiles.length === 1;
  const firstId = firstTileIdByOrder(tiles);
  return tiles.map((tile) => {
    const position = derived.get(tile.tabId) ?? UNMEASURED_ITEM;
    let options = creationOptions.get(tile.tabId);
    if (!options) {
      options = {
        x: position.x,
        y: position.y,
        w: position.w,
        h: position.h,
        id: tile.tabId,
        noMove,
        noResize: frozen,
      };
      creationOptions.set(tile.tabId, options);
      onOptionCreated();
    } else {
      options.noMove = noMove;
      options.noResize = frozen;
    }
    const autoCard = visible
      ? isAutoCardTile(tiles.length, focusedTabId === tile.tabId) ||
        (tiles.length > CANVAS_LIVE_BUDGET && detailOpen)
      : (previousAutoCards.get(tile.tabId) ?? false);
    if (visible) previousAutoCards.set(tile.tabId, autoCard);
    return {
      tabId: tile.tabId,
      width: tile.width,
      rowBreakBefore: tile.rowBreakBefore,
      firstInOrder: tile.tabId === firstId,
      compact: compactIds.has(tile.tabId),
      autoCard,
      options,
    };
  });
}
