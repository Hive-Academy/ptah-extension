// Capture populated attention UI from the built Electron app. See shoot-populated-plan.md.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { _electron } = require('@playwright/test');

const root = path.resolve(__dirname, '../../../../');
const entry = path.join(root, 'dist/apps/ptah-electron/main.mjs');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'ptah-attention-populated-'));
const workspace = path.join(temp, 'workspace');
const output = path.join(__dirname, 'capture-results-2.json');
const results = { entry, workspace, port: 9347, shots: [], steps: [], errors: [], limitations: [], snackbarStyle: {} };
let app;
let appProcess;
let pid;
let page;
let generation = 0;
const live = new Map();

const portFree = () => new Promise(resolve => {
  const server = net.createServer();
  server.once('error', () => resolve(false));
  server.listen(9347, '127.0.0.1', () => server.close(() => resolve(true)));
});
const record = async (name, action) => {
  try { const notes = await action(); results.steps.push({ name, ok: true, notes }); return { ok: true, value: notes }; }
  catch (error) { const message = String(error?.stack || error); results.steps.push({ name, ok: false, notes: message }); results.errors.push(`${name}: ${message}`); return { ok: false, error: message }; }
};
const send = async message => app.evaluate(({ BrowserWindow }, msg) => {
  const win = BrowserWindow.getAllWindows()[0];
  if (!win || win.isDestroyed()) throw Error('Electron renderer window missing');
  win.webContents.send('to-renderer', msg);
}, message);
const notice = (kind, name) => ({
  key: `visual:${name}`, generation: ++generation, kind,
  title: kind === 'permission' ? 'Permission: Bash' : kind === 'question' ? 'Question needs an answer' : 'Lane permission: Bash',
  occurredAt: Date.now(), target: null,
});
async function project(kind, name) {
  const value = notice(kind, name);
  await send({ type: 'attention:changed', payload: { change: 'upsert', notice: value } });
  live.set(value.key, value.generation);
}
async function clearRequests() {
  for (const [key, lastGeneration] of live) {
    await send({ type: 'attention:changed', payload: { change: 'resolve', key, generation: lastGeneration } });
  }
  live.clear();
}
async function rawRequest(kind) {
  const id = crypto.randomUUID();
  const base = { id, timestamp: Date.now(), timeoutAt: Date.now() + 120000 };
  if (kind === 'permission') await send({ type: 'permission:request', payload: {
    ...base, toolName: 'Bash', toolInput: { command: 'git status' }, description: 'Run git status',
  } });
  if (kind === 'question') await send({ type: 'ask-user-question:request', payload: {
    ...base, toolName: 'AskUserQuestion', questions: [{ question: 'Which option should I use?', header: 'Choice', options: [{ label: 'A', description: 'First option' }, { label: 'B', description: 'Second option' }], multiSelect: false }],
  } });
  if (kind === 'lane') {
    await send({ type: 'agent-monitor:permission-request', payload: {
      requestId: id, agentId: `visual-agent-${id}`, kind: 'shell', toolName: 'Bash',
      toolArgs: JSON.stringify({ command: 'git status' }), description: 'Run git status',
      timestamp: Date.now(), timeoutAt: Date.now() + 120000,
    } });
    // An agent-monitor:spawned event is needed for this request to enter a lane's queue.
    results.limitations.push('Raw lane permission has no live agent; attention:changed projects the same kind for capture.');
  }
  if (kind === 'permission') await send({ type: 'permission:auto-resolved', payload: { id, toolName: 'Bash' } });
  if (kind === 'question') await send({ type: 'ask-user-question:auto-resolved', payload: { id, answers: {} } });
}
async function failure() {
  await send({ type: 'voice:providerError', payload: {
    direction: 'tts', providerId: 'cloud', category: 'network', message: 'Voice provider unavailable',
  } });
}
async function waitText(text) { await page.getByText(text, { exact: false }).first().waitFor({ timeout: 5000 }); }
async function assertChatBoard() {
  await page.getByRole('button', { name: 'New session', exact: true }).first().waitFor({ state: 'visible', timeout: 30000 });
  if ((await page.evaluate(() => window.innerWidth)) > 900)
    await page.getByText('Sessions', { exact: true }).first().waitFor({ state: 'visible', timeout: 30000 });
  else
    await page.locator('[data-testid="notification-center-bell"]').waitFor({ state: 'visible', timeout: 30000 });
  if (await page.getByText('Welcome to Ptah Desktop').isVisible().catch(() => false)) {
    throw Error('Workspace did not open: Welcome / Open Folder screen remains visible');
  }
}
async function assertTheme(theme) {
  const actual = await page.evaluate(() => ({ theme: document.documentElement.dataset.theme, mode: document.documentElement.dataset.themeMode }));
  const expected = theme === 'dark' ? 'anubis' : 'anubis-light';
  if (actual.theme !== expected || actual.mode !== theme) throw Error(`Theme mismatch: expected ${expected}/${theme}, got ${actual.theme}/${actual.mode}`);
}
async function closeThemeMenu() {
  const selector = 'ptah-theme-toggle .dropdown-content';
  if (!(await page.locator(selector).first().isVisible().catch(() => false))) return;
  await page.keyboard.press('Escape');
  // DaisyUI focus dropdown may remain open while its trigger keeps focus.
  await page.locator('body').click({ position: { x: 8, y: 8 } });
  await page.waitForFunction(value => {
    const el = document.querySelector(value);
    if (!el) return true;
    const style = getComputedStyle(el);
    const box = el.getBoundingClientRect();
    return style.display === 'none' || style.visibility === 'hidden' || box.width === 0 || box.height === 0;
  }, selector, { timeout: 5000 });
}
async function capture(theme, name, check, notes = '') {
  const file = path.join(__dirname, `${theme}-${name}.png`);
  try {
    if (fs.existsSync(file)) fs.unlinkSync(file);
    await assertChatBoard();
    await assertTheme(theme);
    await closeThemeMenu();
    if (check) await check();
    if (name.startsWith('snackbar-') || name === '800') {
      await page.waitForTimeout(300);
      results.snackbarStyle[`${theme}-${name}`] = await page.locator('.snackbar-card').first().evaluate(card => {
        const ancestors = [];
        for (let node = card; node; node = node.parentElement) {
          const style = getComputedStyle(node);
          ancestors.push({ element: node.tagName.toLowerCase(), className: String(node.className), opacity: style.opacity });
        }
        const style = getComputedStyle(card);
        return { backgroundColor: style.backgroundColor, opacity: style.opacity, ancestors };
      });
    }
    await page.screenshot({ path: file, fullPage: true, animations: 'disabled' });
    results.shots.push({ file, ok: true, notes, viewport: page.viewportSize(), theme });
  } catch (error) {
    const message = String(error?.stack || error);
    results.shots.push({ file, ok: false, notes: `${notes} ${message}`.trim(), viewport: page?.viewportSize(), theme });
    results.errors.push(`${path.basename(file)}: ${message}`);
  }
}
async function chooseTheme(theme) {
  const name = theme === 'dark' ? 'anubis' : 'anubis-light';
  await closeThemeMenu();
  const toggle = page.locator('ptah-theme-toggle:visible').first();
  await toggle.locator('[aria-label="Change theme"]').click();
  const option = toggle.locator(`.dropdown-content button[data-theme="${name}"]`);
  if (await option.isVisible().catch(() => false)) {
    await option.click({ timeout: 1500 }).catch(() => option.evaluate(button => button.click()));
  } else {
    // DaisyUI's focus dropdown can hide before Playwright's actionability check.
    // A DOM click still invokes the picker's selectTheme -> ThemeService.setTheme.
    await option.evaluate(button => button.click());
  }
  await page.waitForFunction(([value, mode]) => {
    const root = document.documentElement;
    return root.dataset.theme === value && root.dataset.themeMode === mode;
  }, [name, theme], { timeout: 10000 });
  await closeThemeMenu();
  await assertTheme(theme);
}
async function closePanel() {
  const panel = page.locator('[data-testid="notification-center-panel"]');
  if (await panel.isVisible().catch(() => false)) {
    await page.locator('[data-testid="notification-center-bell"]').click();
    await panel.waitFor({ state: 'hidden', timeout: 5000 });
  }
}
async function createSessionTab() {
  const cards = page.locator('[data-rail-card][data-tab-id]');
  const before = await cards.evaluateAll(nodes => nodes.map(node => node.getAttribute('data-tab-id')));
  await page.getByRole('button', { name: 'New session', exact: true }).first().click();
  const popover = page.locator('[data-testid="canvas-new-session-popover"]');
  await popover.waitFor({ state: 'visible', timeout: 10000 });
  const nameInput = popover.getByRole('textbox', { name: 'Session name (optional)' });
  await nameInput.fill('Attention capture');
  await popover.getByRole('button', { name: 'Create', exact: true }).click();
  await page.waitForFunction(existing => [...document.querySelectorAll('[data-rail-card][data-tab-id]')]
    .some(node => node.getAttribute('data-tab-id') && !existing.includes(node.getAttribute('data-tab-id'))), before, { timeout: 15000 });
  const after = await cards.evaluateAll(nodes => nodes.map(node => node.getAttribute('data-tab-id')));
  const tabId = after.find(id => id && !before.includes(id));
  if (!tabId || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(tabId)) {
    throw Error(`New canvas tab has no UUID v4 tab ID: ${JSON.stringify(after)}`);
  }
  return tabId;
}
async function captureLivePermission(theme, tabId) {
  const id = crypto.randomUUID();
  const file = path.join(__dirname, `${theme}-panel-permission-live.png`);
  try {
    await send({ type: 'permission:request', payload: {
      id, tabId, toolName: 'Bash', toolInput: { command: 'git status' },
      description: 'Run git status', timestamp: Date.now(), timeoutAt: Date.now() + 120000,
    } });
    await page.locator('[data-testid="notification-center-bell"]').click();
    await capture(theme, 'panel-permission-live', async () => {
      const panel = page.locator('[data-testid="notification-center-panel"]');
      await panel.waitFor({ state: 'visible', timeout: 5000 });
      const row = panel.locator('section[aria-labelledby="ptah-needs-you-heading"] .notification-row')
        .filter({ hasText: 'Permission: Bash' }).first();
      await row.waitFor({ state: 'visible', timeout: 10000 });
      for (const label of ['Allow', 'Deny', 'Show in canvas']) {
        const button = row.getByRole('button', { name: `${label} Permission: Bash`, exact: true });
        await button.waitFor({ state: 'visible', timeout: 5000 });
        if (!(await button.isEnabled())) throw Error(`${label} is disabled on live permission`);
      }
    }, `real permission:request routed to canvas tab ${tabId}; Needs you row captured in bell panel`);
  } catch (error) {
    if (fs.existsSync(file)) fs.unlinkSync(file);
    const message = String(error?.stack || error);
    results.shots.push({ file, ok: false, notes: `live permission setup: ${message}`, viewport: page.viewportSize(), theme });
    results.errors.push(`${path.basename(file)}: ${message}`);
  } finally {
    try { await send({ type: 'permission:auto-resolved', payload: { id, toolName: 'Bash' } }); }
    catch (error) { results.errors.push(`resolve live permission: ${String(error?.stack || error)}`); }
    try { await closePanel(); }
    catch (error) { results.errors.push(`close live permission panel: ${String(error?.stack || error)}`); }
  }
}
async function eachTheme(theme, tabId) {
  await record(`${theme}: theme`, () => chooseTheme(theme));
  await record(`${theme}: 1440x900`, () => page.setViewportSize({ width: 1440, height: 900 }));
  await record(`${theme}: close panel`, closePanel);
  await record(`${theme}: clear projected requests`, clearRequests);
  for (const [kind, suffix] of [['permission', 'permission'], ['question', 'question'], ['lane-permission', 'lane']]) {
    await record(`${theme}: reset ${suffix}`, clearRequests);
    await record(`${theme}: raw ${suffix}`, () => rawRequest(suffix));
    await record(`${theme}: project ${suffix}`, () => project(kind, `${theme}-${suffix}`));
    await capture(theme, `snackbar-${suffix}`, () => page.locator('.snackbar-card').first().waitFor({ timeout: 5000 }),
      'attention:changed projection; raw request also sent for permission/question');
  }
  await record(`${theme}: clear before failure`, clearRequests);
  await record(`${theme}: voice provider error`, failure);
  await capture(theme, 'snackbar-failure', () => waitText('Text-to-speech failed'), 'voice:providerError produces a recent failure');
  await record(`${theme}: stack projections`, async () => {
    for (let i = 0; i < 5; i++) await project(['permission', 'question', 'lane-permission'][i % 3], `${theme}-stack-${i}`);
  });
  await capture(theme, 'snackbar-stack', () => page.locator('.snackbar-more').waitFor({ timeout: 5000 }), 'five live projections plus voice failure');
  await capture(theme, 'bell-badge', () => page.locator('[data-testid="notification-count-badge"]').waitFor({ timeout: 5000 }));
  await record(`${theme}: open panel`, async () => {
    await page.locator('[data-testid="notification-center-bell"]').click();
    await page.locator('[data-testid="notification-center-panel"]').waitFor({ state: 'visible', timeout: 5000 });
  });
  await capture(theme, 'panel', () => page.locator('[data-testid="notification-center-panel"] .notification-row').first().waitFor({ state: 'visible', timeout: 5000 }));
  await record(`${theme}: clear recent notices`, () => page.locator('[data-testid="notification-center-panel"]').getByRole('button', { name: 'Clear all notices', exact: true }).click());
  await capture(theme, 'panel-clear-all', async () => {
    const panel = page.locator('[data-testid="notification-center-panel"]');
    const needsYou = panel.locator('section[aria-labelledby="ptah-needs-you-heading"]');
    const recent = panel.locator('section[aria-labelledby="ptah-recent-heading"]');
    await needsYou.locator('.notification-row').first().waitFor({ state: 'visible', timeout: 5000 });
    await recent.getByText('No recent notices', { exact: true }).waitFor({ state: 'visible', timeout: 5000 });
    if (await recent.locator('.notification-row').count()) throw Error('Recent notices remained after Clear all notices');
  }, 'live request projections remain; recent failure cleared');
  await record(`${theme}: resolve live requests`, clearRequests);
  await capture(theme, 'panel-empty', () => waitText('All clear'), 'after resolving live requests and clearing recent notices');
  await record(`${theme}: close panel after clear`, closePanel);
  await record(`${theme}: verify panel closed for 800px`, () => page.locator('[data-testid="notification-center-panel"]').waitFor({ state: 'hidden', timeout: 5000 }));
  await record(`${theme}: 800px request`, () => project('permission', `${theme}-800`));
  await record(`${theme}: 800x900`, () => page.setViewportSize({ width: 800, height: 900 }));
  await capture(theme, '800', () => page.locator('.snackbar-card').first().waitFor({ timeout: 5000 }));
  await record(`${theme}: restore 1440x900`, () => page.setViewportSize({ width: 1440, height: 900 }));
  await record(`${theme}: final reset`, clearRequests);
  if (tabId) await record(`${theme}: live permission`, () => captureLivePermission(theme, tabId));
  else {
    const file = path.join(__dirname, `${theme}-panel-permission-live.png`);
    if (fs.existsSync(file)) fs.unlinkSync(file);
    results.shots.push({ file, ok: false,
      notes: 'No canvas tab UUID was created; a routed live permission cannot be injected.', viewport: page.viewportSize(), theme });
  }
}
async function main() {
  if (!fs.existsSync(entry)) throw Error(`Built entry missing: ${entry}`);
  if (!(await portFree())) throw Error('Port 9347 is already occupied');
  fs.mkdirSync(workspace, { recursive: true });
  fs.writeFileSync(path.join(workspace, 'README.md'), '# Attention visual workspace\n');
  execFileSync('git', ['init', '--quiet', workspace], { stdio: 'pipe' });
  const env = { ...process.env, HOME: temp, USERPROFILE: temp,
    APPDATA: path.join(temp, 'AppData', 'Roaming'), LOCALAPPDATA: path.join(temp, 'AppData', 'Local'),
    PTAH_DB_PATH: path.join(temp, 'state.sqlite'), PTAH_NO_DEVTOOLS: '1', NODE_ENV: 'test', PTAH_E2E: '1' };
  delete env.ELECTRON_RUN_AS_NODE;
  fs.mkdirSync(env.APPDATA, { recursive: true });
  fs.mkdirSync(env.LOCALAPPDATA, { recursive: true });
  // real-rpc-fixtures.ts:259-268 uses the first positional argv as workspace root.
  app = await _electron.launch({ args: [entry, workspace, `--user-data-dir=${path.join(temp, 'profile')}`, '--remote-debugging-port=9347'], env, timeout: 120000 });
  appProcess = app.process();
  pid = appProcess.pid;
  page = await app.firstWindow();
  await page.waitForURL(url => url.protocol === 'file:' && url.pathname.endsWith('/renderer/index.html'), { timeout: 120000 });
  await assertChatBoard();
  results.workspaceVisible = true;
  const session = await record('create canvas session tab', createSessionTab);
  const tabId = session.ok ? session.value : undefined;
  if (!tabId) results.limitations.push('Live permission screenshot unavailable: New Session did not yield a canvas tab UUID.');
  for (const theme of ['dark', 'light']) await record(`${theme}: capture sequence`, () => eachTheme(theme, tabId));
  results.limitations.push('Raw lane permission has no live agent; attention:changed projects the lane kind for capture.');
  results.limitations.push('A git:status-update refreshes Git UI; no routed git-status warning notice source was found.');
  results.limitations.push('The failed-turn screenshot uses a real voice:providerError because a new canvas tab has no backend Claude session/failed turn.');
}
(async () => {
  try { await main(); } catch (error) {
    results.errors.push(`main: ${String(error?.stack || error)}`);
    if (page) {
      await page.screenshot({ path: path.join(__dirname, 'debug-main-failure.png') }).catch(() => undefined);
      results.debugButtons = await page.getByRole('button').allInnerTexts().catch(e => [`buttons: ${e}`]);
      results.debugUrl = page.url();
    }
  }
  finally {
    if (app) try { await app.close(); } catch (error) { results.errors.push(`close: ${error}`); }
    // app.process() is invalid after close; only inspect the retained ChildProcess.
    if (pid && appProcess && appProcess.exitCode === null) {
      try { execFileSync('taskkill', ['/T', '/PID', String(pid), '/F'], { stdio: 'ignore' }); }
      catch (error) { if (appProcess.exitCode === null) results.errors.push(`taskkill ${pid}: ${error}`); }
    }
    try { results.portFreeAfter = await portFree(); }
    catch (error) { results.errors.push(`port check: ${error}`); }
    try { fs.rmSync(temp, { recursive: true, force: true }); results.tempRemoved = !fs.existsSync(temp); }
    catch (error) { results.errors.push(`cleanup: ${error}`); results.tempRemoved = false; }
    try { fs.writeFileSync(output, JSON.stringify(results, null, 2)); }
    catch (error) { results.errors.push(`write results: ${error}`); }
    process.stdout.write(`capture-results-2: ${results.shots.filter(shot => shot.ok).length}/${results.shots.length} shots, ${results.errors.length} errors, portFree=${results.portFreeAfter}, tempRemoved=${results.tempRemoved}\n`);
  }
})();
