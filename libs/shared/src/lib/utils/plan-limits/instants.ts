/**
 * Plan-limit instants (TASK_2026_596).
 *
 * Pure parsers that turn the many ways providers state a time — epoch
 * seconds, epoch milliseconds, ISO-8601, Retry-After headers, a clock time in
 * an error message, a relative duration — into one form: epoch milliseconds,
 * UTC.
 *
 * Every function takes the observation instant as a parameter; nothing here
 * reads the system clock, so results are deterministic under test. Nothing
 * throws: unparseable input returns `undefined`, which renders as "unknown".
 */
import type {
  PlanWindowKey,
  PlanWindowKind,
} from '../../types/plan-limit.types';

/** Epoch values below this are seconds; at or above it, milliseconds. */
const SECONDS_THRESHOLD = 1e11;

const MS_PER_SECOND = 1_000;
const MS_PER_MINUTE = 60 * MS_PER_SECOND;
const MS_PER_HOUR = 60 * MS_PER_MINUTE;
const MS_PER_DAY = 24 * MS_PER_HOUR;

const ISO_DATE_PREFIX = /^\d{4}-\d{2}-\d{2}/;
/** An ISO date-time with a time part but no `Z` or numeric offset. */
const ISO_ZONELESS_DATE_TIME = /^\d{4}-\d{2}-\d{2}T[\d:.]+$/;
const DECIMAL_NUMBER = /^\d+(?:\.\d+)?$/;
const DELTA_SECONDS = /^\d+$/;
/** RFC 9110 asctime-date, e.g. `Sun Nov  6 08:49:37 1994` (implicitly GMT). */
const ASCTIME_DATE =
  /^[A-Za-z]{3} [A-Za-z]{3} [ \d]\d \d{2}:\d{2}:\d{2} \d{4}$/;
/** IMF-fixdate and the obsolete RFC 850 form both end in `GMT`. */
const GMT_SUFFIX = /\bGMT$/;
/**
 * A clock time inside free text: `17:05`, `5:05 PM`, `2am`, `09:00:30`.
 * Groups: hour, minute, second, meridiem letter.
 */
const CLOCK_TIME =
  /(?<![\d:])(\d{1,2})(?::(\d{2}))?(?::(\d{2}))?(?:\s*([ap])\.?m\b\.?)?(?![\d:])/gi;
/** A compact relative duration such as `144h24m50s`, `2d3h` or `45s`. */
const RELATIVE_DURATION =
  /^(?:(\d+)d)?(?:(\d+)h)?(?:(\d+)m)?(?:(\d+(?:\.\d+)?)s)?$/i;

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function epochNumberToMs(value: number): number | undefined {
  if (!Number.isFinite(value) || value <= 0) return undefined;
  const ms = value < SECONDS_THRESHOLD ? value * MS_PER_SECOND : value;
  return Number.isFinite(ms) ? Math.round(ms) : undefined;
}

/**
 * Normalise an instant to epoch milliseconds, UTC.
 *
 * - Numbers (or numeric strings) below `1e11` are epoch seconds; larger ones
 *   are epoch milliseconds.
 * - Strings starting with an ISO-8601 date are parsed as ISO; a date-time
 *   with no zone designator is read as UTC, never as the host's local zone.
 * - A valid `Date` is accepted as is.
 *
 * Returns `undefined` for anything else, for non-positive values and for
 * unparseable text.
 */
export function normaliseInstant(value: unknown): number | undefined {
  if (typeof value === 'number') return epochNumberToMs(value);
  if (value instanceof Date) return epochNumberToMs(value.getTime());
  if (typeof value !== 'string') return undefined;

  const text = value.trim();
  if (DECIMAL_NUMBER.test(text)) return epochNumberToMs(Number(text));
  if (!ISO_DATE_PREFIX.test(text)) return undefined;

  const iso = ISO_ZONELESS_DATE_TIME.test(text) ? `${text}Z` : text;
  return epochNumberToMs(Date.parse(iso));
}

