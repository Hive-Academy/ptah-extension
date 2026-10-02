import { chromium } from '@playwright/test';
import { createServer } from 'node:http';
import { createReadStream, statSync, existsSync, writeFileSync } from 'node:fs';
import { join, extname, resolve } from 'node:path';

const ROOT = resolve('dist/apps/ptah-extension-webview/browser');
const OUT = resolve('.ptah/specs/TASK_2026_580_9f77/visual-c22');
const MIME = { '.html': 'text/html', '.js': 'application/javascript', '.mjs': 'application/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf' };
const srv = createServer((req, res) => {
  const p = decodeURIComponent((req.url || '/').split('?')[0]);
  let f = join(ROOT, p);
  if (!f.startsWith(ROOT) || !existsSync(f) || statSync(f).isDirectory()) f = join(ROOT, 'index.html');
  res.setHeader('Content-Type', MIME[extname(f)] || 'application/octet-stream');
  createReadStream(f).pipe(res);
});
await new Promise((r) => srv.listen(0, '127.0.0.1', r));
const URL = 'http://127.0.0.1:' + srv.address().port + '/';

const LONG = 'Migrate the entire session organization pipeline to the new reactive linked-sessions model without breaking any existing workspace-scoped consumers anywhere';
const mk = (id, title, status = 'backlog') => ({ id, folderName: id, status, type: 'FEATURE', title, dependsOn: [], labels: [], duplicates: [], relatesTo: [], created: null, updated: null, frontmatterValid: true, validationIssues: [] });
const tasks = [
  mk('TASK_T1_none', 'No sessions task'),
  mk('TASK_T2_three', 'Three sessions with PR number'),
  mk('TASK_T3_prnonum', 'PR without number'),
  mk('TASK_T4_nopr', 'Running no PR', 'in_progress'),
  mk('TASK_T5_long', LONG, 'in_progress'),
];
const pr = (n, url) => ({ url, number: n, repo: n ? 'hive/ptah' : null, state: n ? 'open' : null, source: 'manual', createdAt: 1 });
const S = (sessionId, name, livePhase, prLinks = []) => ({ sessionId, name, role: 'primary', source: 'manual', livePhase, prLinks });
const links = {
  TASK_T2_three: [S('s1', 'Implement service', 'generating', [pr(42, 'https://github.com/hive/ptah/pull/42')]), S('s2', 'Review pass', 'idle'), S('s3', 'Old spike', null)],
  TASK_T3_prnonum: [S('s4', 'Hotfix', 'idle', [pr(null, 'https://example.com/merge/abc')])],
  TASK_T4_nopr: [S('s5', 'Running agent', 'generating')],
  TASK_T5_long: [S('s6', 'A very long session name that goes on and on', 'awaiting-background', [pr(1234, 'https://github.com/hive/ptah/pull/1234')]), S('s7', 'b', 'failed'), S('s8', 'c', 'sleeping'), S('s9', 'd', 'idle'), S('s10', 'e', 'idle'), S('s11', 'f', 'idle'), S('s12', 'g', null)],
};
const columns = { backlog: [], in_progress: [], in_review: [], blocked: [], done: [], cancelled: [] };
for (const t of tasks) columns[t.status].push(t);
const board = { columns, excluded: [], excludedCount: 0, specsDirExists: true };

