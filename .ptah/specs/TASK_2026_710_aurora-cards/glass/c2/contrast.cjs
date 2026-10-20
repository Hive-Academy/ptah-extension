// WCAG contrast for every glass theme shown, at the worst sampled backdrop pixel.
// Dark mode: text is light -> worst = brightest pixel (x brightness filter). Light mode: worst = darkest pixel.
// Alpha formulas mirror _glass-layer.src.css (tokens in section 1); change both together.
const C = require('D:/projects/ptah-extension/node_modules/culori');
const fs = require('fs');
const REG = require('./registry.cjs');
const cfg = require('./theme.config.js');
const bd = require('./_backdrop.json');
const css = fs.readFileSync(__dirname + '/glass-layer.css', 'utf8');
const full = fs.readFileSync('D:/projects/ptah-extension/node_modules/daisyui/dist/full.css', 'utf8');
const theme = fs.readFileSync(__dirname + '/theme.css', 'utf8');

const tok = (name, dark) => { // token value from the light block or, for dark, from the dark block
  const m = css.match(new RegExp('--glass-' + name + ':\\s*([\\d.]+)', 'g'));
  return m;
};
const parseCh = (s) => { const [l, c, h] = s.trim().split(/\s+/); return { mode: 'oklch', l: parseFloat(l) / 100, c: +c, h: +h }; };
function channels(name) {
  const grab = (src, start) => { const st = src.indexOf(start); const en = src.indexOf('\n}', st); const o = {}; for (const l of src.slice(st, en).split('\n')) { const m = l.match(/--([\w-]+):\s*([^;]+)/); if (m) o[m[1]] = m[2].trim(); } return o; };
  const v = grab(full, `[data-theme=${name}] {`);
  if (!REG[name].stock) Object.assign(v, grab(theme, `[data-theme=${name}] {`));
  else { const m = theme.match(new RegExp('\\[data-theme=' + name + '\\] \\{ --bcm: ([^;]+);')); if (m) v.bcm = m[1]; }
  const ov = (REG[name].ink || '').match(/--bc:s*([^;]+);/); if (ov) v.bc = ov[1].trim();
  return v;
}
const rgbArr = (c) => { const r = C.rgb(c); return [Math.max(0, Math.min(255, r.r * 255)), Math.max(0, Math.min(255, r.g * 255)), Math.max(0, Math.min(255, r.b * 255)), 1]; };
const over = (top, a, bot) => [0, 1, 2].map((i) => top[i] * a + bot[i] * (1 - a)).concat(1);
const hex = (c) => C.formatHex({ mode: 'rgb', r: c[0] / 255, g: c[1] / 255, b: c[2] / 255 });
const ratio = (fg, bg) => C.wcagContrast(hex(fg), hex(bg));

