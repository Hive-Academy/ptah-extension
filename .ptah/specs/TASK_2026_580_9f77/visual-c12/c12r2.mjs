import { chromium } from '@playwright/test';
import { createServer } from 'node:http';
import { createReadStream, statSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, extname, resolve } from 'node:path';

const WT = process.env.WT || 'D:/projects/ptah-extension/.claude-worktrees/task-580';
const ROOT = resolve(WT, 'dist/apps/ptah-extension-webview/browser');
const OUT = resolve('D:/projects/ptah-extension/.claude-worktrees/task-580/.ptah/specs/TASK_2026_580_9f77/visual-c12/round2');
const TAG = process.env.TAG || 'after';
const ONLY = (process.env.ONLY || 'org,vscode').split(',');
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

const NOW = Date.now();
const H = 3600e3;
const pr = (n) => ({ url: 'https://github.com/hive/ptah/pull/' + n, number: n, repo: 'hive/ptah', state: 'open', source: 'user', createdAt: 1 });
const org = (o) => ({ priority: 'normal', status: 'active', pinned: false, worktreePath: null, branch: null, parentSessionId: null, forkOfSessionId: null, startedBy: 'user', tasks: [], prLinks: [], childCount: 0, updatedAt: 1, ...o });
const tk = (taskId, role = 'primary', missing = false) => ({ taskId, role, source: 'user', createdAt: 1, missing });
let n = 0;
const ses = (id, name, hoursAgo, o, extra = {}) => ({ id, name, messageCount: 12 + n++, createdAt: NOW - (hoursAgo + 5) * H, lastActivityAt: NOW - hoursAgo * H, isActive: false, hasTranscript: true, organization: org(o), ...extra });
const SESSIONS = [
  ses('s1', 'Refactor session loader', 0.2, { pinned: true, priority: 'high', tasks: [tk('TASK_2026_580_9f77'), tk('TASK_2026_999_gone', 'related', true)], prLinks: [pr(42), pr(43)], childCount: 1 }, { livePhase: 'generating' }),
  ses('s2', 'Fix flaky e2e on CI', 1, { status: 'waiting', startedBy: 'agent', tasks: [tk('TASK_2026_581_aa11')] }, { livePhase: 'idle' }),
  ses('s3', 'Investigate memory leak in the renderer process after long running agent sessions on workspace switch', 2, { priority: 'urgent', status: 'in_review', prLinks: [pr(7)] }),
  ses('s4', 'Spike: opencode lane messaging', 3, { priority: 'low', status: 'done' }),
  ses('s5', 'Old exploration (archived)', 30, { status: 'archived' }),
  ses('s6', 'Plain session, defaults only', 4, {}),
  ses('s7', 'Hotfix auth token refresh', 5, { priority: 'high', tasks: [tk('TASK_2026_581_aa11', 'related')] }, { livePhase: 'failed' }),
  ses('p0', 'Parent root session', 6, { childCount: 1 }),
  ses('p1', 'Child A of root', 6.5, { parentSessionId: 'p0', childCount: 1 }),
  ses('p2', 'Grandchild B', 7, { parentSessionId: 'p1', childCount: 1 }),
  ses('p3', 'Great-grandchild C', 7.5, { parentSessionId: 'p2', childCount: 1 }),
  ses('p4', 'Depth four D (capped at 3)', 8, { parentSessionId: 'p3' }),
  ses('s8', 'Waiting on review for docs', 9, { status: 'waiting', priority: 'low' }),
];

