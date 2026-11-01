/** State indicators must remain visible on every shipped anubis base surface. */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DAISYUI_THEMES } from '@ptah-extension/core';

const { wcagContrast } = require('culori/require');
const tailwindConfig = require('../../tailwind.config.js');

const themes = ['anubis', 'anubis-light', 'ptah-glass', 'ptah-glass-light'] as const;
const states = {
  run: 'in',
  need: 'wa',
  err: 'er',
  done: 'su',
  idle: 'bc',
} as const;
const surfaces = ['base-100', 'base-200', 'base-300'] as const;

type Theme = Record<string, string>;
const customThemes: Record<string, Theme> = Object.assign({}, ...tailwindConfig.daisyui.themes);

describe.each(themes)('%s state ink', (name) => {
  const theme = customThemes[name];

  it.each(Object.entries(states))('%s has a theme value and semantic fallback', (state, fallback) => {
    const ink = theme[`--state-ink-${state}`];
    expect(ink).toMatch(/^#[0-9a-f]{6}$/i);
    expect(tailwindConfig.theme.extend.colors[`state-${state}`]).toBe(
      `var(--state-ink-${state}, oklch(var(--${fallback})))`,
    );
  });

  for (const state of Object.keys(states)) {
    it.each(surfaces)(`${state} clears 3:1 against %s`, (surface) => {
      const ink = theme[`--state-ink-${state}`];
      expect(wcagContrast(ink, theme[surface])).toBeGreaterThanOrEqual(3);
    });
  }

  it('sets the pending-todo checkbox outline alpha', () => {
    expect(theme['--ptah-check-edge']).toMatch(/^(55|70)%$/);
  });
});

/**
 * Presence guard for the 32 stock themes (TASK_2026_677, design-spec 8.2).
 * Their inks are generated per theme into styles.css; a theme without a block
 * would silently fall back to daisyUI `--in/--wa/--er/--su` and `--s`, which
 * measured under 4.5:1 in 23 of the 32. The contrast math for these themes is
 * postponed (plan Decision B-9); this only asserts every block is present.
 */
describe('stock theme status inks in styles.css', () => {
  const STYLES_CSS = readFileSync(join(__dirname, '..', 'styles.css'), 'utf8');
  const generated = [
    '--state-ink-run',
    '--state-ink-need',
    '--state-ink-err',
    '--state-ink-done',
    '--ptah-accent-ink',
  ] as const;

  /** Declarations of every single-selector `[data-theme='name'] { ... }` block, merged per theme. */
  function declarationsByTheme(): ReadonlyMap<string, ReadonlyMap<string, string>> {
    const found = new Map<string, Map<string, string>>();
    const block = /(?:^|\n)\[data-theme='([^']+)'\]\s*\{([^}]*)\}/g;
    for (const [, name, body] of STYLES_CSS.matchAll(block)) {
      const declarations = found.get(name) ?? new Map<string, string>();
      for (const [, property, value] of body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
        declarations.set(property, value.trim());
      }
      found.set(name, declarations);
    }
    return found;
  }

  const stockThemes = DAISYUI_THEMES.map((entry) => entry.name as string).filter(
    (name) => !name.startsWith('anubis') && !name.startsWith('ptah-glass'),
  );
  const declared = declarationsByTheme();

  it('covers all 31 stock themes of the picker', () => {
    expect(stockThemes).toHaveLength(31);
  });

  it.each(stockThemes)('%s defines every status ink and the accent ink', (name) => {
    const declarations = declared.get(name);
    const missing = generated.filter((property) => !declarations?.has(property));
    expect(missing).toEqual([]);
    for (const property of generated) {
      expect(declarations?.get(property)).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });

  it('points stock-theme links and the checkbox outline at the measured values', () => {
    const scope = /\[data-theme\]:not\(\[data-theme\^='anubis'\]\)\s*\{([^}]*)\}/.exec(STYLES_CSS);
    expect(scope?.[1]).toMatch(/--ptah-link:\s*var\(--ptah-accent-ink\);/);
    expect(scope?.[1]).toMatch(/--ptah-check-edge:\s*70%;/);
  });
});
