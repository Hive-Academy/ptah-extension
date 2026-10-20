// Computes the WCAG contrast table for NOTES.md from glass-layer.css + theme.config.js.
// Worst-case backdrop: brightest sampled pixel for the dark theme (light text),
// darkest sampled pixel for the light theme (dark text). See backdrop-max.cjs.
const C = require('D:/projects/ptah-extension/node_modules/culori');
const { parse, wcagContrast, formatHex } = C;
const fs = require('fs');
const css = fs.readFileSync(__dirname + '/glass-layer.css', 'utf8');
const cfg = require('./theme.config.js');
const bd = require('./_backdrop.json');

function vars(sel) {
  const st = css.indexOf("[data-theme='" + sel + "'] {");
  const en = css.indexOf('\n}', st);
  const o = {};
  for (const l of css.slice(st, en).split('\n')) {
    const r = l.match(/--(g-[\w-]+):\s*(rgba?\([^)]*\)|#[0-9a-fA-F]+)/);
    if (r) o[r[1]] = r[2];
  }
  return o;
}
const rgba = (s) => {
  if (s[0] === '#') { const c = parse(s); return [c.r * 255, c.g * 255, c.b * 255, 1]; }
  const n = s.match(/[\d.]+/g).map(Number);
  return [n[0], n[1], n[2], n[3] === undefined ? 1 : n[3]];
};
const over = (top, bot) => { const a = top[3]; return [0, 1, 2].map((i) => top[i] * a + bot[i] * (1 - a)).concat(1); };
const hex = (c) => formatHex({ mode: 'rgb', r: c[0] / 255, g: c[1] / 255, b: c[2] / 255 });
const cr = (fg, bg) => { if (fg[3] < 1) fg = over(fg, bg); return wcagContrast(hex(fg), hex(bg)); };
const rows = [];
for (const [name, worst, t] of [['ptah-glass', 'bright', 'dark'], ['ptah-glass-light', 'dark', 'light']]) {
  const v = vars(name), th = cfg[name];
  const B = [...bd[t][worst], 1];
  const R = (k) => rgba(v[k]);
  const H = (k) => rgba(th[k]);
  const panel = over(R('g-fill-1'), B), tile = over(R('g-fill-2'), panel), overlay = over(R('g-fill-overlay'), B);
  const sel = over(R('g-fill-sel'), panel), input = over(R('g-fill-input'), panel), bub = over(R('g-fill-bubble-user'), panel);
  const bc = H('base-content');
  const m = C.rgb(C.parse('oklch(' + th['--bcm'] + ')'));
  const bcm = [m.r * 255, m.g * 255, m.b * 255, 1];
  const push = (pair, fg, bg, min) => { const r = cr(fg, bg); rows.push([name, pair, r.toFixed(2), min + ':1', r >= min ? 'pass' : 'FAIL']); };
  rows.push([name, 'worst-case backdrop pixel ' + hex(B) + ', panel ' + hex(panel) + ', tile ' + hex(tile), '', '', '']);
  push('base-content on panel', bc, panel, 4.5);
  push('base-content on nested tile', bc, tile, 4.5);
  push('base-content on overlay (menu/modal)', bc, overlay, 4.5);
  push('base-content on selected item (gold tint)', bc, sel, 4.5);
  push('base-content on user bubble', bc, bub, 4.5);
  push('muted --bcm on panel', bcm, panel, 4.5);
  push('muted --bcm on nested tile', bcm, tile, 4.5);
  push('muted --bcm on overlay', bcm, overlay, 4.5);
  push('placeholder (--bcm) on input', bcm, input, 4.5);
  push('brand ink (gold text) on panel', rgba(v['g-ink-brand']), panel, 4.5);
  push('brand ink on tile', rgba(v['g-ink-brand']), tile, 4.5);
  push('accent ink on tile', rgba(v['g-ink-accent']), tile, 4.5);
  push('secondary-focus (eyebrow text) on tile', H('secondary-focus'), tile, 4.5);
  push('primary as text (text-primary, link) on panel', H('primary'), panel, 4.5);
  push('btn-primary ink on gold gradient top', rgba(v['g-btn-ink']), rgba(v['g-gold-a']), 4.5);
  push('btn-primary ink on gold gradient bottom', rgba(v['g-btn-ink']), rgba(v['g-gold-b']), 4.5);
  for (const k of ['run', 'need', 'err', 'done', 'idle']) push('state-ink-' + k + ' on tile', H('--state-ink-' + k), tile, 4.5);
  const tones = { info: '--state-ink-run', warning: '--state-ink-need', error: '--state-ink-err', success: '--state-ink-done' };
  for (const [k, ink] of Object.entries(tones)) {
    const f = H(k);
    push('badge-' + k + ' ink on its 14% tint', H(ink), over([f[0], f[1], f[2], 0.14], tile), 4.5);
  }
  { const f = H('primary'); push('badge-primary brand ink on its 14% tint', rgba(v['g-ink-brand']), over([f[0], f[1], f[2], parseFloat(v['g-badge-tint'] || '0.14')], tile), 4.5); }
  push('tooltip text on tooltip', [244, 246, 253, 1], rgba(v['g-tooltip']), 4.5);
  push('neutral-content on btn-neutral', H('neutral-content'), over(R('g-neutral-fill'), panel), 4.5);
  push('primary-content on primary (badge/toggle fill)', H('primary-content'), H('primary'), 4.5);
  push('code ink on code block', rgba(v['g-code-ink']), over(R('g-code'), tile), 4.5);
  push('UI: input border vs panel', R('g-input-edge'), panel, 3);
  push('UI: focus ring vs panel', rgba(v['g-focus']), panel, 3);
  push('UI: focus ring vs overlay', rgba(v['g-focus']), overlay, 3);
  push('UI: --ptah-check-edge (bc @55%) vs tile', [bc[0], bc[1], bc[2], 0.55], tile, 3);
}
const md = rows.map((r) => '| ' + r.join(' | ') + ' |').join('\n');
console.log(md);
fs.writeFileSync(__dirname + '/_contrast.md', md);
