// Visual-review capture harness (TASK_2026_719_4f64, phase P4). Not source code.
// Usage: node capture.mjs <before|after> <abs path to dist/apps/ptah-electron/main.mjs> [scenes,comma]
// Fakes the RPC layer in the Electron main process (ipcMain 'rpc' listener replaced), no real
// sign-in, no Claude process, no credentials. Pattern copied from apps/ptah-electron-e2e ui-driver.
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(
  'D:/projects/ptah-extension/.claude-worktrees/claude-named-accounts/package.json',
);
const { _electron } = require('@playwright/test');

const label = process.argv[2];
const entry = process.argv[3];
const only = process.argv[4] ? process.argv[4].split(',') : null;
const OUT = path.dirname(new URL(import.meta.url).pathname.replace(/^\//, ''));
const WS = 'C:\\ptah-e2e-ws';
const THEMES = { dark: 'ptah-glass', light: 'ptah-glass-light' };
const log = (...a) => console.log(`[capture:${label}]`, ...a);

const A1 = 'acct_work_0001';
const A2 = 'acct_client_0002';
const LONG = 'Client Acme Corp production research team shared account';

const snapshotJs = `
const g = globalThis;
g.__acc = g.__acc || {
  revision: 5,
  accounts: [
    { profileId: 'acct_work_0001', label: 'Work', provider: 'claude', state: 'signed-in', owner: 'verified', revision: 1, activeRunCount: 0 },
    { profileId: 'acct_client_0002', label: 'Client Acme Corp production research team shared account', provider: 'claude', state: 'not-signed-in', owner: 'unknown', revision: 1, activeRunCount: 0 },
    { profileId: 'acct_other_0003', label: 'Personal', provider: 'claude', state: 'not-signed-in', owner: 'unknown', revision: 1, activeRunCount: 0 },
  ],
};
g.__snap = () => ({
  provider: 'claude',
  workspaceRoot: 'C:\\\\ptah-e2e-ws',
  revision: g.__acc.revision,
  accounts: g.__acc.accounts,
  selections: {
    main: { scope: 'main', revision: 1, selection: { kind: 'ambient' } },
    lane: { scope: 'lane', revision: 1, selection: { kind: 'named', profileId: 'acct_work_0001' } },
  },
});
`;

const mocks = {
  'workspace:getInfo': { folders: [WS], activeFolder: WS },
  'workspace:switch': { success: true },
  'auth:getAuthStatus': { authMethod: 'apiKey', hasApiKey: true, availableProviders: [], anthropicProviderId: null },
  'config:get': {},
  'editor:detectTargets': { success: true, targets: [] },
  'cron:list': { jobs: [] },
  'gateway:listBindings': { bindings: [] },
  'memory:list': { memories: [], total: 0 },
  'provider:listAccounts': `function(p){ ${snapshotJs} return { ok: true, snapshot: globalThis.__snap() }; }`,
  'provider:getAccountStatus': `function(p){ ${snapshotJs}
     const a = globalThis.__acc.accounts.find(x => x.profileId === p.profileId);
     const op = globalThis.__ops && globalThis.__ops[p.profileId];
     return op ? { ok: true, account: a, operation: op } : { ok: true, account: a }; }`,
  'provider:startAccountSignIn': `function(p){ ${snapshotJs}
     g.__ops = g.__ops || {};
     const a = g.__acc.accounts.find(x => x.profileId === p.profileId);
     a.state = 'pending'; a.revision += 1; g.__acc.revision += 1;
     const operation = { operationId: 'op_' + p.profileId, kind: 'sign-in' };
     g.__ops[p.profileId] = operation;
     const res = { ok: true, snapshot: g.__snap(), operation };
     if (p.profileId === 'acct_client_0002') {
       res.fallback = { platform: 'win32', script: 'cd "%USERPROFILE%" && set CLAUDE_CONFIG_DIR=C:\\\\fake\\\\profile && claude auth login --example-harmless-fake-script' };
     }
     return res; }`,
  'provider:cancelAccountSignIn': `function(p){ ${snapshotJs}
     const a = g.__acc.accounts.find(x => x.profileId === p.profileId);
     a.state = 'cancelled'; a.revision += 1; g.__acc.revision += 1; if (g.__ops) delete g.__ops[p.profileId];
     return { ok: true, snapshot: g.__snap() }; }`,
  'session:list': `function(p){
     const now = Date.now();
     const mk = (id, name, extra) => Object.assign({ id, name, messageCount: 12, createdAt: now - 86400000, lastActivityAt: now - 3600000, isActive: false, hasTranscript: true }, extra || {});
     return { sessions: [
       mk('11111111-1111-4111-8111-111111111111', 'Refactor the billing module', { accountProfileId: 'acct_work_0001' }),
       mk('22222222-2222-4222-8222-222222222222', 'Investigate flaky tests', { accountProfileId: 'acct_client_0002' }),
       mk('33333333-3333-4333-8333-333333333333', 'Draft release notes'),
       mk('44444444-4444-4444-8444-444444444444', 'Old session with removed profile', { accountProfileId: 'acct_gone_9999' }),
     ], total: 4, hasMore: false }; }`,
};

async function launch() {
  const udd = fs.mkdtempSync(path.join(os.tmpdir(), 'ptah-vr-udd-'));
  const db = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ptah-vr-db-')), 'vr.sqlite');
  const env = { ...process.env, NODE_ENV: 'test', PTAH_E2E: '1', PTAH_DB_PATH: db };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await _electron.launch({
    args: [entry, `--user-data-dir=${udd}`, '--window-size=1500,950'],
    env,
    timeout: 60000,
  });
  const win = await app.firstWindow({ timeout: 60000 });
  await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; w.setSize(1400, 900); w.center(); });
  await win.waitForURL((u) => u.protocol === 'file:' && u.pathname.endsWith('/renderer/index.html'), { timeout: 60000 });
  return { app, win };
}

