import { chromium, serve, setup, inject } from './lib.mjs';
import fs from 'node:fs';
const OUT = 'D:/projects/ptah-extension/.claude-worktrees/task-584/.ptah/specs/TASK_2026_584_5e7a/visual-b7/r1';
fs.mkdirSync(OUT, { recursive: true });
const PARENT = '11111111-1111-4111-8111-111111111111', CHILD = '22222222-2222-4222-8222-222222222222', CSESS = '33333333-3333-4333-8333-333333333333';
const GONE = '99999999-9999-4999-8999-999999999999';
const THEMES = { dark: 'anubis', light: 'anubis-light' };
const BS = String.fromCharCode(92);
const WT = ['C:', 'ws', '.worktrees', 'feat-agent-auth-tests'].join(BS);
const ORIGIN = (parent) => ({ parentTabId: parent, parentSessionId: null, label: 'Agent: add auth tests', branch: 'feat/agent-auth-tests', worktreePath: WT, startedAt: 1790000000000 });
const tab = (id, title, o = {}) => ({ id, claudeSessionId: null, name: title, title, titleOrigin: 'user', order: 0, status: 'fresh', isDirty: false, lastActivityAt: 1790867200000, messages: [], streamingState: null, attachedBinding: null, ...o });
function seed({ child, childParent = PARENT, active = PARENT }) {
  const tabs = [tab(PARENT, 'Parent: refactor auth'), tab('44444444-4444-4444-8444-444444444444', 'Notes')];
  if (child) tabs.splice(1, 0, tab(CHILD, 'Agent: add auth tests', { status: 'loaded', claudeSessionId: CSESS, agentOrigin: ORIGIN(childParent) }));
  tabs.forEach((t, i) => (t.order = i));
  return JSON.stringify({ tabs, activeTabId: active, version: 2 });
}
const PAYLOAD = (sid = null) => ({ tabId: CHILD, sessionId: sid, parentTabId: PARENT, parentSessionId: null, workspaceRoot: 'C:' + BS + 'ws', worktreePath: WT, branch: 'feat/agent-auth-tests', label: 'Agent: add auth tests', displayPrompt: 'Write unit tests for the auth module.', startedAt: Date.now() });
const ev = (id, eventType, messageId, extra) => ({ id, eventType, timestamp: 1, sessionId: CSESS, source: 'history', messageId, ...extra });
const HIST = [ev('e1', 'message_start', 'm1', { role: 'user' }), ev('e2', 'text_delta', 'm1', { blockIndex: 0, delta: 'Write unit tests for the auth module.' }), ev('e3', 'message_complete', 'm1', {}), ev('e4', 'message_start', 'm2', { role: 'assistant' }), ev('e5', 'text_delta', 'm2', { blockIndex: 0, delta: 'I added 14 tests for the auth module in the worktree and they pass.' }), ev('e6', 'message_complete', 'm2', {})];

