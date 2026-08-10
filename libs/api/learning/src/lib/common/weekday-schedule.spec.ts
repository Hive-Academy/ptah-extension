import {
  ScheduleInputError,
  computeWeekdaySchedule,
} from './weekday-schedule';

/**
 * C4 / FR-DATE-2 — the cohort schedule, asserted as DATES rather than as
 * arithmetic.
 *
 * ⚠️ THE EXPECTED DATES ARE HAND-WRITTEN LITERALS, NOT RE-DERIVED. A spec that
 * recomputed "start plus the weekday offsets" would be an echo of the
 * implementation and could not detect the one defect this file exists for —
 * `task-description.md` §10's FIXED offset table, which is correct only for a
 * MONDAY start and is silently one day early from Day 5 onward for the
 * founder's actual Tuesday cohort.
 *
 * ⚠️ AND `count` IS VARIED DELIBERATELY. C4's requirement is that cohorts 2 and
 * 3 need no code change, and `COURSE_SLUG` is `ptah-builders-cohort-1`, so a
 * future cohort is a NEW course row with its own module count. "Never assumes
 * ten" is therefore a REQUIREMENT, and the `count: 1 / 3 / 12` cases are that
 * requirement made a test.
 */

/** The shared non-date inputs. Kept out of the tables so the dates read plainly. */
const AT_0900_UTC = { timeOfDay: '09:00', timeZone: 'UTC' } as const;

/** `localDate` alone — the column the offset tables are about. */
function localDates(
  input: Parameters<typeof computeWeekdaySchedule>[0],
): string[] {
  return computeWeekdaySchedule(input).map((slot) => slot.localDate);
}

/** `YYYY-MM-DD (Weekday)` — so a failure diff names the weekday too. */
function dated(
  input: Parameters<typeof computeWeekdaySchedule>[0],
): string[] {
  return computeWeekdaySchedule(input).map(
    (slot) => `${slot.localDate} (${slot.weekday})`,
  );
}

/* -------------------------------------------------------------------------- */

describe('computeWeekdaySchedule — the offset tables', () => {
  it('a MONDAY start gives the clean 5 + 5: +0…+4, +7…+11', () => {
    // Monday 31 August 2026. This is the shape `task-description.md` §10's
    // fixed table describes, and the ONLY start weekday for which it is right.
    expect(
      dated({ startDate: '2026-08-31', count: 10, ...AT_0900_UTC }),
    ).toEqual([
      '2026-08-31 (Mon)',
      '2026-09-01 (Tue)',
      '2026-09-02 (Wed)',
      '2026-09-03 (Thu)',
      '2026-09-04 (Fri)',
      '2026-09-07 (Mon)',
      '2026-09-08 (Tue)',
      '2026-09-09 (Wed)',
      '2026-09-10 (Thu)',
      '2026-09-11 (Fri)',
    ]);
  });

  it('🔴 the founder\'s cohort — Tuesday 1 September 2026 — ends on Monday 14 September', () => {
    // 🔴 THIS IS THE ASSERTION THAT CLOSES R1b (`context.md` C3, plan Finding 0).
    // The offsets here are +0 +1 +2 +3 +6 · +7 +8 +9 +10 +13 — NOT the fixed
    // +0…+4, +7…+11 of `task-description.md` §10. Day 5 onward differs by a
    // day, and Day 10 lands ALONE on Monday 14 September, which is the
    // orphan-Monday consequence C3 records and accepts. Do not "fix" it here.
    expect(
      dated({ startDate: '2026-09-01', count: 10, ...AT_0900_UTC }),
    ).toEqual([
      '2026-09-01 (Tue)',
      '2026-09-02 (Wed)',
      '2026-09-03 (Thu)',
      '2026-09-04 (Fri)',
      '2026-09-07 (Mon)',
      '2026-09-08 (Tue)',
      '2026-09-09 (Wed)',
      '2026-09-10 (Thu)',
      '2026-09-11 (Fri)',
      '2026-09-14 (Mon)',
    ]);
  });

  it('the two tables DISAGREE from Day 5 — which is why the offsets are not a constant', () => {
    // The defect, stated as a property rather than as a comment: shifting the
    // start by one weekday does NOT shift every date by one day.
    const monday = localDates({
      startDate: '2026-08-31',
      count: 10,
      ...AT_0900_UTC,
    });
    const tuesday = localDates({
      startDate: '2026-09-01',
      count: 10,
      ...AT_0900_UTC,
    });

    // Days 1-4 are one day apart, as a naive reading expects…
    expect(tuesday[3]).toBe('2026-09-04');
    expect(monday[4]).toBe('2026-09-04');
    // …but Day 5 is THREE days apart, because a weekend fell between them.
    expect(monday[4]).toBe('2026-09-04');
    expect(tuesday[4]).toBe('2026-09-07');
  });

  it('never emits a Saturday or a Sunday, over a long run', () => {
    const slots = computeWeekdaySchedule({
      startDate: '2026-09-01',
      count: 40,
      ...AT_0900_UTC,
    });

    expect(slots).toHaveLength(40);
    for (const slot of slots) {
      expect(['Sat', 'Sun']).not.toContain(slot.weekday);
      // The label and the real calendar day must agree — a label computed from
      // the wrong index would otherwise pass the assertion above vacuously.
      expect(new Date(`${slot.localDate}T00:00:00.000Z`).getUTCDay()).not.toBe(0);
      expect(new Date(`${slot.localDate}T00:00:00.000Z`).getUTCDay()).not.toBe(6);
    }
  });

  it('numbers the days 1..count, in order', () => {
    const slots = computeWeekdaySchedule({
      startDate: '2026-09-01',
      count: 10,
      ...AT_0900_UTC,
    });
    expect(slots.map((slot) => slot.day)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10,
    ]);
  });
});

