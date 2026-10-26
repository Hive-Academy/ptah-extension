/**
 * Lane detail table helpers (chat layout declutter, Revision 2 item 9): the
 * run status badge, the Started cell, the columns a subgroup's run table
 * keeps and the single limit/owner footnote. Pure; the lane tile builder
 * (`lane-tiles.ts`) calls them.
 */
import type { LocalTimeOptions } from '@ptah-extension/shared';
import type {
  LaneRunColumns,
  LaneRunRowModel,
  LaneRunStarted,
  StatsChip,
  StatsLimitLaneRun,
  StatsLimitNote,
} from './stats-limit-view-model.types';

const STATUS_BADGES: Readonly<
  Record<StatsLimitLaneRun['status'], StatsChip>
> = {
  running: { tone: 'live', text: 'Running' },
  completed: { tone: 'neutral', text: 'Completed' },
  failed: { tone: 'error', text: 'Failed' },
  timeout: { tone: 'error', text: 'Timed out' },
  stopped: { tone: 'neutral', text: 'Stopped' },
};

/** The run's status as one badge; a quota failure names its cause. */
export function runStatusBadge(run: StatsLimitLaneRun): StatsChip {
  return run.status !== 'running' && run.failureKind === 'quota'
    ? { tone: 'error', text: 'Quota failure' }
    : STATUS_BADGES[run.status];
}

/** An unknown or invalid zone renders UTC, as `formatLocalAbsolute` does. */
function zoneOrUtc(timeZone: string | undefined): string | undefined {
  if (timeZone === undefined) return undefined;
  try {
    // Throws a RangeError for a zone this runtime does not know.
    return new Intl.DateTimeFormat('en-US', { timeZone }).resolvedOptions()
      .timeZone;
  } catch {
    return 'UTC';
  }
}

function parts(
  instant: number,
  options: Intl.DateTimeFormatOptions,
): Partial<Record<Intl.DateTimeFormatPartTypes, string>> {
  const out: Partial<Record<Intl.DateTimeFormatPartTypes, string>> = {};
  for (const part of new Intl.DateTimeFormat('en-US', options).formatToParts(
    instant,
  )) {
    out[part.type] = part.value;
  }
  return out;
}

/**
 * Started cell: short `d MMM HH:mm` text and the full timestamp for its
 * `title` ("Mon 5 Oct 2026 11:00 UTC"). `undefined` for an invalid instant.
 */
export function formatRunStarted(
  instant: number,
  time: LocalTimeOptions,
): LaneRunStarted | undefined {
  if (!Number.isFinite(instant)) return undefined;
  const timeZone = zoneOrUtc(time.timeZone);
  const p = parts(instant, {
    timeZone,
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  const zone = new Intl.DateTimeFormat(time.zoneNameLocale ?? 'en-US', {
    timeZone,
    timeZoneName: 'short',
  })
    .formatToParts(instant)
    .find((part) => part.type === 'timeZoneName')?.value;
  const clock = `${p.hour}:${p.minute}`;
  return {
    short: `${p.day} ${p.month} ${clock}`,
    full: `${p.weekday} ${p.day} ${p.month} ${p.year} ${clock}${zone ? ` ${zone}` : ''}`,
  };
}

/**
 * The run table keeps a column only when at least one run has a known
 * value; a column that would repeat "unknown" or "—" on every run is dropped.
 */
export function laneRunColumns(
  rows: readonly LaneRunRowModel[],
  unknown: string,
): LaneRunColumns {
  return {
    model: rows.some((row) => row.model !== null),
    tokens: rows.some((row) => row.tokensText !== unknown),
    cost: rows.some((row) => row.costText !== unknown),
    started: rows.some((row) => row.started !== undefined),
  };
}

/**
 * The owner text and notes of a subgroup as one footnote line: the
 * ` · `-separated phrases in order, each once, without `omit` (the limit
 * state the lane summary line already states).
 */
export function subgroupFootnote(
  ownerText: string,
  notes: readonly StatsLimitNote[],
  omit: string,
): string {
  const phrases = [ownerText, ...notes.map((note) => note.text)]
    .flatMap((text) => text.split(' · '))
    .map((phrase) => phrase.trim())
    .filter((phrase) => phrase.length > 0 && phrase !== omit);
  return [...new Set(phrases)].join(' · ');
}