async function installRpc(app, win) {
  await app.evaluate(({ ipcMain, BrowserWindow }) => {
    const g = globalThis;
    g.__uiMockStatics = {};
    g.__uiMockFns = {};
    g.__uiObserved = [];
    ipcMain.removeAllListeners('rpc');
    ipcMain.on('rpc', (event, message) => {
      if (!message || typeof message !== 'object') return;
      const d = message.payload || message;
      const method = d.method;
      if (!method) return;
      g.__uiObserved.push({ method, params: d.params });
      const id = d.correlationId || d.requestId || '';
      let data = { jobs: [], bindings: [], candidates: [], entries: [], guilds: [] };
      if (g.__uiMockFns[method]) data = new Function('p', `return (${g.__uiMockFns[method]})(p);`)(d.params);
      else if (method in g.__uiMockStatics) data = g.__uiMockStatics[method];
      const w = BrowserWindow.fromWebContents(event.sender) || BrowserWindow.getAllWindows()[0];
      w?.webContents.send('to-renderer', { type: 'rpc:response', correlationId: id, success: true, data });
    });
  });
  const statics = {};
  const fns = {};
  for (const [k, v] of Object.entries(mocks)) (typeof v === 'string' ? fns : statics)[k] = v;
  await app.evaluate((_e, pl) => {
    Object.assign(globalThis.__uiMockStatics, pl.statics);
    Object.assign(globalThis.__uiMockFns, pl.fns);
  }, { statics, fns });
  await app.evaluate(({ ipcMain }, cfg) => {
    ipcMain.removeAllListeners('get-startup-config');
    ipcMain.on('get-startup-config', (e) => { e.returnValue = cfg; });
  }, { initialView: 'chat', workspaceRoot: WS, workspaceName: 'ptah-e2e-ws' });
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.webContents.reload());
  await win.waitForLoadState('domcontentloaded');
  await win.locator('ptah-electron-shell').waitFor({ state: 'visible', timeout: 60000 });
}

const push = (app, msg) =>
  app.evaluate(({ BrowserWindow }, m) => BrowserWindow.getAllWindows()[0]?.webContents.send('to-renderer', m), msg);

