/**
 * WEEKDAY COHORT SCHEDULING — C4, FR-DATE-2. Pure arithmetic, no dependencies.
 *
 * One cohort start date in, one release instant per module out, in day order,
 * on consecutive WEEKDAYS with Saturday and Sunday skipped. Ten dates from one
 * input, which is the whole of C4's ask.
 *
 * ⚠️ SIBLING FILE: `common/sort-order.ts`. This mirrors it exactly and for the
 * same reason — pure arithmetic used by a bulk-write service, with no database,
 * no clock and no `process.env`, so `weekday-schedule.spec.ts` can assert the
 * dates themselves without a mock and `course-schedule.service.spec.ts` can
 * assert that the service WROTE what this function returned rather than
 * restating the arithmetic a second time.
 *
 * ── 🔴 THE OFFSETS ARE NOT A CONSTANT ──────────────────────────────────────
 * `task-description.md` §10 states FR-DATE-2's offsets as a fixed list —
 * `+0 +1 +2 +3 +4 · +7 +8 +9 +10 +11`. **That table is correct only for a
 * MONDAY start.** The offsets are a FUNCTION OF THE START WEEKDAY, because the
 * only rule is "advance one calendar day, skip Sat and Sun". For the cohort-1
 * decision — Tuesday 1 September 2026 (`context.md` C3) — the real offsets are
 * `+0 +1 +2 +3 +6 · +7 +8 +9 +10 +13` and Day 10 lands on Monday 14 September.
 * Shipping the fixed table would hand an operator ten dates silently one day
 * early from Day 5 onward. The corrected pair of tables lives in
 * `prisma/seed/map-course.ts`'s docblock; nobody has to read either, because
 * `POST /v1/admin/course-modules/schedule` computes them.
 *
 * ── 🔴 A WEEKEND START IS AN ERROR, NOT A ROLL-FORWARD TO MONDAY ───────────
 * Quietly moving the date the admin typed is the same class of harm as a
 * mis-typed date shifting ten member-visible dates — it only changes who made
 * the mistake. `ScheduleInputError`, and the service turns it into a `400`
 * carrying a written sentence.
 *
 * ── 🔴 WEEKDAY ARITHMETIC ON THE LOCAL CALENDAR, THEN CONVERT ──────────────
 * `CourseModule.releaseAt` is a `DateTime` — an INSTANT — but "skips weekends"
 * and "opens at 09:00" are CALENDAR-LOCAL notions. Advancing by `+24h` in UTC
 * is wrong across a DST transition: the local wall-clock release time drifts by
 * an hour, and for a release near midnight that drift becomes a whole calendar
 * DAY. Cohort 1 (September, no transition) would never show it; a cohort
 * starting in late October or March would — and C4 exists precisely so cohorts
 * 2 and 3 need no code change. So: walk the CIVIL calendar day by day, and
 * convert each local wall-clock to an instant independently, at the end.
 *
 * ── ⚠️ `Intl`, NOT `temporal-polyfill` — AND THE REASON, RECORDED ──────────
 * `implementation-plan.md` §5.4 chose `Temporal` via `temporal-polyfill`
 * (declared at `package.json:187`, imported nowhere) and made Task 3.0 a hard
 * gate on it. **The gate's two named criteria PASSED and a third thing failed.**
 * Measured, not assumed:
 *
 *   - It BUNDLES. `nx build ptah-license-server` succeeds and esbuild inlines
 *     the package into `main.cjs` (`temporal-polyfill/chunks/*` appear in the
 *     output); it is not in the esbuild `external` list and needs no deploy
 *     change. §5.4's prediction was right.
 *   - Its v1 surface MATCHES §5.4's sketch exactly — `PlainDate.from`,
 *     `.dayOfWeek`, `.toPlainDateTime`, `.toZonedDateTime`,
 *     `.toInstant().epochMilliseconds` all behave as written.
 *   - 🔴 But `temporal-polyfill@1.0.2` is **ESM-ONLY**: every entry in its
 *     `exports` map has an `import` condition and NO `require` condition, and
 *     there is no CJS build in the package. Both suites that must stay green
 *     run under `ts-jest` with `module: commonjs`, so `require('temporal-
 *     polyfill')` fails with `ERR_PACKAGE_PATH_NOT_EXPORTED`. Adding
 *     `transformIgnorePatterns` got the module to load but left the named
 *     `Temporal` export `undefined` through ts-jest's ESM interop — and the fix
 *     would have to be applied to BOTH `libs/api/learning/jest.config.cts` and
 *     `apps/ptah-license-server/jest.config.ts`, because
 *     `controller-validation.spec.ts` and `route-map.spec.ts` import
 *     `ALL_CONTROLLERS`, which reaches this file through the controller.
 *
 * §5.4 pre-authorised exactly this outcome: *"the fallback is a hand-rolled
 * `Intl.DateTimeFormat` two-pass offset resolver in the same pure helper with
 * the SAME SIGNATURE, which changes ~30 lines of one file and nothing else. The
 * helper's signature is chosen so that swap is local."* This is that fallback,
 * and the swap is indeed local: `WeekdayScheduleInput`, `WeekdaySlot`,
 * `ScheduleInputError` and `computeWeekdaySchedule` are §5.4's signatures
 * verbatim, so nothing outside this file knows which implementation is behind
 * them. It also costs the bundle nothing and works identically under CJS, ESM
 * and every Node ≥ 20 the server targets, since `Intl` carries the same IANA
 * tzdata the polyfill ships.
 *
 * ── DST AMBIGUITY IS RESOLVED THE WAY `Temporal`'s `'compatible'` DOES ─────
 * Fall back (a local time that happens twice) → the EARLIER instant. Spring
 * forward (a local time that never happens) → shifted FORWARD by the gap. Both
 * are asserted in the spec. A release time inside a skipped hour is not a case
 * an admin should have to reason about, and the two readings differ by one
 * hour, never by a day.
 *
 * ── 🔴 `count` COMES FROM THE DATABASE, NEVER FROM A LITERAL ───────────────
 * A course with twelve live modules gets twelve dates. `COURSE_SLUG` is
 * `ptah-builders-cohort-1`, so cohort 2 is a NEW course row with its own module
 * count — C4's reusability clause is enforced right here, by this parameter not
 * being the number ten.
 */

