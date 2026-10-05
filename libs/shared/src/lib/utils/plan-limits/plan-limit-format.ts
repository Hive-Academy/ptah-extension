/**
 * Plan-limit time and source formatting (TASK_2026_596, design §0.4, §1;
 * Gate 1.7 T1 = local zone with abbreviation, T2 = short source labels).
 *
 * Shared by the webview (local times, short source chips) and the agent tool
 * text (UTC times, canonical source enum names). Pure: `now`, the time zone
 * and the zone-name locale are parameters, so output is the same on every
 * machine under test. Nothing throws; an invalid instant renders "unknown".
 *
 * Static text here names no provider: window labels and agent names come
 * from the data.
 */
import type {
  PlanLimitSource,
  PlanLimitUsed,
  PlanLimitWindow,
} from '../../types/plan-limit.types';
import { resetPassage } from './window-state';

const MS_PER_MINUTE = 60_000;
const MINUTES_PER_HOUR = 60;
const MINUTES_PER_DAY = 24 * MINUTES_PER_HOUR;

const UNKNOWN = 'unknown';

/** Where and how to render a local absolute time. */
export interface LocalTimeOptions {
  /** IANA zone; the host's zone when omitted. An unknown zone renders UTC. */
  readonly timeZone?: string;
  /**
   * Locale used only for the zone abbreviation (`en-GB` gives "CEST",
   * `en-US` gives "EDT"). Weekday, month and digits are always English to
   * match the surrounding text. Host default when omitted.
   */
  readonly zoneNameLocale?: string;
}

function isFiniteInstant(value: number): boolean {
  return typeof value === 'number' && Number.isFinite(value);
}

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

/**
 * Relative time from `now`, minute precision: "in 3h 10m", "22m ago",
 * "in 1d 21h", "in 0m".
 */
export function formatRelative(instant: number, now: number): string {
  if (!isFiniteInstant(instant) || !isFiniteInstant(now)) return UNKNOWN;
  const signed = Math.round((instant - now) / MS_PER_MINUTE);
  const total = Math.abs(signed);
  const days = Math.floor(total / MINUTES_PER_DAY);
  const hours = Math.floor((total % MINUTES_PER_DAY) / MINUTES_PER_HOUR);
  const minutes = total % MINUTES_PER_HOUR;
  let span: string;
  if (days > 0) span = `${days}d ${hours}h`;
  else if (hours > 0) span = `${hours}h ${minutes}m`;
  else span = `${minutes}m`;
  return signed < 0 ? `${span} ago` : `in ${span}`;
}

interface WallClockParts {
  readonly year: string;
  readonly month: string;
  readonly day: string;
  readonly weekday: string;
  readonly monthName: string;
  readonly hour: string;
  readonly minute: string;
}

function wallClockParts(instant: number, timeZone: string): WallClockParts {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(instant);
  const part = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((entry) => entry.type === type)?.value ?? '';
  const monthName = new Intl.DateTimeFormat('en-US', {
    timeZone,
    month: 'short',
  }).format(instant);
  return {
    year: part('year'),
    month: part('month'),
    day: part('day'),
    weekday: part('weekday'),
    monthName,
    hour: pad2(Number(part('hour')) % 24),
    minute: part('minute'),
  };
}

function zoneAbbreviation(
  instant: number,
  timeZone: string,
  locale: string | undefined,
): string {
  return (
    new Intl.DateTimeFormat(locale, { timeZone, timeZoneName: 'short' })
      .formatToParts(instant)
      .find((entry) => entry.type === 'timeZoneName')?.value ?? timeZone
  );
}

function resolveTimeZone(timeZone: string | undefined): string {
  const zone =
    timeZone ?? new Intl.DateTimeFormat().resolvedOptions().timeZone ?? 'UTC';
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone });
    return zone;
  } catch {
    // degradation-audit: optional-capability - an unknown IANA zone falls back
    // to UTC so the render does not fail.
    // Intl rejects an unknown IANA zone with a RangeError; fall back to UTC
    // rather than fail the render.
    return 'UTC';
  }
}

/**
 * Local absolute time with the zone abbreviation (design §0.4, T1):
 * "today 15:10 CEST" on the same calendar day as `now` in that zone,
 * otherwise "Thu 8 Oct 09:00 CEST".
 */
export function formatLocalAbsolute(
  instant: number,
  now: number,
  options: LocalTimeOptions = {},
): string {
  if (!isFiniteInstant(instant) || !isFiniteInstant(now)) return UNKNOWN;
  const zone = resolveTimeZone(options.timeZone);
  const at = wallClockParts(instant, zone);
  const today = wallClockParts(now, zone);
  const sameDay =
    at.year === today.year && at.month === today.month && at.day === today.day;
  const date = sameDay ? 'today' : `${at.weekday} ${at.day} ${at.monthName}`;
  const zoneName = zoneAbbreviation(instant, zone, options.zoneNameLocale);
  return `${date} ${at.hour}:${at.minute} ${zoneName}`;
}

/**
 * Absolute and relative together, as every surface shows them (design §0.4):
 * "today 15:10 CEST · in 3h 10m".
 */
export function formatLocalWithRelative(
  instant: number,
  now: number,
  options: LocalTimeOptions = {},
): string {
  if (!isFiniteInstant(instant) || !isFiniteInstant(now)) return UNKNOWN;
  return `${formatLocalAbsolute(instant, now, options)} · ${formatRelative(instant, now)}`;
}