async function boot(browser, { vw, theme, host, mode, listDelay = 0 }) {
  const ctx = await browser.newContext({ viewport: { width: vw, height: 900 } });
  const page = await ctx.newPage();
  const errs = [];
  page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text().slice(0, 200)); });
  await page.addInitScript(({ SESSIONS, host, mode, listDelay }) => {
    const base = { theme: 'dark', extensionUri: '', baseUri: '', iconUri: '', userIconUri: '', panelId: 'c12', platform: 'win32', initialView: 'chat', workspaceRoot: 'C:\\ws', workspaceName: 'ws' };
    window.ptahConfig = host === 'electron' ? { ...base, isVSCode: false, isElectron: true } : { ...base, isVSCode: true };
    window.__out = [];
    window.__listCalls = [];
    const RANK = { urgent: 0, high: 1, normal: 2, low: 3 };
    const orgOf = (s) => s.organization;
    const list = (p) => {
      const q = p || {};
      const queryMode = ['status', 'priority', 'taskId', 'pinned', 'hasPr', 'text', 'sort', 'groupBy'].some((k) => q[k] !== undefined);
      let rows = SESSIONS.map((s) => (mode === 'org' ? s : (({ organization, livePhase, ...r }) => r)(s)));
      if (mode === 'org' && queryMode) {
        const st = q.status && q.status.length ? q.status : null;
        rows = rows.filter((s) => (st ? st.includes(orgOf(s).status) : orgOf(s).status !== 'archived'));
        if (q.priority && q.priority.length) rows = rows.filter((s) => q.priority.includes(orgOf(s).priority));
        if (q.taskId) rows = rows.filter((s) => orgOf(s).tasks.some((t) => t.taskId === q.taskId));
        if (q.pinned !== undefined) rows = rows.filter((s) => orgOf(s).pinned === q.pinned);
        if (q.hasPr !== undefined) rows = rows.filter((s) => (orgOf(s).prLinks.length > 0) === q.hasPr);
        if (q.text) rows = rows.filter((s) => s.name.toLowerCase().includes(q.text.toLowerCase()));
        const sort = q.sort || 'lastActive';
        const cmp = (a, b) => (sort === 'priority' ? RANK[orgOf(a).priority] - RANK[orgOf(b).priority] : sort === 'created' ? b.createdAt - a.createdAt : sort === 'name' ? a.name.localeCompare(b.name) : 0) || b.lastActivityAt - a.lastActivityAt;
        const gk = (s) => (q.groupBy === 'status' ? ['active', 'waiting', 'in_review', 'done', 'archived'].indexOf(orgOf(s).status) : q.groupBy === 'task' ? (orgOf(s).tasks[0] ? orgOf(s).tasks[0].taskId : '~') : '');
        rows.sort((a, b) => (orgOf(b).pinned ? 1 : 0) - (orgOf(a).pinned ? 1 : 0) || String(gk(a)).localeCompare(String(gk(b))) || cmp(a, b));
      } else rows.sort((a, b) => b.lastActivityAt - a.lastActivityAt);
      return { sessions: rows, total: rows.length, hasMore: false, ...(mode === 'org' ? { organizationAvailable: true } : {}) };
    };
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
          if (method === 'session:list') {
            window.__listCalls.push(params);
            const data = list(params);
            const delay = window.__delayList ? window.__delayList : 0;
            setTimeout(() => reply(correlationId, data), delay);
          } else if (method === 'session:setOrganization' || method === 'session:linkTask' || method === 'session:unlinkTask' || method === 'session:addPrLink' || method === 'session:removePrLink') {
            const s = SESSIONS.find((x) => x.id === (params && params.sessionId));
            queueMicrotask(() => reply(correlationId, { ok: true, organization: s ? s.organization : null }));
          } else if (method === 'workspace:getInfo') {
            queueMicrotask(() => reply(correlationId, { folders: ['C:\ws'], activeFolder: 'C:\ws' }));
          } else if (method === 'tasks:board') {
            queueMicrotask(() => reply(correlationId, { columns: { backlog: [], in_progress: [], in_review: [], blocked: [], done: [], cancelled: [] }, excluded: [], excludedCount: 0, specsDirExists: true }));
          }
        },
        getState: () => st.v,
        setState: (v) => { st.v = v; },
      };
      window.vscode = api;
      return api;
    };
    window.acquireVsCodeApi();
  }, { SESSIONS, host, mode, listDelay });
  await page.goto(URL);
  await page.waitForSelector(host === 'electron' ? 'ptah-electron-shell' : 'ptah-app-shell', { timeout: 25000 });
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
  const bgOf = (el) => { const stack = []; for (let e = el; e; e = e.parentElement) { const b = rgba(getComputedStyle(e).backgroundColor); if (b[3] > 0) stack.push(b); if (b[3] === 1) break; } let acc = [255, 255, 255, 1]; for (const b of stack.reverse()) acc = over(b, acc); return acc; };
  const aside = document.querySelector('aside:has(.sidebar-scroll)');
  const out = { asideW: aside.getBoundingClientRect().width, asideOverflowX: aside.scrollWidth > aside.clientWidth + 1, docOverflowX: document.documentElement.scrollWidth > window.innerWidth + 1 };
  const list = aside.querySelector('.sidebar-scroll');
  out.listOverflowX = list ? list.scrollWidth > list.clientWidth + 1 : null;
  const textC = (el) => { const bg = bgOf(el); const fg = over(rgba(getComputedStyle(el).color), bg); return cr(fg, bg); };
  out.chips = [...aside.querySelectorAll('[data-testid^="session-chip"]')].map((c) => {
    const r = c.getBoundingClientRect(); const cs = getComputedStyle(c);
    const bg = bgOf(c);
    const o = { id: c.dataset.testid, text: c.textContent.trim().slice(0, 24), fs: cs.fontSize, h: Math.round(r.height), textContrast: textC(c), right: Math.round(r.right - aside.getBoundingClientRect().left) };
    const bc = rgba(cs.borderTopColor); if (cs.borderTopWidth !== '0px') o.borderContrast = cr(over(bc, bg), bg);
    const svg = c.querySelector('svg'); if (svg) { const sc = rgba(getComputedStyle(svg).color); o.iconContrast = cr(over(sc, bg), bg); }
    const dot = c.matches('[data-testid="session-chip-live"]') ? c : null; if (dot) { const d = c.querySelector('span,svg'); o.dotInfo = d ? d.className.toString().slice(0, 60) : ''; }
    return o;
  });
  out.chipsOverflowRow = [...aside.querySelectorAll('[data-testid="session-organization-chips"]')].some((c) => c.scrollWidth > c.clientWidth + 1 || c.getBoundingClientRect().right > aside.getBoundingClientRect().right + 1);
  out.headers = [...aside.querySelectorAll('h3')].map((h) => ({ text: h.textContent.trim(), contrast: textC(h), fs: getComputedStyle(h).fontSize }));
  out.rows = [...aside.querySelectorAll('li[data-depth]')].map((l) => ({ depth: l.dataset.depth, ml: getComputedStyle(l).marginLeft, name: l.textContent.trim().slice(0, 30) }));
  out.rowCount = aside.querySelectorAll('.sidebar-scroll button.w-full').length;
  const fb = aside.querySelector('[data-testid="session-filter-bar"]');
  out.filterBar = !!fb;
  out.localSearch = !!aside.querySelector('[data-testid="session-search-local"]') || !!aside.querySelector('input[placeholder="Search sessions..."]');
  out.organizeBtns = aside.querySelectorAll('[data-testid="session-organize"]').length;
  out.groupHeaders = aside.querySelectorAll('h3').length;
  out.chipsCount = aside.querySelectorAll('[data-testid="session-organization-chips"]').length;
  out.dateFilterBtn = [...aside.querySelectorAll('button')].some((b) => /date|calendar/i.test((b.getAttribute('aria-label') || '') + (b.title || '')));
  if (fb) out.filterBarRect = (() => { const r = fb.getBoundingClientRect(); const a = aside.getBoundingClientRect(); return [Math.round(r.left - a.left), Math.round(r.width)]; })();
  const interactive = [...fb ? fb.querySelectorAll('button,select,input') : []].map((e) => { const r = e.getBoundingClientRect(); return e.getAttribute('data-testid') + ':' + Math.round(r.width) + 'x' + Math.round(r.height); });
  out.filterControlSizes = interactive;
  return out;
};