async function boot(url, b, { theme, width, height = 700, storage, fixtures = {} }) {
  const ctx = await b.newContext({ viewport: { width, height } });
  await setup(ctx, { theme: THEMES[theme], fixtures: { 'chat:agent-sessions': { sessions: [] }, ...fixtures } });
  await ctx.addInitScript(({ storage }) => { try { localStorage.setItem('ptah-layout-mode', 'single'); if (storage && !sessionStorage.getItem('__seeded')) { localStorage.setItem('ptah.tabs.vr', storage); sessionStorage.setItem('__seeded', '1'); } } catch (e) {} }, { storage });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log('PAGEERR', e.message));
  page.on('console', (m) => { if (/AgentSession/i.test(m.text())) console.log('CONSOLE', theme, m.text().slice(0, 160)); });
  await page.goto(url);
  await page.waitForSelector('ptah-tab-bar ptah-tab-item', { timeout: 20000 });
  await page.waitForTimeout(800);
  await page.getByRole('button', { name: 'Dismiss Thoth hint' }).click({ timeout: 2000 }).catch(() => {});
  await page.waitForTimeout(300);
  return { ctx, page };
}
const results = { shots: [], notes: {} };
const N = results.notes;
const shot = async (page, name, sel, clip) => {
  const f = `${OUT}/${name}.png`;
  if (clip) await page.screenshot({ path: f, clip });
  else if (sel) { try { await page.locator(sel).first().screenshot({ path: f, timeout: 4000 }); } catch (e) { N['fallback-' + name] = 'full page'; await page.screenshot({ path: f }); } }
  else await page.screenshot({ path: f });
  results.shots.push(name + '.png');
};
const LS = () => { window.__ls = []; new PerformanceObserver((l) => window.__ls.push(...l.getEntries().map((e) => e.value))).observe({ type: 'layout-shift', buffered: true }); };
const vis = (s) => `${s}:visible`;
const CONTRAST = () => {
  const cv = document.createElement('canvas'); cv.width = cv.height = 1;
  const cx = cv.getContext('2d', { willReadFrequently: true });
  const px = (fills) => { cx.clearRect(0, 0, 1, 1); for (const f of fills) { cx.fillStyle = f; cx.fillRect(0, 0, 1, 1); } const d = cx.getImageData(0, 0, 1, 1).data; return [d[0], d[1], d[2]]; };
  const lum = ([r, g, b]) => { const f = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
  const cr = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return +((x + 0.05) / (y + 0.05)).toFixed(2); };
  const chain = (el) => { const arr = []; for (let e = el; e; e = e.parentElement) arr.unshift(getComputedStyle(e).backgroundColor); return arr.filter((c) => c !== 'rgba(0, 0, 0, 0)' && c !== 'transparent'); };
  const q = (s) => [...document.querySelectorAll(s)].find((e) => e.getBoundingClientRect().width > 0);
  const text = (label, el) => { if (!el) return { label, missing: true }; const cs = getComputedStyle(el); const bg = px(chain(el)); return { label, fontSize: cs.fontSize, opacity: cs.opacity, contrast: cr(px([...chain(el), cs.color]), bg) }; };
  const edge = (label, el, color) => { if (!el) return { label, missing: true }; const bg = px(chain(el.parentElement)); return { label, contrast: cr(px([...chain(el.parentElement), color]), bg) }; };
  const badge = q('[data-test="tab-bar-agent-badge"]');
  const banner = q('[data-test="agent-origin-banner"]');
  const out = [text('badge text', badge), badge && edge('badge border', badge, getComputedStyle(badge).borderTopColor), badge && edge('badge icon', badge.querySelector('lucide-angular'), getComputedStyle(badge.querySelector('lucide-angular')).color)];
  if (banner) out.push(text('banner heading', banner.querySelector('span.font-semibold')), text('banner paragraph', banner.querySelector('p') || banner.querySelector('details') || banner), text('Open parent', q('[data-test="agent-origin-open-parent"]')), edge('banner icon', banner.querySelector('lucide-angular'), getComputedStyle(banner.querySelector('lucide-angular')).color), edge('banner border', banner, getComputedStyle(banner).borderTopColor));
  return out.filter(Boolean);
};

