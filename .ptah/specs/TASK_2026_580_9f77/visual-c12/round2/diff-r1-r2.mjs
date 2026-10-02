import { chromium } from '@playwright/test';
import { readFileSync, existsSync, readdirSync, writeFileSync } from 'node:fs';
const D = 'D:/projects/ptah-extension/.claude-worktrees/task-580/.ptah/specs/TASK_2026_580_9f77/visual-c12/';
const names = readdirSync(D + 'round1').filter((f) => /^r1-(org|vscode)-.*\.png$/.test(f));
const b = await chromium.launch(); const out = {};
for (const n of names) {
  const m = n.replace(/^r1-/, 'r2-'); if (!existsSync(D + 'round2/' + m)) { out[n] = 'missing in r2'; continue; }
  const p = await b.newPage();
  out[n.replace(/^r1-/, '')] = await p.evaluate(async ([a, c]) => { const load = (s) => new Promise((r) => { const i = new Image(); i.onload = () => r(i); i.src = s; }); const [A, B] = [await load(a), await load(c)]; if (A.width !== B.width || A.height !== B.height) return { size: [A.width, A.height, B.width, B.height] }; const g = (i) => { const cv = document.createElement('canvas'); cv.width = i.width; cv.height = i.height; const x = cv.getContext('2d'); x.drawImage(i, 0, 0); return x.getImageData(0, 0, i.width, i.height).data; }; const da = g(A), db = g(B); let n = 0, y0 = 1e9, y1 = -1; for (let i = 0; i < da.length; i += 4) if (Math.abs(da[i] - db[i]) > 8 || Math.abs(da[i + 1] - db[i + 1]) > 8 || Math.abs(da[i + 2] - db[i + 2]) > 8) { n++; const y = Math.floor(i / 4 / A.width); y0 = Math.min(y0, y); y1 = Math.max(y1, y); } return { diff: n, y: n ? [y0, y1] : null }; }, ['data:image/png;base64,' + readFileSync(D + 'round1/' + n).toString('base64'), 'data:image/png;base64,' + readFileSync(D + 'round2/' + m).toString('base64')]);
  await p.close();
}
writeFileSync(D + 'round2/diff-r1-r2.json', JSON.stringify(out, null, 2));
for (const [k, v] of Object.entries(out)) console.log(k, JSON.stringify(v));
await b.close();
