import type { CompactRailState } from '@ptah-extension/chat-ui';
import type { CanvasRailSort } from '../canvas-board-mode';

export type RailGroupKey = 'running' | 'background' | 'waiting' | 'finished';

export interface RailGroup<T extends { readonly tabId: string }> {
  readonly key: RailGroupKey;
  readonly label: string;
  readonly tiles: readonly T[];
}

const GROUPS: readonly { key: RailGroupKey; label: string }[] = [
  { key: 'running', label: 'Running' },
  { key: 'background', label: 'Background work' },
  { key: 'waiting', label: 'Waiting / Needs input / Error / Idle' },
  { key: 'finished', label: 'Finished' },
];

export function railGroupFor(state: CompactRailState | undefined): RailGroupKey {
  switch (state) {
    case 'running': return 'running';
    case 'background': return 'background';
    case 'done': return 'finished';
    default: return 'waiting';
  }
}

/**
 * Display order of the rail before grouping. `manual` keeps the stored tile
 * order. `recent` puts the newest tab activity first and breaks ties by the
 * stored order. A live turn bumps its tab's activity on every stream flush,
 * so live (`running`) tiles rank as equally recent: two streaming sessions
 * would otherwise swap places many times a second.
 */
export function sortRailTiles<T extends { readonly tabId: string; readonly order: number }>(
  tiles: readonly T[],
  sort: CanvasRailSort,
  states: ReadonlyMap<string, CompactRailState>,
  lastActivityAt: (tabId: string) => number | undefined,
): T[] {
  if (sort === 'manual') return [...tiles].sort((a, b) => a.order - b.order);
  const activity = new Map(tiles.map(tile => [
    tile.tabId,
    states.get(tile.tabId) === 'running' ? Number.POSITIVE_INFINITY : (lastActivityAt(tile.tabId) ?? 0),
  ]));
  return [...tiles].sort((a, b) => {
    const left = activity.get(a.tabId) ?? 0;
    const right = activity.get(b.tabId) ?? 0;
    return left === right ? a.order - b.order : right > left ? 1 : -1;
  });
}

/** Equality for a computed tile order: same tile objects in the same order. */
export function sameTileOrder<T>(a: readonly T[], b: readonly T[]): boolean {
  return a.length === b.length && a.every((tile, index) => tile === b[index]);
}

export function groupRailTiles<T extends { readonly tabId: string }>(
  orderedTiles: readonly T[],
  states: ReadonlyMap<string, CompactRailState>,
): { groups: readonly RailGroup<T>[]; displayedIds: readonly string[]; counts: Readonly<Record<CompactRailState, number>> } {
  const buckets: Record<RailGroupKey, T[]> = { running: [], background: [], waiting: [], finished: [] };
  const counts: Record<CompactRailState, number> = {
    running: 0, background: 0, needs: 0, error: 0, idle: 0, done: 0,
  };
  for (const tile of orderedTiles) {
    const state = states.get(tile.tabId) ?? 'idle';
    buckets[railGroupFor(state)].push(tile);
    counts[state]++;
  }
  const groups = GROUPS.filter(({ key }) => buckets[key].length > 0)
    .map(({ key, label }) => ({ key, label, tiles: buckets[key] }));
  return { groups, displayedIds: groups.flatMap(group => group.tiles.map(tile => tile.tabId)), counts };
}

/** Pick the next surviving displayed card, or the nearest one before it. */
export function neighbouringVisibleId(
  previousIds: readonly string[],
  visibleIds: readonly string[],
  id: string | null,
): string | null {
  const index = id === null ? -1 : previousIds.indexOf(id);
  if (index < 0) return visibleIds[0] ?? null;
  const visible = new Set(visibleIds);
  for (let next = index + 1; next < previousIds.length; next++) {
    if (visible.has(previousIds[next])) return previousIds[next];
  }
  for (let previous = index - 1; previous >= 0; previous--) {
    if (visible.has(previousIds[previous])) return previousIds[previous];
  }
  return null;
}

/** Swap adjacent displayed siblings while leaving every other stored slot alone. */
export function sameGroupMoveIds(
  storedIds: readonly string[],
  states: ReadonlyMap<string, CompactRailState>,
  id: string,
  direction: -1 | 1,
): string[] | null {
  const group = railGroupFor(states.get(id));
  const siblings = storedIds.filter(candidate => railGroupFor(states.get(candidate)) === group);
  const index = siblings.indexOf(id);
  const neighbour = siblings[index + direction];
  if (index < 0 || !neighbour) return null;
  const result = [...storedIds];
  const from = result.indexOf(id);
  const to = result.indexOf(neighbour);
  [result[from], result[to]] = [result[to], result[from]];
  return result;
}
