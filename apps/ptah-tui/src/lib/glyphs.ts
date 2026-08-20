/**
 * Glyph vocabulary for the TUI chrome.
 *
 * Terminal FONTS are not ours to choose — the user's terminal decides whether
 * `┃` renders as a bar or as tofu. What IS ours is the decision of which code
 * points to emit. This module is the single place that decision is made, so a
 * terminal that cannot draw box-drawing characters gets an ASCII shell that is
 * still readable rather than a screen of replacement boxes.
 *
 * Ink-free on purpose: components import the resolved set, specs import the
 * resolver.
 */

export interface GlyphSet {
  /** Message gutter rail down the left of every chat turn. */
  readonly gutter: string;
  /** Vertical separator between status-line fields. */
  readonly separator: string;
  /** Horizontal rule fill. */
  readonly rule: string;
  /** Composer prompt marker. */
  readonly prompt: string;
  /** Unordered list bullet. */
  readonly bullet: string;
  /** Tool finished successfully. */
  readonly ok: string;
  /** Tool failed. */
  readonly error: string;
  /** Tool still running. */
  readonly running: string;
  /** Thinking / reasoning prefix. */
  readonly thinking: string;
  /** Brand mark on the welcome screen. */
  readonly logo: string;
  /** Selection / focus caret. */
  readonly caret: string;
  /** Streaming cursor appended to partial assistant text. */
  readonly cursor: string;
  /** Whether this set uses non-ASCII code points. */
  readonly unicode: boolean;
}

const UNICODE_GLYPHS: GlyphSet = {
  gutter: '│',
  separator: '·',
  rule: '─',
  prompt: '❯',
  bullet: '•',
  ok: '✓',
  error: '✗',
  running: '◐',
  thinking: '✻',
  logo: '◈',
  caret: '❯',
  cursor: '▌',
  unicode: true,
};

const ASCII_GLYPHS: GlyphSet = {
  gutter: '|',
  separator: '-',
  rule: '-',
  prompt: '>',
  bullet: '*',
  ok: '+',
  error: 'x',
  running: '.',
  thinking: '~',
  logo: '#',
  caret: '>',
  cursor: '_',
  unicode: false,
};

/**
 * Decide whether this terminal can be trusted with box-drawing glyphs.
 *
 * Explicit env overrides win, then known-hostile terminals, then the locale.
 * A locale that is set but says nothing about UTF-8 (`LANG=C`, `LANG=POSIX`)
 * is treated as ASCII-only; an unset locale is treated as modern, because
 * every current terminal emulator leaves it unset on Windows and macOS GUI
 * sessions where UTF-8 is nevertheless fine.
 */
export function prefersAsciiGlyphs(
  env: NodeJS.ProcessEnv,
  platform: string,
): boolean {
  if (env['PTAH_TUI_ASCII'] === '1') return true;
  if (env['PTAH_TUI_UNICODE'] === '1') return false;

  const term = env['TERM'];
  if (term === 'dumb' || term === 'linux') return true;

  if (platform === 'win32') {
    // The legacy conhost console renders box-drawing inconsistently and has no
    // reliable capability probe. Windows Terminal, VS Code's terminal and the
    // other modern hosts all announce themselves, so treat "announced" as the
    // signal and fall back to ASCII otherwise.
    const modernHost =
      env['WT_SESSION'] !== undefined ||
      env['TERM_PROGRAM'] !== undefined ||
      env['ConEmuANSI'] === 'ON' ||
      term !== undefined;
    return !modernHost;
  }

  const locale = env['LC_ALL'] ?? env['LC_CTYPE'] ?? env['LANG'];
  if (locale !== undefined && locale.length > 0) {
    return !/utf-?8/i.test(locale);
  }

  return false;
}

export function resolveGlyphSet(
  env: NodeJS.ProcessEnv = process.env,
  platform: string = process.platform,
): GlyphSet {
  return prefersAsciiGlyphs(env, platform) ? ASCII_GLYPHS : UNICODE_GLYPHS;
}

export const GLYPHS: GlyphSet = resolveGlyphSet();

/**
 * Ink draws its own borders, so an ASCII terminal needs the matching border
 * style or the composer keeps its `╭─╮` corners while everything inside it has
 * degraded to `+`.
 */
export function borderStyleFor(glyphs: GlyphSet = GLYPHS): 'round' | 'classic' {
  return glyphs.unicode ? 'round' : 'classic';
}

export const BORDER_STYLE = borderStyleFor();
