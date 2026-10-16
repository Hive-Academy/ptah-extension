// Prototype tool, not product code. Measures every foreground/background pair the 649 design uses, for anubis (dark) and
// anubis-light. Token values are copied from apps/ptah-extension-webview/tailwind.config.js (same values as tokens.css).
// Criterion: WCAG 2.2 AA (project states no other standard): text >= 4.5:1, large/bold >= 3:1 (none used), UI components and
// focus indicators >= 3:1 (SC 1.4.11). Run: node contrast-check.mjs
const T = {
  dark: {
    b1: '18.8562% 0.008 285.6', b2: '22.0459% 0.0116 285.41', b3: '26.5698% 0.0223 284.79', bc: '92.5095% 0.0071 88.65',
    bcm: '66.509856% 0.007403 31.090978', p: '54.615% 0.2152 262.88', pc: '97.607% 0.0041 91.45', s: '76.6528% 0.1387 91.06',
    su: '62.7052% 0.1699 149.21', wa: '70.4871% 0.1867 47.6', er: '57.7099% 0.2152 27.33', in: '62.3083% 0.188 259.81',
    ink: { run: '#3b82f6', need: '#f97316', err: '#ef4444', done: '#16a34a' }, focus: '76.6528% 0.1387 91.06',
  },
  light: {
    b1: '97.788% 0.004 56.375', b2: '93.982% 0.007 61.449', b3: '91.586% 0.006 53.44', bc: '23.574% 0.066 313.189',
    bcm: '48.955188% 0.044796 348.478612', p: '85% 0.138 181.071', pc: '36% 0.078 188.216', s: '58% 0.132 75',
    su: '69% 0.17 162.48', wa: '72% 0.18 55', er: '64% 0.246 16.439', in: '68% 0.169 237.323',
    ink: { run: '#2a56c6', need: '#8f5200', err: '#b4232a', done: '#13713a' }, focus: 'oklch(48% 0.12 70)',
  },
};
const lin = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const gam = (c) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);
function oklch(str) {
  const m = str.replace('oklch(', '').replace(')', '').trim().split(/\s+/);
  const L = parseFloat(m[0]) / (m[0].includes('%') ? 100 : 1), C = parseFloat(m[1]), h = (parseFloat(m[2]) * Math.PI) / 180;
  const a = C * Math.cos(h), b = C * Math.sin(h);
  const l_ = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3, m_ = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3, s_ = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_, -1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_, -0.0041960863 * l_ - 0.7034186147 * m_ + 1.707614701 * s_].map((v) => gam(Math.min(1, Math.max(0, v))));
}
const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
const col = (v) => (v.startsWith('#') ? hex(v) : oklch(v.startsWith('oklch') ? v : `oklch(${v})`));
const mix = (fg, bg, a) => fg.map((c, i) => c * a + bg[i] * (1 - a)); // sRGB alpha compositing, as Tailwind /NN does
const Y = (rgb) => { const [r, g, b] = rgb.map(lin); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const cr = (a, b) => { const [x, y] = [Y(a), Y(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
// surface-1 / surface-3 are color-mix(in oklch) of b-tokens; approximated by sRGB mixing (error < 0.05:1 at these lightness steps).
const rows = [];
for (const [theme, t] of Object.entries(T)) {
  const b1 = col(t.b1), b2 = col(t.b2), b3 = col(t.b3), bc = col(t.bc), bcm = col(t.bcm);
  const s1 = mix(b2, b1, 0.88), s3 = mix(b3, b2, 0.86), ink = Object.fromEntries(Object.entries(t.ink).map(([k, v]) => [k, col(v)]));
  const tint = (k, base, a) => mix(col(t[k]), base, a);
  const add = (name, fg, bg, min) => rows.push({ theme, name, ratio: cr(fg, bg), min });
  add('text base-content on page b1 (chat, header)', bc, b1, 4.5);
  add('text base-content on sidebar surface-1', bc, s1, 4.5);
  add('text base-content on dialog surface-3', bc, s3, 4.5);
  add('muted text (bcm) on page b1', bcm, b1, 4.5);
  add('muted text (bcm) on sidebar surface-1', bcm, s1, 4.5);
  add('muted text (bcm) on dialog surface-3', bcm, s3, 4.5);
  add('muted text (bcm) on preview card b2', bcm, b2, 4.5);
  add('btn-primary: primary-content on primary (Apply)', col(t.pc), col(t.p), 4.5);
  add('state-done text on sidebar tinted 10% success (ready/applied card)', ink.done, tint('su', s1, 0.1), 4.5);
  add('state-need text on sidebar tinted 12% warning (warnings, pin badge)', ink.need, tint('wa', s1, 0.12), 4.5);
  add('state-err ICON on sidebar tinted 10% error (graphic, 3:1)', ink.err, tint('er', s1, 0.1), 3);
  add('base-content text on sidebar tinted 10% error (alert body)', bc, tint('er', s1, 0.1), 4.5);
  add('state-err ICON on dialog surface-3 (Discard, graphic 3:1)', ink.err, s3, 3);
  add('state-run text on sidebar surface-1 (busy label)', ink.run, s1, 4.5);
  add('state-need text on page b1 (peek bar needs-answer)', ink.need, b1, 4.5);
  add('state-done text on page b1 (peek bar ready)', ink.done, b1, 4.5);
  add('badge-ghost: base-content on b3 (workflow badge)', bc, b3, 4.5);
  add('UI: focus ring on sidebar surface-1 (3:1)', col(t.focus), s1, 3);
  add('UI: focus ring on dialog surface-3 (3:1)', col(t.focus), s3, 3);
  add('REJECTED baseline, expected FAIL: field edge bc @ 22% (surface-border-strong, daisyUI input-bordered) on surface-1', mix(bc, s1, 0.22), s1, 3);
  add('UI: field edge bc @ 50% on surface-1 (proposed for inputs)', mix(bc, s1, 0.5), s1, 3);
  add('UI: field edge bc @ 50% on dialog surface-3', mix(bc, s3, 0.5), s3, 3);
}
let fail = 0;
for (const r of rows) { const ok = r.ratio >= r.min; if (!ok) fail++; console.log(`${r.theme.padEnd(5)} ${ok ? 'PASS' : 'FAIL'} ${r.ratio.toFixed(2).padStart(5)}:1 (>= ${r.min})  ${r.name}`); }
console.log(`\n${rows.length - fail} PASS / ${fail} FAIL`);
