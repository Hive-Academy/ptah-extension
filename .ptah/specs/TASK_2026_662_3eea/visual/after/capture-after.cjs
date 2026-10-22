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
    const shot = async (name, what, locator) => {
      const file = `after-${name}-${theme}.png`;
      const p = path.join(outDir, file);
      try {
        if (locator) await locator.screenshot({ path: p });
        else await page.screenshot({ path: p });
        index.push(`| ${name} | ${theme} | ${file} | ${what} |`);
        console.log('SHOT', file);
      } catch (e) {
        index.push(`| ${name} | ${theme} | MISSING | ${what} (${String(e.message).slice(0, 80)}) |`);
        console.log('MISSING', name, theme, e.message);
      }
    };
    async function setTheme(name) {
      await page.locator('[aria-label="Change theme"]').first().click();
      await page.locator(`button[data-theme="${name}"]`).first().click();
      await page.keyboard.press('Escape').catch(() => undefined);
      await page.mouse.click(5, 5).catch(() => undefined);
      await page.waitForTimeout(800);
      console.log('theme', await page.evaluate(() => document.documentElement.getAttribute('data-theme')));
    }
    const tryDo = async (label, fn) => { try { await fn(); } catch (e) { console.log('STEP FAIL', label, e.message.slice(0, 120)); } };

    for (const [label, tname] of [['dark', 'anubis'], ['light', 'anubis-light']]) {
      theme = label;
      await page.locator('[data-test="config-menu-item-thoth"]').waitFor({ state: 'visible', timeout: 60_000 });
      await setTheme(tname);

      // --- Skills tab
      await page.locator('[data-test="config-menu-item-thoth"]').click();
      await tryDo('skills tab', () => page.locator('#thoth-tab-skills').click({ timeout: 15000 }));
      await page.waitForTimeout(1500);
      await shot('skills-header', 'Skills tab landing (pause switch, stats strip, subview tabs)');
      for (const [id, nice] of [['suggestions', 'Recommended'], ['candidates', 'Sessions'], ['activity', 'Activity']]) {
        await tryDo(id, async () => {
          await page.locator(`[data-testid="skills-subview-${id}"]`).click({ timeout: 10000 });
          await page.waitForTimeout(1200);
        });
        await shot(`skills-${id}`, `${nice} subview`);
      }
      // Library
      await tryDo('library', async () => {
        await page.locator('[data-testid="skills-subview-clones"]').click({ timeout: 10000 });
        await page.locator('[data-testid="clones-view"]').waitFor({ state: 'visible', timeout: 30000 });
        await page.waitForTimeout(8000);
      });
      for (const kind of ['Skills', 'Commands', 'Agents']) {
        await tryDo(kind, async () => {
          await page.getByRole('tab', { name: new RegExp('^' + kind) }).first().click({ timeout: 10000 });
          await page.waitForTimeout(1500);
        });
        await shot(`library-${kind.toLowerCase()}`, `Library > ${kind} kind tab`);
      }
      // Agents card + drawer + enhance
      await tryDo('agent card', async () => {
        const grid = page.locator('[data-testid="clones-grid"]');
        await grid.scrollIntoViewIfNeeded();
        const card = page.locator('[data-testid="clones-row"]').first();
        await card.waitFor({ state: 'visible', timeout: 10000 });
        await shot('agent-card', 'First agent library card (metrics / Success % / Enhance now control)', card);
        const enh = page.getByRole('button', { name: /Enhance now/i });
        console.log('enhance buttons', await enh.count());
        index.push(`(note ${theme}) "Enhance now" buttons found on Agents tab: ${await enh.count()}`);
        await card.click({ timeout: 5000 }).catch(() => undefined);
        await page.waitForTimeout(1500);
        await shot('agent-drawer', 'Agent detail drawer (scorecard / outcome signals)');
        const drawer = page.locator('[data-testid*="drawer"]').first();
        if (await drawer.isVisible().catch(() => false)) {
          index.push(`(note ${theme}) drawer text: ${(await drawer.innerText()).split('\n').join(' | ').slice(0, 400)}`);
          await shot('agent-drawer-element', 'Agent detail drawer element only', drawer);
        }
        await page.keyboard.press('Escape').catch(() => undefined);
        await page.waitForTimeout(600);
      });
      // Graded variants: seed skill_task_grades once (dark pass), then re-open the Library.
      await tryDo('graded', async () => {
        if (!globalThis.__seeded) {
          const { DatabaseSync } = require('node:sqlite');
          const db = new DatabaseSync(process.env.PTAH_DB_PATH_AFTER);
          const ins = db.prepare("INSERT INTO skill_task_grades (task_id,subject_kind,subject_slug,attribution_key,run_id,verdict,source_file,source_digest,evidence_source,workspace_root,graded_at,findings_ref) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)");
          const now = Date.now();
          [['frontend-developer','pass'],['frontend-developer','pass'],['frontend-developer','pass'],['frontend-developer','fail'],['code-reviewer','fail'],['backend-developer','pass'],['backend-developer','pass']].forEach(([slug, v], i) => {
            ins.run('TASK_2026_9' + String(i).padStart(2, '0'), 'agent', slug, 'event:' + i, i % 2 ? 'run-' + i : null, v, null, null, i % 2 ? 'spec:TASK_2026_9' + i : 'window', null, now - i * 3600000, null);
          });
          db.close();
          globalThis.__seeded = true;
        }
        await page.locator('[data-testid="skills-subview-suggestions"]').click({ timeout: 8000 }).catch(() => undefined);
        await page.waitForTimeout(800);
        await page.locator('[data-testid="skills-subview-clones"]').click({ timeout: 10000 });
        await page.locator('[data-testid="clones-view"]').waitFor({ state: 'visible', timeout: 30000 });
        await page.waitForTimeout(6000);
        await page.getByRole('tab', { name: /^Agents/ }).first().click({ timeout: 10000 });
        await page.waitForTimeout(2000);
        await shot('library-agents-graded', 'Library > Agents with seeded grades (75% ok / 0% ok / 100% ok / none)');
        const cards = page.locator('[data-testid="clones-row"]');
        const n = await cards.count();
        for (let i = 0; i < n; i++) {
          const c = cards.nth(i);
          index.push(`(note ${theme}) card ${i}: ${(await c.innerText()).split(String.fromCharCode(10)).join(' | ').slice(0, 300)}`);
          await shot('agent-card-graded-' + i, 'Graded card ' + i, c);
        }
        index.push(`(note ${theme}) stray 0% text on page: ${await page.evaluate(() => (document.body.innerText.match(/0%/g) || []).length)}`);
        // drawers for card 2 (frontend) and card 3 (reviewer)
        for (const i of [1, 2, 3]) {
          await cards.nth(i).click({ timeout: 5000 });
          await page.waitForTimeout(1800);
          await shot('agent-drawer-graded-' + i, 'Drawer for card ' + i);
          const drawer = page.locator('[data-testid*="drawer"]').first();
          if (await drawer.isVisible().catch(() => false)) {
            index.push(`(note ${theme}) graded drawer ${i}: ${(await drawer.innerText()).split(String.fromCharCode(10)).join(' | ').slice(0, 500)}`);
            const rows = page.locator('[data-testid="scorecard-detail-row"]');
            if (await rows.count()) await shot('scorecard-rows-' + i, 'Scorecard detail rows ' + i, rows.first());
            // contrast + focus metrics
            const m = await page.evaluate(() => {
              const out = [];
              const lum = (c) => { const [r,g,b] = c.map((v) => { v/=255; return v<=0.03928? v/12.92 : Math.pow((v+0.055)/1.055,2.4); }); return 0.2126*r+0.7152*g+0.0722*b; };
              const parse = (s) => { const x = s.match(/[\d.]+/g).map(Number); return x; };
              const bg = (el) => { let e = el; while (e) { const c = getComputedStyle(e).backgroundColor; const p = parse(c); if (p.length < 4 || p[3] > 0.5) return p.slice(0,3); e = e.parentElement; } return [255,255,255]; };
              document.querySelectorAll('[data-testid="scorecard-success"],[data-testid="scorecard-row-verdict"]').forEach((el) => {
                const fg = parse(getComputedStyle(el).color).slice(0,3); const b = bg(el);
                const L1 = lum(fg), L2 = lum(b); const ratio = (Math.max(L1,L2)+0.05)/(Math.min(L1,L2)+0.05);
                const r = el.getBoundingClientRect();
                out.push({ id: el.dataset.testid, text: el.textContent.trim(), fg: fg.join(','), bg: b.join(','), ratio: ratio.toFixed(2), w: Math.round(r.width), h: Math.round(r.height), fs: getComputedStyle(el).fontSize });
              });
              return out;
            });
            index.push(`(note ${theme}) drawer ${i} contrast: ${JSON.stringify(m)}`);
          }
          await page.keyboard.press('Escape').catch(() => undefined);
          await page.waitForTimeout(600);
        }
        // overflow check
        index.push(`(note ${theme}) horizontal overflow: ${await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)}`);
      });
      // Settings subview
      await tryDo('skills settings', async () => {
        await page.locator('[data-testid="skills-subview-settings"]').click({ timeout: 10000 });
        await page.waitForTimeout(1200);
      });
      await shot('skills-settings', 'Skills > Settings panel');

      await page.waitForTimeout(800);
    }
  } finally {
    await app.close().catch(() => undefined);
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) { /* ignore */ }
    fs.writeFileSync(path.join(outDir, 'index-raw.txt'), index.join('\n'));
  }
}
main().catch((e) => { console.error('CAPTURE FAILED', e); process.exit(1); });
