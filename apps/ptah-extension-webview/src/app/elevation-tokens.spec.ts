import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DAISYUI_THEMES } from '@ptah-extension/core';

const css = readFileSync(join(__dirname, '..', 'styles.css'), 'utf8');
const config = require('../../tailwind.config.js');
const TOKENS = [
  'surface-0',
  'surface-1',
  'surface-2',
  'surface-3',
  'surface-border',
  'surface-border-strong',
  'surface-highlight',
  'elev-shadow',
  'elev-shadow-raised',
];

describe('semantic elevation tokens', () => {
  it.each(TOKENS)('defines --%s in the generic DaisyUI fallback', (token) => {
    expect(css).toMatch(
      new RegExp(`:root,\\s*\\[data-theme\\]\\s*\\{[\\s\\S]*?--${token}:`),
    );
  });

  it('uses the ThemeService dark marker, which covers every configured dark theme', () => {
    const darkThemes = DAISYUI_THEMES.filter((theme) => theme.isDark);
    expect(darkThemes.map((theme) => theme.name)).toEqual(
      expect.arrayContaining(['anubis', 'dark']),
    );
    expect(css).toMatch(
      /\[data-theme-mode='dark'\]\s*\{[\s\S]*?--elev-shadow-raised:/,
    );
  });

  it('exposes the structural colours to Tailwind with token fallbacks', () => {
    const colors = config.theme.extend.colors;
    for (const token of [
      'surface-0',
      'surface-1',
      'surface-2',
      'surface-3',
      'surface-border',
    ]) {
      expect(colors[token]).toBe(`var(--${token})`);
    }
  });
});
