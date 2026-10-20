/**
 * TASK_2026_662 Phase B visual capture. Usage: node capture-phase-b.cjs <buildWorktree> <outDir> [onlyStage]
 * Private HOME/APPDATA/userData/DB under os.tmpdir(); Ollama endpoints point at 127.0.0.1:1. CDP port 9390 only.
 * RPC faults (delay / failure / fake reply) are injected in the renderer by wrapping window.vscode.postMessage.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createRequire } = require('module');

const root = path.resolve(process.argv[2]);
const outDir = path.resolve(process.argv[3]);
const ONLY = process.argv[4] || '';
const VIEWPORT = { width: 1280, height: 800 };
const req = createRequire(path.join(root, 'package.json'));
const { _electron } = req('@playwright/test');
const index = [];
const log = (s) => { index.push(s); console.log(s); };

function userLayerAgentDirName(r) {
  const slashed = r.split('\\').join('/').replace(/\/+$/, '');
  const canonical = process.platform === 'win32' ? slashed.toLowerCase() : slashed;
  const seg = canonical.slice(canonical.lastIndexOf('/') + 1);
  const label = seg.toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/-+/g, '-').replace(/^[-.]+|[-.]+$/g, '').slice(0, 32) || 'ws';
  let high = 0x811c9dc5, low = 0xcbf29ce4;
  for (let i = 0; i < canonical.length; i += 1) {
    const c = canonical.charCodeAt(i);
    high = Math.imul(high ^ c, 0x01000193) >>> 0;
    low = Math.imul(low ^ (c + i), 0x01000021) >>> 0;
  }
  return `${label}-${(high.toString(16).padStart(8, '0') + low.toString(16).padStart(8, '0')).slice(0, 16)}`;
}

const AGENTS = [
  ['architect', 'Designs component boundaries and writes the implementation plan.', 'opus'],
  ['backend-developer', 'Writes server-side services, handlers and persistence code.', 'sonnet'],
  ['frontend-developer', 'Builds Angular components, templates and styling.', 'sonnet'],
  ['code-reviewer', 'Reviews a diff for correctness and repository conventions.', 'sonnet'],
];

function sidecar(kind, slug, i) {
  return JSON.stringify({
    kind, slug, pluginId: null, version: null, sourceHash: `seedhash-${slug}`,
    clonedAt: Date.now() - 86400000 * (i + 1), diverged: false,
    lastEnhancedAt: null, historyDir: '.history',
  });
}

async function main() {
  fs.mkdirSync(outDir, { recursive: true });
  const tmp = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'ptah-662-pb-')));
  const home = path.join(tmp, 'home');
  const udd = path.join(tmp, 'udd');
  const appdata = path.join(tmp, 'appdata');
  const ws = path.join(tmp, 'ws');
  for (const d of [home, udd, appdata, path.join(ws, '.claude', 'agents'), path.join(ws, '.ptah')]) fs.mkdirSync(d, { recursive: true });
  const wsKey = userLayerAgentDirName(ws);
  for (const agentsRoot of [path.join(home, '.ptah', 'user', 'agents', wsKey), path.join(home, '.ptah', 'user', 'agents')]) {
    fs.mkdirSync(agentsRoot, { recursive: true });
    AGENTS.forEach(([name, desc, model], i) => {
      fs.writeFileSync(path.join(agentsRoot, `${name}.md`), `---\nname: ${name}\ndescription: ${desc}\nmodel: ${model}\n---\n\nYou are the ${name} agent. ${desc}\n`);
      fs.writeFileSync(path.join(agentsRoot, `${name}.ptah-origin.json`), sidecar('agent', name, i));
    });
  }
  // skills (dir clones) and commands (file clones)
  const SKILLS = [['unused-skill', 'Never run.'], ['used-skill', 'Run but never graded.'], ['graded-skill', 'Run and graded.'], ['zero-skill', 'Run, graded, always failing.']];
  SKILLS.forEach(([slug, desc], i) => {
    const d = path.join(home, '.ptah', 'user', 'skills', slug);
    fs.mkdirSync(d, { recursive: true });
    fs.writeFileSync(path.join(d, 'SKILL.md'), `---\nname: ${slug}\ndescription: ${desc}\n---\n\n# ${slug}\n\n${desc}\n`);
    fs.writeFileSync(path.join(d, '.ptah-origin.json'), sidecar('skill', slug, i));
  });
  const COMMANDS = [['unused-cmd', 'Never run.'], ['used-cmd', 'Run but never graded.'], ['graded-cmd', 'Run and graded.']];
  fs.mkdirSync(path.join(home, '.ptah', 'user', 'commands'), { recursive: true });
  COMMANDS.forEach(([slug, desc], i) => {
    const f = path.join(home, '.ptah', 'user', 'commands', slug);
    fs.writeFileSync(`${f}.md`, `---\ndescription: ${desc}\n---\n\n${desc}\n`);
    fs.writeFileSync(`${f}.ptah-origin.json`, sidecar('command', slug, i));
  });
  const dbPath = path.join(tmp, 'ptah.sqlite');
  const env = {
    ...process.env, NODE_ENV: 'test', PTAH_E2E: '1', PTAH_DB_PATH: dbPath,
    HOME: home, USERPROFILE: home, APPDATA: appdata, LOCALAPPDATA: appdata,
    OLLAMA_HOST: '127.0.0.1:1', OLLAMA_BASE_URL: 'http://127.0.0.1:1',
  };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await _electron.launch({ args: [path.join(root, 'dist', 'apps', 'ptah-electron', 'main.mjs'), `--user-data-dir=${udd}`, '--remote-debugging-port=9390', ws], env, timeout: 90_000 });
  log('electron pid: ' + app.process().pid);
  const mainLog = [];
  for (const st of ['stdout', 'stderr']) app.process()[st].on('data', (d) => mainLog.push(String(d)));
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
    log('viewport ' + JSON.stringify(await page.evaluate(() => ({ w: window.innerWidth, h: window.innerHeight }))));


    let theme = 'dark';
    async function setTheme(name) {
      await page.locator('[aria-label="Change theme"]').first().click();
      await page.locator(`button[data-theme="${name}"]`).first().click();
      await page.keyboard.press('Escape').catch(() => undefined);
      await page.mouse.click(5, 5).catch(() => undefined);
      await page.waitForTimeout(800);
    }
    for (const [label, tname] of [['dark', 'anubis'], ['light', 'anubis-light']]) {
      theme = label;
      await page.locator('[data-test="config-menu-item-thoth"]').waitFor({ state: 'visible', timeout: 60_000 });
      await setTheme(tname);
      for (const width of [1024, 1280, 1920]) {
        const height = width === 1920 ? 1080 : 800;
        await app.evaluate(({ BrowserWindow }, vp) => { const w = BrowserWindow.getAllWindows()[0]; if (w.isMaximized()) w.unmaximize(); w.setContentSize(vp.width, vp.height); w.center(); }, { width, height });
        await page.waitForTimeout(1500);
        const actual = await page.evaluate(() => ({ w: window.innerWidth, h: window.innerHeight }));
        log(`window request ${width}x${height} actual ${actual.w}x${actual.h} theme ${label}`);
        await page.locator('[data-test="config-menu-item-thoth"]').click();
        for (const tab of ['memory', 'skills', 'cron', 'gateway']) {
          await page.locator(`#thoth-tab-${tab}`).click({ timeout: 15000 }).catch((e) => log('tab fail ' + tab + ' ' + e.message.slice(0, 60)));
          await page.waitForTimeout(2500);
          const file = `tiles-${tab}-${width}-${label}.png`;
          await page.screenshot({ path: path.join(outDir, file) });
          const tiles = await page.evaluate(() => {
            const grids = [...document.querySelectorAll('div')].filter((e) => /auto-fit/.test(e.className) && /minmax\(9\.5rem/.test(e.className));
            return grids.map((g) => { const gr = g.getBoundingClientRect(); const kids = [...g.children]; const rows = new Set(kids.map((k) => Math.round(k.getBoundingClientRect().top))).size; return { n: kids.length, rows, gridRight: Math.round(gr.right), vw: window.innerWidth, tiles: kids.map((k) => { const r = k.getBoundingClientRect(); return { t: k.textContent.trim().replace(/\s+/g, ' ').slice(0, 28), w: Math.round(r.width), right: Math.round(r.right), sw: k.scrollWidth, cw: k.clientWidth, sh: k.scrollHeight, ch: k.clientHeight, inner: [...k.querySelectorAll('*')].filter((c) => c.scrollWidth > c.clientWidth + 1 && getComputedStyle(c).overflowX !== 'visible').length, over: [...k.querySelectorAll('*')].some((c) => c.getBoundingClientRect().right > r.right + 0.5) }; }) }; });
          });
          log('TILES ' + file + ' ' + JSON.stringify(tiles));          const ov = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
          log(`SHOT ${file} actual=${actual.w}x${actual.h} horizontalOverflow=${ov}`);
        }
      }
    }
  } finally {
    await app.close().catch(() => undefined);
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) { /* ignore */ }
    fs.writeFileSync(path.join(outDir, 'index-raw.txt'), index.join(String.fromCharCode(10)));
  }
}
main().catch((e) => { console.error('CAPTURE FAILED', e); process.exit(1); });

