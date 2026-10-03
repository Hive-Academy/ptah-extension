import { chromium } from '@playwright/test';
import { createServer } from 'node:http';
import { createReadStream, statSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, extname, resolve } from 'node:path';

const WT = 'D:/projects/ptah-extension/.claude-worktrees/task-580';
const ROOT = resolve(WT, 'dist/apps/ptah-extension-webview/browser');
const OUT = resolve(WT, '.ptah/specs/TASK_2026_580_9f77/visual-c23');
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

const mk = (id, title, status = 'backlog') => ({ id, folderName: id, status, type: 'FEATURE', title, dependsOn: [], labels: [], duplicates: [], relatesTo: [], created: null, updated: null, frontmatterValid: true, validationIssues: [] });
const tasks = [mk('TASK_D1_none', 'Task with no sessions'), mk('TASK_D2_three', 'Three sessions, mixed PRs'), mk('TASK_D3_many', 'Many sessions with very long names', 'in_progress')];
const pr = (n, url) => ({ url, number: n, repo: n ? 'hive/ptah' : null, state: n ? 'open' : null, source: 'user', createdAt: 1 });
const S = (sessionId, name, livePhase, prLinks = [], role = 'primary', source = 'board-start') => ({ sessionId, name, role, source, livePhase, prLinks });
const LONGN = 'Implement the reactive linked sessions service and wire every consumer across tasks-ui and chat without breaking any workspace scoped caller';
const links = {
  TASK_D2_three: [
    S('00000000-0000-4000-8000-000000000001', 'Implement service', 'generating', [pr(42, 'https://github.com/hive/ptah/pull/42'), pr(43, 'http://github.com/hive/ptah/pull/43')]),
    S('00000000-0000-4000-8000-000000000002', 'Review pass', 'idle', [], 'related', 'agent'),
    S('00000000-0000-4000-8000-000000000003', LONGN, null, [pr(null, 'https://example.com/merge/abc')], 'related', 'user'),
  ],
  TASK_D3_many: [
    S('00000000-0000-4000-8000-000000000011', LONGN, 'generating', [pr(1234, 'https://github.com/hive/ptah/pull/1234')]),
    S('00000000-0000-4000-8000-000000000012', 'Second session', 'awaiting-background', [], 'related', 'agent'),
    S('00000000-0000-4000-8000-000000000013', 'Third session with a longer name than fits', 'failed', [pr(5, 'https://github.com/hive/ptah/pull/5'), pr(6, 'https://github.com/hive/ptah/pull/6'), pr(7, 'https://github.com/hive/ptah/pull/7')], 'related', 'user'),
    S('00000000-0000-4000-8000-000000000014', 'Fourth', 'sleeping'), S('00000000-0000-4000-8000-000000000015', 'Fifth', 'idle'), S('00000000-0000-4000-8000-000000000016', 'Sixth', null), S('00000000-0000-4000-8000-000000000017', 'Seventh', 'idle'), S('00000000-0000-4000-8000-000000000018', 'Eighth session', 'generating'),
  ],
};
const columns = { backlog: [], in_progress: [], in_review: [], blocked: [], done: [], cancelled: [] };
for (const t of tasks) columns[t.status].push(t);
const board = { columns, excluded: [], excludedCount: 0, specsDirExists: true };
const detailOf = (id) => ({ ...tasks.find((t) => t.id === id), body: 'Body text for the task.\n\nSome more description.', artifacts: id === 'TASK_D1_none' ? [] : ['task.md', 'context.md', 'batches.md'] });

async function boot(browser, { vw, theme, mode }) {
  const ctx = await browser.newContext({ viewport: { width: vw, height: 900 } });
  const page = await ctx.newPage();
  const errs = [];
  page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text().slice(0, 200)); });
  await page.addInitScript(({ board, links, mode, tasksD }) => {
    window.ptahConfig = { isVSCode: true, theme: 'dark', extensionUri: '', baseUri: '', iconUri: '', userIconUri: '', panelId: 'c23', platform: 'win32', initialView: 'chat', workspaceRoot: 'C:\\ws', workspaceName: 'ws' };
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
          else if (method === 'session:listForTasks') {
            const data = mode === 'unavailable' ? { available: false } : { available: true, links };
            setTimeout(() => reply(correlationId, data), mode === 'delayed' ? 1500 : 0);
          }
        },
        getState: () => st.v,
        setState: (v) => { st.v = v; },
      };
      window.vscode = api;
      return api;
    };
    window.acquireVsCodeApi();
  }, { board, links, mode, tasksD: Object.fromEntries(tasks.map((t) => [t.id, detailOf(t.id)])) });
  await page.goto(URL);
  await page.waitForSelector('ptah-app-shell', { timeout: 25000 });
  await page.evaluate(() => window.dispatchEvent(new MessageEvent('message', { data: { type: 'switchView', payload: { view: 'tasks' } } })));
  await page.evaluate((t) => document.documentElement.setAttribute('data-theme', t), theme);
  return { ctx, page, errs };
}

