/**
 * TASK_2026_186 — the `base-content-muted` token must clear WCAG AA on EVERY
 * theme the picker can reach.
 *
 * ## Why this token exists at all
 *
 * TASK_2026_183 deleted the `text-base-content/40|50|60|80` ladder from the
 * Tasks UI after measuring it. Composited in sRGB against each theme's own
 * `base-100`, anubis `/40` is 3.31:1 and `/50` is 4.48:1 — but the trap is the
 * built-in daisyUI `dark`, whose `base-content` is only **7.03:1 at FULL
 * opacity**, so even `/60` lands at 3.45:1 there. No single alpha passes on
 * every theme we ship. Raising the floor to `/60` would pass on anubis and ship
 * a violation on `dark`.
 *
 * Hierarchy therefore has to come from a value chosen PER THEME. That is
 * `--bcm`, surfaced as the `text-base-content-muted` utility.
 *
 * ## What this spec actually checks
 *
 * It does not trust the numbers that were committed. It re-reads the literal
 * theme sources — `tailwind.config.js` for the two anubis themes and
 * daisyUI's own `themes.js` for the other 32, replicating daisyUI's
 * auto-generation of an absent `base-content` — then recomputes the contrast of
 * the COMMITTED `--bcm` against that theme's `base-100`. A value that was
 * mis-transcribed, or a theme whose upstream daisyUI colours shift on an
 * upgrade, fails here rather than in a user's eyes.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DAISYUI_THEMES } from '@ptah-extension/core';

const { oklch, interpolate, wcagContrast } = require('culori/require');
// daisyUI's own theme source — the same file the plugin compiles from.
const BUILTIN_THEMES = require('daisyui/src/theming/themes.js');
const TAILWIND_CONFIG = require('../../tailwind.config.js');

const STYLES_CSS = join(__dirname, '..', 'styles.css');

/** WCAG AA for normal-size text. The token exists to clear this. */
const AA_NORMAL = 4.5;

/** The two themes whose `--bcm` is declared in tailwind.config.js. */
const EAGER_THEMES = ['anubis', 'anubis-light'] as const;

type ThemeSource = Record<string, string>;

/** The custom-theme object out of the daisyui plugin config. */
const customThemes: ThemeSource = TAILWIND_CONFIG.daisyui.themes.find(
  (entry: unknown) => typeof entry === 'object' && entry !== null,
);

/**
 * `--bcm` declarations for the 32 deferred themes, parsed out of styles.css.
 * Matches `[data-theme='name'] { --bcm: <value>; }`.
 */
function readDeferredBcm(): ReadonlyMap<string, string> {
  const css = readFileSync(STYLES_CSS, 'utf8');
  const found = new Map<string, string>();
  const pattern = /\[data-theme='([^']+)'\]\s*\{\s*--bcm:\s*([^;]+);\s*\}/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(css)) !== null) {
    found.set(match[1], match[2].trim());
  }
  if (found.size === 0) {
    throw new Error(
      'No "[data-theme=...] { --bcm: ... }" rules found in styles.css — the ' +
        'per-theme muted block was moved or restructured; update this spec ' +
        'with it rather than deleting the guard.',
    );
  }
  return found;
}

/** Every theme's committed `--bcm`, from whichever source declares it. */
function committedBcm(): ReadonlyMap<string, string> {
  const merged = new Map(readDeferredBcm());
  for (const name of EAGER_THEMES) {
    const value = customThemes?.[name]?.['--bcm' as never] as
      | string
      | undefined;
    if (value !== undefined) merged.set(name, value);
  }
  return merged;
}

const isDark = (color: string): boolean =>
  wcagContrast(color, 'black') < wcagContrast(color, 'white');

/**
 * Resolve a theme's `base-100` and `base-content` exactly the way daisyUI does.
 *
 * Several built-in themes omit `base-content`; the plugin synthesises it as an
 * 80% OKLCH interpolation of `base-100` toward white or black
 * (`functions.js: generateForegroundColorFrom`). Reading the raw object without
 * replicating that would silently skip those themes.
 */
function resolveTheme(theme: ThemeSource): { b1: string; bc: unknown } {
  const b1 = theme['base-100'] ?? '#ffffff';
  const bc =
    theme['base-content'] ??
    interpolate([b1, isDark(b1) ? 'white' : 'black'], 'oklch')(0.8);
  return { b1, bc };
}

/** Every theme the picker exposes, paired with its literal colour source. */
const ALL_THEME_SOURCES: ReadonlyArray<readonly [string, ThemeSource]> =
  DAISYUI_THEMES.map((entry) => {
    const name = entry.name as string;
    const source = (customThemes?.[name] ?? BUILTIN_THEMES[name]) as
      | ThemeSource
      | undefined;
    if (source === undefined) {
      throw new Error(
        `Theme '${name}' is listed in DAISYUI_THEMES but has no colour ` +
          `source in tailwind.config.js or daisyui/src/theming/themes.js.`,
      );
    }
    return [name, source] as const;
  });

describe('base-content-muted (--bcm)', () => {
  const bcm = committedBcm();

  it('is declared for every theme in DAISYUI_THEMES', () => {
    const missing = ALL_THEME_SOURCES.map(([name]) => name).filter(
      (name) => !bcm.has(name),
    );

    expect(missing).toEqual([]);
  });

  it('declares no --bcm for a theme the picker cannot reach', () => {
    const known = new Set(ALL_THEME_SOURCES.map(([name]) => name));
    const orphans = [...bcm.keys()].filter((name) => !known.has(name));

    expect(orphans).toEqual([]);
  });

  describe.each(ALL_THEME_SOURCES)('theme "%s"', (name, source) => {
    const { b1, bc } = resolveTheme(source);
    const value = bcm.get(name);
    const muted = value === undefined ? undefined : oklch(`oklch(${value})`);

    it('parses as a valid OKLCH colour', () => {
      expect(muted).toBeDefined();
      // A typo'd triplet makes culori return undefined rather than throw, which
      // would otherwise sail through the contrast assertion as NaN.
      expect(Number.isFinite((muted as { l: number }).l)).toBe(true);
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
  });

  it('falls back to var(--bc) so an unmeasured theme cannot fail contrast', () => {
    // The single most important line in the token. A theme with no `--bcm`
    // renders at FULL base-content contrast — "not visually muted" is a
    // degradation we accept; "below 4.5:1" is not.
    const declared = TAILWIND_CONFIG.theme.extend.colors['base-content-muted'];

    expect(declared).toBe('oklch(var(--bcm, var(--bc)) / <alpha-value>)');
  });
});
