// T2 evidence: task card + task detail at a given worktree's build (base or current).
// env: WT (worktree dir), TAG (base|after), HOST (electron|vscode)
import { chromium } from '@playwright/test';
import { createServer } from 'node:http';
import { createReadStream, statSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, extname, resolve } from 'node:path';

const WT = process.env.WT;
const TAG = process.env.TAG;
const HOST = process.env.HOST || 'electron';
const ROOT = resolve(WT, 'dist/apps/ptah-extension-webview/browser');
const OUT = resolve('D:/projects/ptah-extension/.claude-worktrees/task-580/.ptah/specs/TASK_2026_580_9f77/visual-v0/' + TAG + '-' + HOST);
mkdirSync(OUT, { recursive: true });
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
  mk('TASK_T1_none', 'No sessions task'), mk('TASK_T2_three', 'Three sessions with PR number'), mk('TASK_T3_prnonum', 'PR without number'),
  mk('TASK_T4_nopr', 'Running no PR', 'in_progress'), mk('TASK_T5_long', LONG, 'in_progress'),
  mk('TASK_D1_none', 'Detail task with no sessions', 'in_review'), mk('TASK_D2_three', 'Detail three sessions mixed PRs', 'in_review'), mk('TASK_D3_many', 'Detail many sessions long names', 'blocked'),
];
const pr = (n, url) => ({ url, number: n, repo: n ? 'hive/ptah' : null, state: n ? 'open' : null, source: 'user', createdAt: 1 });
const u = (n) => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
const S = (n, name, livePhase, prLinks = [], role = 'primary', source = 'board-start') => ({ sessionId: u(n), name, role, source, livePhase, prLinks });
const links = {
  TASK_T2_three: [S(1, 'Implement service', 'generating', [pr(42, 'https://github.com/hive/ptah/pull/42')]), S(2, 'Review pass', 'idle'), S(3, 'Old spike', null)],
  TASK_T3_prnonum: [S(4, 'Hotfix', 'idle', [pr(null, 'https://example.com/merge/abc')])],
  TASK_T4_nopr: [S(5, 'Running agent', 'generating')],
  TASK_T5_long: [S(6, 'A very long session name that goes on', 'awaiting-background', [pr(1234, 'https://github.com/hive/ptah/pull/1234')]), S(7, 'b', 'failed'), S(8, 'c', 'sleeping'), S(9, 'd', 'idle'), S(10, 'e', 'idle'), S(11, 'f', 'idle'), S(12, 'g', null)],
  TASK_D2_three: [S(21, 'Implement service', 'generating', [pr(42, 'https://github.com/hive/ptah/pull/42'), pr(43, 'http://github.com/hive/ptah/pull/43')]), S(22, 'Review pass', 'idle', [], 'related', 'agent'), S(23, LONG, null, [pr(null, 'https://example.com/merge/abc')], 'related', 'user')],
  TASK_D3_many: [S(31, LONG, 'generating', [pr(1234, 'https://github.com/hive/ptah/pull/1234')]), S(32, 'Second', 'awaiting-background', [], 'related', 'agent'), S(33, 'Third', 'failed', [pr(5, 'https://github.com/hive/ptah/pull/5')], 'related', 'user'), S(34, 'Fourth', 'sleeping'), S(35, 'Fifth', 'idle'), S(36, 'Sixth', null), S(37, 'Seventh', 'idle'), S(38, 'Eighth', 'generating')],
};
const columns = { backlog: [], in_progress: [], in_review: [], blocked: [], done: [], cancelled: [] };
for (const t of tasks) columns[t.status].push(t);
const board = { columns, excluded: [], excludedCount: 0, specsDirExists: true };
const tasksD = Object.fromEntries(tasks.map((t) => [t.id, { ...t, body: 'Body text for the task.\n\nSome more description.', artifacts: t.id === 'TASK_D1_none' ? [] : ['task.md', 'context.md', 'batches.md'] }]));

