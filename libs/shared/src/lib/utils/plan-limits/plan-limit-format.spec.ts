import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { PlanLimitWindow } from '../../types/plan-limit.types';
import {
  formatLocalAbsolute,
  formatLocalWithRelative,
  formatRelative,
  formatSourceChips,
  formatToolInstant,
  formatToolResetText,
  formatToolSourceText,
  formatToolUtc,
  formatUsed,
  PLAN_LIMIT_SOURCE_LABELS,
  windowFieldSources,
} from './plan-limit-format';

/** Sunday 4 Oct 2026, 12:00 UTC (14:00 CEST, 08:00 EDT). */
const at = (day: number, hour: number, minute = 0): number =>
  Date.UTC(2026, 9, day, hour, minute);
const NOW = at(4, 12);
const MINUTE = 60_000;
const BERLIN = { timeZone: 'Europe/Berlin', zoneNameLocale: 'en-GB' };

const win = (overrides: Partial<PlanLimitWindow> = {}): PlanLimitWindow => ({
  key: 'five_hour',
  kind: 'five_hour',
  label: '5-hour',
  used: { kind: 'percent', percent: 94 },
  usedSource: 'provider-api',
  resetsAt: at(4, 15, 10),
  resetSource: 'provider-api',
  lastResetAt: at(4, 10, 10),
  observedAt: NOW - 2 * MINUTE,
  ...overrides,
});

describe('formatRelative', () => {
  it.each([
    [NOW + (3 * 60 + 10) * MINUTE, 'in 3h 10m'],
    [NOW - 22 * MINUTE, '22m ago'],
    [NOW + 45 * 60 * MINUTE, 'in 1d 21h'],
    [NOW + 5 * 60 * MINUTE, 'in 5h 0m'],
    [NOW - 40 * MINUTE, '40m ago'],
    [NOW, 'in 0m'],
    [NOW + 29_000, 'in 0m'],
    [NOW + 31_000, 'in 1m'],
  ])('%p → %s', (instant, expected) => {
    expect(formatRelative(instant, NOW)).toBe(expected);
  });

  it('renders a non-finite instant as unknown', () => {
    expect(formatRelative(Number.NaN, NOW)).toBe('unknown');
    expect(formatRelative(NOW, Number.POSITIVE_INFINITY)).toBe('unknown');
  });
});

describe('formatLocalAbsolute (T1: local zone with abbreviation)', () => {
  it('uses "today" on the same local calendar day', () => {
    expect(formatLocalAbsolute(at(4, 13, 10), NOW, BERLIN)).toBe(
      'today 15:10 CEST',
    );
  });

  it('uses weekday, day and month on another day', () => {
    expect(formatLocalAbsolute(at(8, 7), NOW, BERLIN)).toBe(
      'Thu 8 Oct 09:00 CEST',
    );
  });

  it('"today" follows the local midnight, not UTC', () => {
    const lateEvening = at(4, 21, 50); // 23:50 CEST
    const afterMidnight = at(4, 22, 10); // 00:10 CEST on Monday
    expect(formatLocalAbsolute(afterMidnight, lateEvening, BERLIN)).toBe(
      'Mon 5 Oct 00:10 CEST',
    );
    expect(
      formatLocalAbsolute(afterMidnight, lateEvening, { timeZone: 'UTC' }),
    ).toMatch(/^today 22:10 /);
  });

  it('uses the offset in force on that date across a DST change', () => {
    expect(formatLocalAbsolute(at(26, 8), NOW, BERLIN)).toBe(
      'Mon 26 Oct 09:00 CET',
    );
  });

  it('takes the zone abbreviation from the requested locale', () => {
    expect(
      formatLocalAbsolute(at(4, 13, 10), NOW, {
        timeZone: 'America/New_York',
        zoneNameLocale: 'en-US',
      }),
    ).toBe('today 09:10 EDT');
  });

  it('renders midnight as 00, not 24', () => {
    expect(
      formatLocalAbsolute(at(5, 0, 5), NOW, {
        timeZone: 'UTC',
        zoneNameLocale: 'en-GB',
      }),
    ).toBe('Mon 5 Oct 00:05 UTC');
  });

  it('falls back to UTC for an unknown zone instead of throwing', () => {
    expect(
      formatLocalAbsolute(at(4, 13, 10), NOW, {
        timeZone: 'Not/AZone',
        zoneNameLocale: 'en-GB',
      }),
    ).toBe('today 13:10 UTC');
  });

  it('renders a non-finite instant as unknown', () => {
    expect(formatLocalAbsolute(Number.NaN, NOW, BERLIN)).toBe('unknown');
  });

  it('pairs absolute and relative time', () => {
    expect(formatLocalWithRelative(at(4, 13, 10), NOW, BERLIN)).toBe(
      'today 15:10 CEST · in 1h 10m',
    );
    expect(formatLocalWithRelative(Number.NaN, NOW, BERLIN)).toBe('unknown');
  });
});

describe('tool UTC times', () => {
  it('formats YYYY-MM-DD HH:MM UTC', () => {
    expect(formatToolUtc(at(3, 15, 10))).toBe('2026-10-03 15:10 UTC');
    expect(formatToolUtc(Number.NaN)).toBe('unknown');
  });

  it('appends the relative time', () => {
    expect(formatToolInstant(at(4, 15, 10), NOW)).toBe(
      '2026-10-04 15:10 UTC (in 3h 10m)',
    );
    expect(formatToolInstant(at(5, 9), NOW)).toBe(
      '2026-10-05 09:00 UTC (in 21h 0m)',
    );
    expect(formatToolInstant(Number.NaN, NOW)).toBe('unknown');
  });
});