/** What one cohort schedule is computed from. */
export interface WeekdayScheduleInput {
  /** Day 1's LOCAL calendar date in `timeZone`. `YYYY-MM-DD`. */
  readonly startDate: string;
  /** The local wall-clock time each module opens. `HH:mm`, 24h. */
  readonly timeOfDay: string;
  /** IANA identifier — `Europe/Berlin`, `UTC`. */
  readonly timeZone: string;
  /**
   * How many slots to emit — the course's LIVE module count.
   *
   * 🔴 NEVER A LITERAL. See the file docblock.
   */
  readonly count: number;
}

/** One module's computed release slot. */
export interface WeekdaySlot {
  /** 1-based position in day order. */
  readonly day: number;
  /** `YYYY-MM-DD` in `timeZone` — never a Saturday or a Sunday. */
  readonly localDate: string;
  readonly weekday: 'Mon' | 'Tue' | 'Wed' | 'Thu' | 'Fri';
  /** What is written to `CourseModule.releaseAt`. */
  readonly instant: Date;
}

/**
 * Thrown for an unresolvable time zone, a weekend or malformed start date, a
 * malformed time of day, or a `count` below 1.
 *
 * ⚠️ ITS MESSAGE IS FOR THE LOG, NOT FOR THE CLIENT. `CourseScheduleService`
 * catches it and re-throws a `BadRequestException` carrying a written sentence;
 * forwarding `error.message` verbatim is the anti-pattern CLAUDE.md names.
 */
export class ScheduleInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ScheduleInputError';
  }
}

/** ISO weekday (1 = Mon … 7 = Sun) → the label a slot carries. */
const WEEKDAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;

