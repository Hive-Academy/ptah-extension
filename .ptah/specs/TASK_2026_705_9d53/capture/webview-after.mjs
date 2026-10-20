// AFTER capture, VS Code webview emulation. No toggle exists; 'single' reached via stored localStorage.
import { chromium } from '@playwright/test';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
const WT = 'D:/projects/ptah-extension/.claude-worktrees/remove-single-layout';
const ROOT = path.join(WT, 'dist/apps/ptah-extension-webview/browser');
const OUT = path.join(WT, '.ptah/specs/TASK_2026_705_9d53/screenshots/after');
const MIME = { '.html': 'text/html', '.js': 'application/javascript', '.mjs': 'application/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.ico': 'image/x-icon' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  let f = path.normalize(path.join(ROOT, p));
  if (!f.startsWith(path.normalize(ROOT))) { res.writeHead(403); return res.end(); }
  if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) f = path.join(ROOT, 'index.csr.html');
  if (!fs.existsSync(f)) f = path.join(ROOT, 'index.html');
  res.writeHead(200, { 'content-type': MIME[path.extname(f)] ?? 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
});
await new Promise((r) => server.listen(0, r));
const url = `http://localhost:${server.address().port}/`;
const browser = await chromium.launch();
const sizes = { wide: [1280, 800], narrow: [420, 800] };
const hdrInfo = () => {
  const out = { overflowX: document.documentElement.scrollWidth > document.documentElement.clientWidth, buttons: [] };
  const btns = [...document.querySelectorAll('ptah-app-shell button')].filter((b) => b.getBoundingClientRect().top < 60 && b.offsetParent);
  const rects = btns.map((b) => { const r = b.getBoundingClientRect(); return { n: (b.getAttribute('aria-label') || b.title || b.textContent || '').trim().slice(0, 30), x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }; });
  out.buttons = rects;
  out.overlaps = [];
  for (let i = 0; i < btns.length; i++) for (let j = i + 1; j < btns.length; j++) {
    const a = btns[i].getBoundingClientRect(), b = btns[j].getBoundingClientRect();
    if (a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1) out.overlaps.push([rects[i].n, rects[j].n]);
  }
  return out;
};
try {
  for (const [themeKey, theme] of [['dark', 'anubis'], ['light', 'anubis-light']]) {
    for (const [sk, [w, h]] of Object.entries(sizes)) {
      for (const mode of ['normal', 'stored']) {
        const ctx = await browser.newContext({ viewport: { width: w, height: h } });
        const page = await ctx.newPage();
        await page.route('**/*', (route) => route.request().url().startsWith('http://localhost') ? route.continue() : route.abort());
        await page.addInitScript(([t, m]) => {
          const state = { v: undefined };
          window.__out = [];
          window.acquireVsCodeApi = () => ({ postMessage: (x) => window.__out.push(x), getState: () => state.v, setState: (v) => { state.v = v; } });
          window.ptahConfig = { isVSCode: true, theme: t === 'anubis' ? 'dark' : 'light', extensionUri: '', baseUri: '', iconUri: '', userIconUri: '', panelId: 'a4', platform: 'win32', initialView: 'chat' };
          localStorage.setItem('ptah-theme', t);
          if (m === 'stored') localStorage.setItem('ptah-layout-mode', 'single');
        }, [theme, mode]);
        await page.goto(url);
        await page.locator('ptah-app-shell').waitFor({ state: 'visible', timeout: 30000 });
        await page.waitForTimeout(2500);
        const info = async (tag) => console.log(themeKey, sk, mode, tag, 'theme', await page.evaluate(() => document.documentElement.getAttribute('data-theme')),
          'tabbar', await page.locator('ptah-tab-bar').count(), 'toggle', await page.getByRole('button', { name: /Toggle canvas grid/i }).count(),
          'orchLabel', await page.getByText('Orchestra Canvas').count(), 'grid', await page.locator('[data-testid="canvas-grid"]').isVisible().catch(() => false),
          'layoutKey', await page.evaluate(() => localStorage.getItem('ptah-layout-mode')), 'hdr', JSON.stringify(await page.evaluate(hdrInfo)));
        await page.getByRole('button', { name: /close|dismiss/i }).first().click({ timeout: 2000 }).catch(() => {});
        await info('initial');
        await page.screenshot({ path: path.join(OUT, mode === 'normal' ? `vscode-${sk}-grid-${themeKey}-empty.png` : `vscode-${sk}-single-stored-${themeKey}-empty.png`) });
        for (let i = 0; i < 3; i++) {
          try {
            await page.locator('[data-testid="canvas-new-session-anchor"]').first().click({ timeout: 5000 });
            await page.getByRole('button', { name: 'Create', exact: true }).click({ timeout: 5000 });
            await page.waitForTimeout(1200);
          } catch (e) { console.log('newSession fail', String(e).slice(0, 100)); break; }
        }
        await info('with sessions');
        await page.screenshot({ path: path.join(OUT, mode === 'normal' ? `vscode-${sk}-grid-${themeKey}.png` : `vscode-${sk}-single-stored-${themeKey}.png`) });
        if (mode === 'normal' && sk === 'wide') {
          const res = [];
          await page.evaluate(() => document.activeElement?.blur());
          for (let i = 0; i < 12; i++) {
            await page.keyboard.press('Tab');
            res.push(await page.evaluate(() => { const e = document.activeElement; if (!e) return null; const cs = getComputedStyle(e); const r = e.getBoundingClientRect(); return { t: e.tagName, n: (e.getAttribute('aria-label') || e.title || e.textContent || '').trim().slice(0, 25), outline: cs.outlineStyle + ' ' + cs.outlineWidth + ' ' + cs.outlineColor, shadow: cs.boxShadow.slice(0, 50), color: cs.color, bg: cs.backgroundColor, w: Math.round(r.width), h: Math.round(r.height), y: Math.round(r.y) }; }));
            if (i === 3) await page.screenshot({ path: path.join(OUT, `vscode-wide-header-focus-${themeKey}.png`), clip: { x: 0, y: 0, width: w, height: 120 } });
          }
          console.log(themeKey, 'FOCUS', JSON.stringify(res));
        }
        await ctx.close();
      }
    }
  }
} finally { await browser.close(); server.close(); }
