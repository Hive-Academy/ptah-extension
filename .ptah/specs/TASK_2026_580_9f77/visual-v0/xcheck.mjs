import { chromium } from '@playwright/test';
import { readFileSync, existsSync } from 'node:fs';
const D = 'D:/projects/ptah-extension/.claude-worktrees/task-580/.ptah/specs/TASK_2026_580_9f77/';
const b = await chromium.launch(); const out = [];
for (const key of ['anubis-360', 'anubis-1400', 'anubis-light-360', 'anubis-light-1400']) for (const [n, id] of [['three', 'TASK_T2_three'], ['long', 'TASK_T5_long']]) {
  const fa = D + 'visual-c22/round1/card-' + n + '-' + key + '.png', fb = D + 'visual-v0/after-electron/card-' + id + '-' + key + '.png';
  if (!existsSync(fa)) { out.push(key + ' ' + n + ' no prior shot'); continue; }
  const p = await b.newPage();
  const r = await p.evaluate(async ([a, c]) => { const load = (s) => new Promise((r) => { const i = new Image(); i.onload = () => r(i); i.src = s; }); const [A, B] = [await load(a), await load(c)]; if (A.width !== B.width || A.height !== B.height) return { size: [A.width, A.height, B.width, B.height] }; const g = (i) => { const cv = document.createElement('canvas'); cv.width = i.width; cv.height = i.height; const x = cv.getContext('2d'); x.drawImage(i, 0, 0); return x.getImageData(0, 0, i.width, i.height).data; }; const da = g(A), db = g(B); let n = 0; for (let i = 0; i < da.length; i += 4) if (Math.abs(da[i] - db[i]) > 8 || Math.abs(da[i + 1] - db[i + 1]) > 8 || Math.abs(da[i + 2] - db[i + 2]) > 8) n++; return { diff: n, of: A.width * A.height }; }, ['data:image/png;base64,' + readFileSync(fa).toString('base64'), 'data:image/png;base64,' + readFileSync(fb).toString('base64')]);
  out.push(key + ' ' + n + ' ' + JSON.stringify(r)); await p.close();
}
console.log(out.join('\n')); await b.close();
