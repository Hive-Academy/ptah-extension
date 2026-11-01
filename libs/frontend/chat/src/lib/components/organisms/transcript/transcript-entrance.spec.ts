import { ENTRANCE_CAP, isStrictHeadPrepend, isTailSwap, planEntrance } from './transcript-entrance';

const defaults = {
  previousIds: [] as readonly string[],
  nextIds: [] as readonly string[],
  suppressed: false,
  replaying: false,
  pinned: true,
  cap: ENTRANCE_CAP,
};

function planned(overrides: Partial<typeof defaults> = {}): [string, number][] {
  return Array.from(planEntrance({ ...defaults, ...overrides }));
}

describe('planEntrance', () => {
  it('stagger indexes only the last six rows of a twenty-message open batch', () => {
    const ids = Array.from({ length: 20 }, (_, index) => `m${index}`);
    expect(planned({ nextIds: ids })).toEqual([
      ['m14', 0], ['m15', 1], ['m16', 2],
      ['m17', 3], ['m18', 4], ['m19', 5],
    ]);
  });

  it('indexes a single pinned append at zero', () => {
    expect(planned({ previousIds: ['a'], nextIds: ['a', 'b'] })).toEqual([['b', 0]]);
  });

  it('ignores a streaming update with the same ids', () => {
    expect(planned({ previousIds: ['a', 'b'], nextIds: ['a', 'b'] })).toEqual([]);
  });

  it('does not re-enter a finalized tail that replaces streaming ids', () => {
    expect(isTailSwap(['user', 'stream'], ['user', 'final'])).toBe(true);
    expect(planned({ previousIds: ['user', 'stream'], nextIds: ['user', 'final'] }))
      .toEqual([]);
    expect(isTailSwap(['user', 'stream'], ['user'])).toBe(false);
    expect(isTailSwap(['user'], ['user', 'reply'])).toBe(false);
    expect(isTailSwap(['old'], ['new'])).toBe(false);
  });

  it('ignores a strict older-history prepend', () => {
    expect(planned({ previousIds: ['a', 'b'], nextIds: ['older', 'a', 'b'] })).toEqual([]);
  });

  it('ignores an append below the viewport when unpinned', () => {
    expect(planned({ previousIds: ['a'], nextIds: ['a', 'b'], pinned: false })).toEqual([]);
  });

  it('ignores replayed appends after the open batch', () => {
    expect(planned({ previousIds: ['a'], nextIds: ['a', 'b'], replaying: true })).toEqual([]);
  });

  it('staggers the replaying open batch even when unpinned', () => {
    expect(planned({ nextIds: ['a', 'b'], replaying: true, pinned: false }))
      .toEqual([['a', 0], ['b', 1]]);
  });

  it('suppresses a batch during the replay hold', () => {
    expect(planned({ nextIds: ['a', 'b'], suppressed: true, replaying: false }))
      .toEqual([]);
  });

  it('suppresses even a replaying open batch when the pane is switching', () => {
    expect(planned({ nextIds: ['a'], suppressed: true, replaying: true })).toEqual([]);
  });

  it('staggers a replacement batch with no shared ids', () => {
    expect(planned({ previousIds: ['old'], nextIds: ['new-1', 'new-2'], pinned: false }))
      .toEqual([['new-1', 0], ['new-2', 1]]);
  });

  it('uses a custom cap and leaves old tail ids out of the index', () => {
    expect(planned({ previousIds: ['a', 'b'], nextIds: ['a', 'b', 'c'], cap: 2 }))
      .toEqual([['c', 0]]);
  });

  it('returns empty for empty input and a zero cap', () => {
    expect(planned()).toEqual([]);
    expect(planned({ nextIds: ['a'], cap: 0 })).toEqual([]);
  });
});

describe('isStrictHeadPrepend', () => {
  it('accepts a nonempty exact suffix for ids and anchor identities', () => {
    expect(isStrictHeadPrepend(['a', 'b'], ['older', 'a', 'b'])).toBe(true);
    expect(isStrictHeadPrepend([{ id: 'a' }], [{ id: 'older' }, { id: 'a' }]))
      .toBe(true);
  });

  it('rejects empty previous, equal length, and changed suffixes', () => {
    expect(isStrictHeadPrepend([], ['a'])).toBe(false);
    expect(isStrictHeadPrepend(['a'], ['a'])).toBe(false);
    expect(isStrictHeadPrepend(['a', 'b'], ['older', 'a', 'changed'])).toBe(false);
  });
});
