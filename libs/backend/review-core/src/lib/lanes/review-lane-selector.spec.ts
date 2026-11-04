import { ReviewLaneSelector } from './review-lane-selector';

describe('ReviewLaneSelector', () => {
  const selector = new ReviewLaneSelector();
  it('uses only confirmed room and reports missing lenses', () => {
    expect(selector.select(['triage', 'security-privacy'], [
      { id: 'a', family: 'a', limitState: 'unknown' },
      { id: 'b', family: 'b', limitState: 'at-limit' },
    ])).toEqual({ selected: [], unavailable: ['triage', 'security-privacy'] });
  });

  it('prefers another verifier family and falls back when needed', () => {
    expect(selector.select(['verifier'], [{ id: 'a', family: 'a', limitState: 'confirmed-room' }], 'a').selected[0].lane.family).toBe('a');
    expect(selector.select(['verifier'], [{ id: 'a', family: 'a', limitState: 'confirmed-room' }, { id: 'b', family: 'b', limitState: 'confirmed-room' }], 'a').selected[0].lane.family).toBe('b');
    const kinds = Array(7).fill('triage') as 'triage'[];
    const result = selector.select(kinds, [{ id: 'a', family: 'a', limitState: 'confirmed-room' }]);
    expect(result.selected).toHaveLength(6);
    expect(result.unavailable).toHaveLength(1);
  });
});
