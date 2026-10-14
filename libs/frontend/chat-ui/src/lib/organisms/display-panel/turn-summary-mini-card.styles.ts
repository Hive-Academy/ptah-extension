/**
 * The Turn summary mini-card look, shared by the in-chat summary chip
 * (`turn-summary-chip.component.ts`) and the display panel's Turn summary
 * (`turn-summary.component.ts`) so the two never drift (TASK_2026_629 R9o,
 * decision 76; design section 7 collapse pattern; decision #70 flat chip).
 *
 * Only DaisyUI/Tailwind theme tokens: both `anubis` and `anubis-light` render
 * from the same classes. Class strings are literal so Tailwind keeps them.
 */

/** A pill's meaning is its text; the tone is a secondary cue only. */
export type MiniTone = 'neutral' | 'success' | 'error' | 'info' | 'warning';

/**
 * Host styles both summaries add to their own: the collapse pattern (hidden
 * body is `inert` plus `visibility:hidden`, motion only under
 * `prefers-reduced-motion: no-preference`) and the mini-card grid. The grid
 * fills its own width, never the viewport's: as many 104 px-or-wider columns
 * as fit, one column when even one would not.
 */
export const TURN_SUMMARY_MINI_STYLES = `
  :host { display: block; min-width: 0; }
  .dp-collapse { display: grid; grid-template-rows: 1fr; min-width: 0; }
  .dp-collapse[data-open='false'] { grid-template-rows: 0fr; visibility: hidden; }
  .dp-collapse-inner { min-height: 0; min-width: 0; }
  .dp-collapse[data-open='false'] > .dp-collapse-inner { overflow: hidden; }
  .dp-toggle { min-height: 2rem; }
  .dp-toggle:focus-visible { outline: 2px solid oklch(var(--bc)); outline-offset: 2px; }
  .dp-chevron[data-open='true'] { transform: rotate(180deg); }
  .ts-mini-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(100%, 104px), 1fr));
    gap: 0.5rem;
  }
  @media (prefers-reduced-motion: no-preference) {
    .dp-collapse { transition: grid-template-rows 220ms ease, visibility 220ms; }
    .dp-chevron { transition: transform 200ms ease; }
  }
`;

/** The flat summary surface (prototype `.chip`, decision #70). */
export const MINI_SECTION_CLASS =
  'min-w-0 rounded-box border border-base-300 bg-base-200 text-base-content';

/** One mini card: a `base-300` tile on the `base-200` surface. */
export const MINI_CARD_CLASS = 'min-w-0 rounded-box bg-base-300 px-2.5 py-2';

/** The card's label line ("Files", "Tokens"). */
export const MINI_LABEL_CLASS =
  'block text-xs font-medium text-base-content-muted';

/** Number-like values: large, tabular, may break anywhere to fit the card. */
export const MINI_VALUE_CLASS =
  'block break-words text-lg font-semibold tabular-nums';

/** Status-word values: wrap only at word boundaries (D2, #150). */
export const MINI_WORD_CLASS = 'block break-normal text-sm font-medium';

/** A muted caption under the value ("180.0k in · 4.2k out"). */
export const MINI_CAPTION_CLASS = 'block text-xs text-base-content-muted';

/**
 * A status word (`unavailable` / `pending`) is set smaller and never broken
 * mid-word; anything else, including `?`, is a number-style value.
 */
export function miniValueClass(value: string): string {
  return value === 'unavailable' || value === 'pending'
    ? MINI_WORD_CLASS
    : MINI_VALUE_CLASS;
}

/**
 * One-line pills (the chip's metric line, the summary header). Success and
 * error text use the AA-measured `.diff-add-text` / `.diff-del-text`
 * overrides.
 */
export const MINI_PILL_CLASS: Readonly<Record<MiniTone, string>> = {
  neutral: 'badge badge-sm badge-ghost h-auto whitespace-nowrap tabular-nums',
  success:
    'badge badge-sm badge-ghost h-auto whitespace-nowrap tabular-nums diff-add-text',
  error:
    'badge badge-sm badge-ghost h-auto whitespace-nowrap tabular-nums diff-del-text',
  info: 'badge badge-sm badge-info h-auto whitespace-nowrap tabular-nums',
  warning: 'badge badge-sm badge-warning h-auto whitespace-nowrap',
};

/**
 * Pills inside a mini card: the card can be 104 px wide, so a pill wraps
 * within the card instead of overflowing it ("baseline missing").
 */
export const MINI_CARD_PILL_CLASS: Readonly<Record<MiniTone, string>> = {
  neutral:
    'badge badge-sm badge-ghost h-auto max-w-full whitespace-normal py-0.5 text-left leading-tight',
  success:
    'badge badge-sm badge-ghost h-auto max-w-full whitespace-normal py-0.5 text-left leading-tight diff-add-text',
  error:
    'badge badge-sm badge-ghost h-auto max-w-full whitespace-normal py-0.5 text-left leading-tight diff-del-text',
  info: 'badge badge-sm badge-info h-auto max-w-full whitespace-normal py-0.5 text-left leading-tight',
  warning:
    'badge badge-sm badge-warning h-auto max-w-full whitespace-normal py-0.5 text-left leading-tight',
};
