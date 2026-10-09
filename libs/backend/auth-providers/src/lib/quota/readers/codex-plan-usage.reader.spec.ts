import 'reflect-metadata';
import type { CodexAccountUsageResult } from '../../providers/codex/codex-provider.types';
import {
  accountOwnerKey,
  quotaOwnerRefFromKey,
} from '../provider-owner.resolver';
import {
  createCodexPlanUsageReader,
  mapCodexAccountUsage,
} from './codex-plan-usage.reader';
import type { PlanOwnerTarget } from './plan-usage-reader.types';

const NOW = Date.UTC(2026, 9, 4, 12, 0, 0);
const FETCHED = NOW - 5_000;
const RESET_SECONDS = Math.floor(Date.UTC(2026, 9, 4, 17, 0, 0) / 1000);

const TARGET: PlanOwnerTarget = {
  providerId: 'openai-codex',
  ownerRef: quotaOwnerRefFromKey(accountOwnerKey('openai-codex', 'home\0a@x')),
};

function result(
  overrides: Partial<CodexAccountUsageResult> = {},
): CodexAccountUsageResult {
  return {
    status: 'available',
    providerId: 'openai-codex',
    fetchedAt: FETCHED,
    account: { planType: 'plus' },
    quota: {
      primary: {
        usedPercent: 37,
        windowDurationMins: 300,
        resetsAt: RESET_SECONDS,
      },
      secondary: { usedPercent: 4, windowDurationMins: 10_080, resetsAt: null },
    },
    activity: {
      lifetimeTokens: '123456789012345678',
      dailyUsage: [{ startDate: '2026-10-03', tokens: '42' }],
    },
    ...overrides,
  };
}

describe('Codex plan-usage reader', () => {
  it('F29: kinds come from the duration; primary/secondary order and the existing fields are kept (Req 2.10)', async () => {
    const getAccountUsage = jest.fn(async () => result());
    const reader = createCodexPlanUsageReader({ getAccountUsage }, () => NOW);
    const signal = new AbortController().signal;

    const reading = await reader({ target: TARGET, refresh: true, signal });

    expect(getAccountUsage).toHaveBeenCalledWith({ refresh: true, signal });
    expect(reading.status).toBe('available');
    expect(reading.windowSetEstablished).toBe(true);
    expect(reading.fetchedAt).toBe(FETCHED);
    expect(reading.account).toEqual({ planType: 'plus' });
    expect(reading.activity).toEqual(result().activity);
    expect(reading.windows).toEqual([
      {
        kind: 'five_hour',
        key: 'five_hour',
        label: '5-hour',
        durationMins: 300,
        used: { kind: 'percent', percent: 37 },
        usedSource: 'provider-api',
        usedObservedAt: FETCHED,
        resetsAt: RESET_SECONDS * 1000,
        resetSource: 'provider-api',
        observedAt: FETCHED,
      },
      {
        kind: 'weekly',
        key: 'weekly',
        label: 'Weekly',
        durationMins: 10_080,
        used: { kind: 'percent', percent: 4 },
        usedSource: 'provider-api',
        usedObservedAt: FETCHED,
        observedAt: FETCHED,
      },
    ]);
  });

  it('labels an unknown duration by position 1 / 2, never by guess', () => {
    const reading = mapCodexAccountUsage(
      result({
        quota: {
          primary: { usedPercent: 10, windowDurationMins: null },
          secondary: { usedPercent: 20, windowDurationMins: 999 },
        },
      }),
      NOW,
    );
    expect(reading.windows.map((w) => [w.key, w.label, w.kind])).toEqual([
      ['other:window-1', 'Window 1', 'other'],
      ['other:window-2', 'Window 2', 'other'],
    ]);
    expect(reading.windows[0].durationMins).toBeUndefined();
    expect(reading.windows[1].durationMins).toBe(999);
  });

  it('a secondary-only answer is still position 2', () => {
    const reading = mapCodexAccountUsage(
      result({ quota: { secondary: { usedPercent: 5 } } }),
      NOW,
    );
    expect(reading.windows.map((w) => w.key)).toEqual(['other:window-2']);
  });

  it('a stale answer keeps the original fetch time on every window', () => {
    const reading = mapCodexAccountUsage(
      result({ status: 'stale', staleSince: NOW }),
      NOW,
    );
    expect(reading.status).toBe('stale');
    expect(reading.fetchedAt).toBe(FETCHED);
    expect(reading.windows.every((w) => w.observedAt === FETCHED)).toBe(true);
  });

  describe('rateLimitReachedType as window evidence (Component 7)', () => {
    const limited = (
      primary: number,
      secondary: number,
      rateLimitReachedType?: string,
    ) =>
      result({
        quota: {
          primary: { usedPercent: primary, windowDurationMins: 300 },
          secondary: { usedPercent: secondary, windowDurationMins: 10_080 },
          ...(rateLimitReachedType !== undefined && { rateLimitReachedType }),
        },
      });

    it('marks the window at or over 100% exhausted from the provider api', () => {
      const reading = mapCodexAccountUsage(
        limited(100, 40, 'rate_limit_reached'),
        NOW,
      );
      expect(reading.windows[0].exhaustion).toEqual({
        observedAt: FETCHED,
        source: 'provider-api',
      });
      expect(reading.windows[1].exhaustion).toBeUndefined();
    });

    it('marks every window at the limit when both are', () => {
      const reading = mapCodexAccountUsage(
        limited(100, 103, 'workspace_member_usage_limit_reached'),
        NOW,
      );
      expect(reading.windows.map((w) => w.exhaustion?.source)).toEqual([
        'provider-api',
        'provider-api',
      ]);
    });

    it('marks nothing when no window can be matched', () => {
      const reading = mapCodexAccountUsage(
        limited(60, 70, 'workspace_owner_credits_depleted'),
        NOW,
      );
      expect(reading.windows.some((w) => w.exhaustion)).toBe(false);
    });

    it('a window at 100% without a reached type is a reading, not exhaustion', () => {
      const reading = mapCodexAccountUsage(limited(100, 4), NOW);
      expect(reading.windows.some((w) => w.exhaustion)).toBe(false);
    });

    it('a stale answer keeps the original fetch time on the exhaustion', () => {
      const reading = mapCodexAccountUsage(
        { ...limited(100, 4, 'rate_limit_reached'), status: 'stale' },
        NOW,
      );
      expect(reading.windows[0].exhaustion?.observedAt).toBe(FETCHED);
    });
  });

  it.each([
    'unsupported-auth',
    'unsupported-config',
    'cli-unavailable',
    'cli-version-unsupported',
    'service-unavailable',
  ] as const)('passes %s through with no windows', (status) => {
    expect(
      mapCodexAccountUsage({ status, providerId: 'openai-codex' }, NOW),
    ).toEqual({ status, windowSetEstablished: false, windows: [] });
  });
});
