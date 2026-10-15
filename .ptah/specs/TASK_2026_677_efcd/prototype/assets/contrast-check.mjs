// Re-runnable contrast audit for design-spec.md. `node contrast-check.mjs` prints every pair measured.
// WCAG 2.x relative luminance on sRGB. oklch -> sRGB via OKLab; color-mix(in oklch) = linear interpolation of
// L, C and shorter-arc hue; alpha composites in sRGB (what the browser does for color-mix(.. transparent)).

const clamp = (x) => Math.min(1, Math.max(0, x));
const toLin = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const toGam = (c) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);

export function hex(h) {
  h = h.replace('#', '');
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
}
export function oklch([L, C, H]) {
  const a = C * Math.cos((H * Math.PI) / 180);
  const b = C * Math.sin((H * Math.PI) / 180);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const r = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
  const g = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
  const bb = -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s;
  return [r, g, bb].map((v) => clamp(toGam(v)));
}
export function toOklch([r, g, b]) {
  const [lr, lg, lb] = [r, g, b].map(toLin);
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const a = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const bb = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  const C = Math.hypot(a, bb);
  let H = (Math.atan2(bb, a) * 180) / Math.PI;
  if (H < 0) H += 360;
  return [L, C, C < 1e-4 ? 0 : H];
}
export const lum = ([r, g, b]) => 0.2126 * toLin(r) + 0.7152 * toLin(g) + 0.0722 * toLin(b);
export const ratio = (a, b) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};
export function mix(c1, p1, c2) {
  // color-mix(in oklch, c1 p1%, c2) — c1/c2 are sRGB triples
  const A = toOklch(c1), B = toOklch(c2), t = p1 / 100;
  let dh = B[2] - A[2];
  if (dh > 180) dh -= 360;
  if (dh < -180) dh += 360;
  const H = A[1] < 1e-3 ? B[2] : B[1] < 1e-3 ? A[2] : A[2] + dh * (1 - t);
  return oklch([A[0] * t + B[0] * (1 - t), A[1] * t + B[1] * (1 - t), (H + 360) % 360]);
}
export const over = (fg, alpha, bg) => fg.map((v, i) => v * alpha + bg[i] * (1 - alpha));

const themes = {
  anubis: {
    b1: hex('#131317'), b2: hex('#1a1a20'), b3: hex('#242430'), bc: hex('#e8e6e1'),
    bcm: oklch([0.66509856, 0.007403, 31.090978]),
    run: hex('#3b82f6'), need: hex('#f97316'), err: hex('#ef4444'), done: hex('#16a34a'), idle: hex('#9ca3af'),
    gold: hex('#d4af37'), ring: hex('#d4af37'), link: hex('#d4af37'), primary: hex('#2563eb'), pc: hex('#f8f7f4'), warnC: hex('#131317'),
    add: hex('#4ade80'), del: hex('#f87171'),
  },
  'anubis-light': {
    b1: oklch([0.97788, 0.004, 56.375]), b2: oklch([0.93982, 0.007, 61.449]), b3: oklch([0.91586, 0.006, 53.44]),
    bc: oklch([0.23574, 0.066, 313.189]), bcm: oklch([0.48955188, 0.044796, 348.478612]),
    run: hex('#2a56c6'), need: hex('#8f5200'), err: hex('#b4232a'), done: hex('#13713a'), idle: hex('#6b6570'),
    gold: oklch([0.58, 0.132, 75]), ring: oklch([0.48, 0.12, 70]), link: oklch([0.48, 0.12, 70]), primary: oklch([0.85, 0.138, 181.071]), pc: oklch([0.36, 0.078, 188.216]),
    warnC: oklch([0.28, 0.066, 53.813]), add: hex('#13713a'), del: hex('#b4232a'),
  },
};

const MODE = process.argv[2] || 'all'; // all | anubis | themes
const IS_MAIN = !!process.argv[1] && process.argv[1].endsWith('contrast-check.mjs');

