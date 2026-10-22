import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const css = readFileSync(join(__dirname, '..', 'styles.css'), 'utf8');
const channels = /^\d+(\.\d+)?% \d*\.?\d+ \d+(\.\d+)?$/;
const gradientTokens = ['--g-ptah-focus', '--g-ptah-gold', '--g-ptah-link', '--g-gold-a', '--g-gold-b', '--g-gold-ink', '--g-hov-a', '--g-hov-b', '--g-btn-glow'];

describe('glass accent CSS', () => {
  for (const theme of ['ptah-glass', 'ptah-glass-light']) {
    it(`${theme} supplies the default gold gradient`, () => {
      const block = [...css.matchAll(/([^{}]+)\{([^{}]+)\}/g)].find(([, selector, body]) =>
        selector.includes(`:root[data-theme='${theme}'][data-glass='on']`) && !selector.includes('[data-accent=') && body.includes('--g-ptah-focus:'),
      )?.[2] ?? '';
      for (const token of gradientTokens) expect(block).toContain(`${token}:`);
    });
    for (const accent of ['rose', 'moonstone']) {
      it(`${theme} ${accent} supplies scoped primary channels and gradients`, () => {
        const blocks = [...css.matchAll(/([^{}]+)\{([^{}]+)\}/g)].filter(([, selector]) => selector.includes(`[data-theme='${theme}']`) && selector.includes(`[data-accent='${accent}']`));
        expect(blocks).toHaveLength(2);
        const declarations = blocks.map(([, , body]) => body).join('\n');
        for (const token of ['--p', '--pf', '--pc']) {
          const value = new RegExp(`${token}:\\s*([^;]+);`).exec(declarations)?.[1].trim();
          expect(value).toMatch(channels);
        }
        for (const token of gradientTokens) expect(declarations).toContain(`${token}:`);
      });
    }
  }

  it('never applies accent overrides to stock themes', () => {
    for (const [, selector] of css.matchAll(/([^{}]+)\{[^{}]*--p:\s*\d+[^{}]*\}/g)) {
      if (selector.includes('[data-accent=')) expect(selector).toMatch(/\[data-theme='ptah-glass(?:-light)?'\]/);
    }
  });
});
