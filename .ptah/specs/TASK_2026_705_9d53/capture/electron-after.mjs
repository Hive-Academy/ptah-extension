// AFTER capture, Electron host. Private user-data dir; closes app at end.
import { _electron } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const WT = 'D:/projects/ptah-extension/.claude-worktrees/remove-single-layout';
const TASK = path.join(WT, '.ptah/specs/TASK_2026_705_9d53');
const OUT = path.join(TASK, 'screenshots/after');
const UDD = path.join(TASK, '.electron-userdata');
fs.mkdirSync(UDD, { recursive: true });

const env = {
  ...process.env,
  NODE_ENV: 'test',
  PTAH_E2E: '1',
  PTAH_DB_PATH: path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ptah-a4-db-')), 'b4.sqlite'),
};
delete env.ELECTRON_RUN_AS_NODE;

const app = await _electron.launch({
  args: [path.join(WT, 'dist/apps/ptah-electron/main.mjs'), path.resolve(WT), `--user-data-dir=${UDD}`],
  env,
  timeout: 60000,
});
try {
  const page = await app.firstWindow({ timeout: 60000 });
  await page.waitForURL((u) => u.protocol === 'file:' && u.pathname.endsWith('/renderer/index.html'), { timeout: 60000 });
  await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()[0];
    w.setContentSize(1424, 835); w.center();
  });

  const reload = async () => {
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.reload());
    await page.waitForLoadState('domcontentloaded');
    await page.locator('ptah-electron-shell').waitFor({ state: 'visible', timeout: 60000 });
    await page.waitForTimeout(2500);
  };
  const shot = async (name) => {
    await page.screenshot({ path: path.join(OUT, name), scale: 'css' });
    console.log('shot', name);
  };

  const push = (type, payload = {}) => app.evaluate(({ BrowserWindow }, msg) => {
    BrowserWindow.getAllWindows()[0]?.webContents.send('to-renderer', msg);
  }, { type, payload });
  const setState = (state) => app.evaluate(({ ipcMain, BrowserWindow }, st) => {
    ipcMain.emit('set-state', { sender: BrowserWindow.getAllWindows()[0]?.webContents }, st);
  }, state);
  const gotoChat = async () => {
    for (let i = 0; i < 20; i++) {
      await push('switchView', { view: 'chat' });
      await page.waitForTimeout(1000);
      const tab = page.getByRole('tab', { name: 'Chat' }).or(page.locator('[title="Chat"]')).first();
      if (await tab.isVisible().catch(() => false)) await tab.click({ force: true }).catch(() => {});
      if (await page.locator('[data-testid="canvas-grid"]').isVisible().catch(() => false)) break;
    }
    await page.waitForTimeout(1500);
  };
  const newSession = async () => {
    await page.locator('[data-testid="canvas-new-session-anchor"]').first().click();
    await page.getByRole('button', { name: 'Create', exact: true }).click();
    await page.waitForTimeout(1500);
  };

  for (const [themeKey, theme] of [['dark', 'anubis'], ['light', 'anubis-light']]) {
    for (const layout of ['grid', 'single-stored']) {
      await setState({ theme });
      await page.evaluate(([t, l]) => {
        localStorage.setItem('ptah-theme', t);
        localStorage.setItem('ptah-layout-mode', l === 'grid' ? 'grid' : 'single');
      }, [theme, layout]);
      await reload();
      for (let k = 0; k < 3 && (await page.evaluate(() => document.documentElement.getAttribute('data-theme'))) !== theme; k++) { await setState({ theme }); await page.evaluate((t) => localStorage.setItem('ptah-theme', t), theme); await reload(); }
      await gotoChat();
      const count = async () => (await page.locator('[data-testid="canvas-grid"]').count());
      if (layout === 'grid') {
        for (let i = 0; i < 2; i++) { try { await newSession(); } catch (e) { console.log('newSession fail', String(e).slice(0, 120)); } }
      }
      console.log(themeKey, layout, 'viewport', await page.evaluate(() => `${innerWidth}x${innerHeight}`),
        'tabbar', await page.locator('ptah-tab-bar').count(), 'toggleBtn', await page.getByRole('button', { name: /Toggle canvas grid/i }).count(), 'layoutKey', await page.evaluate(() => localStorage.getItem('ptah-layout-mode')), 'grid', await count(), 'data-theme', await page.evaluate(() => document.documentElement.getAttribute('data-theme')));
      await shot(`electron-${layout}-${themeKey}.png`);
    }
  }
} finally {
  await app.close().catch(() => {});
}
