/**
 * Batch 8 visual capture: Thoth > Skills > Library > Agents tab, dark + light.
 *
 * Usage:  node capture-agents-tab.cjs <worktreeRoot> <outDir> <prefix>
 *   worktreeRoot  worktree whose dist/apps/ptah-electron is built (before: 646-base-shots)
 *   outDir        folder for the PNGs
 *   prefix        file name prefix (before: "before", after: "after")
 *
 * Isolation: temp HOME/USERPROFILE (so ~/.ptah is a throwaway), temp userData dir,
 * temp PTAH_DB_PATH, and a temp workspace whose .claude/agents holds the seeded agents.
 * Nothing under the real profile is read or written.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createRequire } = require('module');

const root = path.resolve(process.argv[2]);
const outDir = path.resolve(process.argv[3]);
const prefix = process.argv[4] || 'shot';
// Requested content size. The OS may clamp it to the display work area; the ACTUAL size is logged and recorded in the report.
const VIEWPORT = { width: 1100, height: 700 };

const req = createRequire(path.join(root, 'package.json'));
const { _electron } = req('@playwright/test');

// Mirror of userLayerAgentDirName() in libs/shared/src/lib/types/user-layer-agents.ts
function userLayerAgentDirName(root) {
  const slashed = root.split('\\').join('/').replace(/\/+$/, '');
  const canonical = process.platform === 'win32' ? slashed.toLowerCase() : slashed;
  const seg = canonical.slice(canonical.lastIndexOf('/') + 1);
  const label =
    seg.toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/-+/g, '-').replace(/^[-.]+|[-.]+$/g, '').slice(0, 32) || 'ws';
  let high = 0x811c9dc5, low = 0xcbf29ce4;
  for (let i = 0; i < canonical.length; i += 1) {
    const c = canonical.charCodeAt(i);
    high = Math.imul(high ^ c, 0x01000193) >>> 0;
    low = Math.imul(low ^ (c + i), 0x01000021) >>> 0;
  }
  const hash = (high.toString(16).padStart(8, '0') + low.toString(16).padStart(8, '0')).slice(0, 16);
  return `${label}-${hash}`;
}

const AGENTS = [
  ['architect', 'Designs component boundaries and writes the implementation plan.', 'opus'],
  ['backend-developer', 'Writes server-side services, handlers and persistence code.', 'sonnet'],
  ['frontend-developer', 'Builds Angular components, templates and styling.', 'sonnet'],
  ['code-reviewer', 'Reviews a diff for correctness and repository conventions.', 'sonnet'],
];

async function main() {
  fs.mkdirSync(outDir, { recursive: true });
  const tmp = fs.realpathSync.native(
    fs.mkdtempSync(path.join(os.tmpdir(), 'ptah-646-shots-')),
  );
  const home = path.join(tmp, 'home');
  const udd = path.join(tmp, 'udd');
  const ws = path.join(tmp, 'ws');
  fs.mkdirSync(home, { recursive: true });
  fs.mkdirSync(udd, { recursive: true });
  fs.mkdirSync(path.join(ws, '.claude', 'agents'), { recursive: true });
  // Marker so resolveHarnessWorkspaceRoot() stops at ws instead of ascending to the real ~/.ptah ancestor.
  fs.mkdirSync(path.join(ws, '.ptah'), { recursive: true });
  for (const [name, desc, model] of AGENTS) {
    fs.writeFileSync(
      path.join(ws, '.claude', 'agents', `${name}.md`),
      `---\nname: ${name}\ndescription: ${desc}\nmodel: ${model}\n---\n\nYou are the ${name} agent. ${desc}\n`,
    );
  }

  // Seed the user-layer agent clones (the Library > Agents list) directly:
  // <HOME>/.ptah/user/agents/<workspace key>/<slug>.md + <slug>.ptah-origin.json
  const wsKey = userLayerAgentDirName(ws);
  const agentsRoots = [
    path.join(home, '.ptah', 'user', 'agents', wsKey),
    path.join(home, '.ptah', 'user', 'agents'), // unscoped root, used when no workspace key is supplied
  ];
  for (const agentsRoot of agentsRoots) {
  fs.mkdirSync(agentsRoot, { recursive: true });
  AGENTS.forEach(([name, desc, model], i) => {
    fs.writeFileSync(
      path.join(agentsRoot, `${name}.md`),
      `---
name: ${name}
description: ${desc}
model: ${model}
---

You are the ${name} agent. ${desc}
`,
    );
    fs.writeFileSync(
      path.join(agentsRoot, `${name}.ptah-origin.json`),
      JSON.stringify({
        kind: 'agent',
        slug: name,
        pluginId: null,
        version: null,
        sourceHash: `seedhash-${name}`,
        clonedAt: Date.now() - 86400000 * (i + 1),
        diverged: i === 1,
        lastEnhancedAt: i === 2 ? Date.now() - 3600000 : null,
        historyDir: '.history',
        ...(i === 1 ? { pendingSourceHash: 'seedhash-upstream-new' } : {}),
      }),
    );
  });
  }
  console.log('seeded agents at', agentsRoots.join(' and '));

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

  const app = await _electron.launch({
    args: [entry, `--user-data-dir=${udd}`, ws],
    env,
    timeout: 90_000,
  });
  const echo = (chunk) => {
    for (const line of chunk.toString('utf8').split(String.fromCharCode(10))) {
      if (/catalog|mirror|User-layer|Workspace path|reconcile|registry/i.test(line)) console.log('[app]', line.trim());
    }
  };
  app.process().stdout && app.process().stdout.on('data', echo);
  app.process().stderr && app.process().stderr.on('data', echo);
  try {
    const page = await app.firstWindow({ timeout: 90_000 });
    await page.waitForURL(
      (u) => u.protocol === 'file:' && u.pathname.endsWith('/renderer/index.html'),
      { timeout: 90_000 },
    );
    // Fixed content size so before/after are comparable.
    await app.evaluate(({ BrowserWindow }, vp) => {
      const w = BrowserWindow.getAllWindows()[0];
      if (w.isMaximized()) w.unmaximize();
      w.setContentSize(vp.width, vp.height);
      w.center();
    }, VIEWPORT);
    await page.waitForTimeout(1500);
    console.log('actual viewport:', JSON.stringify(await page.evaluate(() => ({ w: window.innerWidth, h: window.innerHeight, dpr: window.devicePixelRatio }))));

    const shot = async (name) => {
      const p = path.join(outDir, `${prefix}-${name}.png`);
      await page.screenshot({ path: p });
      console.log('SHOT', p);
    };
    const log = (m) => console.log('[step]', m);

    await page.locator('[data-test="config-menu-item-thoth"]').waitFor({ state: 'visible', timeout: 60_000 });
    await page.locator('[data-test="config-menu-item-thoth"]').click();
    await page.locator('#thoth-tab-skills').click();
    log('skills tab');
    await page.locator('[data-testid="skills-subview-clones"]').click();
    await page.locator('[data-testid="clones-view"]').waitFor({ state: 'visible', timeout: 30_000 });
    // Agents kind tab inside the library
    await page.getByRole('tab', { name: /^Agents/ }).first().click();
    log('agents kind tab');
    await page.waitForTimeout(15000); // recheck: let background reconcile settle
    const rows = await page.locator('[data-testid="clones-row"]').count();
    console.log('clones-row count:', rows);

    async function setTheme(name) {
      await page.locator('[aria-label="Change theme"]').first().click();
      await page.locator(`button[data-theme="${name}"]`).first().click();
      await page.keyboard.press('Escape').catch(() => undefined);
      await page.mouse.click(5, 5).catch(() => undefined);
      await page.waitForTimeout(800);
      const t = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
      console.log('theme now:', t);
    }

    for (const [label, theme] of [['dark', 'anubis'], ['light', 'anubis-light']]) {
      await setTheme(theme);
      await page.locator('[data-testid="clones-grid"]').scrollIntoViewIfNeeded().catch(() => undefined);
      await page.evaluate(() => {
        const g = document.querySelector('[data-testid="clones-grid"]');
        const tabs = g && g.closest('[data-testid="clones-view"]');
        if (tabs) tabs.scrollIntoView({ block: 'start' });
      });
      await page.waitForTimeout(400);
      console.log('[dom]', label, JSON.stringify(await page.evaluate(() => {
        const q = (s) => [...document.querySelectorAll(s)];
        const dd = q('[data-testid="clone-metric-outcome-empty"],[data-testid="clone-metric-outcome-loading"],[data-testid="clone-metric-outcome-unavailable"]');
        return {
          outcomeDd: dd.map((d) => ({ tid: d.getAttribute('data-testid'), text: d.textContent.trim(), scrollW: d.scrollWidth, clientW: d.clientWidth, title: d.getAttribute('title'), color: getComputedStyle(d).color })),
          cardTexts: q('[data-testid="clones-row"]').map((c) => c.innerText.split(String.fromCharCode(10)).join(' | ').slice(0, 330)),
          disabledButtons: q('[data-testid="clones-view"] button').filter((b) => b.disabled).map((b) => (b.textContent || '').trim().slice(0, 40)),
          notes: q('[data-testid="clone-outcome-unavailable"],[data-testid="clone-outcome-not-persistent"]').map((n) => n.textContent.trim()),
        };
      })));
      await shot(`agents-list-${label}`);
      // Detail drawer: open the first card if present.
      const card = page.locator('[data-testid="clones-row"]').first();
      if (await card.isVisible().catch(() => false)) {
        const opener = card.locator('button, [role="button"]').first();
        await card.click({ timeout: 5000 }).catch(async () => opener.click().catch(() => undefined));
        await page.waitForTimeout(1200);
        console.log('[dom-drawer]', label, JSON.stringify(await page.evaluate(() => { const d = document.querySelector('[data-testid*="drawer"]'); return d ? { text: d.innerText.split(String.fromCharCode(10)).join(' | ').slice(0, 700), disabled: [...d.querySelectorAll('button')].filter((b) => b.disabled).map((b) => b.textContent.trim().slice(0, 30)) } : null; })));
        const drawer = page.locator('[data-testid*="drawer"]').first();
        console.log('drawer visible:', await drawer.isVisible().catch(() => false));
        await shot(`agents-drawer-${label}`);
        await page.keyboard.press('Escape').catch(() => undefined);
        await page.waitForTimeout(600);
      }
    }
  } finally {
    await app.close().catch(() => undefined);
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) { /* ignore */ }
  }
}

main().catch((e) => {
  console.error('CAPTURE FAILED', e);
  process.exit(1);
});