const MEASURE = () => {
  const cv = document.createElement('canvas'); cv.width = cv.height = 1;
  const c2 = cv.getContext('2d', { willReadFrequently: true });
  const rgba = (s) => { c2.clearRect(0, 0, 1, 1); c2.fillStyle = '#000'; c2.fillStyle = s; c2.fillRect(0, 0, 1, 1); const d = c2.getImageData(0, 0, 1, 1).data; return [d[0], d[1], d[2], d[3] / 255]; };
  const over = (f, b) => [0, 1, 2].map((i) => f[i] * f[3] + b[i] * (1 - f[3])).concat([1]);
  const lum = (c) => { const k = c.slice(0, 3).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }); return 0.2126 * k[0] + 0.7152 * k[1] + 0.0722 * k[2]; };
  const cr = (a, b) => { const x = lum(a), y = lum(b); return +((Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05)).toFixed(2); };
  const bgOf = (el) => { const st = []; for (let e = el; e; e = e.parentElement) { const b = rgba(getComputedStyle(e).backgroundColor); if (b[3] > 0) st.push(b); if (b[3] === 1) break; } let a = [255, 255, 255, 1]; for (const b of st.reverse()) a = over(b, a); return a; };
  const txtC = (el) => { const bg = bgOf(el); return cr(over(rgba(getComputedStyle(el).color), bg), bg); };
  const sec = document.querySelector('[data-testid="task-detail-sessions"]');
  const out = { present: !!sec };
  if (!sec) return out;
  const sr = sec.getBoundingClientRect();
  out.secRect = [Math.round(sr.left), Math.round(sr.top), Math.round(sr.width), Math.round(sr.height)];
  out.title = sec.firstElementChild.textContent.trim();
  out.titleStyle = (() => { const t = sec.firstElementChild; const cs = getComputedStyle(t); return cs.fontSize + '/' + cs.fontWeight + '/' + txtC(t); })();
  // scroll container overflow
  let sc = sec; while (sc && !(sc.scrollHeight > sc.clientHeight + 1 && /(auto|scroll)/.test(getComputedStyle(sc).overflowY))) sc = sc.parentElement;
  let wrap = sec.parentElement; out.parentOverflowX = wrap.scrollWidth > wrap.clientWidth + 1;
  let anc = sec; const ovs = []; while (anc && anc !== document.body) { if (anc.scrollWidth > anc.clientWidth + 1 && getComputedStyle(anc).overflowX !== 'visible') ovs.push(anc.tagName); anc = anc.parentElement; }
  out.xOverflowAncestors = ovs; out.docOverflowX = document.documentElement.scrollWidth > innerWidth + 1;
  out.rows = [...sec.querySelectorAll('[data-testid="task-detail-session"]')].map((li) => {
    const lr = li.getBoundingClientRect(); const bg = bgOf(li);
    const dot = li.querySelector('[data-testid="task-detail-session-dot"]'); const dcs = getComputedStyle(dot);
    const fill = rgba(dcs.backgroundColor); const ring = rgba(dcs.borderTopColor); const fillBg = fill[3] > 0 ? over(fill, bg) : bg;
    const name = li.querySelector('[data-testid="task-detail-session-name"]');
    const meta = li.querySelector('[data-testid="task-detail-session-meta"]');
    const btn = li.querySelector('[data-testid="task-detail-session-open"]'); const br = btn.getBoundingClientRect();
    const prs = [...li.querySelectorAll('[data-testid="task-detail-session-pr"],[data-testid="task-detail-session-pr-unlinked"]')].map((a) => { const r = a.getBoundingClientRect(); return { kind: a.dataset.testid.replace('task-detail-session-', ''), text: a.textContent.trim().replace(/\s+/g, ' '), href: a.getAttribute('href'), w: Math.round(r.width), h: Math.round(r.height), contrast: txtC(a), deco: getComputedStyle(a).textDecorationLine }; });
    const nopr = li.querySelector('[data-testid="task-detail-session-no-pr"]');
    return {
      phase: dot.dataset.phase, dotW: dot.getBoundingClientRect().width, dotAria: dot.getAttribute('aria-label'), dotAnim: dcs.animationName,
      ringVsBg: cr(over(ring, bg), bg), ringOverFill: cr(over(ring, fillBg), bg), fillVsBg: fill[3] > 0 ? cr(fillBg, bg) : null,
      name: name.textContent.trim().slice(0, 30), nameTitle: !!name.getAttribute('title'), nameTrunc: name.scrollWidth > name.clientWidth + 1,
      meta: meta.textContent.trim().replace(/\s+/g, ' '), metaContrast: txtC(meta), nameContrast: txtC(name),
      prs, noPr: nopr ? { text: nopr.textContent.trim(), contrast: txtC(nopr) } : null,
      btn: { w: Math.round(br.width), h: Math.round(br.height), aria: btn.getAttribute('aria-label'), inside: br.right <= lr.right + 1, contrast: txtC(btn) },
      rowOverflow: li.scrollWidth > li.clientWidth + 1, rowRight: Math.round(lr.right),
    };
  });
  const empty = sec.querySelector('[data-testid="task-detail-sessions-empty"]');
  if (empty) { const cs = getComputedStyle(empty); out.emptyStyle = { text: empty.textContent.trim(), fs: cs.fontSize, fst: cs.fontStyle, color: txtC(empty), cls: empty.className }; }
  // Files empty state for comparison
  const filesSpan = [...document.querySelectorAll('span')].find((s) => /^Files \(/.test(s.textContent.trim()));
  if (filesSpan) { const wrapF = filesSpan.parentElement; out.filesTitleStyle = (() => { const cs = getComputedStyle(filesSpan); return cs.fontSize + '/' + cs.fontWeight + '/' + txtC(filesSpan); })(); out.filesTop = Math.round(wrapF.getBoundingClientRect().top); const fe = [...wrapF.querySelectorAll('span,div')].find((e) => e !== filesSpan && /no files|none|empty|no artifacts/i.test(e.textContent) && e.children.length === 0); if (fe) { const cs = getComputedStyle(fe); out.filesEmptyStyle = { text: fe.textContent.trim(), fs: cs.fontSize, fst: cs.fontStyle, color: txtC(fe), cls: fe.className }; } else out.filesHtml = wrapF.innerHTML.replace(/<!--.*?-->/g, '').slice(0, 300); }
  return out;
};

