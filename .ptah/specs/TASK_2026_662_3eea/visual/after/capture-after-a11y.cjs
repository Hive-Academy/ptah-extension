/**
 * TASK_2026_662 AFTER capture (pre-purge UI). Usage: node capture-before.cjs <buildWorktree> <outDir>
 * Private HOME/APPDATA/userData/DB under os.tmpdir(); all Ollama endpoints are unset (nothing reaches a provider).
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createRequire } = require('module');

const root = path.resolve(process.argv[2]);
const outDir = path.resolve(process.argv[3]);
const VIEWPORT = { width: 1280, height: 800 };
const req = createRequire(path.join(root, 'package.json'));
const { _electron } = req('@playwright/test');

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
const index = [];
process.env.PTAH_DB_PATH_AFTER = '';

async function main() {
  fs.mkdirSync(outDir, { recursive: true });
  const tmp = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'ptah-662-after-')));
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
      fs.writeFileSync(path.join(agentsRoot, `${name}.ptah-origin.json`), JSON.stringify({
        kind: 'agent', slug: name, pluginId: null, version: null, sourceHash: `seedhash-${name}`,
        clonedAt: Date.now() - 86400000 * (i + 1), diverged: i === 1,
        lastEnhancedAt: i === 2 ? Date.now() - 3600000 : null, historyDir: '.history',
        ...(i === 1 ? { pendingSourceHash: 'seedhash-upstream-new' } : {}),
      }));
    });
  }
  process.env.PTAH_DB_PATH_AFTER = path.join(tmp, 'ptah.sqlite');
  const env = {
    ...process.env, NODE_ENV: 'test', PTAH_E2E: '1', PTAH_DB_PATH: path.join(tmp, 'ptah.sqlite'),
    HOME: home, USERPROFILE: home, APPDATA: appdata, LOCALAPPDATA: appdata,
    OLLAMA_HOST: '127.0.0.1:1', OLLAMA_BASE_URL: 'http://127.0.0.1:1',
  };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await _electron.launch({ args: [path.join(root, 'dist', 'apps', 'ptah-electron', 'main.mjs'), `--user-data-dir=${udd}`, '--remote-debugging-port=9390', ws], env, timeout: 90_000 });
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
    const vp = await page.evaluate(() => ({ w: window.innerWidth, h: window.innerHeight }));
    console.log('viewport', JSON.stringify(vp));
    index.push(`Viewport (actual): ${vp.w}x${vp.h}`);


    let theme = 'dark';
    const shot = async (name, locator) => {
      const file = `after-${name}-${theme}.png`;
      const p = path.join(outDir, file);
      if (locator) await locator.screenshot({ path: p }); else await page.screenshot({ path: p });
      console.log('SHOT', file);
    };
    async function setTheme(name) {
      await page.locator('[aria-label="Change theme"]').first().click();
      await page.locator(`button[data-theme="${name}"]`).first().click();
      await page.keyboard.press('Escape').catch(() => undefined);
      await page.mouse.click(5, 5).catch(() => undefined);
      await page.waitForTimeout(800);
    }
    const { DatabaseSync } = require('node:sqlite');
    await page.locator('[data-test="config-menu-item-thoth"]').waitFor({ state: 'visible', timeout: 60000 });
    const db = new DatabaseSync(process.env.PTAH_DB_PATH_AFTER);
    const ins = db.prepare("INSERT INTO skill_task_grades (task_id,subject_kind,subject_slug,attribution_key,run_id,verdict,source_file,source_digest,evidence_source,workspace_root,graded_at,findings_ref) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)");
    const now = Date.now();
    [['frontend-developer','pass'],['frontend-developer','fail'],['code-reviewer','fail'],['backend-developer','pass']].forEach(([slug, v], i) => ins.run('TASK_2026_9' + i, 'agent', slug, 'event:' + i, 'run-' + i, v, null, null, 'spec:TASK_2026_9' + i, null, now - i * 3600000, null));
    db.close();
    const measure = () => page.evaluate(() => {
      const cv = document.createElement('canvas').getContext('2d');
      const rgb = (c) => { cv.clearRect(0,0,1,1); cv.fillStyle = '#000'; cv.fillStyle = c; cv.fillRect(0,0,1,1); const d = cv.getImageData(0,0,1,1).data; return [d[0], d[1], d[2], d[3] / 255]; };
      const lum = ([r,g,b]) => { const f = (v) => { v/=255; return v<=0.03928? v/12.92 : Math.pow((v+0.055)/1.055,2.4); }; return 0.2126*f(r)+0.7152*f(g)+0.0722*f(b); };
      const solid = (el) => { let stack = []; for (let e = el; e; e = e.parentElement) stack.push(rgb(getComputedStyle(e).backgroundColor)); let base = [255,255,255]; // composite from top ancestor down
        for (let i = stack.length - 1; i >= 0; i--) { const [r,g,b,a] = stack[i]; base = [r*a+base[0]*(1-a), g*a+base[1]*(1-a), b*a+base[2]*(1-a)]; } return base; };
      const out = [];
      document.querySelectorAll('[data-testid="scorecard-success"],[data-testid="scorecard-row-verdict"]').forEach((el) => {
        if (!el.offsetParent) return;
        const cs = getComputedStyle(el); const fgc = rgb(cs.color); const bg = solid(el);
        const fg = [fgc[0]*fgc[3]+bg[0]*(1-fgc[3]), fgc[1]*fgc[3]+bg[1]*(1-fgc[3]), fgc[2]*fgc[3]+bg[2]*(1-fgc[3])];
        const L1 = lum(fg), L2 = lum(bg); const r = el.getBoundingClientRect();
        out.push({ id: el.dataset.testid, text: el.textContent.trim(), fg: fg.map(Math.round).join(','), bg: bg.map(Math.round).join(','), ratio: +((Math.max(L1,L2)+0.05)/(Math.min(L1,L2)+0.05)).toFixed(2), w: Math.round(r.width), h: Math.round(r.height), fs: cs.fontSize, cls: el.className.replace(/ng-[^ ]+/g,'').trim() });
      });
      return out;
    });
    const log = [];
    for (const [label, tname] of [['dark', 'anubis'], ['light', 'anubis-light']]) {
      theme = label; await setTheme(tname);
      await page.locator('[data-test="config-menu-item-thoth"]').click();
      await page.locator('#thoth-tab-skills').click({ timeout: 15000 });
      await page.waitForTimeout(1000);
      await page.locator('[data-testid="skills-subview-clones"]').click();
      await page.locator('[data-testid="clones-view"]').waitFor({ state: 'visible', timeout: 30000 });
      await page.waitForTimeout(6000);
      await page.getByRole('tab', { name: /^Agents/ }).first().click();
      await page.waitForTimeout(2000);
      log.push([label, 'cards', JSON.stringify(await measure())]);
      const cards = page.locator('[data-testid="clones-row"]');
      // measure card geometry (layout stability): heights of all cards
      log.push([label, 'cardHeights', JSON.stringify(await cards.evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().height))))]);
      // drawers
      for (const [i, name] of [[0,'architect'],[3,'frontend'],[2,'reviewer']]) {
        await cards.nth(i).click(); await page.waitForTimeout(1800);
        log.push([label, 'drawer-' + name, JSON.stringify(await measure())]);
        // keyboard focus: tab through drawer
        await page.locator('[data-testid*="drawer"]').first().focus().catch(() => undefined);
        const stops = [];
        for (let k = 0; k < 6; k++) {
          await page.keyboard.press('Tab'); await page.waitForTimeout(150);
          stops.push(await page.evaluate(() => { const e = document.activeElement; const cs = getComputedStyle(e); return (e.tagName + ':' + (e.getAttribute('data-testid') || e.getAttribute('aria-label') || e.textContent.trim().slice(0, 20)) + ' outline=' + cs.outlineStyle + '/' + cs.outlineWidth + ' shadow=' + (cs.boxShadow || '').slice(0, 40)); }));
          if (k === 1) await shot('drawer-focus-' + name); 
        }
        log.push([label, 'tabstops-' + name, stops.join(' || ')]);
        const pill = page.locator('[data-testid="scorecard-success"]:visible').first();
        const hover = await pill.evaluate((e) => ({ tabindex: e.tabIndex, title: e.title, role: e.getAttribute('role'), interactive: e.tagName }));
        log.push([label, 'pill-' + name, JSON.stringify(hover)]);
        await page.keyboard.press('Escape'); await page.waitForTimeout(600);
      }
    }
    fs.writeFileSync(path.join(outDir, 'a11y-raw.txt'), log.map((l) => l.join(' | ')).join('\n'));
  } finally {
    await app.close().catch(() => undefined);
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) { /* ignore */ }
  }
}
main().catch((e) => { console.error('CAPTURE FAILED', e); process.exit(1); });
