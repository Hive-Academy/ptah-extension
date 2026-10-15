/** State indicators must remain visible on every shipped anubis base surface. */
const { wcagContrast } = require('culori/require');
const tailwindConfig = require('../../tailwind.config.js');

const themes = ['anubis', 'anubis-light'] as const;
const states = {
  run: 'in',
  need: 'wa',
  err: 'er',
  done: 'su',
  idle: 'bc',
} as const;
const surfaces = ['base-100', 'base-200', 'base-300'] as const;

type Theme = Record<string, string>;
const customThemes: Record<string, Theme> = tailwindConfig.daisyui.themes.find(
  (entry: unknown) => typeof entry === 'object' && entry !== null,
);

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
});
