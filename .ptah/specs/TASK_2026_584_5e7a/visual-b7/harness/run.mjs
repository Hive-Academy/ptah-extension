import { chromium, serve, setup, inject } from './lib.mjs';
import fs from 'node:fs';
const OUT = 'D:/projects/ptah-extension/.claude-worktrees/task-584/.ptah/specs/TASK_2026_584_5e7a/visual-b7';
fs.mkdirSync(OUT, { recursive: true });
const PARENT = '11111111-1111-4111-8111-111111111111',
  CHILD = '22222222-2222-4222-8222-222222222222',
  CSESS = '33333333-3333-4333-8333-333333333333';
const GONE = '99999999-9999-4999-8999-999999999999';
const THEMES = { dark: 'anubis', light: 'anubis-light' };
const ORIGIN = (parent) => ({
  parentTabId: parent,
  parentSessionId: null,
  label: 'Agent: add auth tests',
  branch: 'feat/agent-auth-tests',
  worktreePath: 'C:\\ws\\.worktrees\\feat-agent-auth-tests',
  startedAt: 1790000000000,
});
const tab = (id, title, o = {}) => ({
  id, claudeSessionId: null, name: title, title, titleOrigin: 'user', order: 0,
  status: 'fresh', isDirty: false, lastActivityAt: 1790867200000, messages: [],
  streamingState: null, attachedBinding: null, ...o,
});
function seed({ child, childPlain, childParent = PARENT, active = PARENT }) {
  const tabs = [tab(PARENT, 'Parent: refactor auth'), tab('44444444-4444-4444-8444-444444444444', 'Notes')];
  if (child) tabs.splice(1, 0, tab(CHILD, 'Agent: add auth tests', { status: 'loaded', claudeSessionId: CSESS, agentOrigin: ORIGIN(childParent) }));
  if (childPlain) tabs.splice(1, 0, tab(CHILD, 'Agent: add auth tests', { status: 'loaded', claudeSessionId: CSESS }));
  tabs.forEach((t, i) => (t.order = i));
  return JSON.stringify({ tabs, activeTabId: active, version: 2 });
}
const PAYLOAD = (parent = PARENT) => ({
  tabId: CHILD, sessionId: null, parentTabId: parent, parentSessionId: null,
  workspaceRoot: 'C:\\ws', worktreePath: 'C:\\ws\\.worktrees\\feat-agent-auth-tests',
  branch: 'feat/agent-auth-tests', label: 'Agent: add auth tests',
  displayPrompt: 'Write unit tests for the auth module.', startedAt: Date.now(),
});
const ev = (id, eventType, messageId, extra) => ({ id, eventType, timestamp: 1, sessionId: CSESS, source: 'history', messageId, ...extra });
const HIST = [
  ev('e1', 'message_start', 'm1', { role: 'user' }),
  ev('e2', 'text_delta', 'm1', { blockIndex: 0, delta: 'Write unit tests for the auth module.' }),
  ev('e3', 'message_complete', 'm1', {}),
  ev('e4', 'message_start', 'm2', { role: 'assistant' }),
  ev('e5', 'text_delta', 'm2', { blockIndex: 0, delta: 'I added 14 tests for the auth module in the worktree and they pass.' }),
  ev('e6', 'message_complete', 'm2', {}),
];

async function boot(srvUrl, b, { theme, width, height = 700, storage, fixtures = {} }) {
  const ctx = await b.newContext({ viewport: { width, height } });
  await setup(ctx, { theme: THEMES[theme], fixtures: { 'chat:agent-sessions': { sessions: [] }, ...fixtures } });
  await ctx.addInitScript(({ storage }) => {
    try {
      localStorage.setItem('ptah-layout-mode', 'single');
      if (storage && !sessionStorage.getItem('__seeded')) {
        localStorage.setItem('ptah.tabs.vr', storage);
        sessionStorage.setItem('__seeded', '1');
      }
    } catch (e) {}
  }, { storage });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log('PAGEERR', e.message));
  page.on('console', (m) => { if (/AgentSession|adopt/i.test(m.text())) console.log('CONSOLE', m.text().slice(0, 200)); });
  await page.goto(srvUrl);
  await page.waitForSelector('ptah-tab-bar ptah-tab-item', { timeout: 20000 });
  await page.waitForTimeout(800);
  await page.getByRole('button', { name: 'Dismiss Thoth hint' }).click({ timeout: 2000 }).catch(() => {});
  await page.waitForTimeout(300);
  return { ctx, page };
}
const shot = async (page, name, sel) => {
  const f = `${OUT}/${name}.png`;
  if (sel) { try { await page.locator(sel).first().screenshot({ path: f, timeout: 4000 }); } catch (e) { N["element-shot-failed-" + name] = sel + " not visible; full page captured instead"; await page.screenshot({ path: f }); } }
  else await page.screenshot({ path: f });
  return name + '.png';
};
const results = { shots: [], notes: {} };
const rec = (file, theme, state, what) => results.shots.push({ file, theme, state, what });
const N = results.notes;
const LS = () => { window.__ls = []; new PerformanceObserver((l) => window.__ls.push(...l.getEntries().map((e) => e.value))).observe({ type: 'layout-shift', buffered: true }); };