async function setTheme(win, theme) {
  await win.evaluate((t) => {
    document.documentElement.setAttribute('data-theme', t);
    document.documentElement.setAttribute('data-theme-mode', t.includes('light') ? 'light' : 'dark');
  }, THEMES[theme]);
  await win.waitForTimeout(250);
}

async function shot(win, name, locator) {
  const file = path.join(OUT, `${label}-${name}.png`);
  if (locator) await locator.screenshot({ path: file });
  else await win.screenshot({ path: file });
  log('shot', path.basename(file));
  return file;
}

async function both(win, base, locator) {
  for (const theme of Object.keys(THEMES)) {
    await setTheme(win, theme);
    await shot(win, `${base}-${theme}`, locator ? locator() : undefined);
  }
  await setTheme(win, 'dark');
}

async function gotoSettings(app, win) {
  await push(app, { type: 'workspaceChanged', payload: {} });
  for (let i = 0; i < 20; i++) {
    await push(app, { type: 'switchView', payload: { view: 'settings' } });
    if (await win.locator('ptah-providers-settings').count()) break;
    await win.waitForTimeout(700);
  }
  await win.locator('ptah-providers-settings').waitFor({ state: 'visible', timeout: 20000 });
}

async function scenesAccounts(app, win) {
  await gotoSettings(app, win);
  const section = win.locator('[data-testid="accounts-section"]');
  await section.waitFor({ state: 'visible', timeout: 20000 });
  await win.waitForTimeout(600);
  await section.scrollIntoViewIfNeeded();
  // Screen 3: accounts section with two+ named accounts
  const secText = await section.innerText();
  fs.writeFileSync(path.join(OUT, `${label}-accounts-section-text.txt`), secText);
  await both(win, 's3-accounts-section', () => section);
  await shot(win, 's3-accounts-section-fullpage-dark');
  const held = await win.locator('[data-testid="routing-held"]').count();
  log('routing-held count', held);

  // Screen 1: drawer, sign-in pending (with window) for the first not-signed-in account
  await win.locator(`[data-testid="account-${A2}"]`).scrollIntoViewIfNeeded();
  const openDrawerFor = async (id) => {
    await win.locator(`[data-testid="account-${id}"]`).evaluate((e) => e.click());
    await win.locator('[data-testid="account-drawer"]').waitFor({ state: 'visible', timeout: 10000 });
    await win.locator('[data-testid="account-tab-access"]').evaluate((e) => e.click());
    await win.waitForTimeout(300);
  };
  // pending with window = "Personal"
  await openDrawerFor('acct_other_0003');
  await win.locator('[data-testid="account-sign-in"]').evaluate((e) => e.click());
  await win.waitForTimeout(900);
  const drawer = () => win.locator('[data-testid="account-drawer"]');
  fs.writeFileSync(path.join(OUT, `${label}-s1-access-text.txt`), await drawer().innerText());
  await both(win, 's1-drawer-pending', () => win.locator('[data-testid="account-drawer"]'));
  await shot(win, 's1-drawer-pending-fullpage-dark');
  await win.keyboard.press('Escape');
  await win.waitForTimeout(400);

  // Screen 2: fallback block (long label account)
  if (!(await win.locator('[data-testid="account-drawer"]').count())) {
    await openDrawerFor(A2);
  } else {
    await win.locator('[data-testid="account-drawer"]').waitFor({ state: 'visible' });
  }
  const signInBtn = win.locator('[data-testid="account-sign-in"]');
  if (await signInBtn.count()) await signInBtn.evaluate((e) => e.click());
  await win.waitForTimeout(900);
  fs.writeFileSync(path.join(OUT, `${label}-s2-access-text.txt`), await drawer().innerText());
  const hasFallback = await win.locator('[data-testid="account-fallback"]').count();
  log('fallback block count', hasFallback);
  await both(win, 's2-drawer-fallback', () => win.locator('[data-testid="account-drawer"]'));
  if (hasFallback) {
    // Focus pass: Tab through the fallback controls.
    const copyBtn = win.locator('[data-testid="account-fallback-copy-button"]');
    await copyBtn.focus();
    await shot(win, 's2-focus-copy-dark');
    await setTheme(win, 'light');
    await shot(win, 's2-focus-copy-light');
    await win.keyboard.press('Tab');
    await shot(win, 's2-focus-after-copy-light');
    await win.locator('[data-testid="account-fallback-check-status"]').focus();
    await shot(win, 's2-focus-check-status-light');
    await setTheme(win, 'dark');
    await shot(win, 's2-focus-check-status-dark');
    await copyBtn.click();
    await win.waitForTimeout(500);
    await shot(win, 's2-copied-dark');
    const info = await win.evaluate(() => {
      const q = (s) => document.querySelector(`[data-testid="${s}"]`);
      const rect = (el) => el && (({ width, height }) => ({ width, height }))(el.getBoundingClientRect());
      const cs = (el) => el && getComputedStyle(el);
      const script = q('account-fallback-script');
      const drawer = q('account-drawer');
      return {
        copyBtn: rect(q('account-fallback-copy-button')),
        checkBtn: rect(q('account-fallback-check-status')),
        scriptOverflowX: script && script.scrollWidth > script.clientWidth,
        drawerHScroll: drawer && drawer.scrollWidth > drawer.clientWidth,
        copyStatus: q('account-fallback-copy-status')?.textContent,
        accessDetail: q('account-access-detail')?.textContent,
        scriptTabindex: script?.getAttribute('tabindex'),
        scriptColor: script && cs(script).color,
        scriptBg: script && cs(script).backgroundColor,
        doc: { sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth },
      };
    });
    fs.writeFileSync(path.join(OUT, `${label}-s2-measure.json`), JSON.stringify(info, null, 2));
  }
  await win.keyboard.press('Escape');
}

