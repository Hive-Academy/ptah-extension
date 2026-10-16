/**
 * Batch 22 visual capture: Settings > Agent Orchestration > "Background Model Roles", dark + light.
 *
 * Usage:  node capture-orchestration-settings.cjs <worktreeRoot> <outDir> <prefix>
 *   worktreeRoot  worktree whose dist/apps/ptah-electron is built (before: 646-base-shots)
 *   outDir        folder for the PNGs
 *   prefix        file name prefix (before: "before", after: "after")
 *
 * Isolation (same as batch 8): temp HOME/USERPROFILE (so ~/.ptah is a throwaway), temp userData dir,
 * temp PTAH_DB_PATH, NODE_ENV=test, PTAH_E2E=1, temp workspace with a .ptah marker dir.
 * Nothing under the real profile is read or written. No build is run: the script only launches the
 * already built dist/apps/ptah-electron/main.mjs and closes it when done.
 *
 * Output files: <prefix>-<state>-<theme>.png with state in
 *   roles-viewport   window screenshot, roles section scrolled to the top of the viewport (rows closed)
 *   roles-rest       window screenshot scrolled to the bottom of the roles section (only when it is taller than the window)
 *   roles-section    element screenshot of the whole [data-testid="background-roles-details"] block (summary + all rows)
 *   roles-row-open   window screenshot with the "synthesis" row's reassign popover open
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createRequire } = require('module');

const root = path.resolve(process.argv[2]);
const outDir = path.resolve(process.argv[3]);
const prefix = process.argv[4] || 'shot';
const VIEWPORT = { width: 1100, height: 700 };
const OPEN_ROW = 'synthesis';

const req = createRequire(path.join(root, 'package.json'));
const { _electron } = req('@playwright/test');

async function main() {
  fs.mkdirSync(outDir, { recursive: true });
  const tmp = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'ptah-646-b22-')));
  const home = path.join(tmp, 'home');
  const udd = path.join(tmp, 'udd');
  const ws = path.join(tmp, 'ws');
  fs.mkdirSync(home, { recursive: true });
  fs.mkdirSync(udd, { recursive: true });
  fs.mkdirSync(path.join(ws, '.ptah'), { recursive: true }); // marker, stops workspace-root ascent to the real ~/.ptah

  const entry = path.join(root, 'dist', 'apps', 'ptah-electron', 'main.mjs');
  const env = {
    ...process.env,
    NODE_ENV: 'test',
    PTAH_E2E: '1',
    PTAH_DB_PATH: path.join(tmp, 'ptah.sqlite'),
    HOME: home,
    USERPROFILE: home,
  };
  delete env.ELECTRON_RUN_AS_NODE;

  const app = await _electron.launch({ args: [entry, `--user-data-dir=${udd}`, ws], env, timeout: 90_000 });
  console.log('electron pid:', app.process().pid);
  try {
    const page = await app.firstWindow({ timeout: 90_000 });
    await page.waitForURL((u) => u.protocol === 'file:' && u.pathname.endsWith('/renderer/index.html'), { timeout: 90_000 });
    await app.evaluate(({ BrowserWindow }, vp) => {
      const w = BrowserWindow.getAllWindows()[0];
      if (w.isMaximized()) w.unmaximize();
      w.setContentSize(vp.width, vp.height);
      w.center();
    }, VIEWPORT);
    await page.waitForTimeout(1500);
    console.log('actual viewport:', JSON.stringify(await page.evaluate(() => ({ w: window.innerWidth, h: window.innerHeight, dpr: window.devicePixelRatio }))));

    const shot = async (name, theme) => {
      const p = path.join(outDir, `${prefix}-${name}-${theme}.png`);
      await page.screenshot({ path: p });
      console.log('SHOT', p);
    };
    const log = (m) => console.log('[step]', m);

    async function setTheme(name) {
      await page.locator('[aria-label="Change theme"]').first().click();
      await page.locator(`button[data-theme="${name}"]`).first().click();
      await page.keyboard.press('Escape').catch(() => undefined);
      await page.mouse.click(5, 5).catch(() => undefined);
      await page.waitForTimeout(800);
      console.log('theme now:', await page.evaluate(() => document.documentElement.getAttribute('data-theme')));
    }

    // Navbar > Settings > "Agent Orchestration" tab > expand the "Background Model Roles" <details>.
    await page.locator('[data-test="config-menu-item-settings"]').waitFor({ state: 'visible', timeout: 60_000 });
    await page.locator('[data-test="config-menu-item-settings"]').click();
    await page.locator('[data-testid="settings-back"]').waitFor({ state: 'visible', timeout: 30_000 });
    await page.locator('ptah-settings').getByRole('button', { name: 'Agent Orchestration', exact: true }).click();
    log('agent orchestration tab');
    const details = page.locator('[data-testid="background-roles-details"]');
    await details.waitFor({ state: 'attached', timeout: 30_000 });
    if (!(await details.evaluate((d) => d.open))) await page.locator('[data-testid="background-roles-summary"]').click();
    await page.locator('[data-testid="provider-consumer-assignments"]').waitFor({ state: 'visible', timeout: 30_000 });
    // Rows render once their section read lands; wait for the open-row cell.
    await page
      .locator(`[data-testid="consumer-edit-${OPEN_ROW}"]`)
      .waitFor({ state: 'visible', timeout: 30_000 })
      .catch(() => log('WARN: open-row cell not visible'));
    await page.waitForTimeout(2500); // let the deferred CLI matrix chunk and the cold-boot catalog sync settle

    const rowIds = await page.locator('[data-testid^="consumer-row-"]').evaluateAll((els) => els.map((e) => e.getAttribute('data-testid')));
    console.log('consumer rows:', rowIds.length, JSON.stringify(rowIds));
    console.log('summary badge:', await page.locator('[data-testid="background-roles-summary"] .badge').first().innerText().catch(() => '?'));

    for (const [theme, themeName] of [['dark', 'anubis'], ['light', 'anubis-light']]) {
      await setTheme(themeName);
      await page.waitForTimeout(500);
      // Section scrolled so its summary row sits at the top of the viewport.
      await page.evaluate(() => {
        const s = document.querySelector('[data-testid="background-roles-summary"]');
        if (s) s.scrollIntoView({ block: 'start' });
      });
      await page.waitForTimeout(500);
      const box = await details.boundingBox();
      console.log(`[${theme}] details box:`, JSON.stringify(box));
      await shot('roles-viewport', theme);
      if (box && box.height > VIEWPORT.height - 40) {
        // Section taller than the window: scroll its bottom into view for a second shot.
        await page.evaluate(() => {
          const d = document.querySelector('[data-testid="background-roles-details"]');
          if (d) d.scrollIntoView({ block: 'end' });
        });
        await page.waitForTimeout(500);
        await shot('roles-rest', theme);
      }
      // Element screenshot of the whole block.
      const sp = path.join(outDir, `${prefix}-roles-section-${theme}.png`);
      await details.screenshot({ path: sp });
      console.log('SHOT', sp);

      // One row opened: the reassign popover of OPEN_ROW.
      await page.evaluate(() => {
        const s = document.querySelector('[data-testid="background-roles-summary"]');
        if (s) s.scrollIntoView({ block: 'start' });
      });
      const cell = page.locator(`[data-testid="consumer-edit-${OPEN_ROW}"]`);
      await cell.scrollIntoViewIfNeeded().catch(() => undefined);
      await cell.click();
      await page
        .locator(`[data-testid="consumer-editor-${OPEN_ROW}"]`)
        .waitFor({ state: 'visible', timeout: 10_000 })
        .catch(() => log('WARN: editor not visible'));
      await page.waitForTimeout(800);
      await shot('roles-row-open', theme);
      await page.keyboard.press('Escape').catch(() => undefined);
      await page.waitForTimeout(400);
      if (await page.locator(`[data-testid="consumer-editor-${OPEN_ROW}"]`).isVisible().catch(() => false)) {
        await page.keyboard.press('Escape').catch(() => undefined);
        await page.waitForTimeout(400);
      }
      console.log(`[${theme}] editor still open:`, await page.locator(`[data-testid="consumer-editor-${OPEN_ROW}"]`).isVisible().catch(() => false));
    }
  } finally {
    await app.close().catch(() => undefined);
    try {
      fs.rmSync(tmp, { recursive: true, force: true });
    } catch (e) {
      /* ignore */
    }
  }
}

main().catch((e) => {
  console.error('CAPTURE FAILED', e);
  process.exit(1);
});
