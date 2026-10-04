import {
  normaliseInstant,
  parseRetryAfterDeadline,
  resolveClockTimeReset,
  resolveRelativeReset,
  windowKindFromDuration,
} from './instants';

const SECOND = 1_000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** 2026-10-04 15:00:00 UTC, the injected clock for every case below. */
const NOW = Date.UTC(2026, 9, 4, 15, 0, 0);

describe('normaliseInstant', () => {
  it('F1: epoch seconds, epoch milliseconds and ISO-8601 normalise to the same instant', () => {
    const fromSeconds = normaliseInstant(NOW / SECOND);
    const fromMillis = normaliseInstant(NOW);
    const fromIso = normaliseInstant('2026-10-04T15:00:00Z');
    const fromOffsetIso = normaliseInstant('2026-10-04T17:00:00+02:00');

    expect(fromSeconds).toBe(NOW);
    expect(fromMillis).toBe(NOW);
    expect(fromIso).toBe(NOW);
    expect(fromOffsetIso).toBe(NOW);
  });

  it('reads numeric strings by the same seconds/milliseconds threshold', () => {
    expect(normaliseInstant(String(NOW / SECOND))).toBe(NOW);
    expect(normaliseInstant(` ${NOW} `)).toBe(NOW);
    expect(normaliseInstant('1759590000.5')).toBe(1_759_590_000_500);
  });

  it('reads a zone-less ISO date-time as UTC, not the host zone', () => {
    expect(normaliseInstant('2026-10-04T15:00:00')).toBe(NOW);
    expect(normaliseInstant('2026-10-04T15:00:00.000')).toBe(NOW);
    expect(normaliseInstant('2026-10-04')).toBe(Date.UTC(2026, 9, 4));
  });

  it('accepts a valid Date', () => {
    expect(normaliseInstant(new Date(NOW))).toBe(NOW);
  });

  it.each([
    ['undefined', undefined],
    ['null', null],
    ['zero', 0],
    ['negative', -5],
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['blank', '   '],
    ['prose', 'tomorrow'],
    ['malformed ISO', '2026-13-45T99:00:00Z'],
    ['non-ISO date text', 'Oct 4 2026'],
    ['invalid Date', new Date(Number.NaN)],
    ['object', { at: NOW }],
  ])('returns undefined for %s', (_label, value) => {
    expect(normaliseInstant(value)).toBeUndefined();
  });
});

describe('parseRetryAfterDeadline', () => {
  it('F7: delta-seconds is relative to the injected now', () => {
    expect(parseRetryAfterDeadline('120', NOW)).toBe(NOW + 120 * SECOND);
    expect(parseRetryAfterDeadline(' 0 ', NOW)).toBe(NOW);
  });

  it('F8: an IMF-fixdate HTTP-date is an absolute deadline', () => {
    expect(parseRetryAfterDeadline('Wed, 21 Oct 2026 07:28:00 GMT', NOW)).toBe(
      Date.UTC(2026, 9, 21, 7, 28, 0),
    );
  });

  it('F8: the obsolete RFC 850 and asctime HTTP-date forms are read as GMT', () => {
    const expected = Date.UTC(2026, 9, 21, 7, 28, 0);
    expect(
      parseRetryAfterDeadline('Wednesday, 21-Oct-26 07:28:00 GMT', NOW),
    ).toBe(expected);
    expect(parseRetryAfterDeadline('Wed Oct 21 07:28:00 2026', NOW)).toBe(
      expected,
    );
  });

  it('returns a past HTTP-date as stated, unclamped', () => {
    expect(parseRetryAfterDeadline('Sun, 04 Oct 2026 14:00:00 GMT', NOW)).toBe(
      NOW - HOUR,
    );
  });

  it.each([
    ['absent', undefined],
    ['null', null],
    ['empty', ''],
    ['blank', '   '],
    ['prose', 'soon'],
    ['negative delta', '-5'],
    ['fractional delta', '1.5'],
    ['date without GMT', 'Wed, 21 Oct 2026 07:28:00'],
    ['malformed date', 'Wed, 99 Foo 2026 07:28:00 GMT'],
  ])('F9: returns undefined for an %s header', (_label, header) => {
    expect(parseRetryAfterDeadline(header, NOW)).toBeUndefined();
  });

  it('F9: returns undefined when now is not a finite instant', () => {
    expect(parseRetryAfterDeadline('120', Number.NaN)).toBeUndefined();
  });

  it('F10: a seven-day Retry-After stays seven days (no clamping)', () => {
    const deadline = parseRetryAfterDeadline(String(7 * 24 * 60 * 60), NOW);
    expect(deadline).toBe(NOW + 7 * DAY);
    // A cooldown deadline only: classifying it as a window would need a
    // declared duration, and the deadline carries none.
    expect(typeof deadline).toBe('number');
  });

  it('F10: a far-future HTTP-date is not clamped either', () => {
    expect(parseRetryAfterDeadline('Sun, 11 Oct 2026 15:00:00 GMT', NOW)).toBe(
      NOW + 7 * DAY,
    );
  });
});

