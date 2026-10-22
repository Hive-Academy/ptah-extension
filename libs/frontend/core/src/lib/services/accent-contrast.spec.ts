import { ACCENT_COLORS, ACCENTS } from './theme.service';

const { wcagContrast } = require('culori/require');

describe('Ptah glass primary accents', () => {
  for (const theme of ['ptah-glass', 'ptah-glass-light'] as const) {
    const accents = ACCENT_COLORS[theme];
    const panel = theme === 'ptah-glass' ? '#17191d' : '#f7f3fd';
    for (const accent of ACCENTS) {
      const colors = accents[accent];
      it(`${theme} ${accent} keeps text and controls legible`, () => {
        expect(wcagContrast(colors.pc, colors.p)).toBeGreaterThanOrEqual(4.5);
        expect(wcagContrast(colors.ink, colors.a)).toBeGreaterThanOrEqual(4.5);
        expect(wcagContrast(colors.ink, colors.b)).toBeGreaterThanOrEqual(4.5);
        expect(wcagContrast(colors.link, panel)).toBeGreaterThanOrEqual(4.5);
        expect(wcagContrast(colors.focus, panel)).toBeGreaterThanOrEqual(3);
      });
    }
  }
});