async function boot(browser, { vw, theme, reduced, mode }) {
  const ctx = await browser.newContext({ viewport: { width: vw, height: 900 }, reducedMotion: reduced ? 'reduce' : 'no-preference' });
  const page = await ctx.newPage();
  const errs = [];
  page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  await page.addInitScript(({ board, links, mode }) => {
    window.ptahConfig = { isVSCode: true, theme: 'dark', extensionUri: '', baseUri: '', iconUri: '', userIconUri: '', panelId: 'c22', platform: 'win32', initialView: 'chat', workspaceRoot: 'C:\\ws', workspaceName: 'ws' };
    window.__out = [];
    const st = { v: undefined };
    let acq = false;
    window.acquireVsCodeApi = () => {
      if (acq) throw new Error('twice');
      acq = true;
      const reply = (correlationId, data) => window.dispatchEvent(new MessageEvent('message', { data: { type: 'rpc:response', correlationId, success: true, data } }));
      const api = {
        postMessage(msg) {
          window.__out.push(msg);
          if (!msg || msg.type !== 'rpc:call') return;
          const { method, correlationId } = msg.payload || {};
          if (method === 'tasks:board') queueMicrotask(() => reply(correlationId, board));
          else if (method === 'session:listForTasks') {
            const data = mode === 'unavailable' ? { available: false } : { available: true, links };
            setTimeout(() => reply(correlationId, data), mode === 'delayed' ? 1200 : 0);
          }
        },
        getState: () => st.v,
        setState: (v) => { st.v = v; },
      };
      window.vscode = api;
      return api;
    };
    window.acquireVsCodeApi();
  }, { board, links, mode });
  await page.goto(URL);
  await page.waitForSelector('ptah-app-shell', { timeout: 20000 });
  await page.evaluate(() => window.dispatchEvent(new MessageEvent('message', { data: { type: 'switchView', payload: { view: 'tasks' } } })));
  await page.evaluate((t) => document.documentElement.setAttribute('data-theme', t), theme);
  return { ctx, page, errs };
}

const MEASURE = () => {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 1;
  const c2 = cv.getContext('2d', { willReadFrequently: true });
  const rgba = (s) => { c2.clearRect(0, 0, 1, 1); c2.fillStyle = '#000'; c2.fillStyle = s; c2.fillRect(0, 0, 1, 1); const d = c2.getImageData(0, 0, 1, 1).data; return [d[0], d[1], d[2], d[3] / 255]; };
  const over = (f, b) => [0, 1, 2].map((i) => f[i] * f[3] + b[i] * (1 - f[3])).concat([1]);
  const lum = (c) => { const k = c.slice(0, 3).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }); return 0.2126 * k[0] + 0.7152 * k[1] + 0.0722 * k[2]; };
  const cr = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  const bgOf = (el) => { const stack = []; for (let e = el; e; e = e.parentElement) { const b = rgba(getComputedStyle(e).backgroundColor); if (b[3] > 0) stack.push(b); if (b[3] === 1) break; } let acc = [255, 255, 255, 1]; for (const b of stack.reverse()) acc = over(b, acc); return acc; };
  const out = {};
  for (const id of ['TASK_T1_none', 'TASK_T2_three', 'TASK_T3_prnonum', 'TASK_T4_nopr', 'TASK_T5_long']) {
    const c = document.querySelector('[data-task-id="' + id + '"]');
    if (!c) { out[id] = null; continue; }
    const row = c.querySelector('[data-testid="task-card-sessions"]');
    const cb = c.getBoundingClientRect();
    const r = { cardW: cb.width, cardH: cb.height, cardOverflowX: c.scrollWidth > c.clientWidth + 1, row: !!row };
    if (row) {
      const rr = row.getBoundingClientRect();
      r.rowRect = [rr.left - cb.left, rr.width, rr.height];
      r.rowOverflowsCard = rr.right > cb.right + 0.5;
      const note = row.querySelector('[role=note]');
      r.noteRole = note ? note.getAttribute('role') : null;
      r.noteLabel = note ? note.getAttribute('aria-label') : null;
      const cardBg = bgOf(c);
      r.cardBg = cardBg.map((v) => Math.round(v));
      r.dots = [...row.querySelectorAll('[data-testid="task-card-session-dot"]')].map((d) => {
        const cs = getComputedStyle(d); const bg = rgba(cs.backgroundColor); const bc = rgba(cs.borderTopColor);
        const rect = d.getBoundingClientRect();
        return { phase: d.dataset.phase, w: rect.width, fillContrast: bg[3] > 0 ? +cr(over(bg, cardBg), cardBg).toFixed(2) : null, borderContrast: cs.borderTopWidth !== '0px' ? +cr(over(bc, cardBg), cardBg).toFixed(2) : null, anim: cs.animationName, animDur: cs.animationDuration };
      });
      const txt = row.querySelector('[data-testid="task-card-session-phase"]');
      const cnt = row.querySelector('[data-testid="task-card-session-count"]');
      r.textContrast = +cr(rgba(getComputedStyle(cnt).color), cardBg).toFixed(2);
      r.textFont = getComputedStyle(cnt).fontSize;
      r.phaseTruncated = txt.scrollWidth > txt.clientWidth + 1;
      r.phaseText = txt.textContent.trim();
      r.phaseWidth = txt.getBoundingClientRect().width;
      const a = row.querySelector('[data-testid="task-card-session-pr"]');
      if (a) {
        const ar = a.getBoundingClientRect(); const ac = rgba(getComputedStyle(a).color);
        r.pr = { w: ar.width, h: ar.height, text: a.textContent.trim(), href: a.href, contrast: +cr(ac, cardBg).toFixed(2), deco: getComputedStyle(a).textDecorationLine, tabindex: a.getAttribute('tabindex'), inside: ar.right <= cb.right + 0.5 };
      }
    }
    out[id] = r;
  }
  out.docOverflowX = document.documentElement.scrollWidth > window.innerWidth + 1;
  return out;
};

