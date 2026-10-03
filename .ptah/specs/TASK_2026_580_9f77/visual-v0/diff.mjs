import { chromium } from '@playwright/test';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
const D = 'D:/projects/ptah-extension/.claude-worktrees/task-580/.ptah/specs/TASK_2026_580_9f77/';
const b = await chromium.launch();
const b64 = (f) => 'data:image/png;base64,' + readFileSync(f).toString('base64');
const cmp = async (a, c, spec) => { const pg = await b.newPage(); try { return await cmp0(pg, a, c, spec); } finally { await pg.close(); } };
const cmp0 = (p, a, c, spec) => p.evaluate(async ([a, c, spec]) => {
  const load = (s) => new Promise((res) => { const i = new Image(); i.onload = () => res(i); i.src = s; });
  const [A, B] = [await load(a), await load(c)];
  const g = (i) => { const cv = document.createElement('canvas'); cv.width = i.width; cv.height = i.height; const x = cv.getContext('2d'); x.drawImage(i, 0, 0); return x.getImageData(0, 0, i.width, i.height).data; };
  const da = g(A), db = g(B);
  if (A.width !== B.width) return { widthDiff: [A.width, B.width] };
  const W = A.width; const px = (d, x, y, k) => d[(y * W + x) * 4 + k];
  const ua = new Uint32Array(da.buffer), ub = new Uint32Array(db.buffer);
  const rowsDiff = (ya0, ya1, shift, step = 1) => { let n = 0; for (let y = ya0; y < ya1; y += step) { const yb = y + shift; if (yb >= B.height || y >= A.height) break; for (let x = 0; x < W; x++) { const i = y * W + x, j = yb * W + x; if (ua[i] === ub[j]) continue; for (let k = 0; k < 3; k++) if (Math.abs(da[i * 4 + k] - db[j * 4 + k]) > 8) { n++; break; } } } return n; };
  const out = { baseH: A.height, afterH: B.height };
  if (spec.mode === 'full') { out.diff = A.height === B.height ? rowsDiff(0, A.height, 0) : 'height differs'; return out; }
  out.aboveDiff = rowsDiff(0, spec.top, 0);
  let best = null;
  for (let s = spec.minShift; s <= spec.maxShift; s++) { const d = rowsDiff(spec.top, Math.min(A.height, B.height - s, spec.bottom ?? 1e9), s, 7); if (best === null || d < best.diff) best = { shift: s, diff: d }; }
  { const fin = rowsDiff(spec.top, Math.min(A.height, B.height - best.shift, spec.bottom ?? 1e9), best.shift); best = { shift: best.shift, diff: fin }; } out.below = best; out.belowRows = Math.min(A.height, B.height - best.shift, spec.bottom ?? 1e9) - spec.top;
  return out;
}, [a, c, spec]);
const lines = []; const res = {};
for (const host of ['electron', 'vscode']) {
  const A = require_(D + 'visual-v0/base-' + host + '/results.json'), B = require_(D + 'visual-v0/after-' + host + '/results.json');
  for (const t of ['anubis', 'anubis-light']) for (const w of [360, 800, 1400]) {
    const key = t + '-' + w;
    for (const id of ['TASK_T1_none', 'TASK_T2_three', 'TASK_T3_prnonum', 'TASK_T4_nopr', 'TASK_T5_long']) {
      const fa = D + 'visual-v0/base-' + host + '/card-' + id + '-' + key + '.png', fb = D + 'visual-v0/after-' + host + '/card-' + id + '-' + key + '.png';
      const ca = A[key].cards[id], cb = B[key].cards[id];
      const spec = cb.row ? { mode: 'row', top: cb.row[0], minShift: Math.max(0, cb.h - ca.h - 2), maxShift: cb.h - ca.h + 2 } : { mode: 'full' };
      const r = await cmp(b64(fa), b64(fb), spec); res[host + ' ' + key + ' card ' + id] = { baseH: ca.h, afterH: cb.h, row: cb.row, ...r };
    }
    for (const id of ['TASK_D1_none', 'TASK_D2_three', 'TASK_D3_many']) {
      const fa = D + 'visual-v0/base-' + host + '/detail-' + id + '-' + key + '.png', fb = D + 'visual-v0/after-' + host + '/detail-' + id + '-' + key + '.png';
      const sec = B[key].details[id].sec; const secH = sec[1];
      const r = await cmp(b64(fa), b64(fb), { mode: 'row', top: sec[0], minShift: secH - 2, maxShift: secH + 24, bottom: 1400 }); res[host + ' ' + key + ' detail ' + id] = { sec, ...r };
    }
  }
}
writeFileSync(D + 'visual-v0/diff-results.json', JSON.stringify(res, null, 2));
for (const [k, v] of Object.entries(res)) console.log(k, JSON.stringify(v));
await b.close();
function require_(f) { return JSON.parse(readFileSync(f, 'utf8')); }