const browser = await chromium.launch();
const results = {};
const themes = ['anubis', 'anubis-light'];
const widths = [360, 800, 1400];

const openSidebar = async (page) => {
  const vis = await page.evaluate(() => { const a = document.querySelector('aside:has(.sidebar-scroll)'); return a && a.getBoundingClientRect().width > 20; });
  if (!vis) {
    await page.locator('ptah-sidebar-tab button, ptah-sidebar-tab [role=button]').first().click().catch(() => {});
    await page.waitForTimeout(500);
  }
};

const sideShot = async (page, name) => { await page.locator('aside:has(.sidebar-scroll)').first().screenshot({ path: OUT + '/' + name + '.png' }); };

if (ONLY.includes('org')) {
  for (const theme of themes) {
    for (const vw of widths) {
      const key = 'org-' + theme + '-' + vw;
      const { ctx, page, errs } = await boot(browser, { vw, theme, host: 'electron', mode: 'org' });
      await page.waitForSelector('[data-testid="session-organization-chips"]', { timeout: 15000 }).catch(() => {});
      await openSidebar(page);
      await page.waitForTimeout(600);
      const r = (results[key] = {});
      r.default = await page.evaluate(MEASURE);
      r.errs = errs.slice(0, 5);
      await page.screenshot({ path: OUT + '/' + TAG + '-org-' + theme + '-' + vw + '-full.png' });
      await sideShot(page, TAG + '-org-' + theme + '-' + vw + '-default');
      if (vw === 800 || vw === 360) {
        // group modes
        for (const g of ['status', 'task', 'parent']) {
          await page.selectOption('[data-testid="session-filter-group"]', g);
          await page.waitForTimeout(700);
          r['group-' + g] = await page.evaluate(MEASURE);
          await sideShot(page, TAG + '-org-' + theme + '-' + vw + '-group-' + g);
        }
        await page.selectOption('[data-testid="session-filter-group"]', 'none');
        await page.waitForTimeout(500);
        // filters popover
        await page.click('[data-testid="session-filter-toggle"]');
        await page.waitForTimeout(400);
        await page.screenshot({ path: OUT + '/' + TAG + '-org-' + theme + '-' + vw + '-filters-popover.png' });
        r.popover = await page.evaluate(() => { const p = document.querySelector('[data-testid="session-filter-panel"]'); if (!p) return null; const b = p.getBoundingClientRect(); return { left: Math.round(b.left), right: Math.round(b.right), top: Math.round(b.top), bottom: Math.round(b.bottom), vw: innerWidth, vh: innerHeight, clippedX: b.right > innerWidth || b.left < 0 }; });
        await page.click('[data-testid="session-filter-status-in_review"]').catch(() => {});
        await page.waitForTimeout(700);
        await page.keyboard.press('Escape');
        await page.waitForTimeout(300);
        await sideShot(page, TAG + '-org-' + theme + '-' + vw + '-filter-status');
        // no results
        await page.fill('[data-testid="session-filter-text"]', 'zzzz-nomatch');
        await page.waitForTimeout(900);
        r.noMatch = await page.evaluate(() => { const a = document.querySelector('aside:has(.sidebar-scroll)'); return { text: a.querySelector('.sidebar-scroll').innerText.slice(0, 160), clear: [...a.querySelectorAll('button')].filter((b) => /clear filters/i.test(b.textContent)).length }; });
        await sideShot(page, TAG + '-org-' + theme + '-' + vw + '-no-match');
        const nm = await page.evaluate(() => { const a = document.querySelector('aside:has(.sidebar-scroll)'); const t = [...a.querySelectorAll('.sidebar-scroll *')].find((e) => /No matching sessions/i.test(e.textContent) && e.children.length === 0); if (!t) return null; return null; });
        // clear
        const clr = page.locator('aside:has(.sidebar-scroll) button', { hasText: /clear filters/i }).first();
        if (await clr.count()) { await clr.click(); await page.waitForTimeout(800); }
        r.afterClear = await page.evaluate(() => ({ rows: document.querySelectorAll('aside:has(.sidebar-scroll) .sidebar-scroll button.w-full').length, text: document.querySelector('[data-testid="session-filter-text"]').value }));
      }
      // editor dialog + focus
      {
        const row = page.locator('aside:has(.sidebar-scroll) li.group', { hasText: 'Refactor session loader' }).first();
        await row.hover();
        await page.waitForTimeout(250);
        const org = row.locator('[data-testid="session-organize"]');
        r.organizeBtn = { count: await org.count() };
        if (await org.count()) {
          const box = await org.boundingBox(); r.organizeBtn.size = box ? [Math.round(box.width), Math.round(box.height)] : null;
          await sideShot(page, TAG + '-org-' + theme + '-' + vw + '-row-hover');
          await org.focus();
          await org.press('Enter');
          await page.waitForTimeout(600);
          r.editor = await page.evaluate(() => { const d = document.querySelector('[data-testid="session-organization-editor"]'); const a = document.activeElement; const rr = d ? d.getBoundingClientRect() : null; return { open: !!d, focusInside: !!(d && d.contains(a)), active: a ? (a.getAttribute('data-testid') || a.tagName) : null, rect: rr ? [Math.round(rr.left), Math.round(rr.top), Math.round(rr.width), Math.round(rr.height)] : null, vw: innerWidth, vh: innerHeight, overflowX: rr ? rr.right > innerWidth + 1 : null, overflowY: rr ? rr.bottom > innerHeight + 1 : null }; });
          await page.screenshot({ path: OUT + '/' + TAG + '-org-' + theme + '-' + vw + '-editor.png' });
          await page.keyboard.press('Escape');
          await page.waitForTimeout(500);
          r.editorAfterEsc = await page.evaluate(() => { const a = document.activeElement; return { open: !!document.querySelector('[data-testid="session-organization-editor"]'), active: a ? (a.getAttribute('data-testid') || a.getAttribute('aria-label') || a.tagName) : null, inRow: !!(a && a.closest && a.closest('li.group')) }; });
        }
      }
      // layout shift on filter change with delayed reload
      if (vw === 800) {
        await page.evaluate(() => { window.__ls = 0; new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) window.__ls += e.value; }).observe({ type: 'layout-shift', buffered: false }); });
        const snap = () => page.evaluate(() => { const a = document.querySelector('aside:has(.sidebar-scroll)'); const l = a.querySelector('.sidebar-scroll'); return { listH: Math.round(l.scrollHeight), first: Math.round(a.querySelector('.sidebar-scroll button.w-full')?.getBoundingClientRect().top ?? -1), rows: a.querySelectorAll('.sidebar-scroll button.w-full').length, skeleton: !!a.querySelector('.skeleton, ptah-skeleton-block'), empty: /No sessions|No matching/i.test(l.innerText) }; });
        r.shift = { before: await snap() };
        await page.evaluate(() => { window.__delayList = 900; });
        await page.selectOption('[data-testid="session-filter-sort"]', 'priority');
        await page.waitForTimeout(500);
        r.shift.during = await snap();
        await page.screenshot({ path: OUT + '/' + TAG + '-org-' + theme + '-800-reload-during.png' });
        await page.waitForTimeout(1300);
        r.shift.after = await snap();
        r.shift.cls = await page.evaluate(() => window.__ls);
        await page.evaluate(() => { window.__delayList = 0; });
        r.listCalls = await page.evaluate(() => window.__listCalls.length);
      }
      // keyboard order (fresh state)
      if (vw === 1400 || vw === 360) {
        await page.reload();
        await page.waitForSelector('[data-testid="session-organization-chips"]', { timeout: 15000 }).catch(() => {});
        await page.evaluate((t) => document.documentElement.setAttribute('data-theme', t), theme);
        await openSidebar(page);
        await page.waitForTimeout(600);
        await page.locator('[data-testid="session-filter-text"]').focus();
        const seq = [];
        for (let i = 0; i < 16; i++) {
          const d = await page.evaluate(() => { const a = document.activeElement; const cs = getComputedStyle(a); const op = a.closest('.absolute') ? getComputedStyle(a.closest('.absolute')).opacity : null; return { id: a.getAttribute('data-testid') || (a.getAttribute('aria-label') || a.tagName).slice(0, 32), inAside: !!a.closest('aside'), outline: cs.outlineStyle + ' ' + cs.outlineWidth + ' ' + cs.outlineColor, ring: cs.boxShadow !== 'none' ? 'shadow' : '', actionsOpacity: op }; });
          seq.push(d);
          if (i === 0 || i === 3 || i === 6) await sideShot(page, TAG + '-org-' + theme + '-' + vw + '-focus-' + i);
          await page.keyboard.press('Tab');
        }
        r.tabSeq = seq;
      }
      await ctx.close();
    }
  }
}