/** Saturday and Sunday, as ISO weekday numbers. */
const FIRST_WEEKEND_DAY = 6;

const MS_PER_DAY = 86_400_000;

/**
 * The whole action, as a pure function.
 *
 * Day 1 is `startDate`. Each subsequent day advances one CALENDAR day in
 * `timeZone`, skipping Saturday and Sunday, until `count` slots exist.
 */
export function computeWeekdaySchedule(
  input: WeekdayScheduleInput,
): readonly WeekdaySlot[] {
  const { startDate, timeOfDay, timeZone, count } = input;

  if (!Number.isInteger(count) || count < 1) {
    throw new ScheduleInputError(
      `count must be a positive integer, received ${String(count)}`,
    );
  }

  const format = zoneFormatter(timeZone);
  const { hour, minute } = parseTimeOfDay(timeOfDay);
  let civil = parseCivilDate(startDate);

  if (isoWeekday(civil) >= FIRST_WEEKEND_DAY) {
    throw new ScheduleInputError(
      `startDate ${startDate} falls on a ` +
        `${WEEKDAY_LABELS[isoWeekday(civil) - 1]}; the cohort must start on a weekday`,
    );
  }

  const slots: WeekdaySlot[] = [];
  while (slots.length < count) {
    const weekday = isoWeekday(civil);
    if (weekday < FIRST_WEEKEND_DAY) {
      const localDate = civilToIsoDate(civil);
      slots.push({
        day: slots.length + 1,
        localDate,
        // Narrowed by the `weekday < FIRST_WEEKEND_DAY` guard: Mon…Fri only.
        weekday: WEEKDAY_LABELS[weekday - 1] as WeekdaySlot['weekday'],
        instant: localWallClockToInstant(civil, hour, minute, format),
      });
    }
    // ⚠️ ONE CALENDAR DAY, ON THE CIVIL SCALE. `civil` is a pure date counter
    // with no zone attached, so this addition can never drift — the zone is
    // applied per slot, above, and never accumulates.
    civil += MS_PER_DAY;
  }

  return slots;
}

/* -------------------------------------------------------------------------- */
/* Civil-calendar arithmetic — no zone, no clock                               */
/* -------------------------------------------------------------------------- */

/**
 * `YYYY-MM-DD` → a civil day counter (midnight UTC of that date).
 *
 * ⚠️ THE `Date.UTC` HERE IS NOT A TIME ZONE DECISION. UTC is used purely as a
 * calendar with no DST, so that `+ MS_PER_DAY` is exact day arithmetic. The
 * cohort's real zone is applied once per slot, in
 * {@link localWallClockToInstant}.
 *
 * ⚠️ AND THE ROUND-TRIP CHECK IS LOAD-BEARING. `Date.UTC(2026, 1, 30)` happily
 * rolls 30 February into 2 March; the DTO's `@Matches` cannot catch that,
 * because it only checks the SHAPE. A rolled date would schedule a cohort two
 * days off with no error anywhere.
 */
function parseCivilDate(isoDate: string): number {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  if (!match) {
    throw new ScheduleInputError(`startDate must be YYYY-MM-DD, received ${isoDate}`);
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const civil = Date.UTC(year, month - 1, day);
  const parsed = new Date(civil);

  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    throw new ScheduleInputError(`startDate ${isoDate} is not a real calendar date`);
  }
  return civil;
}

/** `HH:mm` → its two numbers. */
function parseTimeOfDay(timeOfDay: string): { hour: number; minute: number } {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(timeOfDay);
  if (!match) {
    throw new ScheduleInputError(
      `timeOfDay must be HH:mm in 24-hour form, received ${timeOfDay}`,
    );
  }
  return { hour: Number(match[1]), minute: Number(match[2]) };
}

/** ISO weekday: 1 = Monday … 7 = Sunday. */
function isoWeekday(civil: number): number {
  // `getUTCDay()` is 0 = Sunday … 6 = Saturday.
  return ((new Date(civil).getUTCDay() + 6) % 7) + 1;
}