async function scenesSessions(app, win) {
  await push(app, { type: 'workspaceChanged', payload: {} });
  await push(app, { type: 'switchView', payload: { view: 'chat' } });
  const tab = win.getByRole('tab', { name: 'Chat' }).or(win.locator('[title="Chat"]')).first();
  await tab.waitFor({ state: 'visible', timeout: 20000 });
  await tab.click({ force: true });
  await win.locator('[data-testid="canvas-grid"]').waitFor({ state: 'visible', timeout: 20000 });
  // Warm account snapshot so session rows can resolve labels.
  await win.waitForTimeout(800);
  const trigger = win.locator('[data-testid="rail-previous-sessions"]').first();
  await trigger.waitFor({ state: 'visible', timeout: 20000 });
  await trigger.click();
  await win.locator('li[ptah-session-list-row]').first().waitFor({ state: 'visible', timeout: 20000 });
  await win.waitForTimeout(800);
  const rows = await win.locator('[data-testid="session-row-account"]').allInnerTexts();
  log('session-row-account', JSON.stringify(rows));
  fs.writeFileSync(path.join(OUT, `${label}-s5-row-text.txt`), rows.join('\n'));
  const dialog = win.locator('#previous-sessions-dialog, [role="dialog"]').first();
  await both(win, 's5-session-list');
  await shot(win, 's5-session-list-fullpage-dark');
  const geom = await win.evaluate(() => {
    const out = [];
    document.querySelectorAll('li[ptah-session-list-row]').forEach((li) => {
      const meta = li.querySelector('[data-testid="session-row-meta"]');
      const acc = li.querySelector('[data-testid="session-row-account"]');
      out.push({
        metaScrollW: meta?.scrollWidth, metaClientW: meta?.clientWidth,
        accText: acc?.textContent, accTitle: acc?.getAttribute('title'),
        accTruncated: acc ? acc.scrollWidth > acc.clientWidth : null,
        liH: li.getBoundingClientRect().height,
      });
    });
    return out;
  });
  fs.writeFileSync(path.join(OUT, `${label}-s5-geometry.json`), JSON.stringify(geom, null, 2));
}


