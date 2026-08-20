/**
 * Pure presentation helpers shared by the Schedules surfaces.
 *
 * The cron tab header, the job cards and the detail drawer all render the same
 * handful of derived strings (timestamps, relative deltas, status tone). They
 * live here as free functions so there is exactly one definition of "what does
 * a paused job's next run read as" instead of three drifting copies.
 *
 * DATA LIMIT (deliberate). `ScheduledJobDto` carries `lastRunAt` but no
 * last-run *status* — run outcomes only exist in `cron:runs`, which is fetched
 * for the selected job alone. So a card can say WHEN a job last ran, never HOW
 * it went. Do not synthesise a per-card outcome from `enabled` or `nextRunAt`;
 * that would be a fabricated status. The drawer's run history is the only place
 * outcomes are shown.
 */
import type { JobRunDto, ScheduledJobDto } from '@ptah-extension/shared';
import type { NativeCardTone } from '@ptah-extension/ui';

/** One labelled figure inside a job card's metric list. */
export interface CronJobMetric {
  /** Short column heading, e.g. `Next run`. */
  readonly label: string;
  /** Primary value. Never empty — falls back to an explicit phrase. */
  readonly value: string;
  /** Secondary line (relative time, human cron description) or `null`. */
  readonly hint: string | null;
  /** Render {@link value} in the monospace face (cron expressions). */
  readonly mono: boolean;
}

/** Placeholder for an absent timestamp. */
const NO_TIME = '—';

/**
 * Absolute local timestamp, or `—` when unknown. Falls back to the raw epoch
 * if the host `Intl` data rejects the value rather than throwing at render.
 */
export function formatTime(epochMs: number | null | undefined): string {
  if (epochMs === null || epochMs === undefined) return NO_TIME;
  try {
    return new Date(epochMs).toLocaleString();
  } catch {
    return String(epochMs);
  }
}

/**
 * Coarse relative delta (`in 5m`, `3h ago`). Empty string when unknown, so
 * callers can drop the line entirely instead of rendering a placeholder.
 */
export function formatRelative(epochMs: number | null | undefined): string {
  if (epochMs === null || epochMs === undefined) return '';
  const delta = epochMs - Date.now();
  const absMs = Math.abs(delta);
  const minutes = Math.round(absMs / 60_000);
  const future = delta >= 0;
  if (minutes < 1) return future ? 'in <1m' : 'just now';
  if (minutes < 60) return future ? `in ${minutes}m` : `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return future ? `in ${hours}h` : `${hours}h ago`;
  const days = Math.round(hours / 24);
  return future ? `in ${days}d` : `${days}d ago`;
}

/** daisyUI background class for a run-history status dot. */
export function runStatusDotClass(status: JobRunDto['status']): string {
  switch (status) {
    case 'succeeded':
      return 'bg-success';
    case 'failed':
      return 'bg-error';
    case 'running':
      return 'bg-info';
    case 'skipped':
      return 'bg-warning';
    default:
      return 'bg-base-content/30';
  }
}

/**
 * Card tone for a job. Only two states exist on the DTO — a job is either
 * armed (`success`) or parked (`neutral`).
 */
export function jobTone(job: ScheduledJobDto): NativeCardTone {
  return job.enabled ? 'success' : 'neutral';
}

/** Background class for the enabled/disabled dot in a card header. */
export function jobDotClass(job: ScheduledJobDto): string {
  return job.enabled ? 'bg-success' : 'bg-base-content/30';
}

/** Lower-case status word rendered beside {@link jobDotClass}. */
export function jobStatusLabel(job: ScheduledJobDto): string {
  return job.enabled ? 'enabled' : 'disabled';
}

/**
 * The three figures every job card and the drawer header show.
 *
 * @param job - the schedule being described
 * @param scheduleDescription - human rendering of `job.cronExpr`, produced by
 *   `CronExpressionService.describe`; passed in so this module stays free of
 *   Angular DI.
 */
export function buildJobMetrics(
  job: ScheduledJobDto,
  scheduleDescription: string,
): readonly CronJobMetric[] {
  return [
    {
      label: 'Schedule',
      value: job.cronExpr,
      hint: scheduleDescription.length > 0 ? scheduleDescription : null,
      mono: true,
    },
    nextRunMetric(job),
    lastRunMetric(job),
  ];
}

/**
 * A disabled job has no next occurrence even if the backend left a stale
 * `nextRunAt` on the record, so `enabled` is checked before the timestamp.
 */
function nextRunMetric(job: ScheduledJobDto): CronJobMetric {
  if (!job.enabled) {
    return { label: 'Next run', value: 'Paused', hint: null, mono: false };
  }
  if (job.nextRunAt === null) {
    return {
      label: 'Next run',
      value: 'Not scheduled',
      hint: null,
      mono: false,
    };
  }
  return {
    label: 'Next run',
    value: formatTime(job.nextRunAt),
    hint: formatRelative(job.nextRunAt),
    mono: false,
  };
}

function lastRunMetric(job: ScheduledJobDto): CronJobMetric {
  if (job.lastRunAt === null) {
    return { label: 'Last run', value: 'Never run', hint: null, mono: false };
  }
  return {
    label: 'Last run',
    value: formatTime(job.lastRunAt),
    hint: formatRelative(job.lastRunAt),
    mono: false,
  };
}