const after = await serve('D:/tmp/vr584/after');
const b = await chromium.launch();
for (const theme of Object.keys(THEMES)) {
  // finding 3 + live push
  {
    const { ctx, page } = await boot(after.url, b, { theme, width: 1400, storage: seed({}) });
    await page.evaluate(LS);
    const p1 = await page.locator('ptah-tab-item').first().boundingBox();
    await page.evaluate((p) => window.dispatchEvent(new MessageEvent('message', { data: { type: 'agentSession:opened', payload: p } })), PAYLOAD());
    await page.waitForSelector('[data-test="tab-bar-agent-badge"]', { timeout: 5000 });
    await page.waitForTimeout(600);
    await shot(page, `s1-tabbar-${theme}-after-1400`, 'ptah-tab-bar');
    await shot(page, `s1-page-${theme}-after-1400`);
    N['live-ls-' + theme] = await page.evaluate(() => window.__ls);
    N['live-active-tab-' + theme] = await page.evaluate(() => [...document.querySelectorAll('ptah-tab-item')].map((e) => e.textContent.trim().slice(0, 30)));
    N['live-banner-' + theme] = await page.locator(vis('[data-test="agent-origin-banner"]')).count();
    N['badge-inside-tab-item-' + theme] = await page.evaluate(() => { const bd = document.querySelector('[data-test="tab-bar-agent-badge"]'); const ti = bd && bd.closest('ptah-tab-item'); const r = bd && bd.getBoundingClientRect(); return { inside: !!ti, tabText: ti && ti.textContent.trim().slice(0, 40), w: r && r.width, h: r && r.height }; });
    await ctx.close();
  }
  for (const variant of ['parent', 'gone']) {
    const { ctx, page } = await boot(after.url, b, { theme, width: 1400, storage: seed({ child: true, childParent: variant === 'gone' ? GONE : PARENT, active: CHILD }) });
    const badge = page.locator('[data-test="tab-bar-agent-badge"]');
    await badge.waitFor();
    N[`badge-${variant}-${theme}`] = await badge.evaluate((e) => { const cs = getComputedStyle(e); return { title: e.getAttribute('title'), aria: e.getAttribute('aria-label'), ariaDisabled: e.getAttribute('aria-disabled'), cursor: cs.cursor, opacity: cs.opacity }; });
    const box = await badge.boundingBox();
    const clip = { x: Math.max(0, box.x - 160), y: 0, width: 520, height: 150 };
    await badge.hover();
    await page.waitForTimeout(500);
    N[`tooltip-hover-${variant}-${theme}`] = await page.evaluate(() => { const t = document.querySelector('[data-test="tab-bar-agent-badge-tooltip"]'); const b = document.querySelector('[data-test="tab-bar-agent-badge"]'); if (!t) return null; const r = t.getBoundingClientRect(); return { text: t.innerText, vis: getComputedStyle(t).visibility, rect: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)], describedby: b.getAttribute('aria-describedby'), id: t.id }; });
    await shot(page, `s2-tooltip-hover-${variant}-${theme}-1400`, null, clip);
    await page.mouse.move(700, 400);
    await page.waitForTimeout(300);
    N[`tooltip-after-leave-${variant}-${theme}`] = await page.locator('[data-test="tab-bar-agent-badge-tooltip"]').count();
    // keyboard focus
    await badge.focus();
    await page.waitForTimeout(500);
    N[`tooltip-focus-${variant}-${theme}`] = await page.evaluate(() => { const t = document.querySelector('[data-test="tab-bar-agent-badge-tooltip"]'); const bd = document.querySelector('[data-test="tab-bar-agent-badge"]'); const cs = getComputedStyle(bd); return { shown: !!t, vis: t && getComputedStyle(t).visibility, text: t && t.innerText, describedby: bd.getAttribute('aria-describedby'), outline: cs.outlineStyle + ' ' + cs.outlineWidth + ' ' + cs.outlineColor, boxShadow: cs.boxShadow.slice(0, 80) }; });
    await shot(page, `s2-tooltip-focus-${variant}-${theme}-1400`, null, clip);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    N[`tooltip-escape-${variant}-${theme}`] = await page.locator('[data-test="tab-bar-agent-badge-tooltip"]').count();
    // finding 5 banner at 1400
    await page.mouse.move(700, 400);
    await shot(page, `s3-banner-${variant}-${theme}-1400`, vis('[data-test="agent-origin-banner"]'));
    await shot(page, `s3-page-${variant}-${theme}-1400`);
    N[`banner-text-${variant}-${theme}`] = await page.locator(vis('[data-test="agent-origin-banner"]')).first().innerText();
    N[`banner-parent-${variant}-open-parent-${theme}`] = await page.locator(vis('[data-test="agent-origin-open-parent"]')).count();
    if (variant === 'parent') {
      N['contrast-' + theme] = await page.evaluate(CONTRAST);
      // tooltip contrast
      await badge.hover(); await page.waitForTimeout(400);
      N['contrast-tooltip-' + theme] = await page.evaluate(() => { const t = document.querySelector('[data-test="tab-bar-agent-badge-tooltip"]'); if (!t) return null; const cv = document.createElement('canvas'); cv.width = cv.height = 1; const cx = cv.getContext('2d', { willReadFrequently: true }); const px = (f) => { cx.clearRect(0, 0, 1, 1); for (const c of f) { cx.fillStyle = c; cx.fillRect(0, 0, 1, 1); } const d = cx.getImageData(0, 0, 1, 1).data; return [d[0], d[1], d[2]]; }; const lum = ([r, g, b]) => { const f = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); }; const cs = getComputedStyle(t); const bg = px([cs.backgroundColor]); const fg = px([cs.backgroundColor, cs.color]); const [x, y] = [lum(fg), lum(bg)].sort((p, q) => q - p); return +((x + 0.05) / (y + 0.05)).toFixed(2); });
      await page.mouse.move(700, 400);
      // focus stops
      await page.evaluate(() => document.activeElement && document.activeElement.blur());
      const stops = [];
      for (let i = 0; i < 90; i++) {
        await page.keyboard.press('Tab');
        const info = await page.evaluate(() => { const e = document.activeElement; if (!e) return null; const cs = getComputedStyle(e); return { dt: e.getAttribute('data-test'), outline: cs.outlineStyle + ' ' + cs.outlineWidth + ' ' + cs.outlineColor, off: cs.outlineOffset }; });
        stops.push(info && info.dt);
        if (info && info.dt === 'tab-bar-agent-badge' && !N['focus-badge-' + theme]) { N['focus-badge-' + theme] = info; await page.waitForTimeout(150); await shot(page, `s5-focus-badge-${theme}-1400`, null, clip); N['focus-ring-contrast-' + theme] = await page.evaluate(() => { const e = document.activeElement; const cs = getComputedStyle(e); const cv = document.createElement('canvas'); cv.width = cv.height = 1; const cx = cv.getContext('2d', { willReadFrequently: true }); const px = (f) => { cx.clearRect(0, 0, 1, 1); for (const c of f) { cx.fillStyle = c; cx.fillRect(0, 0, 1, 1); } const d = cx.getImageData(0, 0, 1, 1).data; return [d[0], d[1], d[2]]; }; const lum = ([r, g, b]) => { const f = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); }; const chain = []; for (let x = e.parentElement; x; x = x.parentElement) chain.unshift(getComputedStyle(x).backgroundColor); const c2 = chain.filter((c) => c !== 'rgba(0, 0, 0, 0)'); const bg = px(c2); const ring = px([...c2, cs.outlineColor]); const [p, q] = [lum(ring), lum(bg)].sort((m, n) => n - m); return +((p + 0.05) / (q + 0.05)).toFixed(2); }); }
        if (info && info.dt === 'agent-origin-open-parent') { N['focus-openparent-' + theme] = info; await page.waitForTimeout(150); await shot(page, `s5-focus-openparent-${theme}-1400`, vis('[data-test="agent-origin-banner"]')); break; }
      }
      N['tab-stop-order-' + theme] = stops.filter(Boolean);
      // click badge on child -> parent; click Open parent
      await page.locator(vis('[data-test="agent-origin-open-parent"]')).click();
      await page.waitForTimeout(400);
      N['open-parent-banner-after-' + theme] = await page.locator(vis('[data-test="agent-origin-banner"]')).count();
      await page.locator('ptah-tab-item', { hasText: 'Agent: add auth tests' }).first().click();
      await page.waitForTimeout(300);
      N['child-active-banner-' + theme] = await page.locator(vis('[data-test="agent-origin-banner"]')).count();
      await page.locator('[data-test="tab-bar-agent-badge"]').click();
      await page.waitForTimeout(400);
      N['badge-click-banner-after-' + theme] = await page.locator(vis('[data-test="agent-origin-banner"]')).count();
    } else {
      await badge.click({ force: true }); await page.waitForTimeout(300);
      N['gone-badge-click-banner-' + theme] = await page.locator(vis('[data-test="agent-origin-banner"]')).count();
    }
    await ctx.close();
  }
  // finding 1: late adoption, VS Code-style host (activeWorkspacePath null); first load fails once to test retry
  {
    const failFirst = '@fn:function(){ window.__n=(window.__n||0)+1; return window.__n===1 ? {__error:"boom"} : {success:true}; }';
    const fx = { 'chat:agent-sessions': { sessions: [PAYLOAD(CSESS)] }, 'session:load': { success: true }, 'chat:resume': { success: true, sessionId: CSESS, events: HIST, stats: null } };
    const { ctx, page } = await boot(after.url, b, { theme, width: 1400, storage: seed({}), fixtures: fx });
    await page.waitForSelector('[data-test="tab-bar-agent-badge"]', { timeout: 8000 });
    await page.waitForTimeout(500);
    N['late-active-path-' + theme] = await page.evaluate(() => window.ng.getComponent(document.querySelector('ptah-tab-bar')).tabManager.workspacePartition.activeWorkspacePath);
    await shot(page, `s4-late-${theme}-adopted-not-activated-1400`);
    await page.evaluate(() => { window.__out.length = 0; window.__log = []; window.__t0 = Math.round(performance.now()); });
    await page.locator('ptah-tab-item', { hasText: 'Agent: add auth tests' }).first().click();
    await page.waitForTimeout(2500);
    N['late-rpc-' + theme] = await page.evaluate(() => window.__log.filter((l) => l[1] === 'rpc:call').map((l) => l[0] - window.__t0 + 'ms ' + l[2]));
    N['late-msgs-' + theme] = await page.evaluate(() => window.ng.getComponent(document.querySelector('ptah-tab-bar')).tabManager.tabs().find((t) => t.id === '22222222-2222-4222-8222-222222222222').messages.length);
    await shot(page, `s4-late-${theme}-first-activation-1400`);
    N['late-banner-' + theme] = await page.locator(vis('[data-test="agent-origin-banner"]')).count();
    await page.evaluate(() => { window.__out.length = 0; window.__log = []; });
    await page.locator('ptah-tab-item').first().click(); await page.waitForTimeout(400);
    await page.locator('ptah-tab-item', { hasText: 'Agent: add auth tests' }).first().click(); await page.waitForTimeout(800);
    N['late-reactivation-rpc-' + theme] = await page.evaluate(() => window.__log.filter((l) => l[1] === 'rpc:call').map((l) => l[2]));
    await ctx.close();
  }
  // retry: first session:load errors
  {
    const lib = null;
    const fx = { 'chat:agent-sessions': { sessions: [PAYLOAD(CSESS)] }, 'session:load': '@fn:function(){ window.__n=(window.__n||0)+1; return window.__n===1 ? {__error:"boom"} : {success:true}; }', 'chat:resume': { success: true, sessionId: CSESS, events: HIST, stats: null } };
    const { ctx, page } = await boot(after.url, b, { theme, width: 1400, storage: seed({}), fixtures: fx });
    await page.waitForSelector('[data-test="tab-bar-agent-badge"]', { timeout: 8000 });
    const click = async () => { await page.locator('ptah-tab-item').first().click(); await page.waitForTimeout(400); await page.locator('ptah-tab-item', { hasText: 'Agent: add auth tests' }).first().click(); await page.waitForTimeout(2200); };
    const msgs = () => page.evaluate(() => window.ng.getComponent(document.querySelector('ptah-tab-bar')).tabManager.tabs().find((t) => t.id === '22222222-2222-4222-8222-222222222222').messages.length);
    await page.evaluate(() => { window.__log = []; });
    await click();
    N['retry-activation1-' + theme] = { msgs: await msgs(), loadCalls: await page.evaluate(() => window.__log.filter((l) => l[2] === 'session:load').length) };
    await shot(page, `s4-retry-${theme}-after-failed-first-load-1400`);
    await click();
    N['retry-activation2-' + theme] = { msgs: await msgs(), loadCalls: await page.evaluate(() => window.__log.filter((l) => l[2] === 'session:load').length) };
    await shot(page, `s4-retry-${theme}-after-second-activation-1400`);
    await click();
    N['retry-activation3-' + theme] = { msgs: await msgs(), loadCalls: await page.evaluate(() => window.__log.filter((l) => l[2] === 'session:load').length) };
    await ctx.close();
  }
  // CLS and layout at each width, child active on load
  for (const w of [360, 800, 1000, 1400]) {
    const { ctx, page } = await boot(after.url, b, { theme, width: w, height: 640, storage: seed({ child: true, active: CHILD }) });
    await page.evaluate(LS);
    await page.waitForTimeout(500);
    await shot(page, `s6-page-${theme}-${w}`);
    N[`cls-${theme}-${w}`] = await page.evaluate(() => ({ entries: window.__ls, sum: +window.__ls.reduce((a, c) => a + c, 0).toFixed(4) }));
    N[`layout-${theme}-${w}`] = await page.evaluate(() => { const e = [...document.querySelectorAll('[data-test="agent-origin-banner"]')].find((x) => x.getBoundingClientRect().width > 0); const sc = document.querySelector('ptah-tab-bar [class*="tab-scroll-container"]'); const d = e && e.querySelector('details'); return { docScroll: document.documentElement.scrollWidth, vw: innerWidth, bannerH: e && Math.round(e.getBoundingClientRect().height), bannerOverflow: e && e.scrollWidth > e.clientWidth, tabStrip: sc && [sc.clientWidth, sc.scrollWidth], details: d ? { open: d.open, summary: d.querySelector('summary') && d.querySelector('summary').innerText } : null }; });
    if (w === 360) {
      const d = page.locator('[data-test="agent-origin-banner"]:visible details summary');
      if (await d.count()) { await d.first().click(); await page.waitForTimeout(300); await shot(page, `s6-page-${theme}-360-details-open`); N['banner-open-h-' + theme] = await page.evaluate(() => { const e = [...document.querySelectorAll('[data-test="agent-origin-banner"]')].find((x) => x.getBoundingClientRect().width > 0); return Math.round(e.getBoundingClientRect().height); }); }
    }
    await ctx.close();
  }
}
fs.writeFileSync('D:/tmp/vr584/results-r1.json', JSON.stringify(results, null, 1));
await b.close(); after.close();
console.log(JSON.stringify(results.notes, null, 1));
