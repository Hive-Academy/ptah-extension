/**
 * Class strings shared by the stats-grid limit tiles (TASK_2026_596,
 * design §1, §3.2, §8).
 *
 * Text is always `text-base-content` (or the registered `-muted` tier for
 * secondary text): semantic colours are only chip borders, chip tints and tile
 * borders, never text colour, because warning, error, success and info text
 * fail contrast in at least one theme (design §8).
 */
import { PLAN_LIMIT_SOURCE_LABELS } from '@ptah-extension/shared';
import type {
  StatsChipTone,
  StatsTileTone,
} from './stats-limit-view-model.types';

/** The card face every tile shares with the existing session cards. */
export const TILE_FACE =
  'block w-full text-left rounded px-2 py-1.5 border relative pr-5 cursor-pointer transition-colors hover:bg-base-200/80 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-info';

/** The detail panel joined under an open tile. */
export const TILE_PANEL =
  'rounded-b border border-t-0 border-base-content/15 bg-base-200/40 px-2 pt-1 pb-1.5 text-xs';

/** Lane tiles: dashed border plus a different fill (Req 8 cue 2). */
export const LANE_FACE_FILL = 'border-dashed bg-base-300/40';

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

const TILE_BORDER: Readonly<Record<StatsTileTone, string>> = {
  error: 'border-error',
  warning: 'border-warning',
  info: 'border-info',
  neutral: 'border-base-content/10',
};

/** Solid session tile: card fill plus the tone border (redundant to the chip). */
export function planFaceClass(tone: StatsTileTone): string {
  return `${TILE_FACE} bg-base-200/50 ${TILE_BORDER[tone]}`;
}

/** Lane tile: dashed border; a neutral lane keeps a stronger dash. */
export function laneFaceClass(tone: StatsTileTone): string {
  const border =
    tone === 'neutral' ? 'border-base-content/40' : TILE_BORDER[tone];
  return `${TILE_FACE} ${LANE_FACE_FILL} ${border}`;
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

/** A document-unique id for a tile's detail panel (`aria-controls`). */
export function newPanelId(): string {
  nextPanelId += 1;
  return `ptah-stats-tile-panel-${nextPanelId}`;
}
