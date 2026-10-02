import { chromium } from '@playwright/test';
import { readFileSync } from 'node:fs';
const D = 'D:/projects/ptah-extension/.claude-worktrees/task-580/.ptah/specs/TASK_2026_580_9f77/visual-c12/';
const b = await chromium.launch(); const out = [];
for (const t of ['anubis', 'anubis-light']) for (const w of [360, 800, 1400]) for (const k of ['sidebar', 'full']) {
  const p = await b.newPage();
  const f = (path) => 'data:image/png;base64,' + readFileSync(D + path).toString('base64');
  const r = await p.evaluate(async ([a, c]) => { const load = (s) => new Promise((r) => { const i = new Image(); i.onload = () => r(i); i.src = s; }); const [A, B] = [await load(a), await load(c)]; if (A.width !== B.width || A.height !== B.height) return { size: [A.width, A.height, B.width, B.height] }; const g = (i) => { const cv = document.createElement('canvas'); cv.width = i.width; cv.height = i.height; const x = cv.getContext('2d'); x.drawImage(i, 0, 0); return x.getImageData(0, 0, i.width, i.height).data; }; const da = g(A), db = g(B); let n = 0, y0 = 1e9, y1 = -1; for (let i = 0; i < da.length; i += 4) if (Math.abs(da[i] - db[i]) > 8 || Math.abs(da[i + 1] - db[i + 1]) > 8 || Math.abs(da[i + 2] - db[i + 2]) > 8) { n++; const y = Math.floor(i / 4 / A.width); y0 = Math.min(y0, y); y1 = Math.max(y1, y); } return { diff: n, y: n ? [y0, y1] : null }; }, [f('before-vscode-' + t + '-' + w + '-' + k + '.png'), f('round2/r2-vscode-' + t + '-' + w + '-' + k + '.png')]);
  out.push(t + '-' + w + '-' + k + ' ' + JSON.stringify(r)); await p.close();
}
console.log(out.join('\n')); await b.close();