if (IS_MAIN && MODE !== 'themes') {
  for (const [name, t] of Object.entries(themes)) {
    const s0 = t.b1, s1 = mix(t.b2, 88, t.b1), s2 = t.b2, s3 = mix(t.b3, 86, t.b2);
    const surf = { 'surface-0': s0, 'surface-1': s1, 'surface-2': s2, 'surface-3': s3 };
    console.log('\n=== ' + name + ' ===');
    const rows = [];
    for (const [sn, sv] of Object.entries(surf)) {
      rows.push([`base-content on ${sn}`, ratio(t.bc, sv)]);
      rows.push([`base-content-muted on ${sn}`, ratio(t.bcm, sv)]);
      for (const k of ['run', 'need', 'err', 'done', 'idle'])
        rows.push([`state-${k} on ${sn}`, ratio(t[k], sv)]);
      rows.push([`ptah-gold on ${sn}`, ratio(t.gold, sv)]);
    }
    // borders (UI 3:1 only matters for focus ring / checkbox outline / progress track edge)
    const border = (sv, a) => over(t.bc, a, sv);
    rows.push(['surface-border (14% bc) on surface-1  [decorative hairline, not required]', ratio(border(s1, 0.14), s1)]);
    rows.push(['checkbox outline (55% bc) on surface-0', ratio(over(t.bc, 0.55, s0), s0)]);
    rows.push(['checkbox outline (45% bc) on surface-0', ratio(over(t.bc, 0.45, s0), s0)]);
    rows.push(['context bar track (22% bc) on surface-0', ratio(over(t.bc, 0.22, s0), s0)]);
    // Actual focus-ring token per theme (styles.css: --s in dark, --ptah-gold-strong in anubis-light), on every surface it can sit on
    for (const [sn, sv] of Object.entries(surf)) rows.push([`focus ring (${name === 'anubis' ? '--s gold' : 'gold-strong'}) on ${sn}  [UI >= 3:1]`, ratio(t.ring, sv)]);
    for (const [sn, sv] of Object.entries(surf)) rows.push([`--ptah-link text on ${sn}  [text >= 4.5:1]`, ratio(t.link, sv)]);
    rows.push(['plain light gold as ring on surface-1 (NOT used; shows why gold-strong is required)', ratio(t.gold, s1)]);
    rows.push(['send button: base-100 glyph on base-content', ratio(t.b1, t.bc)]);
    rows.push(['diff add on surface-0', ratio(t.add, s0)]);
    rows.push(['diff del on surface-0', ratio(t.del, s0)]);
    rows.push(['state-run tint chip bg (12% run on s1) text state-run', ratio(t.run, over(t.run, 0.12, s1))]);
    rows.push(['state-need tint (12% need on s2) text state-need', ratio(t.need, over(t.need, 0.12, s2))]);
    for (const [n, r] of rows) console.log(r.toFixed(2).padStart(6) + ':1  ' + n);
  }
}

// ---------------------------------------------------------------------------------------------------------------
// All 34 picker themes. `node contrast-check.mjs themes` prints the table recorded in design-spec.md 8.2.
// Sources (read at run time, nothing copied by hand): DAISYUI_THEMES in libs/frontend/core/src/lib/services/theme.service.ts,
// the two custom themes in apps/ptah-extension-webview/tailwind.config.js, the 32 stock themes in
// node_modules/daisyui/src/theming/themes.js (resolved like base-content-muted.spec.ts: a missing base-200/300/content and
// missing info/success/warning/error take daisyUI's own defaults from daisyui/src/theming/functions.js), --bcm from styles.css.
// ---------------------------------------------------------------------------------------------------------------
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../../../../..');
const req = createRequire(join(ROOT, 'package.json'));

const NAMED = { black: '#000000', white: '#ffffff' };
export function parseColor(v) {
  v = String(v).trim();
  if (NAMED[v]) v = NAMED[v];
  if (v.startsWith('#')) {
    let h = v.slice(1);
    if (h.length === 3) h = h.split('').map((c) => c + c).join('');
    return hex(h);
  }
  const m = v.match(/^oklch\(\s*([\d.]+)(%?)\s+([\d.]+)\s+([\d.]+)\s*\)$/);
  if (m) return oklch([m[2] ? +m[1] / 100 : +m[1], +m[3], +m[4]]);
  throw new Error('cannot parse colour: ' + v);
}
const parseTriple = (s) => {
  const m = s.trim().match(/^([\d.]+)%\s+([\d.]+)\s+([\d.]+)$/);
  return oklch([+m[1] / 100, +m[2], +m[3]]);
};
const BLACK = [0, 0, 0], WHITE = [1, 1, 1];
const darken = (c, amt) => mix(c, (1 - amt) * 100, BLACK);
const isDark = (c) => ratio(c, BLACK) < ratio(c, WHITE);

