import { chromium } from '@playwright/test';
import { createServer } from 'node:http';
import { createReadStream, statSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, extname, resolve } from 'node:path';

const WT = process.env.WT || 'D:/projects/ptah-extension/.claude-worktrees/task-580';
const ROOT = resolve(WT, 'dist/apps/ptah-extension-webview/browser');
const OUT = resolve('D:/projects/ptah-extension/.claude-worktrees/task-580/.ptah/specs/TASK_2026_580_9f77/visual-c12');
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
for (const theme of ["anubis","anubis-light"]) {
  for (const reduced of [false,true]) {
  const { ctx, page } = await boot(browser, { vw: 800, theme, host: "electron", mode: "org" });
  if (reduced) await page.emulateMedia({ reducedMotion: "reduce" });
  await page.waitForSelector("[data-testid=session-organization-chips]", { timeout: 15000 });
  await page.waitForTimeout(700);
  const key = theme + (reduced ? "-reduced" : "");
  const A = "aside:has(.sidebar-scroll)";
  results[key] = await page.evaluate(() => {
    const cv = document.createElement("canvas"); cv.width = cv.height = 1; const c2 = cv.getContext("2d",{willReadFrequently:true});
    const rgba = (s) => { c2.clearRect(0,0,1,1); c2.fillStyle="#000"; c2.fillStyle=s; c2.fillRect(0,0,1,1); const d=c2.getImageData(0,0,1,1).data; return [d[0],d[1],d[2],d[3]/255]; };
    const over=(f,b)=>[0,1,2].map(i=>f[i]*f[3]+b[i]*(1-f[3])).concat([1]);
    const lum=(c)=>{const k=c.slice(0,3).map(v=>{v/=255;return v<=0.03928?v/12.92:Math.pow((v+0.055)/1.055,2.4)});return 0.2126*k[0]+0.7152*k[1]+0.0722*k[2]};
    const cr=(a,b)=>{const x=lum(a),y=lum(b);return +((Math.max(x,y)+0.05)/(Math.min(x,y)+0.05)).toFixed(2)};
    const bgOf=(el)=>{const st=[];for(let e=el;e;e=e.parentElement){const b=rgba(getComputedStyle(e).backgroundColor);if(b[3]>0)st.push(b);if(b[3]===1)break;}let a=[255,255,255,1];for(const b of st.reverse())a=over(b,a);return a};
    const aside=document.querySelector("aside:has(.sidebar-scroll)");
    const out={};
    const dot=aside.querySelector("[data-live-phase=running] span");
    if(dot){const bg=bgOf(dot.parentElement);const f=rgba(getComputedStyle(dot).backgroundColor);out.liveDot={contrast:cr(over(f,bg),bg),anim:getComputedStyle(dot).animationName,dur:getComputedStyle(dot).animationDuration,running:dot.getAnimations().length};}
    const meta=aside.querySelector("li.group button span.text-xs");const bgm=bgOf(meta);out.metaContrast=cr(over(rgba(getComputedStyle(meta).color),bgm),bgm);
    const sel=[...aside.querySelectorAll("select")].map(s=>({id:s.dataset.testid,text:s.options[s.selectedIndex].text,w:Math.round(s.getBoundingClientRect().width),truncated:s.scrollWidth>s.clientWidth+1}));out.selects=sel;
    out.titles=[...aside.querySelectorAll("li.group button.w-full > span.truncate")].map(t=>({n:t.textContent.trim().slice(0,28),vis:Math.round(t.clientWidth),need:Math.round(t.scrollWidth),trunc:t.scrollWidth>t.clientWidth+1}));
    out.btnPr=getComputedStyle(aside.querySelector("li.group button.w-full")).paddingRight;
    // hover overlap
    out.overlap=[];
    for(const li of aside.querySelectorAll("li.group")){const act=li.querySelector(".absolute");const ar=act.getBoundingClientRect();let hits=[];for(const c of li.querySelectorAll("[data-testid^=session-chip],.truncate,.text-xs")){const r=c.getBoundingClientRect();if(r.width&&r.left<ar.right&&r.right>ar.left&&r.top<ar.bottom&&r.bottom>ar.top)hits.push((c.dataset.testid||c.textContent.trim().slice(0,14))+"@"+Math.round(Math.min(r.right,ar.right)-Math.max(r.left,ar.left))+"px");}
      out.overlap.push(li.querySelector(".truncate").textContent.trim().slice(0,16)+" -> "+hits.join(", "));}
    return out;
  });
  if (!reduced) {
    // action opacity settle on keyboard focus + screenshot
    const A2 = "aside:has(.sidebar-scroll)";
    await page.locator(A2 + " li.group", { hasText: "Fix flaky" }).locator("button[title='Rename session']").focus();
    await page.keyboard.press("Shift+Tab"); await page.waitForTimeout(400);
    results[key].focusSettled = await page.evaluate(() => { const a=document.activeElement; const act=a.closest(".absolute"); return { active:a.getAttribute("data-testid")||a.title, opacity: act?getComputedStyle(act).opacity:null, fv:a.matches(":focus-visible") }; });
    await page.locator(A2).first().screenshot({ path: OUT + "/after-org-" + theme + "-800-kbd-focus-organize.png" });
    await page.keyboard.press("Tab"); await page.waitForTimeout(400);
    await page.locator(A2).first().screenshot({ path: OUT + "/after-org-" + theme + "-800-kbd-focus-rename.png" });
    // hover overlap shot on row with missing chip
    await page.locator(A2 + " li.group", { hasText: "Refactor session" }).hover(); await page.waitForTimeout(400);
    await page.locator(A2 + " li.group", { hasText: "Refactor session" }).screenshot({ path: OUT + "/after-org-" + theme + "-800-row1-hover.png" });
  }
  await ctx.close();
  }
}
writeFileSync(OUT + "/results-after-extra.json", JSON.stringify(results, null, 2));
await browser.close(); srv.close(); console.log("done extra");