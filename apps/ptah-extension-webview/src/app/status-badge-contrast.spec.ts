/**
 * TASK_2026_576 Batch 24 — the file-status badge and the anubis ink overrides
 * must clear WCAG AA.
 *
 * `ptah-file-status-badge` (libs/frontend/ui) draws a `text-base-content`
 * letter on `bg-base-300`; the status hue is only a 2 px accent. So its
 * contrast is the base-content / base-300 pair, and that pair has to hold in
 * every theme the picker reaches, not only in anubis.
 *
 * The anubis-only overrides in styles.css (`--ptah-error-ink`,
 * `.err-solid-text`, `.ok-solid-text`, `.diff-add-text`) and the anubis-light
 * focus ring are re-measured from the committed CSS against the literal theme
 * sources, the same way `base-content-muted.spec.ts` does, so a mistyped
 * value or an upstream colour change fails here.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DAISYUI_THEMES } from '@ptah-extension/core';

const { interpolate, parse, wcagContrast } = require('culori/require');
const BUILTIN_THEMES = require('daisyui/src/theming/themes.js');
const TAILWIND_CONFIG = require('../../tailwind.config.js');

const STYLES_CSS = readFileSync(join(__dirname, '..', 'styles.css'), 'utf8');

/** WCAG AA for normal-size text; the badge letter is 10 px. */
const AA_NORMAL = 4.5;
/** WCAG 1.4.11 non-text contrast: focus indicators, icons, borders. */
const AA_NON_TEXT = 3;

const ANUBIS_THEMES = ['anubis', 'anubis-light'] as const;
type AnubisTheme = (typeof ANUBIS_THEMES)[number];
const BASE_LAYERS = ['b1', 'b2', 'b3'] as const;

type ThemeSource = Record<string, string>;

const customThemes: Record<string, ThemeSource> =
  TAILWIND_CONFIG.daisyui.themes.find(
    (entry: unknown) => typeof entry === 'object' && entry !== null,
  );

const isDark = (color: unknown): boolean =>
  wcagContrast(color, 'black') < wcagContrast(color, 'white');

const darken = (color: unknown, amount: number): unknown =>
  interpolate([color, 'black'], 'oklch')(amount);

interface ResolvedBase {
  b1: unknown;
  b2: unknown;
  b3: unknown;
  bc: unknown;
}

/**
 * Resolve a theme's base layers and base-content exactly as daisyUI does
 * (`daisyui/src/theming/functions.js` `convertColorFormat`): an absent
 * base-200 is base-100 darkened 7% in OKLCH, an absent base-300 is base-200
 * darkened 7% (or base-100 darkened 14%), and an absent base-content is an
 * 80% interpolation of base-100 toward white or black.
 */
function resolveBase(theme: ThemeSource): ResolvedBase {
  const b1 = theme['base-100'] ?? '#ffffff';
  const b2 = theme['base-200'] ?? darken(b1, 0.07);
  const b3 =
    theme['base-300'] ??
    (theme['base-200'] ? darken(theme['base-200'], 0.07) : darken(b1, 0.14));
  const bc =
    theme['base-content'] ??
    interpolate([b1, isDark(b1) ? 'white' : 'black'], 'oklch')(0.8);
  return { b1, b2, b3, bc };
}

function parsed(value: string): unknown {
  const colour = parse(value);
  if (colour === undefined) {
    throw new Error(`Unparseable colour in styles.css: ${value}`);
  }
  return colour;
}

/** The value of `[data-theme='<theme>'] .<cls> { <property>: <value>; }`. */
function overrideValue(
  theme: AnubisTheme,
  cls: string,
  property = 'color',
): string {
  const pattern = new RegExp(
    `\\[data-theme='${theme}'\\]\\s+\\.${cls}\\s*\\{\\s*${property}:\\s*([^;]+);\\s*\\}`,
  );
  const match = pattern.exec(STYLES_CSS);
  if (!match) {
    throw new Error(
      `No "[data-theme='${theme}'] .${cls} { ${property}: … }" rule in ` +
        'styles.css — the anubis ink overrides were moved or restructured; ' +
        'update this spec with them rather than deleting the guard.',
    );
  }
  return match[1].trim();
}

