import { join } from 'node:path';
import { CHILD_SILVER_INK } from './command-scene-renderer';

const { wcagContrast } = require('culori/require');
const config = require(join(
  __dirname,
  '../../../../../../apps/ptah-extension-webview/tailwind.config.js',
));
const themes: Record<string, Record<string, string>> = config.daisyui.themes.find(
  (entry: object) => 'anubis' in entry && 'anubis-light' in entry,
);

describe.each(['anubis', 'anubis-light'])('%s scene state inks', (themeName) => {
  it.each(['run', 'need', 'err', 'done', 'idle'])(
    '%s clears 3:1 against the stage base-200',
    (state) => {
      const theme = themes[themeName];
      const ink = theme[`--state-ink-${state}`];
      expect(ink).toMatch(/^#[0-9a-f]{6}$/i);
      expect(wcagContrast(ink, theme['base-200'])).toBeGreaterThanOrEqual(3);
    },
  );

  it('keeps the child ring and ownership tether above 3:1 on the stage', () => {
    const theme = themes[themeName];
    const silver = themeName === 'anubis'
      ? CHILD_SILVER_INK.dark
      : CHILD_SILVER_INK.light;
    expect(wcagContrast(silver, theme['base-200'])).toBeGreaterThanOrEqual(3);
  });
});
