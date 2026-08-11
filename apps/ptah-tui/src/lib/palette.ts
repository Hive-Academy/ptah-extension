/**
 * Colour-depth adaptation for the theme palette.
 *
 * The themes are authored as hex, and Ink emits hex as a 24-bit SGR sequence
 * (`ESC[38;2;r;g;b m`) *unconditionally* — it does not consult chalk's detected
 * colour level the way plain chalk string helpers do. Verified by capture:
 * `FORCE_COLOR=1` still produced `38;2;6;182;212`. On a genuine 16-colour
 * terminal those sequences are ignored, so the entire semantic palette — user
 * vs assistant, ok vs error — collapses to one undifferentiated foreground.
 *
 * The downsample is therefore ours. It is a fixed semantic assignment rather
 * than a nearest-colour search: a search over sixteen slots sends `#10b981`
 * (success green) and `#06b6d4` (assistant cyan) to the same slot, and sends
 * every pastel in the dracula and nord themes to plain white — which loses
 * exactly the distinctions the colour is carrying. Sixteen colours cannot
 * express six themes, so at this depth there is one palette per background
 * polarity and the theme choice stops mattering. Distinctness is asserted by
 * spec.
 *
 * `NO_COLOR` needs nothing: chalk strips SGR entirely at that level, confirmed
 * by capture (zero escape sequences emitted).
 *
 * Ink-free on purpose so it is unit-testable.
 */

import type { TuiTheme } from '../hooks/use-theme.js';

export type ColorDepth = 'none' | 'ansi16' | 'truecolor';

export type ThemePolarity = 'light' | 'dark';

/** For a dark background: `white` reads, `black` does not. */
export const ANSI16_DARK: TuiTheme = {
  roles: {
    user: 'green',
    assistant: 'cyan',
    system: 'yellow',
  },
  status: {
    success: 'green',
    error: 'red',
    warning: 'yellow',
    info: 'blue',
  },
  ui: {
    border: 'gray',
    borderActive: 'cyan',
    borderSubtle: 'gray',
    dimmed: 'gray',
    accent: 'cyan',
    muted: 'white',
    brand: 'magenta',
  },
};

/** For a light background: the bright slots wash out, so use the dim ones. */
export const ANSI16_LIGHT: TuiTheme = {
  roles: {
    user: 'green',
    assistant: 'blue',
    system: 'yellow',
  },
  status: {
    success: 'green',
    error: 'red',
    warning: 'yellow',
    info: 'blue',
  },
  ui: {
    border: 'gray',
    borderActive: 'blue',
    borderSubtle: 'gray',
    dimmed: 'gray',
    accent: 'blue',
    muted: 'black',
    brand: 'magenta',
  },
};

export function resolveColorDepth(
  env: NodeJS.ProcessEnv = process.env,
): ColorDepth {
  const noColor = env['NO_COLOR'];
  if (noColor !== undefined && noColor !== '') return 'none';

  const force = env['FORCE_COLOR'];
  if (force === '0') return 'none';
  if (force === '1') return 'ansi16';
  if (force === '2' || force === '3') return 'truecolor';

  const term = env['TERM'];
  if (term === 'dumb') return 'none';

  const colorTerm = env['COLORTERM'] ?? '';
  if (/truecolor|24bit/i.test(colorTerm)) return 'truecolor';

  if (term !== undefined && /256|direct/i.test(term)) return 'truecolor';
  if (term !== undefined && term.length > 0) return 'ansi16';

  // No TERM at all: Windows Terminal and the VS Code terminal both leave it
  // unset and both do truecolor, so this is the modern default rather than a
  // pessimistic one.
  return 'truecolor';
}

/**
 * At `truecolor` the theme passes through untouched; at `none` chalk already
 * strips every sequence, so rewriting it would change nothing on screen.
 */
export function adaptTheme(
  theme: TuiTheme,
  depth: ColorDepth,
  polarity: ThemePolarity = 'dark',
): TuiTheme {
  if (depth !== 'ansi16') return theme;
  return polarity === 'light' ? ANSI16_LIGHT : ANSI16_DARK;
}
