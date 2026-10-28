// Measures every text / UI pair the P6 spec uses, in both themes, from the prototype's own CSS variables.
// Usage: node contrast.mjs
import { createRequire } from 'node:module';
import path from 'node:path';
const require = createRequire('D:/projects/ptah-extension/.claude-worktrees/claude-named-accounts/package.json');
const { chromium } = require('@playwright/test');
const dir = path.dirname(new URL(import.meta.url).pathname.replace(/^\//, ''));
const url = (q) => 'file:///' + path.join(dir, 'index.html').replace(/\\/g, '/') + q;
const pairs = [
  ['text', 'bc', 'b1', 'body text on surface'], ['text', 'bc', 'b2', 'popover text'], ['text', 'bc', 'b3', 'badge / toast text'],
  ['text', 'bm', 'b1', 'muted text, rows and labels'], ['text', 'bm', 'b2', 'muted text, popover labels'], ['text', 'bm', 'b3', 'muted text on toast/menu'],
  ['text', 'pc', 'p', 'primary button label'],
  ['ui', 'ink-done', 'b1', 'status dot signed in'], ['ui', 'ink-idle', 'b1', 'status dot signed out'], ['ui', 'ink-run', 'b1', 'status dot/spinner running'],
  ['ui', 'ink-err', 'b1', 'status dot failed / attention bar'], ['ui', 'err', 'b1', 'remove button + invalid select border'],
  ['ui', 'bm', 'b1', 'select / input / outline-button border'], ['ui', 'bm', 'b2', 'select border inside popover'],
  ['ui', 'bc', 'b1', 'focus ring on surface'], ['ui', 'bc', 'b2', 'focus ring in popover'], ['ui', 'bc', 'b3', 'focus ring in menu'],
];
const b = await chromium.launch();
for (const [name, q] of [['ptah-glass', ''], ['ptah-glass-light', '?theme=light']]) {
  const p = await b.newPage();
  await p.goto(url(q));
  const rows = await p.evaluate((pairs) => {
    const c = document.createElement('canvas'); c.width = c.height = 1; const x = c.getContext('2d', { willReadFrequently: true });
    const rgb = (v) => { x.clearRect(0, 0, 1, 1); x.fillStyle = '#000'; x.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--' + v).trim(); x.fillRect(0, 0, 1, 1); return [...x.getImageData(0, 0, 1, 1).data].slice(0, 3); };
    const lum = ([r, g, b]) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
    return pairs.map(([kind, fg, bg, use]) => { const a = lum(rgb(fg)), d = lum(rgb(bg)); const r = (Math.max(a, d) + 0.05) / (Math.min(a, d) + 0.05); const need = kind === 'text' ? 4.5 : 3; return { kind, fg, bg, use, ratio: +r.toFixed(2), need, pass: r >= need }; });
  }, pairs);
  console.log('## ' + name);
  for (const r of rows) console.log(`${r.pass ? 'PASS' : 'FAIL'} ${r.kind} ${r.fg} on ${r.bg} = ${r.ratio}:1 (need ${r.need}) ${r.use}`);
  await p.close();
}
await b.close();