/** A civil day counter back to `YYYY-MM-DD`. */
function civilToIsoDate(civil: number): string {
  return new Date(civil).toISOString().slice(0, 10);
}

/* -------------------------------------------------------------------------- */
/* Local wall clock → instant, via Intl                                        */
/* -------------------------------------------------------------------------- */

/**
 * The zone reader, built ONCE per schedule.
 *
 * ⚠️ CONSTRUCTING IT IS ALSO THE ZONE VALIDATION. `Intl.DateTimeFormat` throws
 * a `RangeError` for an identifier ICU cannot resolve, which is the real check
 * — the DTO's `@Matches` is only a cheap boundary reject on the SHAPE, and
 * `Mars/Olympus` is shaped exactly like `Europe/Berlin`.
 */
function zoneFormatter(timeZone: string): Intl.DateTimeFormat {
  try {
    return new Intl.DateTimeFormat('en-US', {
      timeZone,
      hour12: false,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  } catch (error: unknown) {
    throw new ScheduleInputError(
      `timeZone ${timeZone} is not a resolvable IANA identifier` +
        (error instanceof Error ? `: ${error.message}` : ''),
    );
  }
}

/**
 * What `instant` reads as on the zone's wall clock, expressed on the same civil
 * scale {@link parseCivilDate} uses — so the two are directly comparable.
 */
function wallClockAsCivil(instant: number, format: Intl.DateTimeFormat): number {
  const parts = format.formatToParts(new Date(instant));
  const field = (type: Intl.DateTimeFormatPartTypes): number => {
    const value = parts.find((part) => part.type === type)?.value;
    return value === undefined ? Number.NaN : Number(value);
  };
  // `hourCycle: 'h23'` is requested above, but a stray `24` for midnight is a
  // known ICU variance and costs one line to neutralise.
  const hour = field('hour') % 24;
  return Date.UTC(
    field('year'),
    field('month') - 1,
    field('day'),
    hour,
    field('minute'),
    field('second'),
  );
}

/**
 * A local wall-clock time in a zone → the UTC instant it names.
 *
 * 🔴 THIS IS THE TWO-PASS OFFSET RESOLVER, and it is two passes because ONE is
 * wrong near a transition. `Intl` can tell you the offset AT AN INSTANT; the
 * input here is a LOCAL time, which is the other direction. So: treat the local
 * fields as though they were UTC to get a target, read the zone's offset on
 * each side of it, and test the candidate instants those offsets produce
 * against the target by converting BACK. The round-trip is what makes this
 * exact rather than approximately right.
 *
 * The three cases, all asserted in the spec:
 *
 *  - **Ordinary.** Both offsets agree, one candidate, it round-trips.
 *  - **Fall back** (the local time happens twice). Both candidates round-trip;
 *    the EARLIER is returned — `Temporal`'s `'compatible'` reading.
 *  - **Spring forward** (the local time never happens). Neither candidate
 *    round-trips; the pre-transition offset is used, which lands the release
 *    just AFTER the gap — again `'compatible'`, shifted forward rather than
 *    back. Both readings differ by one hour, never by a day.
 */
function localWallClockToInstant(
  civil: number,
  hour: number,
  minute: number,
  format: Intl.DateTimeFormat,
): Date {
  const target = civil + hour * 3_600_000 + minute * 60_000;

  // ± one day brackets any real transition without assuming when it happens.
  const offsetBefore = wallClockAsCivil(target - MS_PER_DAY, format) - (target - MS_PER_DAY);
  const offsetAfter = wallClockAsCivil(target + MS_PER_DAY, format) - (target + MS_PER_DAY);

  const candidates =
    offsetBefore === offsetAfter
      ? [target - offsetBefore]
      : [target - offsetBefore, target - offsetAfter];

  const exact = candidates
    .filter((candidate) => wallClockAsCivil(candidate, format) === target)
    .sort((a, b) => a - b);

  return new Date(exact.length > 0 ? exact[0] : target - offsetBefore);
}