const after = await serve('D:/tmp/vr584/after');
const before = await serve('D:/tmp/vr584/before');
const b = await chromium.launch();
for (const theme of Object.keys(THEMES)) {
  {
    const { ctx, page } = await boot(before.url, b, { theme, width: 1400, storage: seed({ childPlain: true }) });
    rec(await shot(page, `s1-tabbar-${theme}-before-1400`, 'ptah-tab-bar'), theme, 'before', 'tab bar, child tab without badge (base a90c086d7)');
    rec(await shot(page, `s1-page-${theme}-before-1400`), theme, 'before', 'full window, same state');
    await ctx.close();
  }
  {
    const { ctx, page } = await boot(after.url, b, { theme, width: 1400, storage: seed({}) });
    await page.evaluate(LS);
    const p1 = await page.locator('ptah-tab-item').first().boundingBox();
    await inject(page, { type: 'agentSession:opened', payload: PAYLOAD() });
    await page.waitForSelector('[data-test="tab-bar-agent-badge"]', { timeout: 5000 });
    await page.waitForTimeout(600);
    const p2 = await page.locator('ptah-tab-item').first().boundingBox();
    N['live-parent-box-' + theme] = [p1, p2];
    rec(await shot(page, `s1-tabbar-${theme}-after-1400`, 'ptah-tab-bar'), theme, 'after', 'tab bar after live agentSession:opened push (badge)');
    rec(await shot(page, `s1-page-${theme}-after-1400`), theme, 'after', 'full window, live push; active tab unchanged (parent)');
    N['live-layout-shift-' + theme] = await page.evaluate(() => window.__ls);
    N['live-banner-count-' + theme] = await page.locator('[data-test="agent-origin-banner"]:visible').count();
    await ctx.close();
  }
  for (const variant of ['parent', 'gone']) {
    const { ctx, page } = await boot(after.url, b, { theme, width: 1400, storage: seed({ child: true, childParent: variant === 'gone' ? GONE : PARENT, active: CHILD }) });
    const badge = page.locator('[data-test="tab-bar-agent-badge"]');
    await badge.waitFor();
    N[`badge-${variant}-${theme}`] = await badge.evaluate((e) => ({ title: e.title, aria: e.getAttribute('aria-label'), ariaDisabled: e.getAttribute('aria-disabled'), text: e.textContent.trim(), w: e.getBoundingClientRect().width, h: e.getBoundingClientRect().height }));
    await badge.hover();
    await page.waitForTimeout(700);
    rec(await shot(page, `s2-tooltip-${variant}-${theme}-after-1400`, 'ptah-tab-bar'), theme, 'after', `badge hovered, ${variant === 'gone' ? 'parent gone' : 'parent present'} (native title tooltip not captured by headless screenshot)`);
    const banner = page.locator('[data-test="agent-origin-banner"]:visible');
    await banner.waitFor();
    rec(await shot(page, `s3-banner-${theme}-${variant}-after-1400`, '[data-test="agent-origin-banner"]:visible'), theme, 'after', `agent-origin banner, ${variant === 'gone' ? 'parent gone (no Open parent)' : 'with Open parent'}`);
    rec(await shot(page, `s3-page-${theme}-${variant}-after-1400`), theme, 'after', `chat view with banner, ${variant}`);
    N[`open-parent-count-${variant}-${theme}`] = await page.locator('[data-test="agent-origin-open-parent"]:visible').count();
    if (variant === 'parent') {
      N['contrast-' + theme] = await page.evaluate(() => {
        const cv = document.createElement('canvas'); cv.width = cv.height = 1;
        const cx = cv.getContext('2d', { willReadFrequently: true });
        const px = (fills) => { cx.clearRect(0, 0, 1, 1); for (const f of fills) { cx.fillStyle = f; cx.fillRect(0, 0, 1, 1); } const d = cx.getImageData(0, 0, 1, 1).data; return [d[0], d[1], d[2]]; };
        const lum = ([r, g, b]) => { const f = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
        const cr = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return +((x + 0.05) / (y + 0.05)).toFixed(2); };
        const chain = (el) => { const arr = []; for (let e = el; e; e = e.parentElement) arr.unshift(getComputedStyle(e).backgroundColor); return arr.filter((c) => c !== 'rgba(0, 0, 0, 0)' && c !== 'transparent'); };
        const measure = (label, el, border) => {
          if (!el) return { label, missing: true };
          const cs = getComputedStyle(el);
          const bg = px(chain(el));
          const fg = px([...chain(el), cs.color]);
          const r = { label, color: cs.color, fontSize: cs.fontSize, fontWeight: cs.fontWeight, contrast: cr(fg, bg) };
          if (border) { const bd = px([...chain(el.parentElement), cs.borderTopColor]); r.borderVsSurround = cr(bd, px(chain(el.parentElement))); r.borderColor = cs.borderTopColor; }
          return r;
        };
        const q = (s) => [...document.querySelectorAll(s)].find((e) => e.getBoundingClientRect().width > 0);
        return [
          measure('badge text/border', q('[data-test="tab-bar-agent-badge"]'), true),
          measure('banner title span', q('[data-test="agent-origin-banner"] span.font-semibold')),
          measure('banner paragraph', q('[data-test="agent-origin-banner"] p')),
          measure('banner mono branch', q('[data-test="agent-origin-banner"] p span.font-mono')),
          measure('Open parent button', q('[data-test="agent-origin-open-parent"]')),
          measure('banner border', q('[data-test="agent-origin-banner"]'), true),
          measure('banner bot icon', q('[data-test="agent-origin-banner"] lucide-angular')),
        ];
      });
      await page.evaluate(() => document.activeElement && document.activeElement.blur());
      const stops = [];
      for (let i = 0; i < 90; i++) {
        await page.keyboard.press('Tab');
        const info = await page.evaluate(() => { const e = document.activeElement; if (!e) return null; const cs = getComputedStyle(e); return { dt: e.getAttribute('data-test'), tag: e.tagName, al: (e.getAttribute('aria-label') || e.textContent || '').trim().slice(0, 40), outline: cs.outlineStyle + ' ' + cs.outlineWidth + ' ' + cs.outlineColor, outlineOffset: cs.outlineOffset, boxShadow: cs.boxShadow.slice(0, 60) }; });
        stops.push(info);
        if (info && info.dt === 'tab-bar-agent-badge' && !N['focus-badge-' + theme]) { await page.waitForTimeout(150); rec(await shot(page, `s5-focus-badge-${theme}-after-1400`, 'ptah-tab-bar'), theme, 'after', 'keyboard focus on agent badge'); N['focus-badge-' + theme] = info; }
        if (info && info.dt === 'agent-origin-open-parent') { await page.waitForTimeout(150); rec(await shot(page, `s5-focus-openparent-${theme}-after-1400`, '[data-test="agent-origin-banner"]:visible'), theme, 'after', 'keyboard focus on Open parent'); N['focus-openparent-' + theme] = info; break; }
      }
      N['tab-stops-' + theme] = stops.map((s) => s && (s.dt || s.al));
      await page.locator('[data-test="agent-origin-open-parent"]:visible').click();
      await page.waitForTimeout(500);
      N['after-open-parent-banner-count-' + theme] = await page.locator('[data-test="agent-origin-banner"]:visible').count();
      rec(await shot(page, `s3-page-${theme}-after-open-parent-clicked-1400`), theme, 'after', 'after clicking Open parent (parent tab active, banner gone)');
      // badge click from child tab
      await page.locator('ptah-tab-item', { hasText: 'Agent: add auth tests' }).first().click();
      await page.waitForTimeout(300);
      await page.locator('[data-test="tab-bar-agent-badge"]').click();
      await page.waitForTimeout(400);
      N['after-badge-click-banner-count-' + theme] = await page.locator('[data-test="agent-origin-banner"]:visible').count();
    } else {
      await badge.click({ force: true });
      await page.waitForTimeout(300);
      N['gone-badge-click-banner-still-' + theme] = await page.locator('[data-test="agent-origin-banner"]:visible').count();
    }
    await ctx.close();
  }
  {
    const fx = { 'chat:agent-sessions': { sessions: [{ ...PAYLOAD(), sessionId: CSESS }] }, 'session:load': { success: true }, 'chat:resume': { success: true, sessionId: CSESS, events: HIST, stats: null } };
    const { ctx, page } = await boot(after.url, b, { theme, width: 1400, storage: seed({}), fixtures: fx });
    await page.waitForSelector('[data-test="tab-bar-agent-badge"]', { timeout: 8000 });
    await page.waitForTimeout(500);
    rec(await shot(page, `s4-late-${theme}-after-adopted-not-activated-1400`), theme, 'after', 'late-adopted tab right after bootstrap adoption (parent still active, child not yet activated)');
    await page.evaluate(() => { window.__out.length = 0; });
    await page.locator('ptah-tab-item', { hasText: 'Agent: add auth tests' }).first().click();
    await page.waitForTimeout(2500);
    N['late-outbound-' + theme] = await page.evaluate(() => window.__out.filter((m) => m.type === 'rpc:call').map((m) => m.payload.method + (m.payload.params && m.payload.params.activate ? '(activate)' : '')));
    rec(await shot(page, `s4-late-${theme}-after-first-activation-1400`), theme, 'after', 'late-adopted tab after first activation (history loaded, banner shown)');
    await page.evaluate(() => { window.__out.length = 0; });
    await page.locator('ptah-tab-item').first().click(); await page.waitForTimeout(400);
    await page.locator('ptah-tab-item', { hasText: 'Agent: add auth tests' }).first().click(); await page.waitForTimeout(800);
    N['late-outbound-reactivation-' + theme] = await page.evaluate(() => window.__out.filter((m) => m.type === 'rpc:call').map((m) => m.payload.method));
    await ctx.close();
  }
  for (const w of [360, 800, 1000]) {
    {
      const { ctx, page } = await boot(before.url, b, { theme, width: w, height: 640, storage: seed({ childPlain: true }) });
      await page.evaluate(LS); rec(await shot(page, `s6-tabbar-${theme}-before-${w}`, 'ptah-tab-bar'), theme, 'before', `tab bar at ${w}px`); await page.waitForTimeout(300); N[`ls-before-${w}-${theme}`] = await page.evaluate(() => window.__ls);
      N[`overflow-before-${w}-${theme}`] = await page.evaluate(() => ({ docScroll: document.documentElement.scrollWidth, vw: innerWidth, bar: (() => { const e = document.querySelector('ptah-tab-bar [class*="tab-scroll-container"]'); return e ? { sw: e.scrollWidth, cw: e.clientWidth } : null; })() }));
      await ctx.close();
    }
    const { ctx, page } = await boot(after.url, b, { theme, width: w, height: 640, storage: seed({ child: true, active: CHILD }) });
    await page.evaluate(LS);
    rec(await shot(page, `s6-tabbar-${theme}-after-${w}`, 'ptah-tab-bar'), theme, 'after', `tab bar at ${w}px, agent badge`);
    rec(await shot(page, `s6-page-${theme}-after-${w}`), theme, 'after', `full window at ${w}px with banner`);
    N[`overflow-after-${w}-${theme}`] = await page.evaluate(() => ({ docScroll: document.documentElement.scrollWidth, vw: innerWidth, banner: (() => { const e = [...document.querySelectorAll('[data-test="agent-origin-banner"]')].find((x) => x.getBoundingClientRect().width > 0); return e ? { sw: e.scrollWidth, cw: e.clientWidth, h: e.getBoundingClientRect().height } : null; })(), bar: (() => { const e = document.querySelector('ptah-tab-bar [class*="tab-scroll-container"]'); return e ? { sw: e.scrollWidth, cw: e.clientWidth } : null; })() }));
    await page.waitForTimeout(500);
    N[`ls-after-${w}-${theme}`] = await page.evaluate(() => window.__ls);
    await ctx.close();
  }
}
fs.writeFileSync('D:/tmp/vr584/results.json', JSON.stringify(results, null, 1));
await b.close(); after.close(); before.close();
console.log(JSON.stringify(results.notes, null, 1).slice(0, 12000));
