// Generates section 8 (primary accent) of glass-layer.css from accents.cjs. Called by build.cjs.
const ACC = require('./accents.cjs');

module.exports = function accentCss(fmt) {
  let css = [
    '/* -------------------------------------------------------------------------',
    '   8. Primary accent: <html data-accent="violet|teal"> (gold = default, no attribute)',
    '   Only ptah-glass / ptah-glass-light react. DaisyUI 4 stores colours as OKLCH channels.',
    '   Specificity (0,4,0) beats theme.css [data-theme] (0,1,0) and section 7 (0,3,0).',
    '   ------------------------------------------------------------------------- */',
    '',
  ].join('\n');
  for (const [theme, accs] of Object.entries(ACC)) {
    for (const [name, a] of Object.entries(accs)) {
      const sel = `:root[data-theme='${theme}'][data-accent='${name}']`;
      css += `${sel} { --p: ${fmt(a.p)}; --pf: ${fmt(a.pf)}; --pc: ${fmt(a.pc)}; }\n`;
      css += `${sel}[data-glass='on'] { --g-ptah-focus: ${a.focus}; --g-ptah-gold: ${a.gold}; --g-ptah-link: ${a.link}; `
        + `--g-gold-a: ${a.a}; --g-gold-b: ${a.b}; --g-gold-ink: ${a.ink}; --g-hov-a: ${a.hovA}; --g-hov-b: ${a.hovB}; --g-btn-glow: ${a.glow}; }\n`;
    }
  }
  return css;
};