/** Tool timestamp: "2026-10-03 15:10 UTC". */
export function formatToolUtc(instant: number): string {
  if (!isFiniteInstant(instant)) return UNKNOWN;
  const date = new Date(instant);
  return (
    `${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}-${pad2(date.getUTCDate())} ` +
    `${pad2(date.getUTCHours())}:${pad2(date.getUTCMinutes())} UTC`
  );
}

/** Tool timestamp with relative time: "2026-10-03 15:10 UTC (in 3h 10m)". */
export function formatToolInstant(instant: number, now: number): string {
  if (!isFiniteInstant(instant) || !isFiniteInstant(now)) return UNKNOWN;
  return `${formatToolUtc(instant)} (${formatRelative(instant, now)})`;
}

/** Short source labels (design §1, T2 default). */
export const PLAN_LIMIT_SOURCE_LABELS: Readonly<
  Record<PlanLimitSource, string>
> = {
  'provider-api': 'Provider API',
  'provider-unofficial': 'Unofficial',
  'stream-event': 'Live event',
  'error-derived': 'From error',
  estimated: '~ Estimate',
};

/** The three claims a window can carry (design §1). */
export type PlanLimitField = 'used' | 'reset' | 'limit';

/** Fields of one window that share a source. */
export interface PlanLimitFieldSourceGroup {
  readonly source: PlanLimitSource;
  readonly fields: readonly PlanLimitField[];
}

/**
 * Group a window's used, reset and limit claims by source, in field order.
 * A claim with no value (unknown used, unknown reset) carries no source.
 */
export function windowFieldSources(
  window: PlanLimitWindow,
): readonly PlanLimitFieldSourceGroup[] {
  const claims: Array<[PlanLimitField, PlanLimitSource | undefined]> = [
    ['used', window.used !== undefined ? window.usedSource : undefined],
    ['reset', window.resetsAt !== undefined ? window.resetSource : undefined],
    ['limit', window.exhaustion?.source],
  ];
  const groups = new Map<PlanLimitSource, PlanLimitField[]>();
  for (const [field, source] of claims) {
    if (source === undefined) continue;
    const fields = groups.get(source);
    if (fields) fields.push(field);
    else groups.set(source, [field]);
  }
  return [...groups].map(([source, fields]) => ({ source, fields }));
}

/**
 * Short source chips for a window: one chip when every claim shares a
 * source ("Provider API"); otherwise each chip is prefixed with its fields
 * ("used · reset Provider API", "limit From error").
 */
export function formatSourceChips(window: PlanLimitWindow): readonly string[] {
  const groups = windowFieldSources(window);
  if (groups.length === 1) return [PLAN_LIMIT_SOURCE_LABELS[groups[0].source]];
  return groups.map(
    ({ source, fields }) =>
      `${fields.join(' · ')} ${PLAN_LIMIT_SOURCE_LABELS[source]}`,
  );
}

/**
 * Tool source text with canonical enum names: "provider-api", or
 * "used+reset provider-api; limit error-derived". "-" when no claim has a
 * source.
 */
export function formatToolSourceText(window: PlanLimitWindow): string {
  const groups = windowFieldSources(window);
  if (groups.length === 0) return '-';
  if (groups.length === 1) return groups[0].source;
  return groups
    .map(({ source, fields }) => `${fields.join('+')} ${source}`)
    .join('; ');
}

function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

/**
 * A used value: "94%", "$3.20 of $50.00", "120 of 500 requests", or
 * "unknown". An unknown or unusable value is never rendered as 0.
 */
export function formatUsed(used: PlanLimitUsed | undefined): string {
  if (used === undefined) return UNKNOWN;
  if (used.kind === 'percent') {
    return Number.isFinite(used.percent)
      ? `${Math.round(used.percent)}%`
      : UNKNOWN;
  }
  if (!Number.isFinite(used.amount) || !Number.isFinite(used.limit)) {
    return UNKNOWN;
  }
  if (used.unit.trim().toUpperCase() === 'USD') {
    return `$${used.amount.toFixed(2)} of $${used.limit.toFixed(2)}`;
  }
  return `${formatNumber(used.amount)} of ${formatNumber(used.limit)} ${used.unit}`.trim();
}

/**
 * Tool reset cell for one window (design §5):
 *
 * - a reset after the last observation: "reset passed <time>; next reset
 *   <time | unknown>; last observed <time>, before it";
 * - a known reset: "resets <time>" or "reset passed <time>";
 * - otherwise "reset unknown".
 *
 * The window's own reset wins; an exhaustion's reset is used when the window
 * states none. Times are UTC with relative time.
 */
export function formatToolResetText(
  window: PlanLimitWindow,
  now: number,
): string {
  const passage = resetPassage(window, now);
  if (passage !== undefined) {
    const next =
      passage.nextResetAt === undefined
        ? UNKNOWN
        : formatToolInstant(passage.nextResetAt, now);
    return (
      `reset passed ${formatToolInstant(passage.passedAt, now)}; ` +
      `next reset ${next}; ` +
      `last observed ${formatToolUtc(passage.lastObservedAt)}, before it`
    );
  }
  const resetsAt = window.resetsAt ?? window.exhaustion?.resetsAt;
  if (resetsAt === undefined || !isFiniteInstant(resetsAt)) {
    return 'reset unknown';
  }
  return resetsAt <= now
    ? `reset passed ${formatToolInstant(resetsAt, now)}`
    : `resets ${formatToolInstant(resetsAt, now)}`;
}
