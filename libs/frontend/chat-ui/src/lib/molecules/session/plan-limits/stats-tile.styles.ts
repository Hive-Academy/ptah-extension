/**
 * Class strings shared by the limit rows of the expanded stats card
 * (TASK_2026_596, design §1, §3.2, §8).
 *
 * Text is always `text-base-content` (or the registered `-muted` tier for
 * secondary text): semantic colours are only chip borders, chip tints, row
 * accents and usage-bar fills, never text colour, because warning, error,
 * success and info text fail contrast in at least one theme (design §8).
 */
import { PLAN_LIMIT_SOURCE_LABELS } from '@ptah-extension/shared';
import type {
  StatsChipTone,
  StatsTileTone,
} from './stats-limit-view-model.types';

/**
 * The face every limit row shares: a full-width disclosure button with a
 * left accent. The focus ring is `base-content`, not `info`: light `info` is
 * about 2.6:1 on the light card, under the 3:1 non-text minimum (visual
 * review finding 2).
 */
export const ROW_FACE =
  'block w-full text-left rounded-sm border-l-2 pl-1.5 pr-5 py-1 relative cursor-pointer transition-colors hover:bg-base-content/5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-base-content';

/** The detail panel opened inline under a row, full width. */
export const ROW_PANEL =
  'mt-0.5 mb-1 rounded border border-base-content/15 bg-base-100/40 px-2 pt-1 pb-1.5 text-xs';

/** Lane rows: dashed accent plus a different fill (Req 8 cue 2). */
export const LANE_ROW_FILL = 'border-dashed bg-base-300/40';

const CHIP_BASE =
  'inline-flex items-center gap-1 rounded border px-1 py-px text-[10px] leading-tight text-base-content whitespace-normal text-left';

const CHIP_TONE: Readonly<Record<StatsChipTone, string>> = {
  error: 'border-error bg-error/15',
  warning: 'border-warning bg-warning/15',
  success: 'border-success bg-success/15',
  info: 'border-info bg-info/15',
  live: 'border-success bg-success/15',
  neutral: 'border-base-content/20',
};

export function chipClass(tone: StatsChipTone): string {
  return `${CHIP_BASE} ${CHIP_TONE[tone]}`;
}

const ROW_ACCENT: Readonly<Record<StatsTileTone, string>> = {
  error: 'border-error',
  warning: 'border-warning',
  info: 'border-info',
  neutral: 'border-transparent',
};

/** Session plan row: the tone accent is redundant to the chip and the bar. */
export function planRowClass(tone: StatsTileTone): string {
  return `${ROW_FACE} ${ROW_ACCENT[tone]}`;
}

/**
 * Session plan card in the inspector (TASK_2026_699 design §3): a bordered
 * container with the tone accent on its left edge. It holds the face (a
 * disclosure button, or a plain `div` for non-expandable kinds) and the
 * detail panel, so it carries no padding, hover or focus of its own.
 */
export function planCardClass(tone: StatsTileTone): string {
  return `block w-full relative overflow-hidden rounded-md border border-surface-border bg-surface-1 border-l-2 ${ROW_ACCENT[tone]}`;
}

/** Lane row: dashed accent; a neutral lane keeps a visible dash. */
export function laneRowClass(tone: StatsTileTone): string {
  const accent =
    tone === 'neutral' ? 'border-base-content/40' : ROW_ACCENT[tone];
  return `${ROW_FACE} ${LANE_ROW_FILL} ${accent}`;
}

/** Usage at or above this percent fills the bar in the warning colour. */
const BAR_WARNING_PERCENT = 75;

/**
 * Fill colour of a plan row's usage bar: error for an error-toned row,
 * warning from 75%, success below. A fill is non-text, so the semantic
 * colour is allowed here (design §8).
 */
export function usageBarFillClass(
  tone: StatsTileTone,
  percent: number,
): string {
  return tone === 'error'
    ? 'bg-error'
    : percent >= BAR_WARNING_PERCENT
      ? 'bg-warning'
      : 'bg-success';
}

const UNOFFICIAL_LABELS = [
  PLAN_LIMIT_SOURCE_LABELS['provider-unofficial'],
  PLAN_LIMIT_SOURCE_LABELS.estimated,
];

/**
 * A source chip ("Provider API", "used · reset Provider API"). The two
 * unofficial classes are dashed and italic (design §1); the chip text always
 * ends with the source label, so the label decides the style.
 */
export function sourceChipClass(text: string): string {
  const base =
    'inline-block rounded border border-base-content/20 px-1 text-[10px] leading-tight text-base-content';
  return UNOFFICIAL_LABELS.some((label) => text.endsWith(label))
    ? `${base} border-dashed italic`
    : base;
}

let nextPanelId = 0;

/** A document-unique id for a row's detail panel (`aria-controls`). */
export function newPanelId(): string {
  nextPanelId += 1;
  return `ptah-stats-tile-panel-${nextPanelId}`;
}
