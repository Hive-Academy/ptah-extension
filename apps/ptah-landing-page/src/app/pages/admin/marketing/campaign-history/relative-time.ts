/**
 * relative-time — tiny, framework-free "time ago" formatter shared by the
 * Marketing hub rows (§3.4), Campaign History rows (§5.1) and Campaign Detail
 * metadata (§5.2). Uses the platform `Intl.RelativeTimeFormat`, so no extra
 * dependency and correct localisation for free.
 */

const DIVISIONS: readonly {
  amount: number;
  unit: Intl.RelativeTimeFormatUnit;
}[] = [
  { amount: 60, unit: 'second' },
  { amount: 60, unit: 'minute' },
  { amount: 24, unit: 'hour' },
  { amount: 7, unit: 'day' },
  { amount: 4.34524, unit: 'week' },
  { amount: 12, unit: 'month' },
  { amount: Number.POSITIVE_INFINITY, unit: 'year' },
];

const RTF = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });

/**
 * Format an ISO timestamp as a compact relative string (e.g. "3 days ago",
 * "just now"). Returns an em-dash for null/invalid input — never a fabricated
 * or `Invalid Date` value.
 */
export function relativeDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '—';

  let duration = (then - Date.now()) / 1000; // seconds, negative = past
  for (const { amount, unit } of DIVISIONS) {
    if (Math.abs(duration) < amount) {
      return RTF.format(Math.round(duration), unit);
    }
    duration /= amount;
  }
  return '—';
}