/**
 * Parse a `Retry-After` header into an absolute deadline.
 *
 * Accepts delta-seconds (`"120"`) relative to `now`, or an HTTP-date
 * (IMF-fixdate, RFC 850 or asctime). The deadline is **not clamped**: a
 * seven-day Retry-After stays seven days. It is a cooldown deadline, never a
 * window reset. A past HTTP-date is returned as stated.
 *
 * Returns `undefined` for an absent, blank or invalid header, or a non-finite
 * `now`.
 */
export function parseRetryAfterDeadline(
  header: string | null | undefined,
  now: number,
): number | undefined {
  if (typeof header !== 'string' || !isFiniteNumber(now)) return undefined;
  const text = header.trim();
  if (text.length === 0) return undefined;

  if (DELTA_SECONDS.test(text)) {
    const deadline = now + Number(text) * MS_PER_SECOND;
    return Number.isFinite(deadline) ? deadline : undefined;
  }

  let httpDate: string | undefined;
  if (GMT_SUFFIX.test(text)) httpDate = text;
  else if (ASCTIME_DATE.test(text)) httpDate = `${text} GMT`;
  if (httpDate === undefined) return undefined;

  const parsed = Date.parse(httpDate);
  return Number.isFinite(parsed) ? parsed : undefined;
}

interface WallClock {
  readonly year: number;
  readonly month: number;
  readonly day: number;
}

/**
 * Offset of `timeZone` from UTC at `instant`, in milliseconds (wall clock
 * minus UTC). Throws `RangeError` for an unknown zone; callers catch it.
 */
function zoneOffsetMs(instant: number, timeZone: string | undefined): number {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
  });
  const part = (type: Intl.DateTimeFormatPartTypes): number => {
    const found = formatter
      .formatToParts(instant)
      .find((entry) => entry.type === type);
    return found ? Number(found.value) : Number.NaN;
  };
  const hour = part('hour') % 24;
  const wallAsUtc = Date.UTC(
    part('year'),
    part('month') - 1,
    part('day'),
    hour,
    part('minute'),
    part('second'),
  );
  const wholeSecond = Math.floor(instant / MS_PER_SECOND) * MS_PER_SECOND;
  return wallAsUtc - wholeSecond;
}

function wallClockDate(
  instant: number,
  timeZone: string | undefined,
): WallClock {
  const wall = new Date(instant + zoneOffsetMs(instant, timeZone));
  return {
    year: wall.getUTCFullYear(),
    month: wall.getUTCMonth(),
    day: wall.getUTCDate(),
  };
}

/** The UTC instant at which the zone's wall clock shows the given time. */
function wallTimeToInstant(
  date: WallClock,
  hour: number,
  minute: number,
  second: number,
  timeZone: string | undefined,
): number {
  const wallAsUtc = Date.UTC(
    date.year,
    date.month,
    date.day,
    hour,
    minute,
    second,
  );
  const first = wallAsUtc - zoneOffsetMs(wallAsUtc, timeZone);
  const corrected = wallAsUtc - zoneOffsetMs(first, timeZone);
  return corrected;
}

interface ClockTime {
  readonly hour: number;
  readonly minute: number;
  readonly second: number;
}

function parseClockTime(text: string): ClockTime | undefined {
  for (const match of text.matchAll(CLOCK_TIME)) {
    const [, hourText, minuteText, secondText, meridiem] = match;
    if (minuteText === undefined && meridiem === undefined) continue;
    let hour = Number(hourText);
    const minute = minuteText === undefined ? 0 : Number(minuteText);
    const second = secondText === undefined ? 0 : Number(secondText);
    if (minute > 59 || second > 59) continue;
    if (meridiem !== undefined) {
      if (hour < 1 || hour > 12) continue;
      hour = (hour % 12) + (meridiem.toLowerCase() === 'p' ? 12 : 0);
    } else if (hour > 23) {
      continue;
    }
    return { hour, minute, second };
  }
  return undefined;
}

