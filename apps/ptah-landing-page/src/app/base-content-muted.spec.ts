/**
 * The landing page's `base-content-muted` token must clear WCAG AA.
 * This app owns its DaisyUI config and supplies the `operator` theme.
 * The spec remeasures the committed `--bcm` value against `base-100`
 * and catches a missing value when a theme is added.
 */

const { oklch, wcagContrast, rgb } = require('culori/require');
const TAILWIND_CONFIG = require('../../tailwind.config.js');

/** WCAG AA for normal-size text. The token exists to clear this. */
const AA_NORMAL = 4.5;

type ThemeSource = Record<string, string>;

/**
 * Every theme this app defines, flattened out of the daisyui `themes` array.
 * Flattening keeps a future theme in the contrast check.
 */
const THEME_SOURCES: ReadonlyArray<readonly [string, ThemeSource]> =
  TAILWIND_CONFIG.daisyui.themes.flatMap((entry: unknown) =>
    typeof entry === 'object' && entry !== null
      ? Object.entries(entry as Record<string, ThemeSource>)
      : [],
  );

/** sRGB alpha compositing — how a browser actually paints `text-x/NN`. */
function composite(fg: string, bg: string, alpha: number): unknown {
  const f = rgb(fg);
  const b = rgb(bg);
  return {
    mode: 'rgb',
    r: f.r * alpha + b.r * (1 - alpha),
    g: f.g * alpha + b.g * (1 - alpha),
    b: f.b * alpha + b.b * (1 - alpha),
  };
}

describe('base-content-muted (--bcm) on the landing-page themes', () => {
  it('finds the themes it is meant to guard', () => {
    // A restructured config that yields zero themes would otherwise make every
    // describe.each below vacuous and this file green-but-useless.
    expect(THEME_SOURCES.map(([name]) => name)).toEqual(['operator']);
  });

  it('falls back to var(--bc) so an unmeasured theme cannot fail contrast', () => {
    // The single most important line in the token. A theme with no `--bcm`
    // renders at FULL base-content contrast — "not visually muted" is a
    // degradation we accept; "below 4.5:1" is not.
    const declared = TAILWIND_CONFIG.theme.extend.colors['base-content-muted'];

    expect(declared).toBe('oklch(var(--bcm, var(--bc)) / <alpha-value>)');
  });

  describe.each(THEME_SOURCES)('theme "%s"', (_name, source) => {
    const b1 = source['base-100'];
    const bc = source['base-content'];
    const value = source['--bcm'];
    const muted = value === undefined ? undefined : oklch(`oklch(${value})`);

    it('declares a --bcm and it parses as a valid OKLCH colour', () => {
      expect(value).toBeDefined();
      // A typo'd triplet makes culori return undefined rather than throw, which
      // would otherwise sail through the contrast assertion as NaN.
      expect(Number.isFinite((muted as { l: number } | undefined)?.l)).toBe(
        true,
      );
    });

    it(`clears ${AA_NORMAL}:1 against this theme's own base-100`, () => {
      expect(wcagContrast(muted, b1)).toBeGreaterThanOrEqual(AA_NORMAL);
    });

    it('is no more contrasting than base-content — it is a SECONDARY tier', () => {
      // Guards the direction of the change. A "muted" value that out-contrasts
      // the primary text would invert the ladder rather than extend it.
      expect(wcagContrast(muted, b1)).toBeLessThanOrEqual(
        wcagContrast(bc, b1) + 1e-9,
      );
    });

    it('carries headroom above the gate, not just clearance of it', () => {
      // Values are derived as "largest OKLCH mix toward base-100, capped at
      // 40%, that still measures >= 5.0:1" — the same rule TASK_2026_186 used
      // for the webview. Landing exactly ON 4.5:1 would leave a rounding
      // difference between engines to decide whether the app passes.
      expect(wcagContrast(muted, b1)).toBeGreaterThanOrEqual(5.0);
    });
  });
});

describe('the alpha ladder base-content-muted replaces', () => {
  it('fails AA at /40 on operator', () => {
    const operator = new Map(THEME_SOURCES).get('operator') as ThemeSource;
    const ratio = wcagContrast(
      composite(operator['base-content'], operator['base-100'], 0.4),
      operator['base-100'],
    );

    expect(ratio).toBeLessThan(AA_NORMAL);
  });
});
