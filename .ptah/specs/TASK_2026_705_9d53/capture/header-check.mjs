// Header focus + contrast check (AFTER). Reuses the webview emulation.
import { chromium } from '@playwright/test';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
const WT = 'D:/projects/ptah-extension/.claude-worktrees/remove-single-layout';
const ROOT = path.join(WT, 'dist/apps/ptah-extension-webview/browser');
const OUT = path.join(WT, '.ptah/specs/TASK_2026_705_9d53/screenshots/after');
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  let f = path.normalize(path.join(ROOT, p));
  if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) f = path.join(ROOT, 'index.csr.html');
  if (!fs.existsSync(f)) f = path.join(ROOT, 'index.html');
  const mime = { '.js': 'application/javascript', '.css': 'text/css', '.html': 'text/html' }[path.extname(f)] ?? 'application/octet-stream';
  res.writeHead(200, { 'content-type': mime });
  fs.createReadStream(f).pipe(res);
});
await new Promise((r) => server.listen(0, r));
const url = `http://localhost:${server.address().port}/`;
const browser = await chromium.launch();
for (const [themeKey, theme] of [['dark', 'anubis'], ['light', 'anubis-light']]) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  await page.route('**/*', (r) => (r.request().url().startsWith('http://localhost') ? r.continue() : r.abort()));
  await page.addInitScript(([t]) => {
    const s = { v: undefined };
    window.acquireVsCodeApi = () => ({ postMessage() {}, getState: () => s.v, setState: (v) => { s.v = v; } });
    window.ptahConfig = { isVSCode: true, theme: t === 'anubis' ? 'dark' : 'light', extensionUri: '', baseUri: '', iconUri: '', userIconUri: '', panelId: 'a4', platform: 'win32', initialView: 'chat' };
    localStorage.setItem('ptah-theme', t);
  }, [theme]);
  await page.goto(url);
  await page.locator('ptah-app-shell').waitFor({ state: 'visible', timeout: 30000 });
  await page.waitForTimeout(2500);
  await page.getByRole('button', { name: /close|dismiss/i }).first().click({ timeout: 2000 }).catch(() => {});
  const names = ['Dashboard', 'Thoth', 'Tribunal', 'Tasks', 'Marketplace'];
  const out = [];
  await page.keyboard.press('Tab'); // enter document
  for (let i = 0; i < 12; i++) {
    const r = await page.evaluate(() => {
      const e = document.activeElement; const cs = getComputedStyle(e); const r = e.getBoundingClientRect();
      return { n: (e.getAttribute('aria-label') || e.title || e.textContent || '').trim().slice(0, 25), top: Math.round(r.top), outline: `${cs.outlineStyle} ${cs.outlineWidth} ${cs.outlineColor}`, fv: e.matches(':focus-visible') };
    });
    if (r.top < 60) out.push(r);
    if (r.n.startsWith('Tribunal')) await page.screenshot({ path: path.join(OUT, `vscode-wide-header-focus-${themeKey}.png`), clip: { x: 0, y: 0, width: 1280, height: 120 } });
    await page.keyboard.press('Tab');
  }
  console.log(themeKey, 'HEADERFOCUS', JSON.stringify(out));
  // contrast of label + header buttons
  const c = await page.evaluate(() => {
    const parse = (s) => { const m = document.createElement('canvas').getContext('2d'); m.fillStyle = s; m.fillRect(0, 0, 1, 1); return [...m.getImageData(0, 0, 1, 1).data]; };
    const lum = ([r, g, b]) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
    const bgOf = (e) => { while (e) { const b = getComputedStyle(e).backgroundColor; const p = parse(b); if (p[3] > 250) return p; e = e.parentElement; } return [0, 0, 0]; };
    const res = {};
    const els = { label: [...document.querySelectorAll('span')].find((s) => s.textContent.trim() === 'Orchestra Canvas'), dashboard: document.querySelector('button[aria-label="Dashboard"]'), settings: document.querySelector('button[aria-label="Settings"]') };
    for (const [k, e] of Object.entries(els)) {
      if (!e) { res[k] = null; continue; }
      const fg = parse(getComputedStyle(e).color), bg = bgOf(e);
      const L1 = lum(fg), L2 = lum(bg);
      res[k] = { ratio: +((Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05)).toFixed(2), fs: getComputedStyle(e).fontSize };
    }
    return res;
  });
  console.log(themeKey, 'CONTRAST', JSON.stringify(c));
  await ctx.close();
}
await browser.close(); server.close();