/**
 * Resolve a clock time stated in text ("try again at 5:05 PM", "resets 2am",
 * "17:05") to its next occurrence strictly after `observedAt`, in `timeZone`
 * (an IANA zone; the host's local zone when omitted). A time already passed
 * today resolves to tomorrow, so 00:10 seen at 23:50 is ten minutes later.
 *
 * Only a clock time is read; a bare number with neither minutes nor AM/PM is
 * ignored. Returns `undefined` when no clock time is found, `observedAt` is
 * not finite, or the zone is unknown.
 */
export function resolveClockTimeReset(
  text: string,
  observedAt: number,
  timeZone?: string,
): number | undefined {
  if (typeof text !== 'string' || !isFiniteNumber(observedAt)) return undefined;
  const clock = parseClockTime(text);
  if (clock === undefined) return undefined;

  try {
    const today = wallClockDate(observedAt, timeZone);
    const candidate = wallTimeToInstant(
      today,
      clock.hour,
      clock.minute,
      clock.second,
      timeZone,
    );
    if (candidate > observedAt) return candidate;
    const next = new Date(Date.UTC(today.year, today.month, today.day + 1));
    const tomorrow: WallClock = {
      year: next.getUTCFullYear(),
      month: next.getUTCMonth(),
      day: next.getUTCDate(),
    };
    return wallTimeToInstant(
      tomorrow,
      clock.hour,
      clock.minute,
      clock.second,
      timeZone,
    );
  } catch {
    // Intl rejects an unknown IANA zone with a RangeError: the reset is unknown.
    return undefined;
  }
}

/**
 * Resolve a compact relative duration (`"144h24m50s"`, `"2d3h"`, `"45s"`) to
 * an absolute instant after `observedAt`. Whitespace between parts is
 * ignored. Returns `undefined` for anything else.
 */
export function resolveRelativeReset(
  text: string,
  observedAt: number,
): number | undefined {
  if (typeof text !== 'string' || !isFiniteNumber(observedAt)) return undefined;
  const compact = text.replace(/\s+/g, '');
  if (compact.length === 0) return undefined;
  const match = RELATIVE_DURATION.exec(compact);
  if (match === null) return undefined;

  const [, days, hours, minutes, seconds] = match;
  const durationMs =
    Number(days ?? 0) * MS_PER_DAY +
    Number(hours ?? 0) * MS_PER_HOUR +
    Number(minutes ?? 0) * MS_PER_MINUTE +
    Number(seconds ?? 0) * MS_PER_SECOND;
  const resetAt = observedAt + durationMs;
  return Number.isFinite(resetAt) ? resetAt : undefined;
}

/** Kind, stable key and display label of one provider-declared window. */
export interface PlanWindowDescriptor {
  readonly kind: PlanWindowKind;
  readonly key: PlanWindowKey;
  readonly label: string;
}

/**
 * Classify a window by its declared duration in minutes.
 *
 * 300 → `five_hour`, 10080 → `weekly`, 43200 or 44640 → `monthly`. Any other
 * or absent duration is `other`, keyed and labelled by its 1-based position
 * in the provider's list ("Window 1", "Window 2"); a duration alone never
 * names a window the provider did not declare.
 */
export function windowKindFromDuration(
  durationMins: number | null | undefined,
  position: number,
): PlanWindowDescriptor {
  switch (durationMins) {
    case 300:
      return { kind: 'five_hour', key: 'five_hour', label: '5-hour session' };
    case 10_080:
      return { kind: 'weekly', key: 'weekly', label: 'Weekly' };
    case 43_200:
    case 44_640:
      return { kind: 'monthly', key: 'monthly', label: 'Monthly' };
    default: {
      const ordinal =
        Number.isInteger(position) && position > 0 ? position : undefined;
      return ordinal === undefined
        ? { kind: 'other', key: 'other:window', label: 'Window' }
        : {
            kind: 'other',
            key: `other:window-${ordinal}`,
            label: `Window ${ordinal}`,
          };
    }
  }
}
