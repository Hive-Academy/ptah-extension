import type { PlanRingData } from '@ptah-extension/chat-ui';
import type { ActivityVitals, SpendVitals } from './usage-vitals.view';
import {
  VITALS_EMPTY,
  VITALS_ERROR,
  VITALS_LOADING,
  vitalsReady,
} from './vitals-load';
import {
  DAY_ONE_CAPTION,
  ageLabel,
  parentPath,
  toCountCell,
  toGridView,
  toPlanCell,
  toRecentItems,
  toSpendCell,
} from './welcome-vitals.view';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const NOW = Date.UTC(2026, 9, 26, 12);

const ACTIVITY: ActivityVitals = {
  activity: {
    metric: 'requests',
    today: '2026-10-26',
    days: [{ date: '2026-10-25', value: 4 }],
  },
  totals: { tokens: 10, costUsd: 1 },
  sessionCount: 108,
};

describe('welcome-vitals.view', () => {
  describe('ageLabel', () => {
    it.each([
      [0, 'now'],
      [59_000, 'now'],
      [5 * MINUTE, '5m'],
      [3 * HOUR, '3h'],
      [2 * DAY, '2d'],
      [21 * DAY, '3w'],
      [150 * DAY, '5mo'],
      [800 * DAY, '2y'],
    ])('%d ms ago reads %s', (ago, label) => {
      expect(ageLabel(NOW - ago, NOW)).toBe(label);
    });

    it('reads a future timestamp as now', () => {
      expect(ageLabel(NOW + DAY, NOW)).toBe('now');
    });
  });

  describe('parentPath', () => {
    it.each([
      ['D:\\projects\\ptah', 'D:\\projects'],
      ['D:\\projects\\ptah\\', 'D:\\projects'],
      ['D:\\ptah', 'D:\\'],
      ['/home/me/work/billing', '/home/me/work'],
      ['/work', '/'],
      ['ptah', ''],
    ])('%s is in %s', (path, parent) => {
      expect(parentPath(path)).toBe(parent);
    });
  });

  describe('toRecentItems', () => {
    it('formats ready rows with parent and age', () => {
      const rows = toRecentItems(
        vitalsReady([
          { path: 'D:\\projects\\ptah', name: 'ptah', lastOpenedAt: NOW - 2 * DAY },
        ]),
        NOW,
      );
      expect(rows).toEqual([
        {
          path: 'D:\\projects\\ptah',
          name: 'ptah',
          parent: 'D:\\projects',
          ageLabel: '2d',
        },
      ]);
    });

    it.each([VITALS_LOADING, VITALS_EMPTY, VITALS_ERROR])(
      'has no rows unless ready (%o)',
      (load) => {
        expect(toRecentItems(load, NOW)).toEqual([]);
      },
    );
  });

  describe('toCountCell', () => {
    it('shows a ready count', () => {
      expect(toCountCell(vitalsReady(6))).toEqual({ state: 'ready', text: '6' });
    });

    it('shows a non-finite count as unavailable', () => {
      expect(toCountCell(vitalsReady(Number.NaN)).state).toBe('error');
    });

    it('passes loading, empty and error through', () => {
      expect(toCountCell(VITALS_LOADING).state).toBe('loading');
      expect(toCountCell(VITALS_EMPTY).state).toBe('empty');
      expect(toCountCell(VITALS_ERROR).state).toBe('error');
    });
  });

  describe('toPlanCell', () => {
    const ring: PlanRingData = {
      percent: 38,
      label: '5h window',
      resetsInMs: 134 * MINUTE,
    };

    it('captions a ready ring with its reset time', () => {
      expect(toPlanCell(vitalsReady(ring))).toEqual({
        state: 'ready',
        ring,
        caption: '5h window · resets in 2h 14m',
      });
    });

    it('has no caption while loading and a fixed one when empty', () => {
      expect(toPlanCell(VITALS_LOADING).caption).toBeNull();
      expect(toPlanCell(VITALS_EMPTY)).toEqual({
        state: 'empty',
        ring: null,
        caption: 'no plan window',
      });
    });
  });

  describe('toSpendCell', () => {
    it('formats a priced week', () => {
      const spend: SpendVitals = {
        days: [1, null, 2],
        totals: { tokens: 1, costUsd: 12.4 },
      };
      expect(toSpendCell(vitalsReady(spend))).toEqual({
        state: 'ready',
        text: '$12.40',
        bars: [1, null, 2],
      });
    });

    it('shows an unpriced week as a dash', () => {
      const spend: SpendVitals = {
        days: [null],
        totals: { tokens: 1, costUsd: null },
      };
      expect(toSpendCell(vitalsReady(spend)).state).toBe('empty');
    });

    it('shows no spend as $0.00 with seven flat bars', () => {
      expect(toSpendCell(VITALS_EMPTY)).toEqual({
        state: 'ready',
        text: '$0.00',
        bars: [0, 0, 0, 0, 0, 0, 0],
      });
    });

    it('passes loading and error through', () => {
      expect(toSpendCell(VITALS_LOADING).state).toBe('loading');
      expect(toSpendCell(VITALS_ERROR).state).toBe('error');
    });
  });

  describe('toGridView', () => {
    it('draws the Day 1 field on a first run, whatever the activity load', () => {
      const view = toGridView(true, vitalsReady(ACTIVITY), '2026-10-26');
      expect(view.mode).toBe('day-one');
      expect(view.caption).toBe(DAY_ONE_CAPTION);
      expect(view.days).toEqual([]);
    });

    it('draws the 90-day history with a session caption', () => {
      const view = toGridView(false, vitalsReady(ACTIVITY), '2026-10-27');
      expect(view).toMatchObject({
        mode: 'history',
        today: '2026-10-26',
        caption: '108 sessions · 90 days',
        busy: false,
        label: 'Activity: 108 sessions · 90 days',
      });
    });

    it('uses the singular and drops an unknown session count', () => {
      const one = { ...ACTIVITY, sessionCount: 1 };
      const unknown = { ...ACTIVITY, sessionCount: null };
      expect(toGridView(false, vitalsReady(one), 'x').caption).toBe(
        '1 session · 90 days',
      );
      expect(toGridView(false, vitalsReady(unknown), 'x').caption).toBe(
        '90 days',
      );
    });

    it('draws the Day 1 field when there is no usage', () => {
      expect(toGridView(false, VITALS_EMPTY, '2026-10-26')).toEqual(
        toGridView(true, VITALS_LOADING, '2026-10-26'),
      );
    });

    it('is busy while loading and captioned when unavailable', () => {
      expect(toGridView(false, VITALS_LOADING, '2026-10-26')).toMatchObject({
        busy: true,
        caption: null,
        label: 'Activity, loading',
      });
      expect(toGridView(false, VITALS_ERROR, '2026-10-26')).toMatchObject({
        busy: false,
        caption: 'Activity unavailable',
      });
    });
  });
});