describe('computeWeekdaySchedule — count never assumes ten (C4 reusability)', () => {
  it('count: 1 gives exactly the start date', () => {
    expect(localDates({ startDate: '2026-09-01', count: 1, ...AT_0900_UTC })).toEqual(
      ['2026-09-01'],
    );
  });

  it('count: 3 stops inside the first week', () => {
    expect(localDates({ startDate: '2026-09-01', count: 3, ...AT_0900_UTC })).toEqual(
      ['2026-09-01', '2026-09-02', '2026-09-03'],
    );
  });

  it('count: 12 runs into a THIRD week — a twelve-module cohort 2 needs no code change', () => {
    expect(
      localDates({ startDate: '2026-09-01', count: 12, ...AT_0900_UTC }),
    ).toEqual([
      '2026-09-01',
      '2026-09-02',
      '2026-09-03',
      '2026-09-04',
      '2026-09-07',
      '2026-09-08',
      '2026-09-09',
      '2026-09-10',
      '2026-09-11',
      '2026-09-14',
      '2026-09-15',
      '2026-09-16',
    ]);
  });

  it('count below 1, or not an integer, is a ScheduleInputError', () => {
    for (const count of [0, -1, 1.5, Number.NaN]) {
      expect(() =>
        computeWeekdaySchedule({ startDate: '2026-09-01', count, ...AT_0900_UTC }),
      ).toThrow(ScheduleInputError);
    }
  });
});

describe('computeWeekdaySchedule — rejected inputs', () => {
  it('🔴 a SATURDAY start is an error, NOT a roll-forward to Monday', () => {
    // Silently moving the date the admin typed is the same class of harm as a
    // mis-typed date shifting ten member-visible dates — it only changes who
    // made the mistake. Saturday 5 September 2026.
    expect(() =>
      computeWeekdaySchedule({ startDate: '2026-09-05', count: 10, ...AT_0900_UTC }),
    ).toThrow(ScheduleInputError);
  });

  it('🔴 a SUNDAY start is an error too', () => {
    expect(() =>
      computeWeekdaySchedule({ startDate: '2026-09-06', count: 10, ...AT_0900_UTC }),
    ).toThrow(ScheduleInputError);
  });

  it('an unresolvable time zone is a ScheduleInputError, not a RangeError', () => {
    // `Mars/Olympus` is shaped exactly like `Europe/Berlin`, so the DTO's
    // `@Matches` cannot reject it — ICU is the only real check.
    expect(() =>
      computeWeekdaySchedule({
        startDate: '2026-09-01',
        count: 10,
        timeOfDay: '09:00',
        timeZone: 'Mars/Olympus',
      }),
    ).toThrow(ScheduleInputError);
  });

  it('a date that is SHAPED right but is not a real day is rejected', () => {
    // 🔴 `Date.UTC(2026, 1, 30)` rolls 30 February into 2 March without error.
    // The DTO's `@Matches(/^\d{4}-\d{2}-\d{2}$/)` accepts this string, so if
    // this check were missing the cohort would be scheduled two days off with
    // no error anywhere.
    expect(() =>
      computeWeekdaySchedule({ startDate: '2026-02-30', count: 10, ...AT_0900_UTC }),
    ).toThrow(ScheduleInputError);
  });

  it('a malformed startDate or timeOfDay is rejected', () => {
    expect(() =>
      computeWeekdaySchedule({ startDate: '01-09-2026', count: 1, ...AT_0900_UTC }),
    ).toThrow(ScheduleInputError);
    expect(() =>
      computeWeekdaySchedule({
        startDate: '2026-09-01',
        count: 1,
        timeOfDay: '9:00',
        timeZone: 'UTC',
      }),
    ).toThrow(ScheduleInputError);
    expect(() =>
      computeWeekdaySchedule({
        startDate: '2026-09-01',
        count: 1,
        timeOfDay: '24:00',
        timeZone: 'UTC',
      }),
    ).toThrow(ScheduleInputError);
  });
});

