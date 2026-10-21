// Electron visual review for TASK_2026_710. Run after `npx nx build-dev ptah-electron`:
//   node .ptah/specs/TASK_2026_710_ptah-glass-theme/shoot-electron.cjs
const { _electron } = require('playwright');
const fs = require('fs');
const os = require('os');
const path = require('path');

const root = path.resolve(__dirname, '..', '..', '..');
const entry = path.join(root, 'dist', 'apps', 'ptah-electron', 'main.mjs');
const out = path.join(__dirname, process.argv[2] ? 'shots-workspace' : 'shots');
fs.mkdirSync(out, { recursive: true });

const combos = [
  ['ptah-glass', 'dark', 'gold'],
  ['ptah-glass', 'dark', 'rose'],
  ['ptah-glass', 'dark', 'moonstone'],
  ['ptah-glass-light', 'light', 'gold'],
  ['ptah-glass-light', 'light', 'rose'],
  ['ptah-glass-light', 'light', 'moonstone'],
  ['dracula', 'dark', 'gold'],
  ['nord', 'light', 'gold'],
  ['lofi', 'light', 'gold'],
];

async function applyTheme(win, theme, mode, accent) {
  await win.evaluate(
    ([t, m, a]) => {
      const glass = ['ptah-glass', 'ptah-glass-light', 'dark', 'nord', 'cupcake', 'dracula'];
      const r = document.documentElement;
      r.setAttribute('data-theme', t);
      r.setAttribute('data-theme-mode', m);
      if (glass.includes(t)) {
        r.setAttribute('data-glass', 'on');
        r.setAttribute('data-glass-mode', m);
      } else {
        r.removeAttribute('data-glass');
        r.removeAttribute('data-glass-mode');
      }
      if (a === 'gold') r.removeAttribute('data-accent');
      else r.setAttribute('data-accent', a);
    },
    [theme, mode, accent],
  );
  await win.waitForTimeout(400);
}

(async () => {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ptah-shot-udd-'));
  const dbDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ptah-shot-db-'));
  const env = { ...process.env, NODE_ENV: 'test', PTAH_E2E: '1', PTAH_DB_PATH: path.join(dbDir, 'db.sqlite') };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await _electron.launch({ args: [entry, `--user-data-dir=${userDataDir}`, ...(process.argv[2] ? [process.argv[2]] : [])], env, timeout: 60000 });
  const win = await app.firstWindow({ timeout: 60000 });
  await win.waitForURL((u) => u.protocol === 'file:' && u.pathname.endsWith('/renderer/index.html'), { timeout: 60000 });
  await win.setViewportSize({ width: 1440, height: 900 }).catch(() => undefined);
  await win.waitForTimeout(4000);

  const boot = await win.evaluate(() => ({
    theme: document.documentElement.getAttribute('data-theme'),
    glass: document.documentElement.getAttribute('data-glass'),
    accent: document.documentElement.getAttribute('data-accent'),
  }));
  console.log('boot attributes', JSON.stringify(boot));
  await win.screenshot({ path: path.join(out, 'boot-default.png') });

  for (const [t, m, a] of combos) {
    await applyTheme(win, t, m, a);
    await win.screenshot({ path: path.join(out, `${t}-${a}-home.png`) });
  }

  // Settings screen, dark + light.
  const settings = win.locator('[aria-label*="Settings" i], [title*="Settings" i]').first();
  if (await settings.count()) {
    await settings.click().catch(() => undefined);
    await win.waitForTimeout(1500);
    for (const [t, m] of [['ptah-glass', 'dark'], ['ptah-glass-light', 'light']]) {
      await applyTheme(win, t, m, 'gold');
      await win.screenshot({ path: path.join(out, `${t}-settings.png`) });
    }
    await win.keyboard.press('Escape').catch(() => undefined);
  } else {
    console.log('settings control not found');
  }

  // Any open dropdown/modal: try the theme picker.
  const picker = win.locator('ptah-theme-toggle button, ptah-theme-toggle [role="button"]').first();
  if (await picker.count()) {
    for (const [t, m] of [['ptah-glass', 'dark'], ['ptah-glass-light', 'light']]) {
      await applyTheme(win, t, m, 'gold');
      await picker.click().catch(() => undefined);
      await win.waitForTimeout(600);
      await win.locator('ptah-theme-toggle .dropdown-content').evaluate((el) => el.scrollTo(0, el.scrollHeight)).catch(() => undefined);
      await win.waitForTimeout(300);
      await win.screenshot({ path: path.join(out, `${t}-theme-picker.png`) });
      await win.keyboard.press('Escape').catch(() => undefined);
    }
  } else {
    console.log('theme picker not found');
  }

  await app.close();
  console.log('shots in', out);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