export function loadThemes() {
  const svc = readFileSync(join(ROOT, 'libs/frontend/core/src/lib/services/theme.service.ts'), 'utf8');
  const list = [...svc.matchAll(/\{\s*name:\s*'([^']+)',\s*label:\s*'[^']*',\s*isDark:\s*(true|false)\s*\}/g)].map((m) => ({ name: m[1], dark: m[2] === 'true' }));
  const builtin = req('daisyui/src/theming/themes.js');
  const tw = req(join(ROOT, 'apps/ptah-extension-webview/tailwind.config.js'));
  const custom = tw.daisyui.themes.find((e) => typeof e === 'object' && e !== null);
  const css = readFileSync(join(ROOT, 'apps/ptah-extension-webview/src/styles.css'), 'utf8');
  const bcmMap = new Map([...css.matchAll(/\[data-theme='([^']+)'\]\s*\{\s*--bcm:\s*([^;]+);\s*\}/g)].map((m) => [m[1], m[2].trim()]));
  for (const n of ['anubis', 'anubis-light']) bcmMap.set(n, custom[n]['--bcm']);
  return list.map(({ name, dark }) => {
    const src = custom[name] ?? builtin[name];
    if (!src) throw new Error('no colour source for theme ' + name);
    const b1 = parseColor(src['base-100'] ?? '#ffffff');
    const b2 = src['base-200'] ? parseColor(src['base-200']) : darken(b1, 0.07);
    const b3 = src['base-300'] ? parseColor(src['base-300']) : src['base-200'] ? darken(parseColor(src['base-200']), 0.07) : darken(b1, 0.14);
    const bc = src['base-content'] ? parseColor(src['base-content']) : mix(b1, 20, isDark(b1) ? WHITE : BLACK);
    const sem = {
      run: src.info ? parseColor(src.info) : parseTriple('72.06% 0.191 231.6'),
      need: src.warning ? parseColor(src.warning) : parseTriple('84.71% 0.199 83.87'),
      err: src.error ? parseColor(src.error) : parseTriple('71.76% 0.221 22.18'),
      done: src.success ? parseColor(src.success) : parseTriple('64.8% 0.150 160'),
    };
    const own = ['run', 'need', 'err', 'done'].every((k) => src[`--state-ink-${k}`]);
    const bcm = parseTriple(bcmMap.get(name));
    return { name, dark, src, own, b1, b2, b3, bc, bcm, sem, sec: parseColor(src.secondary) };
  });
}

// Per-theme ink derivation for every theme that does not define --state-ink-* (all 32 stock themes).
// Rule: keep the daisyUI semantic colour's hue; if it already clears the target on every surface it sits on, keep it unchanged;
// otherwise move OKLCH lightness away from the surfaces (up on dark themes, down on light ones) in 0.005 steps, keeping chroma as high
// as the sRGB gamut allows at that lightness, until the target is met. The result is rounded to a hex literal and the table measures
// the rounded hex. A flat colour-mix toward base-content was rejected: it works, but at the weights the mid-tone themes need
// (2-4 percent) it rotates the hue (warning turns teal, error turns magenta), which would invert the meaning of the colours.
// Targets carry MARGIN so browser gamut mapping cannot push a value under 4.5 / 3.
export const FALLBACK = { MARGIN: 0.1 };
const toHex = (c) => '#' + c.map((v) => Math.round(clamp(v) * 255).toString(16).padStart(2, '0')).join('');
const inGamut = ([r, g, b]) => [r, g, b].every((v) => v > -1e-4 && v < 1 + 1e-4);
function rawRgb([L, C, H]) {
  const a = C * Math.cos((H * Math.PI) / 180), b = C * Math.sin((H * Math.PI) / 180);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3, m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3, s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s].map(toGam2);
}
const toGam2 = (c) => (c <= 0 ? c : toGam(c));
function fitChroma(L, C, H) {
  if (inGamut(rawRgb([L, C, H]))) return C;
  let lo = 0, hi = C;
  for (let i = 0; i < 24; i++) { const mid = (lo + hi) / 2; if (inGamut(rawRgb([L, mid, H]))) lo = mid; else hi = mid; }
  return lo;
}
export function deriveInk(sem, bc, surfaceList, need) {
  const rounded = hex(toHex(sem));
  if (surfaceList.every((s) => ratio(rounded, s) >= need)) return { dL: 0, hex: toHex(sem), rgb: rounded };
  const [L0, C0, H0] = toOklch(sem);
  const up = lum(bc) > lum(surfaceList[0]);
  for (let d = 0.005; d <= 1; d += 0.005) {
    const L = up ? L0 + d : L0 - d;
    if (L < 0 || L > 1) break;
    const rgb = hex(toHex(oklch([L, fitChroma(L, C0, H0), H0])));
    if (surfaceList.every((s) => ratio(rgb, s) >= need)) return { dL: up ? d : -d, hex: toHex(rgb), rgb };
  }
  return null;
}
// smallest alpha (5% steps) of base-content over the surface that keeps a >= UI outline
export function solveAlpha(bc, surfaceList, need) {
  for (let a = 0.4; a <= 1.0001; a += 0.05) if (surfaceList.every((s) => ratio(over(bc, a, s), s) >= need)) return +a.toFixed(2);
  return null;
}