async function scenesLanes(app, win) {
  await push(app, { type: 'workspaceChanged', payload: {} });
  await push(app, { type: 'switchView', payload: { view: 'chat' } });
  const tab = win.getByRole('tab', { name: 'Chat' }).or(win.locator('[title="Chat"]')).first();
  await tab.waitFor({ state: 'visible', timeout: 20000 });
  await tab.click({ force: true });
  await win.locator('[data-testid="canvas-grid"]').waitFor({ state: 'visible', timeout: 20000 });
  await win.getByText('Refactor the billing module').first().click({ force: true });
  await win.waitForTimeout(2500);
  const mkBinding = (id) => ({ version: 1, provider: 'claude', profileId: id, routeRevision: 1, routeFingerprint: 'f'.repeat(40), authEpoch: 1, runId: 'run_' + id, identity: { kind: 'unknown' } });
  const base = (n, task, extra) => ({ parentSessionId: '11111111-1111-4111-8111-111111111111', agentId: 'agent-lane-' + n, cli: 'claude', task, workingDirectory: WS, status: 'running', startedAt: new Date().toISOString(), model: 'claude-sonnet-4-5', ...extra });
  const agents = [
    base(1, 'Lane with named account', { accountBinding: mkBinding('acct_work_0001') }),
    base(2, 'Lane with long account label', { accountBinding: mkBinding('acct_client_0002') }),
    base(3, 'Lane on default route'),
    base(4, 'Lane with removed account', { accountBinding: mkBinding('acct_gone_9999') }),
  ];
  for (const a of agents) await push(app, { type: 'agent-monitor:spawned', payload: a });
  await win.waitForTimeout(1500);
  await win.locator('ptah-agent-card-header').first().waitFor({ state: 'attached', timeout: 3000 }).catch(async () => {
    await win.getByText('CLI lane').first().click({ force: true });
    await win.waitForTimeout(1500);
    await shot(win, 's4-after-click-dark');
  });
  if (!(await win.locator('ptah-agent-card-header').count())) {
    await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; w.setSize(2600, 1000); w.setPosition(0, 0); });
    await win.waitForTimeout(1500);
    await shot(win, 's4-wide-dark');
    log('card-header count after widen', await win.locator('ptah-agent-card-header').count());
  }
  const badge = win.locator('[data-testid="lane-account"]');
  log('lane-account count', await badge.count());
  const texts = await badge.allInnerTexts();
  fs.writeFileSync(path.join(OUT, `${label}-s4-lane-text.txt`), texts.join('\n') + '\n---\n' + (await win.locator('ptah-agent-card-header').allInnerTexts()).join('\n==\n'));
  await both(win, 's4-lanes');
  const geom = await win.evaluate(() => Array.from(document.querySelectorAll('ptah-agent-card-header')).map((h) => {
    const b = h.querySelector('[data-testid="lane-account"]');
    const row = b?.parentElement;
    return {
      text: b?.textContent?.trim(), title: b?.getAttribute('title'),
      badgeW: b?.getBoundingClientRect().width, truncated: b ? (b.querySelector('.truncate')?.scrollWidth > b.querySelector('.truncate')?.clientWidth) : null,
      rowOverflow: row ? row.scrollWidth > row.clientWidth : null,
      headerH: h.getBoundingClientRect().height,
    };
  }));
  fs.writeFileSync(path.join(OUT, `${label}-s4-geometry.json`), JSON.stringify(geom, null, 2));
}

(async () => {
  const { app, win } = await launch();
  win.on('pageerror', (e) => log('pageerror', String(e).slice(0, 200)));
  try {
    await installRpc(app, win);
    for (const [name, fn] of [['accounts', scenesAccounts], ['sessions', scenesSessions], ['lanes', scenesLanes]]) {
      if (only && !only.includes(name)) continue;
      try {
        await fn(app, win);
      } catch (e) {
        log(`SCENE ${name} FAILED`, String(e).slice(0, 600));
        try { await shot(win, `${name}-FAILED-dark`); } catch {}
      }
    }
  } finally {
    await app.close().catch(() => {});
  }
})();