const browser = await chromium.launch();
const results = {};
const openTask = async (page, id) => { await page.locator('[data-task-id="' + id + '"]').click(); await page.waitForSelector('[data-testid="task-detail-sessions"]', { timeout: 8000 }); await page.waitForTimeout(400); };

for (const theme of ['anubis', 'anubis-light']) {
  for (const vw of [360, 800, 1400]) {
    const { ctx, page, errs } = await boot(browser, { vw, theme, mode: 'full' });
    await page.waitForSelector('[data-task-id="TASK_D2_three"]', { timeout: 15000 });
    await page.waitForTimeout(600);
    const key = theme + '-' + vw;
    const r = (results[key] = { errs });
    for (const [id, tag] of [['TASK_D1_none', 'none'], ['TASK_D2_three', 'three'], ['TASK_D3_many', 'many']]) {
      await openTask(page, id);
      r[tag] = await page.evaluate(MEASURE);
      await page.screenshot({ path: OUT + '/after-' + tag + '-' + key + '.png', fullPage: false });
      await page.locator('[data-testid="task-detail-sessions"]').scrollIntoViewIfNeeded();
      await page.locator('[data-testid="task-detail-sessions"]').screenshot({ path: OUT + '/section-' + tag + '-' + key + '.png' });
    }
    if (vw !== 800) {
      // keyboard order + focus rings on many
      await openTask(page, 'TASK_D2_three');
      await page.locator('[data-testid="task-detail-sessions"]').scrollIntoViewIfNeeded();
      const first = page.locator('[data-testid="task-detail-sessions"] a, [data-testid="task-detail-sessions"] button').first();
      await first.focus();
      const seq = [];
      for (let i = 0; i < 6; i++) {
        seq.push(await page.evaluate(() => { const a = document.activeElement; const cs = getComputedStyle(a); return { id: a.getAttribute('data-testid') || a.tagName, text: (a.getAttribute('aria-label') || a.textContent || '').trim().slice(0, 40), outline: cs.outlineStyle + ' ' + cs.outlineWidth + ' ' + cs.outlineColor, fv: a.matches(':focus-visible'), inSessions: !!a.closest('[data-testid="task-detail-sessions"]') }; }));
        if (i === 0 || i === 1) await page.locator('[data-testid="task-detail-sessions"]').screenshot({ path: OUT + '/focus-' + i + '-' + key + '.png' });
        await page.keyboard.press('Tab');
      }
      r.tabSeq = seq;
      // bridge: click open session on row 2
      await page.evaluate(() => { window.__out.length = 0; });
      const url0 = await page.evaluate(() => location.pathname);
      await page.locator('[data-testid="task-detail-session-open"]').nth(1).click();
      await page.waitForTimeout(2000);
      r.bridge = await page.evaluate(() => ({ view: ng.getComponent(document.querySelector('ptah-app-shell')).appState.currentView(), layout: ng.getComponent(document.querySelector('ptah-app-shell')).appState.layoutMode(), url: location.pathname, tasksViewVisible: !!document.querySelector('ptah-tasks-view') && document.querySelector('ptah-tasks-view').offsetParent !== null, detailVisible: !!document.querySelector('[data-testid="task-detail-sessions"]') && document.querySelector('[data-testid="task-detail-sessions"]').offsetParent !== null, rpcs: window.__out.filter((m) => m.type === 'rpc:call').map((m) => m.payload.method + ':' + JSON.stringify(m.payload.params || {}).slice(0, 90)), msgs: window.__out.filter((m) => m.type !== 'rpc:call').map((m) => m.type).slice(0, 8) }));
      r.bridge.url0 = url0;
      await page.screenshot({ path: OUT + '/bridge-after-click-' + key + '.png' });
    }
    await ctx.close();
  }
}
// unavailable (VS Code real host)
{
  const { ctx, page } = await boot(browser, { vw: 800, theme: 'anubis', mode: 'unavailable' });
  await page.waitForSelector('[data-task-id="TASK_D2_three"]'); await page.waitForTimeout(800);
  await openTask(page, 'TASK_D2_three');
  results.unavailable = await page.evaluate(MEASURE);
  await page.locator('[data-testid="task-detail-sessions"]').screenshot({ path: OUT + '/section-unavailable-800.png' });
  await ctx.close();
}
// layout shift: delayed map
for (const theme of ['anubis', 'anubis-light']) {
  const { ctx, page } = await boot(browser, { vw: 800, theme, mode: 'delayed' });
  await page.waitForSelector('[data-task-id="TASK_D2_three"]'); await page.waitForTimeout(500);
  await openTask(page, 'TASK_D2_three');
  await page.evaluate(() => { window.__ls = 0; new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) window.__ls += e.value; }).observe({ type: 'layout-shift', buffered: true }); });
  const snap = () => page.evaluate(() => { const s = document.querySelector('[data-testid="task-detail-sessions"]'); const files = [...document.querySelectorAll('span')].find((x) => /^Files \(/.test(x.textContent.trim())); const sec = s.getBoundingClientRect(); return { secTop: Math.round(sec.top), secH: Math.round(sec.height), filesTop: files ? Math.round(files.getBoundingClientRect().top) : null, rows: s.querySelectorAll('[data-testid="task-detail-session"]').length, empty: !!s.querySelector('[data-testid="task-detail-sessions-empty"]'), sameNode: window.__secNode ? window.__secNode === s : null }; });
  await page.evaluate(() => { window.__secNode = document.querySelector('[data-testid="task-detail-sessions"]'); });
  const before = await snap();
  await page.screenshot({ path: OUT + '/shift-before-' + theme + '.png' });
  await page.waitForSelector('[data-testid="task-detail-session"]', { timeout: 5000 }); await page.waitForTimeout(500);
  const after = await snap();
  await page.screenshot({ path: OUT + '/shift-after-' + theme + '.png' });
  results['shift-' + theme] = { before, after, cls: await page.evaluate(() => window.__ls) };
  await ctx.close();
}
writeFileSync(OUT + '/results.json', JSON.stringify(results, null, 2));
await browser.close(); srv.close(); console.log('done');
