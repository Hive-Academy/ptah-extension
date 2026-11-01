/**
 * Hero live-demo layout variations. One live-demo implementation renders all
 * three; a variation only changes the classes below and whether the window
 * tilts on scroll.
 *
 * - `stage`   (A): full-bleed wide window under the headline, tilted back and
 *                  flattened as the visitor scrolls, amber light beneath it.
 * - `split`   (B): headline left, a large window right that runs past the fold.
 * - `theater` (C): 16:9 window on a dark stage band, scenarios as chapter rails.
 */
export type LiveDemoVariant = 'stage' | 'split' | 'theater';

const QUERY_VALUES: Readonly<Record<string, LiveDemoVariant>> = {
  a: 'stage',
  b: 'split',
  c: 'theater',
};

/** Reads `?demo=a|b|c` from a `location.search` string. Anything else is `stage`. */
export function parseLiveDemoVariant(search: string): LiveDemoVariant {
  const value = new URLSearchParams(search).get('demo')?.trim().toLowerCase() ?? '';
  return QUERY_VALUES[value] ?? 'stage';
}

export interface LiveDemoLayout {
  /** Outer `<section>` spacing and width. */
  readonly section: string;
  /** Band behind the window (theater stage, or nothing). */
  readonly band: string;
  /** Width wrapper around glow + window; carries the 3D perspective for `stage`. */
  readonly frame: string;
  /** Light pooled behind the window. Empty string renders no glow. */
  readonly glow: string;
  /** The window itself (border, radius, shadow). */
  readonly window: string;
  /** Aspect ratio of the replay viewport. */
  readonly viewport: string;
  /** Visible heading block; when false the heading is screen-reader only. */
  readonly showHeading: boolean;
  readonly tablist: string;
  readonly tab: string;
  readonly tabActive: string;
  readonly tabIdle: string;
  /** Theater draws a progress rail on every tab (chapter markers). */
  readonly chapterRails: boolean;
  readonly caption: string;
  /** Scroll-linked perspective tilt on wide screens. */
  readonly tilt: boolean;
}

const PILL_TAB =
  'shrink-0 rounded-full border px-4 py-2 text-sm font-semibold transition-colors';

export const LIVE_DEMO_LAYOUTS: Readonly<Record<LiveDemoVariant, LiveDemoLayout>> = {
  stage: {
    section: 'pb-12 sm:pb-16',
    band: '',
    frame: 'relative mx-auto w-full max-w-[1280px] px-3 sm:px-6 lg:[perspective:2000px]',
    glow: 'absolute inset-x-[8%] top-[12%] bottom-[-6%] rounded-[50%] bg-amber-500/25 blur-[90px]',
    window: 'rounded-2xl border border-ink-600 bg-ink-900 shadow-device',
    viewport: 'aspect-[8/5]',
    showHeading: false,
    tablist: 'mx-auto mt-8 flex max-w-full justify-start gap-2 overflow-x-auto px-3 pb-2 sm:justify-center sm:px-6',
    tab: PILL_TAB,
    tabActive: 'border-amber-400 bg-amber-400 text-ink-950',
    tabIdle: 'border-ink-600 bg-ink-900/70 text-ink-100 hover:border-ink-400',
    chapterRails: false,
    caption: 'mx-auto mt-6 max-w-4xl px-4 text-center sm:px-6',
    tilt: true,
  },
  split: {
    section: 'pb-16 lg:pb-0',
    band: '',
    frame: 'relative w-full',
    glow: 'absolute -inset-6 rounded-[2rem] bg-amber-500/15 blur-3xl',
    window: 'rounded-2xl border border-ink-600 bg-ink-900 shadow-device',
    viewport: 'aspect-[8/5] lg:aspect-[4/3]',
    showHeading: false,
    tablist: 'mt-6 flex gap-2 overflow-x-auto pb-2',
    tab: PILL_TAB,
    tabActive: 'border-amber-400 bg-amber-400 text-ink-950',
    tabIdle: 'border-ink-600 bg-ink-900/70 text-ink-100 hover:border-ink-400',
    chapterRails: false,
    caption: 'mt-4',
    tilt: false,
  },
  theater: {
    section: 'pb-12 sm:pb-16',
    band:
      'absolute inset-0 border-y border-ink-800 bg-[radial-gradient(ellipse_at_50%_20%,theme(colors.ink.800),theme(colors.ink.950)_70%)]',
    frame: 'relative mx-auto w-full max-w-[1200px] px-3 sm:px-6',
    glow: '',
    window: 'rounded-lg border border-ink-700 bg-ink-950 shadow-device',
    viewport: 'aspect-[8/5] lg:aspect-video',
    showHeading: true,
    tablist: 'mx-auto mt-8 grid max-w-[1200px] grid-flow-col auto-cols-[minmax(9rem,1fr)] gap-4 overflow-x-auto px-3 pb-2 sm:px-6',
    tab: 'flex flex-col items-start gap-3 rounded-md px-1 pb-1 pt-0 text-left text-sm font-semibold transition-colors',
    tabActive: 'text-white',
    tabIdle: 'text-ink-400 hover:text-ink-100',
    chapterRails: true,
    caption: 'mx-auto mt-6 max-w-[1200px] px-4 sm:px-6',
    tilt: false,
  },
};