/** A custom property declared in a single-declaration selector block. */
function blockProperty(selector: string, property: string): string {
  const escaped = selector.replace(/[[\]'=-]/g, (ch) => `\\${ch}`);
  const pattern = new RegExp(
    `(?:^|\\n)${escaped}\\s*\\{[^}]*?${property}:\\s*([^;]+);`,
  );
  const match = pattern.exec(STYLES_CSS);
  if (!match) {
    throw new Error(`No ${property} under "${selector}" in styles.css.`);
  }
  return match[1].trim();
}

const errorInk = (theme: AnubisTheme): unknown =>
  parsed(blockProperty(`[data-theme='${theme}']`, '--ptah-error-ink'));

describe('file-status badge (text-base-content on bg-base-300)', () => {
  const themes: ReadonlyArray<readonly [string, ThemeSource]> =
    DAISYUI_THEMES.map((entry) => {
      const name = entry.name as string;
      const source = (customThemes?.[name] ?? BUILTIN_THEMES[name]) as
        ThemeSource | undefined;
      if (source === undefined) {
        throw new Error(
          `Theme '${name}' is listed in DAISYUI_THEMES but has no colour ` +
            'source in tailwind.config.js or daisyui/src/theming/themes.js.',
        );
      }
      return [name, source] as const;
    });

  it('covers every theme in the picker', () => {
    expect(themes.length).toBe(DAISYUI_THEMES.length);
    expect(themes.length).toBeGreaterThan(2);
  });

  it.each(themes)(`clears ${AA_NORMAL}:1 in theme "%s"`, (_name, source) => {
    const { b3, bc } = resolveBase(source);
    const ratio = wcagContrast(bc, b3);

    expect(Number.isFinite(ratio)).toBe(true);
    expect(ratio).toBeGreaterThanOrEqual(AA_NORMAL);
  });
});

describe('anubis ink overrides', () => {
  describe.each(ANUBIS_THEMES)('theme "%s"', (theme) => {
    const source = customThemes[theme];
    const base = resolveBase(source);

    it.each(BASE_LAYERS)(
      `--ptah-error-ink clears ${AA_NORMAL}:1 as text on %s`,
      (layer) => {
        expect(
          wcagContrast(errorInk(theme), base[layer]),
        ).toBeGreaterThanOrEqual(AA_NORMAL);
      },
    );

    it.each(['text-error', 'diff-del-text'])(
      '.%s uses --ptah-error-ink',
      (cls) => {
        expect(overrideValue(theme, cls)).toBe('var(--ptah-error-ink)');
      },
    );

    it('.border-error uses --ptah-error-ink', () => {
      expect(overrideValue(theme, 'border-error', 'border-color')).toBe(
        'var(--ptah-error-ink)',
      );
    });

    it(`.err-solid-text clears ${AA_NORMAL}:1 on a solid error fill`, () => {
      const ink = parsed(overrideValue(theme, 'err-solid-text'));

      expect(wcagContrast(ink, source['error'])).toBeGreaterThanOrEqual(
        AA_NORMAL,
      );
    });

    it.each(['b1', 'b3'] as const)(
      `.diff-add-text clears ${AA_NORMAL}:1 on %s`,
      (layer) => {
        const ink = parsed(overrideValue(theme, 'diff-add-text'));

        expect(wcagContrast(ink, base[layer])).toBeGreaterThanOrEqual(
          AA_NORMAL,
        );
      },
    );
  });

  it.each(['success', 'info'])(
    `.ok-solid-text clears ${AA_NORMAL}:1 on a solid %s fill in anubis`,
    (fill) => {
      const ink = parsed(overrideValue('anubis', 'ok-solid-text'));

      expect(
        wcagContrast(ink, customThemes['anubis'][fill]),
      ).toBeGreaterThanOrEqual(AA_NORMAL);
    },
  );
});

/**
 * The change-set card (libs/frontend/chat-ui, P3 visual review) relies on:
 * - the global 2 px `button:focus-visible` outline for its rows: `--s` in
 *   anubis (the light theme's `--ptah-gold-strong` is measured below);
 * - `--bcm` as its neutral accent border (non-text, 3:1);
 * - `text-base-content` on 9 px ghost badges, whose fill is base-200 under
 *   the card's base-300 tint, so base-content must hold 4.5:1 on all layers.
 */
describe('change-set card colour pairs', () => {
  it.each(BASE_LAYERS)(
    `anubis row focus ring (--s) clears ${AA_NON_TEXT}:1 against %s`,
    (layer) => {
      const source = customThemes['anubis'];
      expect(STYLES_CSS).toMatch(
        /button:focus-visible,[\s\S]*?outline:\s*2px solid oklch\(var\(--s\)\);/,
      );
      expect(
        wcagContrast(parsed(source['secondary']), resolveBase(source)[layer]),
      ).toBeGreaterThanOrEqual(AA_NON_TEXT);
    },
  );

  describe.each(ANUBIS_THEMES)('theme "%s"', (theme) => {
    const source = customThemes[theme];
    const base = resolveBase(source);

    it.each(BASE_LAYERS)(
      `neutral accent (--bcm) clears ${AA_NON_TEXT}:1 against %s`,
      (layer) => {
        const bcm = parsed(`oklch(${source['--bcm']})`);
        expect(wcagContrast(bcm, base[layer])).toBeGreaterThanOrEqual(
          AA_NON_TEXT,
        );
      },
    );

    it.each(BASE_LAYERS)(
      `ghost badge ink (base-content) clears ${AA_NORMAL}:1 on %s`,
      (layer) => {
        expect(wcagContrast(base.bc, base[layer])).toBeGreaterThanOrEqual(
          AA_NORMAL,
        );
      },
    );
  });
});

describe('anubis-light focus ring', () => {
  const base = resolveBase(customThemes['anubis-light']);

  it('draws the ring in --ptah-gold-strong', () => {
    expect(STYLES_CSS).toMatch(
      /:where\(\[data-theme='anubis-light'\]\)\s+:is\(button, input, select, textarea, a\):focus-visible,[^{]*\{\s*outline-color:\s*var\(--ptah-gold-strong\);/,
    );
  });

  it.each(BASE_LAYERS)(
    `--ptah-gold-strong clears ${AA_NON_TEXT}:1 against %s`,
    (layer) => {
      const ring = parsed(
        blockProperty("[data-theme-mode='light']", '--ptah-gold-strong'),
      );

      expect(wcagContrast(ring, base[layer])).toBeGreaterThanOrEqual(
        AA_NON_TEXT,
      );
    },
  );
});
