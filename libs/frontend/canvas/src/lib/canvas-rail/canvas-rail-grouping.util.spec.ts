import type { CompactRailState } from '@ptah-extension/chat-ui';
import { groupRailTiles, sameGroupMoveIds } from './canvas-rail-grouping.util';

const tiles = ['a', 'b', 'c', 'd', 'e'].map(tabId => ({ tabId }));
const states = new Map<string, CompactRailState>([
  ['a', 'done'], ['b', 'needs'], ['c', 'running'], ['d', 'error'], ['e', 'running'],
]);

describe('canvas rail grouping', () => {
  it('groups in display order without changing the stored tiles', () => {
    const result = groupRailTiles(tiles, states);
    expect(result.groups.map(group => [group.label, group.tiles.map(tile => tile.tabId)]))
      .toEqual([
        ['Running', ['c', 'e']],
        ['Waiting / Needs input / Error / Idle', ['b', 'd']],
        ['Finished', ['a']],
      ]);
    expect(result.displayedIds).toEqual(['c', 'e', 'b', 'd', 'a']);
    expect(tiles.map(tile => tile.tabId)).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(result.counts).toEqual({ running: 2, needs: 1, error: 1, idle: 0, done: 1 });
  });

  it('treats missing state as idle and omits empty groups', () => {
    expect(groupRailTiles([tiles[0]], new Map()).groups.map(group => group.key)).toEqual(['waiting']);
    expect(groupRailTiles([], states).groups).toEqual([]);
  });

  it('swaps displayed siblings in their stored slots and refuses group boundaries', () => {
    const ids = tiles.map(tile => tile.tabId);
    expect(sameGroupMoveIds(ids, states, 'c', 1)).toEqual(['a', 'b', 'e', 'd', 'c']);
    expect(sameGroupMoveIds(ids, states, 'c', -1)).toBeNull();
    expect(sameGroupMoveIds(ids, states, 'd', -1)).toEqual(['a', 'd', 'c', 'b', 'e']);
    expect(sameGroupMoveIds(ids, states, 'missing', 1)).toBeNull();
    expect(ids).toEqual(['a', 'b', 'c', 'd', 'e']);
  });
});