describe('computeWeekdaySchedule — local time to instant', () => {
  it('UTC instants equal the naive concatenation — the conversion is not double-applied', () => {
    const slots = computeWeekdaySchedule({
      startDate: '2026-09-01',
      count: 3,
      timeOfDay: '09:00',
      timeZone: 'UTC',
    });

    expect(slots.map((slot) => slot.instant.toISOString())).toEqual([
      '2026-09-01T09:00:00.000Z',
      '2026-09-02T09:00:00.000Z',
      '2026-09-03T09:00:00.000Z',
    ]);
  });

  it('a fixed-offset zone shifts the instant by exactly that offset', () => {
    // Berlin in September is CEST, UTC+2 — 09:00 local is 07:00Z.
    const [first] = computeWeekdaySchedule({
      startDate: '2026-09-01',
      count: 1,
      timeOfDay: '09:00',
      timeZone: 'Europe/Berlin',
    });
    expect(first.instant.toISOString()).toBe('2026-09-01T07:00:00.000Z');
  });

  it('a zone WEST of UTC works too — the sign is not assumed', () => {
    // New York in September is EDT, UTC-4 — 09:00 local is 13:00Z.
    const [first] = computeWeekdaySchedule({
      startDate: '2026-09-01',
      count: 1,
      timeOfDay: '09:00',
      timeZone: 'America/New_York',
    });
    expect(first.instant.toISOString()).toBe('2026-09-01T13:00:00.000Z');
  });

  it('a zone with a HALF-HOUR offset is handled', () => {
    // Kolkata is UTC+5:30 all year — 09:00 local is 03:30Z.
    const [first] = computeWeekdaySchedule({
      startDate: '2026-09-01',
      count: 1,
      timeOfDay: '09:00',
      timeZone: 'Asia/Kolkata',
    });
    expect(first.instant.toISOString()).toBe('2026-09-01T03:30:00.000Z');
  });

  it('midnight is a real release time and does not roll to the previous day', () => {
    const [first] = computeWeekdaySchedule({
      startDate: '2026-09-01',
      count: 1,
      timeOfDay: '00:00',
      timeZone: 'Europe/Berlin',
    });
    expect(first.localDate).toBe('2026-09-01');
    expect(first.instant.toISOString()).toBe('2026-08-31T22:00:00.000Z');
  });
});

describe('🔴 computeWeekdaySchedule — a DST-CROSSING cohort', () => {
  /**
   * 🔴 THE CASE A `+24h` IMPLEMENTATION FAILS AND NOTHING ELSE CATCHES.
   *
   * Cohort 1 starts in September and crosses no transition, so it would never
   * show this defect. C4 exists so cohorts 2 and 3 need no code change — and a
   * cohort starting in late October crosses Europe/Berlin's fall-back on
   * Sunday 25 October 2026 (CEST +2 → CET +1). An implementation that advanced
   * the INSTANT by 86 400 000 ms would keep every UTC time identical and let
   * the LOCAL release time slip by an hour; for a release near midnight that
   * slip becomes a whole calendar DAY.
   */
  const BERLIN_LATE_OCTOBER = {
    startDate: '2026-10-22',
    count: 6,
    timeOfDay: '09:00',
    timeZone: 'Europe/Berlin',
  } as const;

  it('holds the LOCAL wall-clock time fixed across the transition', () => {
    const slots = computeWeekdaySchedule(BERLIN_LATE_OCTOBER);
    const berlinLocal = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Europe/Berlin',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    });

    for (const slot of slots) {
      expect(berlinLocal.format(slot.instant)).toBe('09:00');
    }
  });

  it('and therefore the UTC offsets DIFFER across it — which is the proof', () => {
    const slots = computeWeekdaySchedule(BERLIN_LATE_OCTOBER);

    // Thu 22 and Fri 23 October are still CEST (+2): 09:00 local is 07:00Z.
    expect(slots[0].instant.toISOString()).toBe('2026-10-22T07:00:00.000Z');
    expect(slots[1].instant.toISOString()).toBe('2026-10-23T07:00:00.000Z');
    // The clocks go back on Sunday 25 October. Mon 26 onward is CET (+1):
    // the same 09:00 local is now 08:00Z. A `+24h` walk would have kept 07:00Z
    // here, i.e. 08:00 local — an hour early, silently.
    expect(slots[2].instant.toISOString()).toBe('2026-10-26T08:00:00.000Z');
    expect(slots[3].instant.toISOString()).toBe('2026-10-27T08:00:00.000Z');
    expect(slots[4].instant.toISOString()).toBe('2026-10-28T08:00:00.000Z');
    expect(slots[5].instant.toISOString()).toBe('2026-10-29T08:00:00.000Z');
  });

  it('the weekend is still skipped across the transition weekend', () => {
    expect(localDates(BERLIN_LATE_OCTOBER)).toEqual([
      '2026-10-22',
      '2026-10-23',
      '2026-10-26',
      '2026-10-27',
      '2026-10-28',
      '2026-10-29',
    ]);
  });

  it('a SPRING-FORWARD cohort keeps its local time too', () => {
    // Europe/Berlin springs forward on Sunday 29 March 2026 (CET → CEST).
    const slots = computeWeekdaySchedule({
      startDate: '2026-03-26',
      count: 4,
      timeOfDay: '09:00',
      timeZone: 'Europe/Berlin',
    });

    expect(slots[0].instant.toISOString()).toBe('2026-03-26T08:00:00.000Z'); // Thu, CET
    expect(slots[1].instant.toISOString()).toBe('2026-03-27T08:00:00.000Z'); // Fri, CET
    expect(slots[2].instant.toISOString()).toBe('2026-03-30T07:00:00.000Z'); // Mon, CEST
    expect(slots[3].instant.toISOString()).toBe('2026-03-31T07:00:00.000Z'); // Tue, CEST
  });
});