describe('source labels (T2: short)', () => {
  it('maps every source to its short label', () => {
    expect(PLAN_LIMIT_SOURCE_LABELS).toEqual({
      'provider-api': 'Provider API',
      'provider-unofficial': 'Unofficial',
      'stream-event': 'Live event',
      'error-derived': 'From error',
      estimated: '~ Estimate',
    });
  });

  it('one shared source gives one chip with no field prefix', () => {
    expect(formatSourceChips(win())).toEqual(['Provider API']);
    expect(formatToolSourceText(win())).toBe('provider-api');
  });

  it('F2: API used beside an estimated reset keeps a source per field', () => {
    const window = win({
      usedSource: 'provider-unofficial',
      resetSource: 'estimated',
    });
    expect(windowFieldSources(window)).toEqual([
      { source: 'provider-unofficial', fields: ['used'] },
      { source: 'estimated', fields: ['reset'] },
    ]);
    expect(formatSourceChips(window)).toEqual([
      'used Unofficial',
      'reset ~ Estimate',
    ]);
    expect(formatToolSourceText(window)).toBe(
      'used provider-unofficial; reset estimated',
    );

    const apiUsed = win({ resetSource: 'estimated' });
    expect(formatToolSourceText(apiUsed)).toBe(
      'used provider-api; reset estimated',
    );
  });

  it('groups used and reset against a limit from an error', () => {
    const window = win({
      exhaustion: { observedAt: NOW - MINUTE, source: 'error-derived' },
    });
    expect(formatSourceChips(window)).toEqual([
      'used · reset Provider API',
      'limit From error',
    ]);
    expect(formatToolSourceText(window)).toBe(
      'used+reset provider-api; limit error-derived',
    );
  });

  it('F3: an unknown used value claims no source', () => {
    const window = win({ used: undefined, resetsAt: undefined });
    expect(windowFieldSources(window)).toEqual([]);
    expect(formatSourceChips(window)).toEqual([]);
    expect(formatToolSourceText(window)).toBe('-');
  });
});

describe('formatUsed', () => {
  it('F3: unknown is "unknown", never 0', () => {
    expect(formatUsed(undefined)).toBe('unknown');
    expect(formatUsed({ kind: 'percent', percent: Number.NaN })).toBe(
      'unknown',
    );
    expect(
      formatUsed({ kind: 'amount', amount: Number.NaN, limit: 5, unit: 'USD' }),
    ).toBe('unknown');
  });

  it('formats percent and amounts', () => {
    expect(formatUsed({ kind: 'percent', percent: 94.4 })).toBe('94%');
    expect(formatUsed({ kind: 'percent', percent: 0 })).toBe('0%');
    expect(
      formatUsed({ kind: 'amount', amount: 3.2, limit: 50, unit: 'USD' }),
    ).toBe('$3.20 of $50.00');
    expect(
      formatUsed({ kind: 'amount', amount: 120, limit: 500, unit: 'requests' }),
    ).toBe('120 of 500 requests');
    expect(
      formatUsed({ kind: 'amount', amount: 1.5, limit: 10, unit: 'credits' }),
    ).toBe('1.50 of 10 credits');
  });
});

describe('formatToolResetText', () => {
  it('a known future reset', () => {
    expect(formatToolResetText(win(), NOW)).toBe(
      'resets 2026-10-04 15:10 UTC (in 3h 10m)',
    );
  });

  it('an unknown reset', () => {
    expect(formatToolResetText(win({ resetsAt: undefined }), NOW)).toBe(
      'reset unknown',
    );
  });

  it('falls back to the exhaustion reset when the window states none', () => {
    const window = win({
      resetsAt: undefined,
      exhaustion: {
        observedAt: NOW - MINUTE,
        source: 'error-derived',
        resetsAt: at(4, 17, 5),
      },
    });
    expect(formatToolResetText(window, NOW)).toBe(
      'resets 2026-10-04 17:05 UTC (in 5h 5m)',
    );
  });

  it('F4: reset passed with no newer observation, next reset unknown', () => {
    const window = win({ resetsAt: at(4, 11, 20), observedAt: at(4, 10, 52) });
    expect(formatToolResetText(window, NOW)).toBe(
      'reset passed 2026-10-04 11:20 UTC (40m ago); next reset unknown; ' +
        'last observed 2026-10-04 10:52 UTC, before it',
    );
  });

  it('a known last reset after the observation, with the next reset', () => {
    const window = win({
      lastResetAt: at(4, 11, 40),
      resetsAt: at(4, 16, 40),
      observedAt: at(4, 11, 38),
    });
    expect(formatToolResetText(window, NOW)).toBe(
      'reset passed 2026-10-04 11:40 UTC (20m ago); ' +
        'next reset 2026-10-04 16:40 UTC (in 4h 40m); ' +
        'last observed 2026-10-04 11:38 UTC, before it',
    );
  });

  it('a passed reset observed after it', () => {
    const window = win({
      resetsAt: at(4, 11, 20),
      observedAt: at(4, 11, 50),
      lastResetAt: at(4, 11, 20),
    });
    expect(formatToolResetText(window, NOW)).toBe(
      'reset passed 2026-10-04 11:20 UTC (40m ago)',
    );
  });
});

describe('tool-facing static text', () => {
  it('names no provider brand', () => {
    const source = readFileSync(
      join(__dirname, 'plan-limit-format.ts'),
      'utf8',
    );
    expect(source).not.toMatch(
      /claude|anthropic|codex|openai|gemini|antigravity|ollama|opencode|glm/i,
    );
  });
});