export function surfacesOf(t) {
  return { 'surface-0': t.b1, 'surface-1': mix(t.b2, 88, t.b1), 'surface-2': t.b2, 'surface-3': mix(t.b3, 86, t.b2) };
}
const minOn = (c, list) => Math.min(...list.map((s) => ratio(c, s)));

// Largest semantic weight (multiples of 5; 100 = the raw colour) at which `sem` mixed toward `bc` reaches `need` on every surface.
export function solveWeight(sem, bc, surfaces, need) {
  for (let w = 100; w >= 0; w -= 5) if (minOn(mix(sem, w, bc), surfaces) >= need) return w;
  return -1;
}

if (IS_MAIN && MODE !== 'anubis') {
  const all = loadThemes();
  const TEXT = 4.5, UI = 3;
  const states = ['run', 'need', 'err', 'done'];
  const f = (x) => x.toFixed(2);
  // The anubis ink values hardcoded above must equal tailwind.config.js (that file is the token source of truth).
  const tw = req(join(ROOT, 'apps/ptah-extension-webview/tailwind.config.js'));
  const cfg = tw.daisyui.themes.find((e) => typeof e === 'object' && e !== null);
  for (const n of Object.keys(themes))
    for (const k of ['run', 'need', 'err', 'done', 'idle'])
      if (cfg[n][`--state-ink-${k}`].toLowerCase() !== '#' + themes[n][k].map((v) => Math.round(v * 255).toString(16).padStart(2, '0')).join(''))
        console.warn(`WARNING: ${n} state-${k} in this script differs from tailwind.config.js`);
  const derived = new Map();
  let alphaNeed = 0.4;
  for (const t of all) {
    if (t.own) continue;
    const sf = surfacesOf(t);
    const s012 = [sf['surface-0'], sf['surface-1'], sf['surface-2']], s0123 = Object.values(sf);
    const d = { accent: deriveInk(t.sec, t.bc, s0123, TEXT + FALLBACK.MARGIN) };
    for (const k of states) d[k] = deriveInk(t.sem[k], t.bc, s012, TEXT + FALLBACK.MARGIN);
    derived.set(t.name, d);
    alphaNeed = Math.max(alphaNeed, solveAlpha(t.bc, s012, UI + FALLBACK.MARGIN) ?? 1);
  }
  if (MODE === 'emit') {
    console.log('/* generated by contrast-check.mjs emit: [data-theme] blocks next to the existing --bcm blocks in styles.css */');
    for (const t of all) {
      if (t.own) continue;
      const d = derived.get(t.name);
      console.log(`[data-theme='${t.name}'] { ${states.map((k) => `--state-ink-${k}: ${d[k].hex};`).join(' ')} --ptah-accent-ink: ${d.accent.hex}; }`);
    }
    process.exit(0);
  }
  console.log(`Per-theme inks: hue kept, OKLCH lightness moved only as far as needed to clear ${TEXT}+${FALLBACK.MARGIN} on surfaces 0-2 (accent: 0-3). Change in L over the 32 stock themes:`);
  for (const k of [...states, 'accent']) {
    const ds = [...derived.values()].map((d) => d[k]?.dL);
    console.log(`  ${k}: unchanged ${ds.filter((x) => x === 0).length}/${ds.length}  moved ${ds.filter((x) => x).length}  max |dL| ${Math.max(...ds.map((x) => Math.abs(x ?? 9))).toFixed(3)}  unsolved=${ds.filter((x) => x === undefined).length}`);
  }
  console.log(`Check-box outline alpha needed by the stock themes (>= ${UI}+${FALLBACK.MARGIN} on surfaces 0-2): ${alphaNeed.toFixed(2)}; anubis keeps its measured 0.55`);

  console.log('Min contrast per theme. Text pairs on surfaces 0-2, accent text 0-2, focus ring 0-3, checkbox outline on 0-2, done glyph and done fill on surface 0 (UI). raw = today; fb = per-theme token (own = anubis).');
  console.log('theme'.padEnd(13) + 'mode'.padEnd(6) + 'src'.padEnd(5) + 'text raw run/need/err/done'.padEnd(30) + 'text fb run/need/err/done'.padEnd(30) + 'link raw/fb'.padEnd(13) + 'ring raw/fb'.padEnd(13) + 'chk raw/fb'.padEnd(12) + 'glyph'.padEnd(7) + 'bcm'.padEnd(6) + 'verdict');
  const failed = [];
  for (const t of all) {
    const sf = surfacesOf(t);
    const s012 = [sf['surface-0'], sf['surface-1'], sf['surface-2']], s0123 = Object.values(sf);
    let inkOf, accent;
    if (t.own) { inkOf = (k) => themes[t.name][k]; accent = themes[t.name].ring; }
    else { const d = derived.get(t.name); inkOf = (k) => d[k].rgb; accent = d.accent.rgb; }
    const rawAccent = t.own ? accent : t.sec;
    const raw = states.map((k) => minOn(t.own ? inkOf(k) : t.sem[k], s012));
    const fb = states.map((k) => minOn(inkOf(k), s012));
    const linkRaw = minOn(rawAccent, s012), linkFb = minOn(accent, s012);
    const ringRaw = minOn(rawAccent, s0123), ringFb = minOn(accent, s0123);
    const alpha = t.own ? 0.55 : alphaNeed;
    const chkRaw = Math.min(...s012.map((s) => ratio(over(t.bc, 0.55, s), s)));
    const chkFb = Math.min(...s012.map((s) => ratio(over(t.bc, alpha, s), s)));
    const glyph = ratio(t.b1, inkOf('done'));
    const bcm = minOn(t.bcm, s0123);
    const ok = fb.every((v) => v >= TEXT) && linkFb >= TEXT && ringFb >= UI && (t.own ? ratio(over(t.bc, 0.55, t.b1), t.b1) : chkFb) >= UI && glyph >= UI && bcm >= TEXT;
    if (!ok) failed.push(t.name);
    console.log(t.name.padEnd(13) + (t.dark ? 'dark' : 'light').padEnd(6) + (t.own ? 'own' : 'fb').padEnd(5) + raw.map(f).join('/').padEnd(30) + fb.map(f).join('/').padEnd(30) + `${f(linkRaw)}/${f(linkFb)}`.padEnd(13) + `${f(ringRaw)}/${f(ringFb)}`.padEnd(13) + `${f(chkRaw)}/${f(chkFb)}`.padEnd(12) + f(glyph).padEnd(7) + f(bcm).padEnd(6) + (ok ? 'PASS' : 'FAIL'));
  }
  console.log(`
${all.length} themes, ${all.length - failed.length} pass, ${failed.length} fail${failed.length ? ': ' + failed.join(', ') : ''}`);
  process.exitCode = failed.length ? 1 : 0;
}
