import {
  planSectionProvenance,
  sameSources,
  sharedLaneCaption,
} from './stats-limit-sections';
import {
  LANE_CAPTION,
  LANES_SUBTOTAL_TILE_ID,
  type LaneSubtotalTileModel,
  type LaneUsageTileModel,
  type PlanLimitTileModel,
} from './stats-limit-view-model.types';

function planTile(
  id: string,
  overrides: Partial<PlanLimitTileModel> = {},
): PlanLimitTileModel {
  return {
    id,
    kind: 'window',
    label: id,
    captionLead: 'Claude account',
    captionTail: '· a1b2',
    caption: 'Claude account · a1b2',
    value: '40% used',
    resetLine: 'resets 15:10',
    tone: 'neutral',
    sourceChips: ['Provider API'],
    detailLines: [],
    ...overrides,
  };
}

function laneTile(caption = LANE_CAPTION): LaneUsageTileModel {
  return {
    id: 'lane:codex:review',
    label: 'Codex · review',
    caption,
    tokensText: 'unknown tokens',
    costLine: 'cost unknown',
    runChip: { tone: 'neutral', text: 'Done' },
    limitChips: [],
    tone: 'neutral',
    runCount: 1,
    subgroups: [],
  };
}

const SUBTOTAL: LaneSubtotalTileModel = {
  id: LANES_SUBTOTAL_TILE_ID,
  caption: LANE_CAPTION,
  tokensText: '0 tokens known',
  summary: '$0.00 known cost · 1 lane · 1 run · 1 cost unknown',
};

describe('planSectionProvenance', () => {
  it('lifts a caption every row shares, with its lead and tail', () => {
    const result = planSectionProvenance([planTile('a'), planTile('b')]);

    expect(result.caption).toEqual({
      caption: 'Claude account · a1b2',
      captionLead: 'Claude account',
      captionTail: '· a1b2',
    });
  });

  it('keeps captions on the rows when they differ', () => {
    const result = planSectionProvenance([
      planTile('a'),
      planTile('b', { caption: 'unknown account', captionLead: 'unknown account' }),
    ]);

    expect(result.caption).toBeNull();
  });

  it('lifts the source list most rows carry; a differing row keeps its own', () => {
    const result = planSectionProvenance([
      planTile('five'),
      planTile('weekly'),
      planTile('cooldown', { sourceChips: ['From error'] }),
      planTile('status', { sourceChips: [] }),
    ]);

    expect(result.sourceChips).toEqual(['Provider API']);
  });

  it('lifts no sources when no list is carried by two rows', () => {
    const result = planSectionProvenance([
      planTile('a', { sourceChips: ['Provider API'] }),
      planTile('b', { sourceChips: ['From error'] }),
    ]);

    expect(result.sourceChips).toEqual([]);
  });

  it('lifts the sources of a single-row section', () => {
    expect(planSectionProvenance([planTile('a')]).sourceChips).toEqual([
      'Provider API',
    ]);
  });

  it('has nothing to lift without rows', () => {
    expect(planSectionProvenance([])).toEqual({
      caption: null,
      sourceChips: [],
    });
  });
});

describe('sharedLaneCaption', () => {
  it('returns the caption every lane row and the subtotal share', () => {
    expect(sharedLaneCaption([laneTile(), laneTile()], SUBTOTAL)).toBe(
      LANE_CAPTION,
    );
  });

  it('returns null when any caption differs, or there are no rows', () => {
    expect(sharedLaneCaption([laneTile(), laneTile('other')], SUBTOTAL)).toBe(
      null,
    );
    expect(sharedLaneCaption([], undefined)).toBeNull();
  });
});

describe('sameSources', () => {
  it('compares lists by value and order', () => {
    expect(sameSources(['a', 'b'], ['a', 'b'])).toBe(true);
    expect(sameSources(['a', 'b'], ['b', 'a'])).toBe(false);
    expect(sameSources([], [])).toBe(true);
  });
});
