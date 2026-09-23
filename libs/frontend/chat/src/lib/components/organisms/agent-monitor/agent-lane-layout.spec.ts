import {
  defaultLaneIds,
  laneColumnCount,
  normaliseLaneFractions,
  pickLane,
  reconcileLanes,
  resizeLanePair,
} from './agent-lane-layout';

describe('agent lane layout', () => {
  it.each([
    [299, 4, 0],
    [599, 4, 1],
    [600, 4, 2],
    [899, 4, 2],
    [900, 4, 3],
    [1500, 4, 3],
    [900, 1, 1],
    [900, 0, 0],
  ])('counts columns at width %i with %i agents', (width, agents, expected) => {
    expect(laneColumnCount(width, agents)).toBe(expected);
  });

  it('defaults to running agents first, newest first within each status bucket', () => {
    expect(
      defaultLaneIds(
        [
          { agentId: 'done-new', status: 'completed', startedAt: 100 },
          { agentId: 'run-old', status: 'running', startedAt: 1 },
          { agentId: 'done-old', status: 'failed', startedAt: 2 },
          { agentId: 'run-new', status: 'running', startedAt: 10 },
        ],
        3,
      ),
    ).toEqual(['run-new', 'run-old', 'done-new']);
  });

  describe('stable reconciliation', () => {
    const candidate = (agentId: string, status = 'running', startedAt = 1) => ({
      agentId,
      status,
      startedAt,
    });
    const previous = { ids: ['a', 'b'], recent: ['b', 'a'] };
    const options = {
      capacity: 2,
      fillCount: 2,
      autoPick: true,
      newRunningIds: new Set<string>(),
      dismissed: new Set<string>(),
    };

    it('does not swap columns when a shown agent completes or chunks re-emit', () => {
      const agents = [
        candidate('a', 'completed', 3),
        candidate('b', 'running', 2),
      ];
      const next = reconcileLanes(previous, agents, options);
      expect(next.ids).toEqual(['a', 'b']);
      expect(reconcileLanes(next, [...agents], options)).toEqual(next);
    });

    it('replaces the least recently shown finished column in place for new running work', () => {
      const next = reconcileLanes(
        previous,
        [
          candidate('a', 'completed'),
          candidate('b', 'failed'),
          candidate('new', 'running', 3),
        ],
        {
          ...options,
          newRunningIds: new Set(['new']),
        },
      );
      expect(next.ids).toEqual(['new', 'b']);
      expect(next.recent).toEqual(['new', 'b']);
    });

    it('never displaces a running column, even when it is the oldest shown', () => {
      const next = reconcileLanes(
        previous,
        [
          candidate('a'),
          candidate('b', 'completed'),
          candidate('new', 'running', 3),
        ],
        {
          ...options,
          newRunningIds: new Set(['new']),
        },
      );
      expect(next.ids).toEqual(['a', 'new']);
      expect(
        reconcileLanes(
          previous,
          [candidate('a'), candidate('b'), candidate('new', 'running', 3)],
          {
            ...options,
            newRunningIds: new Set(['new']),
          },
        ).ids,
      ).toEqual(['a', 'b']);
    });

    it('fills only empty slots from default order while retaining valid positions', () => {
      const next = reconcileLanes(
        previous,
        [
          candidate('b'),
          candidate('new', 'running', 3),
          candidate('done', 'completed', 4),
        ],
        options,
      );
      expect(next.ids).toEqual(['b', 'new']);
    });

    it('does not promote an already running hidden agent on a completion update', () => {
      expect(
        reconcileLanes(
          previous,
          [
            candidate('a', 'completed'),
            candidate('b'),
            candidate('hidden', 'running', 3),
          ],
          options,
        ).ids,
      ).toEqual(['a', 'b']);
    });

    it('preserves manual picks and removals when new work arrives', () => {
      expect(
        reconcileLanes(
          previous,
          [
            candidate('a', 'completed'),
            candidate('b'),
            candidate('new', 'running', 3),
          ],
          {
            ...options,
            autoPick: false,
            newRunningIds: new Set(['new']),
          },
        ).ids,
      ).toEqual(['a', 'b']);
      expect(
        reconcileLanes(
          { ids: ['a'], recent: ['a'] },
          [candidate('a'), candidate('b')],
          {
            ...options,
            autoPick: false,
            fillCount: 1,
            dismissed: new Set(['b']),
          },
        ).ids,
      ).toEqual(['a']);
    });
  });

  it('adds a pick in spare capacity and replaces the least recently picked when full', () => {
    const first = pickLane(['a'], ['a'], 'b', 2);
    expect(first.ids).toEqual(['a', 'b']);
    const focus = pickLane(first.ids, first.recent, 'a', 2);
    expect(focus.ids).toEqual(['a', 'b']);
    expect(pickLane(focus.ids, focus.recent, 'c', 2).ids).toEqual(['a', 'c']);
  });

  it('normalises ratios and clamps narrow columns without disturbing other proportions', () => {
    expect(normaliseLaneFractions([2, 1], 900)).toEqual([2 / 3, 1 / 3]);
    const result = normaliseLaneFractions([0.01, 0.49, 0.5], 900);
    expect(result[0]).toBeCloseTo(240 / 900);
    expect(result.reduce((sum, value) => sum + value, 0)).toBeCloseTo(1);
    expect(result[1] / result[2]).toBeCloseTo(0.49 / 0.5);
  });

  it('renormalises removed columns, invalid ratios, and widths too small for the minimum', () => {
    expect(normaliseLaneFractions([0.2, 0.3], 600)).toEqual([0.4, 0.6]);
    expect(normaliseLaneFractions([0, NaN], 600)).toEqual([0.5, 0.5]);
    expect(normaliseLaneFractions([1, 8], 300)).toEqual([0.5, 0.5]);
    expect(normaliseLaneFractions([], 600)).toEqual([]);
  });

  it('resizes only the adjacent pair and enforces both minimums', () => {
    const left = resizeLanePair([1 / 3, 1 / 3, 1 / 3], 0, 10, 900);
    expect(left[0] * 900).toBeCloseTo(240);
    expect(left[1] * 900).toBeCloseTo(360);
    expect(left[2]).toBeCloseTo(1 / 3);
    const right = resizeLanePair(left, 0, 1000, 900);
    expect(right[0] * 900).toBeCloseTo(360);
    expect(right[1] * 900).toBeCloseTo(240);
  });
});
