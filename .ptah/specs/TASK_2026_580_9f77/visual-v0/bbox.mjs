import { chromium } from '@playwright/test';
import { readFileSync } from 'node:fs';
const D = 'D:/projects/ptah-extension/.claude-worktrees/task-580/.ptah/specs/TASK_2026_580_9f77/visual-v0/';
const b = await chromium.launch(); const out = [];
for (const [host, key, id, top] of [['electron', 'anubis-360', 'TASK_D2_three', 601], ['vscode', 'anubis-light-360', 'TASK_D1_none', 585]]) {
  const p = await b.newPage();
  const f = (t) => 'data:image/png;base64,' + readFileSync(D + t + '-' + host + '/detail-' + id + '-' + key + '.png').toString('base64');
  out.push(host + ' ' + key + ' ' + id + ' ' + JSON.stringify(await p.evaluate(async ([a, c, top]) => {
    const load = (s) => new Promise((r) => { const i = new Image(); i.onload = () => r(i); i.src = s; });
    const [A, B] = [await load(a), await load(c)]; const g = (i) => { const cv = document.createElement('canvas'); cv.width = i.width; cv.height = i.height; const x = cv.getContext('2d'); x.drawImage(i, 0, 0); return x.getImageData(0, 0, i.width, i.height).data; };
    const da = g(A), db = g(B); const W = A.width; let n = 0, x0 = 1e9, x1 = -1, y0 = 1e9, y1 = -1;
    for (let y = 0; y < top; y++) for (let x = 0; x < W; x++) { const i = (y * W + x) * 4; if (Math.abs(da[i] - db[i]) > 8 || Math.abs(da[i + 1] - db[i + 1]) > 8 || Math.abs(da[i + 2] - db[i + 2]) > 8) { n++; x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); } }
    return { n, x: [x0, x1], y: [y0, y1], W };
  }, [f('base'), f('after'), top])));
  await p.close();
}
console.log(out.join('\n')); await b.close();
