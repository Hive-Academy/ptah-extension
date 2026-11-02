import type { CompactRailState } from '@ptah-extension/chat-ui';

export type RailGroupKey = 'running' | 'waiting' | 'finished';

export interface RailGroup<T extends { readonly tabId: string }> {
  readonly key: RailGroupKey;
  readonly label: string;
  readonly tiles: readonly T[];
}

const GROUPS: readonly { key: RailGroupKey; label: string }[] = [
  { key: 'running', label: 'Running' },
  { key: 'waiting', label: 'Waiting / Needs input / Error / Idle' },
  { key: 'finished', label: 'Finished' },
];

export function railGroupFor(state: CompactRailState | undefined): RailGroupKey {
  return state === 'running' ? 'running' : state === 'done' ? 'finished' : 'waiting';
}

export function groupRailTiles<T extends { readonly tabId: string }>(
  orderedTiles: readonly T[],
  states: ReadonlyMap<string, CompactRailState>,
): { groups: readonly RailGroup<T>[]; displayedIds: readonly string[]; counts: Readonly<Record<CompactRailState, number>> } {
  const buckets: Record<RailGroupKey, T[]> = { running: [], waiting: [], finished: [] };
  const counts: Record<CompactRailState, number> = { running: 0, needs: 0, error: 0, idle: 0, done: 0 };
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
