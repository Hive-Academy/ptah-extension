/**
 * The `base-content-muted` token must clear WCAG AA on every theme THIS app
 * defines. Sibling of `apps/ptah-extension-webview/src/app/base-content-muted.spec.ts`.
 *
 * ## Why a second copy of this guard exists
 *
 * `ptah-landing-page` has its OWN `tailwind.config.js` and shares nothing with
 * the webview's — different daisyUI themes, different colour ladder, different
 * compiled stylesheet. TASK_2026_186 registered `--bcm` in the webview only, so
 * until this file existed the four `operator*` themes had no muted tier at all
 * and any `text-base-content-muted` in `libs/web/**` would have silently fallen
 * back to `var(--bc)` — rendering unmuted rather than failing loudly.
 *
 * ## The defect this closes
 *
 * TASK_2026_177 Batch 15B ran the first light-theme axe pass this repository
 * had ever done and measured `text-base-content/60` at **4.42:1** on
 * `operator-member-light` — below the 4.5:1 AA gate, on the SHARED panel nav,
 * so on every member and admin surface. Recomputed here from the literal theme
 * colours it is 4.41:1. It is not an outlier: `/40` fails on all four operator
 * themes (2.47:1 - 3.33:1) and `/50` fails on `operator-admin` and
 * `operator-member` (4.35:1). No single alpha passes everywhere, which is the
 * whole argument for a per-theme token.
 *
 * ## What this spec actually checks
 *
 * It does not trust the committed numbers. It re-reads `tailwind.config.js`,
 * recomputes the contrast of each committed `--bcm` against that theme's own
 * `base-100`, and fails on a mis-transcribed triplet or a theme that gained a
 * new `base-100` without a matching muted value.
 */

const { oklch, wcagContrast, rgb } = require('culori/require');
const TAILWIND_CONFIG = require('../../tailwind.config.js');

/** WCAG AA for normal-size text. The token exists to clear this. */
const AA_NORMAL = 4.5;

type ThemeSource = Record<string, string>;

/**
 * Every theme this app defines, flattened out of the daisyui `themes` array.
 *
 * Unlike the webview — whose config holds one object with two themes in it —
 * this app declares each theme as its own single-key object so each can carry
 * its own block comment. Flattening rather than indexing means adding a fifth
 * theme is picked up automatically instead of silently skipped.
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
    expect(THEME_SOURCES.map(([name]) => name)).toEqual([
      'operator',
      'operator-admin',
      'operator-member',
      'operator-member-light',
    ]);
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
  const byName = new Map(THEME_SOURCES);

  /**
   * Pins the defect rather than the fix. If someone later argues the token is
   * over-engineering and `text-base-content/60` would do, this is the number
   * that says otherwise — measured, not asserted.
   */
  it('fails AA at /60 on operator-member-light', () => {
    const theme = byName.get('operator-member-light') as ThemeSource;
    const ratio = wcagContrast(
      composite(theme['base-content'], theme['base-100'], 0.6),
      theme['base-100'],
    );

    expect(ratio).toBeLessThan(AA_NORMAL);
    expect(ratio).toBeCloseTo(4.41, 1);
  });

  it('fails AA at /40 on every theme, and at /50 on the panel themes', () => {
    const ratioAt = (name: string, alpha: number): number => {
      const theme = byName.get(name) as ThemeSource;
      return wcagContrast(
        composite(theme['base-content'], theme['base-100'], alpha),
        theme['base-100'],
      );
    };
    const failing = (alpha: number): string[] =>
      [...byName.keys()].filter((name) => ratioAt(name, alpha) < AA_NORMAL);

    expect(failing(0.4)).toEqual([
      'operator',
      'operator-admin',
      'operator-member',
      'operator-member-light',
    ]);
    expect(failing(0.5)).toEqual([
      'operator-admin',
      'operator-member',
      'operator-member-light',
    ]);
  });
});