if (ONLY.includes('vscode')) {
  for (const theme of themes) {
    for (const vw of [360, 800, 1400]) {
      const key = 'vscode-' + theme + '-' + vw;
      const { ctx, page, errs } = await boot(browser, { vw, theme, host: 'vscode', mode: 'vscode' });
      await page.waitForTimeout(1500);
      await openSidebar(page);
      await page.waitForTimeout(800);
      const r = (results[key] = {});
      r.errs = errs.slice(0, 5);
      r.default = await page.evaluate(MEASURE);
      await page.screenshot({ path: OUT + '/' + TAG + '-vscode-' + theme + '-' + vw + '-full.png' });
      await sideShot(page, TAG + '-vscode-' + theme + '-' + vw + '-sidebar');
      // resting state of row actions and keyboard focus
      const row = page.locator('aside:has(.sidebar-scroll) li.group').first();
      r.rest = await row.evaluate((li) => { const a = li.querySelector('.absolute'); return { opacity: a ? getComputedStyle(a).opacity : null, html: li.outerHTML.replace(/_ngcontent[^ ]*|ng-reflect[^ ]*/g, '').length, btnPr: getComputedStyle(li.querySelector('button.w-full')).paddingRight }; });
      if (vw === 800) {
        const rn = row.locator('button[title="Rename session"]');
        await rn.focus();
        r.focusRename = await row.evaluate((li) => { const a = li.querySelector('.absolute'); return { opacity: getComputedStyle(a).opacity, activeIsRename: document.activeElement.title }; });
        await page.keyboard.press('Tab');
        await sideShot(page, TAG + '-vscode-' + theme + '-800-focus-action');
        await page.locator('aside:has(.sidebar-scroll)').click({ position: { x: 5, y: 600 } }).catch(() => {});
        await row.hover(); await page.waitForTimeout(300);
        await sideShot(page, TAG + '-vscode-' + theme + '-800-row-hover');
      }
      await ctx.close();
    }
  }
}
writeFileSync(OUT + '/results-' + TAG + (process.env.ONLY ? '-' + process.env.ONLY.replace(/,/g, '_') : '') + '.json', JSON.stringify(results, null, 2));
await browser.close();
srv.close();
console.log('done', TAG);