describe('computeWeekdaySchedule — DST ambiguity resolves as Temporal "compatible"', () => {
  /**
   * ⚠️ THESE TWO USE `Africa/Cairo` RATHER THAN `Europe/Berlin`, AND THE REASON
   * IS THE FEATURE ITSELF. Every European transition falls on a SUNDAY, and
   * this scheduler skips weekends — so no European cohort can ever be scheduled
   * INTO a fold or a gap, and a Berlin-based test would assert the rule against
   * a date the schedule can never produce. Egypt moves its clocks on the last
   * FRIDAY of April and the last THURSDAY of October, both weekdays, both
   * reachable as real slots.
   *
   * ⚠️ EACH TEST ASSERTS THE TZDATA PRECONDITION FIRST. Egypt reinstated DST in
   * 2023, so these rules are newer than some ICU builds. If a future runtime
   * ships different tzdata the PRECONDITION fails and names the reason, rather
   * than the resolver appearing broken.
   */
  const cairoLocal = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Africa/Cairo',
    dateStyle: 'short',
    timeStyle: 'short',
    hourCycle: 'h23',
  });

  it('a FALL-BACK repeated local time takes the EARLIER instant', () => {
    // PRECONDITION: 23:30 on Thursday 29 October 2026 happens TWICE in Cairo —
    // once at +03 (EEST) and again at +02 (EET) after the clocks go back.
    expect(cairoLocal.format(new Date('2026-10-29T20:30:00.000Z'))).toBe(
      '29/10/2026, 23:30',
    );
    expect(cairoLocal.format(new Date('2026-10-29T21:30:00.000Z'))).toBe(
      '29/10/2026, 23:30',
    );

    const slots = computeWeekdaySchedule({
      startDate: '2026-10-28', // Wednesday
      count: 2,
      timeOfDay: '23:30',
      timeZone: 'Africa/Cairo',
    });

    expect(slots[0].instant.toISOString()).toBe('2026-10-28T20:30:00.000Z');
    // 🔴 THE EARLIER OF THE TWO — Temporal's `'compatible'` reading. The later
    // one, 21:30Z, is equally "23:30 local" and is NOT chosen.
    expect(slots[1].instant.toISOString()).toBe('2026-10-29T20:30:00.000Z');
  });

  it('a SPRING-FORWARD skipped local time shifts FORWARD, never back', () => {
    // PRECONDITION: Cairo jumps 00:00 → 01:00 on Friday 24 April 2026, so
    // 00:30 local NEVER HAPPENS that day — 22:30Z is already 01:30 local.
    expect(cairoLocal.format(new Date('2026-04-23T21:30:00.000Z'))).toBe(
      '23/04/2026, 23:30',
    );
    expect(cairoLocal.format(new Date('2026-04-23T22:30:00.000Z'))).toBe(
      '24/04/2026, 01:30',
    );

    const slots = computeWeekdaySchedule({
      startDate: '2026-04-23', // Thursday
      count: 2,
      timeOfDay: '00:30',
      timeZone: 'Africa/Cairo',
    });

    expect(slots[0].instant.toISOString()).toBe('2026-04-22T22:30:00.000Z');
    // 🔴 SHIFTED FORWARD past the gap, landing at 01:30 local on the right
    // calendar day. Shifting BACK would have put the release at 23:30 on
    // Thursday — the PREVIOUS day, which is the failure that matters: an hour
    // of error becomes a day of error.
    expect(slots[1].instant.toISOString()).toBe('2026-04-23T22:30:00.000Z');
    expect(cairoLocal.format(slots[1].instant)).toBe('24/04/2026, 01:30');
  });
});