const browser = await chromium.launch();
const results = {};
for (const theme of ['anubis', 'anubis-light']) {
  for (const vw of [360, 800, 1400]) {
    const { ctx, page, errs } = await boot(browser, { vw, theme, reduced: false, mode: 'full' });
    await page.waitForSelector('[data-testid="task-card-sessions"]', { timeout: 15000 });
    await page.waitForTimeout(500);
    const key = theme + '-' + vw;
    results[key] = await page.evaluate(MEASURE);
    results[key].errs = errs.slice(0, 5);
    await page.screenshot({ path: OUT + '/after-' + key + '.png', fullPage: true });
    if (vw !== 800) {
      for (const [n, id] of [['three', 'TASK_T2_three'], ['long', 'TASK_T5_long']]) {
        const el = page.locator('[data-task-id="' + id + '"]');
        await el.scrollIntoViewIfNeeded();
        await el.screenshot({ path: OUT + '/card-' + n + '-' + key + '.png' });
      }
      const card = page.locator('[data-task-id="TASK_T2_three"]');
      await card.focus();
      const tabs = [];
      for (let i = 0; i < 6; i++) {
        await page.keyboard.press('Tab');
        tabs.push(await page.evaluate(() => { const a = document.activeElement; return a.tagName + '|' + (a.getAttribute('data-testid') || '') + '|' + (a.getAttribute('data-task-id') || '') + '|in:' + ((a.closest('[data-task-id]') || a).getAttribute('data-task-id') || ''); }));
      }
      results[key].tabsFromCard = tabs;
      await card.focus();
      const link = card.locator('[data-testid="task-card-session-pr"]');
      let reached = false;
      for (let i = 0; i < 10; i++) {
        await page.keyboard.press('Tab');
        if (await page.evaluate(() => document.activeElement && document.activeElement.getAttribute('data-testid') === 'task-card-session-pr')) { reached = true; break; }
      }
      results[key].linkReachedByTab = reached;
      if (reached) {
        results[key].focusStyle = await link.evaluate((a) => { const s = getComputedStyle(a); return { outlineStyle: s.outlineStyle, outlineWidth: s.outlineWidth, outlineColor: s.outlineColor, focusVisible: a.matches(':focus-visible') }; });
        await card.screenshot({ path: OUT + '/focus-link-' + key + '.png' });
      }
      await card.focus();
      results[key].cardFocusStyle = await card.evaluate((a) => { const s = getComputedStyle(a); return { outlineStyle: s.outlineStyle, outlineWidth: s.outlineWidth, outlineColor: s.outlineColor, focusVisible: a.matches(':focus-visible') }; });
      await card.screenshot({ path: OUT + '/focus-card-' + key + '.png' });
      await link.hover();
      await card.screenshot({ path: OUT + '/hover-link-' + key + '.png' });
      await page.evaluate(() => { window.__out.length = 0; });
      const popupP = page.waitForEvent('popup', { timeout: 3000 }).catch(() => null);
      await link.click();
      const popup = await popupP;
      if (popup) { results[key].popupUrl = popup.url(); await popup.close().catch(() => {}); }
      await page.waitForTimeout(500);
      const out = await page.evaluate(() => window.__out.filter((m) => m.type === 'rpc:call').map((m) => m.payload.method));
      results[key].rpcAfterLinkClick = out;
      await page.evaluate(() => { window.__out.length = 0; });
      await page.locator('[data-task-id="TASK_T2_three"] [data-testid="task-card-sessions"]').click({ position: { x: 5, y: 5 } });
      await page.waitForTimeout(500);
      results[key].rpcAfterRowClick = await page.evaluate(() => window.__out.filter((m) => m.type === 'rpc:call').map((m) => m.payload.method));
    }
    await ctx.close();
  }
}
for (const reduced of [false, true]) {
  const { ctx, page } = await boot(browser, { vw: 1400, theme: 'anubis', reduced, mode: 'full' });
  await page.waitForSelector('[data-testid="task-card-sessions"]');
  await page.waitForTimeout(400);
  results['reduced-' + reduced] = await page.evaluate(() => { const d = document.querySelector('[data-task-id="TASK_T4_nopr"] [data-phase="generating"]'); const cs = getComputedStyle(d); return { animationName: cs.animationName, duration: cs.animationDuration, runningAnims: d.getAnimations().length }; });
  await page.locator('[data-task-id="TASK_T4_nopr"]').screenshot({ path: OUT + '/running-reduced-' + reduced + '.png' });
  await ctx.close();
}
{
  const { ctx, page } = await boot(browser, { vw: 800, theme: 'anubis', reduced: false, mode: 'unavailable' });
  await page.waitForSelector('[data-task-id="TASK_T2_three"]');
  await page.waitForTimeout(1500);
  results.unavailable = { rows: await page.locator('[data-testid="task-card-sessions"]').count(), cards: await page.locator('[data-task-id]').count() };
  await page.screenshot({ path: OUT + '/before-equivalent-unavailable-800.png', fullPage: true });
  await ctx.close();
}
{
  const { ctx, page } = await boot(browser, { vw: 800, theme: 'anubis', reduced: false, mode: 'delayed' });
  await page.waitForSelector('[data-task-id="TASK_T2_three"]');
  await page.evaluate(() => { window.__ls = 0; new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) window.__ls += e.value; }).observe({ type: 'layout-shift', buffered: true }); });
  const h = (id) => page.evaluate((i) => { const r = document.querySelector('[data-task-id="' + i + '"]').getBoundingClientRect(); return [Math.round(r.top), Math.round(r.height)]; }, id);
  const ids = ['TASK_T1_none', 'TASK_T2_three', 'TASK_T3_prnonum', 'TASK_T4_nopr'];
  const pre = {}; for (const i of ids) pre[i] = await h(i);
  await page.screenshot({ path: OUT + '/shift-before-fetch-800.png' });
  await page.waitForSelector('[data-testid="task-card-sessions"]', { timeout: 5000 });
  await page.waitForTimeout(500);
  const post = {}; for (const i of ids) post[i] = await h(i);
  await page.screenshot({ path: OUT + '/shift-after-fetch-800.png' });
  results.shift = { pre, post, cls: await page.evaluate(() => window.__ls) };
  await ctx.close();
}
writeFileSync(OUT + '/results.json', JSON.stringify(results, null, 2));
await browser.close();
srv.close();
console.log('done');
