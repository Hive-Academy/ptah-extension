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
    gold: hex('#d4af37'), primary: hex('#2563eb'), pc: hex('#f8f7f4'), warnC: hex('#131317'),
    add: hex('#4ade80'), del: hex('#f87171'),
  },
  'anubis-light': {
    b1: oklch([0.97788, 0.004, 56.375]), b2: oklch([0.93982, 0.007, 61.449]), b3: oklch([0.91586, 0.006, 53.44]),
    bc: oklch([0.23574, 0.066, 313.189]), bcm: oklch([0.48955188, 0.044796, 348.478612]),
    run: hex('#2a56c6'), need: hex('#8f5200'), err: hex('#b4232a'), done: hex('#13713a'), idle: hex('#6b6570'),
    gold: oklch([0.58, 0.132, 75]), primary: oklch([0.85, 0.138, 181.071]), pc: oklch([0.36, 0.078, 188.216]),
    warnC: oklch([0.28, 0.066, 53.813]), add: hex('#13713a'), del: hex('#b4232a'),
  },
};

if (process.argv[1] && process.argv[1].endsWith('contrast-check.mjs')) {
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
    rows.push(['focus ring ptah-gold on surface-0', ratio(t.gold, s0)]);
    rows.push(['send button: base-100 glyph on base-content', ratio(t.b1, t.bc)]);
    rows.push(['diff add on surface-0', ratio(t.add, s0)]);
    rows.push(['diff del on surface-0', ratio(t.del, s0)]);
    rows.push(['state-run tint chip bg (12% run on s1) text state-run', ratio(t.run, over(t.run, 0.12, s1))]);
    rows.push(['state-need tint (12% need on s2) text state-need', ratio(t.need, over(t.need, 0.12, s2))]);
    for (const [n, r] of rows) console.log(r.toFixed(2).padStart(6) + ':1  ' + n);
  }
}
