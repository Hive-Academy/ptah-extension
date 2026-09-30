/**
 * TASK_2026_576 Batch 7 — the git source-control error tint must clear WCAG AA.
 *
 * The existing dock's inline errors (row, section and commit failures in
 * `libs/frontend/git-ui/src/lib/source-control/`) render `text-base-content`
 * on `bg-error/10`. `text-error` on base fails AA in both anubis themes
 * (design-spec §0), which is why the text stays `base-content` and only the
 * background carries the error hue. That tint is translucent, so the colour
 * behind the text is `error` composited at 10% over whatever the panel sits
 * on. This spec recomputes that composite from the literal theme sources and
 * asserts the text clears 4.5:1 over every base layer the panel can render
 * on, so a theme colour change cannot silently drop it below AA.
 *
 * Lives beside `base-content-muted.spec.ts` because the same Tailwind config
 * that defines the anubis themes (and the same culori helper) is here; the
 * git-ui library has neither.
 */

const { rgb, wcagContrast } = require('culori/require');
const TAILWIND_CONFIG = require('../../tailwind.config.js');

/** WCAG AA for normal-size text; the error lines are 10-12 px. */
const AA_NORMAL = 4.5;

/** `bg-error/10` — Tailwind's opacity modifier on the error colour. */
const ERROR_TINT_ALPHA = 0.1;

/** The two themes the Electron shell ships (dark default + light). */
const THEMES = ['anubis', 'anubis-light'] as const;

/** Layers the source-control panel can sit on in the dock. */
const BASE_LAYERS = ['base-100', 'base-200', 'base-300'] as const;

type ThemeSource = Record<string, string>;

const customThemes: Record<string, ThemeSource> =
  TAILWIND_CONFIG.daisyui.themes.find(
    (entry: unknown) => typeof entry === 'object' && entry !== null,
  );

interface Rgb {
  mode: 'rgb';
  r: number;
  g: number;
  b: number;
}

function toRgb(color: string): Rgb {
  const parsed = rgb(color) as Rgb | undefined;
  if (!parsed || !Number.isFinite(parsed.r)) {
    throw new Error(`Unparseable theme colour: ${color}`);
  }
  return parsed;
}

/**
 * Source-over compositing in gamma-encoded sRGB — what browsers do for a
 * translucent background colour.
 */
function composite(top: Rgb, alpha: number, bottom: Rgb): Rgb {
  const mix = (a: number, b: number): number => a * alpha + b * (1 - alpha);
  return {
    mode: 'rgb',
    r: mix(top.r, bottom.r),
    g: mix(top.g, bottom.g),
    b: mix(top.b, bottom.b),
  };
}

describe('git error tint (text-base-content on bg-error/10)', () => {
  describe.each(THEMES)('theme "%s"', (name) => {
    const theme = customThemes?.[name];

    it('declares error, base-content and every base layer', () => {
      expect(theme).toBeDefined();
      for (const key of ['error', 'base-content', ...BASE_LAYERS]) {
        expect(theme?.[key]).toBeDefined();
      }
    });

    it.each(BASE_LAYERS)(`clears ${AA_NORMAL}:1 over %s`, (layer) => {
      const background = composite(
        toRgb(theme['error']),
        ERROR_TINT_ALPHA,
        toRgb(theme[layer]),
      );
      const ratio = wcagContrast(toRgb(theme['base-content']), background);

      expect(Number.isFinite(ratio)).toBe(true);
      expect(ratio).toBeGreaterThanOrEqual(AA_NORMAL);
    });
  });
});