describe('resolveClockTimeReset', () => {
  it('F5: a clock time already passed today resolves to the next day', () => {
    const observedAt = Date.UTC(2026, 9, 4, 23, 50);
    expect(resolveClockTimeReset('00:10', observedAt, 'UTC')).toBe(
      Date.UTC(2026, 9, 5, 0, 10),
    );
  });

  it('F5: midnight rollover is computed in the given zone, not UTC', () => {
    // 23:50 CEST on 4 Oct is 21:50 UTC; 00:10 CEST on 5 Oct is 22:10 UTC.
    const observedAt = Date.UTC(2026, 9, 4, 21, 50);
    expect(resolveClockTimeReset('00:10', observedAt, 'Europe/Berlin')).toBe(
      Date.UTC(2026, 9, 4, 22, 10),
    );
  });

  it('resolves a later time today to today', () => {
    expect(resolveClockTimeReset('try again at 5:05 PM', NOW, 'UTC')).toBe(
      Date.UTC(2026, 9, 4, 17, 5),
    );
  });

  it('reads a meridiem time after an unrelated number in the text', () => {
    expect(
      resolveClockTimeReset('5-hour limit reached ∙ resets 2am', NOW, 'UTC'),
    ).toBe(Date.UTC(2026, 9, 5, 2, 0));
    expect(resolveClockTimeReset('resets 12 a.m.', NOW, 'UTC')).toBe(
      Date.UTC(2026, 9, 5, 0, 0),
    );
    expect(resolveClockTimeReset('resets 12:30pm', NOW, 'UTC')).toBe(
      Date.UTC(2026, 9, 5, 12, 30),
    );
  });

  it('treats an exactly-now clock time as the next day', () => {
    expect(resolveClockTimeReset('15:00', NOW, 'UTC')).toBe(NOW + DAY);
  });

  it('keeps seconds when the text states them', () => {
    expect(resolveClockTimeReset('16:00:30', NOW, 'UTC')).toBe(
      Date.UTC(2026, 9, 4, 16, 0, 30),
    );
  });

  it('crosses a daylight-saving change using the offset on the reset day', () => {
    // 22:00 CEST on 24 Oct; Berlin returns to CET (UTC+1) on 25 Oct at 03:00.
    const observedAt = Date.UTC(2026, 9, 24, 20, 0);
    expect(resolveClockTimeReset('09:00', observedAt, 'Europe/Berlin')).toBe(
      Date.UTC(2026, 9, 25, 8, 0),
    );
  });

  it.each([
    ['no time', 'limit reached'],
    ['bare number', 'resets in 5'],
    ['hour out of range', '25:00'],
    ['minute out of range', '10:75'],
    ['meridiem hour out of range', '13pm'],
    ['zero meridiem hour', '0am'],
  ])('returns undefined for %s', (_label, text) => {
    expect(resolveClockTimeReset(text, NOW, 'UTC')).toBeUndefined();
  });

  it('returns undefined for an unknown zone or a non-finite observation', () => {
    expect(resolveClockTimeReset('17:05', NOW, 'Not/AZone')).toBeUndefined();
    expect(resolveClockTimeReset('17:05', Number.NaN, 'UTC')).toBeUndefined();
  });

  it('uses the host zone when none is given', () => {
    const resolved = resolveClockTimeReset('17:05', NOW);
    expect(resolved).toBeDefined();
    expect(resolved as number).toBeGreaterThan(NOW);
    expect((resolved as number) - NOW).toBeLessThanOrEqual(DAY);
  });
});

describe('resolveRelativeReset', () => {
  it('F6: 144h24m50s is added to the observation instant', () => {
    expect(resolveRelativeReset('144h24m50s', NOW)).toBe(
      NOW + 144 * HOUR + 24 * MINUTE + 50 * SECOND,
    );
  });

  it('accepts days, single parts, spacing and fractional seconds', () => {
    expect(resolveRelativeReset('2d 3h', NOW)).toBe(NOW + 2 * DAY + 3 * HOUR);
    expect(resolveRelativeReset('45s', NOW)).toBe(NOW + 45 * SECOND);
    expect(resolveRelativeReset('10M', NOW)).toBe(NOW + 10 * MINUTE);
    expect(resolveRelativeReset('1.5s', NOW)).toBe(NOW + 1_500);
  });

  it.each([
    ['empty', ''],
    ['prose', 'soon'],
    ['milliseconds unit', '500ms'],
    ['parts out of order', '10m2h'],
    ['missing unit', '144'],
  ])('returns undefined for %s', (_label, text) => {
    expect(resolveRelativeReset(text, NOW)).toBeUndefined();
  });

  it('returns undefined for a non-finite observation', () => {
    expect(resolveRelativeReset('1h', Number.NaN)).toBeUndefined();
  });
});

describe('windowKindFromDuration', () => {
  it('F12: maps provider-declared durations to window kinds', () => {
    expect(windowKindFromDuration(300, 1)).toEqual({
      kind: 'five_hour',
      key: 'five_hour',
      label: '5-hour session',
    });
    expect(windowKindFromDuration(10_080, 2)).toEqual({
      kind: 'weekly',
      key: 'weekly',
      label: 'Weekly',
    });
    expect(windowKindFromDuration(43_200, 1).kind).toBe('monthly');
    expect(windowKindFromDuration(44_640, 1)).toEqual({
      kind: 'monthly',
      key: 'monthly',
      label: 'Monthly',
    });
  });

  it('F12: an absent duration is labelled by position only', () => {
    expect(windowKindFromDuration(null, 1)).toEqual({
      kind: 'other',
      key: 'other:window-1',
      label: 'Window 1',
    });
    expect(windowKindFromDuration(undefined, 2)).toEqual({
      kind: 'other',
      key: 'other:window-2',
      label: 'Window 2',
    });
  });

  it('labels an undeclared duration by position, never by guessing a kind', () => {
    expect(windowKindFromDuration(60, 1)).toEqual({
      kind: 'other',
      key: 'other:window-1',
      label: 'Window 1',
    });
  });

  it('falls back to an unnumbered label for an invalid position', () => {
    expect(windowKindFromDuration(null, 0)).toEqual({
      kind: 'other',
      key: 'other:window',
      label: 'Window',
    });
    expect(windowKindFromDuration(null, 1.5).label).toBe('Window');
  });
});