// Pull the active numbers out of the CSS so this stays in sync.
function glassTokens(mode) {
  const blk = mode === 'dark' ? css.slice(css.indexOf("[data-glass-mode='dark'] {")) : css.slice(0, css.indexOf("[data-glass-mode='dark'] {"));
  const g = (n) => { const m = blk.match(new RegExp('--glass-' + n + ':\\s*oklch\\(var\\(--(\\w+)\\) / ([\\d.]+)\\)')); return m ? [m[1], parseFloat(m[2])] : null; };
  const br = blk.match(/--glass-brightness:\s*([\d.]+)/);
  return { btn: parseFloat((blk.match(/--glass-btn-tint:\s*([\d.]+)/) || [0, 0.2])[1]), fill: g('fill'), under: g('under'), tile: g('fill-tile'), content: g('fill-content'), solid: g('fill-solid'), overlay: g('fill-overlay'), input: g('fill-input'), sel: g('sel'), user: g('bubble-user'), code: g('code'), bright: br ? parseFloat(br[1]) : 1, inputEdge: g('input-edge'), badge: parseFloat((css.match(/--glass-badge-tint:\s*([\d.]+)/) || [0, 0.14])[1]), mix: parseFloat((blk.match(/--glass-tint-mix:\s*(\d+)%/) || [0, 40])[1]) / 100 };
}
const rows = []; const summary = {};
for (const [name, r] of Object.entries(REG)) {
  if (!r.glass) continue;
  const ch = channels(name); const T = glassTokens(r.mode);
  const chn = (k) => rgbArr(parseCh(ch[k]));
  const B0 = (r.mode === 'dark' ? bd[name].bright : bd[name].dark);
  const Bf = B0.map((v) => Math.min(255, v * T.bright)).concat(1); // chrome sees the filtered backdrop
  const B = B0.concat(1);
  const lay = (spec, bot) => over(chn(spec[0]), spec[1], bot);
  const panel = lay(T.fill, T.under ? lay(T.under, Bf) : Bf), tile = lay(T.tile, panel), content = lay(T.content, panel), overlay = lay(T.overlay, B);
  const sel = lay(T.sel, panel), input = lay(T.input, panel), user = lay(T.user, panel), code = lay(T.code, panel);
  const bc = chn('bc'), bcm = chn('bcm');
  const tone = (k) => rgbArr(C.interpolate([parseCh(ch.bc), parseCh(ch[k])], 'oklch')(T.mix));
  let n = 0, f = 0;
  const push = (pair, fg, bg, min, alpha) => { const fg2 = alpha !== undefined ? over(fg, alpha, bg) : fg; const x = ratio(fg2, bg); const ok = x >= min; ok ? n++ : f++; rows.push([name, pair, x.toFixed(2), min + ':1', ok ? 'pass' : 'FAIL']); };
  rows.push([name, `worst backdrop pixel ${hex(B)} (${r.mode === 'dark' ? 'brightest' : 'darkest'}); panel ${hex(panel)}, tile ${hex(tile)}, content ${hex(content)}`, '', '', '']);
  push('text on chrome panel', bc, panel, 4.5);
  push('text on tile', bc, tile, 4.5);
  push('text on content / assistant bubble', bc, content, 4.5);
  push('text on user bubble', bc, user, 4.5);
  push('text on overlay (menu / modal)', bc, overlay, 4.5);
  push('text on selected item', bc, sel, 4.5);
  push('code ink on code block', r.mode === 'dark' ? bc : chn('nc'), r.mode === 'dark' ? code : over(chn('n'), 0.92, tile), 4.5);
  push('muted (--bcm) on chrome panel', bcm, panel, 4.5);
  push('muted (--bcm) on tile', bcm, tile, 4.5);
  push('muted (--bcm) on content', bcm, content, 4.5);
  push('placeholder (--bcm) on input', bcm, input, 4.5);
  push('btn-primary label (pc on p)' + (name.startsWith('ptah') ? ' [gold gradient ink, worst end]' : ''), name.startsWith('ptah') ? (name === 'ptah-glass' ? [27, 20, 3, 1] : [36, 26, 2, 1]) : chn('pc'), name.startsWith('ptah') ? [217, 169, 40, 1] : chn('p'), 4.5);
  push('btn-neutral label (nc on n)', chn('nc'), over(chn('n'), 0.9, panel), 4.5);
  for (const [lab, k] of [['info', 'in'], ['success', 'su'], ['warning', 'wa'], ['error', 'er'], ['primary', 'p']]) {
    const tinted = over(chn(k), T.badge, tile);
    push(`badge-${lab} text on its tint`, tone(k), tinted, 4.5);
  }
  push('btn-secondary / accent text on tint (accent)', tone('a'), over(chn('a'), T.btn, tile), 4.5);
  const edgeA = (css.match(/--glass-input-edge:\s*oklch\(var\(--bc\) \/ ([\d.]+)\)/g) || []);
  const ie = parseFloat((r.mode === 'dark' ? edgeA[1] : edgeA[0]).match(/([\d.]+)\)$/)[1]);
  push('UI: input / checkbox border vs panel', bc, panel, 3, ie);
  const focus = name === 'ptah-glass' ? [242, 205, 107, 1] : name === 'ptah-glass-light' ? [122, 83, 0, 1] : bc;
  push('UI: focus ring vs chrome panel', focus, panel, 3);
  push('UI: focus ring vs overlay', focus, overlay, 3);
  const ce = name.startsWith('ptah') ? parseFloat(cfg[name]['--ptah-check-edge']) / 100 : 0.7;
  push(`UI: --ptah-check-edge (bc @${Math.round(ce * 100)}%) vs tile`, bc, tile, 3, ce);
  summary[name] = { pass: n, fail: f };
}
const md = rows.map((r) => '| ' + r.join(' | ') + ' |').join('\n');
fs.writeFileSync(__dirname + '/_contrast.md', md);
fs.writeFileSync(__dirname + '/_contrast-summary.json', JSON.stringify(summary));
console.log(md.split('\n').filter((l) => l.includes('FAIL') || l.includes('worst backdrop')).join('\n'));
console.log(JSON.stringify(summary));
