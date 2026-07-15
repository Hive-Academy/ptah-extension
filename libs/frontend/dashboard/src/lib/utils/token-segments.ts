import { DashboardSessionEntry } from '../services/session-analytics-state.service';

/**
 * A single slice of a session's token composition, carrying both its value and
 * the Tailwind/daisyUI classes that colour it. Shared by the per-session card
 * and the session-detail modal so the two views stay visually identical.
 */
export interface TokenSegment {
  readonly key: 'input' | 'output' | 'cacheRead' | 'cacheCreation';
  readonly label: string;
  readonly value: number;
  readonly pct: number;
  readonly barClass: string;
  readonly dotClass: string;
  readonly textClass: string;
}

/**
 * Build the four token-composition segments (input / output / cache read /
 * cache write) with their share-of-total percentage. Percentages are computed
 * against the summed total (guarded to 1 to avoid divide-by-zero), so callers
 * can render the bar and legend directly.
 */
export function computeTokenSegments(
  tokens: DashboardSessionEntry['tokens'],
): readonly TokenSegment[] {
  const total =
    tokens.input + tokens.output + tokens.cacheRead + tokens.cacheCreation || 1;
  const defs: ReadonlyArray<Omit<TokenSegment, 'pct'>> = [
    {
      key: 'input',
      label: 'Input',
      value: tokens.input,
      barClass: 'bg-cyan-400',
      dotClass: 'bg-cyan-400',
      textClass: 'text-cyan-400',
    },
    {
      key: 'output',
      label: 'Output',
      value: tokens.output,
      barClass: 'bg-purple-400',
      dotClass: 'bg-purple-400',
      textClass: 'text-purple-400',
    },
    {
      key: 'cacheRead',
      label: 'Cache Read',
      value: tokens.cacheRead,
      barClass: 'bg-info',
      dotClass: 'bg-info',
      textClass: 'text-info',
    },
    {
      key: 'cacheCreation',
      label: 'Cache Write',
      value: tokens.cacheCreation,
      barClass: 'bg-warning',
      dotClass: 'bg-warning',
      textClass: 'text-warning',
    },
  ];
  return defs.map((d) => ({ ...d, pct: (d.value / total) * 100 }));
}