async function boot(browser, { vw, theme }) {
  const ctx = await browser.newContext({ viewport: { width: vw, height: 2600 } });
  const page = await ctx.newPage();
  const errs = [];
  page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text().slice(0, 160)); });
  await page.addInitScript(({ board, links, tasksD, HOST }) => {
    const base = { theme: 'dark', extensionUri: '', baseUri: '', iconUri: '', userIconUri: '', panelId: 'v0', platform: 'win32', initialView: 'chat', workspaceRoot: 'C:\\ws', workspaceName: 'ws' };
    window.ptahConfig = HOST === 'electron' ? { ...base, isVSCode: false, isElectron: true } : { ...base, isVSCode: true };
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
          const { method, params, correlationId } = msg.payload || {};
          if (method === 'tasks:board') queueMicrotask(() => reply(correlationId, board));
          else if (method === 'tasks:get') queueMicrotask(() => reply(correlationId, { task: tasksD[params.taskId] || null }));
          else if (method === 'workspace:getInfo') queueMicrotask(() => reply(correlationId, { folders: ['C:\\ws'], activeFolder: 'C:\\ws' }));
          else if (method === 'session:listForTasks') queueMicrotask(() => reply(correlationId, { available: true, links }));
        },
        getState: () => st.v,
        setState: (v) => { st.v = v; },
      };
      window.vscode = api;
      return api;
    };
    window.acquireVsCodeApi();
  }, { board, links, tasksD, HOST });
  await page.goto(URL, { timeout: 90000 });
  await page.waitForSelector(HOST === 'electron' ? 'ptah-electron-shell' : 'ptah-app-shell', { timeout: 30000 });
  await page.evaluate(() => window.dispatchEvent(new MessageEvent('message', { data: { type: 'switchView', payload: { view: 'tasks' } } })));
  await page.evaluate((t) => document.documentElement.setAttribute('data-theme', t), theme);
  return { ctx, page, errs };
}

const browser = await chromium.launch();
const results = { tag: TAG, host: HOST };
const CARDS = ['TASK_T1_none', 'TASK_T2_three', 'TASK_T3_prnonum', 'TASK_T4_nopr', 'TASK_T5_long'];
const DET = ['TASK_D1_none', 'TASK_D2_three', 'TASK_D3_many'];
for (const theme of ['anubis', 'anubis-light']) {
  for (const vw of [360, 800, 1400]) {
    const key = theme + '-' + vw;
    const { ctx, page, errs } = await boot(browser, { vw, theme });
    await page.waitForSelector('[data-task-id="TASK_T1_none"]', { timeout: 20000 });
    await page.waitForTimeout(1200);
    const r = (results[key] = { errs: errs.slice(0, 3), cards: {}, details: {} });
    for (const id of CARDS) {
      const c = page.locator('[data-task-id="' + id + '"]');
      await c.scrollIntoViewIfNeeded();
      r.cards[id] = await c.evaluate((el) => { const b = el.getBoundingClientRect(); const row = el.querySelector('[data-testid="task-card-sessions"]'); const rr = row ? row.getBoundingClientRect() : null; return { w: Math.round(b.width), h: Math.round(b.height), row: rr ? [Math.round(rr.top - b.top), Math.round(rr.height)] : null, texts: el.innerText.replace(/\s+/g, ' ').slice(0, 120) }; });
      await c.screenshot({ path: OUT + '/card-' + id + '-' + key + '.png' });
    }
    await page.screenshot({ path: OUT + '/board-' + key + '.png', fullPage: false });
    for (const id of DET) {
      await page.locator('[data-task-id="' + id + '"]').click();
      await page.waitForSelector('ptah-task-detail', { timeout: 8000 });
      await page.waitForTimeout(500);
      const d = page.locator('ptah-task-detail').first();
      r.details[id] = await d.evaluate((el) => { const b = el.getBoundingClientRect(); const s = el.querySelector('[data-testid="task-detail-sessions"]'); const sb = s ? s.getBoundingClientRect() : null; return { w: Math.round(b.width), h: Math.round(b.height), sec: sb ? [Math.round(sb.top - b.top), Math.round(sb.height)] : null, headings: [...el.querySelectorAll('span')].map((x) => x.textContent.trim()).filter((t) => /^(Sessions|Files|Workflow)/.test(t)) }; });
      await d.screenshot({ path: OUT + '/detail-' + id + '-' + key + '.png' });
    }
    await page.screenshot({ path: OUT + '/board-detail-' + key + '.png', fullPage: false });
    await ctx.close();
  }
}
writeFileSync(OUT + '/results.json', JSON.stringify(results, null, 2));
await browser.close(); srv.close(); console.log('done', TAG, HOST);
