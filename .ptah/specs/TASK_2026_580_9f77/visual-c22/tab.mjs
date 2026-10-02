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

const browser = await chromium.launch();
const res = {};
for (const theme of ['anubis', 'anubis-light']) {
  const { ctx, page } = await boot(browser, { vw: 1400, theme, reduced: false, mode: 'full' });
  await page.waitForSelector('[data-testid="task-card-sessions"]');
  await page.waitForTimeout(400);
  const ti = () => page.evaluate(() => [...document.querySelectorAll('[data-task-id]')].map((c) => c.dataset.taskId.slice(5, 7) + ':' + c.getAttribute('tabindex')).join(' '));
  res[theme] = { initial: await ti() };
  await page.locator('[data-task-id="TASK_T1_none"]').focus();
  await page.keyboard.press('ArrowDown');
  await page.waitForTimeout(200);
  res[theme].afterArrow = await ti();
  res[theme].active = await page.evaluate(() => document.activeElement.getAttribute('data-task-id'));
  const seq = [];
  for (let i = 0; i < 12; i++) {
    await page.keyboard.press('Tab');
    const d = await page.evaluate(() => { const a = document.activeElement; const c = a.closest('[data-task-id]'); return (c ? c.dataset.taskId.slice(5, 7) : '-') + '/' + (a.getAttribute('data-testid') || a.tagName) ; });
    seq.push(d);
    if (d.endsWith('task-card-session-pr')) {
      res[theme].focusStyle = await page.evaluate(() => { const a = document.activeElement; const s = getComputedStyle(a); return { outline: s.outlineStyle + ' ' + s.outlineWidth + ' ' + s.outlineColor, offset: s.outlineOffset, fv: a.matches(':focus-visible') }; });
      await page.locator('[data-task-id="TASK_T2_three"]').screenshot({ path: OUT + '/focus-link-' + theme + '.png' });
      // Enter on the link: should not trigger card open
      await page.evaluate(() => { window.__out.length = 0; });
      const pp = page.waitForEvent('popup', { timeout: 2500 }).catch(() => null);
      await page.keyboard.press('Enter');
      const p = await pp; if (p) { res[theme].enterPopup = p.url(); await p.close().catch(() => {}); }
      await page.waitForTimeout(400);
      res[theme].rpcAfterEnter = await page.evaluate(() => window.__out.filter((m) => m.type === 'rpc:call').map((m) => m.payload.method));
      break;
    }
  }
  res[theme].seq = seq;
  await ctx.close();
}
console.log(JSON.stringify(res, null, 1));
await browser.close(); srv.close();
