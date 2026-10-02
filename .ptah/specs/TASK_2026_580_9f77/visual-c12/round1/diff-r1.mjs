import { chromium } from '@playwright/test';
import { readFileSync } from 'node:fs';
const D = '.ptah/specs/TASK_2026_580_9f77/visual-c12/';
const b = await chromium.launch(); const p = await b.newPage();
const out = [];
for (const t of ['anubis', 'anubis-light']) for (const w of [360, 800, 1400]) for (const k of ['sidebar', 'full']) {
  const f = (tag) => 'data:image/png;base64,' + readFileSync(D + (tag === 'after' ? 'round1/r1' : tag) + '-vscode-' + t + '-' + w + '-' + k + '.png').toString('base64');
  const r = await p.evaluate(async ([a, c]) => {
    const load = (s) => new Promise((res) => { const i = new Image(); i.onload = () => res(i); i.src = s; });
    const [A, B] = [await load(a), await load(c)];
    if (A.width !== B.width || A.height !== B.height) return { size: [A.width, A.height, B.width, B.height] };
    const g = (i) => { const cv = document.createElement('canvas'); cv.width = i.width; cv.height = i.height; const x = cv.getContext('2d'); x.drawImage(i, 0, 0); return x.getImageData(0, 0, i.width, i.height).data; };
    const da = g(A), db = g(B); let n = 0, minY = 1e9, maxY = -1;
    for (let i = 0; i < da.length; i += 4) { if (Math.abs(da[i] - db[i]) > 8 || Math.abs(da[i + 1] - db[i + 1]) > 8 || Math.abs(da[i + 2] - db[i + 2]) > 8) { n++; const y = Math.floor(i / 4 / A.width); minY = Math.min(minY, y); maxY = Math.max(maxY, y); } }
    return { w: A.width, h: A.height, diff: n, y: n ? [minY, maxY] : null };
  }, [f('before'), f('after')]);
  out.push(t + '-' + w + '-' + k + ' ' + JSON.stringify(r));
}
console.log(out.join('\n'));
await b.close();
