import {
  formatRunStarted,
  laneRunColumns,
  runStatusBadge,
  subgroupFootnote,
} from './lane-detail';
import type {
  LaneRunRowModel,
  StatsLimitLaneRun,
} from './stats-limit-view-model.types';

const AT = Date.UTC(2026, 8, 7, 9, 5);

function row(overrides: Partial<LaneRunRowModel> = {}): LaneRunRowModel {
  return {
    runId: 'r',
    index: 1,
    model: null,
    tokensText: '—',
    costText: '—',
    status: { tone: 'neutral', text: 'Completed' },
    ...overrides,
  };
}

function run(overrides: Partial<StatsLimitLaneRun> = {}): StatsLimitLaneRun {
  return {
    runId: 'r',
    cli: 'codex',
    cliLabel: 'Codex',
    status: 'completed',
    restored: false,
    startedAt: AT,
    ...overrides,
  };
}

describe('lane detail helpers', () => {
  describe('formatRunStarted', () => {
    it('gives a short d MMM HH:mm cell and the full timestamp for its title', () => {
      expect(
        formatRunStarted(AT, { timeZone: 'UTC', zoneNameLocale: 'en-GB' }),
      ).toEqual({ short: '7 Sep 09:05', full: 'Mon 7 Sep 2026 09:05 UTC' });
    });

    it('renders in the given zone', () => {
      expect(
        formatRunStarted(AT, { timeZone: 'Asia/Tokyo', zoneNameLocale: 'en-US' })
          ?.short,
      ).toBe('7 Sep 18:05');
    });

    it('falls back to UTC for an unknown zone and is undefined for an invalid instant', () => {
      expect(formatRunStarted(AT, { timeZone: 'Not/AZone' })?.short).toBe(
        '7 Sep 09:05',
      );
      expect(formatRunStarted(Number.NaN, { timeZone: 'UTC' })).toBeUndefined();
    });
  });

  describe('runStatusBadge', () => {
    it.each([
      [run({ status: 'running' }), 'live', 'Running'],
      [run({ status: 'completed', restored: true }), 'neutral', 'Completed'],
      [run({ status: 'timeout' }), 'error', 'Timed out'],
      [run({ status: 'failed', failureKind: 'quota' }), 'error', 'Quota failure'],
    ] as const)('%#: one badge word, no sentence', (input, tone, text) => {
      expect(runStatusBadge(input)).toEqual({ tone, text });
    });
  });

  describe('laneRunColumns', () => {
    it('drops a column whose every value is unknown', () => {
      expect(laneRunColumns([row(), row({ runId: 's' })], '—')).toEqual({
        model: false,
        tokens: false,
        cost: false,
        started: false,
      });
    });

    it('keeps a column when one run knows it', () => {
      expect(
        laneRunColumns(
          [
            row({ model: 'gpt-5', tokensText: '1.2k' }),
            row({ costText: '$0.10', started: { short: 's', full: 'f' } }),
          ],
          '—',
        ),
      ).toEqual({ model: true, tokens: true, cost: true, started: true });
    });
  });

  describe('subgroupFootnote', () => {
    it('joins owner text and notes once each, without the omitted limit state', () => {
      expect(
        subgroupFootnote(
          'Limit unavailable · owner not recorded',
          [
            { tone: 'neutral', text: 'Limit unavailable' },
            { tone: 'info', text: 'owner not recorded · Cooldown active' },
          ],
          'Limit unavailable',
        ),
      ).toBe('owner not recorded · Cooldown active');
    });

    it('is empty when nothing is left to explain', () => {
      expect(subgroupFootnote('Limit unavailable', [], 'Limit unavailable')).toBe('');
    });
  });
});
