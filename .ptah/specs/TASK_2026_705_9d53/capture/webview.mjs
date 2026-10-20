// BEFORE capture, VS Code webview host emulation (harness approach from libs/frontend/webview-e2e-harness).
import { chromium } from '@playwright/test';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const WT = 'D:/projects/ptah-extension/.claude-worktrees/remove-single-layout';
const ROOT = path.join(WT, 'dist/apps/ptah-extension-webview/browser');
const OUT = path.join(WT, '.ptah/specs/TASK_2026_705_9d53/screenshots/before');
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
try {
  for (const [themeKey, theme] of [['dark', 'anubis'], ['light', 'anubis-light']]) {
    for (const [sk, [w, h]] of Object.entries(sizes)) {
      const ctx = await browser.newContext({ viewport: { width: w, height: h } });
      const page = await ctx.newPage();
      await page.route('**/*', (route) => {
        const u = route.request().url();
        if (u.startsWith('http://localhost')) return route.continue();
        return route.abort();
      });
      await page.addInitScript(([t]) => {
        const state = { v: undefined };
        window.__out = [];
        window.acquireVsCodeApi = () => ({ postMessage: (m) => window.__out.push(m), getState: () => state.v, setState: (v) => { state.v = v; } });
        window.ptahConfig = { isVSCode: true, theme: t === 'anubis' ? 'dark' : 'light', extensionUri: '', baseUri: '', iconUri: '', userIconUri: '', panelId: 'b4', platform: 'win32', initialView: 'chat' };
        localStorage.setItem('ptah-theme', t);
      }, [theme]);
      await page.goto(url);
      await page.locator('ptah-app-shell').waitFor({ state: 'visible', timeout: 30000 });
      await page.waitForTimeout(2500);
      const info = async (tag) => console.log(themeKey, sk, tag, 'theme', await page.evaluate(() => document.documentElement.getAttribute('data-theme')),
        'tabbar', await page.locator('ptah-tab-bar').count(), 'grid', await page.locator('[data-testid="canvas-grid"]').isVisible().catch(() => false),
        'layoutKey', await page.evaluate(() => localStorage.getItem('ptah-layout-mode')));
      await page.getByRole('button', { name: /close|dismiss/i }).first().click({ timeout: 2000 }).catch(() => {});
      await info('initial');
      await page.screenshot({ path: path.join(OUT, `vscode-${sk}-grid-${themeKey}-empty.png`) });
      for (let i = 0; i < 3; i++) {
        try {
          await page.locator('[data-testid="canvas-new-session-anchor"]').first().click({ timeout: 5000 });
          await page.getByRole('button', { name: 'Create', exact: true }).click({ timeout: 5000 });
          await page.waitForTimeout(1200);
        } catch (e) { console.log('newSession fail', String(e).slice(0, 100)); break; }
      }
      await info('with sessions');
      await page.screenshot({ path: path.join(OUT, `vscode-${sk}-grid-${themeKey}.png`) });
      const toggle = page.getByRole('button', { name: /Toggle canvas grid/i });
      console.log('toggle count', await toggle.count());
      if (await toggle.count()) { await toggle.first().click(); await page.waitForTimeout(1500); }
      await info('after toggle');
      await page.screenshot({ path: path.join(OUT, `vscode-${sk}-single-${themeKey}.png`) });
      await ctx.close();
    }
  }
} finally { await browser.close(); server.close(); }
