import type { CompactRailState } from '@ptah-extension/chat-ui';
import {
  groupRailTiles,
  railGroupFor,
  sameGroupMoveIds,
  sameTileOrder,
  sortRailTiles,
} from './canvas-rail-grouping.util';

const tiles = ['a', 'b', 'c', 'd', 'e'].map(tabId => ({ tabId }));
const states = new Map<string, CompactRailState>([
  ['a', 'done'], ['b', 'needs'], ['c', 'running'], ['d', 'error'], ['e', 'running'],
]);

describe('canvas rail grouping', () => {
  it('moves a completed background tile into Finished as soon as its state emits done', () => {
    const updated = new Map(states);
    updated.set('c', 'done');
    const grouped = groupRailTiles(tiles, updated);
    expect(grouped.groups.find(group => group.key === 'finished')?.tiles.map(tile => tile.tabId)).toEqual(['a', 'c']);
    expect(grouped.groups.find(group => group.key === 'running')?.tiles.map(tile => tile.tabId)).toEqual(['e']);
  });
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
    expect(result.counts).toEqual({ running: 2, background: 0, needs: 1, error: 1, idle: 0, done: 1 });
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

  it('maps every rail state to its group', () => {
    expect(railGroupFor('running')).toBe('running');
    expect(railGroupFor('background')).toBe('background');
    expect(railGroupFor('done')).toBe('finished');
    for (const state of ['needs', 'error', 'idle', undefined] as const)
      expect(railGroupFor(state)).toBe('waiting');
  });

  it('places background work between Running and Waiting and moves only within it', () => {
    const withBackground = new Map(states).set('a', 'background').set('d', 'background');
    const result = groupRailTiles(tiles, withBackground);
    expect(result.groups.map(group => [group.key, group.label, group.tiles.map(tile => tile.tabId)]))
      .toEqual([
        ['running', 'Running', ['c', 'e']],
        ['background', 'Background work', ['a', 'd']],
        ['waiting', 'Waiting / Needs input / Error / Idle', ['b']],
      ]);
    expect(result.displayedIds).toEqual(['c', 'e', 'a', 'd', 'b']);
    expect(result.counts.background).toBe(2);
    const ids = tiles.map(tile => tile.tabId);
    expect(sameGroupMoveIds(ids, withBackground, 'a', 1)).toEqual(['d', 'b', 'c', 'a', 'e']);
    expect(sameGroupMoveIds(ids, withBackground, 'a', -1)).toBeNull();
  });

  describe('sortRailTiles', () => {
    const stored = [
      { tabId: 'a', order: 0 },
      { tabId: 'b', order: 1 },
      { tabId: 'c', order: 2 },
      { tabId: 'd', order: 3 },
    ];
    const shuffled = [stored[2], stored[0], stored[3], stored[1]];
    const activity = new Map([['a', 10], ['b', 30], ['c', 20], ['d', 30]]);
    const idle = new Map<string, CompactRailState>();

    it('keeps the stored order in manual mode, whatever the activity', () => {
      expect(sortRailTiles(shuffled, 'manual', idle, id => activity.get(id)).map(tile => tile.tabId))
        .toEqual(['a', 'b', 'c', 'd']);
    });

    it('puts the newest activity first in recent mode and breaks ties by stored order', () => {
      expect(sortRailTiles(shuffled, 'recent', idle, id => activity.get(id)).map(tile => tile.tabId))
        .toEqual(['b', 'd', 'c', 'a']);
    });

    it('treats unknown activity as oldest', () => {
      expect(sortRailTiles(shuffled, 'recent', idle, id => (id === 'c' ? 5 : undefined))
        .map(tile => tile.tabId)).toEqual(['c', 'a', 'b', 'd']);
    });

    it('ranks live turns as equally recent so streaming sessions keep their stored order', () => {
      const live = new Map<string, CompactRailState>([['a', 'running'], ['c', 'running']]);
      const ticking = new Map([['a', 10], ['b', 30], ['c', 99], ['d', 20]]);
      expect(sortRailTiles(shuffled, 'recent', live, id => ticking.get(id)).map(tile => tile.tabId))
        .toEqual(['a', 'c', 'b', 'd']);
    });

    it('feeds groupRailTiles so each group is newest first', () => {
      const groupStates = new Map<string, CompactRailState>([
        ['a', 'done'], ['b', 'idle'], ['c', 'done'], ['d', 'idle'],
      ]);
      const sorted = sortRailTiles(stored, 'recent', groupStates, id => activity.get(id));
      expect(groupRailTiles(sorted, groupStates).displayedIds).toEqual(['b', 'd', 'c', 'a']);
    });
  });

  it('compares tile orders by identity', () => {
    const [a, b] = [{ tabId: 'a' }, { tabId: 'b' }];
    expect(sameTileOrder([a, b], [a, b])).toBe(true);
    expect(sameTileOrder([a, b], [b, a])).toBe(false);
    expect(sameTileOrder([a], [a, b])).toBe(false);
    expect(sameTileOrder([a], [{ tabId: 'a' }])).toBe(false);
  });
});
